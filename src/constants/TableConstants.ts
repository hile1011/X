/**
 * 在线表格常量类
 *
 * 设计思路：
 *   - 将 BagQuote.tsx 中的 SHEET_KEY、COL_WIDTHS 常量封装为独立类
 *   - 提供列数查询等便捷方法
 */

export class TableConstants {
  /** VTable Sheet 的 key 标识 */
  static readonly SHEET_KEY = 'sheet1'

  /**
   * 各列宽度配置（16 列）
   * 来源：帆布袋价格试算表-规格试算.xlsx sheet1
   */
  static readonly COL_WIDTHS: readonly number[] = [
    100, 90, 80, 80, 80, 90, 90, 90, 90, 90, 80, 120, 110, 130, 100, 120,
  ]

  /**
   * 获取表格列数
   */
  static getColumnCount(): number {
    return TableConstants.COL_WIDTHS.length
  }

  /**
   * 获取指定列的宽度
   */
  static getColumnWidth(col: number): number | undefined {
    return TableConstants.COL_WIDTHS[col]
  }
}
