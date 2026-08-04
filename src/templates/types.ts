/**
 * 在线表格模板类型定义
 *
 * 设计思路：
 *   - 将原 BagQuote.tsx 中的 SheetTemplate 接口提取为独立类型文件
 *   - 供 SheetTemplateManager 和调用方共享类型
 *
 * 数据来源：帆布袋价格试算表-规格试算.xlsx sheet1
 */

export interface SheetTemplate {
  /** 表格二维数据（行 × 列） */
  data: (string | number | null)[][]
  /** 公式映射：key = Excel 单元格地址（如 "B3"），value = 公式字符串（如 "=B2"） */
  formulas: Record<string, string>
}
