/**
 * 迁移 v18 单元测试：quotes 表新增应收打样费字段（receivableSampleFee）
 *
 * 测试覆盖：
 *   1. 表结构：quotes 表新增 receivableSampleFee 字段，类型 DECIMAL(12,2) 默认 0
 *   2. CRUD：创建/更新/复制订单时应收打样费读写正确（复制时重置为 0）
 *   3. 待收总额公式：v18 新公式（抵扣=是/否两种分支 + 边界值）
 *   4. 幂等性：重新执行 migrate 不报错
 *   5. 回滚：down 迁移删除新字段，重新迁移后恢复
 *   6. 版本号：迁移后 schema 版本为 CURRENT_SCHEMA_VERSION
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

/** 获取指定列的 ORDINAL_POSITION */
async function columnPosition(tableName: string, columnName: string): Promise<number> {
  const [rows] = await pool.query(
    `SELECT ORDINAL_POSITION AS pos FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  )
  return (rows as any[])[0].pos
}

/** 创建测试订单（直接走 db API，含应收打样费） */
async function createQuote(overrides: Record<string, unknown> = {}) {
  return db.quotes.create({
    customerName: '应收打样费测试客户',
    productStyle: '1',
    quantity: '100',
    sellPriceNoTax: 3.42,
    ...overrides,
  } as any)
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

describe('迁移 v18：quotes 表新增应收打样费字段', () => {
  describe('表结构', () => {
    it('quotes 表包含 receivableSampleFee 字段', async () => {
      expect(await columnExists('quotes', 'receivableSampleFee')).toBe(true)
    })

    it('receivableSampleFee 字段类型为 DECIMAL(12,2) 默认 0', async () => {
      const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'receivableSampleFee'`,
      )
      const col = (rows as any[])[0]
      expect(col.COLUMN_TYPE).toBe('decimal(12,2)')
      expect(String(col.COLUMN_DEFAULT)).toBe('0.00')
    })

    it('receivableSampleFee 位于 sellPriceWithTax 之后', async () => {
      const pos = await columnPosition('quotes', 'receivableSampleFee')
      const prevPos = await columnPosition('quotes', 'sellPriceWithTax')
      expect(pos).toBe(prevPos + 1)
    })
  })

  describe('CRUD 读写', () => {
    it('创建订单时可保存应收打样费', async () => {
      const quote = await createQuote({ receivableSampleFee: 1500.55 })
      expect(quote.receivableSampleFee).toBe(1500.55)
      const fetched = await db.quotes.getById(quote.id)
      expect(fetched!.receivableSampleFee).toBe(1500.55)
    })

    it('应收打样费未传时默认为 0', async () => {
      const quote = await createQuote()
      expect(quote.receivableSampleFee).toBe(0)
    })

    it('更新订单时可修改应收打样费', async () => {
      const quote = await createQuote({ receivableSampleFee: 100 })
      const updated = await db.quotes.update(quote.id, { receivableSampleFee: 2500.25 } as any)
      expect(updated!.receivableSampleFee).toBe(2500.25)
    })

    it('复制订单时应收打样费重置为 0', async () => {
      const quote = await createQuote({ receivableSampleFee: 888 })
      const copied = await db.quotes.copy(quote.id, '测试操作员')
      expect(copied!.receivableSampleFee).toBe(0)
    })
  })

  describe('待收总额公式（v18）', () => {
    it('抵扣=否：待收总额 = 销售总额(不含税) + 应收打样费 - 已收打样费 - 定金', async () => {
      // 3.42 × 100 + 500 - 200 - 100 = 542
      const quote = await createQuote({
        receivableSampleFee: 500,
        actualSampleFee: 200,
        deposit: 100,
        sampleFeeDeduct: false,
      })
      // 状态流转到做货中(3)：1→2→7→3，进入计算态时重算
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      const producing = await db.quotes.nextStatus(quote.id)
      expect(producing!.status).toBe(3)
      expect(producing!.pendingAmount).toBe(542)
    })

    it('抵扣=是：待收总额 = 销售总额(不含税) - 已收打样费 - 定金', async () => {
      // 3.42 × 100 - 200 - 100 = 42
      const quote = await createQuote({
        receivableSampleFee: 500,
        actualSampleFee: 200,
        deposit: 100,
        sampleFeeDeduct: true,
      })
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      const producing = await db.quotes.nextStatus(quote.id)
      expect(producing!.pendingAmount).toBe(42)
    })

    it('边界：各项费用为 0 时待收总额 = 销售总额(不含税)', async () => {
      const quote = await createQuote({})
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      const producing = await db.quotes.nextStatus(quote.id)
      expect(producing!.pendingAmount).toBe(342)
    })

    it('边界：应收打样费为 null/undefined 时按 0 计算', async () => {
      // 3.42 × 100 + 0 - 200 - 0 = 142
      const quote = await createQuote({ actualSampleFee: 200, sampleFeeDeduct: false })
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      const producing = await db.quotes.nextStatus(quote.id)
      expect(producing!.pendingAmount).toBe(142)
    })

    it('从做货中退回打样完成后待收总额清零', async () => {
      const quote = await createQuote({ receivableSampleFee: 500 })
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      await db.quotes.nextStatus(quote.id)
      // 3→7 退回：离开计算态，清零
      const rolledBack = await db.quotes.prevStatus(quote.id)
      expect(rolledBack!.status).toBe(7)
      expect(rolledBack!.pendingAmount).toBe(0)
    })
  })

  describe('幂等性与回滚', () => {
    it('幂等：重新执行 migrate 不报错且字段保留', async () => {
      await db.runner.migrate()
      expect(await columnExists('quotes', 'receivableSampleFee')).toBe(true)
    })

    it('版本号为 CURRENT_SCHEMA_VERSION', async () => {
      const version = await db.getSchemaVersion()
      expect(version).toBe(CURRENT_SCHEMA_VERSION)
      expect(version).toBeGreaterThanOrEqual(18)
    })

    it('schema_migrations 包含 v18 记录', async () => {
      const [rows] = await pool.query(
        `SELECT name FROM schema_migrations WHERE version = 18`,
      )
      expect((rows as any[])[0].name).toBe('add-receivable-sample-fee')
    })

    it('回滚到 v17 后 receivableSampleFee 字段被删除', async () => {
      await db.runner.rollback(17)
      expect(await columnExists('quotes', 'receivableSampleFee')).toBe(false)
      const version = await db.getSchemaVersion()
      expect(version).toBe(17)
    })

    it('回滚后重新迁移字段恢复', async () => {
      await db.runner.migrate()
      expect(await columnExists('quotes', 'receivableSampleFee')).toBe(true)
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })
  })
})
