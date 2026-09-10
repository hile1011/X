/**
 * 订单状态 UI 样式常量
 *
 * 设计思路：
 *   - 将 Dashboard（工作台）与做货跟踪页重复定义的状态颜色映射统一抽取为共享常量
 *   - 与 OrderStatus 枚举配合使用：OrderStatus 提供 value/label，本模块提供颜色样式
 *   - 色板与 Tailwind 类名对齐，覆盖全部 8 个状态（V28 新增已对账 8，teal 色系）
 *
 * 字段说明：
 *   - color：浅色徽标类（状态筛选、状态标签）
 *   - bgColor：深色实心类（进度条主体）
 *   - bgLightColor：浅色背景类（进度条轨道）
 */

export interface OrderStatusStyle {
  /** 浅色徽标类（如 bg-blue-100 text-blue-700） */
  color: string
  /** 深色实心类（进度条主体，如 bg-blue-500） */
  bgColor: string
  /** 浅色背景类（进度条轨道，如 bg-blue-200） */
  bgLightColor: string
}

/** 各状态样式映射（1-8，与 OrderStatus.getAll() 一一对应） */
export const ORDER_STATUS_COLORS: Record<number, OrderStatusStyle> = {
  1: { color: 'bg-blue-100 text-blue-700', bgColor: 'bg-blue-500', bgLightColor: 'bg-blue-200' },
  2: { color: 'bg-yellow-100 text-yellow-700', bgColor: 'bg-yellow-500', bgLightColor: 'bg-yellow-200' },
  3: { color: 'bg-purple-100 text-purple-700', bgColor: 'bg-purple-500', bgLightColor: 'bg-purple-200' },
  4: { color: 'bg-orange-100 text-orange-700', bgColor: 'bg-orange-500', bgLightColor: 'bg-orange-200' },
  5: { color: 'bg-green-100 text-green-700', bgColor: 'bg-green-500', bgLightColor: 'bg-green-200' },
  6: { color: 'bg-gray-100 text-gray-700', bgColor: 'bg-gray-500', bgLightColor: 'bg-gray-200' },
  7: { color: 'bg-cyan-100 text-cyan-700', bgColor: 'bg-cyan-500', bgLightColor: 'bg-cyan-200' },
  8: { color: 'bg-teal-100 text-teal-700', bgColor: 'bg-teal-500', bgLightColor: 'bg-teal-200' },
}

/** 未知状态的兜底样式（灰色系，与结束 6 视觉一致） */
export const ORDER_STATUS_FALLBACK: OrderStatusStyle = {
  color: 'bg-gray-100 text-gray-700',
  bgColor: 'bg-gray-500',
  bgLightColor: 'bg-gray-200',
}

/**
 * 按状态值获取样式
 * 已知状态（1-8）返回映射表条目，未知状态返回兜底样式
 */
export function getOrderStatusStyle(status: number): OrderStatusStyle {
  return ORDER_STATUS_COLORS[status] ?? ORDER_STATUS_FALLBACK
}
