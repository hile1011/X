/**
 * 数据库迁移 v37 - quote-customer-fk 单元测试
 *
 * 订单表客户关联规范化：
 *   quotes.customer_id 外键关联 customers.id（ON DELETE SET NULL / ON UPDATE CASCADE），
 *   删除冗余 customerName 列（客户名称由 JOIN customers.name 获取），配套索引。
 *
 * 测试目标：
 *   - 表结构：quotes 无 customerName 列、customer_id 可 NULL、索引与外键存在
 *   - 存量迁移：按名称回填 customer_id、订单独有名称自动建客户、脏 customer_id 清洗
 *   - CRUD 关联规则：create/update 按名称解析（不存在自动建客户）、局部更新不清关联、copy 继承关联
 *   - 读路径：getAll/getById 返回 JOIN 别名 customerName
 *   - 删除语义：删除客户后订单 customer_id 置 NULL（SET NULL）、名称显示空串
 *   - 审计触发器：v37 版不含 customerName 追踪、customer_id 变更被追踪
 *   - 幂等性：重复 migrate 不报错
 *   - down 回滚：rollback(36) 恢复 customerName 列与名称数据，再 migrate 恢复
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

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

/** 清理测试订单与客户 */
async function cleanup(ids: string[] = [], customerIds: string[] = []) {
  for (const id of ids) await pool.execute('DELETE FROM quotes WHERE id = ?', [id])
  for (const cid of customerIds) await pool.execute('DELETE FROM customers WHERE id = ?', [cid])
}

// ============================================================
// 表结构 & 版本
// ============================================================
describe('迁移 v37 - 表结构', () => {
  it('quotes 表已删除 customerName 列', async () => {
    const names = await tableColumns('quotes')
    expect(names).not.toContain('customerName')
  })

  it('customer_id 列可 NULL（支持外键 SET NULL 语义）', async () => {
    const col = await queryOne(
      'SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = ?',
      ['quotes', 'customer_id'],
    )
    expect(col.DATA_TYPE).toBe('varchar')
    expect(col.IS_NULLABLE).toBe('YES')
  })

  it('存在索引 idx_quotes_customer_id，原 customerName 索引已删除', async () => {
    const idx = await queryOne(
      'SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND INDEX_NAME = ?',
      ['quotes', 'idx_quotes_customer_id'],
    )
    expect(Number(idx.cnt)).toBeGreaterThan(0)
    const oldIdx = await queryOne(
      'SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE table_schema = DATABASE() AND table_name = ? AND INDEX_NAME = ?',
      ['quotes', 'idx_quotes_customerName'],
    )
    expect(Number(oldIdx.cnt)).toBe(0)
  })

  it('外键 fk_quotes_customer 存在且为 ON DELETE SET NULL', async () => {
    const fk = await queryOne(
      'SELECT DELETE_RULE, UPDATE_RULE, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?',
      ['quotes', 'fk_quotes_customer'],
    )
    expect(fk).toBeTruthy()
    expect(fk.DELETE_RULE).toBe('SET NULL')
    expect(fk.UPDATE_RULE).toBe('CASCADE')
    expect(fk.REFERENCED_TABLE_NAME).toBe('customers')
  })

  it('Schema 版本为最新版本（37）', async () => {
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    expect(CURRENT_SCHEMA_VERSION).toBe(37)
  })
})

