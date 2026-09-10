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
