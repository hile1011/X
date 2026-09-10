/**
 * 迁移 v28 单元测试：订单对账管理
 *
 * 内容：
 *   1. quotes 新增 reconciledTime 对账时间字段（VARCHAR(64)，位于 paymentTime 之后）
 *   2. 新建 quote_reconciliation_costs 表（工艺成本明细：名称/单价/数量/成本/备注/顺序）
 *
 * 测试覆盖：
 *   1. 表结构：reconciledTime 列类型与位置；成本明细表关键列、DECIMAL 精度、索引、COLLATE
 *   2. 服务链路：replaceCosts/getCosts 往返（精度/排序/全量替换）、reconcileQuote(5→8)、unreconcileQuote(8→5)
 *   3. 幂等性：重跑 v28.up 不报错，结构不变
 *   4. 回滚：rollback(27) 后列与表均被删除；重新 migrate 恢复
 *   5. 版本号：CURRENT_SCHEMA_VERSION = 28，schema_migrations 包含 v28 记录
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

/** 检查指定表中是否存在某列 */
async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  return Number((rows as any[])[0].cnt) > 0
}

/** 获取列定义（类型/默认值） */
async function getColumn(table: string, column: string): Promise<any> {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  )
  return (rows as any[])[0]
}

/** 检查指定表是否存在 */
async function tableExists(table: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )
  return Number((rows as any[])[0].cnt) > 0
}

/** 获取表排序规则 */
async function tableCollation(table: string): Promise<string> {
  const [rows] = await pool.query(
    `SELECT TABLE_COLLATION AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )
  return String((rows as any[])[0]?.c ?? '')
}

/** 获取表的索引名列表 */
async function indexNames(table: string): Promise<string[]> {
  const [rows] = await pool.query(`SHOW INDEX FROM \`${table}\``)
  return [...new Set((rows as any[]).map((r) => String(r.Key_name)))]
}

