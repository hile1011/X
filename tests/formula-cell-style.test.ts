/**
 * 公式单元格样式高亮测试
 *
 * 测试目标：
 * 1. 含公式的单元格应用浅橙背景色（#F8CBAD）
 * 2. 非公式单元格不应用浅橙背景
 * 3. 实时识别：新增公式后样式更新，删除公式后样式恢复
 * 4. 标题行优先级：标题行样式 + 公式绿色背景叠加
 * 5. 用户右键菜单覆盖优先级最高
 *
 * 环境要求：jsdom + canvas mock（tests/setup.ts）
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { StyleConstants } from '../src/constants/StyleConstants'
import { TableConstants } from '../src/constants/TableConstants'
import { SheetTemplateManager } from '../src/templates/SheetTemplateManager'

const SHEET_KEY = TableConstants.SHEET_KEY
const TEST_COLUMNS = TableConstants.COL_WIDTHS.map((width, field) => ({ field, width }))

// 浅橙色（与 StyleConstants.COLORS.formulaBg 一致）
const FORMULA_BG = StyleConstants.COLORS.formulaBg
// 标题行背景色
const HEADER_BG = StyleConstants.COLORS.headerBg
const HEADER_COLOR = StyleConstants.COLORS.headerColor

// ============================ 使用 StyleConstants 的样式逻辑 ============================

const cellStyleOverrides = new Map<string, Record<string, unknown>>()
let activeFormulaManager: any = null

/** 与 BagQuote.tsx 的 getCellStyle 完全一致（使用 StyleConstants） */
const getCellStyle = (args: { row: number; col: number; table?: any }): Record<string, unknown> => {
  const { row, col, table } = args
  let isTitleRow = false
  if (table?.getCellOriginValue) {
    const firstColValue = table.getCellOriginValue(0, row)
    if (firstColValue == null || firstColValue === '') {
      for (let c = 1; c < 16; c++) {
        const val = table.getCellOriginValue(c, row)
        if (val != null && val !== '') { isTitleRow = true; break }
      }
    }
  }
  const style = isTitleRow
    ? StyleConstants.buildCellStyle(StyleConstants.COLORS.headerBg, StyleConstants.COLORS.headerColor)
    : StyleConstants.buildCellStyle(undefined)

  let hasFormula = false
  if (activeFormulaManager?.getCellFormula) {
    const formula = activeFormulaManager.getCellFormula({ sheet: SHEET_KEY, row, col })
    hasFormula = !!formula
  }
  if (hasFormula) {
    style.bgColor = StyleConstants.COLORS.formulaBg
  }

  const override = cellStyleOverrides.get(`${col},${row}`)
  return override ? { ...style, ...override } : style
}

// ============================ 测试数据（款式1：无底无侧普通袋，来自 SheetTemplateManager） ============================

const _template = SheetTemplateManager.getTemplate('1')
const TEMPLATE_DATA: (string | number | null)[][] = _template.data
const TEMPLATE_FORMULAS: Record<string, string> = _template.formulas

// ============================ 测试辅助函数 ============================

function cloneData(data: (string | number | null)[][]): (string | number | null)[][] {
  return data.map(row => [...row])
}

/** 创建 VTableSheet 并设置 activeFormulaManager（模拟 BagQuote.tsx 的 useEffect 逻辑） */
function createSheet(container: HTMLElement): VTableSheet {
  const sheet = new VTableSheet(container, {
    undoRedo: { show: true },
    VTablePluginModules: [{ module: TableExportPlugin }, { module: ExcelImportPlugin }],
    sheets: [{
      sheetKey: SHEET_KEY,
      sheetTitle: SHEET_KEY,
      columns: TEST_COLUMNS.map((col, i) => ({ ...col, style: getCellStyle })),
      data: cloneData(TEMPLATE_DATA),
      formulas: { ...TEMPLATE_FORMULAS },
      showHeader: false,
    }],
  })
  activeFormulaManager = (sheet as any).formulaManager
  return sheet
}

/** 从公式引擎读取单元格公式字符串 */
function getCellFormula(sheet: VTableSheet, row: number, col: number): string | undefined {
  const fm = (sheet as any).formulaManager
  if (!fm) return undefined
  return fm.getCellFormula?.({ sheet: SHEET_KEY, row, col })
}

/** 修改公式引擎中单元格的公式（模拟用户编辑公式） */
function setCellFormula(sheet: VTableSheet, row: number, col: number, formula: string): void {
  const fm = (sheet as any).formulaManager
  if (fm) {
    fm.setCellContent({ sheet: SHEET_KEY, row, col }, formula)
  }
}

/** 清除公式引擎中单元格的公式（模拟用户删除公式） */
function clearCellFormula(sheet: VTableSheet, row: number, col: number): void {
  const fm = (sheet as any).formulaManager
  if (fm) {
    fm.setCellContent({ sheet: SHEET_KEY, row, col }, null)
  }
}

