/**
 * 数据库迁移 v7 & 产品管理模块 单元测试
 *
 * 测试目标：
 *   - 迁移 v7 (add-product-code-and-default-styles)：products 表 code 字段、6 条默认款式、唯一索引、幂等性、回滚
 *   - 产品 CRUD 含 code 字段：create / update / getAll / getById
 *   - 默认款式删除保护：isDefaultStyleProduct 判断
 *   - getStyleLabel 动态查询：优先从 products 表按 code 或 id 查名称，兜底硬编码
 *   - quote_number 格式：客户名称-款式标签-时间戳（时间戳在末尾）
 *
 * 使用 SQLite 内存数据库 (:memory:) 保证测试隔离性。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type DbApi = typeof import('../api/db').db
let db: DbApi

beforeEach(async () => {
  process.env.DB_PATH = ':memory:'
  vi.resetModules()
  const mod = await import('../api/db')
  db = mod.db
})

describe('迁移 v7 - add-product-code-and-default-styles', () => {
  it('products 表包含 code 字段', () => {
    const columns = db.db.prepare('PRAGMA table_info(products)').all() as { name: string }[]
    const columnNames = columns.map(c => c.name)
    expect(columnNames).toContain('code')
  })

  it('插入 6 条默认款式产品', () => {
    const styles = db.db.prepare(
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

  it('code 唯一索引：插入重复 code 报错', () => {
    expect(() => {
      db.db.exec(
        `INSERT INTO products (id, name, code, sku, description, price, category, stock)
         VALUES ('dup-test', '重复款式', '1', '', '', 0, '款式', 0)`
      )
    }).toThrow()
  })

  it('空 code 允许多条（普通产品无款式编码）', () => {
    db.db.exec(
      `INSERT INTO products (id, name, code, sku, description, price, category, stock)
       VALUES ('prod-empty-1', '普通产品A', '', '', '', 0, '其他', 0)`
    )
    db.db.exec(
      `INSERT INTO products (id, name, code, sku, description, price, category, stock)
       VALUES ('prod-empty-2', '普通产品B', '', '', '', 0, '其他', 0)`
    )
    const count = db.db.prepare(`SELECT COUNT(*) as cnt FROM products WHERE code = '' AND id LIKE 'prod-empty-%'`).get() as { cnt: number }
    expect(count.cnt).toBe(2)
  })

  it('迁移幂等：重新执行 migrate 不重复插入', () => {
    // 已迁移到 v7，再次 migrate 应跳过（已是最新）
    db.runner.migrate()
    const styles = db.db.prepare(`SELECT id FROM products WHERE id LIKE 'style-%'`).all() as { id: string }[]
    expect(styles).toHaveLength(6)
  })

  it('Schema 版本为 7', () => {
    const row = db.db.prepare(`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`).get() as { version: number }
    expect(row.version).toBe(7)
  })
})

describe('迁移 v7 回滚（down）', () => {
  it('回滚到 v6 后 products 表无 code 字段且默认款式已删除', () => {
    db.runner.rollback(6)

    const columns = db.db.prepare('PRAGMA table_info(products)').all() as { name: string }[]
    expect(columns.map(c => c.name)).not.toContain('code')

    const styles = db.db.prepare(`SELECT id FROM products WHERE id LIKE 'style-%'`).all() as { id: string }[]
    expect(styles).toHaveLength(0)
  })
})

describe('产品 CRUD 含 code 字段', () => {
  it('create：创建含 code 的产品', () => {
    const product = db.products.create({
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

  it('create：code 默认为空字符串', () => {
    const product = db.products.create({
      name: '无code产品',
      sku: 'TEST-002',
      price: 0,
    })
    expect(product.code).toBe('')
  })

  it('update：更新 code 字段', () => {
    const product = db.products.create({
      name: '更新测试',
      sku: 'TEST-003',
      code: '',
      price: 0,
    })
    const updated = db.products.update(product.id, { code: '7' })
    expect(updated!.code).toBe('7')
  })

  it('getAll：返回所有产品含 code 字段', () => {
    db.products.create({ name: '产品A', sku: 'A', code: 'A1', price: 0 })
    const all = db.products.getAll()
    expect(all.length).toBeGreaterThan(6) // 6 默认 + 新增
    const productA = all.find(p => p.name === '产品A')
    expect(productA?.code).toBe('A1')
  })

  it('getById：返回含 code 的产品', () => {
    const created = db.products.create({ name: '查询产品', sku: 'Q1', code: 'Q', price: 0 })
    const found = db.products.getById(created.id)
    expect(found?.code).toBe('Q')
  })

  it('delete：普通产品可删除', () => {
    const created = db.products.create({ name: '待删除', sku: 'DEL', code: '', price: 0 })
    const result = db.products.delete(created.id)
    expect(result).toBe(true)
    expect(db.products.getById(created.id)).toBeNull()
  })
})

describe('默认款式删除保护（isDefaultStyleProduct）', () => {
  it('style-1 到 style-6 被识别为默认款式', async () => {
    const { isDefaultStyleProduct } = await import('../api/db')
    for (let i = 1; i <= 6; i++) {
      expect(isDefaultStyleProduct(`style-${i}`)).toBe(true)
    }
  })

  it('非默认款式不被识别', async () => {
    const { isDefaultStyleProduct } = await import('../api/db')
    expect(isDefaultStyleProduct('prod-12345')).toBe(false)
    expect(isDefaultStyleProduct('')).toBe(false)
  })
})

describe('getStyleLabel 动态查询产品表（通过 quote_number 验证）', () => {
  it('按 code 查询：订单号中使用产品名称', () => {
    // 迁移后 products 表有 code='1' → 无底无侧普通袋
    const quote = db.quotes.create({ customerName: '动态查询客户', productStyle: '1' })
    expect(quote.quote_number).toContain('无底无侧普通袋')
  })

  it('产品改名后新订单号使用新名称', () => {
    db.products.update('style-3', { name: '改名后的款式3' })
    const quote = db.quotes.create({ customerName: '改名测试客户', productStyle: '3' })
    expect(quote.quote_number).toContain('改名后的款式3')
    expect(quote.quote_number).not.toContain('有底有侧普通袋')
  })

  it('硬编码兜底：code 不在 products 表时仍可生成订单号', () => {
    // code='99' 不在 products 表中，硬编码也没有 → quote_number 中包含 '99'
    const quote = db.quotes.create({ customerName: '兜底测试', productStyle: '99' })
    expect(quote.quote_number).toContain('99')
  })
})

describe('quote_number 格式（时间戳在末尾）', () => {
  it('create：订单号格式为 客户名称-款式标签-时间戳', () => {
    const quote = db.quotes.create({
      customerName: '格式测试客户',
      productStyle: '1',
    })
    // 格式：格式测试客户-无底无侧普通袋-14位时间戳
    expect(quote.quote_number).toMatch(/^格式测试客户-无底无侧普通袋-\d{14}$/)
  })

  it('update：修改客户名称时保留原时间戳，格式正确', () => {
    const quote = db.quotes.create({
      customerName: '原客户名',
      productStyle: '2',
    })
    const originalTimestamp = quote.quote_number.match(/\d{14}/)?.[0]

    const updated = db.quotes.update(quote.id, { customerName: '新客户名' })
    const newTimestamp = updated!.quote_number.match(/\d{14}/)?.[0]

    expect(newTimestamp).toBe(originalTimestamp)
    expect(updated!.quote_number).toMatch(/^新客户名-有底无侧普通袋-\d{14}$/)
  })

  it('update：修改款式时保留原时间戳，款式标签更新，时间戳在末尾', () => {
    const quote = db.quotes.create({
      customerName: '款式修改测试',
      productStyle: '1',
    })
    const originalTimestamp = quote.quote_number.match(/\d{14}/)?.[0]

    const updated = db.quotes.update(quote.id, { productStyle: '4' })
    const newTimestamp = updated!.quote_number.match(/\d{14}/)?.[0]

    expect(newTimestamp).toBe(originalTimestamp)
    expect(updated!.quote_number).toContain('手提连底普通拼接袋')
    // 时间戳在末尾
    expect(updated!.quote_number.endsWith(originalTimestamp!)).toBe(true)
  })
})
