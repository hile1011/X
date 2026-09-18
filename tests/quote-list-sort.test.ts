/**
 * 订单管理列表排序测试：客户名称 → 批次号分组 → 修改时间
 *
 * 覆盖规则：
 *   1. 客户名称升序分组
 *   2. 同客户内批次组之间按组内最新修改时间降序（修改时间最高优先级）
 *   3. 同批次订单严格连续，不被其他批次分隔
 *   4. 同批次组内按修改时间降序（最新修改排最前）
 *   5. 无批次订单按自身修改时间独立参与排序
 */
import { describe, it, expect } from 'vitest'
import { sortOrdersForList, type OrderListSortable } from '../src/utils/quoteSort'

function makeQuote(overrides: Partial<OrderListSortable>): OrderListSortable {
  return {
    customerName: '客户A',
    batchNumber: null,
    updated_at: '2026-09-01T10:00:00Z',
    id: 'quote-1',
    ...overrides,
  }
}

describe('sortOrdersForList 订单管理列表排序', () => {
  it('空数组返回空数组', () => {
    expect(sortOrdersForList([])).toEqual([])
  })

  it('一级：客户名称升序分组', () => {
    const result = sortOrdersForList([
      makeQuote({ customerName: '北京贸易', id: 'q1' }),
      makeQuote({ customerName: '上海科技', id: 'q2' }),
      makeQuote({ customerName: '安徽制造', id: 'q3' }),
    ])
    // 中文按拼音升序：安徽(an) < 北京(bei) < 上海(shang)
    expect(result.map((q) => q.customerName)).toEqual(['安徽制造', '北京贸易', '上海科技'])
  })

  it('二级：同客户内批次组按组内最新修改时间降序（修改时间最高优先级）', () => {
    const result = sortOrdersForList([
      // 批次 B1：组内最新 09-01
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-08-01T10:00:00Z', id: 'q1' }),
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-09-01T10:00:00Z', id: 'q2' }),
      // 批次 B2：组内最新 09-05（更晚 → 整组排前面）
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-09-05T10:00:00Z', id: 'q3' }),
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-08-20T10:00:00Z', id: 'q4' }),
    ])
    // B2 组（最新 09-05）在前，B1 组在后；组内各订单连续
    expect(result.map((q) => q.batchNumber)).toEqual([
      'PN-20260902000000', 'PN-20260902000000',
      'PN-20260901000000', 'PN-20260901000000',
    ])
  })

  it('关键场景：同批次订单严格连续，不被其他批次或无批次订单分隔', () => {
    // 干扰数据：穿插不同批次和修改时间，构造容易被普通排序打散的输入顺序
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-10T10:00:00Z', id: 'q-B1-1' }),
      makeQuote({ batchNumber: 'PN-B2', updated_at: '2026-09-09T10:00:00Z', id: 'q-B2-1' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-08-01T10:00:00Z', id: 'q-B1-2' }),
      makeQuote({ batchNumber: null, updated_at: '2026-09-12T10:00:00Z', id: 'q-N1' }),
      makeQuote({ batchNumber: 'PN-B2', updated_at: '2026-09-08T10:00:00Z', id: 'q-B2-2' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-11T10:00:00Z', id: 'q-B1-3' }),
    ])
    // 批次分组：B1 组最新 09-11，B2 组最新 09-09，无批次 q-N1 为 09-12
    // 组间按最新时间降序：q-N1(09-12) → B1 组(09-11) → B2 组(09-09)
    expect(result.map((q) => q.id)).toEqual([
      'q-N1',
      'q-B1-3', 'q-B1-1', 'q-B1-2',
      'q-B2-1', 'q-B2-2',
    ])
    // 断言同批次连续性
    const b1Idx = result.map((q, i) => (q.batchNumber === 'PN-B1' ? i : -1)).filter((i) => i >= 0)
    expect(b1Idx).toEqual([1, 2, 3])
    const b2Idx = result.map((q, i) => (q.batchNumber === 'PN-B2' ? i : -1)).filter((i) => i >= 0)
    expect(b2Idx).toEqual([4, 5])
  })

  it('三级：同批次组内按修改时间降序，最新修改排在该批次最前面', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-08-01T10:00:00Z', id: 'q-old' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-15T10:00:00Z', id: 'q-new' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-08-20T10:00:00Z', id: 'q-mid' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['q-new', 'q-mid', 'q-old'])
  })

  it('无批次订单按自身修改时间参与排序（最新在前，与批次组穿插）', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'q-B1' }),
      makeQuote({ batchNumber: null, updated_at: '2026-09-03T10:00:00Z', id: 'q-N-late' }),
      makeQuote({ batchNumber: null, updated_at: '2026-08-15T10:00:00Z', id: 'q-N-early' }),
    ])
    // 组间最新时间降序：q-N-late(09-03) → B1(09-01) → q-N-early(08-15)
    expect(result.map((q) => q.id)).toEqual(['q-N-late', 'q-B1', 'q-N-early'])
  })

  it('同批次不同客户的订单被客户分组隔开（客户名称为第一层级）', () => {
    const result = sortOrdersForList([
      makeQuote({ customerName: '客户B', batchNumber: 'PN-B1', updated_at: '2026-09-02T10:00:00Z', id: 'q-3' }),
      makeQuote({ customerName: '客户A', batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'q-1' }),
      makeQuote({ customerName: '客户B', batchNumber: 'PN-B1', updated_at: '2026-09-05T10:00:00Z', id: 'q-4' }),
      makeQuote({ customerName: '客户A', batchNumber: 'PN-B1', updated_at: '2026-09-10T10:00:00Z', id: 'q-2' }),
    ])
    // 客户名称拼音序：客户A < 客户B；各客户内同批次连续且按修改时间降序
    expect(result.map((q) => q.id)).toEqual(['q-2', 'q-1', 'q-4', 'q-3'])
  })

  it('批次组间恰有相同最新修改时间时，按批次号降序兜底且各组仍连续', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-09-10T10:00:00Z', id: 'q-1' }),
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-09-10T10:00:00Z', id: 'q-2' }),
      makeQuote({ batchNumber: 'PN-20260901000000', updated_at: '2026-08-01T10:00:00Z', id: 'q-3' }),
      makeQuote({ batchNumber: 'PN-20260902000000', updated_at: '2026-08-02T10:00:00Z', id: 'q-4' }),
    ])
    // 两组最新时间均为 09-10 → 批次号降序：PN-20260902 组在前
    expect(result.map((q) => q.id)).toEqual(['q-2', 'q-4', 'q-1', 'q-3'])
  })

  it('组内同修改时间按 id 降序兜底（新订单在前）', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'quote-100' }),
      makeQuote({ batchNumber: 'PN-B1', updated_at: '2026-09-01T10:00:00Z', id: 'quote-200' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['quote-200', 'quote-100'])
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

  it('无效/空修改时间视为 0，排在有效时间之后', () => {
    const result = sortOrdersForList([
      makeQuote({ batchNumber: null, updated_at: '', id: 'q-invalid' }),
      makeQuote({ batchNumber: null, updated_at: '2026-09-01T10:00:00Z', id: 'q-valid' }),
    ])
    expect(result.map((q) => q.id)).toEqual(['q-valid', 'q-invalid'])
  })

  it('多客户多批次综合场景', () => {
    const result = sortOrdersForList([
      // 客户C（拼音最大，排最后）
      makeQuote({ customerName: '客户C', batchNumber: 'PN-C1', updated_at: '2026-09-20T10:00:00Z', id: 'c1-a' }),
      makeQuote({ customerName: '客户C', batchNumber: 'PN-C1', updated_at: '2026-09-18T10:00:00Z', id: 'c1-b' }),
      // 客户A 的 B1 批次（组内最新 09-15）
      makeQuote({ customerName: '客户A', batchNumber: 'PN-A1', updated_at: '2026-09-15T10:00:00Z', id: 'a1-a' }),
      makeQuote({ customerName: '客户A', batchNumber: 'PN-A1', updated_at: '2026-09-02T10:00:00Z', id: 'a1-b' }),
      // 客户A 的 B2 批次（组内最新 09-08）
      makeQuote({ customerName: '客户A', batchNumber: 'PN-A2', updated_at: '2026-09-08T10:00:00Z', id: 'a2-a' }),
      makeQuote({ customerName: '客户A', batchNumber: 'PN-A2', updated_at: '2026-09-09T10:00:00Z', id: 'a2-b' }),
      // 客户A 无批次订单（09-12，最新）
      makeQuote({ customerName: '客户A', batchNumber: null, updated_at: '2026-09-12T10:00:00Z', id: 'an-1' }),
    ])
    expect(result.map((q) => q.id)).toEqual([
      // 客户A：B1 组(最新09-15，组内降序) → 无批次(09-12) → B2 组(最新09-09)
      'a1-a', 'a1-b',
      'an-1',
      'a2-b', 'a2-a',
      // 客户C：B1 组内降序
      'c1-a', 'c1-b',
    ])
  })
})