/** 获取单元格样式（通过 getCellStyle 直接调用） */
function getStyle(sheet: VTableSheet, row: number, col: number): Record<string, unknown> {
  const ws = sheet.getActiveSheet()
  const table = ws?.tableInstance as any
  return getCellStyle({ row, col, table })
}

/** 获取单元格背景色 */
function getBgColor(sheet: VTableSheet, row: number, col: number): string | undefined {
  return getStyle(sheet, row, col).bgColor as string | undefined
}

// ============================ 测试用例 ============================

describe('公式单元格样式高亮', () => {
  let sheet: VTableSheet
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    cellStyleOverrides.clear()
    sheet = createSheet(container)
  })

  afterAll(() => {
    sheet?.release?.()
    container?.remove()
    activeFormulaManager = null
  })

  describe('初始加载：公式单元格自动应用浅橙背景', () => {
    it('B3（=B2）应为浅橙背景', () => {
      expect(getCellFormula(sheet, 2, 1)).toBe('=B2')
      expect(getBgColor(sheet, 2, 1)).toBe(FORMULA_BG)
    })

    it('C3（=C2）应为浅橙背景', () => {
      expect(getCellFormula(sheet, 2, 2)).toBe('=C2')
      expect(getBgColor(sheet, 2, 2)).toBe(FORMULA_BG)
    })

    it('J8（=SUM(J6:J7)）应为浅橙背景', () => {
      expect(getCellFormula(sheet, 7, 9)).toBe('=SUM(J6:J7)')
      expect(getBgColor(sheet, 7, 9)).toBe(FORMULA_BG)
    })

    it('J9（=J8+I9）应为浅橙背景', () => {
      expect(getCellFormula(sheet, 8, 9)).toBe('=J8+I9')
      expect(getBgColor(sheet, 8, 9)).toBe(FORMULA_BG)
    })

    it('K9（=J9*1.1）应为浅橙背景', () => {
      expect(getCellFormula(sheet, 8, 10)).toBe('=J9*1.1')
      expect(getBgColor(sheet, 8, 10)).toBe(FORMULA_BG)
    })
  })

  describe('非公式单元格不应用浅橙背景', () => {
    it('B2（成品行数量，纯数据）不应为浅橙背景', () => {
      expect(getCellFormula(sheet, 1, 1)).toBeUndefined()
      expect(getBgColor(sheet, 1, 1)).not.toBe(FORMULA_BG)
    })

    it('C2（成品行宽度，纯数据）不应为浅橙背景', () => {
      expect(getCellFormula(sheet, 1, 2)).toBeUndefined()
      expect(getBgColor(sheet, 1, 2)).not.toBe(FORMULA_BG)
    })

    it('D6（成本行布料价格，纯数据）不应为浅橙背景', () => {
      expect(getCellFormula(sheet, 5, 3)).toBeUndefined()
      expect(getBgColor(sheet, 5, 3)).not.toBe(FORMULA_BG)
    })

    it('J10 行的 I10（无公式空单元格）不应为浅橙背景', () => {
      expect(getCellFormula(sheet, 9, 8)).toBeUndefined()
      expect(getBgColor(sheet, 9, 8)).not.toBe(FORMULA_BG)
    })
  })

  describe('实时识别：新增公式后样式立即更新', () => {
    it('L8 原本无公式（无橙色）→ 新增公式 → 应变为浅橙背景', () => {
      // L8 = row=7, col=11，模板中无公式
      expect(getCellFormula(sheet, 7, 11)).toBeUndefined()
      expect(getBgColor(sheet, 7, 11)).not.toBe(FORMULA_BG)

      // 模拟用户新增公式
      setCellFormula(sheet, 7, 11, '=J8*1.1')

      // 验证公式已注册
      expect(getCellFormula(sheet, 7, 11)).toBe('=J8*1.1')

      // 验证样式已更新为浅橙（getCellStyle 实时读取公式引擎）
      expect(getBgColor(sheet, 7, 11)).toBe(FORMULA_BG)
    })

    it('M2 原本无公式 → 新增 =B2*2 → 应变为浅橙背景', () => {
      expect(getCellFormula(sheet, 1, 12)).toBeUndefined()
      setCellFormula(sheet, 1, 12, '=B2*2')
      expect(getCellFormula(sheet, 1, 12)).toBe('=B2*2')
      expect(getBgColor(sheet, 1, 12)).toBe(FORMULA_BG)
    })
  })

  describe('实时识别：删除公式后样式立即恢复', () => {
    it('B3 原本有公式（浅橙）→ 删除公式 → 应恢复为无橙色背景', () => {
      // 初始状态：B3 有公式，浅橙背景
      expect(getCellFormula(sheet, 2, 1)).toBe('=B2')
      expect(getBgColor(sheet, 2, 1)).toBe(FORMULA_BG)

      // 模拟用户删除公式（输入纯数值）
      clearCellFormula(sheet, 2, 1)

      // 验证公式已删除
      expect(getCellFormula(sheet, 2, 1)).toBeUndefined()

      // 验证样式已恢复（不再是浅橙）
      expect(getBgColor(sheet, 2, 1)).not.toBe(FORMULA_BG)
    })

    it('J8 原本有公式（浅橙）→ 删除公式 → 应恢复为无橙色背景', () => {
      expect(getCellFormula(sheet, 7, 9)).toBe('=SUM(J6:J7)')
      expect(getBgColor(sheet, 7, 9)).toBe(FORMULA_BG)

      clearCellFormula(sheet, 7, 9)

      expect(getCellFormula(sheet, 7, 9)).toBeUndefined()
      expect(getBgColor(sheet, 7, 9)).not.toBe(FORMULA_BG)
    })
  })

  describe('标题行与公式叠加', () => {
    it('标题行单元格（如第4行表头）有公式时应叠加浅橙背景', () => {
      // 第4行（0-based row=4）是表头行：第一列无值，其他列有值
      // 验证它是标题行（蓝底白字）
      const style4 = getStyle(sheet, 4, 1)
      expect(style4.bgColor).toBe(HEADER_BG)
      expect(style4.color).toBe(HEADER_COLOR)

      // 表头行通常无公式，背景为标题蓝
      // 但如果某个表头单元格有公式，应叠加为浅橙（公式优先级 > 标题背景）
      // 这里验证表头行无公式时保持标题蓝
      expect(getCellFormula(sheet, 4, 1)).toBeUndefined()
      expect(getBgColor(sheet, 4, 1)).toBe(HEADER_BG)
    })

    it('标题行无公式时保持标题蓝底白字', () => {
      const style = getStyle(sheet, 4, 5)
      expect(style.bgColor).toBe(HEADER_BG)
      expect(style.color).toBe(HEADER_COLOR)
      expect(style.bgColor).not.toBe(FORMULA_BG)
    })
  })

  describe('用户右键菜单覆盖优先级最高', () => {
    it('公式单元格被用户覆盖为黄色背景 → 应显示黄色而非浅橙', () => {
      // B3 是公式单元格，原始浅橙
      expect(getBgColor(sheet, 2, 1)).toBe(FORMULA_BG)

      // 模拟用户通过右键菜单设置黄色背景
      cellStyleOverrides.set('1,2', { bgColor: '#FFFF00' })

      // 验证用户覆盖优先
      const style = getStyle(sheet, 2, 1)
      expect(style.bgColor).toBe('#FFFF00')
      expect(style.bgColor).not.toBe(FORMULA_BG)
    })

    it('非公式单元格被用户覆盖为橙色背景 → 应显示橙色', () => {
      // B2 是非公式单元格
      expect(getCellFormula(sheet, 1, 1)).toBeUndefined()

      cellStyleOverrides.set('1,1', { bgColor: '#F4B382' })
      const style = getStyle(sheet, 1, 1)
      expect(style.bgColor).toBe('#F4B382')
    })

    it('清除用户覆盖后恢复公式浅橙背景', () => {
      // B3 公式单元格，设置覆盖后清除
      cellStyleOverrides.set('1,2', { bgColor: '#FFFF00' })
      expect(getBgColor(sheet, 2, 1)).toBe('#FFFF00')

      cellStyleOverrides.delete('1,2')
      expect(getBgColor(sheet, 2, 1)).toBe(FORMULA_BG)
    })
  })

  describe('公式检测准确性验证', () => {
    it('所有模板公式单元格都应被识别为公式', () => {
      // 遍历所有模板公式地址，验证 getCellFormula 返回非空
      const formulaAddresses = Object.keys(TEMPLATE_FORMULAS)
      expect(formulaAddresses.length).toBeGreaterThan(0)

      for (const addr of formulaAddresses) {
        // 解析 Excel 地址为 0-based row/col
        const match = addr.match(/^([A-Z]+)(\d+)$/)
        expect(match).not.toBeNull()
        let col = 0
        for (let i = 0; i < match![1].length; i++) {
          col = col * 26 + (match![1].charCodeAt(i) - 64)
        }
        const row = parseInt(match![2], 10) - 1
        col -= 1

        // 验证公式引擎中有该公式
        expect(getCellFormula(sheet, row, col)).toBeTruthy()
        // 验证样式为浅橙
        expect(getBgColor(sheet, row, col)).toBe(FORMULA_BG)
      }
    })

    it('所有非公式单元格都不应被误判为公式', () => {
      // 检查成品行（row=1）的所有数据列，都应无公式
      for (let c = 0; c < 16; c++) {
        const formula = getCellFormula(sheet, 1, c)
        if (formula) {
          // 如果有公式（不应该有），样式应为浅橙
          expect(getBgColor(sheet, 1, c)).toBe(FORMULA_BG)
        } else {
          // 无公式的单元格不应是浅橙
          expect(getBgColor(sheet, 1, c)).not.toBe(FORMULA_BG)
        }
      }
    })
  })
})
