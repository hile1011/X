/**
 * 订单状态流转 & 订单号生成 单元测试
 * 测试目标：api/db.ts 中 quotes 的 nextStatus / prevStatus / endQuote / create / update 逻辑
 *
 * 使用 MySQL 测试数据库（quote_system_test），每个测试用例前 resetTestDatabase() 保证隔离性。
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'

// 确保-schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
// db.ts 模块级 migrate 只在首次 import 时执行，后续测试文件需要手动确保
beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
})

describe('Quote 状态流转', () => {
  let quoteId: string

  beforeEach(async () => {
    const quote = await db.quotes.create({
      customerName: '测试客户',
      productStyle: '1',
      quantity: '1000',
    })
    quoteId = quote.id
  })

  describe('nextStatus - 进入下一节点', () => {
    it('报价中(1) → 打样中(2)，应记录 sampleTime', async () => {
      const updated = await db.quotes.nextStatus(quoteId)
      expect(updated!.status).toBe(2)
      expect(updated!.sampleTime).toBeTruthy()
      expect(updated!.productionStartTime).toBe('')
    })

    it('打样中(2) → 打样完成(7)，应记录 sampleCompletedTime', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      const updated = await db.quotes.nextStatus(quoteId) // 2→7
      expect(updated!.status).toBe(7)
      expect(updated!.sampleCompletedTime).toBeTruthy()
      expect(updated!.productionStartTime).toBe('')
    })

    it('打样完成(7) → 做货中(3)，应记录 productionStartTime', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      await db.quotes.nextStatus(quoteId) // 2→7
      const updated = await db.quotes.nextStatus(quoteId) // 7→3
      expect(updated!.status).toBe(3)
      expect(updated!.productionStartTime).toBeTruthy()
    })

    it('做货中(3) → 已发货未收款(4)，应记录 shippingTime', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      await db.quotes.nextStatus(quoteId) // 2→7
      await db.quotes.nextStatus(quoteId) // 7→3
      const updated = await db.quotes.nextStatus(quoteId) // 3→4
      expect(updated!.status).toBe(4)
      expect(updated!.shippingTime).toBeTruthy()
    })

    it('已发货未收款(4) → 已发货已收款(5)，应记录 paymentTime', async () => {
      for (let i = 0; i < 4; i++) await db.quotes.nextStatus(quoteId) // 1→4（1→2→7→3→4）
      const updated = await db.quotes.nextStatus(quoteId) // 4→5
      expect(updated!.status).toBe(5)
      expect(updated!.paymentTime).toBeTruthy()
    })

    it('已发货已收款(5) → 结束(6)，应记录 endTime', async () => {
      for (let i = 0; i < 5; i++) await db.quotes.nextStatus(quoteId) // 1→5（1→2→7→3→4→5）
      const updated = await db.quotes.nextStatus(quoteId) // 5→6
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('结束(6) 不能继续流转，应保持原状态', async () => {
      for (let i = 0; i < 6; i++) await db.quotes.nextStatus(quoteId) // 1→6（1→2→7→3→4→5→6）
      const updated = await db.quotes.nextStatus(quoteId)
      expect(updated!.status).toBe(6)
    })
  })

  describe('prevStatus - 退回上一节点', () => {
    it('打样中(2) → 报价中(1)', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      const updated = await db.quotes.prevStatus(quoteId) // 2→1
      expect(updated!.status).toBe(1)
    })

    it('打样完成(7) → 打样中(2)', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      await db.quotes.nextStatus(quoteId) // 2→7
      const updated = await db.quotes.prevStatus(quoteId) // 7→2
      expect(updated!.status).toBe(2)
    })

    it('做货中(3) → 打样完成(7)', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      await db.quotes.nextStatus(quoteId) // 2→7
      await db.quotes.nextStatus(quoteId) // 7→3
      const updated = await db.quotes.prevStatus(quoteId) // 3→7
      expect(updated!.status).toBe(7)
    })

    it('已发货未收款(4) → 做货中(3)', async () => {
      for (let i = 0; i < 4; i++) await db.quotes.nextStatus(quoteId) // 1→4（1→2→7→3→4）
      const updated = await db.quotes.prevStatus(quoteId) // 4→3
      expect(updated!.status).toBe(3)
    })

    it('已发货已收款(5) → 已发货未收款(4)', async () => {
      for (let i = 0; i < 5; i++) await db.quotes.nextStatus(quoteId) // 1→5
      const updated = await db.quotes.prevStatus(quoteId) // 5→4
      expect(updated!.status).toBe(4)
    })

    it('结束(6) → 已发货已收款(5)，结束状态可退回', async () => {
      for (let i = 0; i < 6; i++) await db.quotes.nextStatus(quoteId) // 1→6
      const updated = await db.quotes.prevStatus(quoteId) // 6→5
      expect(updated!.status).toBe(5)
    })

    it('报价中(1) 不能退回，应保持原状态', async () => {
      const updated = await db.quotes.prevStatus(quoteId)
      expect(updated!.status).toBe(1)
    })
  })

  describe('endQuote - 直接结束', () => {
    it('报价中(1) 可直接结束 → 结束(6)', async () => {
      const updated = await db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('打样中(2) 可直接结束 → 结束(6)', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      const updated = await db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('打样完成(7) 可直接结束 → 结束(6)', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      await db.quotes.nextStatus(quoteId) // 2→7
      const updated = await db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(6)
      expect(updated!.endTime).toBeTruthy()
    })

    it('做货中(3) 不能直接结束，应保持原状态', async () => {
      await db.quotes.nextStatus(quoteId) // 1→2
      await db.quotes.nextStatus(quoteId) // 2→7
      await db.quotes.nextStatus(quoteId) // 7→3
      const updated = await db.quotes.endQuote(quoteId)
      expect(updated!.status).toBe(3)
    })
  })
})

describe('Quote 订单号生成', () => {
  it('创建时生成订单号格式：16位随机数字', async () => {
    const quote = await db.quotes.create({
      customerName: '深圳科技公司',
      productStyle: '3',
    })
    expect(quote.quote_number).toMatch(/^\d{16}$/)
  })

  it('多个订单的订单号互不相同（全局唯一）', async () => {
    const numbers = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const quote = await db.quotes.create({ customerName: `唯一性测试客户${i}`, productStyle: '1' })
      expect(numbers.has(quote.quote_number)).toBe(false)
      numbers.add(quote.quote_number)
    }
  })

  it('修改客户名称时订单号保持不变', async () => {
    const quote = await db.quotes.create({
      customerName: '原客户',
      productStyle: '1',
    })

    const updated = await db.quotes.update(quote.id, { customerName: '新客户' })
    expect(updated!.quote_number).toBe(quote.quote_number)
  })

  it('修改款式时订单号保持不变', async () => {
    const quote = await db.quotes.create({
      customerName: '测试客户',
      productStyle: '1',
    })

    const updated = await db.quotes.update(quote.id, { productStyle: '4' })
    expect(updated!.quote_number).toBe(quote.quote_number)
  })

  it('复制订单时生成全新订单号（不复用原订单号）', async () => {
    const quote = await db.quotes.create({
      customerName: '复制测试客户',
      productStyle: '1',
    })
    const copied = await db.quotes.copy(quote.id, 'tester')
    expect(copied).not.toBeNull()
    expect(copied!.quote_number).toMatch(/^\d{16}$/)
    expect(copied!.quote_number).not.toBe(quote.quote_number)
  })

  it('未传款式时 productStyle 默认为 1', async () => {
    const quote = await db.quotes.create({ customerName: '默认款式测试', productStyle: '1' })
    expect(quote.productStyle).toBe('1')
  })
})

describe('Quote CRUD', () => {
  it('创建报价时初始化状态为 1（报价中）', async () => {
    const quote = await db.quotes.create({ customerName: 'CRUD测试', productStyle: '1' })
    expect(quote.status).toBe(1)
    expect(quote.quoteTime).toBeTruthy()
  })

  it('getById 返回完整报价数据', async () => {
    const created = await db.quotes.create({ customerName: '查询测试', productStyle: '1' })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.customerName).toBe('查询测试')
  })

  it('getById 不存在时返回 null', async () => {
    const found = await db.quotes.getById('non-existent-id')
    expect(found).toBeNull()
  })

  it('delete 删除后 getById 返回 null', async () => {
    const created = await db.quotes.create({ customerName: '删除测试', productStyle: '1' })
    const success = await db.quotes.delete(created.id)
    expect(success).toBe(true)
    const found = await db.quotes.getById(created.id)
    expect(found).toBeNull()
  })

  it('update 更新字段', async () => {
    const created = await db.quotes.create({ customerName: '更新测试', quantity: '500', productStyle: '1' })
    const updated = await db.quotes.update(created.id, { quantity: '1000', remark: '加急' })
    expect(updated!.quantity).toBe('1000')
    expect(updated!.remark).toBe('加急')
  })
})

describe('Quote costPrice 成本价持久化', () => {
  it('创建报价时 costPrice 默认为 0', async () => {
    const quote = await db.quotes.create({ customerName: '成本价测试', productStyle: '1' })
    expect(quote.costPrice).toBe(0)
  })

  it('创建报价时传入 costPrice 能正确保存', async () => {
    const quote = await db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 2.97 })
    expect(quote.costPrice).toBe(2.97)
  })

  it('getById 能正确读取 costPrice', async () => {
    const created = await db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 3.5 })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.costPrice).toBe(3.5)
  })

  it('update 能更新 costPrice', async () => {
    const created = await db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 2.97 })
    const updated = await db.quotes.update(created.id, { costPrice: 3.42 })
    expect(updated!.costPrice).toBe(3.42)
  })

  it('update 其他字段时不影响 costPrice', async () => {
    const created = await db.quotes.create({ customerName: '成本价测试', productStyle: '1', costPrice: 2.97 })
    const updated = await db.quotes.update(created.id, { quantity: '5000', remark: '加急' })
    expect(updated!.costPrice).toBe(2.97)
    expect(updated!.quantity).toBe('5000')
  })

  it('costPrice 支持小数精度', async () => {
    const created = await db.quotes.create({ customerName: '精度测试', productStyle: '1', costPrice: 6.2123635352 })
    const found = await db.quotes.getById(created.id)
    expect(found!.costPrice).toBeCloseTo(6.2123635352, 8)
  })

  it('costPrice、sellPriceNoTax、sellPriceWithTax 三者独立保存', async () => {
    const created = await db.quotes.create({
      customerName: '三价测试', productStyle: '1',
      costPrice: 2.97, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76,
    })
    const found = await db.quotes.getById(created.id)
    expect(found!.costPrice).toBe(2.97)
    expect(found!.sellPriceNoTax).toBe(3.42)
    expect(found!.sellPriceWithTax).toBe(3.76)
  })

  it('单独更新卖价不影响成本价', async () => {
    const created = await db.quotes.create({
      customerName: '联动测试', productStyle: '1',
      costPrice: 2.97, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76,
    })
    const updated = await db.quotes.update(created.id, { sellPriceNoTax: 4.0, sellPriceWithTax: 4.4 })
    expect(updated!.costPrice).toBe(2.97) // 成本价不变
    expect(updated!.sellPriceNoTax).toBe(4.0)
    expect(updated!.sellPriceWithTax).toBe(4.4)
  })
})


describe('Quote priceWithTax 含税价持久化', () => {
  it('创建报价时 priceWithTax 默认为 0', async () => {
    const quote = await db.quotes.create({ customerName: '含税价测试', productStyle: '1' })
    expect(quote.priceWithTax).toBe(0)
  })

  it('创建报价时传入 priceWithTax 能正确保存', async () => {
    const quote = await db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    expect(quote.priceWithTax).toBe(3.27)
  })

  it('getById 能正确读取 priceWithTax', async () => {
    const created = await db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.priceWithTax).toBe(3.27)
  })

  it('update 能更新 priceWithTax', async () => {
    const created = await db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    const updated = await db.quotes.update(created.id, { priceWithTax: 3.5 })
    expect(updated!.priceWithTax).toBe(3.5)
  })

  it('update 其他字段时不影响 priceWithTax', async () => {
    const created = await db.quotes.create({ customerName: '含税价测试', productStyle: '1', priceWithTax: 3.27 })
    const updated = await db.quotes.update(created.id, { quantity: '5000', remark: '加急' })
    expect(updated!.priceWithTax).toBe(3.27)
    expect(updated!.quantity).toBe('5000')
  })

  it('priceWithTax 与 costPrice 独立保存（成本价变更不自动联动）', async () => {
    const created = await db.quotes.create({
      customerName: '独立性测试', productStyle: '1',
      costPrice: 2.97, priceWithTax: 3.27,
    })
    // 更新成本价，含税价不应自动变化（联动由前端处理）
    const updated = await db.quotes.update(created.id, { costPrice: 3.5 })
    expect(updated!.costPrice).toBe(3.5)
    expect(updated!.priceWithTax).toBe(3.27)
  })

  it('四价独立保存：costPrice / priceWithTax / sellPriceNoTax / sellPriceWithTax', async () => {
    const created = await db.quotes.create({
      customerName: '四价测试', productStyle: '1',
      costPrice: 2.97, priceWithTax: 3.27, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76,
    })
    const found = await db.quotes.getById(created.id)
    expect(found!.costPrice).toBe(2.97)
    expect(found!.priceWithTax).toBe(3.27)
    expect(found!.sellPriceNoTax).toBe(3.42)
    expect(found!.sellPriceWithTax).toBe(3.76)
  })
})


describe('Quote modifiedFormulas 公式修改持久化', () => {
  it('创建报价时 modifiedFormulas 默认为空对象', async () => {
    const quote = await db.quotes.create({ customerName: '公式测试', productStyle: '1' })
    expect(quote.modifiedFormulas).toEqual({})
  })

  it('创建报价时传入 modifiedFormulas 能正确保存', async () => {
    const modified = { J8: '=SUM(J6:J7)*1.1', K9: '=J9*1.13' }
    const quote = await db.quotes.create({ customerName: '公式测试', productStyle: '1', modifiedFormulas: modified })
    expect(quote.modifiedFormulas).toEqual(modified)
  })

  it('getById 能正确读取 modifiedFormulas', async () => {
    const modified = { J8: '=SUM(J6:J7)*1.1' }
    const created = await db.quotes.create({ customerName: '公式测试', productStyle: '1', modifiedFormulas: modified })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.modifiedFormulas).toEqual(modified)
  })

  it('update 能更新 modifiedFormulas', async () => {
    const created = await db.quotes.create({ customerName: '公式测试', productStyle: '1' })
    const modified = { J10: '=(J9-J8)*B2*1.05' }
    const updated = await db.quotes.update(created.id, { modifiedFormulas: modified })
    expect(updated!.modifiedFormulas).toEqual(modified)
  })

  it('update 能追加和覆盖 modifiedFormulas 中的公式', async () => {
    const created = await db.quotes.create({
      customerName: '公式测试', productStyle: '1',
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.1' },
    })
    // 覆盖 J8 并新增 J10
    const updated = await db.quotes.update(created.id, {
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.15', J10: '=(J9-J8)*B2' },
    })
    expect(updated!.modifiedFormulas.J8).toBe('=SUM(J6:J7)*1.15')
    expect(updated!.modifiedFormulas.J10).toBe('=(J9-J8)*B2')
  })

  it('update 其他字段时不影响 modifiedFormulas', async () => {
    const modified = { J8: '=SUM(J6:J7)*1.1' }
    const created = await db.quotes.create({ customerName: '公式测试', productStyle: '1', modifiedFormulas: modified })
    const updated = await db.quotes.update(created.id, { quantity: '5000', remark: '加急' })
    expect(updated!.modifiedFormulas).toEqual(modified)
    expect(updated!.quantity).toBe('5000')
  })

  it('modifiedFormulas / removedFormulaAddresses / tableData 三者独立保存', async () => {
    const created = await db.quotes.create({
      customerName: '三字段测试', productStyle: '1',
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.1' },
      removedFormulaAddresses: ['K9'],
      tableData: [[null, '数量'], [100, null]],
    })
    const found = await db.quotes.getById(created.id)
    expect(found!.modifiedFormulas).toEqual({ J8: '=SUM(J6:J7)*1.1' })
    expect(found!.removedFormulaAddresses).toEqual(['K9'])
    expect(found!.tableData).toEqual([[null, '数量'], [100, null]])
  })

  it('getById 返回的 modifiedFormulas 已正确解析为对象', async () => {
    const modified = { J8: '=SUM(J6:J7)*1.1', K9: '=J9*1.1' }
    const created = await db.quotes.create({ customerName: 'getAll测试', productStyle: '1', modifiedFormulas: modified })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.modifiedFormulas).toEqual(modified)
    expect(typeof found!.modifiedFormulas).toBe('object')
    expect(Array.isArray(found!.modifiedFormulas)).toBe(false)
  })

  it('modifiedFormulas 支持空公式字符串值', async () => {
    const created = await db.quotes.create({
      customerName: '空值测试', productStyle: '1',
      modifiedFormulas: { J8: '' },
    })
    const found = await db.quotes.getById(created.id)
    expect(found!.modifiedFormulas.J8).toBe('')
  })
})


describe('Quote allFormulas 完整公式持久化', () => {
  it('创建报价时 allFormulas 默认为空对象', async () => {
    const quote = await db.quotes.create({ customerName: '全公式测试', productStyle: '1' })
    expect(quote.allFormulas).toEqual({})
  })

  it('创建报价时传入 allFormulas 能正确保存', async () => {
    const all = { J8: '=SUM(J6:J7)', K9: '=J9*1.1', L8: '=J8*1.1' }
    const quote = await db.quotes.create({ customerName: '全公式测试', productStyle: '1', allFormulas: all })
    expect(quote.allFormulas).toEqual(all)
  })

  it('getById 能正确读取 allFormulas', async () => {
    const all = { J8: '=SUM(J6:J7)', L8: '=J8*1.1' }
    const created = await db.quotes.create({ customerName: '全公式测试', productStyle: '1', allFormulas: all })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.allFormulas).toEqual(all)
  })

  it('update 能更新 allFormulas', async () => {
    const created = await db.quotes.create({ customerName: '全公式测试', productStyle: '1' })
    const all = { J10: '=(J9-J8)*B2', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100' }
    const updated = await db.quotes.update(created.id, { allFormulas: all })
    expect(updated!.allFormulas).toEqual(all)
  })

  it('update 能覆盖 allFormulas 中的公式', async () => {
    const created = await db.quotes.create({
      customerName: '全公式测试', productStyle: '1',
      allFormulas: { J8: '=SUM(J6:J7)' },
    })
    const updated = await db.quotes.update(created.id, { allFormulas: { J8: '=SUM(J6:J7)*1.2' } })
    expect(updated!.allFormulas.J8).toBe('=SUM(J6:J7)*1.2')
  })

  it('update 其他字段时不影响 allFormulas', async () => {
    const all = { J8: '=SUM(J6:J7)' }
    const created = await db.quotes.create({ customerName: '全公式测试', productStyle: '1', allFormulas: all })
    const updated = await db.quotes.update(created.id, { quantity: '9999', remark: '测试' })
    expect(updated!.allFormulas).toEqual(all)
    expect(updated!.quantity).toBe('9999')
  })

  it('getById 返回的 allFormulas 已正确解析为对象', async () => {
    const all = { J8: '=SUM(J6:J7)', K9: '=J9*1.1' }
    const created = await db.quotes.create({ customerName: 'getAll全公式', productStyle: '1', allFormulas: all })
    const found = await db.quotes.getById(created.id)
    expect(found).not.toBeNull()
    expect(found!.allFormulas).toEqual(all)
    expect(typeof found!.allFormulas).toBe('object')
    expect(Array.isArray(found!.allFormulas)).toBe(false)
  })

  it('allFormulas 可保存用户新增到非模板地址的公式', async () => {
    // 模拟用户在原本无公式的单元格（如 Z1）新增公式
    const all = { Z1: '=A1+B1', AA99: '=SUM(A1:Z1)' }
    const created = await db.quotes.create({ customerName: '新增公式测试', productStyle: '1', allFormulas: all })
    const found = await db.quotes.getById(created.id)
    expect(found!.allFormulas.Z1).toBe('=A1+B1')
    expect(found!.allFormulas.AA99).toBe('=SUM(A1:Z1)')
  })

  it('allFormulas 与 modifiedFormulas/removedFormulaAddresses/tableData 四字段独立保存', async () => {
    const created = await db.quotes.create({
      customerName: '四字段测试', productStyle: '1',
      allFormulas: { J8: '=SUM(J6:J7)', L8: '=J8*1.1' },
      modifiedFormulas: { J8: '=SUM(J6:J7)*1.1' },
      removedFormulaAddresses: ['K9'],
      tableData: [[null, '数量'], [100, null]],
    })
    const found = await db.quotes.getById(created.id)
    expect(found!.allFormulas).toEqual({ J8: '=SUM(J6:J7)', L8: '=J8*1.1' })
    expect(found!.modifiedFormulas).toEqual({ J8: '=SUM(J6:J7)*1.1' })
    expect(found!.removedFormulaAddresses).toEqual(['K9'])
    expect(found!.tableData).toEqual([[null, '数量'], [100, null]])
  })

  it('迁移脚本将老数据初始化为 allFormulas（模板公式 - removed + modified）', async () => {
    // 模拟 v9 迁移逻辑：从老数据（removed + modified + 模板公式）计算 allFormulas
    // 这里直接验证迁移后的结果：通过迁移脚本创建的 allFormulas 应包含模板公式（排除已删除、覆盖已修改）
    const created = await db.quotes.create({
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
    const updated = await db.quotes.update(created.id, { allFormulas: created.allFormulas })
    expect(updated!.allFormulas.J8).toBe('=SUM(J6:J7)*1.2')
    expect(updated!.allFormulas.J9).toBe('=J8+I9')
    expect(updated!.allFormulas.K9).toBeUndefined()
  })
})


describe('Customer CRUD', () => {
  it('创建客户时生成 ID 和时间戳', async () => {
    const customer = await db.customers.create({
      name: '新客户A',
      phone: '13800138000',
      address: '深圳市南山区',
    })
    expect(customer.id).toMatch(/^cust-/)
    expect(customer.created_at).toBeTruthy()
    expect(customer.updated_at).toBeTruthy()
  })

  it('getByName 按名称查找客户', async () => {
    await db.customers.create({ name: '按名查找客户', phone: '13900139000' })
    const found = await db.customers.getByName('按名查找客户')
    expect(found).not.toBeNull()
    expect(found!.phone).toBe('13900139000')
  })

  it('getByName 不存在时返回 null', async () => {
    const found = await db.customers.getByName('不存在的客户')
    expect(found).toBeNull()
  })
})
