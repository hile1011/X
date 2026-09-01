/**
 * 数据库迁移 v7 & 产品管理模块 单元测试
 *
 * 测试目标：
 *   - 迁移 v7 (add-product-code-and-default-styles)：products 表 code 字段、6 条默认款式、唯一索引、幂等性、回滚
 *   - 产品 CRUD 含 code 字段：create / update / getAll / getById
 *   - 默认款式删除保护：isDefaultStyleProduct 判断
 *   - getStyleLabel 动态查询：优先从 products 表按 code 或 id 查名称，兜底硬编码
 *   - quote_number 格式：客户名称-款式标签-时间戳（时间戳在末尾）
 *   - 迁移 v9 (add-all-formulas)：从老数据计算 allFormulas 的初始化逻辑
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至 v13。
 * 回滚/重新迁移测试放在文件末尾，afterAll 中恢复 schema 到最新版本。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { db, isDefaultStyleProduct } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

/**
 * 查询 MySQL 表的列名列表（替代 SQLite 的 PRAGMA table_info）
 */
async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await db.db.prepare(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION'
  ).all(tableName)
  return rows.map((r: any) => r.COLUMN_NAME as string)
}

/**
 * 执行原始 SQL（用于测试中的直接数据操作）
 */
async function execSql(sql: string): Promise<void> {
  await pool.query(sql)
}

/**
 * 确保 schema 恢复到最新版本：如果版本低于 CURRENT_SCHEMA_VERSION，直接 migrate 补齐缺失的迁移。
 * 不使用 reset（会 drop 所有表），避免 v1 down 迁移删除 schema_migrations 表后
 * rollback 代码无法 DELETE 记录的问题。
 */
async function ensureLatestSchema(): Promise<void> {
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
}

// 文件级 afterAll：确保所有测试结束后 schema 恢复到最新版本，不影响后续测试文件
afterAll(async () => {
  await ensureLatestSchema()
})

// ============================================================
// Schema 结构 & 默认数据测试（不修改 schema）
// ============================================================
describe('迁移 v7 - add-product-code-and-default-styles', () => {
  it('products 表包含 code 字段', async () => {
    const columns = await getTableColumns('products')
    expect(columns).toContain('code')
  })

  it('插入 6 条默认款式产品', async () => {
    const styles = await db.db.prepare(
      `SELECT id, name, code, sku, category FROM products WHERE id LIKE 'style-%' ORDER BY code`
    ).all() as { id: string; name: string; code: string; sku: string; category: string }[]
    expect(styles).toHaveLength(6)

    const expected = [
      { name: '无底无侧普通袋', code: '1' },
      { name: '有底无侧普通袋', code: '2' },
      { name: '有底有侧普通袋', code: '3' },
      { name: '手提连底普通拼接袋', code: '4' },
      { name: '手提连底高级拼接袋', code: '5' },
      { name: '手提无连底拼接袋', code: '6' },
    ]
    expected.forEach((exp, i) => {
      expect(styles[i].name).toBe(exp.name)
      expect(styles[i].code).toBe(exp.code)
      expect(styles[i].sku).toBe(`STYLE-${exp.code}`)
      expect(styles[i].category).toBe('款式')
    })
  })

  it('code 唯一索引：插入重复 code 报错', async () => {
    await expect(
      execSql(
        `INSERT INTO products (id, name, code, sku, description, price, category, stock)
         VALUES ('dup-test', '重复款式', '1', '', '', 0, '款式', 0)`
      )
    ).rejects.toThrow()
  })

  it('空 code 允许多条（普通产品无款式编码）', async () => {
    await execSql(
      `INSERT INTO products (id, name, code, sku, description, price, category, stock)
       VALUES ('prod-empty-1', '普通产品A', '', '', '', 0, '其他', 0)`
    )
    await execSql(
      `INSERT INTO products (id, name, code, sku, description, price, category, stock)
       VALUES ('prod-empty-2', '普通产品B', '', '', '', 0, '其他', 0)`
    )
    const count = await db.db.prepare(`SELECT COUNT(*) as cnt FROM products WHERE code = '' AND id LIKE 'prod-empty-%'`).get() as { cnt: number }
    expect(count.cnt).toBe(2)
  })

  it('迁移幂等：重新执行 migrate 不重复插入', async () => {
    // 已迁移到 v10，再次 migrate 应跳过（已是最新）
    await db.runner.migrate()
    const styles = await db.db.prepare(`SELECT id FROM products WHERE id LIKE 'style-%'`).all() as { id: string }[]
    expect(styles).toHaveLength(6)
  })

  it('Schema 版本为最新版本', async () => {
    const version = await db.getSchemaVersion()
    expect(version).toBe(CURRENT_SCHEMA_VERSION)
  })
})


