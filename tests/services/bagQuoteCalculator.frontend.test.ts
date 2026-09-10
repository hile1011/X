/**
 * 前端帆布袋报价计算引擎 单元测试
 * 测试目标：src/services/bagQuoteCalculator.ts（前端版，含汇总行）
 * 与后端版（api/services）公式一致，差异：specTable/costTable 追加「汇总」行、
 * costTable 头部追加「成品」占位行。
 */
import { describe, it, expect } from 'vitest'
import {
  calculateBagQuote,
  defaultBagQuoteInput,
  type BagQuoteInput,
  type FrontBackRowInput,
} from '../../src/services/bagQuoteCalculator'

/** 单行正反面输入（可覆盖参数） */
const row = (over: Partial<FrontBackRowInput> = {}): FrontBackRowInput => ({
  label: '正反面',
  widthBleed: 3,
  heightBleed: 10,
  width: 38,
  height: 40,
  bottom: 0,
  fabricWidth: 154,
  gramWeight: 280,
  processingFee: 0.51,
  frontBackPrintCost: 0,
  fabricPrice: 4.4,
  extraCraftCost: 0.05,
  packagingFee: 0.1,
  lossRate: 1.03,
  ...over,
})

describe('calculateBagQuote - 基础计算', () => {
  it('默认参数返回有效结果，且含税价高于成本', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    expect(result.summary.unitCost).toBeGreaterThan(0)
    expect(result.summary.refPriceNoTax).toBeGreaterThan(result.summary.unitCost)
    expect(result.summary.refPriceWithTax).toBeGreaterThan(result.summary.refPriceNoTax)
  })

  it('利润率公式：refPriceNoTax = unitCost × (1 + profitRate)', () => {
    const result = calculateBagQuote({ ...defaultBagQuoteInput, profitRate: 0.5 })
    expect(result.summary.refPriceNoTax).toBeCloseTo(result.summary.unitCost * 1.5, 4)
  })

  it('含税公式：refPriceWithTax = refPriceNoTax × taxRate', () => {
    const result = calculateBagQuote({ ...defaultBagQuoteInput, taxRate: 1.13 })
    expect(result.summary.refPriceWithTax).toBeCloseTo(result.summary.refPriceNoTax * 1.13, 4)
  })

  it('利润公式：unitProfit / totalProfit', () => {
    const input = { ...defaultBagQuoteInput, quantity: 100 }
    const result = calculateBagQuote(input)
    expect(result.summary.unitProfit).toBeCloseTo(result.summary.refPriceNoTax - result.summary.unitCost, 4)
    expect(result.summary.totalProfit).toBeCloseTo(result.summary.unitProfit * 100, 2)
  })
})

describe('calculateBagQuote - 规格表计算', () => {
  it('切片宽 = 出血 + 成品宽；切片高 = 高×2 + 出血 + 底', () => {
    const result = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ widthBleed: 3, heightBleed: 10, width: 38, height: 40, bottom: 5 })],
    })
    const fb = result.specTable.find((r) => r.label === '正反面')!
    expect(fb.cutWidth).toBe(41)   // 3 + 38
    expect(fb.cutHeight).toBe(95)  // 40*2 + 10 + 5
  })

  it('门幅最大面数 = 门幅 ÷ min(切片宽, 切片高)，废料 = 门幅取余', () => {
    const result = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ fabricWidth: 154, width: 38, height: 40 })],
    })
    const fb = result.specTable.find((r) => r.label === '正反面')!
    // cutWidth=41, cutHeight=90 → min=41；154/41=3.75…，floor 后比较
    expect(fb.maxPanels).toBeCloseTo(154 / 41, 6)
    expect(fb.fabricWaste).toBeCloseTo(154 - Math.floor(154 / 41) * 41, 6)
  })

  it('多个正反面行独立计算', () => {
    const result = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [
        row({ label: '正面', width: 30 }),
        row({ label: '反面', width: 50, heightBleed: 20 }),
      ],
    })
    const front = result.specTable.find((r) => r.label === '正面')!
    const back = result.specTable.find((r) => r.label === '反面')!
    expect(front.cutWidth).toBe(33)   // 3+30
    expect(back.cutWidth).toBe(53)   // 3+50
    expect(back.cutHeight).toBe(100) // 40*2+20+0
    // 成本行同样各自存在
    expect(result.costTable.find((r) => r.label === '正面')).toBeDefined()
    expect(result.costTable.find((r) => r.label === '反面')).toBeDefined()
  })

  it('空正反面数组：手提行回退默认参数（门幅154/克重280/损耗1.03）', () => {
    const result = calculateBagQuote({ ...defaultBagQuoteInput, frontBackRows: [] })
    const handle = result.specTable.find((r) => r.label === '印刷手提')!
    expect(handle.fabricWidth).toBe(154)
    expect(handle.gramWeight).toBe(280)
    const handleCost = result.costTable.find((r) => r.label === '印刷手提')!
    expect(handleCost.lossRate).toBe(1.03)
  })
})

