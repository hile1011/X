/**
 * AI 智能下单 → 在线表格填充服务（src/services/aiTableFill.ts）单元测试
 *
 * 覆盖：
 *  - parseAiTableFill：规格文本宽松解析（* × x X 分隔、小数、带单位、千分位、
 *    2 段/3 段规格、无底不覆盖）、数量文本解析（纯数字/带单位/逗号/非法值）
 *  - applyAiFillToTableData：成品行定位写入、表头关键字动态定位列、
 *    未解析字段保留模板默认值、克隆不改入参（模板缓存保护）、
 *    无成品行/空填充的安全回退
 */
import { describe, it, expect } from 'vitest'
import {
  parseAiTableFill,
  applyAiFillToTableData,
  applyAiTableCellsToTableData,
  isAiTableFillEmpty,
  type AiTableFill,
} from '../src/services/aiTableFill'
import type { AiTableCell } from '../src/types'

/** 款式 1 模板数据结构（表头 + 成品/正反面/手提 + 成本区） */
const TEMPLATE_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 1000, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 1000, 38, 40, 0, 3, 10, 41, 90, 154, 340, 31, 316, 3.76, 160.97, 1942.34],
  ['手提', 1000, 2.5, 65, 0, null, null, 6, 65, 154, 340, 4, 55, 25.67, 27.85, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.44, 5.2, 1.74, 0.05, 0.1, 128.78, 1.05, 3.03, null, null, null, null, null, null],
]

// ============================================================
// parseAiTableFill - 规格解析
// ============================================================
describe('parseAiTableFill - 规格解析', () => {
  it('3 段规格（* 分隔，带 cm 单位）', () => {
    const fill = parseAiTableFill('40*35*10cm', '5000')
    expect(fill).toEqual({ quantity: 5000, width: 40, height: 35, bottom: 10 })
  })

  it('2 段规格：底为 null（不覆盖模板默认值）', () => {
    const fill = parseAiTableFill('38*40', '1000')
    expect(fill.width).toBe(38)
    expect(fill.height).toBe(40)
    expect(fill.bottom).toBeNull()
  })

  it('× / x / X 分隔与两侧空白', () => {
    expect(parseAiTableFill('45×35×15', '500').width).toBe(45)
    expect(parseAiTableFill('38 x 40 x 8CM', '500').bottom).toBe(8)
    expect(parseAiTableFill('38X40', '500').height).toBe(40)
  })

  it('小数规格', () => {
    const fill = parseAiTableFill('33.5*28.2*15', '100')
    expect(fill).toEqual({ quantity: 100, width: 33.5, height: 28.2, bottom: 15 })
  })

  it('混杂文本中的规格提取（AI 返回描述性文本）', () => {
    const fill = parseAiTableFill('袋子尺寸 40*35*10cm 双面印刷', '5000个')
    expect(fill.width).toBe(40)
    expect(fill.height).toBe(35)
    expect(fill.bottom).toBe(10)
  })

  it('无法解析的规格：全 null（不误写）', () => {
    const fill = parseAiTableFill('按图片定做', '5000')
    expect(fill.width).toBeNull()
    expect(fill.height).toBeNull()
    expect(fill.bottom).toBeNull()
    expect(fill.quantity).toBe(5000)
  })

  it('非字符串规格输入安全回退', () => {
    const fill = parseAiTableFill(undefined, undefined)
    expect(isAiTableFillEmpty(fill)).toBe(true)
  })
})

// ============================================================
// parseAiTableFill - 数量解析
// ============================================================
describe('parseAiTableFill - 数量解析', () => {
  it('纯数字字符串', () => {
    expect(parseAiTableFill('', '5000').quantity).toBe(5000)
  })

  it('带单位："5000个" / "约 3,000 件"', () => {
    expect(parseAiTableFill('', '5000个').quantity).toBe(5000)
    expect(parseAiTableFill('', '约 3,000 件').quantity).toBe(3000)
  })

  it('数字类型输入', () => {
    expect(parseAiTableFill('', 7200).quantity).toBe(7200)
  })

  it('非法数量：0 / 负数 / 无数字 → null', () => {
    expect(parseAiTableFill('', '0').quantity).toBeNull()
    expect(parseAiTableFill('', '-100').quantity).toBeNull()
    expect(parseAiTableFill('', '待定').quantity).toBeNull()
  })
})