// ============================================================
// 产品 CRUD 测试（每个测试前重置数据）
// ============================================================
describe('产品 CRUD 含 code 字段', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('create：创建含 code 的产品', async () => {
    const product = await db.products.create({
      name: '测试款式产品',
      sku: 'TEST-001',
      code: '99',
      price: 15.5,
      category: '测试',
      stock: 100,
    })
    expect(product.code).toBe('99')
    expect(product.name).toBe('测试款式产品')
  })

  it('create：code 默认为空字符串', async () => {
    const product = await db.products.create({
      name: '无code产品',
      sku: 'TEST-002',
      price: 0,
    })
    expect(product.code).toBe('')
  })

  it('update：更新 code 字段', async () => {
    const product = await db.products.create({
      name: '更新测试',
      sku: 'TEST-003',
      code: '',
      price: 0,
    })
    const updated = await db.products.update(product.id, { code: '7' })
    expect(updated!.code).toBe('7')
  })

  it('getAll：返回所有产品含 code 字段', async () => {
    await db.products.create({ name: '产品A', sku: 'A', code: 'A1', price: 0 })
    const all = await db.products.getAll()
    expect(all.length).toBeGreaterThan(6) // 6 默认 + 新增
    const productA = all.find(p => p.name === '产品A')
    expect(productA?.code).toBe('A1')
  })

  it('getById：返回含 code 的产品', async () => {
    const created = await db.products.create({ name: '查询产品', sku: 'Q1', code: 'Q', price: 0 })
    const found = await db.products.getById(created.id)
    expect(found?.code).toBe('Q')
  })

  it('delete：普通产品可删除', async () => {
    const created = await db.products.create({ name: '待删除', sku: 'DEL', code: '', price: 0 })
    const result = await db.products.delete(created.id)
    expect(result).toBe(true)
    expect(await db.products.getById(created.id)).toBeNull()
  })
})


// ============================================================
// 默认款式删除保护（纯函数，无需数据库）
// ============================================================
describe('默认款式删除保护（isDefaultStyleProduct）', () => {
  it('style-1 到 style-6 被识别为默认款式', () => {
    for (let i = 1; i <= 6; i++) {
      expect(isDefaultStyleProduct(`style-${i}`)).toBe(true)
    }
  })

  it('非默认款式不被识别', () => {
    expect(isDefaultStyleProduct('prod-12345')).toBe(false)
    expect(isDefaultStyleProduct('')).toBe(false)
  })
})


// ============================================================
// quote_number 订单号测试
// （订单号已改为16位随机数字，不再编入客户名称/款式信息；
//   getStyleLabel 动态查询逻辑已随订单号格式调整移除）
// ============================================================
describe('quote_number 订单号（16位随机数字）', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('create：订单号为16位随机数字', async () => {
    const quote = await db.quotes.create({
      customerName: '格式测试客户',
      productStyle: '1',
    })
    expect(quote.quote_number).toMatch(/^\d{16}$/)
  })

  it('update：修改客户名称/款式时订单号保持不变', async () => {
    const quote = await db.quotes.create({
      customerName: '原客户名',
      productStyle: '2',
    })

    const updated = await db.quotes.update(quote.id, { customerName: '新客户名', productStyle: '4' })
    expect(updated!.quote_number).toBe(quote.quote_number)
  })
})


// ============================================================
// 迁移 v7 回滚测试（修改 schema，afterAll 中恢复）
// ============================================================
describe('迁移 v7 回滚（down）', () => {
  it('回滚到 v6 后 products 表无 code 字段且默认款式已删除', async () => {
    await db.runner.rollback(6)

    const columns = await getTableColumns('products')
    expect(columns).not.toContain('code')

    const styles = await db.db.prepare(`SELECT id FROM products WHERE id LIKE 'style-%'`).all() as { id: string }[]
    expect(styles).toHaveLength(0)
  })
})


