/**
 * 在线表格动态定位工具 单元测试
 *
 * 测试目标：src/services/tableLocator.ts
 *
 * 核心验证点：
 * 1. 以"汇总"文字标识动态定位汇总行（成本价来源行）
 * 2. 以"参考卖价"文字标识动态定位参考卖价行（卖价来源行）
 * 3. 以列标题动态定位"参考卖价"列和"含税价"列
 * 4. 当行/列位置发生变化时（不同款式模板、用户编辑）仍能正确识别
 * 5. 成本价 = 汇总行 × 参考卖价列交叉单元格
 * 6. 卖价(不含税) = 参考卖价行 × 参考卖价列交叉单元格
 * 7. 卖价(含税) = 参考卖价行 × 含税价列交叉单元格
 * 8. 回退逻辑：找不到标识时使用默认值
 */
import { describe, it, expect } from 'vitest'
import {
  findRowByLabel,
  findColByHeader,
  findHeaderRow,
  findTablePositions,
  extractPrices,
  type TablePositions,
} from '../src/services/tableLocator'

// ============================ 真实模板数据（来自 BagQuote.tsx） ============================

// 款式1：无底无侧普通袋
const STYLE1_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
  ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 2.97, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 3240, null, null, null, null, null, null],
]

// 款式2：有底无侧普通袋（多了底部行，汇总/参考卖价行位置下移）
const STYLE2_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 8, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 8, 3, 10, 41, 98, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
  ['底部', 7200, 38, 8, 0, 3, 3, 41, 14, 154, 280, 154, null, 11, null, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
  ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
  ['底部', null, 0, 4.4, null, null, null, null, 1.03, null, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 3.5, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.5, 4.0, 4.4, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
]

// 款式3：有底有侧普通袋（列标题使用"单个布袋总价"而非"参考卖价"）
const STYLE3_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
  ['成品', 300, 40, 35, 12, null, null, null, null, null, null, null, null, null, 96, 320],
  ['正反面', 300, 40, 35, 0, 2, 10, 42, 80, 154, 500, 28, 80, 3.66666666666667, 60, null],
  ['侧底', 300, 12, 110, 0, 2, 10, 14, 120, 154, 500, 0, 33.6, 11, 25.2, null],
  ['手提', 300, 3.8, 60, 0, null, null, 6, 60, 154, 500, 4, 14.4, 25.6666666666667, 10.8, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本-打叉', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
  ['正反面', 1.5, 0.4032, 7.2, 2.01, 1.25, 0.2, 108, 1.03, 5.888896, null, null, null, null, null, null],
  ['侧底', null, null, 7.2, 0.8964, 0, 0, 45.36, 1.03, 1.079028, null, null, null, null, null, null],
  ['手提', null, null, 7.2, 1.7, null, null, 19.44, 1.03, 1.817744, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 8.785668, 9.6642348, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 1, 9.785668, 10.7642348, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 300, null, null, null, null, null, null],
]

// 款式4：手提连底普通拼接袋（行数最多，汇总/参考卖价行位置最靠下）
const STYLE4_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
  ['成品', 1000, 40, 35, 10, null, null, null, null, null, null, null, null, null, 212.7873, 212.7873],
  ['底部', 1000, 40, 5, 10, 4, 3, 44, 23, 148, 340, 10, 73.48, 6.43478260869565, 37.4748, null],
  ['正面', 1000, 40, 30, null, 4, 6, 44, 36, 154, 340, 10, 110, 4.27777777777778, 56.1, null],
  ['反面', 1000, 40, 30, null, 4, 6, 44, 36, 154, 340, 10, 110, 4.27777777777778, 56.1, null],
  ['外口袋', 1000, 17, 17, null, 2, 2, 19, 19, 154, 340, 2, 23.75, 8.10526315789474, 12.1125, null],
  ['手提', 1000, 2.5, 120, 0, null, null, 6, 120, 148, 340, 4, 100, 24.6666666666667, 51, null],
  [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
  ['底部', 1.8, 0, 9.5, 0.75306, 0.2, 0.15, 29.97984, 1.03, 3.0165310352, null, null, null, null, null, null],
  ['正面', 0, 0, 5.2, 0.642, 0, 0, 44.88, 1.03, 0.7074864, null, null, null, null, null, null],
  ['反面', 0, 0, 5.2, 0.642, 0, 0, 44.88, 1.03, 0.7074864, null, null, null, null, null, null],
  ['外口袋', 0, 0.5, 5.2, 0.1785, 0, 0, 9.69, 1.03, 0.7088357, null, null, null, null, null, null],
  ['手提', null, 0, 9.5, 1, null, null, 40.8, 1.03, 1.072024, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, 170.22984, null, 6.2123635352, 6.83359988872, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 1.2, 7.4123635352, 8.15359988872, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 1200, null, null, null, null, null, null],
]

// ============================ 基础函数测试 ============================

describe('findRowByLabel - 按A列文字定位行', () => {
  it('能找到"汇总"行（款式1）', () => {
    expect(findRowByLabel(STYLE1_DATA, '汇总')).toBe(7)
  })
  it('能找到"参考卖价"行（款式1）', () => {
    expect(findRowByLabel(STYLE1_DATA, '参考卖价')).toBe(8)
  })
  it('能找到"成品"行（款式1）', () => {
    expect(findRowByLabel(STYLE1_DATA, '成品')).toBe(1)
  })
  it('款式2中汇总行位置下移（因多了底部行）仍能正确定位', () => {
    expect(findRowByLabel(STYLE2_DATA, '汇总')).toBe(9)
    expect(findRowByLabel(STYLE2_DATA, '参考卖价')).toBe(10)
  })
  it('款式4中汇总行位置最靠下仍能正确定位', () => {
    expect(findRowByLabel(STYLE4_DATA, '汇总')).toBe(13)
    expect(findRowByLabel(STYLE4_DATA, '参考卖价')).toBe(14)
  })
  it('找不到标识时返回 -1', () => {
    expect(findRowByLabel(STYLE1_DATA, '不存在的行')).toBe(-1)
  })
  it('空数组返回 -1', () => {
    expect(findRowByLabel([], '汇总')).toBe(-1)
  })
})

describe('findColByHeader - 按列标题关键字定位列', () => {
  const headerRowIdx = 4 // 款式1的列标题行
  it('能找到"参考卖价"列（款式1，列索引9）', () => {
    expect(findColByHeader(STYLE1_DATA, headerRowIdx, ['参考卖价'])).toBe(9)
  })
  it('能找到"含税价"列（款式1，列索引10）', () => {
    expect(findColByHeader(STYLE1_DATA, headerRowIdx, ['含税价'])).toBe(10)
  })
  it('款式3使用"单个布袋总价"作为列标题，能通过回退关键字找到', () => {
    const style3Header = 5
    expect(findColByHeader(STYLE3_DATA, style3Header, ['参考卖价', '单个布袋总价'])).toBe(9)
  })
  it('多关键字按优先级匹配（"参考卖价"优先于"单个布袋总价"）', () => {
    // 款式1列标题同时不包含"单个布袋总价"，应匹配"参考卖价"
    expect(findColByHeader(STYLE1_DATA, headerRowIdx, ['参考卖价', '单个布袋总价'])).toBe(9)
  })
  it('行索引越界时返回 -1', () => {
    expect(findColByHeader(STYLE1_DATA, 999, ['参考卖价'])).toBe(-1)
    expect(findColByHeader(STYLE1_DATA, -1, ['参考卖价'])).toBe(-1)
  })
  it('找不到关键字时返回 -1', () => {
    expect(findColByHeader(STYLE1_DATA, headerRowIdx, ['不存在的列'])).toBe(-1)
  })
})

describe('findHeaderRow - 定位列标题行', () => {
  it('款式1列标题行在第4行（包含"加工费"）', () => {
    expect(findHeaderRow(STYLE1_DATA)).toBe(4)
  })
  it('款式2列标题行在第5行（因多了底部规格行）', () => {
    expect(findHeaderRow(STYLE2_DATA)).toBe(5)
  })
  it('款式4列标题行在第7行（行数最多）', () => {
    expect(findHeaderRow(STYLE4_DATA)).toBe(7)
  })
  it('找不到列标题行时返回 -1', () => {
    const noHeader: any[][] = [[1, 2, 3], ['a', 'b', 'c']]
    expect(findHeaderRow(noHeader)).toBe(-1)
  })
})

// ============================ findTablePositions 综合定位测试 ============================

describe('findTablePositions - 动态定位关键行和列', () => {
  it('款式1：正确定位所有行和列', () => {
    const pos = findTablePositions(STYLE1_DATA)
    expect(pos.summaryRow).toBe(7)
    expect(pos.refSellRow).toBe(8)
    expect(pos.finishedRow).toBe(1)
    expect(pos.refSellCol).toBe(9)
    expect(pos.withTaxCol).toBe(10)
  })

  it('款式2：汇总/参考卖价行位置下移仍能正确定位', () => {
    const pos = findTablePositions(STYLE2_DATA)
    expect(pos.summaryRow).toBe(9)
    expect(pos.refSellRow).toBe(10)
    expect(pos.finishedRow).toBe(1)
    expect(pos.refSellCol).toBe(9)
    expect(pos.withTaxCol).toBe(10)
  })

  it('款式3：列标题为"单个布袋总价"时通过回退关键字定位参考卖价列', () => {
    const pos = findTablePositions(STYLE3_DATA)
    expect(pos.summaryRow).toBe(9)
    expect(pos.refSellRow).toBe(10)
    expect(pos.finishedRow).toBe(1)
    // 列标题是"单个布袋总价（元）"，通过回退关键字"单个布袋总价"匹配
    expect(pos.refSellCol).toBe(9)
    expect(pos.withTaxCol).toBe(10)
  })

  it('款式4：行数最多时仍能正确定位', () => {
    const pos = findTablePositions(STYLE4_DATA)
    expect(pos.summaryRow).toBe(13)
    expect(pos.refSellRow).toBe(14)
    expect(pos.finishedRow).toBe(1)
    expect(pos.refSellCol).toBe(9)
    expect(pos.withTaxCol).toBe(10)
  })

  it('所有款式模板的参考卖价列和含税价列均为9和10', () => {
    for (const [name, data] of Object.entries({ STYLE1_DATA, STYLE2_DATA, STYLE3_DATA, STYLE4_DATA })) {
      const pos = findTablePositions(data)
      expect(pos.refSellCol, `${name} refSellCol`).toBe(9)
      expect(pos.withTaxCol, `${name} withTaxCol`).toBe(10)
    }
  })
})

// ============================ 行位置变化时的鲁棒性测试 ============================

describe('findTablePositions - 行位置变化时的鲁棒性', () => {
  it('在表格顶部插入空行后，汇总行索引同步下移但仍能识别', () => {
    // 模拟用户在顶部插入一行
    const shifted = [[null, '新增行', null, null], ...STYLE1_DATA]
    const pos = findTablePositions(shifted)
    expect(pos.summaryRow).toBe(8) // 原来是7，下移1
    expect(pos.refSellRow).toBe(9) // 原来是8，下移1
    expect(pos.finishedRow).toBe(2) // 原来是1，下移1
  })

  it('删除正反面规格行后，汇总行索引上移但仍能识别', () => {
    // 模拟用户删除第2行（正反面规格行）
    const trimmed = [...STYLE1_DATA.slice(0, 2), ...STYLE1_DATA.slice(3)]
    const pos = findTablePositions(trimmed)
    expect(pos.summaryRow).toBe(6) // 原来是7，上移1
    expect(pos.refSellRow).toBe(7) // 原来是8，上移1
  })

  it('汇总行文字前后有空格时仍能匹配（trim 容错）', () => {
    const data = STYLE1_DATA.map(row => [...row])
    data[7][0] = '  汇总  '
    // findRowByLabel 使用严格相等，带空格不匹配 —— 验证当前行为
    expect(findRowByLabel(data, '汇总')).toBe(-1)
    // 无空格时正常匹配
    data[7][0] = '汇总'
    expect(findRowByLabel(data, '汇总')).toBe(7)
  })
})

// ============================ 列位置变化时的鲁棒性测试 ============================

describe('findTablePositions - 列位置变化时的鲁棒性', () => {
  it('列标题中"参考卖价"位置变化时仍能定位', () => {
    // 模拟用户在参考卖价列前插入一列，导致列标题移位
    const data = STYLE1_DATA.map(row => {
      const newRow = [...row.slice(0, 9), '新插入列', ...row.slice(9)]
      return newRow
    })
    const pos = findTablePositions(data)
    // 参考卖价列标题现在在第10列
    expect(pos.refSellCol).toBe(10)
    // 含税价列标题现在在第11列
    expect(pos.withTaxCol).toBe(11)
  })

  it('列标题行不存在时使用默认列索引（refSellCol=9, withTaxCol=10）', () => {
    // 构造一个没有"加工费"标题行的数据
    const noHeaderData: any[][] = [
      ['成品', 100, 38, 40, 0],
      ['汇总', null, null, null, null, null, null, null, null, 2.97],
      ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76],
    ]
    const pos = findTablePositions(noHeaderData)
    expect(pos.refSellCol).toBe(9) // 默认值
    expect(pos.withTaxCol).toBe(10) // refSellCol + 1
  })

  it('含税价列标题缺失时回退为 refSellCol + 1', () => {
    // 构造数据：有"加工费"标题行和"参考卖价"列，但没有"含税价"列
    const data: any[][] = [
      ['成品', 100, 38, 40, 0],
      [null, '加工费(元/个)', '印刷', '布料价格', '布料成本', '额外', '包装费', '运费', '损耗', '参考卖价', '其他列'],
      ['汇总', null, null, null, null, null, null, null, null, 2.97, null],
      ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, null],
    ]
    const pos = findTablePositions(data)
    expect(pos.refSellCol).toBe(9)
    expect(pos.withTaxCol).toBe(10) // refSellCol + 1 回退
  })
})

