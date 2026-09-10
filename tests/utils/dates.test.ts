/**
 * 日期工具函数（src/utils/dates.ts）单元测试
 *
 * 测试目标（任务4：订单状态跟踪日期显示修复）：
 *   1. parseLocalDate —— 跨时区一致的日期解析（修复根本原因：
 *      new Date("YYYY-MM-DD") 按 UTC 0 点解析，负时区会显示为前一天）
 *   2. toLocalDateStr —— Date → 本地 "YYYY-MM-DD"（替代 toISOString 的 UTC 偏移）
 *   3. formatQuoteDate —— 中文日期格式化，任何环境下 "YYYY-MM-DD" 显示为同一天
 *   4. isValidDateString —— 有效性校验
 *   5. getGanttBarGeometry —— 甘特图进度条几何计算（对齐日期表头列、含首尾天数、
 *      缺失日期回退、越界钳制、跨月/跨年场景）
 *
 * 说明：测试断言的核心不变量为「解析结果的本地日期分量 === 字符串中的年月日」，
 * 该不变量在任意时区（含 UTC-5 等负时区）下均成立，从而保证浏览器环境一致性。
 */
import { describe, it, expect } from 'vitest'
import {
  parseLocalDate,
  toLocalDateStr,
  formatQuoteDate,
  isValidDateString,
  getGanttBarGeometry,
} from '../../src/utils/dates'

const DAY_MS = 1000 * 60 * 60 * 24
/** 构造本地 0 点日期的便捷函数 */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day)

describe('parseLocalDate - 跨时区一致解析', () => {
  it('"YYYY-MM-DD" 解析为本地 0 点，日期分量与字符串一致（核心不变量）', () => {
    const parsed = parseLocalDate('2026-09-09')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8) // 0-indexed
    expect(parsed.getDate()).toBe(9)
    expect(parsed.getHours()).toBe(0)
    expect(parsed.getMinutes()).toBe(0)
  })

  it('带时间的 "YYYY-MM-DDTHH:mm:ss" 只取日期部分', () => {
    const parsed = parseLocalDate('2026-09-09T23:59:59')
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(9)
  })

  it('月末/年初边界：12-31 与 1-1 均不发生偏移', () => {
    expect(parseLocalDate('2026-12-31').getMonth()).toBe(11)
    expect(parseLocalDate('2026-12-31').getDate()).toBe(31)
    expect(parseLocalDate('2027-01-01').getMonth()).toBe(0)
    expect(parseLocalDate('2027-01-01').getDate()).toBe(1)
  })

  it('闰年 2 月 29 日可正常解析', () => {
    const parsed = parseLocalDate('2024-02-29')
    expect(parsed.getFullYear()).toBe(2024)
    expect(parsed.getMonth()).toBe(1)
    expect(parsed.getDate()).toBe(29)
  })

  it('单位数月份/日期（非补零）按字符串数字解析', () => {
    const parsed = parseLocalDate('2026-9-5')
    expect(parsed.getMonth()).toBe(8)
    expect(parsed.getDate()).toBe(5)
  })
})

describe('toLocalDateStr - 本地日期字符串', () => {
  it('Date → "YYYY-MM-DD"，单位数补零', () => {
    expect(toLocalDateStr(d(2026, 9, 9))).toBe('2026-09-09')
    expect(toLocalDateStr(d(2026, 1, 5))).toBe('2026-01-05')
    expect(toLocalDateStr(d(2026, 12, 31))).toBe('2026-12-31')
  })

  it('带时间的 Date 只取日期部分（本地 0 点基准）', () => {
    const withTime = new Date(2026, 8, 9, 15, 30, 0)
    expect(toLocalDateStr(withTime)).toBe('2026-09-09')
  })

  it('与 parseLocalDate 互为逆操作（往返一致）', () => {
    const str = '2026-03-15'
    expect(toLocalDateStr(parseLocalDate(str))).toBe(str)
    const date = d(2027, 11, 25)
    expect(parseLocalDate(toLocalDateStr(date)).getTime()).toBe(date.getTime())
  })

  it('跨年边界：12-31 → 次年 1-1', () => {
    const dec31 = d(2026, 12, 31)
    const next = new Date(dec31.getTime() + DAY_MS)
    expect(toLocalDateStr(next)).toBe('2027-01-01')
  })
})

