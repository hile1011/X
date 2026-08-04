/**
 * 订单状态枚举类
 *
 * 设计思路：
 *   - 将原本散落在 BagQuote.tsx / Dashboard.tsx / BagQuoteTable.tsx / Quotes.tsx 中
 *     重复定义的 STATUS_OPTIONS 统一封装为一个枚举类
 *   - 提供查找、验证、流转判断等业务方法，遵循单一职责原则
 *   - 常量使用 static readonly，OPTIONS 设为 private，仅通过方法暴露
 *
 * 状态流转路径（业务约束，见 project_memory）：
 *   报价中(1) → 打样中(2) → 做货中(3) → 已发货未收款(4) → 已发货已收款(5) → 结束(6)
 *   报价中、打样中可直接进入结束状态
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
  /** 结束 */
  static readonly FINISHED = 6

  /**
   * 所有状态选项（private，防止外部直接修改）
   * 内容与原 STATUS_OPTIONS 完全一致，保证业务逻辑不变
   */
  private static readonly OPTIONS: readonly StatusOption[] = [
    { value: OrderStatus.QUOTING, label: '报价中' },
    { value: OrderStatus.SAMPLING, label: '打样中' },
    { value: OrderStatus.PRODUCING, label: '做货中' },
    { value: OrderStatus.SHIPPED_UNPAID, label: '已发货未收款' },
    { value: OrderStatus.SHIPPED_PAID, label: '已发货已收款' },
    { value: OrderStatus.FINISHED, label: '结束' },
  ]

  /**
   * 获取所有状态选项（返回浅拷贝，防止外部修改内部数据）
   */
  static getAll(): StatusOption[] {
    return OrderStatus.OPTIONS.map((o) => ({ ...o }))
  }

  /**
   * 根据状态值获取标签
   * @param value 状态值（1-6）
   * @returns 状态标签；未找到时返回空字符串
   */
  static getLabel(value: number): string {
    const option = OrderStatus.OPTIONS.find((o) => o.value === value)
    return option ? option.label : ''
  }

  /**
   * 验证状态值是否有效（1-6）
   */
  static isValid(value: number): boolean {
    return OrderStatus.OPTIONS.some((o) => o.value === value)
  }

  /**
   * 判断指定状态是否可直接进入"结束"状态
   * 业务规则：报价中(1)和打样中(2)可直接进入结束(6)
   * @param value 当前状态值
   */
  static canEnterFinished(value: number): boolean {
    return (
      value === OrderStatus.QUOTING ||
      value === OrderStatus.SAMPLING
    )
  }

  /**
   * 获取下一个正常流转的状态值
   * 报价中→打样中→做货中→已发货未收款→已发货已收款→结束
   * 已在结束状态时返回 null
   */
  static getNext(value: number): number | null {
    if (value === OrderStatus.FINISHED) return null
    return value + 1
  }
}
