/**
 * 订单管理列表排序测试：批次分组 → 修改时间（多级排序）
 *
 * 覆盖规则与边界：
 *   1. 一级（组间）：批次组按组内最新修改时间降序（含最新修改订单的组排最前）
 *   2. 二级（组内）：同批次组内按修改时间降序
 *   3. 三级（连续性）：同批次订单严格连续，保持二级相对顺序
 *   边界：组间相同最新时间（批次号降序兜底）、组内相同修改时间（id 降序兜底）、
 *        无批次号订单（视为唯一批次标识、各自独立成组）
 */
import { describe, it, expect } from 'vitest'
import { sortOrdersForList, type OrderListSortable } from '../src/utils/quoteSort'

function makeQuote(overrides: Partial<OrderListSortable>): OrderListSortable {
  return {
    batchNumber: null,
    updated_at: '2026-09-01T10:00:00Z',
    id: 'quote-1',
    ...overrides,
  }
}

describe('sortOrdersForList 订单管理列表排序（批次分组 → 修改时间）', () => {
  it('空数组返回空数组', () => {
    expect(sortOrdersForList([])).toEqual([])
  })

  it('一级：批次组按组内最新修改时间降序（含最新订单的组排最前）', () => {
    const result = sortOrdersForList([
      // 批次 B1：组内最新 09-01
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-08-01T10:00:00Z', id: 'q1' }),
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-09-01T10:00:00Z', id: 'q2' }),
      // 批次 B2：组内最新 09-05（更晚 → 整组排前面，即使批次号更小）
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-09-05T10:00:00Z', id: 'q3' }),
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-08-20T10:00:00Z', id: 'q4' }),
    ])
    expect(result.map((q) => q.batchNumber)).toEqual([
      'PN-20260902000000', 'PN-20260902000000',
      'PN-20260901000000', 'PN-20260901000000',
    ])
  })

  it('二级：同批次组内按修改时间降序，最新修改排在该组最前面', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-08-01T10:00:00Z', id: 'q-old' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-15T10:00:00Z', id: 'q-new' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-08-20T10:00:00Z', id: 'q-mid' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['q-new', 'q-mid', 'q-old'])
  })

  it('三级：同批次订单严格连续，不被其他批次或无批次订单分隔（含干扰数据）', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-10T10:00:00Z', id: 'q-B1-1' }),
      makeQuote({ batchNumber: 'PN-B2', updated_at: '2026-09-09T10:00:00Z', id: 'q-B2-1' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-08-01T10:00:00Z', id: 'q-B1-2' }),
      makeQuote({ batchNumber: null, updated_at: '2026-09-12T10:00:00Z', id: 'q-N1' }),
      makeQuote({ batchNumber: 'PN-B2', updated_at: '2026-09-08T10:00:00Z', id: 'q-B2-2' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-11T10:00:00Z', id: 'q-B1-3' }),
    ])
    // 组间最新时间降序：q-N1(09-12) → B1 组(最新 09-11) → B2 组(最新 09-09)
    // 同批次连续且组内保持二级相对顺序（修改时间降序）
    expect(result.map((q) => q.id)).toEqual([
      'q-N1',
      'q-B1-3', 'q-B1-1', 'q-B1-2',
      'q-B2-1', 'q-B2-2',
    ])
    const b1Idx = result.map((q, i) => (q.batchNumber === 'PN-B1' ? i : -1)).filter((i) => i >= 0)
    expect(b1Idx).toEqual([1, 2, 3])
    const b2Idx = result.map((q, i) => (q.batchNumber === 'PN-B2' ? i : -1)).filter((i) => i >= 0)
    expect(b2Idx).toEqual([4, 5])
  })

  it('边界：组间最新修改时间相同，按批次号降序兜底且各组仍连续', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-09-10T10:00:00Z', id: 'q-1' }),
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-09-10T10:00:00Z', id: 'q-2' }),
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-08-01T10:00:00Z', id: 'q-3' }),
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-08-02T10:00:00Z', id: 'q-4' }),
    ])
    // 两组最新时间均为 09-10 → 批次号降序：PN-20260902 组在前
    expect(result.map((q) => q.id)).toEqual(['q-2', 'q-4', 'q-1', 'q-3'])
  })

  it('边界：组内修改时间相同，按 id 降序兜底（新订单在前）', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'quote-100' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'quote-200' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['quote-200', 'quote-100'])
  })

  it('边界：无批次号订单视为唯一批次标识，各自独立成组、按自身修改时间参与组间排序', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'q-B1' }),
      makeQuote({ batchNumber: null, updated_at: '2026-09-03T10:00:00Z', id: 'q-N-late' }),
      makeQuote({ batchNumber: null, updated_at: '2026-08-15T10:00:00Z', id: 'q-N-early' }),
    ])
    // 组间最新时间降序：q-N-late(09-03) → B1(09-01) → q-N-early(08-15)
    expect(result.map((q) => q.id)).toEqual(['q-N-late', 'q-B1', 'q-N-early'])
  })

  it('同批次跨客户的订单也连续显示（分组标准仅为批次号）', () => {
    // customerName 不参与排序（接口中已无该字段），同批次订单即使客户不同也连续
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-02T10:00:00Z', id: 'q-3' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'q-1' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-05T10:00:00Z', id: 'q-4' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-10T10:00:00Z', id: 'q-2' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['q-2', 'q-4', 'q-3', 'q-1'])
  })

  it('无效/空修改时间视为 0，排在有效时间之后', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: null, updated_at: '', id: 'q-invalid' }),
      makeQuote({ batchNumber: null, updated_at: '2026-09-01T10:00:00Z', id: 'q-valid' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['q-valid', 'q-invalid'])
  })

  it('不修改原数组', () => {
    const original = [
      makeQuote({ id: 'q1', updated_at: '2026-09-02T10:00:00Z' }),
      makeQuote({ id: 'q2', updated_at: '2026-09-01T10:00:00Z' }),
    ]
    const snapshot = [...original]
    sortOrdersForList(original)
    expect(original).toEqual(snapshot)
  })

  it('多批次多无批次综合场景', () => {
    const result = sortOrdersForList([
      // 批次 C1：组内最新 09-20
      makeQuote({ batchNumber: 'PN-C1', updated_at: '2026-09-20T10:00:00Z', id: 'c1-a' }),
      makeQuote({ batchNumber: 'PN-C1', updated_at: '2026-09-18T10:00:00Z', id: 'c1-b' }),
      // 批次 A1：组内最新 09-15
      makeQuote({ batchNumber: 'PN-A1', updated_at: '2026-09-15T10:00:00Z', id: 'a1-a' }),
      makeQuote({ batchNumber: 'PN-A1', updated_at: '2026-09-02T10:00:00Z', id: 'a1-b' }),
      // 批次 A2：组内最新 09-09
      makeQuote({ batchNumber: 'PN-A2', updated_at: '2026-09-08T10:00:00Z', id: 'a2-a' }),
      makeQuote({ batchNumber: 'PN-A2', updated_at: '2026-09-09T10:00:00Z', id: 'a2-b' }),
      // 无批次订单：09-12
      makeQuote({ batchNumber: null, updated_at: '2026-09-12T10:00:00Z', id: 'an-1' }),
    ])
    // 组间最新时间降序：C1(09-20) → A1(09-15) → an-1(09-12) → A2(09-09)
    expect(result.map((q) => q.id)).toEqual([
      'c1-a', 'c1-b',
      'a1-a', 'a1-b',
      'an-1',
      'a2-b', 'a2-a',
    ])
  })
})
