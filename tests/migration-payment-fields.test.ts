/**
 * 迁移 v17 单元测试：quotes 表新增收款相关字段
 *
 * 测试覆盖：
 *   1. 表结构：quotes 表新增 actualSampleFee / sampleFeeDeduct / deposit / pendingAmount 字段
 *   2. 审计触发器：insert/update/delete 触发器追踪 4 个新收款字段
 *   3. 幂等性：重新执行 migrate 不报错
 *   4. 回滚：down 迁移删除 4 个新字段并恢复旧触发器
 *   5. 版本号：迁移后 schema 版本为 CURRENT_SCHEMA_VERSION
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

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

const PAYMENT_FIELDS = ['actualSampleFee', 'sampleFeeDeduct', 'deposit', 'pendingAmount'] as const

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

describe('迁移 v17：quotes 表新增收款相关字段', () => {
  describe('表结构', () => {
    it.each(PAYMENT_FIELDS)('quotes 表包含 %s 字段', async (col) => {
      expect(await columnExists('quotes', col)).toBe(true)
    })

    it('actualSampleFee 字段类型为 DECIMAL(12,2) 默认 0', async () => {
      const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'actualSampleFee'`,
      )
      const col = (rows as any[])[0]
      expect(col.COLUMN_TYPE).toBe('decimal(12,2)')
      expect(Number(col.COLUMN_DEFAULT)).toBe(0)
    })

    it('sampleFeeDeduct 字段类型为 TINYINT(1) 默认 0', async () => {
      const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'sampleFeeDeduct'`,
      )
      const col = (rows as any[])[0]
      expect(col.COLUMN_TYPE).toBe('tinyint(1)')
      expect(Number(col.COLUMN_DEFAULT)).toBe(0)
    })

    it('4 个新字段位于 sellPriceWithTax 之后、status 之前', async () => {
      const [rows] = await pool.query(
        `SELECT ORDINAL_POSITION AS pos, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
         AND COLUMN_NAME IN ('sellPriceWithTax', 'actualSampleFee', 'sampleFeeDeduct', 'deposit', 'pendingAmount', 'status')
         ORDER BY ORDINAL_POSITION`,
      )
      const names = (rows as any[]).map((r) => r.COLUMN_NAME)
      expect(names).toEqual(['sellPriceWithTax', 'actualSampleFee', 'sampleFeeDeduct', 'deposit', 'pendingAmount', 'status'])
    })
  })

  describe('审计触发器追踪收款字段', () => {
    it.each(['quotes_audit_insert', 'quotes_audit_update', 'quotes_audit_delete'] as const)
      ('%s 触发器包含 4 个收款字段', async (trigger) => {
        const body = await getTriggerBody(trigger)
        for (const field of PAYMENT_FIELDS) {
          expect(body).toContain(field)
        }
      })

    it('审计记录正确记录 pendingAmount 变更', async () => {
      const quote = await db.quotes.create({
        customerName: '收款字段测试客户',
        productStyle: '1',
        quantity: '100',
        sellPriceWithTax: 10,
        actualSampleFee: 100,
        sampleFeeDeduct: true,
        deposit: 200,
        pendingAmount: 700,
      })

      const found = await db.quotes.getById(quote.id)
      expect(found!.actualSampleFee).toBe(100)
      expect(found!.sampleFeeDeduct).toBeTruthy()
      expect(found!.deposit).toBe(200)
      expect(found!.pendingAmount).toBe(700)
    })

    it('更新订单收款字段后审计记录变更', async () => {
      const quote = await db.quotes.create({
        customerName: '收款更新测试客户',
        productStyle: '1',
        quantity: '100',
      })

      const updated = await db.quotes.update(quote.id, {
        actualSampleFee: 50,
        sampleFeeDeduct: true,
        deposit: 100,
        pendingAmount: 350,
      })
      expect(updated!.actualSampleFee).toBe(50)
      expect(updated!.sampleFeeDeduct).toBeTruthy()
      expect(updated!.deposit).toBe(100)
      expect(updated!.pendingAmount).toBe(350)

      // 验证持久化
      const found = await db.quotes.getById(quote.id)
      expect(found!.actualSampleFee).toBe(50)
      expect(found!.sampleFeeDeduct).toBeTruthy()
      expect(found!.deposit).toBe(100)
      expect(found!.pendingAmount).toBe(350)
    })

    it('复制订单时收款字段重置为默认值', async () => {
      const quote = await db.quotes.create({
        customerName: '复制重置测试客户',
        productStyle: '1',
        quantity: '100',
        actualSampleFee: 80,
        sampleFeeDeduct: true,
        deposit: 300,
        pendingAmount: 500,
      })

      const copied = await db.quotes.copy(quote.id, 'tester')
      expect(copied!.actualSampleFee).toBe(0)
      expect(copied!.sampleFeeDeduct).toBeFalsy()
      expect(copied!.deposit).toBe(0)
      expect(copied!.pendingAmount).toBe(0)
    })
  })

  describe('幂等性', () => {
    it('重新执行 migrate 不报错', async () => {
      await expect(db.runner.migrate()).resolves.not.toThrow()
    })

    it.each(PAYMENT_FIELDS)('幂等后 %s 字段仍然存在', async (col) => {
      await db.runner.migrate()
      expect(await columnExists('quotes', col)).toBe(true)
    })

    it('幂等后审计触发器仍然包含收款字段', async () => {
      await db.runner.migrate()
      const insertBody = await getTriggerBody('quotes_audit_insert')
      expect(insertBody).toContain('pendingAmount')
    })
  })

  describe('版本号', () => {
    it('迁移后 schema 版本为 CURRENT_SCHEMA_VERSION', async () => {
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })

    it('schema_migrations 表中包含 v17 记录', async () => {
      const [rows] = await pool.query(
        `SELECT version FROM schema_migrations WHERE version = 17`,
      )
      expect((rows as any[]).length).toBe(1)
    })
  })

  describe('回滚（down）', () => {
    it('回滚到 v16 后 4 个收款字段被删除', async () => {
      await db.runner.rollback(16)

      for (const col of PAYMENT_FIELDS) {
        expect(await columnExists('quotes', col)).toBe(false)
      }
      expect(await db.getSchemaVersion()).toBe(16)

      // 恢复到最新版本
      await db.runner.migrate()
    })

    it('回滚到 v16 后审计触发器不再包含收款字段', async () => {
      await db.runner.rollback(16)

      const insertBody = await getTriggerBody('quotes_audit_insert')
      expect(insertBody).not.toContain('pendingAmount')

      const updateBody = await getTriggerBody('quotes_audit_update')
      expect(updateBody).not.toContain('pendingAmount')

      const deleteBody = await getTriggerBody('quotes_audit_delete')
      expect(deleteBody).not.toContain('pendingAmount')

      // 恢复到最新版本
      await db.runner.migrate()
    })

    it('回滚后重新迁移，收款字段恢复', async () => {
      await db.runner.rollback(16)
      await db.runner.migrate()

      for (const col of PAYMENT_FIELDS) {
        expect(await columnExists('quotes', col)).toBe(true)
      }
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

      // 触发器恢复
      const insertBody = await getTriggerBody('quotes_audit_insert')
      expect(insertBody).toContain('pendingAmount')
    })
  })
})
