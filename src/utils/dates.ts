/**
 * 订单/工作台日期工具函数
 *
 * 设计目标：跨时区一致的日期处理（修复「日期行显示错误」的根本原因）
 * - 后端返回的日期多为 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm:ss" 格式
 * - 直接 new Date("YYYY-MM-DD") 会按 UTC 0 点解析，在负时区（如 UTC-5）
 *   显示为前一天，导致不同浏览器/系统环境下日期不一致
 * - toISOString().split('T')[0] 取的是 UTC 日期，在 UTC+8 环境（本地 0 点~
 *   8 点间）会得到「昨天」，导致"今天"的日期标记/兜底值偏移一天
 *
 * 统一约定：
 * - 解析字符串日期 → parseLocalDate（手动拆分年月日，构造本地 0 点）
 * - Date → 本地日期字符串 → toLocalDateStr（手动拼接，绝不走 UTC）
 */

const DAY_MS = 1000 * 60 * 60 * 24

/** 解析 "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm:ss" 为本地时区 0 点（跨时区一致） */
export const parseLocalDate = (str: string): Date => {
  const [y, m, d] = str.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Date → 本地 "YYYY-MM-DD" 字符串（替代 toISOString 的 UTC 偏移问题） */
export const toLocalDateStr = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 格式化日期字符串为中文本地日期（如 2026/9/9）
 * 基于 parseLocalDate，保证在任何时区/浏览器下 "YYYY-MM-DD" 显示为同一天
 */
export const formatQuoteDate = (dateStr: string): string => {
  return parseLocalDate(dateStr).toLocaleDateString('zh-CN')
}

/** 日期字符串是否为有效日期（空串/非法格式返回 false） */
export const isValidDateString = (str: string | undefined | null): str is string => {
  if (!str) return false
  const d = parseLocalDate(str)
  return !isNaN(d.getTime())
}

/**
 * 甘特图进度条几何计算：返回相对甘特区域宽度的百分比 { left, width }
 *
 * 对齐规则（与日期表头一致）：
 * - 甘特范围 [minDate, maxDate] 按"天"划分为 totalDays+1 个日期列
 * - 进度条左边缘对齐起始日期所在列的左边缘：left = offsetDays / columns
 * - 进度条覆盖 [起始日, 到期日] 两个日期列（含首尾）：width = (durationDays + 1) / columns
 *   （业务含义：9月1日做货、9月3日交货，实际占用 1/2/3 三天，应覆盖三列）
 *
 * @param startStr 开始日期字符串（空则退化为 minDate）
 * @param endStr   结束日期字符串（空则退化为今天）
 * @param minDate  甘特范围最早日期（本地 0 点）
 * @param maxDate  甘特范围最晚日期（本地 0 点）
 * @param today    "今天"基准（本地 0 点，测试可注入固定值）
 */
export function getGanttBarGeometry(
  startStr: string | undefined,
  endStr: string | undefined,
  minDate: Date,
  maxDate: Date,
  today: Date = new Date(),
): { left: number; width: number } {
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startDate = startStr ? parseLocalDate(startStr) : minDate
  const endDate = endStr ? parseLocalDate(endStr) : todayLocal

  const rangeDays = (maxDate.getTime() - minDate.getTime()) / DAY_MS
  // 日期列数：范围含首尾两天（如 9/1~9/3 共 3 列）
  const columns = Math.max(1, rangeDays + 1)

  const offsetDays = (startDate.getTime() - minDate.getTime()) / DAY_MS
  // 到期日当天整天都属于做货期，跨度按"含首尾"计算
  const durationDays = (endDate.getTime() - startDate.getTime()) / DAY_MS + 1

  const left = Math.max(0, Math.min(100, (offsetDays / columns) * 100))
  const rawWidth = (durationDays / columns) * 100
  const width = Math.max(0, Math.min(100 - left, rawWidth))
  return { left, width }
}
