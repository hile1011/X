/**
 * 日期工具类
 *
 * 设计思路：
 *   - 将原 BagQuote.tsx 中未导出的 addDaysToDate 封装为独立工具类
 *   - 新增 today() 方法封装重复的日期获取逻辑
 *
 * 用途：订单结束日期 = 开始日期 + 大货天数
 */

export class DateUtils {
  /**
   * 日期加天数：返回 YYYY-MM-DD 格式
   * - 空日期、天数为 0 或 NaN 时返回空字符串
   * - 无效日期返回空字符串
   * - 支持负数天数（回退日期）
   */
  static addDays(dateStr: string, days: number): string {
    if (!dateStr || !days || isNaN(days)) return ''
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return ''
    date.setDate(date.getDate() + days)
    return date.toISOString().split('T')[0]
  }

  /**
   * 获取今天的日期（YYYY-MM-DD 格式）
   */
  static today(): string {
    return new Date().toISOString().split('T')[0]
  }
}
