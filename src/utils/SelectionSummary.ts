/**
 * 在线表格多选单元格汇总计算工具
 *
 * 纯函数实现，不依赖 VTable 实例，便于测试与复用。
 * 支持：
 *   - 连续与非连续选区（多 Range）
 *   - 自动计算 求和 / 平均值 / 计数 / 数值计数 / 最小值 / 最大值
 *   - 边界情况：空单元格、非数值、百分比/货币字符串解析、重叠区域去重
 *   - 大数据量高效遍历（Set 去重，单次扫描）
 */

/** 单个选区范围（与 VTable CellRange 结构兼容） */
export interface CellRangeLike {
  start: { col: number; row: number }
  end: { col: number; row: number }
}

/** 汇总指标类型 */
export type MetricKey = 'sum' | 'average' | 'count' | 'numericCount' | 'min' | 'max'

/** 汇总结果 */
export interface SelectionSummary {
  /** 数值求和 */
  sum: number
  /** 数值平均值（数值计数为 0 时为 0） */
  average: number
  /** 选中单元格总数（含空值与非数值） */
  count: number
  /** 数值单元格数 */
  numericCount: number
  /** 最小值（无数值时为 0） */
  min: number
  /** 最大值（无数值时为 0） */
  max: number
  /** 是否存在至少一个数值 */
  hasValues: boolean
}

/** 指标配置：标签 + 格式化函数 */
export interface MetricConfig {
  key: MetricKey
  label: string
  /** 根据汇总结果返回展示文本 */
  format: (summary: SelectionSummary) => string
}

/** 默认启用的指标顺序（与 Excel 状态栏一致） */
export const DEFAULT_METRICS: MetricKey[] = ['average', 'count', 'numericCount', 'min', 'max', 'sum']

/** 全部可用指标（用于设置面板） */
export const ALL_METRICS: MetricKey[] = ['sum', 'average', 'count', 'numericCount', 'min', 'max']

/** 数字格式化：千分位 + 保留 2 位小数（与项目金额格式约定一致） */
const formatNumber = (value: number): string => {
  if (!isFinite(value)) return '-'
  // 整数直接显示，避免 100.00 这种冗余
  if (Number.isInteger(value)) return value.toLocaleString('zh-CN')
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 指标配置表 */
export const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  sum: {
    key: 'sum',
    label: '求和',
    format: (s) => (s.hasValues ? formatNumber(s.sum) : '-'),
  },
  average: {
    key: 'average',
    label: '平均值',
    format: (s) => (s.hasValues ? formatNumber(s.average) : '-'),
  },
  count: {
    key: 'count',
    label: '计数',
    format: (s) => s.count.toString(),
  },
  numericCount: {
    key: 'numericCount',
    label: '数值计数',
    format: (s) => s.numericCount.toString(),
  },
  min: {
    key: 'min',
    label: '最小值',
    format: (s) => (s.hasValues ? formatNumber(s.min) : '-'),
  },
  max: {
    key: 'max',
    label: '最大值',
    format: (s) => (s.hasValues ? formatNumber(s.max) : '-'),
  },
}

/**
 * 将原始单元格值转换为数字。
 * 支持：number、纯数字字符串、百分比（"12.5%" → 0.125）、
 * 带货币符号/千分位的字符串（"¥1,234.50" → 1234.5）。
 * 空值、空字符串、非数值字符串返回 null。
 */
export function toNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') return isNaN(value) ? null : value
  if (typeof value === 'boolean') return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    // 百分比：先解析数值再除以 100
    if (trimmed.endsWith('%')) {
      const num = parseFloat(trimmed.slice(0, -1).replace(/[,]/g, ''))
      return isNaN(num) ? null : num / 100
    }
    // 移除货币符号（¥ $ € £）与千分位逗号
    const cleaned = trimmed.replace(/[¥$€£,\s]/g, '')
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
    const num = parseFloat(cleaned)
    return isNaN(num) ? null : num
  }
  return null
}

/**
 * 根据选区范围与取值函数计算汇总指标。
 *
 * 使用 Set 按 "col,row" 去重，确保非连续选区或重叠区域不会重复计数。
 * 大数据量场景下为 O(n) 单次扫描，n 为单元格数。
 *
 * @param ranges 选区范围数组（支持多个非连续区域）
 * @param getValue 取值函数：(col, row) => 单元格原始值
 */
export function computeSelectionSummary(
  ranges: CellRangeLike[],
  getValue: (col: number, row: number) => unknown,
): SelectionSummary {
  const visited = new Set<string>()
  let sum = 0
  let numericCount = 0
  let count = 0
  let min = Infinity
  let max = -Infinity

  for (const range of ranges) {
    if (!range || !range.start || !range.end) continue
    const colStart = Math.min(range.start.col, range.end.col)
    const colEnd = Math.max(range.start.col, range.end.col)
    const rowStart = Math.min(range.start.row, range.end.row)
    const rowEnd = Math.max(range.start.row, range.end.row)

    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        const key = `${c},${r}`
        if (visited.has(key)) continue
        visited.add(key)
        count++
        const raw = getValue(c, r)
        const num = toNumber(raw)
        if (num !== null) {
          numericCount++
          sum += num
          if (num < min) min = num
          if (num > max) max = num
        }
      }
    }
  }

  const hasValues = numericCount > 0
  return {
    sum,
    average: hasValues ? sum / numericCount : 0,
    count,
    numericCount,
    min: hasValues ? min : 0,
    max: hasValues ? max : 0,
    hasValues,
  }
}

/** localStorage 键名：用户自定义显示的指标 */
const SETTINGS_STORAGE_KEY = 'vtable-summary-metrics'

/** 读取用户自定义指标，失败或未设置时返回默认值 */
export function loadVisibleMetrics(): MetricKey[] {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return [...DEFAULT_METRICS]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_METRICS]
    // 过滤合法值并去重，保持默认顺序
    const valid = parsed.filter((k): k is MetricKey =>
      ALL_METRICS.includes(k as MetricKey),
    )
    if (valid.length === 0) return [...DEFAULT_METRICS]
    // 去重
    return [...new Set(valid)] as MetricKey[]
  } catch {
    return [...DEFAULT_METRICS]
  }
}

/** 持久化用户自定义指标 */
export function saveVisibleMetrics(metrics: MetricKey[]): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(metrics))
  } catch {
    // localStorage 不可用时静默失败
  }
}
