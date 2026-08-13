import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, downloadBlob } from '../api'
import { usePermission } from '../hooks/usePermission'
import { TrendingUp, AlertTriangle, AlertCircle, Calendar, ArrowRight, Plus, ChevronDown, Filter, HelpCircle, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, ClipboardCheck, Eye, Receipt, Loader2, X, Copy } from 'lucide-react'
import { getStyleLabelFromProducts } from '../services/productStyles'
import { OrderStatus } from '../constants/OrderStatus'
import type { Product } from '../types'

/**
 * 统计卡片问号说明：hover 显示计算逻辑
 * 桌面端 hover 显示，移动端点击/触摸也会触发（浏览器对 group-hover 的触摸处理）
 */
function StatTooltip({ children }: { children: ReactNode }) {
  return (
    <div className="relative inline-flex group/tip align-middle ml-0.5">
      <HelpCircle
        size={14}
        className="text-gray-400 hover:text-gray-600 cursor-help transition-colors"
        aria-label="查看计算逻辑"
      />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tip:block z-30 w-60 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-lg leading-relaxed">
        <div className="space-y-1">
          {children}
        </div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-gray-800"></div>
      </div>
    </div>
  )
}

// 订单状态对应的 UI 颜色样式（Dashboard 专属，value/label 来自 OrderStatus 枚举类）
const STATUS_COLORS: Record<number, { color: string; bgColor: string; bgLightColor: string }> = {
  1: { color: 'bg-blue-100 text-blue-700', bgColor: 'bg-blue-500', bgLightColor: 'bg-blue-200' },
  2: { color: 'bg-yellow-100 text-yellow-700', bgColor: 'bg-yellow-500', bgLightColor: 'bg-yellow-200' },
  3: { color: 'bg-purple-100 text-purple-700', bgColor: 'bg-purple-500', bgLightColor: 'bg-purple-200' },
  4: { color: 'bg-orange-100 text-orange-700', bgColor: 'bg-orange-500', bgLightColor: 'bg-orange-200' },
  5: { color: 'bg-green-100 text-green-700', bgColor: 'bg-green-500', bgLightColor: 'bg-green-200' },
  6: { color: 'bg-gray-100 text-gray-700', bgColor: 'bg-gray-500', bgLightColor: 'bg-gray-200' },
  7: { color: 'bg-cyan-100 text-cyan-700', bgColor: 'bg-cyan-500', bgLightColor: 'bg-cyan-200' },
}

// 合并 OrderStatus 枚举数据与 UI 颜色样式，消除 value/label 重复定义
const STATUS_OPTIONS = OrderStatus.getAll().map((o) => ({
  ...o,
  ...STATUS_COLORS[o.value],
}))

// 默认选中的订单状态：打样中、做货中、已发货未收款
const DEFAULT_SELECTED_STATUSES = [2, 3, 4]
// 销售额/利润统计的订单状态范围：做货中(3)、已发货未收款(4)、已发货已收款(5)
// 时间匹配统一用「做货开始时间」归属到对应月份/年份（按用户决策保持原逻辑）
const STATS_STATUSES = [3, 4, 5]
const STORAGE_KEY = 'dashboard_selected_statuses'
const MONTH_STORAGE_KEY = 'dashboard_selected_month'
const PROFIT_MODE_STORAGE_KEY = 'dashboard_profit_mode'
const SORT_MODE_STORAGE_KEY = 'dashboard_sort_mode'

type ProfitMode = 'noTax' | 'withTax'
// 订单状态跟踪排序模式：按状态升序(1→6) / 降序(6→1)
// 同状态内以交货日期升序作为稳定二级排序，使更紧急的订单排在前面
type SortMode = 'statusAsc' | 'statusDesc'

const getInitialStatuses = (): number[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // localStorage 不可用或数据损坏，使用默认值
  }
  return DEFAULT_SELECTED_STATUSES
}