describe('formatQuoteDate - 中文日期格式化', () => {
  it('"YYYY-MM-DD" 格式化为 "YYYY/M/D"', () => {
    expect(formatQuoteDate('2026-09-09')).toBe('2026/9/9')
    expect(formatQuoteDate('2026-01-05')).toBe('2026/1/5')
    expect(formatQuoteDate('2026-12-31')).toBe('2026/12/31')
  })

  it('带时间的字符串只格式化日期部分', () => {
    expect(formatQuoteDate('2026-09-09T08:30:00')).toBe('2026/9/9')
  })

  it('跨年区间：不同年份日期各自显示正确年份', () => {
    expect(formatQuoteDate('2026-12-30')).toBe('2026/12/30')
    expect(formatQuoteDate('2027-01-02')).toBe('2027/1/2')
  })
})

describe('isValidDateString - 有效性校验', () => {
  it('合法日期返回 true', () => {
    expect(isValidDateString('2026-09-09')).toBe(true)
    expect(isValidDateString('2026-09-09T10:00:00')).toBe(true)
  })

  it('空串 / undefined / null 返回 false', () => {
    expect(isValidDateString('')).toBe(false)
    expect(isValidDateString(undefined)).toBe(false)
    expect(isValidDateString(null)).toBe(false)
  })

  it('非法格式返回 false', () => {
    expect(isValidDateString('invalid')).toBe(false)
    expect(isValidDateString('abc-def-ghi')).toBe(false)
  })
})

