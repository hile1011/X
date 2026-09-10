/**
 * OrderStatus 枚举类单元测试
 *
 * 测试目标：
 *   - 静态常量值正确性（QUOTING=1 ... FINISHED=6, SAMPLE_COMPLETED=7）
 *   - getAll() 返回所有状态选项（按 FLOW 顺序）
 *   - getLabel() 状态值→标签映射
 *   - isValid() 状态值验证
 *   - canEnterFinished() 直接进入结束状态的判断
 *   - getNext() 正常流转的下一状态（基于 FLOW 指针数组）
 *   - getPrev() 逆序流转的上一状态（基于 FLOW 指针数组）
 *   - getFlowPosition() 状态在流转路径中的位置索引
 *   - getFlow() 完整流转路径
 *   - 返回数据不可变性（修改返回值不影响内部数据）
 *
 * 状态流转路径（基于指针流转模式，序号不再决定顺序）：
 *   报价中(1) → 打样中(2) → 打样完成(7) → 做货中(3) → 已发货未收款(4) → 已发货已收款(5) → 已对账(8)
 *   结束(6)为旁路终止状态：仅报价中(1)、打样中(2)、打样完成(7)可直接进入（V28 对账管理规则）
 */
import { describe, it, expect } from 'vitest'
import { OrderStatus } from '../../src/constants/OrderStatus'

describe('OrderStatus - 静态常量值', () => {
  it('QUOTING = 1', () => {
    expect(OrderStatus.QUOTING).toBe(1)
  })

  it('SAMPLING = 2', () => {
    expect(OrderStatus.SAMPLING).toBe(2)
  })

  it('PRODUCING = 3', () => {
    expect(OrderStatus.PRODUCING).toBe(3)
  })

  it('SHIPPED_UNPAID = 4', () => {
    expect(OrderStatus.SHIPPED_UNPAID).toBe(4)
  })

  it('SHIPPED_PAID = 5', () => {
    expect(OrderStatus.SHIPPED_PAID).toBe(5)
  })

  it('FINISHED = 6', () => {
    expect(OrderStatus.FINISHED).toBe(6)
  })

  it('SAMPLE_COMPLETED = 7（新增状态，序号7避免重编历史数据）', () => {
    expect(OrderStatus.SAMPLE_COMPLETED).toBe(7)
  })

  it('RECONCILED = 8（V28 新增已对账终态）', () => {
    expect(OrderStatus.RECONCILED).toBe(8)
  })
})

describe('OrderStatus.getAll - 获取所有状态选项', () => {
  it('返回 8 个状态选项', () => {
    const all = OrderStatus.getAll()
    expect(all).toHaveLength(8)
  })

  it('第一个选项为报价中(1)', () => {
    const all = OrderStatus.getAll()
    expect(all[0]).toEqual({ value: 1, label: '报价中' })
  })

  it('第三个选项为打样完成(7)（插入在打样中与做货中之间）', () => {
    const all = OrderStatus.getAll()
    expect(all[2]).toEqual({ value: 7, label: '打样完成' })
  })

  it('倒数第二项为已对账(8)（V28 新增，插在已发货已收款之后）', () => {
    const all = OrderStatus.getAll()
    expect(all[6]).toEqual({ value: 8, label: '已对账' })
  })

  it('最后一个选项为结束(6)', () => {
    const all = OrderStatus.getAll()
    expect(all[7]).toEqual({ value: 6, label: '结束' })
  })

  it('返回数据为浅拷贝（修改不影响内部数据）', () => {
    const all = OrderStatus.getAll()
    all[0].label = '被篡改'
    const fresh = OrderStatus.getAll()
    expect(fresh[0].label).toBe('报价中')
  })
})

describe('OrderStatus.getLabel - 状态值→标签映射', () => {
  it('1 → 报价中', () => {
    expect(OrderStatus.getLabel(1)).toBe('报价中')
  })

  it('2 → 打样中', () => {
    expect(OrderStatus.getLabel(2)).toBe('打样中')
  })

  it('7 → 打样完成', () => {
    expect(OrderStatus.getLabel(7)).toBe('打样完成')
  })

  it('3 → 做货中', () => {
    expect(OrderStatus.getLabel(3)).toBe('做货中')
  })

  it('4 → 已发货未收款', () => {
    expect(OrderStatus.getLabel(4)).toBe('已发货未收款')
  })

  it('5 → 已发货已收款', () => {
    expect(OrderStatus.getLabel(5)).toBe('已发货已收款')
  })

  it('6 → 结束', () => {
    expect(OrderStatus.getLabel(6)).toBe('结束')
  })

  it('8 → 已对账（V28 新增）', () => {
    expect(OrderStatus.getLabel(8)).toBe('已对账')
  })

  it('无效值返回空字符串', () => {
    expect(OrderStatus.getLabel(0)).toBe('')
    expect(OrderStatus.getLabel(9)).toBe('')
    expect(OrderStatus.getLabel(99)).toBe('')
    expect(OrderStatus.getLabel(-1)).toBe('')
  })
})

