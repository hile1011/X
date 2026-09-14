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
   * 在线表格「新建初始化」的默认行数（VTable-Sheet rowCount 为「最小行数」语义：
   * 数据不足时补空行到该值，数据更多时按数据实际行数展示）。
   * 仅在新建场景使用：新建订单 / 切换款式模板 / 新增模板首次打开 / 订单表格版（始终以模板数据初始化）。
   * 编辑已保存数据时按实际数据行数设置 rowCount（不自动补齐），
   * 以尊重用户手动删除空白行后的状态（2026-09-14 需求，同日默认值由 25 调整为 20）。
   * 统一在此定义，三处页面引用同一常量，避免硬编码漂移。
   */
  static readonly DEFAULT_ROW_COUNT = 20

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