// ============================================================
// applyAiFillToTableData - 表格填充
// ============================================================
describe('applyAiFillToTableData - 表格填充', () => {
  it('写入成品行的 数量/宽/高/底（动态定位行与列）', () => {
    const fill: AiTableFill = { quantity: 5000, width: 40, height: 35, bottom: 10 }
    const result = applyAiFillToTableData(TEMPLATE_DATA, fill)
    expect(result[1]).toEqual(['成品', 5000, 40, 35, 10, null, null, null, null, null, null, null, null, null, null, null])
  })

  it('部件行（正反面/手提）由模板公式级联，填充时不改写', () => {
    const fill: AiTableFill = { quantity: 5000, width: 40, height: 35, bottom: 10 }
    const result = applyAiFillToTableData(TEMPLATE_DATA, fill)
    // 模板公式 B3='=B2' 等在公式引擎中级联，填充层不改写部件行静态值
    expect(result[2][1]).toBe(1000)
    expect(result[3][1]).toBe(1000)
  })

  it('2 段规格：底保留模板默认值（null 不覆盖）', () => {
    const fill: AiTableFill = { quantity: 2000, width: 42, height: 38, bottom: null }
    const result = applyAiFillToTableData(TEMPLATE_DATA, fill)
    expect(result[1][1]).toBe(2000)
    expect(result[1][2]).toBe(42)
    expect(result[1][3]).toBe(38)
    expect(result[1][4]).toBe(0) // 模板默认底 0 保留
  })

  it('克隆写入：不修改入参（模板缓存保护）', () => {
    const fill: AiTableFill = { quantity: 5000, width: 40, height: 35, bottom: 10 }
    const original = TEMPLATE_DATA.map((r) => [...r])
    const result = applyAiFillToTableData(TEMPLATE_DATA, fill)
    expect(TEMPLATE_DATA).toEqual(original) // 入参未被修改
    expect(result).not.toBe(TEMPLATE_DATA) // 返回新数组
    expect(result[1]).not.toBe(TEMPLATE_DATA[1]) // 行也是克隆
  })

  it('空填充（全 null）返回克隆原样', () => {
    const fill: AiTableFill = { quantity: null, width: null, height: null, bottom: null }
    const result = applyAiFillToTableData(TEMPLATE_DATA, fill)
    expect(result).toEqual(TEMPLATE_DATA)
    expect(result).not.toBe(TEMPLATE_DATA)
  })

  it('无成品行的表格：安全返回克隆', () => {
    const noFinished: (string | number | null)[][] = [
      [null, '数量 (个)', '宽(CM)', '高(CM)'],
      ['正反面', 100, 30, 40],
    ]
    const fill: AiTableFill = { quantity: 500, width: 40, height: 35, bottom: null }
    const result = applyAiFillToTableData(noFinished, fill)
    expect(result).toEqual(noFinished) // 无成品行不写入
  })

  it('仅数量可解析时只写数量列', () => {
    const fill = parseAiTableFill('按图片定做', '8000')
    const result = applyAiFillToTableData(TEMPLATE_DATA, fill)
    expect(result[1][1]).toBe(8000)
    expect(result[1][2]).toBe(38) // 宽保留模板值
    expect(result[1][3]).toBe(40)
  })
})

// ============================================================
// applyAiTableCellsToTableData - 单元格级填充（双区动态定位）
// ============================================================
describe('applyAiTableCellsToTableData - 单元格级填充', () => {
  it('规格区：成品行数量/宽 + 部件行克重/门幅/出血 + 手提行宽', () => {
    const cells: AiTableCell[] = [
      { row: '成品', col: '数量', value: 5000 },
      { row: '成品', col: '宽', value: 40 },
      { row: '正反面', col: '克重', value: 340 },
      { row: '正反面', col: '布料门幅', value: 154 },
      { row: '正反面', col: '宽出血', value: 3 },
      { row: '手提', col: '宽', value: 2.5 },
    ]
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, cells)
    expect(result[1][1]).toBe(5000)   // 成品 数量
    expect(result[1][2]).toBe(40)     // 成品 宽
    expect(result[2][10]).toBe(340)   // 正反面 克重
    expect(result[2][9]).toBe(154)    // 正反面 布料门幅
    expect(result[2][5]).toBe(3)      // 正反面 宽出血
    expect(result[3][2]).toBe(2.5)    // 手提 宽
  })

  it('成本区：布料价格/印刷双面写入部件成本行（同名行按列名区分区域）', () => {
    const cells: AiTableCell[] = [
      { row: '正反面', col: '布料价格', value: 6.8 },
      { row: '正反面', col: '印刷双面', value: 0.99 },
    ]
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, cells)
    expect(result[5][3]).toBe(6.8)    // 成本区正反面 布料价格（col 3）
    expect(result[5][2]).toBe(0.99)   // 成本区正反面 印刷双面（col 2）
    // 规格区正反面行不受影响（克重等列保持模板值）
    expect(result[2][10]).toBe(340)
  })

  it('数字字符串值自动转 number（"340" → 340）', () => {
    const cells: AiTableCell[] = [{ row: '正反面', col: '克重', value: '340' }]
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, cells)
    expect(result[2][10]).toBe(340)
  })

  it('非数字字符串保留原文（如备注类文本）', () => {
    const cells: AiTableCell[] = [{ row: '正反面', col: '克重', value: '待定' }]
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, cells)
    expect(result[2][10]).toBe('待定')
  })

  it('行/列无法定位时跳过（AI 幻觉防护）', () => {
    const cells: AiTableCell[] = [
      { row: '不存在的行', col: '克重', value: 340 },
      { row: '正反面', col: '不存在的列', value: 340 },
    ]
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, cells)
    expect(result).toEqual(TEMPLATE_DATA) // 全部跳过，仅克隆
  })

  it('行标签模糊匹配（AI 简写「阴阳手提」→ 模板行「阴阳手提-本色」）', () => {
    const data: (string | number | null)[][] = [
      [null, '数量 (个)', '宽(CM)', '高(CM)', '克重'],
      ['成品', 500, 45, 35, null],
      ['阴阳手提-本色', 500, 3.5, 120, 450],
    ]
    const cells: AiTableCell[] = [{ row: '阴阳手提', col: '克重', value: 450 }]
    const result = applyAiTableCellsToTableData(data, cells)
    expect(result[2][4]).toBe(450)
  })

  it('克隆写入：不修改入参', () => {
    const original = TEMPLATE_DATA.map((r) => [...r])
    const cells: AiTableCell[] = [{ row: '成品', col: '数量', value: 9999 }]
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, cells)
    expect(TEMPLATE_DATA).toEqual(original)
    expect(result).not.toBe(TEMPLATE_DATA)
  })

  it('空 cells 数组返回克隆原样', () => {
    const result = applyAiTableCellsToTableData(TEMPLATE_DATA, [])
    expect(result).toEqual(TEMPLATE_DATA)
    expect(result).not.toBe(TEMPLATE_DATA)
  })
})