describe('getGanttBarGeometry - 甘特图进度条几何', () => {
  // 基准范围：9/1 ~ 9/7 共 7 个日期列（rangeDays=6, columns=7）
  const minDate = d(2026, 9, 1)
  const maxDate = d(2026, 9, 7)
  const today = d(2026, 9, 4)

  it('起始日 = 范围首日 → left 为 0%（对齐首列左边缘）', () => {
    const geo = getGanttBarGeometry('2026-09-01', '2026-09-03', minDate, maxDate, today)
    expect(geo.left).toBe(0)
  })

  it('跨度含首尾：9/1~9/3 占 3 列 → width = 3/7', () => {
    const geo = getGanttBarGeometry('2026-09-01', '2026-09-03', minDate, maxDate, today)
    expect(geo.left).toBe(0)
    expect(geo.width).toBeCloseTo((3 / 7) * 100, 10)
  })

  it('中间区间：9/4~9/5 → left = 3/7, width = 2/7', () => {
    const geo = getGanttBarGeometry('2026-09-04', '2026-09-05', minDate, maxDate, today)
    expect(geo.left).toBeCloseTo((3 / 7) * 100, 10)
    expect(geo.width).toBeCloseTo((2 / 7) * 100, 10)
  })

  it('单日区间：9/7~9/7 → 占最后一列，width = 1/7', () => {
    const geo = getGanttBarGeometry('2026-09-07', '2026-09-07', minDate, maxDate, today)
    expect(geo.left).toBeCloseTo((6 / 7) * 100, 10)
    expect(geo.width).toBeCloseTo((1 / 7) * 100, 10)
  })

  it('整段占满范围：9/1~9/7 → left=0, width=100%', () => {
    const geo = getGanttBarGeometry('2026-09-01', '2026-09-07', minDate, maxDate, today)
    expect(geo.left).toBe(0)
    expect(geo.width).toBe(100)
  })

  it('起始日期缺失 → 回退到 minDate（left=0）', () => {
    const geo = getGanttBarGeometry(undefined, '2026-09-03', minDate, maxDate, today)
    expect(geo.left).toBe(0)
    expect(geo.width).toBeCloseTo((3 / 7) * 100, 10)
  })

  it('到期日期缺失 → 回退到注入的"今天"（9/4）', () => {
    const geo = getGanttBarGeometry('2026-09-02', undefined, minDate, maxDate, today)
    // 起始 9/2（offset 1 天），结束回退今天 9/4 → 含首尾 3 天
    expect(geo.left).toBeCloseTo((1 / 7) * 100, 10)
    expect(geo.width).toBeCloseTo((3 / 7) * 100, 10)
  })

  it('起始早于范围 → left 钳制为 0（不出现负值）', () => {
    const geo = getGanttBarGeometry('2026-08-28', '2026-09-03', minDate, maxDate, today)
    expect(geo.left).toBe(0)
    // 实际跨度 8/28~9/3 共 7 天，但右边缘不超过甘特区域末端
    expect(geo.width).toBe(100)
  })

  it('结束晚于范围 → 右边缘钳制在 100%（不溢出）', () => {
    const geo = getGanttBarGeometry('2026-09-05', '2026-09-20', minDate, maxDate, today)
    expect(geo.left).toBeCloseTo((4 / 7) * 100, 10)
    expect(geo.left + geo.width).toBeLessThanOrEqual(100)
    expect(geo.width).toBe(100 - (4 / 7) * 100)
  })

  it('起止均在范围之前 → width 钳制为 0', () => {
    const geo = getGanttBarGeometry('2026-08-10', '2026-08-15', minDate, maxDate, today)
    expect(geo.left).toBe(0)
    expect(geo.width).toBeGreaterThanOrEqual(0)
    expect(geo.left + geo.width).toBeLessThanOrEqual(100)
  })

  it('跨月场景：8/30~9/2 在 8/29~9/3 范围内正确对齐', () => {
    const min = d(2026, 8, 29)
    const max = d(2026, 9, 3) // 共 6 列
    const geo = getGanttBarGeometry('2026-08-30', '2026-09-02', min, max, today)
    expect(geo.left).toBeCloseTo((1 / 6) * 100, 10)
    expect(geo.width).toBeCloseTo((4 / 6) * 100, 10) // 8/30、8/31、9/1、9/2 共 4 天
  })

  it('跨年场景：2026-12-30~2027-01-02 在 2026-12-29~2027-01-03 范围内正确对齐', () => {
    const min = d(2026, 12, 29)
    const max = d(2027, 1, 3) // 共 6 列
    const geo = getGanttBarGeometry('2026-12-30', '2027-01-02', min, max, today)
    expect(geo.left).toBeCloseTo((1 / 6) * 100, 10)
    expect(geo.width).toBeCloseTo((4 / 6) * 100, 10)
  })

  it('闰年 2 月：2/28~2/29（2024）跨月前正确计算', () => {
    const min = d(2024, 2, 27)
    const max = d(2024, 3, 2) // 共 5 列
    const geo = getGanttBarGeometry('2024-02-28', '2024-02-29', min, max, today)
    expect(geo.left).toBeCloseTo((1 / 5) * 100, 10)
    expect(geo.width).toBeCloseTo((2 / 5) * 100, 10)
  })

  it('所有结果的 left/width 均在 [0, 100] 区间（渲染安全）', () => {
    const scenarios: Array<[string | undefined, string | undefined]> = [
      ['2026-08-01', '2026-10-31'],
      ['2026-09-04', '2026-09-04'],
      [undefined, undefined],
      ['2026-09-07', undefined],
      [undefined, '2026-09-01'],
    ]
    scenarios.forEach(([s, e]) => {
      const geo = getGanttBarGeometry(s, e, minDate, maxDate, today)
      expect(geo.left).toBeGreaterThanOrEqual(0)
      expect(geo.left).toBeLessThanOrEqual(100)
      expect(geo.width).toBeGreaterThanOrEqual(0)
      expect(geo.width).toBeLessThanOrEqual(100 - geo.left + 1e-9)
    })
  })

  it('默认 today 参数（不注入）也能工作', () => {
    const geo = getGanttBarGeometry('2026-09-01', '2026-09-05', minDate, maxDate)
    expect(geo.left).toBe(0)
    expect(geo.width).toBeCloseTo((5 / 7) * 100, 10)
  })
})
