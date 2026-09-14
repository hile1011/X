/**
 * 订单数据防篡改守卫 单元测试
 * 测试目标：api/services/quoteDataGuard.ts
 *
 * 背景（2026-09-13 生产事故）：编辑订单时切换款式/模板后保存，
 * 订单 101 行表格数据被 31 行模板默认数据替换，且公式收集竞态返回空
 * 导致 allFormulas 被清成 {}。守卫在服务端拦截这类疑似误保存。
 *
 * 纯函数测试，不依赖数据库与网络。
 */
import { describe, it, expect } from 'vitest'
import { detectQuoteDataReset, QUOTE_DATA_RESET_CODE } from '../api/services/quoteDataGuard'

/** 构造已保存订单侧数据（默认 101 行 / 79 公式，对齐事故订单规模） */
function existingFixture(overrides: { rows?: number; formulas?: number } = {}) {
  const rows = overrides.rows ?? 101
  const formulas = overrides.formulas ?? 79
  const tableData = Array.from({ length: rows }, () => Array.from({ length: 16 }, () => 0))
  const allFormulas: Record<string, string> = {}
  for (let i = 0; i < formulas; i++) {
    allFormulas[`A${i + 1}`] = '=B1'
  }
  return { tableData, allFormulas }
}

/** 构造更新请求侧数据 */
function incomingFixture(overrides: { rows?: number; formulas?: number } = {}) {
  const rows = overrides.rows ?? 101
  const formulas = overrides.formulas ?? 79
  const tableData = Array.from({ length: rows }, () => Array.from({ length: 16 }, () => 0))
  const allFormulas: Record<string, string> = {}
  for (let i = 0; i < formulas; i++) {
    allFormulas[`A${i + 1}`] = '=B1'
  }
  return { tableData, allFormulas }
}

describe('detectQuoteDataReset - 常规更新放行', () => {
  it('数据量基本不变：放行（null）', () => {
    expect(detectQuoteDataReset(existingFixture(), incomingFixture())).toBeNull()
  })

  it('行数与公式数小幅变化：放行', () => {
    expect(detectQuoteDataReset(existingFixture(), incomingFixture({ rows: 102, formulas: 75 }))).toBeNull()
  })

  it('局部更新（仅改状态，不携带表格/公式字段）：放行', () => {
    expect(detectQuoteDataReset(existingFixture(), {})).toBeNull()
  })

  it('只更新表格字段（不携带 allFormulas）：正常编辑放行', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      { tableData: incomingFixture({ rows: 100 }).tableData },
    )
    expect(result).toBeNull()
  })

  it('只更新公式字段（不携带 tableData）：公式数正常变化放行', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      { allFormulas: incomingFixture({ formulas: 60 }).allFormulas },
    )
    expect(result).toBeNull()
  })

  it('表格从小规模编辑到更小（< 阈值 20 行）：放行', () => {
    const result = detectQuoteDataReset(
      existingFixture({ rows: 10 }),
      incomingFixture({ rows: 2 }),
    )
    expect(result).toBeNull()
  })

  it('公式数低于阈值（< 5 个）时清空：放行（小订单正常精简）', () => {
    const result = detectQuoteDataReset(
      existingFixture({ formulas: 3 }),
      incomingFixture({ formulas: 0 }),
    )
    expect(result).toBeNull()
  })

  it('allFormulas 为 null（显式置空）：同样拦截（db 层 null || {} 会清空公式）', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      { tableData: incomingFixture().tableData, allFormulas: null },
    )
    expect(result).not.toBeNull()
  })
})

describe('detectQuoteDataReset - 公式清空拦截', () => {
  it('已有 79 个公式，请求清空为 {}：拦截并提示公式数量', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      incomingFixture({ formulas: 0 }),
    )
    expect(result).not.toBeNull()
    expect(result).toContain('79')
    expect(result).toContain('公式')
  })

  it('allFormulas 为空对象（显式携带）：拦截', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      { allFormulas: {} },
    )
    expect(result).not.toBeNull()
  })

  it('allFormulas 为数组（异常类型，键数为 0）：拦截', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      { allFormulas: [] as unknown as Record<string, string> },
    )
    expect(result).not.toBeNull()
  })

  it('已有公式刚好达到阈值 5 个，请求清空：拦截', () => {
    const result = detectQuoteDataReset(
      existingFixture({ formulas: 5 }),
      incomingFixture({ formulas: 0 }),
    )
    expect(result).not.toBeNull()
    expect(result).toContain('5')
  })
})

describe('detectQuoteDataReset - 表格大幅缩水拦截', () => {
  it('事故场景复现：101 行 → 31 行（30.7%，不足 50%）：拦截', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      incomingFixture({ rows: 31 }),
    )
    expect(result).not.toBeNull()
    expect(result).toContain('101')
    expect(result).toContain('31')
  })

  it('请求 tableData 为空数组（表格实例未就绪）：拦截', () => {
    const result = detectQuoteDataReset(
      existingFixture(),
      incomingFixture({ rows: 0 }),
    )
    expect(result).not.toBeNull()
  })

  it('新行数刚好为原有的 50%：放行（边界，不含等于）', () => {
    // 101 行的 50% = 50.5，50 行 < 50.5 → 拦截
    expect(detectQuoteDataReset(existingFixture(), incomingFixture({ rows: 50 }))).not.toBeNull()
    // 100 行的 50% = 50，51 行 > 50 → 放行
    expect(detectQuoteDataReset(existingFixture({ rows: 100 }), incomingFixture({ rows: 51 }))).toBeNull()
  })

  it('已保存表格为空（新订单首次保存）：放行', () => {
    const result = detectQuoteDataReset(
      { tableData: [], allFormulas: {} },
      incomingFixture({ rows: 31 }),
    )
    expect(result).toBeNull()
  })

  it('已保存行数刚好达到阈值 20，请求 1 行：拦截', () => {
    const result = detectQuoteDataReset(
      existingFixture({ rows: 20 }),
      incomingFixture({ rows: 1 }),
    )
    expect(result).not.toBeNull()
  })
})

describe('detectQuoteDataReset - 拦截文案与错误码', () => {
  it('返回的文案包含用户可操作指引（确定/取消）', () => {
    const formulaResult = detectQuoteDataReset(existingFixture(), { allFormulas: {} })
    expect(formulaResult).toContain('确定')
    expect(formulaResult).toContain('取消')

    const rowsResult = detectQuoteDataReset(existingFixture(), incomingFixture({ rows: 10 }))
    expect(rowsResult).toContain('确定')
    expect(rowsResult).toContain('取消')
  })

  it('导出的守卫错误码为固定值（前端据此分支处理）', () => {
    expect(QUOTE_DATA_RESET_CODE).toBe('QUOTE_DATA_RESET_CONFIRM_REQUIRED')
  })
})
