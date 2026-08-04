/**
 * DateUtils 工具类单元测试
 *
 * 测试目标：
 *   - addDays() 日期加天数计算
 *   - today() 获取今天日期
 *   - 边界情况（空值、无效日期、0、负数）
 *   - 跨月、跨年、闰年计算
 */
import { describe, it, expect } from 'vitest'
import { DateUtils } from '../../src/utils/DateUtils'

describe('DateUtils.addDays - 日期加天数', () => {
  it('开始日期 + 30天 = 结束日期', () => {
    expect(DateUtils.addDays('2026-07-31', 30)).toBe('2026-08-30')
  })

  it('跨月计算正确', () => {
    expect(DateUtils.addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('跨年计算正确', () => {
    expect(DateUtils.addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('闰年2月计算正确', () => {
    expect(DateUtils.addDays('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('非闰年2月计算正确', () => {
    expect(DateUtils.addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('天数为 0 时返回空字符串', () => {
    expect(DateUtils.addDays('2026-07-31', 0)).toBe('')
  })

  it('天数为负时正确回退日期', () => {
    expect(DateUtils.addDays('2026-07-31', -5)).toBe('2026-07-26')
  })

  it('天数为负跨月回退', () => {
    expect(DateUtils.addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('开始日期为空时返回空', () => {
    expect(DateUtils.addDays('', 30)).toBe('')
  })

  it('无效日期返回空', () => {
    expect(DateUtils.addDays('invalid-date', 30)).toBe('')
  })

  it('NaN 天数返回空', () => {
    expect(DateUtils.addDays('2026-07-31', NaN)).toBe('')
  })
})

describe('DateUtils.today - 获取今天日期', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    const today = DateUtils.today()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('与 new Date().toISOString().split("T")[0] 一致', () => {
    const expected = new Date().toISOString().split('T')[0]
    expect(DateUtils.today()).toBe(expected)
  })
})
