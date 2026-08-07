/**
 * SelectionSummary 单元测试
 * 测试目标：toNumber / computeSelectionSummary / loadVisibleMetrics / saveVisibleMetrics / METRIC_CONFIGS
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  toNumber,
  computeSelectionSummary,
  loadVisibleMetrics,
  saveVisibleMetrics,
  METRIC_CONFIGS,
  DEFAULT_METRICS,
  ALL_METRICS,
  type CellRangeLike,
} from '../../src/utils/SelectionSummary'

// ============================ toNumber ============================

describe('toNumber - 值转数字', () => {
  it('数字类型直接返回', () => {
    expect(toNumber(42)).toBe(42)
    expect(toNumber(3.14)).toBe(3.14)
    expect(toNumber(0)).toBe(0)
    expect(toNumber(-10)).toBe(-10)
  })

  it('NaN 返回 null', () => {
    expect(toNumber(NaN)).toBeNull()
  })

  it('null / undefined 返回 null', () => {
    expect(toNumber(null)).toBeNull()
    expect(toNumber(undefined)).toBeNull()
  })

  it('布尔值返回 null', () => {
    expect(toNumber(true)).toBeNull()
    expect(toNumber(false)).toBeNull()
  })

  it('纯数字字符串解析', () => {
    expect(toNumber('123')).toBe(123)
    expect(toNumber('3.14')).toBe(3.14)
    expect(toNumber('-5')).toBe(-5)
  })

  it('空字符串返回 null', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber('   ')).toBeNull()
  })

  it('百分比字符串解析（除以 100）', () => {
    expect(toNumber('12.5%')).toBeCloseTo(0.125)
    expect(toNumber('100%')).toBe(1)
    expect(toNumber('0%')).toBe(0)
  })

  it('百分比带千分位解析', () => {
    expect(toNumber('1,000%')).toBe(10)
  })

  it('货币符号 + 千分位解析', () => {
    expect(toNumber('¥1,234.50')).toBeCloseTo(1234.5)
    expect(toNumber('$1,000')).toBe(1000)
    expect(toNumber('€500')).toBe(500)
    expect(toNumber('£99.99')).toBeCloseTo(99.99)
  })

  it('仅符号或分隔符返回 null', () => {
    expect(toNumber('-')).toBeNull()
    expect(toNumber('.')).toBeNull()
    expect(toNumber('¥')).toBeNull()
    expect(toNumber(',')).toBeNull()
  })

  it('非数值字符串返回 null', () => {
    expect(toNumber('abc')).toBeNull()
    expect(toNumber('N/A')).toBeNull()
  })

  it('对象类型返回 null', () => {
    expect(toNumber({} as unknown)).toBeNull()
    expect(toNumber([] as unknown)).toBeNull()
  })
})

// ============================ computeSelectionSummary ============================

describe('computeSelectionSummary - 选区汇总计算', () => {
  // 构造一个 3x3 的数据网格
  const grid: (number | string | null)[][] = [
    [1, 2, 3],
    [4, 'abc', null],
    ['50%', '¥100', ''],
  ]

  const getValue = (col: number, row: number) => grid[row]?.[col]

  it('单个连续选区计算正确', () => {
    const range: CellRangeLike = { start: { col: 0, row: 0 }, end: { col: 2, row: 0 } }
    const result = computeSelectionSummary([range], getValue)
    // [1, 2, 3] → sum=6, avg=2, count=3, numericCount=3, min=1, max=3
    expect(result.sum).toBe(6)
    expect(result.average).toBe(2)
    expect(result.count).toBe(3)
    expect(result.numericCount).toBe(3)
    expect(result.min).toBe(1)
    expect(result.max).toBe(3)
    expect(result.hasValues).toBe(true)
  })

  it('含非数值与空值的选区', () => {
    const range: CellRangeLike = { start: { col: 0, row: 1 }, end: { col: 2, row: 1 } }
    const result = computeSelectionSummary([range], getValue)
    // [4, 'abc', null] → sum=4, avg=4, count=3, numericCount=1, min=4, max=4
    expect(result.sum).toBe(4)
    expect(result.average).toBe(4)
    expect(result.count).toBe(3)
    expect(result.numericCount).toBe(1)
    expect(result.min).toBe(4)
    expect(result.max).toBe(4)
    expect(result.hasValues).toBe(true)
  })

  it('百分比与货币字符串解析', () => {
    const range: CellRangeLike = { start: { col: 0, row: 2 }, end: { col: 2, row: 2 } }
    const result = computeSelectionSummary([range], getValue)
    // ['50%', '¥100', ''] → 0.5 + 100 = 100.5, count=3, numericCount=2
    expect(result.sum).toBeCloseTo(100.5)
    expect(result.count).toBe(3)
    expect(result.numericCount).toBe(2)
    expect(result.min).toBeCloseTo(0.5)
    expect(result.max).toBe(100)
    expect(result.hasValues).toBe(true)
  })

  it('全选 3x3 网格', () => {
    const range: CellRangeLike = { start: { col: 0, row: 0 }, end: { col: 2, row: 2 } }
    const result = computeSelectionSummary([range], getValue)
    // 数值：1+2+3+4+0.5+100 = 110.5, count=9, numericCount=6
    expect(result.sum).toBeCloseTo(110.5)
    expect(result.count).toBe(9)
    expect(result.numericCount).toBe(6)
    expect(result.min).toBeCloseTo(0.5)
    expect(result.max).toBe(100)
  })

  it('空选区返回 hasValues=false', () => {
    const range: CellRangeLike = { start: { col: 5, row: 5 }, end: { col: 5, row: 5 } }
    const result = computeSelectionSummary([range], getValue)
    expect(result.count).toBe(1)
    expect(result.numericCount).toBe(0)
    expect(result.hasValues).toBe(false)
    expect(result.sum).toBe(0)
    expect(result.average).toBe(0)
    expect(result.min).toBe(0)
    expect(result.max).toBe(0)
  })

  it('空 ranges 数组返回空汇总', () => {
    const result = computeSelectionSummary([], getValue)
    expect(result.count).toBe(0)
    expect(result.numericCount).toBe(0)
    expect(result.hasValues).toBe(false)
  })

  it('非连续选区（多个 Range）', () => {
    const ranges: CellRangeLike[] = [
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }, // 1
      { start: { col: 2, row: 2 }, end: { col: 2, row: 2 } }, // ''
    ]
    const result = computeSelectionSummary(ranges, getValue)
    expect(result.count).toBe(2)
    expect(result.numericCount).toBe(1)
    expect(result.sum).toBe(1)
  })

  it('重叠区域去重', () => {
    const ranges: CellRangeLike[] = [
      { start: { col: 0, row: 0 }, end: { col: 2, row: 0 } }, // [1,2,3]
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }, // [1] 重叠
    ]
    const result = computeSelectionSummary(ranges, getValue)
    // 去重后 count=3, sum=6
    expect(result.count).toBe(3)
    expect(result.sum).toBe(6)
  })

  it('start/end 颠倒时自动修正', () => {
    const range: CellRangeLike = { start: { col: 2, row: 0 }, end: { col: 0, row: 0 } }
    const result = computeSelectionSummary([range], getValue)
    expect(result.count).toBe(3)
    expect(result.sum).toBe(6)
  })

  it('非法 range（缺字段）被跳过', () => {
    const ranges = [
      null,
      undefined,
      { start: null, end: null },
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
    ] as unknown as CellRangeLike[]
    const result = computeSelectionSummary(ranges, getValue)
    expect(result.count).toBe(1)
    expect(result.sum).toBe(1)
  })

  it('单个数值的平均值正确', () => {
    const range: CellRangeLike = { start: { col: 1, row: 0 }, end: { col: 1, row: 0 } }
    const result = computeSelectionSummary([range], getValue)
    expect(result.average).toBe(2)
  })
})

// ============================ METRIC_CONFIGS ============================

describe('METRIC_CONFIGS - 指标格式化', () => {
  const withValues = {
    sum: 1234.5,
    average: 617.25,
    count: 5,
    numericCount: 2,
    min: 100,
    max: 1134.5,
    hasValues: true,
  }

  const noValues = {
    sum: 0,
    average: 0,
    count: 3,
    numericCount: 0,
    min: 0,
    max: 0,
    hasValues: false,
  }

  it('sum 格式化（有值）', () => {
    expect(METRIC_CONFIGS.sum.format(withValues)).toBe('1,234.50')
  })

  it('sum 格式化（无值）显示 -', () => {
    expect(METRIC_CONFIGS.sum.format(noValues)).toBe('-')
  })

  it('average 格式化', () => {
    expect(METRIC_CONFIGS.average.format(withValues)).toBe('617.25')
  })

  it('average 格式化（无值）显示 -', () => {
    expect(METRIC_CONFIGS.average.format(noValues)).toBe('-')
  })

  it('count 格式化（始终显示）', () => {
    expect(METRIC_CONFIGS.count.format(withValues)).toBe('5')
    expect(METRIC_CONFIGS.count.format(noValues)).toBe('3')
  })

  it('numericCount 格式化（始终显示）', () => {
    expect(METRIC_CONFIGS.numericCount.format(withValues)).toBe('2')
    expect(METRIC_CONFIGS.numericCount.format(noValues)).toBe('0')
  })

  it('min 格式化', () => {
    expect(METRIC_CONFIGS.min.format(withValues)).toBe('100')
  })

  it('min 格式化（无值）显示 -', () => {
    expect(METRIC_CONFIGS.min.format(noValues)).toBe('-')
  })

  it('max 格式化', () => {
    expect(METRIC_CONFIGS.max.format(withValues)).toBe('1,134.50')
  })

  it('max 格式化（无值）显示 -', () => {
    expect(METRIC_CONFIGS.max.format(noValues)).toBe('-')
  })

  it('整数不带小数', () => {
    const s = { ...withValues, sum: 1000 }
    expect(METRIC_CONFIGS.sum.format(s)).toBe('1,000')
  })

  it('标签正确', () => {
    expect(METRIC_CONFIGS.sum.label).toBe('求和')
    expect(METRIC_CONFIGS.average.label).toBe('平均值')
    expect(METRIC_CONFIGS.count.label).toBe('计数')
    expect(METRIC_CONFIGS.numericCount.label).toBe('数值计数')
    expect(METRIC_CONFIGS.min.label).toBe('最小值')
    expect(METRIC_CONFIGS.max.label).toBe('最大值')
  })
})

// ============================ DEFAULT_METRICS / ALL_METRICS ============================

describe('指标常量', () => {
  it('DEFAULT_METRICS 包含 6 个指标', () => {
    expect(DEFAULT_METRICS).toHaveLength(6)
  })

  it('ALL_METRICS 包含 6 个指标', () => {
    expect(ALL_METRICS).toHaveLength(6)
  })

  it('DEFAULT_METRICS 与 ALL_METRICS 内容一致（顺序不同）', () => {
    expect([...DEFAULT_METRICS].sort()).toEqual([...ALL_METRICS].sort())
  })
})

// ============================ loadVisibleMetrics / saveVisibleMetrics ============================

describe('loadVisibleMetrics / saveVisibleMetrics - localStorage 持久化', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('未设置时返回默认指标', () => {
    const result = loadVisibleMetrics()
    expect(result).toEqual(DEFAULT_METRICS)
  })

  it('保存后读取一致', () => {
    const custom = ['sum', 'count'] as const
    saveVisibleMetrics([...custom])
    expect(loadVisibleMetrics()).toEqual(['sum', 'count'])
  })

  it('非法 JSON 返回默认值', () => {
    localStorage.setItem('vtable-summary-metrics', '{invalid json')
    expect(loadVisibleMetrics()).toEqual(DEFAULT_METRICS)
  })

  it('非数组返回默认值', () => {
    localStorage.setItem('vtable-summary-metrics', '"not-an-array"')
    expect(loadVisibleMetrics()).toEqual(DEFAULT_METRICS)
  })

  it('过滤非法指标值', () => {
    localStorage.setItem('vtable-summary-metrics', JSON.stringify(['sum', 'invalid', 'count']))
    const result = loadVisibleMetrics()
    expect(result).toEqual(['sum', 'count'])
  })

  it('全部非法时返回默认值', () => {
    localStorage.setItem('vtable-summary-metrics', JSON.stringify(['foo', 'bar']))
    expect(loadVisibleMetrics()).toEqual(DEFAULT_METRICS)
  })

  it('去重', () => {
    localStorage.setItem('vtable-summary-metrics', JSON.stringify(['sum', 'sum', 'count', 'count']))
    expect(loadVisibleMetrics()).toEqual(['sum', 'count'])
  })

  it('空数组返回默认值', () => {
    localStorage.setItem('vtable-summary-metrics', '[]')
    expect(loadVisibleMetrics()).toEqual(DEFAULT_METRICS)
  })

  it('saveVisibleMetrics 在 localStorage 不可用时静默失败', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveVisibleMetrics(['sum'])).not.toThrow()
    spy.mockRestore()
  })

  it('loadVisibleMetrics 在 localStorage 不可用时返回默认值', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(loadVisibleMetrics()).toEqual(DEFAULT_METRICS)
    spy.mockRestore()
  })
})
