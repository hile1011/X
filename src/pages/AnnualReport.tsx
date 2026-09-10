import { Fragment, useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select as AntSelect } from 'antd'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as ChartTooltip, Legend, ReferenceArea,
} from 'recharts'
import { api, downloadBlob } from '../api'
import {
  TrendingUp, ChevronLeft, ChevronRight, Calendar, Building, Layers,
  RefreshCw, Download, Users, ListOrdered, ArrowUpDown, ArrowUp, ArrowDown,
  Loader2, ChevronDown as ChevronDownIcon, FileSpreadsheet, FileText, X,
  LineChart as LineChartIcon, UserPlus, Table as TableIcon,
} from 'lucide-react'
import StatTooltip from '../components/StatTooltip'
import { parseLocalDate } from '../utils/dates'
import { getStyleLabelFromProducts, fetchStyleOptions, type StyleOption } from '../services/productStyles'
import { usePermission } from '../hooks/usePermission'
import type { Product } from '../types'

// 销售额/利润统计的订单状态范围：做货中(3)、已发货未收款(4)、已发货已收款(5)、已对账(8)
// 时间匹配统一用「做货开始时间」归属到对应时段/年份（与原仪表盘口径一致）
// v28：已对账订单仍计入业绩（对账是收款后的成本核对，不改变业绩归属）
const STATS_STATUSES = [3, 4, 5, 8]
// localStorage 键沿用仪表盘原键，用户已有的利润模式偏好无缝延续
const PROFIT_MODE_STORAGE_KEY = 'dashboard_profit_mode'
// 日期范围偏好持久化键
const RANGE_STORAGE_KEY = 'annual_report_range'
// 客户情况分析展现形态（折线图/表格）与折线图指标选择持久化键
const ANALYSIS_FORM_STORAGE_KEY = 'annual_report_analysis_form'
const CHART_METRICS_STORAGE_KEY = 'annual_report_chart_metrics'

// 订单明细表每页条数（与客户表保持一致，保证左右两栏高度对齐）
const DETAIL_PAGE_SIZE = 8
const CUSTOMER_PAGE_SIZE = 8
// 客户指标折线图最多展示的客户数（按当前排序取前N，避免横轴过密）
const CUST_CHART_TOP_N = 10

type ProfitMode = 'noTax' | 'withTax'
type CustomerViewMode = 'period' | 'year' | 'all'
/** 客户情况分析展现形态：折线图 / 明细表格 */
type AnalysisForm = 'chart' | 'table'
/** 折线图可选指标（下单数为"笔"与金额"元"/比率"%"单位互斥，仅在表格中展示） */
type ChartMetricKey = 'amount' | 'profit' | 'rate' | 'conv'
/** 日期范围快捷选项：近30天 / 本月 / 上个月 / 自定义 */
type DateRangePreset = 'last30' | 'thisMonth' | 'lastMonth' | 'custom'

interface Quote {
  id: string
  quote_number: string
  customerName: string
  customer_id: string
  productStyle: string
  productSpec: string
  quantity: string
  productionTimeStart: string
  productionTimeEnd: string
  status: number
  costPrice: number
  priceWithTax: number
  sellPriceNoTax: number
  sellPriceWithTax: number
  quoteTime: string
  sampleTime: string
  sampleCompletedTime: string
  productionStartTime: string
  shippingTime: string
  images?: string[]
  created_at: string
  updated_at: string
}

/** 订单明细行（金额计算口径与订单编辑页 BagQuote / 订单列表一致，逐单 round2） */
interface OrderRow {
  id: string
  quoteNumber: string
  customerName: string
  /** 业绩归属日期（做货开始时间）的显示串 YYYY-MM-DD */
  dateStr: string
  /** 业绩归属日期时间戳（排序用） */
  dateTs: number
  styleLabel: string
  productSpec: string
  quantity: number
  unitNoTax: number
  unitWithTax: number
  /** 金额(含税) = round2(含税卖价 × 数量) */
  amount: number
  /** 金额(不含税) = round2(不含税卖价 × 数量) */
  amountNoTax: number
  profitNoTax: number
  profitWithTax: number
  status: number
}

/** 一段时间（月度/年度）的汇总指标 */
interface PeriodStats {
  count: number
  /** 销售额(含税) */
  amount: number
  /** 销售额(不含税) */
  amountNoTax: number
  profitNoTax: number
  profitWithTax: number
}

/** 客户情况分析行 */
interface CustomerRow {
  name: string
  /** 所选时段指标 */
  period: PeriodStats
  year: PeriodStats
  /** 时段报价数（按报价时间归属，全部状态） */
  periodQuotes: number
  /** 时段已下单数（报价时间在时段内且已进入做货及以后阶段） */
  periodConverted: number
  yearQuotes: number
  yearConverted: number
  /** 年度订单明细（按做货开始时间升序，供行展开查看） */
  yearOrders: OrderRow[]
}

type DetailSortKey = 'quoteNumber' | 'customerName' | 'date' | 'quantity' | 'unitWithTax' | 'amount' | 'profit'
type CustSortKey = 'name' | 'pCount' | 'pAmount' | 'pProfit' | 'pRate' | 'pConv' | 'yCount' | 'yAmount' | 'yProfit' | 'yRate' | 'yConv'
type SortDir = 'asc' | 'desc'
interface SortState<K extends string> {
  key: K
  dir: SortDir
}

// 保留2位小数辅助函数：金额计算以保留2位小数的价格为基础（与订单编辑页 BagQuote 口径一致）
const round2 = (n: number) => Math.round(n * 100) / 100

/** 解析 "YYYY-MM-DD" / ISO 时间串为本地时区 0 点；非法返回 null */
const parseDateOrNull = (str?: string | null): Date | null => {
  if (!str) return null
  const d = parseLocalDate(str)
  return isNaN(d.getTime()) ? null : d
}

/** 订单的做货开始时间（业绩归属时间） */
const getProdStart = (q: Quote): Date | null => parseDateOrNull(q.productionStartTime || q.productionTimeStart)

/** 订单的报价时间（转化率口径的归属时间；缺失时回退记录创建时间） */
const getQuoteDate = (q: Quote): Date | null => parseDateOrNull(q.quoteTime || q.created_at)

/**
 * 判断报价是否已转化为实际订单：
 * - 状态为做货中(3)/已发货未收款(4)/已发货已收款(5)/已对账(8)，或
 * - 状态为结束(6)但经历过做货（完整走完流程的历史订单）
 */
const isConvertedOrder = (q: Quote): boolean =>
  STATS_STATUSES.includes(q.status) || (q.status === 6 && !!(q.productionStartTime || q.productionTimeStart))

/** 获取初始利润模式（默认不含税，可从 localStorage 恢复） */
const getInitialProfitMode = (): ProfitMode => {
  try {
    const saved = localStorage.getItem(PROFIT_MODE_STORAGE_KEY)
    if (saved === 'noTax' || saved === 'withTax') return saved
  } catch {
    // ignore
  }
  return 'noTax'
}