// ============================================================
// 迁移 v9 老数据初始化测试（回滚后插入老数据，重新迁移验证）
// ============================================================
describe('迁移 v9 - add-all-formulas 老数据初始化', () => {
  // beforeAll 确保每个 v9 测试开始前 schema 在 v10（前一个回滚测试可能修改了 schema）
  beforeEach(async () => {
    await ensureLatestSchema()
  })

  it('v9 迁移从老数据计算 allFormulas（款式1：模板 - removed + modified）', async () => {
    // 1. 回滚到 v8（移除 allFormulas 和 productionStepStatus 列）
    await db.runner.rollback(8)
    const colsBefore = await getTableColumns('quotes')
    expect(colsBefore).not.toContain('allFormulas')

    // 2. 插入老格式数据：productStyle=1, removed=[K9], modified={J8: =SUM(J6:J7)*1.2}
    await db.db.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, productStyle,
      removedFormulaAddresses, modifiedFormulas, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'quote-v9-test-1', '', '', '测试-v9-1', '迁移测试客户', '1',
      JSON.stringify(['K9']), JSON.stringify({ J8: '=SUM(J6:J7)*1.2' }), 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'
    )

    // 3. 重新执行迁移到最新版本（v9 会添加 allFormulas 列并初始化数据）
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // 4. 验证 allFormulas 已被计算并写入
    const row = await db.db.prepare('SELECT allFormulas FROM quotes WHERE id = ?').get('quote-v9-test-1') as { allFormulas: string }
    const allFormulas = JSON.parse(row.allFormulas)
    // J8 应为 modified 中的值（覆盖模板原值 =SUM(J6:J7)）
    expect(allFormulas.J8).toBe('=SUM(J6:J7)*1.2')
    // K9 应被排除（在 removed 中）
    expect(allFormulas.K9).toBeUndefined()
    // 其他模板公式应保留（如 J9 = =J8+I9）
    expect(allFormulas.J9).toBe('=J8+I9')
    expect(allFormulas.J10).toBe('=(J9-J8)*B2')
  })

  it('v9 迁移处理无 removed/modified 的老数据（纯模板公式）', async () => {
    await db.runner.rollback(8)
    // 插入无 removed/modified 的老数据
    await db.db.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, productStyle,
      removedFormulaAddresses, modifiedFormulas, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'quote-v9-test-2', '', '', '测试-v9-2', '迁移测试客户2', '2',
      '[]', '{}', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'
    )
    await db.runner.migrate()
    const row = await db.db.prepare('SELECT allFormulas FROM quotes WHERE id = ?').get('quote-v9-test-2') as { allFormulas: string }
    const allFormulas = JSON.parse(row.allFormulas)
    // 应包含款式2的所有模板公式
    expect(Object.keys(allFormulas).length).toBeGreaterThan(10)
    expect(allFormulas.J10).toBe('=SUM(J7:J9)')
    expect(allFormulas.K11).toBe('=J11*1.1')
  })

  it('v9 迁移处理未知 productStyle（默认使用款式1模板）', async () => {
    await db.runner.rollback(8)
    // 插入 productStyle 为非 1-6 的值（如自定义产品 id）
    await db.db.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, productStyle,
      removedFormulaAddresses, modifiedFormulas, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'quote-v9-test-3', '', '', '测试-v9-3', '迁移测试客户3', 'prod-custom-xyz',
      '[]', '{}', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'
    )
    await db.runner.migrate()
    const row = await db.db.prepare('SELECT allFormulas FROM quotes WHERE id = ?').get('quote-v9-test-3') as { allFormulas: string }
    const allFormulas = JSON.parse(row.allFormulas)
    // 应使用款式1模板的公式
    expect(allFormulas.J8).toBe('=SUM(J6:J7)')
    expect(allFormulas.J9).toBe('=J8+I9')
  })

  it('v9 迁移后 allFormulas 为有效 JSON 对象', async () => {
    await db.runner.rollback(8)
    await db.db.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, productStyle,
      removedFormulaAddresses, modifiedFormulas, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'quote-v9-test-4', '', '', '测试-v9-4', '迁移测试客户4', '3',
      JSON.stringify(['J10']), JSON.stringify({ J11: '=J10+I11+0.5' }), 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00'
    )
    await db.runner.migrate()
    const row = await db.db.prepare('SELECT allFormulas FROM quotes WHERE id = ?').get('quote-v9-test-4') as { allFormulas: string }
    const allFormulas = JSON.parse(row.allFormulas)
    expect(typeof allFormulas).toBe('object')
    expect(Array.isArray(allFormulas)).toBe(false)
    // J10 被 removed 排除
    expect(allFormulas.J10).toBeUndefined()
    // J11 被 modified 覆盖
    expect(allFormulas.J11).toBe('=J10+I11+0.5')
    // K11 保留模板原值（款式3模板中 K11 = =J11*1.1）
    expect(allFormulas.K11).toBe('=J11*1.1')
  })
})
