/**
 * 订单状态 UI 样式 单元测试
 * 测试目标：src/constants/OrderStatusStyles.ts
 *   - 8 个已知状态的样式映射（V28 新增已对账 8）
 *   - 未知状态兜底样式
 *   - 样式字段完整性（color/bgColor/bgLightColor）
 */
import { describe, it, expect } from 'vitest'
import {
  ORDER_STATUS_COLORS,
  ORDER_STATUS_FALLBACK,
  getOrderStatusStyle,
  type OrderStatusStyle,
} from '../../src/constants/OrderStatusStyles'

describe('ORDER_STATUS_COLORS - 状态样式映射', () => {
  it('覆盖全部 8 个订单状态', () => {
    expect(Object.keys(ORDER_STATUS_COLORS)).toHaveLength(8)
    for (let s = 1; s <= 8; s++) {
      expect(ORDER_STATUS_COLORS[s]).toBeDefined()
    }
  })

  it('每个状态样式包含 color / bgColor / bgLightColor 三个非空字段', () => {
    for (const style of Object.values(ORDER_STATUS_COLORS)) {
      expect(style.color).toBeTruthy()
      expect(style.bgColor).toBeTruthy()
      expect(style.bgLightColor).toBeTruthy()
    }
  })

  it('浅色徽标类（color）与深色进度条类（bgColor/bgLightColor）同色系', () => {
    // 如状态 1 为蓝色系：bg-blue-100 / bg-blue-500 / bg-blue-200
    expect(ORDER_STATUS_COLORS[1].color).toBe('bg-blue-100 text-blue-700')
    expect(ORDER_STATUS_COLORS[1].bgColor).toBe('bg-blue-500')
    expect(ORDER_STATUS_COLORS[1].bgLightColor).toBe('bg-blue-200')
  })

  it('状态 8（已对账，V28 新增）为 teal 色系', () => {
    expect(ORDER_STATUS_COLORS[8].color).toBe('bg-teal-100 text-teal-700')
    expect(ORDER_STATUS_COLORS[8].bgColor).toBe('bg-teal-500')
    expect(ORDER_STATUS_COLORS[8].bgLightColor).toBe('bg-teal-200')
  })
})

describe('ORDER_STATUS_FALLBACK - 兜底样式', () => {
  it('兜底样式字段完整', () => {
    expect(ORDER_STATUS_FALLBACK.color).toBeTruthy()
    expect(ORDER_STATUS_FALLBACK.bgColor).toBeTruthy()
    expect(ORDER_STATUS_FALLBACK.bgLightColor).toBeTruthy()
  })

  it('兜底样式与状态 6（结束）视觉一致（灰色系）', () => {
    expect(ORDER_STATUS_FALLBACK).toEqual(ORDER_STATUS_COLORS[6])
  })
})

describe('getOrderStatusStyle - 样式查询', () => {
  it('已知状态 1-8 返回对应映射', () => {
    for (let s = 1; s <= 8; s++) {
      expect(getOrderStatusStyle(s)).toBe(ORDER_STATUS_COLORS[s])
    }
  })

  it('未知状态返回兜底样式（0 / 99）', () => {
    const fallback: OrderStatusStyle = ORDER_STATUS_FALLBACK
    expect(getOrderStatusStyle(0)).toEqual(fallback)
    expect(getOrderStatusStyle(99)).toEqual(fallback)
  })

  it('返回对象为共享引用（无多余拷贝），已知状态返回映射表条目', () => {
    expect(getOrderStatusStyle(3)).toBe(ORDER_STATUS_COLORS[3])
    expect(getOrderStatusStyle(42)).toBe(ORDER_STATUS_FALLBACK)
  })
})
