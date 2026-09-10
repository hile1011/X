/**
 * 订单状态枚举类
 *
 * 设计思路：
 *   - 将原本散落在 BagQuote.tsx / Dashboard.tsx / BagQuoteTable.tsx / Quotes.tsx 中
 *     重复定义的 STATUS_OPTIONS 统一封装为一个枚举类
 *   - 提供查找、验证、流转判断等业务方法，遵循单一职责原则
 *   - 常量使用 static readonly，OPTIONS 设为 private，仅通过方法暴露
 *
 * 状态流转路径（基于指针流转模式，序号不再决定顺序）：
 *   报价中(1) → 打样中(2) → 打样完成(7) → 做货中(3) → 已发货未收款(4) → 已发货已收款(5) → 已对账(8)
 *   结束(6)为旁路终止状态：仅报价中(1)、打样中(2)、打样完成(7)可直接进入；
 *   已发货已收款(5)与已对账(8)状态不允许直接调整为结束状态（V28 对账管理规则）
 *
 * 历史数据兼容：
 *   - 状态值 1-6 为原始值，历史订单数据无需迁移
 *   - 状态值 7（打样完成）插入在打样中(2)与做货中(3)之间
 *   - 状态值 8（已对账）为新增终态，插在已发货已收款(5)之后（V28）
 *   - 流转顺序由 FLOW 数组显式定义，不再依赖 value+1 递增
 */

export interface StatusOption {
  value: number
  label: string
}

export class OrderStatus {
  /** 报价中 */
  static readonly QUOTING = 1
  /** 打样中 */
  static readonly SAMPLING = 2
  /** 做货中 */
  static readonly PRODUCING = 3
  /** 已发货未收款 */
  static readonly SHIPPED_UNPAID = 4
  /** 已发货已收款 */
  static readonly SHIPPED_PAID = 5
  /** 结束（旁路终止状态，仅 1/2/7 可直接进入） */
  static readonly FINISHED = 6
  /** 打样完成（新增，序号7避免重编历史数据） */
  static readonly SAMPLE_COMPLETED = 7
  /** 已对账（V28 新增终态：订单成本与实际支出核对完成） */
  static readonly RECONCILED = 8

  /**
   * 状态流转顺序数组（指针流转模式的核心）
   * 定义了状态的线性流转路径，与 value 的数值大小无关。
   * 结束(6)不在数组中：它是旁路终止状态（getFlowPosition 对其特判排在最后）
   */
  private static readonly FLOW: readonly number[] = [
    OrderStatus.QUOTING,           // 1 → 报价中
    OrderStatus.SAMPLING,          // 2 → 打样中
    OrderStatus.SAMPLE_COMPLETED,  // 7 → 打样完成
    OrderStatus.PRODUCING,         // 3 → 做货中
    OrderStatus.SHIPPED_UNPAID,    // 4 → 已发货未收款
    OrderStatus.SHIPPED_PAID,      // 5 → 已发货已收款
    OrderStatus.RECONCILED,        // 8 → 已对账
  ]

  /**
   * 所有状态选项（private，防止外部直接修改）
   * 按 FLOW 流转顺序排列，结束(6)排在最后，保证 UI 展示与流转顺序一致
   */
  private static readonly OPTIONS: readonly StatusOption[] = [
    { value: OrderStatus.QUOTING, label: '报价中' },
    { value: OrderStatus.SAMPLING, label: '打样中' },
    { value: OrderStatus.SAMPLE_COMPLETED, label: '打样完成' },
    { value: OrderStatus.PRODUCING, label: '做货中' },
    { value: OrderStatus.SHIPPED_UNPAID, label: '已发货未收款' },
    { value: OrderStatus.SHIPPED_PAID, label: '已发货已收款' },
    { value: OrderStatus.RECONCILED, label: '已对账' },
    { value: OrderStatus.FINISHED, label: '结束' },
  ]

  /**
   * 获取所有状态选项（返回浅拷贝，防止外部修改内部数据）
   * 按 FLOW 流转顺序排列
   */
  static getAll(): StatusOption[] {
    return OrderStatus.OPTIONS.map((o) => ({ ...o }))
  }

  /**
   * 根据状态值获取标签
   * @param value 状态值
   * @returns 状态标签；未找到时返回空字符串
   */
  static getLabel(value: number): string {
    const option = OrderStatus.OPTIONS.find((o) => o.value === value)
    return option ? option.label : ''
  }

  /**
   * 验证状态值是否有效
   */
  static isValid(value: number): boolean {
    return OrderStatus.OPTIONS.some((o) => o.value === value)
  }

  /**
   * 判断指定状态是否可直接进入"结束"状态
   * 业务规则：报价中(1)、打样中(2)、打样完成(7)可直接进入结束(6)；
   * 已发货已收款(5)与已对账(8)不允许直接调整为结束状态（V28 对账管理规则）
   * @param value 当前状态值
   */
  static canEnterFinished(value: number): boolean {
    return (
      value === OrderStatus.QUOTING ||
      value === OrderStatus.SAMPLING ||
      value === OrderStatus.SAMPLE_COMPLETED
    )
  }

  /**
   * 获取下一个正常流转的状态值（基于 FLOW 指针数组）
   * 报价中→打样中→打样完成→做货中→已发货未收款→已发货已收款→已对账
   * 已在已对账(8)或结束(6)状态时返回 null（8 为流转终态，6 为旁路状态不在 FLOW 中）
   */
  static getNext(value: number): number | null {
    const idx = OrderStatus.FLOW.indexOf(value)
    if (idx === -1 || idx >= OrderStatus.FLOW.length - 1) return null
    return OrderStatus.FLOW[idx + 1]
  }

  /**
   * 获取上一个流转的状态值（基于 FLOW 指针数组，逆序）
   * 已对账(8)可退回已发货已收款(5)；结束(6)特判退回已发货已收款(5)（历史结束订单退回重新对账）
   * 已在报价中状态时返回 null
   */
  static getPrev(value: number): number | null {
    if (value === OrderStatus.FINISHED) return OrderStatus.SHIPPED_PAID
    const idx = OrderStatus.FLOW.indexOf(value)
    if (idx <= 0) return null
    return OrderStatus.FLOW[idx - 1]
  }

  /**
   * 获取状态在流转路径中的位置索引（0-based）
   * 结束(6)特判返回 FLOW.length（排在已对账之后，列表/时间线展示用）
   * @param value 状态值
   * @returns 索引；未找到返回 -1
   */
  static getFlowPosition(value: number): number {
    if (value === OrderStatus.FINISHED) return OrderStatus.FLOW.length
    return OrderStatus.FLOW.indexOf(value)
  }

  /**
   * 获取完整流转路径（浅拷贝）
   */
  static getFlow(): number[] {
    return [...OrderStatus.FLOW]
  }
}