/** 日期格式化为 YYYY-MM-DD */
const formatYmd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 日期格式化为短显示（2026/9/1） */
const formatShortDate = (d: Date): string => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`

/** 日期格式化为文件名安全串（20260901） */
const formatFileStamp = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

/** 获取初始日期范围偏好（默认本月，可从 localStorage 恢复） */
const getInitialRange = (): { preset: DateRangePreset; customStart: string; customEnd: string } => {
  try {
    const saved = localStorage.getItem(RANGE_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      const presets: DateRangePreset[] = ['last30', 'thisMonth', 'lastMonth', 'custom']
      if (parsed && presets.includes(parsed.preset)) {
        const cs = typeof parsed.customStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.customStart) ? parsed.customStart : ''
        const ce = typeof parsed.customEnd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.customEnd) ? parsed.customEnd : ''
        return { preset: parsed.preset, customStart: cs, customEnd: ce }
      }
    }
  } catch {
    // ignore
  }
  return { preset: 'thisMonth', customStart: '', customEnd: '' }
}

/**
 * 根据预设与自定义日期计算实际范围 [start, end]（start 为当日 0 点，end 为当日最后一毫秒）：
 * - 近30天：从当前日期向前推30天至今天
 * - 本月：当月1日至今天
 * - 上个月：完整的上一个自然月
 * - 自定义：起止日期（起止倒置时自动交换；未填写完整时回退为近30天）
 */
const resolveRange = (
  preset: DateRangePreset,
  customStart: string,
  customEnd: string
): { start: Date; end: Date } => {
  const today = new Date()
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  if (preset === 'last30') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)
    return { start, end: dayEnd(today) }
  }
  if (preset === 'thisMonth') {
    return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: dayEnd(today) }
  }
  if (preset === 'lastMonth') {
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
    const start = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() - 1, 1)
    const end = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth(), 0)
    return { start, end: dayEnd(end) }
  }
  // 自定义范围
  const s = customStart ? parseLocalDate(customStart) : null
  const e = customEnd ? parseLocalDate(customEnd) : null
  if (s && e && !isNaN(s.getTime()) && !isNaN(e.getTime())) {
    return s.getTime() <= e.getTime() ? { start: dayStart(s), end: dayEnd(e) } : { start: dayStart(e), end: dayEnd(s) }
  }
  // 未填写完整时回退为近30天，保证页面始终有有效范围
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)
  return { start, end: dayEnd(today) }
}

/** 获取初始客户分析展现形态（默认表格，可从 localStorage 恢复） */
const getInitialAnalysisForm = (): AnalysisForm => {
  try {
    const saved = localStorage.getItem(ANALYSIS_FORM_STORAGE_KEY)
    if (saved === 'chart' || saved === 'table') return saved
  } catch {
    // ignore
  }
  return 'table'
}

/** 获取初始折线图指标选择（默认金额+利润；至少保留一个有效指标） */
const getInitialChartMetrics = (): ChartMetricKey[] => {
  const valid: ChartMetricKey[] = ['amount', 'profit', 'rate', 'conv']
  try {
    const saved = localStorage.getItem(CHART_METRICS_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        const metrics = parsed.filter((m): m is ChartMetricKey => valid.includes(m))
        if (metrics.length > 0) return metrics
      }
    }
  } catch {
    // ignore
  }
  return ['amount', 'profit']
}

/** 折线图指标元信息（标签随利润模式动态生成的除外；tip 为指标chip悬停说明） */
const CHART_METRICS: { key: ChartMetricKey; label: string; unit: 'amount' | 'rate'; colors: { period: string; year: string }; tip?: string }[] = [
  { key: 'amount', label: '金额(不含税)', unit: 'amount', colors: { period: '#3b82f6', year: '#93c5fd' } },
  { key: 'profit', label: '利润', unit: 'amount', colors: { period: '#f59e0b', year: '#fcd34d' } },
  { key: 'rate', label: '利润率', unit: 'rate', colors: { period: '#8b5cf6', year: '#c4b5fd' } },
  {
    key: 'conv',
    label: '下单转化率',
    unit: 'rate',
    colors: { period: '#10b981', year: '#6ee7b7' },
    tip: '下单转化率 = 下单数 ÷ 报价数 × 100%（按报价时间归属；下单指已进入做货及以后阶段）。折线按当前排序展示前10客户的时段/年度对比。',
  },
]

/** 单条订单 → 明细行（金额逐单 round2，与订单列表底部汇总口径一致） */
const buildOrderRow = (q: Quote, products: Product[]): OrderRow => {
  const qty = parseFloat(q.quantity) || 0
  const sellNoTax = round2(q.sellPriceNoTax || 0)
  const sellWithTax = round2(q.sellPriceWithTax || 0)
  const cost = round2(q.costPrice || 0)
  const priceWithTax = round2(q.priceWithTax || 0)
  const dateStr = (q.productionStartTime || q.productionTimeStart || '').split('T')[0]
  return {
    id: q.id,
    quoteNumber: q.quote_number,
    customerName: q.customerName,
    dateStr,
    dateTs: getProdStart(q)?.getTime() ?? 0,
    styleLabel: getStyleLabelFromProducts(products, q.productStyle),
    productSpec: q.productSpec || '',
    quantity: qty,
    unitNoTax: sellNoTax,
    unitWithTax: sellWithTax,
    amount: round2(sellWithTax * qty),
    amountNoTax: round2(sellNoTax * qty),
    profitNoTax: round2(round2(sellNoTax - cost) * qty),
    profitWithTax: round2(round2(sellWithTax - priceWithTax) * qty),
    status: q.status,
  }
}

/** 汇总一组订单行 */
const sumStats = (rows: OrderRow[]): PeriodStats => {
  let amount = 0
  let amountNoTax = 0
  let profitNoTax = 0
  let profitWithTax = 0
  rows.forEach((r) => {
    amount += r.amount
    amountNoTax += r.amountNoTax
    profitNoTax += r.profitNoTax
    profitWithTax += r.profitWithTax
  })
  return {
    count: rows.length,
    amount: round2(amount),
    amountNoTax: round2(amountNoTax),
    profitNoTax: round2(profitNoTax),
    profitWithTax: round2(profitWithTax),
  }
}

/** 通用排序比较器（字符串按中文排序，数值 NaN 视为最小） */
const compareValues = (a: string | number, b: string | number, dir: SortDir): number => {
  if (typeof a === 'string' || typeof b === 'string') {
    const cmp = String(a).localeCompare(String(b), 'zh-Hans-CN')
    return dir === 'asc' ? cmp : -cmp
  }
  const av = isNaN(a as number) ? -Infinity : (a as number)
  const bv = isNaN(b as number) ? -Infinity : (b as number)
  return dir === 'asc' ? av - bv : bv - av
}

/** 金额格式化（千分位） */
const fmtAmount = (n: number): string => n.toLocaleString()
/** 比率格式化（0.123 → 12.3%；无效值显示 -） */
const fmtRate = (rate: number): string => (isNaN(rate) ? '-' : `${(rate * 100).toFixed(1)}%`)

/** CSV 单元格转义（含逗号/引号/换行时加引号包裹） */
const csvEscape = (v: string | number): string => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 构建 UTF-8 BOM CSV 字符串（保证 Excel 打开中文不乱码） */
const buildCsv = (headers: string[], rows: (string | number)[][]): string =>
  '\uFEFF' + [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n')

/** 表头排序指示图标 */
function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ArrowUpDown size={11} className="text-gray-300" />
  return dir === 'asc' ? <ArrowUp size={11} className="text-primary-500" /> : <ArrowDown size={11} className="text-primary-500" />
}

/** 客户情况表列头标签（金额为不含税口径；下单转化率按时段/年度区分命名） */
const custColumnLabel = (key: CustSortKey, profitMode: ProfitMode): string => {
  const profitLabel = `利润${profitMode === 'noTax' ? '(不含税)' : '(含税)'}`
  switch (key) {
    case 'name':
      return '客户名称'
    case 'pCount':
    case 'yCount':
      return '下单数'
    case 'pAmount':
    case 'yAmount':
      return '金额(不含税)'
    case 'pProfit':
    case 'yProfit':
      return profitLabel
    case 'pRate':
    case 'yRate':
      return '利润率'
    case 'pConv':
      return '时段下单转化率'
    case 'yConv':
      return '年度下单转化率'
  }
}

/**
 * 客户情况表转化率列头悬停说明（定义 / 计算方式 / 业务意义）
 * 两个转化率指标计算口径相同（已下单报价 ÷ 全部报价，按报价时间归属），
 * 差异在于统计范围：时段 = 顶部所选日期范围，年度 = 范围结束日期所在年份。
 */
const custColumnTitle = (key: CustSortKey): string | undefined => {
  switch (key) {
    case 'pConv':
      return [
        '时段下单转化率',
        '定义：所选时段内（按报价时间归属，无报价时间回退记录创建时间）该客户的报价中，已转化为实际订单的占比。',
        '计算：时段下单数 ÷ 时段报价数 × 100%；"已下单"指状态进入做货中/已发货未收款/已发货已收款，或已结束但经历过做货的订单。',
        '业务意义：衡量该时段报价的成交效率，数值越低说明报价多但成交少，需跟进促单。',
      ].join('\n')
    case 'yConv':
      return [
        '年度下单转化率',
        '定义：所选年份内（按报价时间归属，无报价时间回退记录创建时间；年份取范围结束日期所在年）该客户的报价中，已转化为实际订单的占比。',
        '计算：年度下单数 ÷ 年度报价数 × 100%；"已下单"指状态进入做货中/已发货未收款/已发货已收款，或已结束但经历过做货的订单。',
        '业务意义：衡量全年报价的成交效率与客户合作深度，用于客户分级和跟进优先级判断。',
      ].join('\n')
    default:
      return undefined
  }
}

/**
 * 年度业务报表
 *
 * 结构：顶部筛选栏（日期范围/客户/款式，全局联动）→ 业绩卡片 → 月度趋势图（业绩 + 客户）→ 时段订单明细 + 客户情况分析
 * - 统计口径与原仪表盘一致：状态为做货中/已发货未收款/已发货已收款，按做货开始时间归属
 * - 金额逐单 round2 汇总，与订单编辑页/订单列表口径一致，明细合计 = 卡片业绩值
 * - 下单转化率：期内（按报价时间归属）报价的订单中已进入做货及以后阶段的占比
 */
export default function AnnualReport() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  const [loading, setLoading] = useState(true)
  // 日期范围：快捷预设 + 自定义起止日期（控制本页全部数据）
  const [rangePreset, setRangePreset] = useState<DateRangePreset>(getInitialRange().preset)
  const [customStart, setCustomStart] = useState<string>(getInitialRange().customStart)
  const [customEnd, setCustomEnd] = useState<string>(getInitialRange().customEnd)
  const [profitMode, setProfitMode] = useState<ProfitMode>(getInitialProfitMode)
  // 全局筛选条件：客户名称（多选）与款式（多选），控制本页全部表格
  const [customerFilters, setCustomerFilters] = useState<string[]>([])
  const [styleFilters, setStyleFilters] = useState<string[]>([])
  // 订单明细表：排序 + 分页
  const [detailSort, setDetailSort] = useState<SortState<DetailSortKey>>({ key: 'date', dir: 'desc' })
  const [detailPage, setDetailPage] = useState(1)
  // 客户情况表：视图模式（时段/年度/全部）+ 排序 + 分页 + 行展开明细
  const [viewMode, setViewMode] = useState<CustomerViewMode>('all')
  const [custSort, setCustSort] = useState<SortState<CustSortKey>>({ key: 'yAmount', dir: 'desc' })
  const [custPage, setCustPage] = useState(1)
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)
  // 客户情况分析展现形态（折线图/表格）+ 折线图指标多选；与表格共享同一数据源和筛选范围
  const [analysisForm, setAnalysisForm] = useState<AnalysisForm>(getInitialAnalysisForm)
  const [chartMetrics, setChartMetrics] = useState<ChartMetricKey[]>(getInitialChartMetrics)
  // 导出
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  const navigate = useNavigate()
  const { hasPermission } = usePermission()

  const loadData = async () => {
    setLoading(true)
    try {
      const [data, prods, styles] = await Promise.all([
        api.quotes.getAll(),
        api.products.getAll(),
        fetchStyleOptions(),
      ])
      setQuotes(data)
      setProducts(prods)
      setStyleOptions(styles)
    } catch (error) {
      console.error('获取报表数据失败:', error)
      setQuotes([])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  // 日期范围偏好持久化
  useEffect(() => {
    try {
      localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify({ preset: rangePreset, customStart, customEnd }))
    } catch {
      // ignore
    }
  }, [rangePreset, customStart, customEnd])

  // 客户分析展现形态与折线图指标选择持久化
  useEffect(() => {
    try {
      localStorage.setItem(ANALYSIS_FORM_STORAGE_KEY, analysisForm)
    } catch {
      // ignore
    }
  }, [analysisForm])

  useEffect(() => {
    try {
      localStorage.setItem(CHART_METRICS_STORAGE_KEY, JSON.stringify(chartMetrics))
    } catch {
      // ignore
    }
  }, [chartMetrics])

  // 筛选条件变化时重置分页与展开状态
  useEffect(() => {
    setDetailPage(1)
    setCustPage(1)
    setExpandedCustomer(null)
  }, [rangePreset, customStart, customEnd, customerFilters, styleFilters])

  useEffect(() => {
    setCustPage(1)
  }, [viewMode])

  const handleProfitModeToggle = () => {
    setProfitMode((prev) => {
      const next = prev === 'noTax' ? 'withTax' : 'noTax'
      try {
        localStorage.setItem(PROFIT_MODE_STORAGE_KEY, next)
      } catch {
        // ignore
      }
      return next
    })
  }

  // 切换快捷预设；选"自定义"时若未填日期，默认填入近30天供用户调整
  const handlePresetChange = (preset: DateRangePreset) => {
    setRangePreset(preset)
    if (preset === 'custom' && !customStart && !customEnd) {
      const { start, end } = resolveRange('last30', '', '')
      setCustomStart(formatYmd(start))
      setCustomEnd(formatYmd(end))
    }
  }

  // 实际生效的日期范围 [rangeStart, rangeEnd]（含起止当日）
  const { start: rangeStart, end: rangeEnd } = useMemo(
    () => resolveRange(rangePreset, customStart, customEnd),
    [rangePreset, customStart, customEnd]
  )

  // 趋势图与"年度指标"列展示的年份（取范围结束日期所在年）
  const chartYear = rangeEnd.getFullYear()
  const yearLabel = `${chartYear}年`
  const yearStart = useMemo(() => new Date(chartYear, 0, 1), [chartYear])
  const yearEnd = useMemo(() => new Date(chartYear, 11, 31, 23, 59, 59, 999), [chartYear])

  /** 所选时段标签（用于卡片标题/表头/文件名） */
  const rangeLabel = useMemo(() => {
    if (rangePreset === 'last30') return '近30天'
    if (rangePreset === 'thisMonth') return `${rangeStart.getFullYear()}年${rangeStart.getMonth() + 1}月`
    if (rangePreset === 'lastMonth') return `${rangeStart.getFullYear()}年${rangeStart.getMonth() + 1}月`
    return `${formatShortDate(rangeStart)}~${formatShortDate(rangeEnd)}`
  }, [rangePreset, rangeStart, rangeEnd])

  /** 导出文件名安全的时间段标签 */
  const rangeFileLabel = useMemo(() => {
    if (rangePreset === 'last30') return '近30天'
    if (rangePreset === 'thisMonth') return `${rangeStart.getFullYear()}年${rangeStart.getMonth() + 1}月`
    if (rangePreset === 'lastMonth') return `${rangeStart.getFullYear()}年${rangeStart.getMonth() + 1}月`
    return `${formatFileStamp(rangeStart)}-${formatFileStamp(rangeEnd)}`
  }, [rangePreset, rangeStart, rangeEnd])

  /** 时段卡片双击跳转订单列表：范围内同月按月查，跨月按年查 */
  const quotesNavTarget = useMemo(() => {
    if (rangeStart.getFullYear() === rangeEnd.getFullYear() && rangeStart.getMonth() === rangeEnd.getMonth()) {
      return `/quotes?month=${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, '0')}`
    }
    return `/quotes?year=${chartYear}`
  }, [rangeStart, rangeEnd, chartYear])

  /** 客户名称筛选选项（来自订单数据，去重排序） */
  const customerNameOptions = useMemo(
    () => [...new Set(quotes.map((q) => q.customerName))].sort(),
    [quotes]
  )

  /** 全局筛选（客户 + 款式，均为多选）后的订单集合 */
  const baseQuotes = useMemo(
    () =>
      quotes.filter((q) => {
        if (customerFilters.length > 0) {
          const matches = customerFilters.some((name) => name.toLowerCase() === q.customerName.toLowerCase())
          if (!matches) return false
        }
        if (styleFilters.length > 0) {
          const sameStyle = styleFilters.some(
            (f) =>
              q.productStyle === f ||
              getStyleLabelFromProducts(products, q.productStyle) === getStyleLabelFromProducts(products, f),
          )
          if (!sameStyle) return false
        }
        return true
      }),
    [quotes, customerFilters, styleFilters, products]
  )

  /** 所选时段订单明细（状态 3/4/5，做货开始时间在所选日期范围内） */
  const periodRows = useMemo(
    () =>
      baseQuotes
        .filter((q) => {
          if (!STATS_STATUSES.includes(q.status)) return false
          const d = getProdStart(q)
          return !!d && d >= rangeStart && d <= rangeEnd
        })
        .map((q) => buildOrderRow(q, products)),
    [baseQuotes, rangeStart, rangeEnd, products]
  )

  /** 年度订单明细（状态 3/4/5，做货开始时间在范围结束日期所在年份） */
  const yearlyRows = useMemo(
    () =>
      baseQuotes
        .filter((q) => {
          if (!STATS_STATUSES.includes(q.status)) return false
          const d = getProdStart(q)
          return !!d && d >= yearStart && d <= yearEnd
        })
        .map((q) => buildOrderRow(q, products)),
    [baseQuotes, yearStart, yearEnd, products]
  )

  const periodStats = useMemo(() => sumStats(periodRows), [periodRows])
  const yearlyStats = useMemo(() => sumStats(yearlyRows), [yearlyRows])

  /** 按状态分组计数：做货中(3) / 已发货未收款(4) / 已发货已收款(5) / 已对账(8) */
  const statusCounts = useMemo(() => {
    const counts: Record<number, number> = { 3: 0, 4: 0, 5: 0, 8: 0 }
    periodRows.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status]++
    })
    return counts
  }, [periodRows])

  /** 打样中订单数：按 sampleTime 在所选日期范围内过滤（打样中订单无做货开始时间，单独口径统计） */
  const sampleCount = useMemo(
    () =>
      baseQuotes.filter((q) => {
        if (q.status !== 2) return false
        const d = parseDateOrNull(q.sampleTime)
        return !!d && d >= rangeStart && d <= rangeEnd
      }).length,
    [baseQuotes, rangeStart, rangeEnd]
  )

  /** 报价时间归属的转化率分母/分子（所选时段与年度两组） */
  const conversionCohorts = useMemo(() => {
    const build = (start: Date, end: Date) => {
      const map = new Map<string, { quotes: number; converted: number }>()
      baseQuotes.forEach((q) => {
        const d = getQuoteDate(q)
        if (!d || d < start || d > end) return
        const cur = map.get(q.customerName) || { quotes: 0, converted: 0 }
        cur.quotes++
        if (isConvertedOrder(q)) cur.converted++
        map.set(q.customerName, cur)
      })
      return map
    }
    return {
      period: build(rangeStart, rangeEnd),
      year: build(yearStart, yearEnd),
    }
  }, [baseQuotes, rangeStart, rangeEnd, yearStart, yearEnd])

  /** 客户情况分析行：年度订单客户 ∪ 年度报价客户（含仅有报价未成交的客户） */
  const customerRows = useMemo<CustomerRow[]>(() => {
    const periodByCust = new Map<string, OrderRow[]>()
    periodRows.forEach((r) => {
      const arr = periodByCust.get(r.customerName) || []
      arr.push(r)
      periodByCust.set(r.customerName, arr)
    })
    const yearByCust = new Map<string, OrderRow[]>()
    yearlyRows.forEach((r) => {
      const arr = yearByCust.get(r.customerName) || []
      arr.push(r)
      yearByCust.set(r.customerName, arr)
    })

    const names = new Set<string>([...yearByCust.keys(), ...conversionCohorts.year.keys()])
    const rows: CustomerRow[] = []
    names.forEach((name) => {
      rows.push({
        name,
        period: sumStats(periodByCust.get(name) || []),
        year: sumStats(yearByCust.get(name) || []),
        periodQuotes: conversionCohorts.period.get(name)?.quotes ?? 0,
        periodConverted: conversionCohorts.period.get(name)?.converted ?? 0,
        yearQuotes: conversionCohorts.year.get(name)?.quotes ?? 0,
        yearConverted: conversionCohorts.year.get(name)?.converted ?? 0,
        yearOrders: [...(yearByCust.get(name) || [])].sort((a, b) => a.dateTs - b.dateTs),
      })
    })
    return rows
  }, [periodRows, yearlyRows, conversionCohorts])

  /** 当前利润模式下的一段时间利润率（分母口径与利润模式匹配：不含税利润÷不含税销售额） */
  const rateOf = (s: PeriodStats): number =>
    profitMode === 'noTax'
      ? s.amountNoTax > 0
        ? s.profitNoTax / s.amountNoTax
        : NaN
      : s.amount > 0
        ? s.profitWithTax / s.amount
        : NaN

  /** 订单明细排序取值器 */
  const detailValue = (r: OrderRow, key: DetailSortKey): string | number => {
    switch (key) {
      case 'quoteNumber':
        return r.quoteNumber
      case 'customerName':
        return r.customerName
      case 'date':
        return r.dateTs
      case 'quantity':
        return r.quantity
      case 'unitWithTax':
        return r.unitWithTax
      case 'amount':
        return r.amountNoTax
      case 'profit':
        return profitMode === 'noTax' ? r.profitNoTax : r.profitWithTax
    }
  }

  /** 客户情况表排序取值器 */
  const custValue = (r: CustomerRow, key: CustSortKey): string | number => {
    switch (key) {
      case 'name':
        return r.name
      case 'pCount':
        return r.period.count
      case 'pAmount':
        return r.period.amountNoTax
      case 'pProfit':
        return profitMode === 'noTax' ? r.period.profitNoTax : r.period.profitWithTax
      case 'pRate':
        return rateOf(r.period)
      case 'pConv':
        return r.periodQuotes > 0 ? r.periodConverted / r.periodQuotes : NaN
      case 'yCount':
        return r.year.count
      case 'yAmount':
        return r.year.amountNoTax
      case 'yProfit':
        return profitMode === 'noTax' ? r.year.profitNoTax : r.year.profitWithTax
      case 'yRate':
        return rateOf(r.year)
      case 'yConv':
        return r.yearQuotes > 0 ? r.yearConverted / r.yearQuotes : NaN
    }
  }

  const toggleDetailSort = (key: DetailSortKey) => {
    setDetailSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'customerName' || key === 'quoteNumber' ? 'asc' : 'desc' }
    )
  }

  const toggleCustSort = (key: CustSortKey) => {
    setCustSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' }
    )
  }

  /** 折线图指标多选开关（至少保留一个指标，避免空图） */
  const toggleChartMetric = (key: ChartMetricKey) => {
    setChartMetrics((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev
      }
      return [...prev, key]
    })
  }

  /** 排序后的订单明细（导出与展示共用） */
  const sortedDetailRows = useMemo(() => {
    const arr = [...periodRows]
    arr.sort((a, b) => compareValues(detailValue(a, detailSort.key), detailValue(b, detailSort.key), detailSort.dir))
    return arr
  }, [periodRows, detailSort, profitMode])

  /** 排序后的客户行（导出与展示共用） */
  const sortedCustomerRows = useMemo(() => {
    const arr = [...customerRows]
    arr.sort((a, b) => compareValues(custValue(a, custSort.key), custValue(b, custSort.key), custSort.dir))
    return arr
  }, [customerRows, custSort, profitMode])

  /**
   * 月度趋势图数据（范围结束日期所在年的 1-12 月，受客户/款式筛选联动）：
   * - revenue/profit：该月订单（状态 3/4/5，做货开始时间归属）逐单 round2 汇总
   * - activeCustomers：该月有下单的不同客户数
   * - newCustomers：该月首次下单（做货开始）的客户数（在当前筛选范围内首次出现）
   */
  const chartData = useMemo(() => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      label: `${i + 1}月`,
      revenue: 0,
      profit: 0,
      activeCustomers: 0,
      newCustomers: 0,
    }))
    const activeByMonth = new Map<number, Set<string>>()
    const firstOrderByCustomer = new Map<string, Date>()
    baseQuotes.forEach((q) => {
      if (!STATS_STATUSES.includes(q.status)) return
      const d = getProdStart(q)
      if (!d || d.getFullYear() !== chartYear) return
      const m = d.getMonth()
      const row = buildOrderRow(q, products)
      points[m].revenue += row.amount
      points[m].profit += profitMode === 'noTax' ? row.profitNoTax : row.profitWithTax
      if (!activeByMonth.has(m)) activeByMonth.set(m, new Set())
      activeByMonth.get(m)!.add(q.customerName)
      const prev = firstOrderByCustomer.get(q.customerName)
      if (!prev || d < prev) firstOrderByCustomer.set(q.customerName, d)
    })
    points.forEach((p) => {
      p.revenue = round2(p.revenue)
      p.profit = round2(p.profit)
    })
    activeByMonth.forEach((set, m) => {
      points[m].activeCustomers = set.size
    })
    firstOrderByCustomer.forEach((d) => {
      if (d.getFullYear() === chartYear) points[d.getMonth()].newCustomers++
    })
    return points
  }, [baseQuotes, products, profitMode, chartYear])

  /** 趋势图中高亮所选时段覆盖的月份（起点早于该年则从1月起；终点即范围结束月） */
  const chartHighlight = useMemo(() => {
    const x1 = rangeStart.getFullYear() === chartYear ? `${rangeStart.getMonth() + 1}月` : '1月'
    const x2 = `${rangeEnd.getMonth() + 1}月`
    return { x1, x2 }
  }, [rangeStart, rangeEnd, chartYear])

  // 分页（页码越界时自动收敛到最后一页）
  const detailTotalPages = Math.max(1, Math.ceil(sortedDetailRows.length / DETAIL_PAGE_SIZE))
  const safeDetailPage = Math.min(detailPage, detailTotalPages)
  const pagedDetailRows = sortedDetailRows.slice(
    (safeDetailPage - 1) * DETAIL_PAGE_SIZE,
    safeDetailPage * DETAIL_PAGE_SIZE
  )

  const custTotalPages = Math.max(1, Math.ceil(sortedCustomerRows.length / CUSTOMER_PAGE_SIZE))
  const safeCustPage = Math.min(custPage, custTotalPages)
  const pagedCustomerRows = sortedCustomerRows.slice(
    (safeCustPage - 1) * CUSTOMER_PAGE_SIZE,
    safeCustPage * CUSTOMER_PAGE_SIZE
  )

  // 当前利润模式对应的时段/年度利润值
  const currentProfit = profitMode === 'noTax' ? periodStats.profitNoTax : periodStats.profitWithTax
  const currentYearProfit = profitMode === 'noTax' ? yearlyStats.profitNoTax : yearlyStats.profitWithTax

  /**
   * 客户指标折线图系列：按当前视图（时段/年度/全部）生成「指标 × 范围」折线
   * - 每条折线 = 指标(amount/profit/rate/conv) × 范围(period/year)，viewMode=all 时同指标双范围对比
   * - 金额/利润挂左轴（元），利润率/转化率挂右轴（%）；名称含范围前缀便于图例区分
   */
  const custChartSeries = useMemo(() => {
    const scopes: ('period' | 'year')[] =
      viewMode === 'period' ? ['period'] : viewMode === 'year' ? ['year'] : ['period', 'year']
    const series: {
      key: string
      dataKey: string
      name: string
      yAxisId: 'amount' | 'rate'
      color: string
      unit: 'amount' | 'rate'
    }[] = []
    chartMetrics.forEach((metric) => {
      const meta = CHART_METRICS.find((m) => m.key === metric)!
      scopes.forEach((scope) => {
        const scopeLabel = scope === 'period' ? '时段' : '年度'
        const metricLabel = metric === 'profit' ? `利润${profitMode === 'noTax' ? '(不含税)' : '(含税)'}` : meta.label
        series.push({
          key: `${scope}-${metric}`,
          dataKey: `${scope}-${metric}`,
          name: `${scopeLabel}${metricLabel}`,
          yAxisId: meta.unit,
          color: meta.colors[scope],
          unit: meta.unit,
        })
      })
    })
    return series
  }, [viewMode, chartMetrics, profitMode])

  /** 客户指标折线图数据：按当前排序取前 N 客户，每个指标折线取对应范围的值（比率无值时置 null 断点） */
  const custChartData = useMemo(() => {
    return sortedCustomerRows.slice(0, CUST_CHART_TOP_N).map((r) => {
      const point: Record<string, string | number | null> = { name: r.name }
      custChartSeries.forEach((s) => {
        const [scope, metric] = s.key.split('-')
        const stats = scope === 'period' ? r.period : r.year
        if (metric === 'amount') {
          point[s.dataKey] = stats.amountNoTax
        } else if (metric === 'profit') {
          point[s.dataKey] = profitMode === 'noTax' ? stats.profitNoTax : stats.profitWithTax
        } else if (metric === 'rate') {
          const rate = rateOf(stats)
          point[s.dataKey] = isNaN(rate) ? null : Number((rate * 100).toFixed(1))
        } else {
          const quotes = scope === 'period' ? r.periodQuotes : r.yearQuotes
          const converted = scope === 'period' ? r.periodConverted : r.yearConverted
          point[s.dataKey] = quotes > 0 ? Number(((converted / quotes) * 100).toFixed(1)) : null
        }
      })
      return point
    })
  }, [sortedCustomerRows, custChartSeries, profitMode])

  /** 折线图左右轴是否需要渲染（无对应单位折线时隐藏轴） */
  const chartHasAmountAxis = custChartSeries.some((s) => s.unit === 'amount')
  const chartHasRateAxis = custChartSeries.some((s) => s.unit === 'rate')

  /** 简易分页器（上一页/页码/下一页） */
  const renderPager = (
    page: number,
    totalPages: number,
    onChange: (p: number) => void,
    total: number,
    unit: string
  ) => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">
        共 {total} {unit} · 第 {page}/{totalPages} 页
      </span>
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="p-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="上一页"
        aria-label="上一页"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="p-1 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="下一页"
        aria-label="下一页"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )

  // ============ 导出 ============

  /** 导出订单明细 Excel（复用订单导出接口，导出当前筛选+排序的全部明细订单） */
  const handleExportExcel = async () => {
    setExportOpen(false)
    if (sortedDetailRows.length === 0) {
      setExportError('所选日期范围内无订单明细可导出')
      return
    }
    setExporting(true)
    setExportError('')
    try {
      const blob = await api.export.orders(sortedDetailRows.map((r) => r.id))
      downloadBlob(blob, `年度报表_订单明细_${rangeFileLabel}.xlsx`)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败，请重试')
    }
    setExporting(false)
  }

  /** 导出订单明细 CSV（当前筛选+排序的全部明细订单，报表列） */
  const handleExportDetailsCsv = () => {
    setExportOpen(false)
    if (sortedDetailRows.length === 0) {
      setExportError('所选日期范围内无订单明细可导出')
      return
    }
    const headers = ['订单号', '客户名称', '下单日期', '产品信息', '数量', '单价(不含税)', '单价(含税)', '金额(不含税)', '利润(不含税)', '利润(含税)']
    const rows = sortedDetailRows.map((r) => [
      r.quoteNumber,
      r.customerName,
      r.dateStr,
      r.productSpec ? `${r.styleLabel} ${r.productSpec}` : r.styleLabel,
      r.quantity,
      r.unitNoTax,
      r.unitWithTax,
      r.amountNoTax,
      r.profitNoTax,
      r.profitWithTax,
    ])
    const csv = buildCsv(headers, rows)
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `年度报表_订单明细_${rangeFileLabel}.csv`)
  }

  /** 导出客户情况分析 CSV（全部客户，含时段/年度全指标） */
  const handleExportCustomersCsv = () => {
    setExportOpen(false)
    if (sortedCustomerRows.length === 0) {
      setExportError('暂无客户数据可导出')
      return
    }
    const rateStr = (s: PeriodStats, mode: ProfitMode) => {
      const rate = mode === 'noTax'
        ? s.amountNoTax > 0 ? s.profitNoTax / s.amountNoTax : NaN
        : s.amount > 0 ? s.profitWithTax / s.amount : NaN
      return isNaN(rate) ? '' : `${(rate * 100).toFixed(1)}%`
    }
    const convStr = (quotes: number, converted: number) =>
      quotes > 0 ? `${((converted / quotes) * 100).toFixed(1)}%` : ''
    const headers = [
      '客户名称',
      '时段下单数', '时段金额(不含税)', '时段利润(不含税)', '时段利润(含税)', '时段利润率(不含税)', '时段利润率(含税)', '时段下单转化率',
      '年度下单数', '年度金额(不含税)', '年度利润(不含税)', '年度利润(含税)', '年度利润率(不含税)', '年度利润率(含税)', '年度下单转化率',
    ]
    const rows = sortedCustomerRows.map((r) => [
      r.name,
      r.period.count, r.period.amountNoTax, r.period.profitNoTax, r.period.profitWithTax, rateStr(r.period, 'noTax'), rateStr(r.period, 'withTax'), convStr(r.periodQuotes, r.periodConverted),
      r.year.count, r.year.amountNoTax, r.year.profitNoTax, r.year.profitWithTax, rateStr(r.year, 'noTax'), rateStr(r.year, 'withTax'), convStr(r.yearQuotes, r.yearConverted),
    ])
    const csv = buildCsv(headers, rows)
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `年度报表_客户情况_${chartYear}.csv`)
  }

  const hasActiveFilters = customerFilters.length > 0 || styleFilters.length > 0

  // 客户情况表"时段"列是否展示（年度视图下隐藏）
  const showPeriodCols = viewMode !== 'year'

  const profitModeButton = (
    <button
      onClick={handleProfitModeToggle}
      className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors ${
        profitMode === 'noTax'
          ? 'bg-red-100 text-red-600 hover:bg-red-200'
          : 'bg-green-100 text-green-600 hover:bg-green-200'
      }`}
      title="点击切换不含税 / 含税"
    >
      {profitMode === 'noTax' ? '不含税' : '含税'}
    </button>
  )

  // ============ 渲染 ============

  return (
    <div className="p-4 sm:p-6 flex flex-col gap-4 min-h-[calc(100vh-3.5rem)]">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">年度业务报表</h1>
          <p className="text-gray-500 mt-1">时段与全年业绩、月度趋势及客户情况分析</p>
        </div>
        <div className="flex items-center gap-2">
          {exportError && <span className="text-xs text-red-500 max-w-[240px] truncate" title={exportError}>{exportError}</span>}
          <button
            onClick={loadData}
            disabled={loading || exporting}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            <span className="text-sm">刷新</span>
          </button>
          {hasPermission('quotes:export') && (
            <div className="relative">
              <button
                onClick={() => { setExportOpen((v) => !v); setExportError('') }}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                <span className="text-sm">导出</span>
                <ChevronDownIcon size={14} />
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-30 w-56 bg-white rounded-lg shadow-lg border border-gray-100 py-1">
                    <button onClick={handleExportExcel} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-primary-50 text-left">
                      <FileSpreadsheet size={15} className="text-green-600" />
                      订单明细 Excel（完整订单数据）
                    </button>
                    <button onClick={handleExportDetailsCsv} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-primary-50 text-left">
                      <FileText size={15} className="text-blue-600" />
                      订单明细 CSV（报表列）
                    </button>
                    <button onClick={handleExportCustomersCsv} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-primary-50 text-left">
                      <FileText size={15} className="text-purple-600" />
                      客户情况分析 CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 第一行：全局筛选条件（日期范围 / 客户名称 / 款式，控制本页全部数据） */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex-shrink-0">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* 日期条件：快捷范围（近30天/本月/上个月）+ 自定义起止日期，控制业绩/订单明细/客户情况的数据范围 */}
          <div className={`flex items-center gap-2 ${rangePreset === 'custom' ? 'md:col-span-2' : ''}`}>
            <Calendar className="text-gray-400 shrink-0" size={18} />
            <select
              value={rangePreset}
              onChange={(e) => handlePresetChange(e.target.value as DateRangePreset)}
              className="w-[104px] px-2 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none cursor-pointer bg-white shrink-0"
              title="日期范围"
            >
              <option value="last30">近30天</option>
              <option value="thisMonth">本月</option>
              <option value="lastMonth">上个月</option>
              <option value="custom">自定义</option>
            </select>
            {rangePreset === 'custom' ? (
              <>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
                  title="开始日期（含当日）"
                />
                <span className="text-gray-400 shrink-0 text-sm">~</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
                  title="结束日期（含当日；未填写完整时按近30天回退）"
                />
              </>
            ) : (
              <span className="text-xs text-gray-400 truncate" title="当前日期范围（含起止当日）">
                {formatShortDate(rangeStart)} ~ {formatShortDate(rangeEnd)}
              </span>
            )}
          </div>
          {/* 客户名称多选筛选（全局控制） */}
          <div className="relative quotes-filter-wrap">
            <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
            <AntSelect
              mode="multiple"
              showSearch
              allowClear
              value={customerFilters}
              onChange={(values: string[]) => setCustomerFilters(values)}
              placeholder="客户名称（输入检索，可多选）"
              optionFilterProp="label"
              filterSort={(a, b) => String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'zh-Hans-CN')}
              options={customerNameOptions.map((name) => ({ value: name, label: name }))}
              maxTagCount="responsive"
              popupClassName="quotes-multi-select-dropdown"
              className="quotes-multi-select"
              style={{ width: '100%' }}
            />
          </div>
          {/* 款式多选筛选（全局控制） */}
          <div className="relative quotes-filter-wrap">
            <Layers className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
            <AntSelect
              mode="multiple"
              showSearch
              allowClear
              value={styleFilters}
              onChange={(values: string[]) => setStyleFilters(values)}
              placeholder="款式（输入检索，可多选）"
              optionFilterProp="label"
              filterSort={(a, b) => String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'zh-Hans-CN')}
              options={styleOptions.map((s) => ({ value: s.value, label: s.label }))}
              maxTagCount="responsive"
              popupClassName="quotes-multi-select-dropdown"
              className="quotes-multi-select"
              style={{ width: '100%' }}
            />
          </div>
          {/* 筛选状态提示与一键清除 */}
          <div className="flex items-center justify-end gap-2">
            {hasActiveFilters ? (
              <button
                onClick={() => { setCustomerFilters([]); setStyleFilters([]) }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-full transition-colors"
              >
                <X size={13} />
                清除客户/款式筛选
              </button>
            ) : (
              <span className="text-xs text-gray-400">筛选条件变更后各表数据实时更新</span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6 sm:p-8 text-center flex-1">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      ) : (
        <>
          {/* 业绩卡片：所选时段 + 全年（始终双卡并排） */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-shrink-0">
            {/* 所选时段业绩（销售额 + 利润合并） */}
            <div
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onDoubleClick={() => navigate(quotesNavTarget)}
              title="双击查看该时段业绩明细"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center shrink-0">
                    <TrendingUp className="text-purple-600" size={16} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800 truncate">{rangeLabel}业绩</h3>
                </div>
                {profitModeButton}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 flex items-center">
                    销售额(含税)
                    <StatTooltip>
                      <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                      <p>• 时间范围：做货开始时间在所选时段（{formatShortDate(rangeStart)} ~ {formatShortDate(rangeEnd)}）</p>
                      <p>• 计算公式：Σ（含税卖价 × 数量），逐单四舍五入后汇总</p>
                      <p>• 受顶部客户/款式筛选联动控制</p>
                    </StatTooltip>
                  </p>
                  <p className="text-xl font-bold text-gray-800 mt-0.5">¥{fmtAmount(periodStats.amount)}</p>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                    <span className="text-xs text-blue-600">做货中 {statusCounts[3]}</span>
                    <span className="text-xs text-amber-600">未收款 {statusCounts[4]}</span>
                    <span className="text-xs text-green-600">已收款 {statusCounts[5]}</span>
                    <span className="text-xs text-teal-600">已对账 {statusCounts[8]}</span>
                    <span className="text-xs text-yellow-600">打样中 {sampleCount}</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 flex items-center">
                    利润
                    <StatTooltip>
                      <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                      <p>• 时间范围：做货开始时间在所选时段</p>
                      <p>• 不含税：Σ 数量 ×（卖价不含税 − 成本价）</p>
                      <p>• 含税：Σ 数量 ×（卖价含税 − 含税价）</p>
                    </StatTooltip>
                  </p>
                  <p className={`text-xl font-bold mt-0.5 ${profitMode === 'noTax' ? 'text-red-600' : 'text-green-600'}`}>
                    ¥{fmtAmount(currentProfit)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {profitMode === 'noTax' ? '卖价(不含税) - 成本价' : '卖价(含税) - 含税价'}
                  </p>
                </div>
              </div>
            </div>

            {/* 全年业绩（销售额 + 利润合并），年份取所选时段结束日期所在年 */}
            <div
              className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
              onDoubleClick={() => navigate(`/quotes?year=${chartYear}`)}
              title="双击查看全年业绩明细"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                    <TrendingUp className="text-blue-600" size={16} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">{yearLabel}业绩</h3>
                </div>
                {profitModeButton}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 flex items-center">
                    销售额(含税)
                    <StatTooltip>
                      <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                      <p>• 时间范围：做货开始时间在所选年份</p>
                      <p>• 计算公式：Σ（含税卖价 × 数量），逐单四舍五入后汇总</p>
                      <p>• 受顶部客户/款式筛选联动控制</p>
                    </StatTooltip>
                  </p>
                  <p className="text-xl font-bold text-gray-800 mt-0.5">¥{fmtAmount(yearlyStats.amount)}</p>
                  <p className="text-xs text-gray-400 mt-1">做货中/已发货订单 · {yearlyStats.count} 笔</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 flex items-center">
                    利润
                    <StatTooltip>
                      <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                      <p>• 时间范围：做货开始时间在所选年份</p>
                      <p>• 不含税：Σ 数量 ×（卖价不含税 − 成本价）</p>
                      <p>• 含税：Σ 数量 ×（卖价含税 − 含税价）</p>
                    </StatTooltip>
                  </p>
                  <p className={`text-xl font-bold mt-0.5 ${profitMode === 'noTax' ? 'text-red-600' : 'text-green-600'}`}>
                    ¥{fmtAmount(currentYearProfit)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {profitMode === 'noTax' ? '卖价(不含税) - 成本价' : '卖价(含税) - 含税价'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 月度趋势图：业绩指标 + 客户数据（范围结束日期所在年 1-12 月，受客户/款式筛选联动） */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 bg-cyan-50 rounded-lg flex items-center justify-center shrink-0">
                  <LineChartIcon className="text-cyan-600" size={15} />
                </div>
                <h3 className="text-sm font-semibold text-gray-800 truncate">{yearLabel}月度趋势</h3>
                <StatTooltip>
                  <p>• 销售额(含税)/利润：该月订单（状态为做货中/已发货未收款/已发货已收款）按做货开始时间归属，逐单 round2 汇总</p>
                  <p>• 活跃客户数：该月有下单的不同客户数</p>
                  <p>• 新增客户数：做货开始时间首次落在该月的客户数</p>
                  <p>• 利润随利润模式（不含税/含税）联动</p>
                  <p className="text-gray-300 pt-1 border-t border-gray-700 mt-1">浅蓝底色区域为当前所选日期范围覆盖的月份；悬停数据点可查看具体数值</p>
                </StatTooltip>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-400">
                  <span className="inline-block w-3 h-3 rounded-sm bg-blue-50 border border-blue-100"></span>
                  所选时段
                </span>
                {profitModeButton}
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 业绩指标趋势（销售额 / 利润） */}
              <div className="min-w-0">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <TrendingUp size={12} className="text-gray-400" />
                  业绩指标（元）
                </p>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} width={64} tickFormatter={(v: number) => v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString()} />
                      <ChartTooltip
                        formatter={(value, name) => [`¥${Number(value ?? 0).toLocaleString()}`, String(name)]}
                        labelStyle={{ color: '#374151', fontWeight: 600 }}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                      <ReferenceArea x1={chartHighlight.x1} x2={chartHighlight.x2} fill="#eff6ff" fillOpacity={0.6} stroke="#bfdbfe" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="revenue" name="销售额(含税)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3, fill: '#3b82f6' }} activeDot={{ r: 5 }} connectNulls />
                      <Line type="monotone" dataKey="profit" name="利润" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 5 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* 客户数据趋势（活跃客户数 / 新增客户数） */}
              <div className="min-w-0">
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <UserPlus size={12} className="text-gray-400" />
                  客户数据（家）
                </p>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} width={40} allowDecimals={false} />
                      <ChartTooltip
                        formatter={(value, name) => [Number(value ?? 0).toLocaleString(), String(name)]}
                        labelStyle={{ color: '#374151', fontWeight: 600 }}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
                      <ReferenceArea x1={chartHighlight.x1} x2={chartHighlight.x2} fill="#eff6ff" fillOpacity={0.6} stroke="#bfdbfe" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="activeCustomers" name="活跃客户数" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} activeDot={{ r: 5 }} connectNulls />
                      <Line type="monotone" dataKey="newCustomers" name="新增客户数" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>

          {/* 主体：所选时段订单明细 + 客户情况分析（xl 左右分栏，各自固定高度内滚，页面整体自然滚动） */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* ============ 所选时段订单明细 ============ */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-[420px] overflow-hidden">
              <header className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                    <ListOrdered className="text-indigo-600" size={15} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800 truncate">{rangeLabel}订单明细</h3>
                  <span className="text-xs text-gray-400 shrink-0">共 {periodRows.length} 笔</span>
                  <StatTooltip>
                    <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」</p>
                    <p>• 时间范围：做货开始时间在 {formatShortDate(rangeStart)} ~ {formatShortDate(rangeEnd)}</p>
                    <p>• 金额(不含税) = round2(不含税卖价 × 数量)</p>
                    <p>• 业绩卡片销售额为含税口径，两者按适用税率对应</p>
                    <p className="text-gray-300 pt-1 border-t border-gray-700 mt-1">下单日期为做货开始时间（业绩归属时间）；点击表头可排序</p>
                  </StatTooltip>
                </div>
              </header>
              <div className="flex-1 overflow-auto">
                {pagedDetailRows.length === 0 ? (
                  <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-gray-400 gap-2 py-8">
                    <ListOrdered size={28} className="text-gray-200" />
                    <p className="text-sm">该时段暂无符合条件的订单</p>
                  </div>
                ) : (
                  <table className="w-full min-w-[640px]">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-50 text-gray-500 text-xs">
                        <th
                          onClick={() => toggleDetailSort('quoteNumber')}
                          className="px-3 py-2 text-left font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                        >
                          <span className="inline-flex items-center gap-0.5">订单号<SortIcon active={detailSort.key === 'quoteNumber'} dir={detailSort.dir} /></span>
                        </th>
                        <th
                          onClick={() => toggleDetailSort('customerName')}
                          className="px-3 py-2 text-left font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                        >
                          <span className="inline-flex items-center gap-0.5">客户名称<SortIcon active={detailSort.key === 'customerName'} dir={detailSort.dir} /></span>
                        </th>
                        <th
                          onClick={() => toggleDetailSort('date')}
                          className="px-3 py-2 text-left font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                          title="做货开始时间（业绩归属时间）"
                        >
                          <span className="inline-flex items-center gap-0.5">下单日期<SortIcon active={detailSort.key === 'date'} dir={detailSort.dir} /></span>
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap">产品信息</th>
                        <th
                          onClick={() => toggleDetailSort('quantity')}
                          className="px-3 py-2 text-right font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                        >
                          <span className="inline-flex items-center gap-0.5">数量<SortIcon active={detailSort.key === 'quantity'} dir={detailSort.dir} /></span>
                        </th>
                        <th className="px-3 py-2 text-right font-medium whitespace-nowrap" title="不含税卖价">单价(不含税)</th>
                        <th
                          onClick={() => toggleDetailSort('unitWithTax')}
                          className="px-3 py-2 text-right font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                          title="含税卖价"
                        >
                          <span className="inline-flex items-center gap-0.5">单价(含税)<SortIcon active={detailSort.key === 'unitWithTax'} dir={detailSort.dir} /></span>
                        </th>
                        <th
                          onClick={() => toggleDetailSort('amount')}
                          className="px-3 py-2 text-right font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                          title="round2(不含税卖价 × 数量)"
                        >
                          <span className="inline-flex items-center gap-0.5">金额(不含税)<SortIcon active={detailSort.key === 'amount'} dir={detailSort.dir} /></span>
                        </th>
                        <th
                          onClick={() => toggleDetailSort('profit')}
                          className="px-3 py-2 text-right font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                          title={`当前模式：${profitMode === 'noTax' ? '不含税（卖价-成本价）' : '含税（卖价-含税价）'}`}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            利润{profitMode === 'noTax' ? '(不含税)' : '(含税)'}
                            <SortIcon active={detailSort.key === 'profit'} dir={detailSort.dir} />
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pagedDetailRows.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50/70 text-xs">
                          <td className="px-3 py-2 whitespace-nowrap">
                            <button
                              onClick={() => navigate(`/quotes/${r.id}`)}
                              className="text-primary-600 hover:text-primary-700 hover:underline font-mono"
                              title="查看订单详情"
                            >
                              {r.quoteNumber}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-gray-700 max-w-[120px] truncate" title={r.customerName}>{r.customerName}</td>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.dateStr}</td>
                          <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={r.productSpec ? `${r.styleLabel} ${r.productSpec}` : r.styleLabel}>
                            {r.styleLabel}
                            {r.productSpec && <span className="text-gray-400"> · {r.productSpec}</span>}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{r.quantity.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{fmtAmount(r.unitNoTax)}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{fmtAmount(r.unitWithTax)}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-800">{fmtAmount(r.amountNoTax)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${(profitMode === 'noTax' ? r.profitNoTax : r.profitWithTax) >= 0 ? 'text-gray-800' : 'text-red-600'}`}>
                            {fmtAmount(profitMode === 'noTax' ? r.profitNoTax : r.profitWithTax)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {pagedDetailRows.length > 0 && (
                <footer className="px-4 py-2 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/50">
                  <div className="text-xs text-gray-500">
                    金额合计(不含税) <span className="font-semibold text-gray-700">¥{fmtAmount(periodStats.amountNoTax)}</span>
                    <span className="mx-1.5 text-gray-200">|</span>
                    利润合计 <span className="font-semibold text-gray-700">¥{fmtAmount(currentProfit)}</span>
                  </div>
                  {renderPager(safeDetailPage, detailTotalPages, setDetailPage, sortedDetailRows.length, '笔')}
                </footer>
              )}
            </section>

            {/* ============ 客户情况分析 ============ */}
            <section className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-[420px] overflow-hidden">
              <header className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 bg-amber-50 rounded-lg flex items-center justify-center shrink-0">
                    <Users className="text-amber-600" size={15} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800 truncate">客户情况分析</h3>
                  <span className="text-xs text-gray-400 shrink-0">共 {customerRows.length} 家</span>
                  <StatTooltip>
                    <p>• 下单数/金额(不含税)/利润：状态为「做货中/已发货未收款/已发货已收款」，按做货开始时间归属</p>
                    <p>• 利润率 = 利润 ÷ 对应口径销售额（不含税利润÷不含税销售额，含税同理）</p>
                    <p>• 下单转化率 = 下单数 ÷ 报价数 × 100%（按报价时间归属；下单指已进入做货及以后阶段）</p>
                    <p>• 含仅有报价未成交的客户；金额为不含税口径（= 不含税卖价 × 数量）</p>
                    <p className="text-gray-300 pt-1 border-t border-gray-700 mt-1">表格形态：点击行首箭头可展开该客户年度订单明细，点击表头可排序；折线图形态：按当前排序取前{CUST_CHART_TOP_N}客户多指标对比，切换形态时指标与数据范围保持不变</p>
                  </StatTooltip>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* 指标范围选择：时段 / 年度 / 全部（两种形态共用，切换形态时保持不变） */}
                  <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
                    {([
                      { value: 'period', label: '时段' },
                      { value: 'year', label: '年度' },
                      { value: 'all', label: '全部' },
                    ] as { value: CustomerViewMode; label: string }[]).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setViewMode(opt.value)}
                        title={opt.value === 'period' ? `所选时段（${rangeLabel}）指标` : undefined}
                        className={`px-2.5 py-1 text-xs transition-colors ${
                          viewMode === opt.value
                            ? 'bg-primary-600 text-white'
                            : 'bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {/* 展现形态切换：折线图 / 明细表格（同一数据源与筛选范围，切换不重置任何参数） */}
                  <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
                    {([
                      { value: 'chart' as AnalysisForm, label: '折线图', icon: LineChartIcon },
                      { value: 'table' as AnalysisForm, label: '表格', icon: TableIcon },
                    ]).map((opt) => {
                      const Icon = opt.icon
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setAnalysisForm(opt.value)}
                          title={opt.value === 'chart' ? '折线图形态：多指标对比展示' : '明细表格形态：完整客户数据记录'}
                          className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${
                            analysisForm === opt.value
                              ? 'bg-primary-600 text-white'
                              : 'bg-white text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          <Icon size={12} />
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </header>
              {analysisForm === 'chart' && (
                <div className="flex-1 min-h-0 flex flex-col">
                  {/* 折线图指标多选：与表格共享同一数据源/筛选/排序，切换形态时保持选中不重置 */}
                  <div className="px-4 pt-2 pb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 flex-shrink-0 border-b border-gray-50">
                    <span className="text-xs text-gray-500 shrink-0">指标：</span>
                    {CHART_METRICS.map((m) => {
                      const active = chartMetrics.includes(m.key)
                      const locked = active && chartMetrics.length === 1
                      return (
                        <button
                          key={m.key}
                          onClick={() => toggleChartMetric(m.key)}
                          disabled={locked}
                          title={locked ? '至少保留一个指标' : m.tip}
                          className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                            active
                              ? 'bg-primary-50 border-primary-200 text-primary-700'
                              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                          } ${locked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                        >
                          {m.key === 'profit' ? `利润${profitMode === 'noTax' ? '(不含税)' : '(含税)'}` : m.label}
                        </button>
                      )
                    })}
                    <span className="text-[10px] text-gray-400 ml-auto whitespace-nowrap">按「{custColumnLabel(custSort.key, profitMode)}{custSort.dir === 'asc' ? '↑' : '↓'}」前{CUST_CHART_TOP_N}家</span>
                  </div>
                  <div className="flex-1 min-h-0">
                    {custChartData.length === 0 ? (
                      <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-gray-400 gap-2 py-8">
                        <Users size={28} className="text-gray-200" />
                        <p className="text-sm">暂无符合条件的客户数据</p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={custChartData} margin={{ top: 12, right: 14, left: 4, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                          <XAxis
                            dataKey="name"
                            interval={0}
                            angle={-28}
                            textAnchor="end"
                            height={56}
                            tick={{ fontSize: 11, fill: '#6b7280' }}
                            tickFormatter={(v: string) => (v.length > 6 ? `${v.slice(0, 6)}…` : v)}
                            tickLine={false}
                            axisLine={{ stroke: '#e5e7eb' }}
                          />
                          {chartHasAmountAxis && (
                            <YAxis
                              yAxisId="amount"
                              width={58}
                              tick={{ fontSize: 11, fill: '#6b7280' }}
                              tickLine={false}
                              axisLine={{ stroke: '#e5e7eb' }}
                              tickFormatter={(v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString())}
                              label={{ value: '金额(元)', fontSize: 10, fill: '#9ca3af', angle: -90, position: 'insideLeft' }}
                            />
                          )}
                          {chartHasRateAxis && (
                            <YAxis
                              yAxisId="rate"
                              orientation="right"
                              width={36}
                              allowDecimals={false}
                              tick={{ fontSize: 11, fill: '#6b7280' }}
                              tickLine={false}
                              axisLine={{ stroke: '#e5e7eb' }}
                              label={{ value: '比率(%)', fontSize: 10, fill: '#9ca3af', angle: 90, position: 'insideRight' }}
                            />
                          )}
                          <ChartTooltip
                            formatter={(value, name) => {
                              const s = custChartSeries.find((x) => x.name === String(name))
                              return s?.unit === 'amount'
                                ? [`¥${Number(value ?? 0).toLocaleString()}`, String(name)]
                                : [`${Number(value ?? 0).toFixed(1)}%`, String(name)]
                            }}
                            labelStyle={{ color: '#374151', fontWeight: 600 }}
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                          {custChartSeries.map((s) => (
                            <Line
                              key={s.key}
                              yAxisId={s.yAxisId}
                              dataKey={s.dataKey}
                              name={s.name}
                              stroke={s.color}
                              strokeWidth={2}
                              dot={{ r: 3, fill: s.color }}
                              activeDot={{ r: 5 }}
                              connectNulls
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}
              {analysisForm === 'table' && (
              <div className="flex-1 overflow-auto">
                {pagedCustomerRows.length === 0 ? (
                  <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-gray-400 gap-2 py-8">
                    <Users size={28} className="text-gray-200" />
                    <p className="text-sm">暂无符合条件的客户数据</p>
                  </div>
                ) : (
                  <table className="w-full min-w-[560px]">
                    <thead className="sticky top-0 z-10">
                      {viewMode === 'all' && showPeriodCols ? (
                        <>
                          <tr className="bg-gray-50 text-gray-500 text-xs">
                            <th rowSpan={2} className="px-3 py-2 text-left font-medium border-b border-gray-200">客户名称</th>
                            <th colSpan={5} className="px-2 py-1.5 text-center font-medium border-b border-l border-gray-200 whitespace-nowrap" title="顶部所选日期范围内的指标">{rangeLabel}指标</th>
                            <th colSpan={5} className="px-2 py-1.5 text-center font-medium border-b border-l border-gray-200 whitespace-nowrap">{yearLabel}指标</th>
                            <th rowSpan={2} className="w-8 border-b border-gray-200"></th>
                          </tr>
                          <tr className="bg-gray-50 text-gray-500 text-xs">
                            {(['pCount', 'pAmount', 'pProfit', 'pRate', 'pConv'] as CustSortKey[]).map((key) => (
                              <th
                                key={key}
                                onClick={() => toggleCustSort(key)}
                                title={custColumnTitle(key)}
                                className={`px-2 py-2 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap border-l border-gray-100 ${key === 'pCount' ? 'text-center' : 'text-right'}`}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  {custColumnLabel(key, profitMode)}
                                  <SortIcon active={custSort.key === key} dir={custSort.dir} />
                                </span>
                              </th>
                            ))}
                            {(['yCount', 'yAmount', 'yProfit', 'yRate', 'yConv'] as CustSortKey[]).map((key) => (
                              <th
                                key={key}
                                onClick={() => toggleCustSort(key)}
                                title={custColumnTitle(key)}
                                className={`px-2 py-2 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap border-l border-gray-100 ${key === 'yCount' ? 'text-center' : 'text-right'}`}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  {custColumnLabel(key, profitMode)}
                                  <SortIcon active={custSort.key === key} dir={custSort.dir} />
                                </span>
                              </th>
                            ))}
                          </tr>
                        </>
                      ) : (
                        <tr className="bg-gray-50 text-gray-500 text-xs">
                          <th
                            onClick={() => toggleCustSort('name')}
                            className="px-3 py-2 text-left font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                          >
                            <span className="inline-flex items-center gap-0.5">客户名称<SortIcon active={custSort.key === 'name'} dir={custSort.dir} /></span>
                          </th>
                          {(viewMode === 'period'
                            ? (['pCount', 'pAmount', 'pProfit', 'pRate', 'pConv'] as CustSortKey[])
                            : (['yCount', 'yAmount', 'yProfit', 'yRate', 'yConv'] as CustSortKey[])
                          ).map((key) => {
                            const align = key.endsWith('Count') ? 'text-center' : 'text-right'
                            return (
                              <th
                                key={key}
                                onClick={() => toggleCustSort(key)}
                                title={custColumnTitle(key)}
                                className={`px-2.5 py-2 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${align}`}
                              >
                                <span className="inline-flex items-center gap-0.5">
                                  {custColumnLabel(key, profitMode)}
                                  <SortIcon active={custSort.key === key} dir={custSort.dir} />
                                </span>
                              </th>
                            )
                          })}
                          <th className="w-8"></th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pagedCustomerRows.map((r) => {
                        const expanded = expandedCustomer === r.name
                        const colspan = showPeriodCols && viewMode === 'all' ? 12 : 7
                        return (
                          <Fragment key={r.name}>
                            {/* 客户聚合行 */}
                            <tr
                              className={`text-xs hover:bg-gray-50/70 cursor-pointer ${expanded ? 'bg-primary-50/40' : ''}`}
                              onClick={() => { if (r.yearOrders.length > 0) setExpandedCustomer(expanded ? null : r.name) }}
                              title={r.yearOrders.length === 0 ? '该客户暂无订单明细' : expanded ? '点击收起明细' : '点击展开该客户年度订单明细'}
                            >
                              <td className="px-3 py-2 text-gray-700 max-w-[130px] truncate font-medium">{r.name}</td>
                              {showPeriodCols && (
                                <>
                                  <td className="px-2 py-2 text-center text-gray-700">{r.period.count}</td>
                                  <td className="px-2 py-2 text-right text-gray-700">{fmtAmount(r.period.amountNoTax)}</td>
                                  <td className={`px-2 py-2 text-right font-medium ${r.period.count === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                                    {r.period.count === 0 ? '-' : fmtAmount(profitMode === 'noTax' ? r.period.profitNoTax : r.period.profitWithTax)}
                                  </td>
                                  <td className="px-2 py-2 text-right text-gray-700">{r.period.count === 0 ? '-' : fmtRate(rateOf(r.period))}</td>
                                  <td className="px-2 py-2 text-right text-gray-700">{r.periodQuotes > 0 ? `${((r.periodConverted / r.periodQuotes) * 100).toFixed(1)}%` : '-'}</td>
                                </>
                              )}
                              {viewMode !== 'period' && (
                                <>
                                  <td className="px-2 py-2 text-center text-gray-700">{r.year.count}</td>
                                  <td className="px-2 py-2 text-right text-gray-700">{fmtAmount(r.year.amountNoTax)}</td>
                                  <td className={`px-2 py-2 text-right font-medium ${r.year.count === 0 ? 'text-gray-300' : 'text-gray-800'}`}>
                                    {r.year.count === 0 ? '-' : fmtAmount(profitMode === 'noTax' ? r.year.profitNoTax : r.year.profitWithTax)}
                                  </td>
                                  <td className="px-2 py-2 text-right text-gray-700">{r.year.count === 0 ? '-' : fmtRate(rateOf(r.year))}</td>
                                  <td className="px-2 py-2 text-right text-gray-700">{r.yearQuotes > 0 ? `${((r.yearConverted / r.yearQuotes) * 100).toFixed(1)}%` : '-'}</td>
                                </>
                              )}
                              <td className="px-1 py-2 text-center">
                                {r.yearOrders.length > 0 ? (
                                  <ChevronDownIcon
                                    size={14}
                                    className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                                  />
                                ) : (
                                  <span className="text-gray-200 text-[10px]">—</span>
                                )}
                              </td>
                            </tr>
                            {/* 客户年度订单明细（行展开） */}
                            {expanded && r.yearOrders.length > 0 && (
                              <tr className="bg-gray-50/60">
                                <td colSpan={colspan} className="px-3 py-2">
                                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5">
                                    <span className="font-medium text-gray-600">{r.name} · {yearLabel}订单明细</span>
                                    <span className="text-gray-300">|</span>
                                    <span>共 {r.yearOrders.length} 笔</span>
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-100 border border-blue-200"></span>
                                    <span className="text-[10px]">{rangeLabel}订单</span>
                                  </div>
                                  <div className="max-h-44 overflow-auto rounded-lg border border-gray-100 bg-white">
                                    <table className="w-full">
                                      <thead>
                                        <tr className="text-gray-400 text-[11px]">
                                          <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">下单日期</th>
                                          <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">订单号</th>
                                          <th className="px-2.5 py-1.5 text-left font-medium">产品信息</th>
                                          <th className="px-2.5 py-1.5 text-right font-medium whitespace-nowrap">数量</th>
                                          <th className="px-2.5 py-1.5 text-right font-medium whitespace-nowrap">金额(不含税)</th>
                                          <th className="px-2.5 py-1.5 text-right font-medium whitespace-nowrap">利润{profitMode === 'noTax' ? '(不含税)' : '(含税)'}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-50">
                                        {r.yearOrders.map((o) => (
                                          <tr key={o.id} className={`text-[11px] ${o.dateTs >= rangeStart.getTime() && o.dateTs <= rangeEnd.getTime() ? 'bg-blue-50/50' : ''}`}>
                                            <td className="px-2.5 py-1.5 text-gray-500 whitespace-nowrap">{o.dateStr}</td>
                                            <td className="px-2.5 py-1.5 whitespace-nowrap">
                                              <button
                                                onClick={(e) => { e.stopPropagation(); navigate(`/quotes/${o.id}`) }}
                                                className="text-primary-600 hover:text-primary-700 hover:underline font-mono"
                                                title="查看订单详情"
                                              >
                                                {o.quoteNumber}
                                              </button>
                                            </td>
                                            <td className="px-2.5 py-1.5 text-gray-600 max-w-[160px] truncate" title={o.productSpec ? `${o.styleLabel} ${o.productSpec}` : o.styleLabel}>
                                              {o.styleLabel}
                                              {o.productSpec && <span className="text-gray-400"> · {o.productSpec}</span>}
                                            </td>
                                            <td className="px-2.5 py-1.5 text-right text-gray-600">{o.quantity.toLocaleString()}</td>
                                            <td className="px-2.5 py-1.5 text-right font-medium text-gray-700">{fmtAmount(o.amountNoTax)}</td>
                                            <td className={`px-2.5 py-1.5 text-right ${(profitMode === 'noTax' ? o.profitNoTax : o.profitWithTax) >= 0 ? 'text-gray-700' : 'text-red-600'}`}>
                                              {fmtAmount(profitMode === 'noTax' ? o.profitNoTax : o.profitWithTax)}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              )}
              {analysisForm === 'table' && pagedCustomerRows.length > 0 && (
                <footer className="px-4 py-2 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/50">
                  <div className="text-xs text-gray-500">
                    年度金额合计(不含税) <span className="font-semibold text-gray-700">¥{fmtAmount(yearlyStats.amountNoTax)}</span>
                    <span className="mx-1.5 text-gray-200">|</span>
                    年度利润合计 <span className="font-semibold text-gray-700">¥{fmtAmount(currentYearProfit)}</span>
                  </div>
                  {renderPager(safeCustPage, custTotalPages, setCustPage, sortedCustomerRows.length, '家')}
                </footer>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