describe('OrderStatus.isValid - 状态值验证', () => {
  it('1-6 均有效', () => {
    for (let i = 1; i <= 6; i++) {
      expect(OrderStatus.isValid(i)).toBe(true)
    }
  })

  it('7 有效（新增状态）', () => {
    expect(OrderStatus.isValid(7)).toBe(true)
  })

  it('8 有效（V28 已对账）', () => {
    expect(OrderStatus.isValid(8)).toBe(true)
  })

  it('0 无效', () => {
    expect(OrderStatus.isValid(0)).toBe(false)
  })

  it('9 及以上无效', () => {
    expect(OrderStatus.isValid(9)).toBe(false)
    expect(OrderStatus.isValid(99)).toBe(false)
  })

  it('负数无效', () => {
    expect(OrderStatus.isValid(-1)).toBe(false)
  })
})

describe('OrderStatus.canEnterFinished - 可直接进入结束状态', () => {
  it('报价中(1)可直接进入结束', () => {
    expect(OrderStatus.canEnterFinished(1)).toBe(true)
  })

  it('打样中(2)可直接进入结束', () => {
    expect(OrderStatus.canEnterFinished(2)).toBe(true)
  })

  it('打样完成(7)可直接进入结束', () => {
    expect(OrderStatus.canEnterFinished(7)).toBe(true)
  })

  it('做货中(3)不可直接进入结束', () => {
    expect(OrderStatus.canEnterFinished(3)).toBe(false)
  })

  it('已发货未收款(4)不可直接进入结束', () => {
    expect(OrderStatus.canEnterFinished(4)).toBe(false)
  })

  it('已发货已收款(5)不可直接进入结束', () => {
    expect(OrderStatus.canEnterFinished(5)).toBe(false)
  })

  it('结束(6)不可直接进入结束（已在结束状态）', () => {
    expect(OrderStatus.canEnterFinished(6)).toBe(false)
  })

  it('已对账(8)不可直接进入结束（V28 对账管理规则）', () => {
    expect(OrderStatus.canEnterFinished(8)).toBe(false)
  })
})

describe('OrderStatus.getNext - 正常流转下一状态（基于 FLOW 指针数组）', () => {
  it('报价中(1) → 打样中(2)', () => {
    expect(OrderStatus.getNext(1)).toBe(2)
  })

  it('打样中(2) → 打样完成(7)', () => {
    expect(OrderStatus.getNext(2)).toBe(7)
  })

  it('打样完成(7) → 做货中(3)', () => {
    expect(OrderStatus.getNext(7)).toBe(3)
  })

  it('做货中(3) → 已发货未收款(4)', () => {
    expect(OrderStatus.getNext(3)).toBe(4)
  })

  it('已发货未收款(4) → 已发货已收款(5)', () => {
    expect(OrderStatus.getNext(4)).toBe(5)
  })

  it('已发货已收款(5) → 已对账(8)（V28 调整：5 的下一状态由结束改为已对账）', () => {
    expect(OrderStatus.getNext(5)).toBe(8)
  })

  it('已对账(8) → null（流转终态）', () => {
    expect(OrderStatus.getNext(8)).toBeNull()
  })

  it('结束(6) → null（旁路状态，不在 FLOW 中）', () => {
    expect(OrderStatus.getNext(6)).toBeNull()
  })

  it('无效状态值 → null', () => {
    expect(OrderStatus.getNext(0)).toBeNull()
    expect(OrderStatus.getNext(99)).toBeNull()
  })
})

