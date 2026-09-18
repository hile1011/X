/**
 * 订单排序工具
 *
 * 提供按「订单状态 + 到期日期」优先级排序的比较器与排序函数。
 *
 * 排序优先级：
 *   1. 订单状态（基于 OrderStatus.FLOW 流转顺序，非数值大小）
 *   2. 到期日期升序（越早越往上排，无到期日期的排后面）
 *
 * 使用场景：
 *   - 工作台订单状态跟踪列表（status asc/desc 可切换 + dueDate asc）
 */
import { OrderStatus } from '../constants/OrderStatus'

/** 可排序的订单最小结构 */
export interface SortableQuote {
  /** 订单状态值（1-8） */
  status: number
  /** 到期/交货日期（ISO 字符串，可为空） */
  productionTimeEnd: string
}

/** 状态排序方向 */
export type StatusDirection = 'asc' | 'desc'

/**
 * 比较两个订单的状态位置（基于 FLOW 流转顺序）
 * @param direction 'asc' = 流转顺序靠前的在前；'desc' = 流转顺序靠后的在前
 * @returns 负数表示 a 在前，正数表示 b 在前，0 表示状态位置相同
 */
export function compareByStatus(
  a: SortableQuote,
  b: SortableQuote,
  direction: StatusDirection = 'asc',
): number {
  const aPos = OrderStatus.getFlowPosition(a.status)
  const bPos = OrderStatus.getFlowPosition(b.status)
  return direction === 'asc' ? aPos - bPos : bPos - aPos
}

/**
 * 比较两个订单的到期日期（升序，越早越往前）
 * 无到期日期（空字符串/无效）的订单排后面（使用 Infinity）
 * @returns 负数表示 a 在前，正数表示 b 在前，0 表示日期相同
 */
export function compareByDueDate(a: SortableQuote, b: SortableQuote): number {
  const aDue = a.productionTimeEnd ? new Date(a.productionTimeEnd).getTime() : Infinity
  const bDue = b.productionTimeEnd ? new Date(b.productionTimeEnd).getTime() : Infinity
  return aDue - bDue
}

/**
 * 按订单状态 + 到期日期排序（不修改原数组）
 *
 * 优先级：
 *   1. 订单状态（按 FLOW 流转顺序，direction 控制升降序）
 *   2. 到期日期升序（同状态内，越早越往上排）
 *
 * @param quotes 待排序订单数组
 * @param statusDirection 状态排序方向，默认 'asc'
 * @returns 新的已排序数组
 */
export function sortByStatusAndDueDate<T extends SortableQuote>(
  quotes: T[],
  statusDirection: StatusDirection = 'asc',
): T[] {
  return [...quotes].sort((a, b) => {
    const statusCmp = compareByStatus(a, b, statusDirection)
    if (statusCmp !== 0) return statusCmp
    return compareByDueDate(a, b)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 订单管理列表排序：客户名称 → 批次号 → 修改时间（层级排序）
// ─────────────────────────────────────────────────────────────────────────────

/** 订单管理列表排序所需的最小结构 */
export interface OrderListSortable {
  /** 客户名称（一级分组键） */
  customerName: string
  /** 批次号（PN-秒级时间戳；空/null 表示无批次，各自视为独立组） */
  batchNumber?: string | null
  /** 修改时间（ISO 字符串） */
  updated_at: string
  /** 订单 id（同修改时间时的稳定兜底） */
  id: string
}

/** 解析时间戳（无效/空返回 0，保证排序稳定） */
function toTime(v: string): number {
  const t = v ? new Date(v).getTime() : NaN
  return isNaN(t) ? 0 : t
}

/**
 * 订单管理列表排序（不修改原数组）
 *
 * 层级规则：
 *   1. 客户名称升序分组（中文按拼音）
 *   2. 同客户内按批次号二次分组；批次组之间按「组内最新修改时间」降序（修改时间最高优先级），
 *      最近有活动的批次排最前；无批次订单各自视为独立组，按自身修改时间参与排序
 *   3. 同批次组内部按修改时间降序，最新修改的订单排在该批次最前面（同修改时间按 id 降序兜底）
 *
 * 连续性保证：同客户 + 同批次号的订单排序键（客户名/组最新时间/批次号）完全一致，
 * 仅在组内比较修改时间，因此同批次订单严格连续，不会被其他批次分隔。
 *
 * @param quotes 待排序订单数组
 * @returns 新的已排序数组
 */
export function sortOrdersForList<T extends OrderListSortable>(quotes: T[]): T[] {
  // 预计算批次组的最新修改时间：groupKey = 客户名 + 批次号（无批次用订单 id，各自独立）
  const groupLatest = new Map<string, number>()
  for (const q of quotes) {
    const key = `${q.customerName}\u0000${q.batchNumber || ''}\u0000${q.batchNumber ? '' : q.id}`
    const t = toTime(q.updated_at)
    const prev = groupLatest.get(key)
    if (prev === undefined || t > prev) groupLatest.set(key, t)
  }

  return [...quotes].sort((a, b) => {
    // 1. 客户名称升序（中文按拼音）
    const nameCmp = a.customerName.localeCompare(b.customerName, 'zh-CN')
    if (nameCmp !== 0) return nameCmp

    // 2. 批次组之间：组内最新修改时间降序（无批次 = 自身修改时间）
    const keyOf = (q: OrderListSortable) =>
      `${q.customerName}\u0000${q.batchNumber || ''}\u0000${q.batchNumber ? '' : q.id}`
    const latestCmp = (groupLatest.get(keyOf(b)) ?? 0) - (groupLatest.get(keyOf(a)) ?? 0)
    if (latestCmp !== 0) return latestCmp

    // 3. 批次号降序兜底（不同批次组恰有相同最新时间时，保证各组仍各自连续）
    const batchCmp = (b.batchNumber || '').localeCompare(a.batchNumber || '')
    if (batchCmp !== 0) return batchCmp

    // 4. 组内：修改时间降序（最新修改在最前）
    const timeCmp = toTime(b.updated_at) - toTime(a.updated_at)
    if (timeCmp !== 0) return timeCmp

    // 5. id 降序兜底（同修改时间时新订单在前）
    return b.id.localeCompare(a.id)
  })
}
