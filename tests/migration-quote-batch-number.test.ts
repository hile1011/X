/**
 * 数据库迁移 v36 - quote-batch-number 单元测试
 *
 * 订单批次号：quotes 新增 batch_number（VARCHAR(30) NULL）+ 索引 idx_quotes_batch_number。
 *
 * 测试目标：
 *   - 表结构：quotes 含 batch_number 列（VARCHAR(30)、可空）与索引
 *   - 版本号：CURRENT_SCHEMA_VERSION = 36
 *   - 批次一致性：assignBatch 批量设置同批次订单批次号一致；普通编辑/复制不改变批次
 *   - 排序：getAll 按批次号 DESC 第一优先、修改时间 DESC 第二优先（无批次订单沉底）
 *   - 幂等性：重复 migrate 不报错、列仍存在
 *   - down 回滚：rollback(35) 后列与索引删除，再 migrate 恢复
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

const BATCH_A = 'PN-20260917120000'
const BATCH_B = 'PN-20260917150000'

beforeAll(async () => {
  // 确保 schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
  await db.runner.migrate()
  // 重置数据：确保干净的种子状态
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

/** 查询单行 */
async function queryOne(sql: string, params: any[] = []): Promise<any> {
  const [rows] = await pool.execute(sql, params)
  return (rows as any[])[0] ?? null
}

/** 查询表的所有列名 */
async function tableColumns(table: string): Promise<string[]> {
  const [cols] = await pool.execute(
    'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  )
  return (cols as any[]).map((c) => c.COLUMN_NAME)
}

/** 创建订单并迁移到固定 id，返回固定 id */
async function createQuoteWithId(id: string, customerName: string): Promise<string> {
  await pool.execute('DELETE FROM quotes WHERE id = ?', [id])
  const created = await db.quotes.create({
    customerName,
    productStyle: '1',
    status: 1,
  } as any)
  await pool.execute('UPDATE quotes SET id = ? WHERE id = ?', [id, created.id])
  return id
}

// ============================================================
// 表结构 & 版本
// ============================================================
describe('迁移 v36 - 表结构', () => {
  it('quotes 表含 batch_number 列（VARCHAR(30)、可空）', async () => {
    const names = await tableColumns('quotes')
    expect(names).toContain('batch_number')
    const col = await queryOne(
      'SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = ?',
      ['quotes', 'batch_number'],
    )
    expect(col.DATA_TYPE).toBe('varchar')
    expect(Number(col.CHARACTER_MAXIMUM_LENGTH)).toBe(30)
    expect(col.IS_NULLABLE).toBe('YES')
  })

  it('存在索引 idx_quotes_batch_number', async () => {
    const idx = await queryOne(
      'SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND INDEX_NAME = ?',
      ['quotes', 'idx_quotes_batch_number'],
    )
    expect(Number(idx.cnt)).toBeGreaterThan(0)
  })

  it('Schema 版本为最新版本', async () => {
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })
})

// ============================================================
// 批次读写一致性
// ============================================================
describe('迁移 v36 - 批次读写一致性', () => {
  it('assignBatch 批量设置：同批次订单批次号一致，未选中订单不受影响', async () => {
    const id1 = await createQuoteWithId('quote-batch-v36-a', '批次客户A')
    const id2 = await createQuoteWithId('quote-batch-v36-b', '批次客户B')
    const id3 = await createQuoteWithId('quote-batch-v36-c', '批次客户C')

    const count = await db.quotes.assignBatch([id1, id2], BATCH_A, 'tester')
    expect(count).toBe(2)

    const q1 = await db.quotes.getById(id1) as any
    const q2 = await db.quotes.getById(id2) as any
    const q3 = await db.quotes.getById(id3) as any
    expect(q1.batchNumber).toBe(BATCH_A)
    expect(q2.batchNumber).toBe(BATCH_A)
    expect(q3.batchNumber).toBeNull()
  })

  it('普通编辑（update）不改变批次号', async () => {
    await db.quotes.update('quote-batch-v36-a', { customerName: '批次客户A-改名' } as any)
    const q = await db.quotes.getById('quote-batch-v36-a') as any
    expect(q.customerName).toBe('批次客户A-改名')
    expect(q.batchNumber).toBe(BATCH_A)
  })

  it('复制订单（copy）不携带批次号', async () => {
    const copied = await db.quotes.copy('quote-batch-v36-a', 'tester') as any
    expect(copied).toBeTruthy()
    const loaded = await db.quotes.getById(copied.id) as any
    expect(loaded.batchNumber).toBeNull()
    await pool.execute('DELETE FROM quotes WHERE id = ?', [copied.id])
  })

  it('assignBatch 传 null 移出批次', async () => {
    const count = await db.quotes.assignBatch(['quote-batch-v36-a'], null, 'tester')
    expect(count).toBe(1)
    const q = await db.quotes.getById('quote-batch-v36-a') as any
    expect(q.batchNumber).toBeNull()
  })
})

// ============================================================
// 列表排序（批次号第一优先，修改时间第二优先）
// ============================================================
describe('迁移 v36 - 列表排序', () => {
  it('getAll 批次号 DESC 第一优先，无批次订单沉底按修改时间排', async () => {
    // 现状：a 无批次（刚被移出）、b=BATCH_A、c 无批次；将 b 改设为 BATCH_B（更新）
    await db.quotes.assignBatch(['quote-batch-v36-b'], BATCH_B, 'tester')

    const all = (await db.quotes.getAll()) as any[]
    const ids = ['quote-batch-v36-a', 'quote-batch-v36-b', 'quote-batch-v36-c']
    const mine = all.filter((q) => ids.includes(q.id))
    expect(mine).toHaveLength(3)

    // 唯一有批次的订单（BATCH_B）排最前
    expect(mine[0].id).toBe('quote-batch-v36-b')
    expect(mine[0].batchNumber).toBe(BATCH_B)
    // 无批次订单沉底
    const tailIds = mine.slice(1).map((q) => q.id).sort()
    expect(tailIds).toEqual(['quote-batch-v36-a', 'quote-batch-v36-c'])
    expect(mine.slice(1).every((q) => q.batchNumber == null)).toBe(true)
  })
})

// ============================================================
// 幂等性 & 回滚
// ============================================================
describe('迁移 v36 - 幂等性与回滚', () => {
  it('重复 migrate 幂等（列与索引仍在、版本不变）', async () => {
    await db.runner.migrate()
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const cols = await tableColumns('quotes')
    expect(cols).toContain('batch_number')
  })

  it('rollback(35) 后列与索引删除，再 migrate 恢复', async () => {
    await db.runner.rollback(35)
    expect(await db.getSchemaVersion()).toBe(35)
    const cols = await tableColumns('quotes')
    expect(cols).not.toContain('batch_number')
    const idx = await queryOne(
      'SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND INDEX_NAME = ?',
      ['quotes', 'idx_quotes_batch_number'],
    )
    expect(Number(idx.cnt)).toBe(0)

    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const cols2 = await tableColumns('quotes')
    expect(cols2).toContain('batch_number')
  })
})