describe('OrderStatus.getPrev - 逆序流转上一状态（基于 FLOW 指针数组）', () => {
  it('报价中(1) → null（无上一状态）', () => {
    expect(OrderStatus.getPrev(1)).toBeNull()
  })

  it('打样中(2) → 报价中(1)', () => {
    expect(OrderStatus.getPrev(2)).toBe(1)
  })

  it('打样完成(7) → 打样中(2)', () => {
    expect(OrderStatus.getPrev(7)).toBe(2)
  })

  it('做货中(3) → 打样完成(7)', () => {
    expect(OrderStatus.getPrev(3)).toBe(7)
  })

  it('已发货未收款(4) → 做货中(3)', () => {
    expect(OrderStatus.getPrev(4)).toBe(3)
  })

  it('已发货已收款(5) → 已发货未收款(4)', () => {
    expect(OrderStatus.getPrev(5)).toBe(4)
  })

  it('已对账(8) → 已发货已收款(5)', () => {
    expect(OrderStatus.getPrev(8)).toBe(5)
  })

  it('结束(6) → 已发货已收款(5)（特判：历史结束订单退回重新对账）', () => {
    expect(OrderStatus.getPrev(6)).toBe(5)
  })

  it('无效状态值 → null', () => {
    expect(OrderStatus.getPrev(0)).toBeNull()
    expect(OrderStatus.getPrev(99)).toBeNull()
  })
})

describe('OrderStatus.getFlowPosition - 状态在流转路径中的位置索引', () => {
  it('报价中(1) 的位置索引为 0', () => {
    expect(OrderStatus.getFlowPosition(1)).toBe(0)
  })

  it('打样中(2) 的位置索引为 1', () => {
    expect(OrderStatus.getFlowPosition(2)).toBe(1)
  })

  it('打样完成(7) 的位置索引为 2（在打样中与做货中之间）', () => {
    expect(OrderStatus.getFlowPosition(7)).toBe(2)
  })

  it('做货中(3) 的位置索引为 3', () => {
    expect(OrderStatus.getFlowPosition(3)).toBe(3)
  })

  it('已发货未收款(4) 的位置索引为 4', () => {
    expect(OrderStatus.getFlowPosition(4)).toBe(4)
  })

  it('已发货已收款(5) 的位置索引为 5', () => {
    expect(OrderStatus.getFlowPosition(5)).toBe(5)
  })

  it('已对账(8) 的位置索引为 6（V28 新增终态）', () => {
    expect(OrderStatus.getFlowPosition(8)).toBe(6)
  })

  it('结束(6) 的位置索引为 7（特判排在 FLOW 末尾之后）', () => {
    expect(OrderStatus.getFlowPosition(6)).toBe(7)
  })

  it('无效状态值返回 -1', () => {
    expect(OrderStatus.getFlowPosition(0)).toBe(-1)
    expect(OrderStatus.getFlowPosition(99)).toBe(-1)
  })

  it('位置索引不依赖数值大小（7 的位置在 3 之前）', () => {
    // 验证指针流转模式核心特性：序号大小不再决定顺序
    expect(OrderStatus.getFlowPosition(7)).toBeLessThan(OrderStatus.getFlowPosition(3))
  })
})

describe('OrderStatus.getFlow - 完整流转路径', () => {
  it('返回 7 个状态值的数组', () => {
    const flow = OrderStatus.getFlow()
    expect(flow).toHaveLength(7)
  })

  it('流转路径为 [1, 2, 7, 3, 4, 5, 8]（结束 6 为旁路状态不在数组中）', () => {
    expect(OrderStatus.getFlow()).toEqual([1, 2, 7, 3, 4, 5, 8])
  })

  it('返回数据为浅拷贝（修改不影响内部数据）', () => {
    const flow = OrderStatus.getFlow()
    flow.push(99)
    const fresh = OrderStatus.getFlow()
    expect(fresh).toHaveLength(7)
    expect(fresh).not.toContain(99)
  })
})

// ============================================================
// 边界值 & 类型安全
// ============================================================
describe('OrderStatus - 边界值与类型安全', () => {
  it('NaN 无效', () => {
    expect(OrderStatus.isValid(NaN)).toBe(false)
    expect(OrderStatus.getLabel(NaN)).toBe('')
    expect(OrderStatus.getNext(NaN)).toBeNull()
    expect(OrderStatus.getPrev(NaN)).toBeNull()
    expect(OrderStatus.getFlowPosition(NaN)).toBe(-1)
  })

  it('Infinity 无效', () => {
    expect(OrderStatus.isValid(Infinity)).toBe(false)
    expect(OrderStatus.isValid(-Infinity)).toBe(false)
  })

  it('浮点数无效（状态值必须为整数）', () => {
    expect(OrderStatus.isValid(1.5)).toBe(false)
    expect(OrderStatus.isValid(2.0)).toBe(true) // 2.0 === 2 in JS
    expect(OrderStatus.isValid(7.1)).toBe(false)
  })

  it('canEnterFinished 对无效状态返回 false', () => {
    expect(OrderStatus.canEnterFinished(0)).toBe(false)
    expect(OrderStatus.canEnterFinished(9)).toBe(false)
    expect(OrderStatus.canEnterFinished(-1)).toBe(false)
    expect(OrderStatus.canEnterFinished(NaN)).toBe(false)
  })
})