describe('calculateBagQuote - 成本表计算', () => {
  it('印刷费缺省时按切片面积估算（cutWidth × cutHeight × 1.1 / 10000）', () => {
    const result = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ frontBackPrintCost: 0, width: 38, height: 40 })],
    })
    // 估算值在 costTable 中 printDoubleSide 记录原始值 0
    const fb = result.costTable.find((r) => r.label === '正反面')!
    expect(fb.printDoubleSide).toBe(0)
    expect(fb.unitTotalPrice).toBeGreaterThan(0)
  })

  it('显式印刷费优先使用（不再按面积估算）', () => {
    const cheap = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ frontBackPrintCost: 0.01 })],
    })
    const expensive = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ frontBackPrintCost: 5 })],
    })
    expect(expensive.summary.unitCost).toBeGreaterThan(cheap.summary.unitCost)
  })

  it('损耗系数放大单个总价', () => {
    const low = calculateBagQuote({ ...defaultBagQuoteInput, frontBackRows: [row({ lossRate: 1.0 })] })
    const high = calculateBagQuote({ ...defaultBagQuoteInput, frontBackRows: [row({ lossRate: 1.5 })] })
    expect(high.summary.unitCost).toBeGreaterThan(low.summary.unitCost)
  })

  it('首行 lossRate 为 0（falsy）：印刷手提行损耗率回退默认 1.03', () => {
    const result = calculateBagQuote({ ...defaultBagQuoteInput, frontBackRows: [row({ lossRate: 0 })] })
    const handleCost = result.costTable.find((r) => r.label === '印刷手提')
    expect(handleCost?.lossRate).toBe(1.03)
  })
})

describe('calculateBagQuote - 前端特有：汇总行结构', () => {
  it('specTable 结构：成品 + 正反面行 + 印刷手提 + 汇总', () => {
    const result = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ label: '正反面' })],
    })
    expect(result.specTable.map((r) => r.label)).toEqual(['成品', '正反面', '印刷手提', '汇总'])
  })

  it('costTable 结构：成品占位 + 正反面行 + 印刷手提 + 汇总', () => {
    const result = calculateBagQuote({
      ...defaultBagQuoteInput,
      frontBackRows: [row({ label: '正反面' })],
    })
    expect(result.costTable.map((r) => r.label)).toEqual(['成品', '正反面', '印刷手提', '汇总'])
    // 成品行全空占位
    const product = result.costTable[0]
    expect(product.unitTotalPrice).toBeNull()
  })

  it('汇总行 unitGramWeight = 各行单个克重之和', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const summaryRow = result.specTable.find((r) => r.label === '汇总')!
    const fb = result.specTable.find((r) => r.label === '正反面')!
    const handle = result.specTable.find((r) => r.label === '印刷手提')!
    expect(summaryRow.unitGramWeight).toBeCloseTo(fb.unitGramWeight! + handle.unitGramWeight!, 4)
    expect(summaryRow.quantity).toBe(defaultBagQuoteInput.quantity)
  })

  it('汇总成本行 unitTotalPrice = 单个总成本（unitCost）', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    const summaryCost = result.costTable.find((r) => r.label === '汇总')!
    expect(summaryCost.unitTotalPrice).toBeCloseTo(result.summary.unitCost, 6)
  })

  it('summary.totalUnitGramWeight 与汇总行一致', () => {
    const result = calculateBagQuote(defaultBagQuoteInput)
    expect(result.summary.totalUnitGramWeight).toBeCloseTo(
      result.specTable.find((r) => r.label === '汇总')!.unitGramWeight!,
      6,
    )
  })
})

describe('calculateBagQuote - 边界条件', () => {
  it('数量为 0：单个克重守卫为 0（源码显式保护，不产生 Infinity）', () => {
    const input: BagQuoteInput = { ...defaultBagQuoteInput, quantity: 0 }
    const result = calculateBagQuote(input)
    const fb = result.specTable.find((r) => r.label === '正反面')!
    expect(fb.unitGramWeight).toBe(0)
    const handle = result.specTable.find((r) => r.label === '印刷手提')!
    expect(handle.unitGramWeight).toBe(0)
    expect(result.summary.totalUnitGramWeight).toBe(0)
  })

  it('利润率为 0：卖价等于成本', () => {
    const result = calculateBagQuote({ ...defaultBagQuoteInput, profitRate: 0 })
    expect(result.summary.refPriceNoTax).toBeCloseTo(result.summary.unitCost, 6)
    expect(result.summary.unitProfit).toBeCloseTo(0, 6)
  })

  it('包装费计入单个总价', () => {
    const without = calculateBagQuote({ ...defaultBagQuoteInput, frontBackRows: [row({ packagingFee: 0 })] })
    const withFee = calculateBagQuote({ ...defaultBagQuoteInput, frontBackRows: [row({ packagingFee: 1 })] })
    expect(withFee.summary.unitCost - without.summary.unitCost).toBeCloseTo(1, 6)
  })

  it('手提参数变化影响总价', () => {
    const base = calculateBagQuote(defaultBagQuoteInput)
    const longer = calculateBagQuote({ ...defaultBagQuoteInput, handleHeight: 140 })
    expect(longer.summary.unitCost).toBeGreaterThan(base.summary.unitCost)
  })
})
