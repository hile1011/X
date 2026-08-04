/**
 * OrderStatus 枚举类单元测试
 *
 * 测试目标：
 *   - 静态常量值正确性（QUOTING=1 ... FINISHED=6）
 *   - getAll() 返回所有状态选项
 *   - getLabel() 状态值→标签映射
 *   - isValid() 状态值验证
 *   - canEnterFinished() 直接进入结束状态的判断
 *   - getNext() 正常流转的下一状态
 *   - 返回数据不可变性（修改返回值不影响内部数据）
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
})

describe('OrderStatus.getAll - 获取所有状态选项', () => {
  it('返回 6 个状态选项', () => {
    const all = OrderStatus.getAll()
    expect(all).toHaveLength(6)
  })

  it('第一个选项为报价中(1)', () => {
    const all = OrderStatus.getAll()
    expect(all[0]).toEqual({ value: 1, label: '报价中' })
  })

  it('最后一个选项为结束(6)', () => {
    const all = OrderStatus.getAll()
    expect(all[5]).toEqual({ value: 6, label: '结束' })
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

  it('无效值返回空字符串', () => {
    expect(OrderStatus.getLabel(0)).toBe('')
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

  it('0 无效', () => {
    expect(OrderStatus.isValid(0)).toBe(false)
  })

  it('7 无效', () => {
    expect(OrderStatus.isValid(7)).toBe(false)
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
})

describe('OrderStatus.getNext - 正常流转下一状态', () => {
  it('报价中(1) → 打样中(2)', () => {
    expect(OrderStatus.getNext(1)).toBe(2)
  })

  it('打样中(2) → 做货中(3)', () => {
    expect(OrderStatus.getNext(2)).toBe(3)
  })

  it('做货中(3) → 已发货未收款(4)', () => {
    expect(OrderStatus.getNext(3)).toBe(4)
  })

  it('已发货未收款(4) → 已发货已收款(5)', () => {
    expect(OrderStatus.getNext(4)).toBe(5)
  })

  it('已发货已收款(5) → 结束(6)', () => {
    expect(OrderStatus.getNext(5)).toBe(6)
  })

  it('结束(6) → null（无下一状态）', () => {
    expect(OrderStatus.getNext(6)).toBeNull()
  })
})