// ============================================================
// 全路径遍历（从报价中到结束，再从结束退回报价中）
// ============================================================
describe('OrderStatus - 全路径遍历', () => {
  it('正向遍历：从报价中(1) 经 getNext 逐级流转到已对账(8)终态', () => {
    let current: number | null = OrderStatus.QUOTING
    const visited: number[] = [current]

    while (current !== null) {
      current = OrderStatus.getNext(current)
      if (current !== null) visited.push(current)
    }

    expect(visited).toEqual([1, 2, 7, 3, 4, 5, 8])
  })

  it('逆向遍历：从结束(6) 经 getPrev 逐级退回到报价中(1)', () => {
    let current: number | null = OrderStatus.FINISHED
    const visited: number[] = [current]

    while (current !== null) {
      current = OrderStatus.getPrev(current)
      if (current !== null) visited.push(current)
    }

    expect(visited).toEqual([6, 5, 4, 3, 7, 2, 1])
  })

  it('正向遍历经过的节点数 = FLOW 长度', () => {
    let current: number | null = OrderStatus.QUOTING
    let count = 1

    while (current !== null && OrderStatus.getNext(current) !== null) {
      current = OrderStatus.getNext(current)
      count++
    }

    expect(count).toBe(OrderStatus.getFlow().length)
  })
})

// ============================================================
// 跨方法一致性（不变量验证）
// ============================================================
describe('OrderStatus - 跨方法一致性', () => {
  it('getAll 的 value 列表 = getFlow + 结束(6)（结束为旁路状态追加在末尾）', () => {
    const allValues = OrderStatus.getAll().map((o) => o.value)
    const flowValues = OrderStatus.getFlow()
    expect(allValues).toEqual([...flowValues, 6])
  })

  it('getAll 中每个选项的 label 与 getLabel 结果一致', () => {
    for (const option of OrderStatus.getAll()) {
      expect(OrderStatus.getLabel(option.value)).toBe(option.label)
    }
  })

  it('isValid 对 getAll 中所有 value 返回 true', () => {
    for (const option of OrderStatus.getAll()) {
      expect(OrderStatus.isValid(option.value)).toBe(true)
    }
  })

  it('getFlowPosition 对 getAll 中所有 value 返回非负索引', () => {
    const all = OrderStatus.getAll()
    all.forEach((option, index) => {
      expect(OrderStatus.getFlowPosition(option.value)).toBe(index)
    })
  })

  it('getNext + getPrev 往返一致：getPrev(getNext(x)) === x（非边界状态）', () => {
    const flow = OrderStatus.getFlow()
    // 排除最后一个状态（getNext 返回 null）
    for (let i = 0; i < flow.length - 1; i++) {
      const next = OrderStatus.getNext(flow[i])
      expect(OrderStatus.getPrev(next!)).toBe(flow[i])
    }
  })

  it('getPrev + getNext 往返一致：getNext(getPrev(x)) === x（非边界状态）', () => {
    const flow = OrderStatus.getFlow()
    // 排除第一个状态（getPrev 返回 null）
    for (let i = 1; i < flow.length; i++) {
      const prev = OrderStatus.getPrev(flow[i])
      expect(OrderStatus.getNext(prev!)).toBe(flow[i])
    }
  })

  it('getAll 中 value 唯一（无重复状态值）', () => {
    const all = OrderStatus.getAll()
    const values = all.map((o) => o.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('getAll 中 label 唯一（无重复标签）', () => {
    const all = OrderStatus.getAll()
    const labels = all.map((o) => o.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('getFlow 中 value 唯一（无重复状态值）', () => {
    const flow = OrderStatus.getFlow()
    expect(new Set(flow).size).toBe(flow.length)
  })
})
