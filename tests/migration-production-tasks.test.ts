/**
 * 迁移 v24 单元测试：quote_production_tasks 表（订单做货流程甘特图数据）
 *
 * 测试覆盖：
 *   1. 表结构：全部业务列 + 索引（idx_qpt_quote_id / idx_qpt_plan_start）
 *   2. 存量数据迁移：productionStepStatus → 6 个标准步骤任务行
 *      （状态映射 pending→0 / in_progress→1 / completed→2，日期为空）
 *      空状态与损坏 JSON 的订单跳过不迁移
 *   3. CRUD：getByQuoteId（step_order 排序）/ replaceForQuote（整体替换、顺序重排、materials JSON 往返）
 *   4. 幂等性：直接重跑 v24.up 不产生重复任务行
 *   5. 回滚：rollback(23) 后表删除、productionStepStatus 恢复；重新迁移后数据恢复
 *   6. 版本号：CURRENT_SCHEMA_VERSION = 24，迁移记录存在
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { CURRENT_SCHEMA_VERSION, getMigrations } from '../api/migrations/index.js'

// ============================================================
// 辅助函数
// ============================================================

/** 检查指定表是否存在 */
async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  )
  return (rows as any[])[0].cnt > 0
}

/** 检查指定表中是否存在指定列 */
async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  )
  return (rows as any[])[0].cnt > 0
}

/** 检查指定索引是否存在 */
async function indexExists(tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName],
  )
  return (rows as any[])[0].cnt > 0
}

/** v24 迁移内置的 6 个标准步骤（与 ProductionSteps 常量一致） */
const DEFAULT_STEPS = ['面料采购', '裁剪', '印刷', '缝纫', '质检', '包装']

// ============================================================
// 测试
// ============================================================

