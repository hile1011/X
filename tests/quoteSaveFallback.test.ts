/**
 * 保存公式收集竞态兜底 单元测试
 * 测试目标：src/pages/BagQuote.tsx 导出的 resolveFormulasFallback
 *
 * 背景（2026-09-13 生产事故）：订单编辑页保存时公式收集因竞态返回空对象，
 * 直接保存把数据库 79 个公式清成 {}。兜底函数确保收集为空时按
 * "已保存公式 → 模板公式" 的顺序回退，永不产生空公式集。
 */
import { describe, it, expect } from 'vitest'
import { resolveFormulasFallback } from '../src/pages/BagQuote'

const SAVED: Record<string, string> = {
  C6: '=H3*I3*1.1/10000',
  M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
  J8: '=SUM(J6:J7)',
}

const TEMPLATE: Record<string, string> = {
  B3: '=B2',
  C3: '=C2',
  O2: '=SUM(O3:O7)',
}

describe('resolveFormulasFallback - 正常场景', () => {
  it('实时收集有公式：原样返回收集结果（不兜底）', () => {
    const collected = { A1: '=B1', A2: '=B2' }
    expect(resolveFormulasFallback(collected, SAVED, TEMPLATE)).toBe(collected)
  })

  it('收集结果即使只有 1 个公式：原样返回（非空即有效）', () => {
    const collected = { A1: '=B1' }
    const result = resolveFormulasFallback(collected, SAVED, TEMPLATE)
    expect(result).toEqual({ A1: '=B1' })
  })
})

describe('resolveFormulasFallback - 竞态兜底', () => {
  it('事故场景：收集为空（竞态）+ 数据库已保存公式 → 回退已保存公式', () => {
    const result = resolveFormulasFallback({}, SAVED, TEMPLATE)
    expect(result).toEqual(SAVED)
  })

  it('收集为空 + 已保存公式为空（切换模板后）→ 回退模板公式', () => {
    const result = resolveFormulasFallback({}, {}, TEMPLATE)
    expect(result).toEqual(TEMPLATE)
  })

  it('收集为空 + 两级回退源都为空 → 返回空对象（新建订单尚无公式）', () => {
    const result = resolveFormulasFallback({}, {}, {})
    expect(result).toEqual({})
  })
})

describe('resolveFormulasFallback - 不可变性', () => {
  it('回退时返回副本：修改结果不影响源对象（防止意外污染 ref）', () => {
    const savedRef = { A1: '=1' }
    const result = resolveFormulasFallback({}, savedRef, TEMPLATE)
    result.A2 = '=2'
    expect(savedRef).toEqual({ A1: '=1' })
    expect(result).not.toBe(savedRef)
  })

  it('回退模板时返回副本：修改结果不影响模板缓存', () => {
    const result = resolveFormulasFallback({}, {}, TEMPLATE)
    result.B3 = '=CHANGED'
    expect(TEMPLATE.B3).toBe('=B2')
    expect(result).not.toBe(TEMPLATE)
  })
})