/** 获取初始月份（默认当前月，可从 localStorage 恢复） */
const getInitialMonth = (): string => {
  try {
    const saved = localStorage.getItem(MONTH_STORAGE_KEY)
    if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved
  } catch {
    // ignore
  }
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

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

/** 获取初始排序模式（默认按状态升序，可从 localStorage 恢复） */
const getInitialSortMode = (): SortMode => {
  try {
    const saved = localStorage.getItem(SORT_MODE_STORAGE_KEY)
    if (saved === 'statusAsc' || saved === 'statusDesc') return saved
  } catch {
    // ignore
  }
  return 'statusAsc'
}

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

export default function Dashboard() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [alertQuotes, setAlertQuotes] = useState<Quote[]>([])
  const [unpaidQuotes, setUnpaidQuotes] = useState<Quote[]>([])
  const [sampleCompletedQuotes, setSampleCompletedQuotes] = useState<Quote[]>([])
  // 订单图片标识（id -> 是否有图片），通过轻量级 API 获取
  const [imageFlags, setImageFlags] = useState<Record<string, boolean>>({})
  const [selectedStatuses, setSelectedStatuses] = useState<number[]>(getInitialStatuses)
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string>(getInitialMonth)
  const [profitMode, setProfitMode] = useState<ProfitMode>(getInitialProfitMode)
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSortMode)
  // 产品列表：从产品管理模块获取，用于款式标签显示
  const [products, setProducts] = useState<Product[]>([])
  const filterRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { hasPermission } = usePermission()
  // 收款单导出状态
  const [exportingPayment, setExportingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<{ type: string; message: string; detail?: string } | null>(null)
  const [paymentToast, setPaymentToast] = useState('')
  // 仪表盘滚动位置记忆：离开时保存，返回时恢复
  const scrollRestoreRef = useRef<number | null>(null)

  // 获取产品列表（款式标签数据源）
  useEffect(() => {
    api.products.getAll().then((data: Product[]) => setProducts(data))
  }, [])

  // 点击筛选器外部时关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setStatusFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleStatusToggle = (status: number) => {
    setSelectedStatuses((prev) => {
      const next = prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // localStorage 不可用，忽略
      }
      return next
    })
  }

  const handleMonthChange = (month: string) => {
    setSelectedMonth(month)
    try {
      localStorage.setItem(MONTH_STORAGE_KEY, month)
    } catch {
      // ignore
    }
  }

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

  const handleSortToggle = () => {
    setSortMode((prev) => {
      const next = prev === 'statusAsc' ? 'statusDesc' : 'statusAsc'
      try {
        localStorage.setItem(SORT_MODE_STORAGE_KEY, next)
      } catch {
        // ignore
      }
      return next
    })
  }

  useEffect(() => {
    // 从 sessionStorage 读取上次离开仪表盘时的滚动位置
    try {
      const saved = sessionStorage.getItem('dashboard_scroll')
      if (saved) {
        scrollRestoreRef.current = parseInt(saved, 10)
        sessionStorage.removeItem('dashboard_scroll')
      }
    } catch { /* ignore */ }
    fetchData()
  }, [])

  // 组件卸载时保存滚动位置（用户导航到其他页面）
  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem('dashboard_scroll', String(window.scrollY))
      } catch { /* ignore */ }
    }
  }, [])

  const fetchData = async () => {
    const [quotesData, flags] = await Promise.all([
      api.quotes.getAll() as Promise<Quote[]>,
      api.quotes.getImageFlags() as Promise<Record<string, boolean>>,
    ])
    setQuotes(quotesData)
    setImageFlags(flags || {})

    // 数据加载完成后恢复滚动位置（等待 DOM 渲染）
    if (scrollRestoreRef.current !== null) {
      const targetY = scrollRestoreRef.current
      scrollRestoreRef.current = null
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo(0, targetY)
        })
      })
    }

    // 交期预警（3天内 或 已逾期）
    // 做货中(3)/打样中(2)的订单：交期在3天内或已逾期 → 一直预警直到状态变为已发货未收款(4)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const alertDate = new Date(today)
    alertDate.setDate(today.getDate() + 3)

    const alerts = quotesData.filter((quote) => {
      // 排除报价中(1)、已发货未收款(4)、已发货已收款(5)、结束(6)
      if ([1, 4, 5, 6].includes(quote.status)) return false
      if (!quote.productionTimeEnd) return false
      const endDate = new Date(quote.productionTimeEnd)
      endDate.setHours(0, 0, 0, 0)
      // 3天内到期 或 已逾期（endDate <= alertDate 包含过去日期）
      return endDate <= alertDate
    })

    setAlertQuotes(alerts)

    // 收款提醒：已发货未收款(4)的订单
    const unpaid = quotesData.filter((quote) => quote.status === 4)
    setUnpaidQuotes(unpaid)

    // 打样完成提醒：状态为打样完成(7)的订单
    const sampleCompleted = quotesData.filter((quote) => quote.status === 7)
    setSampleCompletedQuotes(sampleCompleted)
  }

  // 确认做货：将打样完成(7)的订单流转到做货中(3)，然后跳转到订单编辑页面
  const handleConfirmProduction = async (quoteId: string) => {
    try {
      await api.quotes.nextStatus(quoteId)
      // 跳转到订单编辑页面
      navigate(`/quotes/${quoteId}`)
    } catch (error) {
      console.error('确认做货失败:', error)
    }
  }

  // 导出收款单：导出收款提醒中"已发货未收款"(status=4)的订单
  const handleExportPaymentReceipt = async () => {
    setPaymentError(null)
    setPaymentToast('')
    if (unpaidQuotes.length === 0) {
      setPaymentToast('暂无"已发货未收款"状态的订单数据')
      setTimeout(() => setPaymentToast(''), 3000)
      return
    }
    if (unpaidQuotes.length > 1000) {
      setPaymentError({
        type: 'toomany',
        message: `符合条件的数据共 ${unpaidQuotes.length} 条，超过单次导出上限 1000 条，请缩小范围或分批导出`,
      })
      return
    }
    setExportingPayment(true)
    try {
      const { blob, filename } = await api.export.paymentReceipts(
        unpaidQuotes.map((q) => q.id),
        '',
      )
      downloadBlob(blob, filename)
    } catch (error) {
      const e = error as Error & { timeout?: boolean; code?: string }
      if (e.code === 'NO_DATA') {
        setPaymentToast('暂无"已发货未收款"状态的订单数据')
        setTimeout(() => setPaymentToast(''), 3000)
      } else if (e.code === 'TOO_MANY_ROWS') {
        setPaymentError({ type: 'toomany', message: e.message })
      } else if (e.timeout) {
        setPaymentError({ type: 'timeout', message: e.message })
      } else if (/network|fetch|Failed to fetch|网络|Load failed/i.test(e.message)) {
        setPaymentError({ type: 'network', message: '网络连接异常，导出失败，请重试' })
      } else if (/500|服务器|权限不足|token/i.test(e.message)) {
        setPaymentError({ type: 'server', message: '服务器处理异常，请联系系统管理员', detail: e.message })
      } else {
        setPaymentError({ type: 'network', message: e.message || '导出失败，请重试' })
      }
    } finally {
      setExportingPayment(false)
    }
  }

  // 可选月份列表：从订单的做货开始时间中提取所有月份，按降序排列，确保当前月份始终可选
  const availableMonths = useMemo(() => {
    const set = new Set<string>()
    const now = new Date()
    set.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    quotes.forEach((q) => {
      const dateStr = q.productionStartTime || q.productionTimeStart
      if (!dateStr) return
      const d = new Date(dateStr)
      if (!isNaN(d.getTime())) {
        set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }
    })
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }, [quotes])

  // 月度统计：统计状态为做货中/已发货未收款/已发货已收款，且做货开始时间在所选月份的订单
  // - monthlyRevenue: 总销售额（按含税卖价 × 数量）
  // - monthlyProfitNoTax: 总利润(不含税) = Σ 数量 × (卖价不含税 - 成本价)
  // - monthlyProfitWithTax: 总利润(含税) = Σ 数量 × (卖价含税 - 含税价)
  const monthlyStats = useMemo(() => {
    const [yearStr, monthStr] = selectedMonth.split('-')
    const year = parseInt(yearStr)
    const month = parseInt(monthStr) - 1
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)

    const productionQuotes = quotes.filter((quote) => {
      if (!STATS_STATUSES.includes(quote.status)) return false
      const productionDate = new Date(quote.productionStartTime || quote.productionTimeStart)
      if (isNaN(productionDate.getTime())) return false
      return productionDate >= monthStart && productionDate <= monthEnd
    })

    let monthlyRevenue = 0
    let monthlyProfitNoTax = 0
    let monthlyProfitWithTax = 0
    let orderCount = 0
    // 按状态分组计数：做货中(3) / 已发货未收款(4) / 已发货已收款(5)
    const statusCounts: Record<number, number> = { 3: 0, 4: 0, 5: 0 }

    productionQuotes.forEach((quote) => {
      const quantity = parseFloat(quote.quantity) || 0
      const cost = quote.costPrice || 0
      const priceWithTax = quote.priceWithTax || 0
      const sellNoTax = quote.sellPriceNoTax || 0
      const sellWithTax = quote.sellPriceWithTax || 0
      monthlyRevenue += quantity * sellWithTax
      monthlyProfitNoTax += quantity * (sellNoTax - cost)
      monthlyProfitWithTax += quantity * (sellWithTax - priceWithTax)
      orderCount++
      if (statusCounts[quote.status] !== undefined) statusCounts[quote.status]++
    })

    // 打样中订单数：按 sampleTime 在所选月份过滤（打样中订单无做货开始时间，单独口径统计）
    const sampleQuotesInMonth = quotes.filter((quote) => {
      if (quote.status !== 2) return false
      const sampleDate = new Date(quote.sampleTime)
      if (isNaN(sampleDate.getTime())) return false
      return sampleDate >= monthStart && sampleDate <= monthEnd
    })

    return {
      monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
      monthlyProfitNoTax: Math.round(monthlyProfitNoTax * 100) / 100,
      monthlyProfitWithTax: Math.round(monthlyProfitWithTax * 100) / 100,
      // 总笔数包含打样中订单（做货中+已发货未收款+已发货已收款+打样中）
      orderCount: orderCount + sampleQuotesInMonth.length,
      statusCounts,
      sampleCount: sampleQuotesInMonth.length,
    }
  }, [quotes, selectedMonth])

  // 年度统计：与月度统计同规则（状态范围/时间字段一致），仅时间范围扩大到所选月份对应的整年
  const yearlyStats = useMemo(() => {
    const year = parseInt(selectedMonth.split('-')[0])
    const yearStart = new Date(year, 0, 1)
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999)

    const productionQuotes = quotes.filter((quote) => {
      if (!STATS_STATUSES.includes(quote.status)) return false
      const productionDate = new Date(quote.productionStartTime || quote.productionTimeStart)
      if (isNaN(productionDate.getTime())) return false
      return productionDate >= yearStart && productionDate <= yearEnd
    })

    let yearlyRevenue = 0
    let yearlyProfitNoTax = 0
    let yearlyProfitWithTax = 0
    let orderCount = 0

    productionQuotes.forEach((quote) => {
      const quantity = parseFloat(quote.quantity) || 0
      const cost = quote.costPrice || 0
      const priceWithTax = quote.priceWithTax || 0
      const sellNoTax = quote.sellPriceNoTax || 0
      const sellWithTax = quote.sellPriceWithTax || 0
      yearlyRevenue += quantity * sellWithTax
      yearlyProfitNoTax += quantity * (sellNoTax - cost)
      yearlyProfitWithTax += quantity * (sellWithTax - priceWithTax)
      orderCount++
    })

    return {
      yearlyRevenue: Math.round(yearlyRevenue * 100) / 100,
      yearlyProfitNoTax: Math.round(yearlyProfitNoTax * 100) / 100,
      yearlyProfitWithTax: Math.round(yearlyProfitWithTax * 100) / 100,
      orderCount,
    }
  }, [quotes, selectedMonth])

  // 今日新增报价数：按 created_at（订单创建日期）统计
  const todayNewCount = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    return quotes.filter((q) => {
      const d = new Date(q.created_at)
      if (isNaN(d.getTime())) return false
      return d >= todayStart && d <= todayEnd
    }).length
  }, [quotes])

  // 昨日新增报价数：用于与今日对比
  const yesterdayNewCount = useMemo(() => {
    const now = new Date()
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999)
    return quotes.filter((q) => {
      const d = new Date(q.created_at)
      if (isNaN(d.getTime())) return false
      return d >= yesterdayStart && d <= yesterdayEnd
    }).length
  }, [quotes])

  // 今日/昨日按状态分组的新增数（做货中=3、打样中=2、打样完成=7）
  const todayStatusCounts = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    const counts: Record<number, number> = { 2: 0, 3: 0, 7: 0 }
    quotes.forEach((q) => {
      const d = new Date(q.created_at)
      if (isNaN(d.getTime())) return
      if (d >= start && d <= end && counts[q.status] !== undefined) counts[q.status]++
    })
    return counts
  }, [quotes])

  const yesterdayStatusCounts = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999)
    const counts: Record<number, number> = { 2: 0, 3: 0, 7: 0 }
    quotes.forEach((q) => {
      const d = new Date(q.created_at)
      if (isNaN(d.getTime())) return
      if (d >= start && d <= end && counts[q.status] !== undefined) counts[q.status]++
    })
    return counts
  }, [quotes])

  // 当前做货中/打样中/打样完成总数
  const currentProductionCount = useMemo(() => quotes.filter((q) => q.status === 3).length, [quotes])
  const currentSampleCount = useMemo(() => quotes.filter((q) => q.status === 2).length, [quotes])
  const currentSampleCompletedCount = useMemo(() => quotes.filter((q) => q.status === 7).length, [quotes])

  // 当前利润模式对应的月度/年度利润值
  const currentProfit = profitMode === 'noTax' ? monthlyStats.monthlyProfitNoTax : monthlyStats.monthlyProfitWithTax
  const currentYearProfit = profitMode === 'noTax' ? yearlyStats.yearlyProfitNoTax : yearlyStats.yearlyProfitWithTax

  const getStatusLabel = (status: number) => {
    const option = STATUS_OPTIONS.find((o) => o.value === status)
    return option ? option.label : '未知'
  }

  const getStatusColor = (status: number) => {
    const option = STATUS_OPTIONS.find((o) => o.value === status)
    return option ? option.color : 'bg-gray-100 text-gray-700'
  }

  const getStatusBgColor = (status: number) => {
    const option = STATUS_OPTIONS.find((o) => o.value === status)
    return option ? option.bgColor : 'bg-gray-500'
  }

  const getStatusBgLightColor = (status: number) => {
    const option = STATUS_OPTIONS.find((o) => o.value === status)
    return option ? option.bgLightColor : 'bg-gray-200'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  const getDaysUntilDue = (endDateStr: string) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const endDate = new Date(endDateStr)
    endDate.setHours(0, 0, 0, 0)
    const diffTime = endDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  // 根据选中的状态筛选订单并排序（useMemo 优化性能，避免每次渲染都重新筛选+排序）
  // 主排序：按订单状态在流转路径中的位置（升序或降序）
  // 二级排序：同状态内按交货日期升序，使更紧急的订单排在前面（同时保证排序稳定）
  const activeQuotes = useMemo(() => {
    const filtered = quotes.filter((q) => selectedStatuses.includes(q.status))
    const sorted = [...filtered].sort((a, b) => {
      // 主排序：状态（基于 FLOW 指针位置，非数值大小）
      const aPos = OrderStatus.getFlowPosition(a.status)
      const bPos = OrderStatus.getFlowPosition(b.status)
      if (aPos !== bPos) {
        return sortMode === 'statusAsc'
          ? aPos - bPos
          : bPos - aPos
      }
      // 二级排序：交货日期升序（无交货日期的排后面）
      const aDue = a.productionTimeEnd ? new Date(a.productionTimeEnd).getTime() : Infinity
      const bDue = b.productionTimeEnd ? new Date(b.productionTimeEnd).getTime() : Infinity
      return aDue - bDue
    })
    return sorted
  }, [quotes, selectedStatuses, sortMode])

  // 获取甘特图日期范围（从最早的开始日期到最晚的结束日期）
  const getGanttRange = () => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]

    const filteredQuotes = activeQuotes
    
    let minDate = today
    let maxDate = today

    filteredQuotes.forEach((quote) => {
      const startDate = quote.productionStartTime ? new Date(quote.productionStartTime) : new Date(quote.productionTimeStart)
      const endDateStr = quote.productionTimeEnd || todayStr
      const endDate = new Date(endDateStr)
      
      if (startDate < minDate) minDate = startDate
      if (endDate > maxDate) maxDate = endDate
    })

    // 确保至少有7天的范围
    if (maxDate <= minDate) {
      maxDate = new Date(minDate)
      maxDate.setDate(maxDate.getDate() + 7)
    }

    return { minDate, maxDate }
  }

  const { minDate, maxDate } = getGanttRange()

  const generateGanttDays = () => {
    const days = []
    const current = new Date(minDate)
    while (current <= maxDate) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    return days
  }

  const ganttDays = generateGanttDays()

  const calculateProgress = (quote: Quote) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const startDate = quote.productionStartTime ? new Date(quote.productionStartTime) : new Date(quote.productionTimeStart)
    const endDateStr = quote.productionTimeEnd || today.toISOString().split('T')[0]
    const endDate = new Date(endDateStr)
    
    const totalDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const elapsedDays = Math.max(0, (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    
    return Math.min(100, (elapsedDays / totalDays) * 100)
  }

  const getGanttBarStyle = (quote: Quote) => {
    const startDate = quote.productionStartTime ? new Date(quote.productionStartTime) : new Date(quote.productionTimeStart)
    const endDateStr = quote.productionTimeEnd || new Date().toISOString().split('T')[0]
    const endDate = new Date(endDateStr)
    
    const totalDays = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)
    const offsetDays = (startDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)
    const durationDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    
    const left = Math.max(0, (offsetDays / totalDays) * 100)
    const width = Math.min(100 - left, (durationDays / totalDays) * 100)
    
    return { left: `${left}%`, width: `${width}%` }
  }

  // 月份显示标签（YYYY-MM → YYYY年MM月）
  const monthLabel = useMemo(() => {
    const [y, m] = selectedMonth.split('-')
    return `${y}年${parseInt(m)}月`
  }, [selectedMonth])

  // 年度标签（与所选月份对应的年份，年度统计随月份切换自动跟随）
  const yearLabel = useMemo(() => {
    return `${selectedMonth.split('-')[0]}年`
  }, [selectedMonth])

  return (
      <div className="p-4 sm:p-6">
        <div className="mb-6 sm:mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">仪表盘</h1>
            <p className="text-gray-500 mt-1">欢迎回来，查看今日业务概览</p>
          </div>
          {/* 月份筛选器 */}
          <div className="flex items-center gap-2">
            <Calendar className="text-gray-400" size={18} />
            <div className="relative">
              <select
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="appearance-none pl-3 pr-9 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none cursor-pointer"
              >
                {availableMonths.map((m) => {
                  const [y, mo] = m.split('-')
                  return (
                    <option key={m} value={m}>{y}年{parseInt(mo)}月</option>
                  )
                })}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* 当月业绩（销售额 + 利润合并） */}
          <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center">
                  <TrendingUp className="text-purple-600" size={18} />
                </div>
                <h3 className="text-base font-semibold text-gray-800">{monthLabel}业绩</h3>
              </div>
              {/* 利润模式切换（当月/全年联动） */}
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* 销售额 */}
              <div className="min-w-0">
                <p className="text-sm text-gray-500 flex items-center">
                  销售额
                  <StatTooltip>
                    <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                    <p>• 时间范围：做货开始时间在所选月份</p>
                    <p>• 计算公式：Σ（含税卖价 × 数量）</p>
                    <p className="text-gray-300 pt-1 border-t border-gray-700 mt-1">下方明细为各状态订单数量</p>
                  </StatTooltip>
                </p>
                <p className="text-2xl font-bold text-gray-800 mt-1">¥{monthlyStats.monthlyRevenue.toLocaleString()}</p>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                  <span className="text-xs text-blue-600">做货中 {monthlyStats.statusCounts[3]}</span>
                  <span className="text-xs text-amber-600">未收款 {monthlyStats.statusCounts[4]}</span>
                  <span className="text-xs text-green-600">已收款 {monthlyStats.statusCounts[5]}</span>
                  <span className="text-xs text-yellow-600">打样中 {monthlyStats.sampleCount}</span>
                </div>
              </div>
              {/* 利润 */}
              <div className="min-w-0">
                <p className="text-sm text-gray-500 flex items-center">
                  利润
                  <StatTooltip>
                    <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                    <p>• 时间范围：做货开始时间在所选月份</p>
                    <p>• 不含税：Σ 数量 ×（卖价不含税 − 成本价）</p>
                    <p>• 含税：Σ 数量 ×（卖价含税 − 含税价）</p>
                  </StatTooltip>
                </p>
                <p className={`text-2xl font-bold mt-1 ${profitMode === 'noTax' ? 'text-red-600' : 'text-green-600'}`}>
                  ¥{currentProfit.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {profitMode === 'noTax' ? '卖价(不含税) - 成本价' : '卖价(含税) - 含税价'}
                </p>
              </div>
            </div>
          </div>

          {/* 全年业绩（销售额 + 利润合并） */}
          <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                  <TrendingUp className="text-blue-600" size={18} />
                </div>
                <h3 className="text-base font-semibold text-gray-800">{yearLabel}业绩</h3>
              </div>
              {/* 利润模式切换（与当月联动同一状态） */}
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* 销售额 */}
              <div className="min-w-0">
                <p className="text-sm text-gray-500 flex items-center">
                  销售额
                  <StatTooltip>
                    <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                    <p>• 时间范围：做货开始时间在所选月份对应的整年</p>
                    <p>• 计算公式：Σ（含税卖价 × 数量）</p>
                  </StatTooltip>
                </p>
                <p className="text-2xl font-bold text-gray-800 mt-1">¥{yearlyStats.yearlyRevenue.toLocaleString()}</p>
                <p className="text-xs text-gray-400 mt-1">做货中/已发货订单 · {yearlyStats.orderCount} 笔</p>
              </div>
              {/* 利润 */}
              <div className="min-w-0">
                <p className="text-sm text-gray-500 flex items-center">
                  利润
                  <StatTooltip>
                    <p>• 统计范围：状态为「做货中/已发货未收款/已发货已收款」的订单</p>
                    <p>• 时间范围：做货开始时间在所选月份对应的整年</p>
                    <p>• 不含税：Σ 数量 ×（卖价不含税 − 成本价）</p>
                    <p>• 含税：Σ 数量 ×（卖价含税 − 含税价）</p>
                  </StatTooltip>
                </p>
                <p className={`text-2xl font-bold mt-1 ${profitMode === 'noTax' ? 'text-red-600' : 'text-green-600'}`}>
                  ¥{currentYearProfit.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {profitMode === 'noTax' ? '卖价(不含税) - 成本价' : '卖价(含税) - 含税价'}
                </p>
              </div>
            </div>
          </div>

          {/* 今日新增报价数 */}
          <div className="bg-white rounded-xl p-4 sm:p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center">
                  <Plus className="text-green-600" size={18} />
                </div>
                <h3 className="text-base font-semibold text-gray-800">今日新增</h3>
              </div>
              <StatTooltip>
                <p>• 统计口径：以订单的创建日期为准</p>
                <p>• 时间范围：今天 00:00 ~ 23:59</p>
                <p>• 包含所有状态的订单</p>
              </StatTooltip>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {/* 报价数 */}
              <div>
                <p className="text-sm text-gray-500">报价数</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{todayNewCount}</p>
                <p className="text-xs text-gray-400 mt-1">
                  昨日 {yesterdayNewCount}
                  {todayNewCount > yesterdayNewCount && (
                    <span className="text-green-600 ml-0.5">↑{todayNewCount - yesterdayNewCount}</span>
                  )}
                  {todayNewCount < yesterdayNewCount && yesterdayNewCount > 0 && (
                    <span className="text-red-500 ml-0.5">↓{yesterdayNewCount - todayNewCount}</span>
                  )}
                </p>
              </div>
              {/* 做货中 */}
              <div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                  做货中
                </p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{currentProductionCount}</p>
                <p className="text-xs text-gray-400 mt-1">
                  今日 +{todayStatusCounts[3]}
                  {todayStatusCounts[3] > yesterdayStatusCounts[3] && (
                    <span className="text-green-600 ml-0.5">↑{todayStatusCounts[3] - yesterdayStatusCounts[3]}</span>
                  )}
                  {todayStatusCounts[3] < yesterdayStatusCounts[3] && (
                    <span className="text-red-500 ml-0.5">↓{yesterdayStatusCounts[3] - todayStatusCounts[3]}</span>
                  )}
                </p>
              </div>
              {/* 打样中 */}
              <div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                  打样中
                </p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{currentSampleCount}</p>
                <p className="text-xs text-gray-400 mt-1">
                  今日 +{todayStatusCounts[2]}
                  {todayStatusCounts[2] > yesterdayStatusCounts[2] && (
                    <span className="text-green-600 ml-0.5">↑{todayStatusCounts[2] - yesterdayStatusCounts[2]}</span>
                  )}
                  {todayStatusCounts[2] < yesterdayStatusCounts[2] && (
                    <span className="text-red-500 ml-0.5">↓{yesterdayStatusCounts[2] - todayStatusCounts[2]}</span>
                  )}
                </p>
              </div>
              {/* 打样完成 */}
              <div>
                <p className="text-sm text-gray-500 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                  打样完成
                </p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{currentSampleCompletedCount}</p>
                <p className="text-xs text-gray-400 mt-1">
                  今日 +{todayStatusCounts[7]}
                  {todayStatusCounts[7] > yesterdayStatusCounts[7] && (
                    <span className="text-green-600 ml-0.5">↑{todayStatusCounts[7] - yesterdayStatusCounts[7]}</span>
                  )}
                  {todayStatusCounts[7] < yesterdayStatusCounts[7] && (
                    <span className="text-red-500 ml-0.5">↓{yesterdayStatusCounts[7] - todayStatusCounts[7]}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8">
          {/* 订单状态跟踪甘特图 - 独立一行 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-gray-800">订单状态跟踪</h2>
              <div className="flex items-center gap-3">
                {/* 排序按钮：按订单状态升序/降序切换 */}
                <button
                  onClick={handleSortToggle}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  title={`按订单状态${sortMode === 'statusAsc' ? '升序' : '降序'}（点击切换）`}
                >
                  <ArrowUpDown size={14} className="text-gray-400" />
                  <span className="text-gray-600">状态排序</span>
                  {sortMode === 'statusAsc'
                    ? <ArrowUp size={12} className="text-gray-500" />
                    : <ArrowDown size={12} className="text-gray-500" />}
                </button>
                {/* 多选状态筛选器 */}
                <div className="relative" ref={filterRef}>
                  <button
                    onClick={() => setStatusFilterOpen(!statusFilterOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Filter size={14} className="text-gray-400" />
                    <span className="text-gray-600">状态筛选</span>
                    <span className="text-xs text-gray-400">({selectedStatuses.length})</span>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform ${statusFilterOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {statusFilterOpen && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[200px] py-1">
                      <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">
                        选择要显示的订单状态
                      </div>
                      {STATUS_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selectedStatuses.includes(opt.value)}
                            onChange={() => handleStatusToggle(opt.value)}
                            className="rounded text-primary-600 focus:ring-primary-500"
                          />
                          <span className={`px-2 py-0.5 text-xs rounded-full ${opt.color}`}>{opt.label}</span>
                        </label>
                      ))}
                      <div className="border-t border-gray-100 mt-1 pt-1 flex justify-between px-3">
                        <button
                          onClick={() => {
                            setSelectedStatuses(DEFAULT_SELECTED_STATUSES)
                            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SELECTED_STATUSES)) } catch {}
                          }}
                          className="text-xs text-primary-600 hover:text-primary-700"
                        >
                          重置默认
                        </button>
                        <button
                          onClick={() => {
                            const all = STATUS_OPTIONS.map(o => o.value)
                            setSelectedStatuses(all)
                            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) } catch {}
                          }}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          全选
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => navigate('/quotes')}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium py-1.5 sm:py-0 min-h-[40px] sm:min-h-0"
                >
                  查看全部 <ArrowRight size={16} className="inline" />
                </button>
              </div>
            </div>

            {/* 当前筛选状态标签 */}
            {selectedStatuses.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {selectedStatuses
                  .slice()
                  .sort((a, b) => a - b)
                  .map((s) => {
                    const opt = STATUS_OPTIONS.find((o) => o.value === s)
                    if (!opt) return null
                    return (
                      <span
                        key={s}
                        className={`px-2 py-0.5 text-xs rounded-full ${opt.color} cursor-pointer hover:opacity-70`}
                        onClick={() => handleStatusToggle(s)}
                        title="点击移除"
                      >
                        {opt.label} ✕
                      </span>
                    )
                  })}
              </div>
            )}

            {activeQuotes.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无订单记录</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  {/* 日期表头 */}
                  <div className="flex border-b border-gray-200 pb-2 mb-2">
                    <div className="w-56 shrink-0"></div>
                    <div className="flex-1 flex">
                      {ganttDays.map((day, index) => (
                        <div
                          key={index}
                          className="flex-1 text-center text-xs"
                          style={{ minWidth: '35px' }}
                        >
                          <span className="block text-gray-500">{day.getMonth() + 1}/{day.getDate()}</span>
                          {day.toDateString() === new Date().toDateString() && (
                            <span className="block text-primary-600 font-bold">今天</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="w-24 shrink-0 text-right">
                      <span className="text-xs text-gray-500">进度</span>
                    </div>
                  </div>

                  {/* 订单行 */}
                  {activeQuotes.map((quote) => {
                    const barStyle = getGanttBarStyle(quote)
                    const progress = calculateProgress(quote)

                    return (
                      <div
                        key={quote.id}
                        onDoubleClick={() => navigate(`/quotes/${quote.id}`)}
                        title="双击查看订单详情"
                        className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <div className="w-72 shrink-0 flex items-center gap-2">
                          {/* 产品首图 */}
                          {imageFlags[quote.id] ? (
                            <img
                              src={api.quotes.getThumbnailUrl(quote.id, quote.updated_at)}
                              alt="产品图"
                              loading="lazy"
                              className="w-8 h-8 rounded-lg object-cover border border-gray-200 flex-shrink-0"
                              onError={(e) => {
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const placeholder = target.nextElementSibling as HTMLElement
                                if (placeholder) placeholder.style.display = 'flex'
                              }}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <span className="text-[10px] font-bold text-gray-400">{quote.customerName.charAt(0)}</span>
                            </div>
                          )}
                          {/* onError 时的占位符（默认隐藏） */}
                          <div className="w-8 h-8 rounded-lg bg-gray-100 items-center justify-center flex-shrink-0" style={{ display: 'none' }}>
                            <span className="text-[10px] font-bold text-gray-400">{quote.customerName.charAt(0)}</span>
                          </div>
                          {/* 文字信息：状态标签 + 客户名同行，款式+数量副标题 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-1.5 py-0 text-[10px] font-medium rounded-full ${getStatusColor(quote.status)}`}>
                                {getStatusLabel(quote.status)}
                              </span>
                              <p className="text-sm font-medium text-gray-800">{quote.customerName}</p>
                            </div>
                            <p className="text-xs text-gray-500">{getStyleLabelFromProducts(products, quote.productStyle)} · {quote.quantity}个</p>
                          </div>
                        </div>
                        <div className="flex-1 relative h-8">
                          {/* 背景轨道 */}
                          <div className="absolute inset-y-2 left-0 right-0 bg-gray-100 rounded-full"></div>
                          {/* 总时间进度条（浅色） */}
                          <div
                            className={`absolute inset-y-2 rounded-full transition-all duration-300 ${getStatusBgLightColor(quote.status)}`}
                            style={{ ...barStyle }}
                          >
                            {/* 当前进度条（深色） */}
                            <div
                              className={`absolute top-0 bottom-0 left-0 rounded-full transition-all duration-300 ${getStatusBgColor(quote.status)}`}
                              style={{ width: `${progress}%` }}
                            ></div>
                          </div>
                          {/* 当前日期标记 */}
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 rounded-full z-10"
                            style={{ left: `${((new Date().getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * 100}%` }}
                          ></div>
                        </div>
                        <div className="w-28 shrink-0 text-right">
                          <p className="text-xs text-gray-500">{formatDate(quote.productionTimeStart)} → {formatDate(quote.productionTimeEnd || new Date().toISOString().split('T')[0])}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* 交期预警 — 无数据时隐藏 */}
          {alertQuotes.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-red-500" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">交期预警</h2>
              </div>
              <button
                onClick={() => navigate('/quotes')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium py-1.5 sm:py-0 min-h-[40px] sm:min-h-0"
              >
                查看全部 <ArrowRight size={16} className="inline" />
              </button>
            </div>

            <div className="space-y-2">
              {alertQuotes.map((quote) => {
                const daysLeft = getDaysUntilDue(quote.productionTimeEnd)
                const isOverdue = daysLeft < 0
                return (
                  <div
                    key={quote.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded-lg border-l-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                      isOverdue ? 'bg-red-50 border-red-600' :
                      daysLeft === 0 ? 'bg-red-50 border-red-500' :
                      daysLeft <= 1 ? 'bg-orange-50 border-orange-500' :
                      'bg-yellow-50 border-yellow-500'
                    }`}
                    onClick={() => navigate(`/quotes/${quote.id}`)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${getStatusColor(quote.status)}`}>
                        {getStatusLabel(quote.status)}
                      </span>
                      <span className="text-sm text-gray-700">
                        {quote.customerName}-{getStyleLabelFromProducts(products, quote.productStyle)}-{quote.quantity}个
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400">{formatDate(quote.productionTimeEnd)}</span>
                      <span className={`text-xs font-semibold ${
                        isOverdue ? 'text-red-600' :
                        daysLeft === 0 ? 'text-red-600' :
                        daysLeft <= 1 ? 'text-orange-600' :
                        'text-yellow-600'
                      }`}>
                        {isOverdue ? `逾期${Math.abs(daysLeft)}天` : daysLeft === 0 ? '今日到期' : `剩${daysLeft}天`}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          )}

          {/* 收款提醒 — 无数据时隐藏 */}
          {unpaidQuotes.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <DollarSign className="text-amber-500" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">收款提醒</h2>
              </div>
              <div className="flex items-center gap-2">
                {hasPermission('quotes:export-payment') && (
                  <button
                    onClick={handleExportPaymentReceipt}
                    disabled={exportingPayment}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="导出收款提醒中已发货未收款订单的收款单（Excel/ZIP）"
                  >
                    {exportingPayment ? <Loader2 size={16} className="animate-spin" /> : <Receipt size={16} />}
                    <span className="hidden sm:inline">导出收款单</span>
                  </button>
                )}
                <button
                  onClick={() => navigate('/quotes')}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium py-1.5 sm:py-0 min-h-[40px] sm:min-h-0"
                >
                  查看全部 <ArrowRight size={16} className="inline" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {unpaidQuotes.map((quote) => {
                const daysSinceShipped = quote.shippingTime
                  ? getDaysUntilDue(quote.shippingTime) * -1
                  : null
                return (
                  <div
                    key={quote.id}
                    className={`flex items-center justify-between gap-2 p-2 rounded-lg border-l-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                      daysSinceShipped !== null && daysSinceShipped > 30 ? 'bg-red-50 border-red-500' :
                      daysSinceShipped !== null && daysSinceShipped > 15 ? 'bg-orange-50 border-orange-500' :
                      'bg-amber-50 border-amber-500'
                    }`}
                    onClick={() => navigate(`/quotes/${quote.id}`)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${getStatusColor(quote.status)}`}>
                        {getStatusLabel(quote.status)}
                      </span>
                      <span className="text-sm text-gray-700">
                        {quote.customerName}-{getStyleLabelFromProducts(products, quote.productStyle)}-{quote.quantity}个
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {quote.shippingTime && <span className="text-xs text-gray-400">发货{formatDate(quote.shippingTime)}</span>}
                      <span className={`text-xs font-semibold ${
                        daysSinceShipped !== null && daysSinceShipped > 30 ? 'text-red-600' :
                        daysSinceShipped !== null && daysSinceShipped > 15 ? 'text-orange-600' :
                        'text-amber-600'
                      }`}>
                        {daysSinceShipped !== null ? `已发货${daysSinceShipped}天` : '待收款'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          )}

          {/* 打样完成提醒 — 无数据时隐藏 */}
          {sampleCompletedQuotes.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="text-cyan-500" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">打样完成提醒</h2>
                <span className="px-1.5 py-0.5 text-xs font-medium rounded-full bg-cyan-100 text-cyan-700">{sampleCompletedQuotes.length} 笔</span>
              </div>
              <button
                onClick={() => navigate('/quotes')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium py-1.5 sm:py-0 min-h-[40px] sm:min-h-0"
              >
                查看全部 <ArrowRight size={16} className="inline" />
              </button>
            </div>

            <div className="space-y-2">
              {[...sampleCompletedQuotes]
                .sort((a, b) => {
                  // 智能排序：1.订单金额降序 2.打样完成时间降序（最新优先）
                  const aAmount = (parseFloat(a.quantity) || 0) * (a.sellPriceWithTax || 0)
                  const bAmount = (parseFloat(b.quantity) || 0) * (b.sellPriceWithTax || 0)
                  if (aAmount !== bAmount) return bAmount - aAmount
                  const aTime = a.sampleCompletedTime ? new Date(a.sampleCompletedTime).getTime() : 0
                  const bTime = b.sampleCompletedTime ? new Date(b.sampleCompletedTime).getTime() : 0
                  return bTime - aTime
                })
                .map((quote) => {
                return (
                  <div
                    key={quote.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg border-l-4 bg-cyan-50 border-cyan-500 hover:bg-cyan-100/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 bg-cyan-100 text-cyan-700">
                        打样完成
                      </span>
                      <span className="text-sm text-gray-700">
                        {quote.customerName}-{getStyleLabelFromProducts(products, quote.productStyle)}-{quote.quantity}个
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {quote.sampleCompletedTime && <span className="text-xs text-gray-400">{formatDate(quote.sampleCompletedTime)}</span>}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleConfirmProduction(quote.id) }}
                        className="flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-white bg-cyan-600 rounded hover:bg-cyan-700 transition-colors"
                        title="将订单状态从打样完成流转到做货中"
                      >
                        <ArrowRight size={12} />
                        做货
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/quotes/${quote.id}`) }}
                        className="flex items-center gap-0.5 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                        title="查看订单详情"
                      >
                        <Eye size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          )}
        </div>

        <div className="mt-6">
          <div className="bg-gradient-to-r from-primary-600 to-blue-600 rounded-xl p-4 sm:p-6 text-white">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold">快速开始</h2>
                <p className="text-blue-100 mt-1">创建订单或添加客户，开始您的业务流程</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate('/quotes')}
                  className="flex items-center gap-2 bg-white text-primary-600 px-4 sm:px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors min-h-[44px]"
                >
                  <Plus size={20} />
                  订单管理
                </button>
                <button
                  onClick={() => navigate('/customers/new')}
                  className="flex items-center gap-2 bg-white/20 text-white px-4 sm:px-6 py-3 rounded-lg font-medium hover:bg-white/30 transition-colors min-h-[44px]"
                >
                  <Plus size={20} />
                  添加客户
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 收款单导出：全屏半透明遮罩 + 加载动画 */}
        {exportingPayment && (
          <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center">
            <div className="bg-white rounded-xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
              <Loader2 size={40} className="animate-spin text-primary-600" />
              <p className="text-gray-700 font-medium">数据导出中，请稍候...</p>
            </div>
          </div>
        )}

        {/* 收款单导出：错误弹窗 */}
        {paymentError && (
          <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex items-start gap-3 mb-4">
                <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 font-medium break-words">{paymentError.message}</p>
                  {paymentError.detail && (
                    <p className="text-xs text-gray-500 mt-2 break-all">错误详情：{paymentError.detail}</p>
                  )}
                </div>
                <button onClick={() => setPaymentError(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0" title="关闭">
                  <X size={18} />
                </button>
              </div>
              <div className="flex justify-end gap-2 flex-wrap">
                {(paymentError.type === 'network' || paymentError.type === 'timeout') && (
                  <button
                    onClick={() => { setPaymentError(null); handleExportPaymentReceipt() }}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    重试
                  </button>
                )}
                {paymentError.type === 'server' && (
                  <>
                    <button
                      onClick={() => {
                        const text = paymentError.detail || paymentError.message
                        try {
                          navigator.clipboard?.writeText(text)
                        } catch { /* 忽略剪贴板权限失败 */ }
                        setPaymentToast('错误信息已复制到剪贴板')
                        setTimeout(() => setPaymentToast(''), 2000)
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Copy size={14} />
                      复制错误信息
                    </button>
                    <a
                      href="mailto:517290808@qq.com?subject=收款单导出异常反馈"
                      className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      联系管理员
                    </a>
                  </>
                )}
                <button
                  onClick={() => setPaymentError(null)}
                  className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 收款单导出：轻提示 */}
        {paymentToast && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-gray-800 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm whitespace-nowrap">
            {paymentToast}
          </div>
        )}
      </div>
  )
}