beforeAll(async () => {
  await db.runner.migrate()
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

describe('迁移 v24：quote_production_tasks 做货流程任务', () => {
  describe('表结构', () => {
    it('quote_production_tasks 表已创建', async () => {
      expect(await tableExists('quote_production_tasks')).toBe(true)
    })

    it('包含全部业务列', async () => {
      for (const col of [
        'id', 'quote_id', 'step_order', 'name',
        'plan_start', 'plan_end', 'actual_start', 'actual_end',
        'status', 'remark', 'materials', 'created_at', 'updated_at',
      ]) {
        expect(await columnExists('quote_production_tasks', col)).toBe(true)
      }
    })

    it('包含索引 idx_qpt_quote_id 与 idx_qpt_plan_start', async () => {
      expect(await indexExists('quote_production_tasks', 'idx_qpt_quote_id')).toBe(true)
      expect(await indexExists('quote_production_tasks', 'idx_qpt_plan_start')).toBe(true)
    })
  })

  describe('存量数据迁移（productionStepStatus → 任务行）', () => {
    it('带状态订单迁移为 6 个标准步骤，状态映射与日期正确', async () => {
      // 从 v23 状态开始：清数据 → 回滚（删表）→ 造存量数据 → 重新迁移
      await resetTestDatabase()
      await db.runner.rollback(23)

      const created = await db.quotes.create({
        customerName: '存量迁移客户',
        productStyle: '1',
        quantity: '100',
        productionStepStatus: { '1': 'completed', '2': 'in_progress' },
      } as any)
      // 单独一单直接落库损坏 JSON（模拟历史脏数据）
      const broken = await db.quotes.create({
        customerName: '损坏数据客户', productStyle: '1', quantity: '1',
      } as any)
      await pool.execute(
        `UPDATE quotes SET productionStepStatus = '{invalid-json' WHERE id = ?`,
        [broken.id],
      )

      await db.runner.migrate()

      const tasks = await db.productionTasks.getByQuoteId(created.id)
      expect(tasks).toHaveLength(6)
      expect(tasks.map((t) => t.name)).toEqual(DEFAULT_STEPS)
      expect(tasks.map((t) => t.status)).toEqual([2, 1, 0, 0, 0, 0])
      // 旧数据无时间信息：全部日期为空
      for (const t of tasks) {
        expect(t.planStart).toBeNull()
        expect(t.planEnd).toBeNull()
        expect(t.actualStart).toBeNull()
        expect(t.actualEnd).toBeNull()
      }
    })

    it('空状态与损坏 JSON 订单不生成任务', async () => {
      const empty = await db.quotes.create({
        customerName: '空状态客户', productStyle: '1', quantity: '1', productionStepStatus: {},
      } as any)
      // 空状态订单
      expect(await db.productionTasks.getByQuoteId(empty.id)).toHaveLength(0)
      // 损坏 JSON 订单（上一用例造的）
      const [rows] = await pool.query(
        `SELECT id FROM quotes WHERE customerName = '损坏数据客户'`
      )
      const broken = (rows as any[])[0]
      expect(await db.productionTasks.getByQuoteId(broken.id)).toHaveLength(0)
    })
  })

  describe('db.productionTasks 读写', () => {
    it('getByQuoteId：无任务返回空数组', async () => {
      const q = await db.quotes.create({ customerName: '任务读写客户', productStyle: '2', quantity: '10' } as any)
      expect(await db.productionTasks.getByQuoteId(q.id)).toEqual([])
    })

    it('replaceForQuote：整体替换、step_order 重排、materials JSON 往返', async () => {
      const q = await db.quotes.create({ customerName: '任务替换客户', productStyle: '2', quantity: '10' } as any)
      const first = await db.productionTasks.replaceForQuote(q.id, [
        {
          name: '面料采购', planStart: '2026-09-01', planEnd: '2026-09-03',
          actualStart: '2026-09-01', actualEnd: '2026-09-02', status: 2,
          remark: '首批', materials: [{ name: '白坯布', spec: '10安', quantity: 100, unit: 'kg', ready: true }],
        },
        { name: '裁剪', status: 1, remark: '' },
        { name: '印刷', status: 0 },
      ])
      expect(first).toHaveLength(3)
      expect(first.map((t) => t.stepOrder)).toEqual([1, 2, 3])
      expect(first[0].materials).toEqual([{ name: '白坯布', spec: '10安', quantity: 100, unit: 'kg', ready: true }])

      // 回读：日期字符串与 materials 正确反序列化
      const loaded = await db.productionTasks.getByQuoteId(q.id)
      expect(loaded).toHaveLength(3)
      expect(loaded[0].planStart).toBe('2026-09-01')
      expect(loaded[0].planEnd).toBe('2026-09-03')
      expect(loaded[0].actualStart).toBe('2026-09-01')
      expect(loaded[0].actualEnd).toBe('2026-09-02')
      expect(loaded[0].status).toBe(2)
      expect(loaded[0].remark).toBe('首批')
      expect(loaded[0].materials[0].name).toBe('白坯布')
      expect(loaded[0].materials[0].ready).toBe(true)

      // 整体替换：旧数据删除，新顺序生效
      const second = await db.productionTasks.replaceForQuote(q.id, [
        { name: '质检', status: 0 },
        { name: '面料采购', status: 2 },
      ])
      expect(second.map((t) => t.name)).toEqual(['质检', '面料采购'])
      expect(second.map((t) => t.stepOrder)).toEqual([1, 2])
      const reloaded = await db.productionTasks.getByQuoteId(q.id)
      expect(reloaded).toHaveLength(2)
      expect(reloaded.map((t) => t.name)).toEqual(['质检', '面料采购'])
    })
  })

  describe('幂等性', () => {
    it('直接重跑 v24.up 不产生重复任务行', async () => {
      const [before] = await pool.query(`SELECT COUNT(*) AS cnt FROM quote_production_tasks`)
      const beforeCount = (before as any[])[0].cnt

      const v24 = getMigrations().find((m) => m.version === 24)!
      await v24.up(db.db)

      const [after] = await pool.query(`SELECT COUNT(*) AS cnt FROM quote_production_tasks`)
      expect((after as any[])[0].cnt).toBe(beforeCount)
    })
  })

  describe('回滚与恢复', () => {
    it('rollback(23)：任务表删除，productionStepStatus 恢复', async () => {
      const q = await db.quotes.create({ customerName: '回滚客户', productStyle: '3', quantity: '10' } as any)
      await db.productionTasks.replaceForQuote(q.id, [
        { name: '面料采购', status: 2 },
        { name: '裁剪', status: 1 },
        { name: '印刷', status: 0 },
      ])

      await db.runner.rollback(23)

      expect(await tableExists('quote_production_tasks')).toBe(false)
      expect(await db.getSchemaVersion()).toBe(23)

      const quote = await db.quotes.getById(q.id)
      expect((quote as any).productionStepStatus).toEqual({
        '1': 'completed', '2': 'in_progress', '3': 'pending',
      })
    })

    it('重新迁移后任务表恢复（按默认 6 步骤重建）', async () => {
      await db.runner.migrate()
      expect(await tableExists('quote_production_tasks')).toBe(true)
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

      const [rows] = await pool.query(`SELECT id FROM quotes WHERE customerName = '回滚客户'`)
      const q = (rows as any[])[0]
      const tasks = await db.productionTasks.getByQuoteId(q.id)
      // 从恢复的 productionStepStatus 重建：3 个有状态 + 3 个默认 pending
      expect(tasks).toHaveLength(6)
      expect(tasks.map((t) => t.status)).toEqual([2, 1, 0, 0, 0, 0])
    })
  })

  describe('版本号', () => {
    it('CURRENT_SCHEMA_VERSION 为 24', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(24)
    })

    it('schema_migrations 包含 v24 记录', async () => {
      const [rows] = await pool.query(`SELECT name FROM schema_migrations WHERE version = 24`)
      expect((rows as any[])[0].name).toBe('production-task-gantt')
    })

    it('当前 schema 版本为 24', async () => {
      expect(await db.getSchemaVersion()).toBe(24)
    })
  })
})