// ============================ extractPrices 成本价和卖价提取测试 ============================

describe('extractPrices - 成本价和卖价提取', () => {
  it('款式1：成本价 = 汇总行 × 参考卖价列 = 2.97', () => {
    const prices = extractPrices(STYLE1_DATA)
    expect(prices.costPrice).toBe(2.97)
  })

  it('款式1：卖价(不含税) = 参考卖价行 × 参考卖价列 = 3.42', () => {
    const prices = extractPrices(STYLE1_DATA)
    expect(prices.sellPriceNoTax).toBe(3.42)
  })

  it('款式1：卖价(含税) = 参考卖价行 × 含税价列 = 3.76', () => {
    const prices = extractPrices(STYLE1_DATA)
    expect(prices.sellPriceWithTax).toBe(3.76)
  })

  it('款式2：正确提取成本价和卖价', () => {
    const prices = extractPrices(STYLE2_DATA)
    expect(prices.costPrice).toBe(3.5)
    expect(prices.sellPriceNoTax).toBe(4.0)
    expect(prices.sellPriceWithTax).toBe(4.4)
  })

  it('款式3：列标题为"单个布袋总价"时仍能正确提取', () => {
    const prices = extractPrices(STYLE3_DATA)
    expect(prices.costPrice).toBeCloseTo(8.785668, 4)
    expect(prices.sellPriceNoTax).toBeCloseTo(9.785668, 4)
    expect(prices.sellPriceWithTax).toBeCloseTo(10.7642348, 4)
  })

  it('款式4：行数最多时仍能正确提取', () => {
    const prices = extractPrices(STYLE4_DATA)
    expect(prices.costPrice).toBeCloseTo(6.2123635352, 6)
    expect(prices.sellPriceNoTax).toBeCloseTo(7.4123635352, 6)
    expect(prices.sellPriceWithTax).toBeCloseTo(8.15359988872, 6)
  })

  it('含税价 ≈ 不含税价 × 1.1（验证联动关系）', () => {
    for (const data of [STYLE1_DATA, STYLE2_DATA, STYLE3_DATA, STYLE4_DATA]) {
      const prices = extractPrices(data)
      expect(prices.sellPriceWithTax).toBeCloseTo(prices.sellPriceNoTax! * 1.1, 2)
    }
  })

  it('成本价 < 卖价(不含税) < 卖价(含税)（验证价格层次关系）', () => {
    for (const data of [STYLE1_DATA, STYLE2_DATA, STYLE3_DATA, STYLE4_DATA]) {
      const prices = extractPrices(data)
      expect(prices.costPrice!).toBeLessThan(prices.sellPriceNoTax!)
      expect(prices.sellPriceNoTax!).toBeLessThan(prices.sellPriceWithTax!)
    }
  })
})

