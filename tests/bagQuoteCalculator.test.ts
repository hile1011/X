/**
 * 帆布袋报价计算引擎 单元测试
 * 测试目标：api/services/bagQuoteCalculator.ts 的 calculateBagQuote 函数
 */
import { describe, it, expect } from 'vitest'
import { calculateBagQuote, defaultBagQuoteInput, type BagQuoteInput } from '../api/services/bagQuoteCalculator'

describe('calculateBagQuote - 基础计算', () => {
  it('使用默认参数应返回有效结果', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    expect(result).toBeDefined()
    expect(result.specTable.length).toBeGreaterThan(0)
    expect(result.costTable.length).toBeGreaterThan(0)
    expect(result.summary.unitCost).toBeGreaterThan(0)
    expect(result.summary.refPriceNoTax).toBeGreaterThan(result.summary.unitCost)
  })

  it('利润率计算：refPriceNoTax = unitCost × (1 + profitRate)', () => {
    const input: BagQuoteInput = { ...defaultBagQuoteInput, profitRate: 0.5 }
    const result = calculateBagQuote(input)
    const expected = result.summary.unitCost * 1.5
    expect(result.summary.refPriceNoTax).toBeCloseTo(expected, 4)
  })

  it('含税价计算：refPriceWithTax = refPriceNoTax × taxRate', () => {
    const input: BagQuoteInput = { ...defaultBagQuoteInput, profitRate: 0.3, taxRate: 1.1 }
    const result = calculateBagQuote(input)
    const expected = result.summary.refPriceNoTax * 1.1
    expect(result.summary.refPriceWithTax).toBeCloseTo(expected, 4)
  })

  it('利润计算：unitProfit = refPriceNoTax - unitCost', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const expected = result.summary.refPriceNoTax - result.summary.unitCost
    expect(result.summary.unitProfit).toBeCloseTo(expected, 4)
  })

  it('总利润 = 单个利润 × 数量', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const expected = result.summary.unitProfit * defaultBagQuoteInput.quantity
    expect(result.summary.totalProfit).toBeCloseTo(expected, 2)
  })
})

describe('calculateBagQuote - 规格计算', () => {
  it('成品行应包含正确的数量和尺寸', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const productRow = result.specTable[0]
    expect(productRow.label).toBe('成品')
    expect(productRow.quantity).toBe(defaultBagQuoteInput.quantity)
    expect(productRow.width).toBe(defaultBagQuoteInput.width)
    expect(productRow.height).toBe(defaultBagQuoteInput.height)
    expect(productRow.bottom).toBe(defaultBagQuoteInput.bottom)
  })

  it('正反面切片宽 = 宽出血 + 宽', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const frontBackRow = result.specTable[1]
    const expected = defaultBagQuoteInput.frontBackRows[0].widthBleed + defaultBagQuoteInput.frontBackRows[0].width
    expect(frontBackRow.cutWidth).toBeCloseTo(expected, 4)
  })

  it('正反面切片高 = 高×2 + 高出血 + 底', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const frontBackRow = result.specTable[1]
    const row = defaultBagQuoteInput.frontBackRows[0]
    const expected = row.height * 2 + row.heightBleed + row.bottom
    expect(frontBackRow.cutHeight).toBeCloseTo(expected, 4)
  })

  it('门幅最大面数 = 布料门幅 / min(切片宽, 切片高)', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const frontBackRow = result.specTable[1]
    const row = defaultBagQuoteInput.frontBackRows[0]
    const cutWidth = row.widthBleed + row.width
    const cutHeight = row.height * 2 + row.heightBleed + row.bottom
    const expected = row.fabricWidth / Math.min(cutWidth, cutHeight)
    expect(frontBackRow.maxPanels).toBeCloseTo(expected, 4)
  })
})

describe('calculateBagQuote - 数量变化', () => {
  it('数量为 0 时单个克重为 0（不报错）', () => {
    const input: BagQuoteInput = { ...defaultBagQuoteInput, quantity: 0 }
    const result = calculateBagQuote(input)
    expect(result.summary.totalUnitGramWeight).toBe(0)
  })

  it('数量增大时总利润应增大', () => {
    const small = calculateBagQuote({ ...defaultBagQuoteInput, quantity: 1000 })
    const large = calculateBagQuote({ ...defaultBagQuoteInput, quantity: 10000 })
    expect(large.summary.totalProfit).toBeGreaterThan(small.summary.totalProfit)
  })
})

describe('calculateBagQuote - 边界情况', () => {
  it('底=0 时正常计算（无底无侧普通袋）', () => {
    const input: BagQuoteInput = { ...defaultBagQuoteInput, bottom: 0 }
    const result = calculateBagQuote(input)
    expect(result.summary.unitCost).toBeGreaterThan(0)
  })

  it('底>0 时正常计算（有底无侧普通袋）', () => {
    const input: BagQuoteInput = {
      ...defaultBagQuoteInput,
      bottom: 8,
      frontBackRows: [{
        ...defaultBagQuoteInput.frontBackRows[0],
        bottom: 8,
        heightBleed: 10,
      }],
    }
    const result = calculateBagQuote(input)
    expect(result.summary.unitCost).toBeGreaterThan(0)
  })

  it('多行正反面时总成本为各行之和', () => {
    const input: BagQuoteInput = {
      ...defaultBagQuoteInput,
      frontBackRows: [
        { ...defaultBagQuoteInput.frontBackRows[0], label: '正反面' },
        { ...defaultBagQuoteInput.frontBackRows[0], label: '侧底', width: 12, height: 110 },
      ],
    }
    const result = calculateBagQuote(input)
    const frontBackTotal = result.costTable
      .filter((r) => r.label !== '印刷手提')
      .reduce((sum, r) => sum + (r.unitTotalPrice || 0), 0)
    expect(result.summary.unitCost).toBeCloseTo(frontBackTotal + result.costTable[result.costTable.length - 1].unitTotalPrice!, 4)
  })
})
