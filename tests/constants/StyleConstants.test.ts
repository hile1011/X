/**
 * StyleConstants 常量类单元测试
 *
 * 测试目标：
 *   - COLORS 颜色值正确性
 *   - BORDER 边框样式正确性
 *   - buildCellStyle() 单元格样式构建
 *   - buildHeaderStyle() 标题行样式构建
 *   - buildFormulaStyle() 公式单元格样式构建
 */
import { describe, it, expect } from 'vitest'
import { StyleConstants } from '../../src/constants/StyleConstants'

describe('StyleConstants.COLORS - 颜色值', () => {
  it('yellow = #FFFF00', () => {
    expect(StyleConstants.COLORS.yellow).toBe('#FFFF00')
  })

  it('blue = #91AADF', () => {
    expect(StyleConstants.COLORS.blue).toBe('#91AADF')
  })

  it('orange = #F4B382', () => {
    expect(StyleConstants.COLORS.orange).toBe('#F4B382')
  })

  it('darkOrange = #EE822F', () => {
    expect(StyleConstants.COLORS.darkOrange).toBe('#EE822F')
  })

  it('lightOrange = #F8CBAD', () => {
    expect(StyleConstants.COLORS.lightOrange).toBe('#F8CBAD')
  })

  it('red = #FF0000', () => {
    expect(StyleConstants.COLORS.red).toBe('#FF0000')
  })

  it('black = #000000', () => {
    expect(StyleConstants.COLORS.black).toBe('#000000')
  })

  it('headerBg = #4472C4', () => {
    expect(StyleConstants.COLORS.headerBg).toBe('#4472C4')
  })

  it('headerColor = #FFFFFF', () => {
    expect(StyleConstants.COLORS.headerColor).toBe('#FFFFFF')
  })

  it('formulaBg = #F8CBAD（与 lightOrange 相同）', () => {
    expect(StyleConstants.COLORS.formulaBg).toBe('#F8CBAD')
    expect(StyleConstants.COLORS.formulaBg).toBe(StyleConstants.COLORS.lightOrange)
  })
})

describe('StyleConstants.BORDER - 边框样式', () => {
  it('borderColor = #000000', () => {
    expect(StyleConstants.BORDER.borderColor).toBe('#000000')
  })

  it('borderLineWidth = 1', () => {
    expect(StyleConstants.BORDER.borderLineWidth).toBe(1)
  })

  it('borderColor 与 COLORS.black 一致', () => {
    expect(StyleConstants.BORDER.borderColor).toBe(StyleConstants.COLORS.black)
  })
})

describe('StyleConstants.buildCellStyle - 构建单元格样式', () => {
  it('默认参数：无背景、黑色、14号字体、加粗、带边框', () => {
    const style = StyleConstants.buildCellStyle()
    expect(style.bgColor).toBeUndefined()
    expect(style.color).toBe('#000000')
    expect(style.fontSize).toBe(14) // size=10 + 4
    expect(style.fontWeight).toBe('bold')
    expect(style.borderColor).toBe('#000000')
    expect(style.borderLineWidth).toBe(1)
  })

  it('指定背景色', () => {
    const style = StyleConstants.buildCellStyle('#FFFF00')
    expect(style.bgColor).toBe('#FFFF00')
  })

  it('指定字体颜色', () => {
    const style = StyleConstants.buildCellStyle(undefined, '#FF0000')
    expect(style.color).toBe('#FF0000')
  })

  it('指定字体大小（自动+4）', () => {
    const style = StyleConstants.buildCellStyle(undefined, undefined, 12)
    expect(style.fontSize).toBe(16) // 12 + 4
  })

  it('bold=false 时不加粗', () => {
    const style = StyleConstants.buildCellStyle(undefined, undefined, 10, false)
    expect(style.fontWeight).toBe('normal')
  })

  it('border=false 时不包含边框', () => {
    const style = StyleConstants.buildCellStyle(undefined, undefined, 10, true, false)
    expect(style.borderColor).toBeUndefined()
    expect(style.borderLineWidth).toBeUndefined()
  })

  it('全部参数自定义', () => {
    const style = StyleConstants.buildCellStyle('#4472C4', '#FFFFFF', 8, true, true)
    expect(style.bgColor).toBe('#4472C4')
    expect(style.color).toBe('#FFFFFF')
    expect(style.fontSize).toBe(12) // 8 + 4
    expect(style.fontWeight).toBe('bold')
    expect(style.borderColor).toBe('#000000')
  })
})

describe('StyleConstants.buildHeaderStyle - 标题行样式', () => {
  it('蓝底白字', () => {
    const style = StyleConstants.buildHeaderStyle()
    expect(style.bgColor).toBe('#4472C4')
    expect(style.color).toBe('#FFFFFF')
    expect(style.fontWeight).toBe('bold')
    expect(style.borderColor).toBe('#000000')
  })
})

describe('StyleConstants.buildFormulaStyle - 公式单元格样式', () => {
  it('浅橙背景', () => {
    const style = StyleConstants.buildFormulaStyle()
    expect(style.bgColor).toBe('#F8CBAD')
  })

  it('与 buildCellStyle(formulaBg) 一致', () => {
    const formulaStyle = StyleConstants.buildFormulaStyle()
    const manualStyle = StyleConstants.buildCellStyle(StyleConstants.COLORS.formulaBg)
    expect(formulaStyle.bgColor).toBe(manualStyle.bgColor)
  })
})
