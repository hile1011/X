/**
 * 迁移 v14 单元测试：新增打样完成状态(7)及 sampleCompletedTime 字段
 *
 * 测试覆盖：
 *   1. 表结构：quotes 表新增 sampleCompletedTime 字段
 *   2. 审计触发器：insert/update/delete 触发器追踪 sampleCompletedTime 字段
 *   3. 幂等性：重新执行 migrate 不报错
 *   4. 回滚：down 迁移删除 sampleCompletedTime 字段并恢复旧触发器
 *   5. 版本号：迁移后 schema 版本为 CURRENT_SCHEMA_VERSION
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'
import { getHistoryByQuoteId } from '../api/services/quoteHistory.js'

// ============================================================
// 辅助函数
// ============================================================

/** 检查 quotes 表中是否存在指定列 */
async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  )
  return (rows as any[])[0].cnt > 0
}

/** 获取触发器定义体，检查是否包含指定字段 */
async function getTriggerBody(triggerName: string): Promise<string> {
  const [rows] = await pool.query(
    `SELECT TRIGGER_NAME, ACTION_STATEMENT FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`,
    [triggerName],
  )
  const list = rows as any[]
  return list.length > 0 ? list[0].ACTION_STATEMENT : ''
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

describe('迁移 v14：新增打样完成状态', () => {
  describe('表结构', () => {
    it('quotes 表包含 sampleCompletedTime 字段', async () => {
      expect(await columnExists('quotes', 'sampleCompletedTime')).toBe(true)
    })

    it('sampleCompletedTime 字段类型为 VARCHAR(64)', async () => {
      const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'sampleCompletedTime'`,
      )
      const col = (rows as any[])[0]
      expect(col.COLUMN_TYPE).toBe('varchar(64)')
      expect(col.COLUMN_DEFAULT).toBe('')
    })

    it('sampleCompletedTime 字段位于 sampleTime 之后', async () => {
      const [rows] = await pool.query(
        `SELECT ORDINAL_POSITION AS pos, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
         AND COLUMN_NAME IN ('sampleTime', 'sampleCompletedTime', 'productionStartTime')
         ORDER BY ORDINAL_POSITION`,
      )
      const list = rows as any[]
      const names = list.map((r) => r.COLUMN_NAME)
      expect(names).toEqual(['sampleTime', 'sampleCompletedTime', 'productionStartTime'])
    })
  })

  describe('审计触发器追踪 sampleCompletedTime', () => {
    it('quotes_audit_insert 触发器包含 sampleCompletedTime', async () => {
      const body = await getTriggerBody('quotes_audit_insert')
      expect(body).toContain('sampleCompletedTime')
    })

    it('quotes_audit_update 触发器包含 sampleCompletedTime', async () => {
      const body = await getTriggerBody('quotes_audit_update')
      expect(body).toContain('sampleCompletedTime')
    })

    it('quotes_audit_delete 触发器包含 sampleCompletedTime', async () => {
      const body = await getTriggerBody('quotes_audit_delete')
      expect(body).toContain('sampleCompletedTime')
    })

    it('审计记录正确记录 sampleCompletedTime 变更', async () => {
      // 创建报价单
      const quote = await db.quotes.create({
        customerName: '触发器测试客户',
        productStyle: '1',
        quantity: '100',
      })

      // 流转到打样中(2)
      await db.quotes.nextStatus(quote.id)
      // 流转到打样完成(7)，应设置 sampleCompletedTime
      await db.quotes.nextStatus(quote.id)

      // 查询审计记录
      const history = await getHistoryByQuoteId(quote.id)
      // 找到 sampleCompletedTime 变更的记录（changed_fields 是逗号分隔字符串）
      const sampleCompletedUpdate = history.find((h: any) => {
        const changed = (h.changed_fields || '').split(',').filter(Boolean)
        return changed.includes('sampleCompletedTime')
      })
      expect(sampleCompletedUpdate).toBeDefined()
      const newValues = JSON.parse(sampleCompletedUpdate!.new_values)
      expect(newValues.sampleCompletedTime).toBeTruthy()
    })
  })

  describe('幂等性', () => {
    it('重新执行 migrate 不报错', async () => {
      await expect(db.runner.migrate()).resolves.not.toThrow()
    })

    it('幂等后 sampleCompletedTime 字段仍然存在', async () => {
      await db.runner.migrate()
      expect(await columnExists('quotes', 'sampleCompletedTime')).toBe(true)
    })

    it('幂等后审计触发器仍然包含 sampleCompletedTime', async () => {
      await db.runner.migrate()
      const insertBody = await getTriggerBody('quotes_audit_insert')
      expect(insertBody).toContain('sampleCompletedTime')
    })
  })

  describe('版本号', () => {
    it('迁移后 schema 版本为 CURRENT_SCHEMA_VERSION', async () => {
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })

    it('schema_migrations 表中包含 v14 记录', async () => {
      const [rows] = await pool.query(
        `SELECT version FROM schema_migrations WHERE version = 14`,
      )
      expect((rows as any[]).length).toBe(1)
    })
  })

  describe('回滚（down）', () => {
    it('回滚到 v13 后 sampleCompletedTime 字段被删除', async () => {
      await db.runner.rollback(13)

      expect(await columnExists('quotes', 'sampleCompletedTime')).toBe(false)
      expect(await db.getSchemaVersion()).toBe(13)

      // 恢复到最新版本
      await db.runner.migrate()
    })

    it('回滚到 v13 后审计触发器不再包含 sampleCompletedTime', async () => {
      await db.runner.rollback(13)

      const insertBody = await getTriggerBody('quotes_audit_insert')
      expect(insertBody).not.toContain('sampleCompletedTime')

      const updateBody = await getTriggerBody('quotes_audit_update')
      expect(updateBody).not.toContain('sampleCompletedTime')

      const deleteBody = await getTriggerBody('quotes_audit_delete')
      expect(deleteBody).not.toContain('sampleCompletedTime')

      // 恢复到最新版本
      await db.runner.migrate()
    })

    it('回滚后重新迁移，sampleCompletedTime 字段恢复', async () => {
      await db.runner.rollback(13)
      await db.runner.migrate()

      expect(await columnExists('quotes', 'sampleCompletedTime')).toBe(true)
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

      // 触发器恢复
      const insertBody = await getTriggerBody('quotes_audit_insert')
      expect(insertBody).toContain('sampleCompletedTime')
    })
  })

  describe('状态流转与 sampleCompletedTime 联动', () => {
    it('打样中(2) → 打样完成(7) 时 sampleCompletedTime 被设置', async () => {
      const quote = await db.quotes.create({
        customerName: '联动测试客户',
        productStyle: '1',
        quantity: '500',
      })

      // 1→2
      await db.quotes.nextStatus(quote.id)
      // 2→7
      const completed = await db.quotes.nextStatus(quote.id)

      expect(completed!.status).toBe(7)
      expect(completed!.sampleCompletedTime).toBeTruthy()
      expect(completed!.productionStartTime).toBe('')
    })

    it('打样完成(7) → 做货中(3) 时 productionStartTime 被设置', async () => {
      const quote = await db.quotes.create({
        customerName: '联动测试客户2',
        productStyle: '1',
        quantity: '500',
      })

      // 1→2→7→3
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      const producing = await db.quotes.nextStatus(quote.id)

      expect(producing!.status).toBe(3)
      expect(producing!.productionStartTime).toBeTruthy()
      // sampleCompletedTime 应保留
      expect(producing!.sampleCompletedTime).toBeTruthy()
    })

    it('打样完成(7) 退回到 打样中(2) 时不清空 sampleCompletedTime（仅状态回退）', async () => {
      const quote = await db.quotes.create({
        customerName: '退回测试客户',
        productStyle: '1',
        quantity: '500',
      })

      // 1→2→7
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      // 7→2
      const reverted = await db.quotes.prevStatus(quote.id)

      expect(reverted!.status).toBe(2)
      // sampleCompletedTime 保留（不清空，保留历史记录）
      expect(reverted!.sampleCompletedTime).toBeTruthy()
    })
  })
})