// ============================================================
// CRUD 客户关联规则
// ============================================================
describe('迁移 v37 - CRUD 客户关联', () => {
  it('create 按名称解析：客户已存在时关联既有客户', async () => {
    const [cInfo] = await pool.execute(
      'INSERT INTO customers (id, name) VALUES (?, ?)',
      ['cust-v37-existing', 'v37既有客户'],
    )
    expect(cInfo).toBeTruthy()

    const created = await db.quotes.create({ customerName: 'v37既有客户', productStyle: '1' } as any)
    const row = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(row.customer_id).toBe('cust-v37-existing')
    // 返回体含 customerName（解析结果）
    expect((created as any).customerName).toBe('v37既有客户')

    await cleanup([created.id], ['cust-v37-existing'])
  })

  it('create 按名称解析：客户不存在时自动建客户', async () => {
    const created = await db.quotes.create({ customerName: 'v37全新客户', productStyle: '1' } as any)
    const row = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(row.customer_id).toBeTruthy()

    const customer = await queryOne('SELECT id, name FROM customers WHERE id = ?', [row.customer_id])
    expect(customer.name).toBe('v37全新客户')

    await cleanup([created.id], [row.customer_id])
  })

  it('create 未提供客户时 customer_id 为 NULL', async () => {
    const created = await db.quotes.create({ productStyle: '1' } as any)
    const row = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(row.customer_id).toBeNull()

    await cleanup([created.id])
  })

  it('update 改名：解析到新客户（不存在自动建）', async () => {
    const created = await db.quotes.create({ customerName: 'v37改名前客户', productStyle: '1' } as any)
    const before = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])

    await db.quotes.update(created.id, { customerName: 'v37改名后客户' } as any)
    const after = await queryOne('SELECT customer_id, customer_id FROM quotes WHERE id = ?', [created.id])
    expect(after.customer_id).toBeTruthy()
    expect(after.customer_id).not.toBe(before.customer_id)

    // 返回体含解析后的名称
    const loaded = await db.quotes.getById(created.id) as any
    expect(loaded.customerName).toBe('v37改名后客户')

    await cleanup([created.id], [before.customer_id, after.customer_id])
  })

  it('update 局部更新（仅改状态）不清空 customer_id', async () => {
    const created = await db.quotes.create({ customerName: 'v37局部更新客户', productStyle: '1' } as any)
    const before = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])

    await db.quotes.update(created.id, { status: 2 } as any)
    const after = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(after.customer_id).toBe(before.customer_id)

    await cleanup([created.id], [before.customer_id])
  })

  it('copy 继承原订单的客户关联', async () => {
    const created = await db.quotes.create({ customerName: 'v37复制源客户', productStyle: '1' } as any)
    const source = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])

    const copied = await db.quotes.copy(created.id, 'tester')
    const copyRow = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [copied!.id])
    expect(copyRow.customer_id).toBe(source.customer_id)
    expect((copied as any).customerName).toBe('v37复制源客户')

    await cleanup([created.id, copied!.id], [source.customer_id])
  })

  it('getAll/getById 返回 JOIN 别名 customerName，未关联客户显示空串', async () => {
    const withCustomer = await db.quotes.create({ customerName: 'v37列表客户', productStyle: '1' } as any)
    const withoutCustomer = await db.quotes.create({ productStyle: '1' } as any)

    const all = (await db.quotes.getAll()) as any[]
    const rowA = all.find((q) => q.id === withCustomer.id)
    const rowB = all.find((q) => q.id === withoutCustomer.id)
    expect(rowA.customerName).toBe('v37列表客户')
    expect(rowB.customerName).toBe('')

    const detail = await db.quotes.getById(withoutCustomer.id) as any
    expect(detail.customerName).toBe('')

    const custRow = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [withCustomer.id])
    await cleanup([withCustomer.id, withoutCustomer.id], custRow.customer_id ? [custRow.customer_id] : [])
  })
})

// ============================================================
// 删除语义（ON DELETE SET NULL）
// ============================================================
describe('迁移 v37 - 外键删除语义', () => {
  it('删除客户后订单 customer_id 置 NULL，名称显示空串（不阻止删除）', async () => {
    const [info] = await pool.execute(
      'INSERT INTO customers (id, name) VALUES (?, ?)',
      ['cust-v37-del', 'v37待删客户'],
    )
    expect(info).toBeTruthy()
    const created = await db.quotes.create({ customerName: 'v37待删客户', productStyle: '1' } as any)

    // 直接删除客户（外键 SET NULL，订单保留）
    await pool.execute('DELETE FROM customers WHERE id = ?', ['cust-v37-del'])
    const row = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(row.customer_id).toBeNull()

    const loaded = await db.quotes.getById(created.id) as any
    expect(loaded.customerName).toBe('')

    await cleanup([created.id])
  })
})

// ============================================================
// 审计触发器（v37 版无 customerName 追踪）
// ============================================================
describe('迁移 v37 - 审计触发器', () => {
  it('审计快照不含 customerName，customer_id 变更被追踪', async () => {
    const created = await db.quotes.create({ customerName: 'v37审计客户', productStyle: '1' } as any)
    await db.quotes.update(created.id, { customerName: 'v37审计新客户', status: 2 } as any)

    const [rows] = await pool.execute(
      'SELECT action, new_values, changed_fields FROM quote_history WHERE quote_id = ? ORDER BY id ASC',
      [created.id],
    )
    const history = rows as any[]
    expect(history).toHaveLength(2)

    const insertValues = JSON.parse(history[0].new_values)
    expect(insertValues).not.toHaveProperty('customerName')
    expect(insertValues).toHaveProperty('customer_id')

    const changed = (history[1].changed_fields || '').split(',').filter(Boolean)
    expect(changed).toContain('customer_id')
    expect(changed).toContain('status')

    const custId = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    await cleanup([created.id], [insertValues.customer_id, custId.customer_id].filter(Boolean))
  })
})

