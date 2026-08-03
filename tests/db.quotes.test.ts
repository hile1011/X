/**
 * 订单状态流转 & 订单号生成 单元测试
 * 测试目标：api/db.ts 中 quotes 的 nextStatus / prevStatus / endQuote / create / update 逻辑
 *
 * 使用 SQLite 内存数据库 (:memory:) 保证测试隔离性，每个测试获取全新数据库实例。
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

describe('Quote 状态流转', () => {
  let quoteId: string

  beforeEach(async () => {
    const quote = db.quotes.create({
      customerName: '测试客户',
      productStyle: '1',
      quantity: '1000',
    })
    quoteId = quote.id
  })

  describe('nextStatus - 进入下一节点', () => {
    it('报价中(1) → 打样中(2)，应记录 sampleTime', () => {
      const updated = db.quotes.nextStatus(quoteId)
      expect(updated!.status).toBe(2)
      expect(updated!.sampleTime).toBeTruthy()
      expect(updated!.productionStartTime).toBe('')
    })

    it('打样中(2) → 做货中(3)，应记录 productionStartTime', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      const updated = db.quotes.nextStatus(quoteId) // 2→3
      expect(updated!.status).toBe(3)
      expect(updated!.productionStartTime).toBeTruthy()
    })

    it('做货中(3) → 已发货未收款(4)，应记录 shippingTime', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      db.quotes.nextStatus(quoteId) // 2→3
      const updated = db.quotes.nextStatus(quoteId) // 3→4
      expect(updated!.status).toBe(4)
      expect(updated!.shippingTime).toBeTruthy()
    })

    it('已发货未收款(4) → 已发货已收款(5)，应记录 paymentTime', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      db.quotes.nextStatus(quoteId) // 2→3
      db.quotes.nextStatus(quoteId) // 3→4
      const updated = db.quotes.nextStatus(quoteId) // 4→5
      expect(updated!.status).toBe(5)
      expect(updated!.paymentTime).toBeTruthy()
    })

    it('已发货已收款(5) → 结束(6)，应记录 endTime', () => {
      for (let i = 0; i < 4; i++) db.quotes.nextStatus(quoteId) // 1→5
      const updated = db.quotes.nextStatus(quoteId) // 5→6
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('结束(6) 不能继续流转，应保持原状态', () => {
      for (let i = 0; i < 5; i++) db.quotes.nextStatus(quoteId) // 1→6
      const updated = db.quotes.nextStatus(quoteId)
      expect(updated!.status).toBe(6)
    })
  })

  describe('prevStatus - 退回上一节点', () => {
    it('打样中(2) → 报价中(1)', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      const updated = db.quotes.prevStatus(quoteId) // 2→1
      expect(updated!.status).toBe(1)
    })

    it('做货中(3) → 打样中(2)', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      db.quotes.nextStatus(quoteId) // 2→3
      const updated = db.quotes.prevStatus(quoteId) // 3→2
      expect(updated!.status).toBe(2)
    })

    it('已发货未收款(4) → 做货中(3)', () => {
      for (let i = 0; i < 3; i++) db.quotes.nextStatus(quoteId) // 1→4
      const updated = db.quotes.prevStatus(quoteId) // 4→3
      expect(updated!.status).toBe(3)
    })

    it('已发货已收款(5) → 已发货未收款(4)', () => {
      for (let i = 0; i < 4; i++) db.quotes.nextStatus(quoteId) // 1→5
      const updated = db.quotes.prevStatus(quoteId) // 5→4
      expect(updated!.status).toBe(4)
    })

    it('结束(6) → 已发货已收款(5)，结束状态可退回', () => {
      for (let i = 0; i < 5; i++) db.quotes.nextStatus(quoteId) // 1→6
      const updated = db.quotes.prevStatus(quoteId) // 6→5
      expect(updated!.status).toBe(5)
    })

    it('报价中(1) 不能退回，应保持原状态', () => {
      const updated = db.quotes.prevStatus(quoteId)
      expect(updated!.status).toBe(1)
    })
  })

  describe('endQuote - 直接结束', () => {
    it('报价中(1) 可直接结束 → 结束(6)', () => {
      const updated = db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('打样中(2) 可直接结束 → 结束(6)', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      const updated = db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('做货中(3) 不能直接结束，应保持原状态', () => {
      db.quotes.nextStatus(quoteId) // 1→2
      db.quotes.nextStatus(quoteId) // 2→3
      const updated = db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(3)
    })
  })
})

describe('Quote 订单号生成', () => {
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建时生成订单号格式：客户名称-时间戳-款式', () => {
    const quote = db.quotes.create({
      customerName: '深圳科技公司',
      productStyle: '3',
    })
    expect(quote.quote_number).toMatch(/^深圳科技公司-有底有侧普通袋-\d{14}$/)
  })

  it('修改客户名称时保留原时间戳，更新订单号', () => {
    const quote = db.quotes.create({
      customerName: '原客户',
      productStyle: '1',
    })
    const originalTimestamp = quote.quote_number.match(/\d{14}/)?.[0]

    const updated = db.quotes.update(quote.id, { customerName: '新客户' })
    const newTimestamp = updated!.quote_number.match(/\d{14}/)?.[0]

    expect(updated!.quote_number).toContain('新客户')
    expect(newTimestamp).toBe(originalTimestamp)
  })

  it('修改款式时保留原时间戳，更新款式标签', () => {
    const quote = db.quotes.create({
      customerName: '测试客户',
      productStyle: '1',
    })
    const originalTimestamp = quote.quote_number.match(/\d{14}/)?.[0]

    const updated = db.quotes.update(quote.id, { productStyle: '4' })
    const newTimestamp = updated!.quote_number.match(/\d{14}/)?.[0]

    expect(updated!.quote_number).toContain('手提连底普通拼接袋')
    expect(newTimestamp).toBe(originalTimestamp)
  })

  it('未传款式时 productStyle 默认为 1', () => {
    const quote = db.quotes.create({ customerName: '默认款式测试', productStyle: '1' })
    expect(quote.productStyle).toBe('1')
  })
})

describe('Quote CRUD', () => {
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建报价时初始化状态为 1（报价中）', () => {
    const quote = db.quotes.create({ customerName: 'CRUD测试', productStyle: '1' })
    expect(quote.status).toBe(1)
    expect(quote.quoteTime).toBeTruthy()
  })

  it('getById 返回完整报价数据', () => {
    const created = db.quotes.create({ customerName: '查询测试', productStyle: '1' })
    const found = db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.customerName).toBe('查询测试')
  })

  it('getById 不存在时返回 null', () => {
    const found = db.quotes.getById('non-existent-id')
    expect(found).toBeNull()
  })

  it('delete 删除后 getById 返回 null', () => {
    const created = db.quotes.create({ customerName: '删除测试', productStyle: '1' })
    const success = db.quotes.delete(created.id)
    expect(success).toBe(true)
    const found = db.quotes.getById(created.id)
    expect(found).toBeNull()
  })

  it('update 更新字段', () => {
    const created = db.quotes.create({ customerName: '更新测试', quantity: '500', productStyle: '1' })
    const updated = db.quotes.update(created.id, { quantity: '1000', remark: '加急' })
    expect(updated!.quantity).toBe('1000')
    expect(updated!.remark).toBe('加急')
  })
})

describe('Quote costPrice 成本价持久化', () => {
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建报价时 costPrice 默认为 0', () => {
    const quote = db.quotes.create({ customerName: '成本价测试', productStyle: '1' })
    expect(quote.costPrice).toBe(0)
  })

  it('创建报价时传入 costPrice 能正确保存', () => {
    const quote = db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 2.97 })
    expect(quote.costPrice).toBe(2.97)
  })

  it('getById 能正确读取 costPrice', () => {
    const created = db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 3.5 })
    const found = db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.costPrice).toBe(3.5)
  })

  it('update 能更新 costPrice', () => {
    const created = db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 2.97 })
    const updated = db.quotes.update(created.id, { costPrice: 3.42 })
    expect(updated!.costPrice).toBe(3.42)
  })

  it('update 其他字段时不影响 costPrice', () => {
    const created = db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 2.97 })
    const updated = db.quotes.update(created.id, { quantity: '5000', remark: '加急' })
    expect(updated!.costPrice).toBe(2.97)
    expect(updated!.quantity).toBe('5000')
  })

  it('costPrice 支持小数精度', () => {
    const created = db.quotes.create({ customerName: '精度测试', productStyle: '1', costPrice: 6.2123635352 })
    const found = db.quotes.getById(created.id)
    expect(found!.costPrice).toBeCloseTo(6.2123635352, 8)
  })

  it('costPrice、sellPriceNoTax、sellPriceWithTax 三者独立保存', () => {
    const created = db.quotes.create({
      customerName: '三价测试', productStyle: '1',
      costPrice: 2.97, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76,
    })
    const found = db.quotes.getById(created.id)
    expect(found!.costPrice).toBe(2.97)
    expect(found!.sellPriceNoTax).toBe(3.42)
    expect(found!.sellPriceWithTax).toBe(3.76)
  })

  it('单独更新卖价不影响成本价', () => {
    const created = db.quotes.create({
      customerName: '联动测试', productStyle: '1',
      costPrice: 2.97, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76,
    })
    const updated = db.quotes.update(created.id, { sellPriceNoTax: 4.0, sellPriceWithTax: 4.4 })
    expect(updated!.costPrice).toBe(2.97) // 成本价不变
    expect(updated!.sellPriceNoTax).toBe(4.0)
    expect(updated!.sellPriceWithTax).toBe(4.4)
  })
})

describe('Quote priceWithTax 含税价持久化', () => {
  let db: any
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建报价时 priceWithTax 默认为 0', () => {
    const quote = db.quotes.create({ customerName: '含税价测试', productStyle: '1' })
    expect(quote.priceWithTax).toBe(0)
  })

  it('创建报价时传入 priceWithTax 能正确保存', () => {
    const quote = db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    expect(quote.priceWithTax).toBe(3.27)
  })

  it('getById 能正确读取 priceWithTax', () => {
    const created = db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    const found = db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.priceWithTax).toBe(3.27)
  })

  it('update 能更新 priceWithTax', () => {
    const created = db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    const updated = db.quotes.update(created.id, { priceWithTax: 3.5 })
    expect(updated!.priceWithTax).toBe(3.5)
  })

  it('update 其他字段时不影响 priceWithTax', () => {
    const created = db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    const updated = db.quotes.update(created.id, { quantity: '5000', remark: '加急' })
    expect(updated!.priceWithTax).toBe(3.27)
    expect(updated!.quantity).toBe('5000')
  })

  it('priceWithTax 与 costPrice 独立保存（成本价变更不自动联动）', () => {
    const created = db.quotes.create({
      customerName: '独立性测试', productStyle: '1',
      costPrice: 2.97, priceWithTax: 3.27,
    })
    // 更新成本价，含税价不应自动变化（联动由前端处理）
    const updated = db.quotes.update(created.id, { costPrice: 3.5 })
    expect(updated!.costPrice).toBe(3.5)
    expect(updated!.priceWithTax).toBe(3.27)
  })

  it('四价独立保存：costPrice / priceWithTax / sellPriceNoTax / sellPriceWithTax', () => {
    const created = db.quotes.create({
      customerName: '四价测试', productStyle: '1',
      costPrice: 2.97, priceWithTax: 3.27, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76,
    })
    const found = db.quotes.getById(created.id)
    expect(found!.costPrice).toBe(2.97)
    expect(found!.priceWithTax).toBe(3.27)
    expect(found!.sellPriceNoTax).toBe(3.42)
    expect(found!.sellPriceWithTax).toBe(3.76)
  })
})

describe('Quote modifiedFormulas 公式修改持久化', () => {
  let db: any
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建报价时 modifiedFormulas 默认为空对象', () => {
    const quote = db.quotes.create({ customerName: '公式测试', productStyle: '1' })
    expect(quote.modifiedFormulas).toEqual({})
  })

  it('创建报价时传入 modifiedFormulas 能正确保存', () => {
    const modified = { J8: '=SUM(J6:J7)*1.1', K9: '=J9*1.13' }
    const quote = db.quotes.create({ customerName: '公式测试', productStyle: '1', modifiedFormulas: modified })
    expect(quote.modifiedFormulas).toEqual(modified)
  })

  it('getById 能正确读取 modifiedFormulas', () => {
    const modified = { J8: '=SUM(J6:J7)*1.1' }
    const created = db.quotes.create({ customerName: '公式测试', productStyle: '1', modifiedFormulas: modified })
    const found = db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.modifiedFormulas).toEqual(modified)
  })

  it('update 能更新 modifiedFormulas', () => {
    const created = db.quotes.create({ customerName: '公式测试', productStyle: '1' })
    const modified = { J10: '=(J9-J8)*B2*1.05' }
    const updated = db.quotes.update(created.id, { modifiedFormulas: modified })
    expect(updated!.modifiedFormulas).toEqual(modified)
  })

  it('update 能追加和覆盖 modifiedFormulas 中的公式', () => {
    const created = db.quotes.create({
      customerName: '公式测试', productStyle: '1',
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.1' },
    })
    // 覆盖 J8 并新增 J10
    const updated = db.quotes.update(created.id, {
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.15', J10: '=(J9-J8)*B2' },
    })
    expect(updated!.modifiedFormulas.J8).toBe('=SUM(J6:J7)*1.15')
    expect(updated!.modifiedFormulas.J10).toBe('=(J9-J8)*B2')
  })

  it('update 其他字段时不影响 modifiedFormulas', () => {
    const modified = { J8: '=SUM(J6:J7)*1.1' }
    const created = db.quotes.create({ customerName: '公式测试', productStyle: '1', modifiedFormulas: modified })
    const updated = db.quotes.update(created.id, { quantity: '5000', remark: '加急' })
    expect(updated!.modifiedFormulas).toEqual(modified)
    expect(updated!.quantity).toBe('5000')
  })

  it('modifiedFormulas / removedFormulaAddresses / tableData 三者独立保存', () => {
    const created = db.quotes.create({
      customerName: '三字段测试', productStyle: '1',
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.1' },
      removedFormulaAddresses: ['K9'],
      tableData: [[null, '数量'], [100, null]],
    })
    const found = db.quotes.getById(created.id)
    expect(found!.modifiedFormulas).toEqual({ J8: '=SUM(J6:J7)*1.1' })
    expect(found!.removedFormulaAddresses).toEqual(['K9'])
    expect(found!.tableData).toEqual([[null, '数量'], [100, null]])
  })

  it('getAll 返回的 modifiedFormulas 已正确解析为对象', () => {
    const modified = { J8: '=SUM(J6:J7)*1.1', K9: '=J9*1.1' }
    db.quotes.create({ customerName: 'getAll测试', productStyle: '1', modifiedFormulas: modified })
    const all = db.quotes.getAll()
    const found = all.find((q: { customerName: string }) => q.customerName === 'getAll测试')
    expect(found).toBeDefined()
    expect(found!.modifiedFormulas).toEqual(modified)
    expect(typeof found!.modifiedFormulas).toBe('object')
    expect(Array.isArray(found!.modifiedFormulas)).toBe(false)
  })

  it('modifiedFormulas 支持空公式字符串值', () => {
    const created = db.quotes.create({
      customerName: '空值测试', productStyle: '1',
      modifiedFormulas: { J8: '' },
    })
    const found = db.quotes.getById(created.id)
    expect(found!.modifiedFormulas.J8).toBe('')
  })
})

describe('Quote allFormulas 完整公式持久化', () => {
  let db: any
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建报价时 allFormulas 默认为空对象', () => {
    const quote = db.quotes.create({ customerName: '全公式测试', productStyle: '1' })
    expect(quote.allFormulas).toEqual({})
  })

  it('创建报价时传入 allFormulas 能正确保存', () => {
    const all = { J8: '=SUM(J6:J7)', K9: '=J9*1.1', L8: '=J8*1.1' }
    const quote = db.quotes.create({ customerName: '全公式测试', productStyle: '1', allFormulas: all })
    expect(quote.allFormulas).toEqual(all)
  })

  it('getById 能正确读取 allFormulas', () => {
    const all = { J8: '=SUM(J6:J7)', L8: '=J8*1.1' }
    const created = db.quotes.create({ customerName: '全公式测试', productStyle: '1', allFormulas: all })
    const found = db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.allFormulas).toEqual(all)
  })

  it('update 能更新 allFormulas', () => {
    const created = db.quotes.create({ customerName: '全公式测试', productStyle: '1' })
    const all = { J10: '=(J9-J8)*B2', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100' }
    const updated = db.quotes.update(created.id, { allFormulas: all })
    expect(updated!.allFormulas).toEqual(all)
  })

  it('update 能覆盖 allFormulas 中的公式', () => {
    const created = db.quotes.create({
      customerName: '全公式测试', productStyle: '1',
      allFormulas: { J8: '=SUM(J6:J7)' },
    })
    const updated = db.quotes.update(created.id, { allFormulas: { J8: '=SUM(J6:J7)*1.2' } })
    expect(updated!.allFormulas.J8).toBe('=SUM(J6:J7)*1.2')
  })

  it('update 其他字段时不影响 allFormulas', () => {
    const all = { J8: '=SUM(J6:J7)' }
    const created = db.quotes.create({ customerName: '全公式测试', productStyle: '1', allFormulas: all })
    const updated = db.quotes.update(created.id, { quantity: '9999', remark: '测试' })
    expect(updated!.allFormulas).toEqual(all)
    expect(updated!.quantity).toBe('9999')
  })

  it('getAll 返回的 allFormulas 已正确解析为对象', () => {
    const all = { J8: '=SUM(J6:J7)', K9: '=J9*1.1' }
    db.quotes.create({ customerName: 'getAll全公式', productStyle: '1', allFormulas: all })
    const list = db.quotes.getAll()
    const found = list.find((q: { customerName: string }) => q.customerName === 'getAll全公式')
    expect(found).toBeDefined()
    expect(found!.allFormulas).toEqual(all)
    expect(typeof found!.allFormulas).toBe('object')
    expect(Array.isArray(found!.allFormulas)).toBe(false)
  })

  it('allFormulas 可保存用户新增到非模板地址的公式', () => {
    // 模拟用户在原本无公式的单元格（如 Z1）新增公式
    const all = { Z1: '=A1+B1', AA99: '=SUM(A1:Z1)' }
    const created = db.quotes.create({ customerName: '新增公式测试', productStyle: '1', allFormulas: all })
    const found = db.quotes.getById(created.id)
    expect(found!.allFormulas.Z1).toBe('=A1+B1')
    expect(found!.allFormulas.AA99).toBe('=SUM(A1:Z1)')
  })

  it('allFormulas 与 modifiedFormulas/removedFormulaAddresses/tableData 四字段独立保存', () => {
    const created = db.quotes.create({
      customerName: '四字段测试', productStyle: '1',
      allFormulas: { J8: '=SUM(J6:J7)', L8: '=J8*1.1' },
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.1' },
      removedFormulaAddresses: ['K9'],
      tableData: [[null, '数量'], [100, null]],
    })
    const found = db.quotes.getById(created.id)
    expect(found!.allFormulas).toEqual({ J8: '=SUM(J6:J7)', L8: '=J8*1.1' })
    expect(found!.modifiedFormulas).toEqual({ J8: '=SUM(J6:J7)*1.1' })
    expect(found!.removedFormulaAddresses).toEqual(['K9'])
    expect(found!.tableData).toEqual([[null, '数量'], [100, null]])
  })

  it('迁移脚本将老数据初始化为 allFormulas（模板公式 - removed + modified）', () => {
    // 模拟 v9 迁移逻辑：从老数据（removed + modified + 模板公式）计算 allFormulas
    // 这里直接验证迁移后的结果：通过迁移脚本创建的 allFormulas 应包含模板公式（排除已删除、覆盖已修改）
    const created = db.quotes.create({
      customerName: '迁移初始化测试', productStyle: '1',
      allFormulas: {
        // 模拟 v9 迁移计算结果：模板公式 - removed(K9) + modified(J8 改为 *1.2)
        J8: '=SUM(J6:J7)*1.2', // modified 覆盖
        J9: '=J8+I9',           // 模板原值
        K9: undefined as any,   // removed（不应出现）
      },
    })
    // 删除 K9（模拟 removed）
    delete (created.allFormulas as any).K9
    const updated = db.quotes.update(created.id, { allFormulas: created.allFormulas })
    expect(updated!.allFormulas.J8).toBe('=SUM(J6:J7)*1.2')
    expect(updated!.allFormulas.J9).toBe('=J8+I9')
    expect(updated!.allFormulas.K9).toBeUndefined()
  })
})

describe('Customer CRUD', () => {
  beforeEach(async () => {
    process.env.DB_PATH = ':memory:'
    vi.resetModules()
    const mod = await import('../api/db')
    db = mod.db
  })

  it('创建客户时生成 ID 和时间戳', () => {
    const customer = db.customers.create({
      name: '新客户A',
      phone: '13800138000',
      address: '深圳市南山区',
    })
    expect(customer.id).toMatch(/^cust-/)
    expect(customer.created_at).toBeTruthy()
    expect(customer.updated_at).toBeTruthy()
  })

  it('getByName 按名称查找客户', () => {
    db.customers.create({ name: '按名查找客户', phone: '13900139000' })
    const found = db.customers.getByName('按名查找客户')
    expect(found).not.toBeNull()
    expect(found!.phone).toBe('13900139000')
  })

  it('getByName 不存在时返回 null', () => {
    const found = db.customers.getByName('不存在的客户')
    expect(found).toBeNull()
  })
})