/** 创建一个状态为指定值的订单（走服务层流转，返回订单 id） */
async function createQuoteAtStatus(targetStatus: number): Promise<string> {
  const quote = await db.quotes.create({
    customerName: `v28对账测试客户-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    productStyle: '1',
    quantity: '100',
  })
  // 流转链：1→2→7→3→4→5（→8 由调用方决定）
  const flowTo5 = [2, 7, 3, 4, 5]
  let current = 1
  for (const target of flowTo5) {
    if (current === targetStatus) break
    await db.quotes.nextStatus(quote.id)
    current = target
  }
  return quote.id
}

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

describe('迁移 v28：订单对账管理', () => {
  describe('表结构 - quotes.reconciledTime', () => {
    it('quotes 表包含 reconciledTime 字段', async () => {
      expect(await columnExists('quotes', 'reconciledTime')).toBe(true)
    })

    it('reconciledTime 字段类型为 VARCHAR(64) DEFAULT ""', async () => {
      const col = await getColumn('quotes', 'reconciledTime')
      expect(col.COLUMN_TYPE).toBe('varchar(64)')
      expect(col.COLUMN_DEFAULT).toBe('')
    })

    it('reconciledTime 字段位于 paymentTime 之后、endTime 之前', async () => {
      const [rows] = await pool.query(
        `SELECT ORDINAL_POSITION AS pos, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
         AND COLUMN_NAME IN ('paymentTime', 'reconciledTime', 'endTime')
         ORDER BY ORDINAL_POSITION`,
      )
      const names = (rows as any[]).map((r) => r.COLUMN_NAME)
      expect(names).toEqual(['paymentTime', 'reconciledTime', 'endTime'])
    })
  })

  describe('表结构 - quote_reconciliation_costs', () => {
    it('quote_reconciliation_costs 表存在', async () => {
      expect(await tableExists('quote_reconciliation_costs')).toBe(true)
    })

    it('包含全部关键列', async () => {
      for (const col of [
        'id', 'quote_id', 'name', 'unit_price', 'quantity',
        'cost', 'remark', 'sort_order', 'created_at', 'updated_at',
      ]) {
        expect(await columnExists('quote_reconciliation_costs', col)).toBe(true)
      }
    })

    it('金额/数量列为 DECIMAL(12,2)', async () => {
      expect((await getColumn('quote_reconciliation_costs', 'unit_price')).COLUMN_TYPE).toBe('decimal(12,2)')
      expect((await getColumn('quote_reconciliation_costs', 'quantity')).COLUMN_TYPE).toBe('decimal(12,2)')
      expect((await getColumn('quote_reconciliation_costs', 'cost')).COLUMN_TYPE).toBe('decimal(12,2)')
    })

    it('表排序规则为 utf8mb4_unicode_ci（显式 COLLATE，避免跨表 JOIN 冲突）', async () => {
      expect(await tableCollation('quote_reconciliation_costs')).toBe('utf8mb4_unicode_ci')
    })

    it('包含主键与 quote_id 索引', async () => {
      const names = await indexNames('quote_reconciliation_costs')
      expect(names).toContain('PRIMARY')
      expect(names).toContain('idx_qrc_quote_id')
    })
  })

  describe('服务链路（成本明细 + 对账流转）', () => {
    it('replaceCosts 落库后 getCosts 按顺序返回，金额保留两位小数', async () => {
      const quoteId = await createQuoteAtStatus(5)
      const saved = await db.reconciliation.replaceCosts(quoteId, [
        { name: '数码UV印刷', unitPrice: 0.405, quantity: 7200, cost: 2919.6, remark: '双面' },
        { name: '车缝', unitPrice: 0.1, quantity: 7200, cost: 720, remark: '' },
      ])
      expect(saved).toHaveLength(2)
      expect(saved[0].sortOrder).toBe(1)
      expect(saved[1].sortOrder).toBe(2)
      expect(saved[0].unitPrice).toBe(0.41) // 四舍五入两位小数

      const loaded = await db.reconciliation.getCosts(quoteId)
      expect(loaded).toHaveLength(2)
      expect(loaded[0].name).toBe('数码UV印刷')
      expect(loaded[0].cost).toBe(2919.6)
      expect(loaded[1].name).toBe('车缝')

      // 清理
      await db.quotes.delete(quoteId)
    })

    it('replaceCosts 为全量替换语义（旧明细被清除）', async () => {
      const quoteId = await createQuoteAtStatus(5)
      await db.reconciliation.replaceCosts(quoteId, [
        { name: '工艺A', cost: 100 },
        { name: '工艺B', cost: 200 },
      ])
      await db.reconciliation.replaceCosts(quoteId, [
        { name: '工艺C', cost: 300 },
      ])
      const loaded = await db.reconciliation.getCosts(quoteId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].name).toBe('工艺C')

      // 清理
      await db.quotes.delete(quoteId)
    })

    it('reconcileQuote：已发货已收款(5) → 已对账(8)，记录 reconciledTime', async () => {
      const quoteId = await createQuoteAtStatus(5)
      const updated = await db.reconciliation.reconcileQuote(quoteId)
      expect(updated!.status).toBe(8)
      expect((updated as any).reconciledTime).toBeTruthy()

      // 清理
      await db.quotes.delete(quoteId)
    })

    it('unreconcileQuote：已对账(8) → 已发货已收款(5)，清空 reconciledTime', async () => {
      const quoteId = await createQuoteAtStatus(5)
      await db.reconciliation.reconcileQuote(quoteId)
      const reverted = await db.reconciliation.unreconcileQuote(quoteId)
      expect(reverted!.status).toBe(5)
      expect((reverted as any).reconciledTime).toBe('')

      // 清理
      await db.quotes.delete(quoteId)
    })

    it('reconcileQuote 对非 5 状态原样返回（不流转）', async () => {
      const quoteId = await createQuoteAtStatus(1)
      const unchanged = await db.reconciliation.reconcileQuote(quoteId)
      expect(unchanged!.status).toBe(1)

      // 清理
      await db.quotes.delete(quoteId)
    })

    it('成本明细 JOIN quotes 无 collation 冲突', async () => {
      const quoteId = await createQuoteAtStatus(5)
      await db.reconciliation.replaceCosts(quoteId, [{ name: '烫金', cost: 66 }])
      const [rows] = await pool.query(
        `SELECT c.name, q.customerName FROM quote_reconciliation_costs c JOIN quotes q ON q.id = c.quote_id WHERE c.quote_id = ?`,
        [quoteId],
      )
      const row = (rows as any[])[0]
      expect(row.name).toBe('烫金')
      expect(row.customerName).toContain('v28对账测试客户')

      // 清理
      await db.quotes.delete(quoteId)
    })
  })

  describe('幂等性', () => {
    it('直接重跑 v28.up 不报错且结构不变', async () => {
      const v28 = getMigrations().find((m) => m.version === 28)!
      await expect(v28.up(db.db)).resolves.not.toThrow()
      expect(await columnExists('quotes', 'reconciledTime')).toBe(true)
      expect(await tableExists('quote_reconciliation_costs')).toBe(true)
    })
  })

  describe('回滚与恢复', () => {
    it('rollback(27) 后 reconciledTime 列与 quote_reconciliation_costs 表均被删除', async () => {
      await db.runner.rollback(27)
      expect(await columnExists('quotes', 'reconciledTime')).toBe(false)
      expect(await tableExists('quote_reconciliation_costs')).toBe(false)
      expect(await db.getSchemaVersion()).toBe(27)
    })

    it('重新 migrate 后结构恢复且版本回到 28', async () => {
      await db.runner.migrate()
      expect(await columnExists('quotes', 'reconciledTime')).toBe(true)
      expect(await tableExists('quote_reconciliation_costs')).toBe(true)
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })
  })

  describe('版本号', () => {
    it('CURRENT_SCHEMA_VERSION 为 28', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(28)
    })

    it('schema_migrations 包含 v28 记录且名称正确', async () => {
      const [rows] = await pool.query(`SELECT name FROM schema_migrations WHERE version = 28`)
      expect((rows as any[])[0].name).toBe('order-reconciliation')
    })

    it('当前 schema 版本为 28', async () => {
      expect(await db.getSchemaVersion()).toBe(28)
    })
  })
})
