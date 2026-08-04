/**
 * 在线表格样式常量类
 *
 * 设计思路：
 *   - 将 BagQuote.tsx 中的 SC（颜色常量）、BORDER（边框常量）封装为独立类
 *   - 提供构建单元格样式的工厂方法，统一样式生成逻辑
 *   - 颜色和边框使用 static readonly，保证不可变性
 *
 * 来源：帆布袋价格试算表-规格试算.xlsx sheet1
 */

export class StyleConstants {
  /** 颜色调色板 */
  static readonly COLORS = {
    yellow: '#FFFF00',
    blue: '#91AADF',
    orange: '#F4B382',
    darkOrange: '#EE822F',
    lightOrange: '#F8CBAD',
    red: '#FF0000',
    black: '#000000',
    headerBg: '#4472C4',
    headerColor: '#FFFFFF',
    /** 公式单元格背景色（浅橙）：实时标识含公式的单元格 */
    formulaBg: '#F8CBAD',
  } as const

  /** 边框样式 */
  static readonly BORDER = {
    borderColor: StyleConstants.COLORS.black,
    borderLineWidth: 1,
  } as const

  /**
   * 构建单元格样式（字体统一加大4号、加粗）
   * 与原 BagQuote.tsx 中的 cs() 函数逻辑完全一致
   *
   * @param bg 背景色（可选）
   * @param color 字体颜色，默认黑色
   * @param size 字体基础大小（实际渲染为 size+4），默认 10
   * @param bold 是否加粗，默认 true
   * @param border 是否添加边框，默认 true
   */
  static buildCellStyle(
    bg?: string,
    color: string = StyleConstants.COLORS.black,
    size: number = 10,
    bold: boolean = true,
    border: boolean = true,
  ): Record<string, unknown> {
    return {
      bgColor: bg,
      color,
      fontSize: size + 4,
      fontWeight: bold ? 'bold' : 'normal',
      ...(border ? StyleConstants.BORDER : {}),
    }
  }

  /**
   * 构建标题行样式（蓝底白字）
   */
  static buildHeaderStyle(): Record<string, unknown> {
    return StyleConstants.buildCellStyle(
      StyleConstants.COLORS.headerBg,
      StyleConstants.COLORS.headerColor,
    )
  }

  /**
   * 构建公式单元格样式（浅橙背景）
   */
  static buildFormulaStyle(): Record<string, unknown> {
    return StyleConstants.buildCellStyle(
      StyleConstants.COLORS.formulaBg,
    )
  }
}
