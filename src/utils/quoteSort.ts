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
// 订单管理列表排序：批次分组 → 修改时间（多级排序）
// ─────────────────────────────────────────────────────────────────────────────

/** 订单管理列表排序所需的最小结构 */
export interface OrderListSortable {
  /** 批次号（PN-秒级时间戳；空/null 表示无批次，排序时视为拥有唯一批次标识、各自独立成组） */
  batchNumber?: string | null
  /** 修改时间（ISO 字符串） */
  updated_at: string
  /** 订单 id（组内同修改时间时的稳定兜底） */
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
 * 多级排序规则：
 *   1. 一级（组间）：按批次号分组，批次组之间按「组内最新修改时间」降序——
 *      包含最新修改订单的批次组排在最前面
 *   2. 二级（组内）：同批次组内按修改时间降序，最新修改的订单排在该组最前面
 *   3. 三级（连续性约束）：同批次号的订单必须连续排列，
 *      并保持二级排序建立的组内相对顺序
 *
 * 边界情况处理：
 *   - 组间最新修改时间相同：按批次号降序兜底，保证各组仍各自连续
 *   - 组内修改时间相同：按 id 降序兜底（同时间时新订单在前）
 *   - 无批次号订单：视为拥有唯一批次标识（各自独立成组），
 *     按自身修改时间与批次组一起参与组间排序
 *
 * 连续性保证：同批次订单的组间排序键（组最新时间/批次号）完全一致，
 * 仅在组内比较修改时间，因此同批次订单严格连续，不被其他批次分隔。
 *
 * @param quotes 待排序订单数组
 * @returns 新的已排序数组
 */
export function sortOrdersForList<T extends OrderListSortable>(quotes: T[]): T[] {
  // 组键：批次号；无批次用「唯一批次标识」= 订单 id 前缀（不与 PN- 格式冲突），各自独立成组
  const keyOf = (q: OrderListSortable) => q.batchNumber || `__single_${q.id}`

  // 预计算每个批次组的最新修改时间
  const groupLatest = new Map<string, number>()
  for (const q of quotes) {
    const key = keyOf(q)
    const t = toTime(q.updated_at)
    const prev = groupLatest.get(key)
    if (prev === undefined || t > prev) groupLatest.set(key, t)
  }

  return [...quotes].sort((a, b) => {
    // 1. 一级（组间）：组内最新修改时间降序（含最新修改订单的组排最前）
    const latestCmp = (groupLatest.get(keyOf(b)) ?? 0) - (groupLatest.get(keyOf(a)) ?? 0)
    if (latestCmp !== 0) return latestCmp

    // 2. 批次号降序兜底（不同批次组恰有相同最新时间时，保证各组仍各自连续）
    const batchCmp = (b.batchNumber || '').localeCompare(a.batchNumber || '')
    if (batchCmp !== 0) return batchCmp

    // 3. 二级（组内）：修改时间降序（最新修改在最前）
    const timeCmp = toTime(b.updated_at) - toTime(a.updated_at)
    if (timeCmp !== 0) return timeCmp

    // 4. 组内同修改时间兜底（新订单在前）
    return b.id.localeCompare(a.id)
  })
}