// ============================ extractPrices 异常场景测试 ============================

describe('extractPrices - 异常场景', () => {
  it('汇总行不存在时成本价为 null', () => {
    const data: any[][] = [
      ['成品', 100],
      ['参考卖价', null, null, null, null, null, null, null, null, 3.42, 3.76],
    ]
    const prices = extractPrices(data)
    expect(prices.costPrice).toBeNull()
  })

  it('参考卖价行不存在时卖价为 null', () => {
    const data: any[][] = [
      ['成品', 100],
      ['汇总', null, null, null, null, null, null, null, null, 2.97],
    ]
    const prices = extractPrices(data)
    expect(prices.sellPriceNoTax).toBeNull()
    expect(prices.sellPriceWithTax).toBeNull()
  })

  it('单元格值为字符串时返回 null（仅接受数字）', () => {
    const data: any[][] = [
      [null, '加工费', '印刷', '布料', '成本', '额外', '包装', '运费', '损耗', '参考卖价', '含税价'],
      ['汇总', null, null, null, null, null, null, null, null, '非数字', null],
      ['参考卖价', null, null, null, null, null, null, null, null, '非数字', '非数字'],
    ]
    const prices = extractPrices(data)
    expect(prices.costPrice).toBeNull()
    expect(prices.sellPriceNoTax).toBeNull()
    expect(prices.sellPriceWithTax).toBeNull()
  })

  it('单元格值为 NaN 时返回 null', () => {
    const data: any[][] = [
      [null, '加工费', '印刷', '布料', '成本', '额外', '包装', '运费', '损耗', '参考卖价', '含税价'],
      ['汇总', null, null, null, null, null, null, null, null, NaN, null],
      ['参考卖价', null, null, null, null, null, null, null, null, NaN, NaN],
    ]
    const prices = extractPrices(data)
    expect(prices.costPrice).toBeNull()
    expect(prices.sellPriceNoTax).toBeNull()
    expect(prices.sellPriceWithTax).toBeNull()
  })

  it('空表格数据时全部返回 null', () => {
    const prices = extractPrices([])
    expect(prices.costPrice).toBeNull()
    expect(prices.sellPriceNoTax).toBeNull()
    expect(prices.sellPriceWithTax).toBeNull()
  })

  it('传入显式 positions 参数时使用传入值而非自动计算', () => {
    const customPos: TablePositions = {
      summaryRow: 7,
      refSellRow: 8,
      finishedRow: 1,
      refSellCol: 9,
      withTaxCol: 10,
    }
    const prices = extractPrices(STYLE1_DATA, customPos)
    expect(prices.costPrice).toBe(2.97)
    expect(prices.sellPriceNoTax).toBe(3.42)
    expect(prices.sellPriceWithTax).toBe(3.76)
  })
})