// ============================================================
// 存量数据迁移 & 幂等 & 回滚
// ============================================================
describe('迁移 v37 - 存量迁移/幂等/回滚', () => {
  it('存量迁移：按名称回填 customer_id、独有名称自动建客户、脏 customer_id 清洗', async () => {
    // 回滚到 v36（恢复 customerName 列）
    await db.runner.rollback(36)
    const cols36 = await tableColumns('quotes')
    expect(cols36).toContain('customerName')

    // 造存量数据：既有客户订单 / 全新名称订单 / 脏 customer_id 订单 / 无客户订单
    await pool.execute('DELETE FROM quotes WHERE id IN (?, ?, ?, ?)',
      ['quote-v37-backfill', 'quote-v37-newcust', 'quote-v37-dirty', 'quote-v37-nocust'])
    await pool.execute(
      'INSERT INTO customers (id, name) VALUES (?, ?)',
      ['cust-v37-shared', 'v37存量共享客户'],
    )
    await pool.execute(
      `INSERT INTO quotes (id, quote_number, customer_id, customerName, productStyle, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quote-v37-backfill', '9000000000000001', '', 'v37存量共享客户', '1', 1],
    )
    await pool.execute(
      `INSERT INTO quotes (id, quote_number, customer_id, customerName, productStyle, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quote-v37-newcust', '9000000000000002', '', 'v37迁移独有客户', '1', 1],
    )
    await pool.execute(
      `INSERT INTO quotes (id, quote_number, customer_id, customerName, productStyle, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quote-v37-dirty', '9000000000000003', 'cust-v37-nonexistent', 'v37脏引用订单', '1', 1],
    )
    await pool.execute(
      `INSERT INTO quotes (id, quote_number, customer_id, customerName, productStyle, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quote-v37-nocust', '9000000000000004', '', '', '1', 1],
    )

    // 重新迁移到 v37
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const cols37 = await tableColumns('quotes')
    expect(cols37).not.toContain('customerName')

    // 既有客户：回填到 cust-v37-shared
    const backfill = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', ['quote-v37-backfill'])
    expect(backfill.customer_id).toBe('cust-v37-shared')

    // 独有名称：自动建客户并回填
    const newCustQuote = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', ['quote-v37-newcust'])
    expect(newCustQuote.customer_id).toBeTruthy()
    const newCust = await queryOne('SELECT name FROM customers WHERE id = ?', [newCustQuote.customer_id])
    expect(newCust.name).toBe('v37迁移独有客户')

    // 脏引用：原 customer_id 清洗后按名称重新关联（自动建 'v37脏引用订单' 客户，数据不丢失）
    const dirty = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', ['quote-v37-dirty'])
    expect(dirty.customer_id).toBeTruthy()
    const dirtyCust = await queryOne('SELECT name FROM customers WHERE id = ?', [dirty.customer_id])
    expect(dirtyCust.name).toBe('v37脏引用订单')

    // 无客户订单：保持 NULL
    const nocust = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', ['quote-v37-nocust'])
    expect(nocust.customer_id).toBeNull()

    // 清理
    await cleanup(
      ['quote-v37-backfill', 'quote-v37-newcust', 'quote-v37-dirty', 'quote-v37-nocust'],
      ['cust-v37-shared', newCustQuote.customer_id, dirty.customer_id],
    )
  })

  it('重复 migrate 幂等（结构不变、版本不变）', async () => {
    await db.runner.migrate()
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const cols = await tableColumns('quotes')
    expect(cols).not.toContain('customerName')
  })

  it('rollback(36) 恢复 customerName 列与名称数据，再 migrate 恢复', async () => {
    // 造一条带客户关联的订单
    const created = await db.quotes.create({ customerName: 'v37回滚测试客户', productStyle: '1' } as any)
    const custRow = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(custRow.customer_id).toBeTruthy()

    await db.runner.rollback(36)
    expect(await db.getSchemaVersion()).toBe(36)
    const cols36 = await tableColumns('quotes')
    expect(cols36).toContain('customerName')
    // 名称由 customer_id JOIN 回填
    const row36 = await queryOne('SELECT customerName FROM quotes WHERE id = ?', [created.id])
    expect(row36.customerName).toBe('v37回滚测试客户')

    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const cols37 = await tableColumns('quotes')
    expect(cols37).not.toContain('customerName')
    // 重新迁移后关联恢复
    const row37 = await queryOne('SELECT customer_id FROM quotes WHERE id = ?', [created.id])
    expect(row37.customer_id).toBe(custRow.customer_id)

    await cleanup([created.id], [custRow.customer_id])
  })
})