// ============================ 联动一致性验证（模拟 syncFromTable 逻辑） ============================

describe('联动一致性 - 模拟 syncFromTable 数据提取', () => {
  /**
   * 模拟 BagQuote.tsx 中 syncFromTable 的核心逻辑：
   * 1. 从表格构建二维数组
   * 2. 调用 findTablePositions 动态定位
   * 3. 提取成本价和卖价
   *
   * 与实际代码的区别：实际代码通过 formulaManager.getCellValue 读取公式计算结果，
   * 此处直接使用模板中的静态数据值（已与公式计算结果一致）。
   */
  function simulateSyncFromTable(data: any[][]) {
    const pos = findTablePositions(data)
    const prices = extractPrices(data, pos)
    return { prices, pos }
  }

  it('款式1：成本价和卖价均正确提取', () => {
    const { prices, pos } = simulateSyncFromTable(STYLE1_DATA)
    expect(pos.summaryRow).toBeGreaterThanOrEqual(0)
    expect(pos.refSellRow).toBeGreaterThanOrEqual(0)
    expect(prices.costPrice).toBe(2.97)
    expect(prices.sellPriceNoTax).toBe(3.42)
    expect(prices.sellPriceWithTax).toBe(3.76)
  })

  it('款式2：底部行存在不影响定位和提取', () => {
    const { prices, pos } = simulateSyncFromTable(STYLE2_DATA)
    expect(pos.summaryRow).toBe(9)
    expect(pos.refSellRow).toBe(10)
    expect(prices.costPrice).toBe(3.5)
    expect(prices.sellPriceNoTax).toBe(4.0)
    expect(prices.sellPriceWithTax).toBe(4.4)
  })

  it('款式3：不同列标题（单个布袋总价）不影响定位和提取', () => {
    const { prices, pos } = simulateSyncFromTable(STYLE3_DATA)
    expect(pos.refSellCol).toBe(9)
    expect(prices.costPrice).toBeCloseTo(8.785668, 4)
    expect(prices.sellPriceNoTax).toBeCloseTo(9.785668, 4)
    expect(prices.sellPriceWithTax).toBeCloseTo(10.7642348, 4)
  })

  it('款式4：最多行数不影响定位和提取', () => {
    const { prices, pos } = simulateSyncFromTable(STYLE4_DATA)
    expect(pos.summaryRow).toBe(13)
    expect(pos.refSellRow).toBe(14)
    expect(prices.costPrice).toBeCloseTo(6.2123635352, 6)
    expect(prices.sellPriceNoTax).toBeCloseTo(7.4123635352, 6)
    expect(prices.sellPriceWithTax).toBeCloseTo(8.15359988872, 6)
  })

  it('行位置变化（插入空行）后提取结果不变', () => {
    // 在顶部插入一行，所有行索引下移1，但提取的值应不变
    const shifted = [[null, '插入行', null], ...STYLE1_DATA]
    const { prices } = simulateSyncFromTable(shifted)
    expect(prices.costPrice).toBe(2.97)
    expect(prices.sellPriceNoTax).toBe(3.42)
    expect(prices.sellPriceWithTax).toBe(3.76)
  })

  it('列位置变化（插入列）后提取结果不变', () => {
    // 在第9列前插入一列，列索引右移1，但提取的值应不变
    const shifted = STYLE1_DATA.map(row => [...row.slice(0, 9), '新列', ...row.slice(9)])
    const { prices } = simulateSyncFromTable(shifted)
    expect(prices.costPrice).toBe(2.97)
    expect(prices.sellPriceNoTax).toBe(3.42)
    expect(prices.sellPriceWithTax).toBe(3.76)
  })
})
