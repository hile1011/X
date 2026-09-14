import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Select as AntSelect } from 'antd'
import { api, downloadBlob } from '../api'
import { Search, Plus, Edit, Trash2, Eye, Filter, Calendar, Building, Clock, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Image, Copy, Download, Loader2, AlertCircle, Printer, Receipt, X, Sparkles } from 'lucide-react'
import { fetchStyleOptions, getStyleLabelFromProducts, type StyleOption } from '../services/productStyles'
import { OrderStatus } from '../constants/OrderStatus'
import { TooltipCell } from '../components/TooltipCell'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { PrintPreviewModal } from '../components/PrintPreviewModal'
import { usePermission } from '../hooks/usePermission'
import type { Product } from '../types'
import { copyText } from '../utils/clipboard'

export interface Quote {
  id: string
  user_id: string
  customer_id: string
  quote_number: string
  customerName: string
  shippingAddress: string
  productStyle: string
  productSpec: string
  fabricMaterial: string
  process: string
  handleMaterial: string
  handleSpec: string
  quantity: string
  boxSpec: string
  remark: string
  sampleFee: string
  sampleDays: string
  massDays: string
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  costPrice: number
  priceWithTax: number
  sellPriceNoTax: number
  sellPriceWithTax: number
  status: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  quoteTime: string
  sampleTime: string
  sampleCompletedTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
  /** 对账时间（V28 新增，状态8已对账） */
  reconciledTime?: string
  endTime: string
  images: string[]
  // 在线表格二维数据（用户编辑后的值）
  tableData?: (string | number | null)[][]
  // 用户已删除的公式地址列表
  removedFormulaAddresses?: string[]
  // 在线表格列宽配置（v34：[{key:列号,width:px}]，仅用户拖拽调整过的列；打印按布局输出）
  columnWidthConfig?: Array<{ key: number; width: number }>
  // 在线表格行高配置（v34：[{key:行号,height:px}]，仅用户拖拽调整过的行；打印按布局输出）
  rowHeightConfig?: Array<{ key: number; height: number }>
  created_at: string
  updated_at: string
}

// 订单状态选项统一使用 OrderStatus 枚举类，消除重复定义
const STATUS_OPTIONS = OrderStatus.getAll()

// 保留2位小数辅助函数：总额计算以保留2位小数的价格为基础（与订单编辑页 BagQuote 口径一致）
const round2 = (n: number) => Math.round(n * 100) / 100

interface GroupedQuotes {
  customerName: string
  expanded: boolean
  quotes: Quote[]
  visibleCount: number
}

// 生成分页页码序列：始终包含首页与末页，当前页前后各展示若干页，超出部分用省略号占位
// 例：current=1,total=20 → [1,2,3,'...',20]；current=10,total=20 → [1,'...',9,10,11,'...',20]
const getPageNumbers = (current: number, total: number): (number | 'ellipsis')[] => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages: (number | 'ellipsis')[] = [1]
  if (current > 3) pages.push('ellipsis')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (current < total - 2) pages.push('ellipsis')
  pages.push(total)
  return pages
}

// 订单列表查询条件持久化：离开列表页（进入详情/编辑）后返回时恢复查询条件
const QUOTES_FILTERS_KEY = 'quotes_filters'

interface SavedFilters {
  searchTerm: string
  statusFilters: string[]
  customerFilters: string[]
  styleFilter: string
  productionDateStart: string
  productionDateEnd: string
  currentPage: number
  pageSize: number
}

// 兼容旧版单选字符串（多选改造前 sessionStorage 中 statusFilter/customerFilter 为 string）
const toStringArray = (value: unknown, fallback: string[]): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string' && value) return [value]
  return fallback
}

const getInitialFilters = (): SavedFilters => {
  try {
    const saved = sessionStorage.getItem(QUOTES_FILTERS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      return {
        searchTerm: parsed.searchTerm ?? '',
        statusFilters: toStringArray(parsed.statusFilters ?? parsed.statusFilter, ['active']),
        customerFilters: toStringArray(parsed.customerFilters ?? parsed.customerFilter, []),
        styleFilter: parsed.styleFilter ?? '',
        productionDateStart: parsed.productionDateStart ?? '',
        productionDateEnd: parsed.productionDateEnd ?? '',
        currentPage: parsed.currentPage ?? 1,
        pageSize: parsed.pageSize ?? 20,
      }
    }
  } catch {
    // sessionStorage 不可用或数据损坏，使用默认值
  }
  return {
    searchTerm: '',
    statusFilters: ['active'],
    customerFilters: [],
    styleFilter: '',
    productionDateStart: '',
    productionDateEnd: '',
    currentPage: 1,
    pageSize: 20,
  }
}

export default function Quotes() {
  const initialFilters = getInitialFilters()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [groupedQuotes, setGroupedQuotes] = useState<GroupedQuotes[]>([])
  const [searchTerm, setSearchTerm] = useState(initialFilters.searchTerm)
  const [statusFilters, setStatusFilters] = useState<string[]>(initialFilters.statusFilters)
  const [customerFilters, setCustomerFilters] = useState<string[]>(initialFilters.customerFilters)
  const [styleFilter, setStyleFilter] = useState(initialFilters.styleFilter)
  // 做货日期范围筛选：值为 'YYYY-MM-DD' 字符串，空串表示未选
  const [productionDateStart, setProductionDateStart] = useState(initialFilters.productionDateStart)
  const [productionDateEnd, setProductionDateEnd] = useState(initialFilters.productionDateEnd)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [printTarget, setPrintTarget] = useState<Quote | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  // 收款单导出状态
  const [exportingPayment, setExportingPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<{ type: 'network' | 'server' | 'timeout' | 'toomany'; message: string; detail?: string } | null>(null)
  const [paymentToast, setPaymentToast] = useState<string>('')
  // 款式选项与产品列表：从产品管理模块动态获取
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  const [products, setProducts] = useState<Product[]>([])
  // 分页：每页条数可设置（默认 20），currentPage 从 1 开始
  const [pageSize, setPageSize] = useState(initialFilters.pageSize)
  const [currentPage, setCurrentPage] = useState(initialFilters.currentPage)
  const [filteredCount, setFilteredCount] = useState(0)
  // 筛选后的客户总数（以客户名称维度统计，一个客户下多条订单只算一个）
  const [filteredCustomerCount, setFilteredCustomerCount] = useState(0)
  // 筛选后订单的销售总额(含税)与利润总额（底部汇总）
  const [filteredTotals, setFilteredTotals] = useState({ revenue: 0, profitNoTax: 0, profitWithTax: 0 })
  // 订单图片标识（id -> 是否有图片），通过轻量级 API 获取
  const [imageFlags, setImageFlags] = useState<Record<string, boolean>>({})
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // 业绩明细筛选：从工作台双击业绩卡片跳转携带（month=YYYY-MM 或 year=YYYY）
  // 匹配工作台统计口径：状态为做货中/已发货未收款/已发货已收款，做货开始时间在对应月份/年度
  const [productionTimeFilter, setProductionTimeFilter] = useState<{ type: 'month' | 'year'; value: string } | null>(null)
  const { hasPermission } = usePermission()
  // 双击快捷编辑：quick-edit 是 edit 的增强开关，需同时持有两权限才生效（不绕过编辑权限）
  const canQuickEdit = hasPermission('quotes:quick-edit') && hasPermission('quotes:edit')
  // 跳过首次挂载的筛选重置（从 sessionStorage 恢复时不重置页码）
  const isInitialMount = useRef(true)
  // 列表滚动容器引用：保存/恢复滚动位置
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollRestoreRef = useRef<number | null>(null)

  useEffect(() => {
    // 从 sessionStorage 恢复滚动位置
    try {
      const savedScroll = sessionStorage.getItem('quotes_scroll')
      if (savedScroll) {
        scrollRestoreRef.current = parseInt(savedScroll, 10)
        sessionStorage.removeItem('quotes_scroll')
      }
    } catch { /* ignore */ }
    fetchQuotes()
    fetchStyleOptions().then(setStyleOptions)
    api.products.getAll().then((data: Product[]) => setProducts(data))
  }, [])

  // 查询条件持久化：变化时保存到 sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(QUOTES_FILTERS_KEY, JSON.stringify({
        searchTerm,
        statusFilters,
        customerFilters,
        styleFilter,
        productionDateStart,
        productionDateEnd,
        currentPage,
        pageSize,
      }))
    } catch {
      // sessionStorage 不可用，忽略
    }
  }, [searchTerm, statusFilters, customerFilters, styleFilter, productionDateStart, productionDateEnd, currentPage, pageSize])

  // 从 URL 读取业绩明细筛选条件（工作台双击业绩卡片跳转携带）
  useEffect(() => {
    const month = searchParams.get('month')
    const year = searchParams.get('year')
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      setProductionTimeFilter({ type: 'month', value: month })
    } else if (year && /^\d{4}$/.test(year)) {
      setProductionTimeFilter({ type: 'year', value: year })
    } else {
      setProductionTimeFilter(null)
    }
  }, [searchParams])

  // 筛选条件变化时重置到第 1 页（跳过首次挂载，避免覆盖从 sessionStorage 恢复的页码）
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    setCurrentPage(1)
  }, [searchTerm, statusFilters, customerFilters, styleFilter, productionDateStart, productionDateEnd])

  useEffect(() => {
    groupQuotes()
  }, [quotes, searchTerm, statusFilters, customerFilters, styleFilter, productionDateStart, productionDateEnd, products, currentPage, pageSize, productionTimeFilter])

  // 组件卸载时保存滚动位置（用户导航到详情/编辑页时触发）
  useEffect(() => {
    return () => {
      try {
        if (scrollContainerRef.current) {
          sessionStorage.setItem('quotes_scroll', String(scrollContainerRef.current.scrollTop))
        }
      } catch { /* ignore */ }
    }
  }, [])

  // 数据加载并渲染完成后恢复滚动位置
  useEffect(() => {
    if (scrollRestoreRef.current !== null && !loading) {
      const targetScroll = scrollRestoreRef.current
      scrollRestoreRef.current = null
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = targetScroll
        }
      })
    }
  }, [groupedQuotes, loading])

  const fetchQuotes = async () => {
    setLoading(true)
    try {
      const [data, flags] = await Promise.all([
        api.quotes.getAll(),
        api.quotes.getImageFlags(),
      ])
      setQuotes(data)
      setImageFlags(flags || {})
    } catch (error) {
      console.error('获取订单列表失败:', error)
      setQuotes([])
    }
    setLoading(false)
  }

  // 筛选逻辑（不含分页）：返回所有符合条件的订单
  const getFilteredQuotes = () => {
    return quotes.filter((quote) => {
      const matchesSearch =
        quote.quote_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getStyleLabelFromProducts(products, quote.productStyle).toLowerCase().includes(searchTerm.toLowerCase())

      // 多选状态筛选：空数组 = 全部状态；'active' = 进行中（除已取消外的全部）；其余为具体状态值，任一命中即匹配
      const matchesStatus =
        statusFilters.length === 0 ||
        statusFilters.some((filter) =>
          filter === 'active' ? quote.status !== 6 : quote.status === parseInt(filter)
        )

      // 多选客户筛选：空数组 = 不筛选；否则订单客户名需与任一选中客户名匹配（忽略大小写）
      const matchesCustomer =
        customerFilters.length === 0 ||
        customerFilters.some((name) =>
          quote.customerName.toLowerCase() === name.toLowerCase()
        )

      const matchesStyle = !styleFilter ||
        quote.productStyle === styleFilter ||
        getStyleLabelFromProducts(products, quote.productStyle) === getStyleLabelFromProducts(products, styleFilter)

      // 业绩明细筛选（从工作台双击业绩卡片跳转）：状态为做货中/已发货未收款/已发货已收款/已对账，
      // 做货开始时间在对应月份/年度，与工作台统计口径一致（已对账订单仍计入业绩）
      const matchesProductionTime = (() => {
        if (!productionTimeFilter) return true
        if (![3, 4, 5, 8].includes(quote.status)) return false
        const productionDate = new Date(quote.productionStartTime || quote.productionTimeStart)
        if (isNaN(productionDate.getTime())) return false
        if (productionTimeFilter.type === 'month') {
          const [y, m] = productionTimeFilter.value.split('-')
          const year = parseInt(y)
          const month = parseInt(m) - 1
          const monthStart = new Date(year, month, 1)
          const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
          return productionDate >= monthStart && productionDate <= monthEnd
        } else {
          const year = parseInt(productionTimeFilter.value)
          const yearStart = new Date(year, 0, 1)
          const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999)
          return productionDate >= yearStart && productionDate <= yearEnd
        }
      })()

      // 做货日期范围筛选：基于做货开始时间(productionStartTime || productionTimeStart)
      // 仅设置开始日期 -> 筛选该日期及之后的订单；仅设置结束日期 -> 筛选该日期及之前的订单；
      // 同时设置 -> 筛选区间内的订单（区间两端包含当天）；均未设置 -> 不筛选
      const matchesProductionDateRange = (() => {
        if (!productionDateStart && !productionDateEnd) return true
        const productionDateStr = quote.productionStartTime || quote.productionTimeStart
        if (!productionDateStr) return false
        const productionDate = new Date(productionDateStr)
        if (isNaN(productionDate.getTime())) return false
        if (productionDateStart) {
          const start = new Date(productionDateStart)
          start.setHours(0, 0, 0, 0)
          if (productionDate < start) return false
        }
        if (productionDateEnd) {
          const end = new Date(productionDateEnd)
          end.setHours(23, 59, 59, 999)
          if (productionDate > end) return false
        }
        return true
      })()

      return matchesSearch && matchesStatus && matchesCustomer && matchesStyle && matchesProductionTime && matchesProductionDateRange
    })
  }

  const groupQuotes = () => {
    const filtered = getFilteredQuotes()

    // 记录筛选后订单总数（用于导出等场景）
    setFilteredCount(filtered.length)

    // 计算当前筛选数据的销售总额与利润总额（销售额统一含税口径，与年度报表一致；利润保留不含税/含税双口径）
    let revenue = 0
    let profitNoTax = 0
    let profitWithTax = 0
    filtered.forEach((quote) => {
      const qty = parseFloat(quote.quantity) || 0
      const sellNoTax = round2(quote.sellPriceNoTax || 0)
      const cost = round2(quote.costPrice || 0)
      const sellWithTax = round2(quote.sellPriceWithTax || 0)
      const priceWithTax = round2(quote.priceWithTax || 0)
      // 销售总额(含税) = round2(round2(sellPriceWithTax) * qty)
      revenue += round2(sellWithTax * qty)
      // 利润总额(不含税) = round2(round2(round2(sellNoTax) - round2(cost)) * qty)
      profitNoTax += round2(round2(sellNoTax - cost) * qty)
      // 利润(含税) = round2(round2(round2(sellWithTax) - round2(priceWithTax)) * qty)
      profitWithTax += round2(round2(sellWithTax - priceWithTax) * qty)
    })
    setFilteredTotals({
      revenue: round2(revenue),
      profitNoTax: round2(profitNoTax),
      profitWithTax: round2(profitWithTax),
    })

    // 先按客户名称分组（一个客户下多条订单归为一组）
    const grouped: Record<string, Quote[]> = {}
    filtered.forEach((quote) => {
      if (!grouped[quote.customerName]) {
        grouped[quote.customerName] = []
      }
      grouped[quote.customerName].push(quote)
    })

    // 所有客户分组（保持插入顺序），每组默认显示前 5 条订单
    const allGroups = Object.entries(grouped).map(([customerName, quotes]) => ({
      customerName,
      expanded: true,
      quotes,
      visibleCount: 5,
    }))

    // 客户总数（客户名称维度去重）
    const customerCount = allGroups.length
    setFilteredCustomerCount(customerCount)

    // 边界保护：当前页超出总页数时自动修正到最后一页
    const maxPage = Math.max(1, Math.ceil(customerCount / pageSize))
    const safePage = Math.min(currentPage, maxPage)
    if (safePage !== currentPage) {
      setCurrentPage(safePage)
      return // 修正后由 useEffect 重新触发，避免用越界页码计算分页
    }

    // 按客户维度分页：每页显示 pageSize 个客户（而非 pageSize 条订单）
    const startIndex = (safePage - 1) * pageSize
    const paginatedGroups = allGroups.slice(startIndex, startIndex + pageSize)

    setGroupedQuotes(paginatedGroups)
  }

  const toggleGroup = (customerName: string) => {
    setGroupedQuotes((prev) =>
      prev.map((group) =>
        group.customerName === customerName
          ? { ...group, expanded: !group.expanded }
          : group
      )
    )
  }

  const showMore = (customerName: string) => {
    setGroupedQuotes((prev) =>
      prev.map((group) =>
        group.customerName === customerName
          ? { ...group, visibleCount: group.visibleCount + 5 }
          : group
      )
    )
  }

  const handleDelete = async (id: string) => {
    await api.quotes.delete(id)
    fetchQuotes()
  }

  const handleCopy = async (id: string) => {
    try {
      const copied = await api.quotes.copy(id)
      if (copied?.id) {
        navigate(`/quotes/${copied.id}/edit`)
      } else {
        fetchQuotes()
      }
    } catch (error) {
      console.error('复制订单失败:', error)
    }
  }

  // 导出当前筛选结果到 Excel
  const handleExport = async () => {
    setExporting(true)
    setExportError('')
    try {
      // 收集当前筛选后的所有订单 ID（不限分页）
      const orderIds = getFilteredQuotes().map((q) => q.id)
      if (orderIds.length === 0) {
        setExportError('没有可导出的订单')
        setExporting(false)
        return
      }
      const blob = await api.export.orders(orderIds)
      const now = new Date()
      const ts = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      downloadBlob(blob, `OrderExport_${ts}.xlsx`)
      setShowExportDialog(false)
    } catch (error) {
      console.error('导出失败:', error)
      setExportError(error instanceof Error ? error.message : '导出失败，请重试')
    }
    setExporting(false)
  }

  // 导出收款单：仅"已发货未收款"(status=4) 订单，按当前筛选条件全量导出
  const handleExportPaymentReceipt = async () => {
    setPaymentError(null)
    setPaymentToast('')
    // 收集当前筛选条件下、状态严格为 4 的订单（不限分页）
    const paymentOrders = getFilteredQuotes().filter((q) => q.status === 4)
    if (paymentOrders.length === 0) {
      setPaymentToast('当前筛选条件下无符合“已发货未收款”状态的订单数据')
      setTimeout(() => setPaymentToast(''), 3000)
      return
    }
    if (paymentOrders.length > 1000) {
      setPaymentError({
        type: 'toomany',
        message: `符合条件的数据共 ${paymentOrders.length} 条，超过单次导出上限 1000 条，请缩小筛选范围或分批导出`,
      })
      return
    }
    setExportingPayment(true)
    try {
      const { blob, filename } = await api.export.paymentReceipts(
        paymentOrders.map((q) => q.id),
        customerFilters.join(','),
      )
      downloadBlob(blob, filename)
    } catch (error) {
      const e = error as Error & { timeout?: boolean; code?: string }
      if (e.code === 'NO_DATA') {
        setPaymentToast('当前筛选条件下无符合“已发货未收款”状态的订单数据')
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

  const getStatusColor = (status: number) => {
    switch (status) {
      case 1: return 'bg-blue-100 text-blue-700'
      case 2: return 'bg-yellow-100 text-yellow-700'
      case 7: return 'bg-cyan-100 text-cyan-700'
      case 3: return 'bg-purple-100 text-purple-700'
      case 4: return 'bg-orange-100 text-orange-700'
      case 5: return 'bg-green-100 text-green-700'
      case 8: return 'bg-teal-100 text-teal-700'
      case 6: return 'bg-gray-100 text-gray-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getStatusLabel = (status: number) => {
    const option = STATUS_OPTIONS.find((o) => o.value === status)
    return option ? option.label : '未知'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('zh-CN')
  }

  const getProductionDeadline = (quote: Quote) => {
    if (!quote.productionTimeEnd) return '-'
    return formatDate(quote.productionTimeEnd)
  }

  const getCustomerNames = () => {
    const names = [...new Set(quotes.map((q) => q.customerName))]
    return names.sort()
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col min-h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-3.5rem)] md:h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">订单管理</h1>
          <p className="text-gray-500 mt-1">管理所有订单</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {hasPermission('quotes:export') && (
            <button
              onClick={() => { setExportError(''); setShowExportDialog(true) }}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 border border-primary-200 text-primary-700 bg-white rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              导出 Excel
            </button>
          )}
          {hasPermission('quotes:export-payment') && (
            <button
              onClick={handleExportPaymentReceipt}
              disabled={exportingPayment}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="导出当前筛选条件下“已发货未收款”订单的收款单（Excel/ZIP）"
            >
              {exportingPayment ? <Loader2 size={18} className="animate-spin" /> : <Receipt size={18} />}
              导出收款单
            </button>
          )}
          {hasPermission('ai-order:view') && (
            <button
              onClick={() => navigate('/ai-order-chat')}
              className="flex items-center gap-2 px-4 py-2 border border-primary-200 text-primary-700 bg-white rounded-lg hover:bg-primary-50 transition-colors"
              title="通过文字描述与参考图片，AI 智能生成订单信息"
            >
              <Sparkles size={18} />
              AI智能下单
            </button>
          )}
          {hasPermission('quotes:create') && (
            <button
              onClick={() => navigate('/quotes/new')}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus size={20} />
              新增订单
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-[60vh] flex-none sm:flex-1 sm:min-h-0">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-4 flex-shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索客户/款式/订单号..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            {/* 客户名称多选筛选：支持输入关键字实时模糊检索 + 下拉多选 */}
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
                options={getCustomerNames().map((name) => ({ value: name, label: name }))}
                maxTagCount="responsive"
                popupClassName="quotes-multi-select-dropdown"
                className="quotes-multi-select"
                style={{ width: '100%' }}
              />
            </div>
            <div className="relative">
              <Eye className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none appearance-none cursor-pointer"
              >
                <option value="">款式</option>
                {styleOptions.map((style) => (
                  <option key={style.value} value={style.value}>{style.label}</option>
                ))}
              </select>
            </div>
            {/* 订单状态多选筛选：'active' = 进行中（除已取消外全部），具体状态任选多个；空 = 全部状态 */}
            <div className="relative quotes-filter-wrap">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
              <AntSelect
                mode="multiple"
                allowClear
                value={statusFilters}
                onChange={(values: string[]) => setStatusFilters(values)}
                placeholder="全部状态（可多选）"
                options={[
                  { value: 'active', label: '进行中' },
                  ...STATUS_OPTIONS.map((option) => ({ value: String(option.value), label: option.label })),
                ]}
                maxTagCount="responsive"
                popupClassName="quotes-multi-select-dropdown"
                className="quotes-multi-select"
                style={{ width: '100%' }}
              />
            </div>
            {/* 做货日期范围筛选：基于做货开始时间，支持单日期或日期范围 */}
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <div className="w-full pl-9 pr-1 py-1 border border-gray-200 rounded-lg flex items-center gap-1 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
                <input
                  type="date"
                  value={productionDateStart}
                  onChange={(e) => setProductionDateStart(e.target.value)}
                  title="做货开始日期（起）"
                  className="flex-1 min-w-0 px-1 py-1 text-sm text-gray-700 outline-none bg-transparent"
                />
                <span className="text-gray-400 text-xs">至</span>
                <input
                  type="date"
                  value={productionDateEnd}
                  onChange={(e) => setProductionDateEnd(e.target.value)}
                  title="做货开始日期（止）"
                  className="flex-1 min-w-0 px-1 py-1 text-sm text-gray-700 outline-none bg-transparent"
                />
                {(productionDateStart || productionDateEnd) && (
                  <button
                    onClick={() => { setProductionDateStart(''); setProductionDateEnd('') }}
                    className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title="清除做货日期筛选"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center flex-1 flex items-center justify-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="text-gray-500 mt-4">加载中...</p>
          </div>
        ) : (
          <>
          {productionTimeFilter && (
            <div className="flex items-center gap-2 px-4 py-2 bg-primary-50 border-b border-primary-200 flex-shrink-0">
              <Calendar size={14} className="text-primary-600" />
              <span className="text-sm font-medium text-primary-700">
                {productionTimeFilter.type === 'month'
                  ? `${productionTimeFilter.value.split('-')[0]}年${parseInt(productionTimeFilter.value.split('-')[1])}月业绩明细`
                  : `${productionTimeFilter.value}年业绩明细`}
              </span>
              <span className="text-xs text-primary-500">· 做货中/已发货订单</span>
              <button
                onClick={() => { setSearchParams({}); setProductionTimeFilter(null) }}
                className="ml-auto flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 px-2 py-1 rounded hover:bg-primary-100 transition-colors"
              >
                <X size={12} />
                清除筛选
              </button>
            </div>
          )}
          <div ref={scrollContainerRef} className="flex-1 overflow-auto min-h-0">
            <div className="min-w-[2200px]">
              {/* 表头 */}
              <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <div className="flex">
                  <div className="w-16 px-4 py-3 flex-shrink-0"></div>
                  <div className="w-44 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单号</div>
                  <div className="w-40 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">款式</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">产品规格</div>
                  <div className="w-24 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">数量</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">面料</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">工艺</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单状态</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(不含税)</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(含税)</div>
                  <div className="w-28 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">成本价</div>
                  <div className="w-28 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">含税价</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">利润(不含税)</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">利润(含税)</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0" title="数量 × 卖价(含税)">销售总额(含税)</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0" title="数量 × 利润(不含税)">利润总额</div>
                  <div className="w-44 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">做货到期时间</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">创建日期</div>
                  <div className="w-56 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0 sticky right-0 bg-gray-50 z-20 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">操作</div>
                </div>
              </div>

              {/* 父子列表 */}
              <div className="divide-y divide-gray-100">
                {groupedQuotes.map((group) => (
                  <div key={group.customerName}>
                    {/* 父行 - 客户名称 */}
                    <div
                      className="flex items-center hover:bg-gray-50 cursor-pointer transition-colors bg-gray-50/50"
                      onClick={() => toggleGroup(group.customerName)}
                    >
                      <div className="w-16 px-4 py-4 flex-shrink-0 flex items-center justify-center">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                          {group.customerName.charAt(0)}
                        </div>
                      </div>
                      <div className="flex-1 px-4 py-4">
                        <div className="flex items-center gap-3">
                          {group.expanded ? (
                            <ChevronUp size={20} className="text-gray-400" />
                          ) : (
                            <ChevronDown size={20} className="text-gray-400" />
                          )}
                          <span className="text-lg font-semibold text-gray-800">{group.customerName}</span>
                          <span className="text-sm text-gray-500">({group.quotes.length}个订单)</span>
                        </div>
                      </div>
                      <div className="w-56 px-4 py-4 flex-shrink-0 sticky right-0 bg-gray-50/50 z-20 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]"></div>
                    </div>

                    {/* 子行 - 订单详情（每组默认显示前 5 条，可展开更多） */}
                    {group.expanded &&
                      group.quotes.slice(0, group.visibleCount).map((quote) => {
                        return (
                          <div
                            key={quote.id}
                            className="flex items-center hover:bg-gray-50 cursor-pointer transition-colors"
                            onDoubleClick={() => navigate(canQuickEdit ? `/quotes/${quote.id}/edit` : `/quotes/${quote.id}`)}
                            title={canQuickEdit ? '双击进入编辑模式' : '双击查看订单详情'}
                          >
                            {/* 产品图 */}
                            <div className="w-16 px-4 py-4 flex-shrink-0 flex items-center justify-center">
                              {imageFlags[quote.id] ? (
                                <img
                                  src={api.quotes.getThumbnailUrl(quote.id, quote.updated_at)}
                                  alt="产品图"
                                  loading="lazy"
                                  className="w-10 h-10 rounded-lg object-cover border border-gray-200"
                                  onError={(e) => {
                                    const target = e.currentTarget
                                    target.style.display = 'none'
                                    const placeholder = target.nextElementSibling as HTMLElement
                                    if (placeholder) placeholder.style.display = 'flex'
                                  }}
                                />
                              ) : null}
                              {(!imageFlags[quote.id]) && (
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                                  <Image className="text-gray-400" size={18} />
                                </div>
                              )}
                              {/* onError 时的占位符（默认隐藏） */}
                              <div className="w-10 h-10 rounded-lg bg-gray-100 items-center justify-center" style={{ display: 'none' }}>
                                <Image className="text-gray-400" size={18} />
                              </div>
                            </div>

                            {/* 订单号（16位随机数字，创建后不变） */}
                            <TooltipCell
                              className="w-44 px-4 py-4 text-gray-600 text-sm font-mono"
                              tooltip={quote.quote_number}
                            >
                              {quote.quote_number}
                            </TooltipCell>

                            {/* 款式 */}
                            <TooltipCell
                              className="w-40 px-4 py-4 text-gray-600 text-sm"
                              tooltip={getStyleLabelFromProducts(products, quote.productStyle)}
                            >
                              {getStyleLabelFromProducts(products, quote.productStyle)}
                            </TooltipCell>

                            {/* 产品规格 */}
                            <TooltipCell
                              className="w-36 px-4 py-4 text-gray-600 text-sm"
                              tooltip={quote.productSpec ? `${quote.productSpec}CM` : ''}
                            >
                              {quote.productSpec}{quote.productSpec ? 'CM' : ''}
                            </TooltipCell>

                            {/* 数量 */}
                            <div className="w-24 px-4 py-4 flex-shrink-0 text-gray-600 text-sm">
                              {quote.quantity}{quote.quantity ? '个' : ''}
                            </div>

                            {/* 面料 */}
                            <TooltipCell
                              className="w-32 px-4 py-4 text-gray-600 text-sm"
                              tooltip={quote.fabricMaterial}
                            >
                              {quote.fabricMaterial}
                            </TooltipCell>

                            {/* 工艺 */}
                            <TooltipCell
                              className="w-32 px-4 py-4 text-gray-600 text-sm"
                              tooltip={quote.process}
                            >
                              {quote.process}
                            </TooltipCell>

                            {/* 订单状态 */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span
                                className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(quote.status)}`}
                              >
                                {getStatusLabel(quote.status)}
                              </span>
                            </div>

                            {/* 卖价(不含税) */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span className="text-primary-600 font-semibold text-sm">
                                ¥{(quote.sellPriceNoTax || 0).toFixed(2)}
                              </span>
                            </div>

                            {/* 卖价(含税) */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span className="text-primary-600 font-semibold text-sm">
                                ¥{(quote.sellPriceWithTax || 0).toFixed(2)}
                              </span>
                            </div>

                            {/* 成本价 */}
                            <div className="w-28 px-4 py-4 flex-shrink-0">
                              <span className="text-gray-600 font-medium text-sm">
                                ¥{(quote.costPrice || 0).toFixed(2)}
                              </span>
                            </div>

                            {/* 含税价 */}
                            <div className="w-28 px-4 py-4 flex-shrink-0">
                              <span className="text-gray-700 font-medium text-sm">
                                ¥{(quote.priceWithTax || 0).toFixed(2)}
                              </span>
                            </div>

                            {/* 利润(不含税) = 卖价不含税 - 成本价 */}
                            <div className="w-32 px-4 py-4 flex-shrink-0">
                              <span className={`font-semibold text-sm ${((quote.sellPriceNoTax || 0) - (quote.costPrice || 0)) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ¥{((quote.sellPriceNoTax || 0) - (quote.costPrice || 0)).toFixed(2)}
                              </span>
                            </div>

                            {/* 利润(含税) = 卖价含税 - 含税价 */}
                            <div className="w-32 px-4 py-4 flex-shrink-0">
                              <span className={`font-semibold text-sm ${((quote.sellPriceWithTax || 0) - (quote.priceWithTax || 0)) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ¥{((quote.sellPriceWithTax || 0) - (quote.priceWithTax || 0)).toFixed(2)}
                              </span>
                            </div>

                            {/* 销售总额 = 数量 × 卖价(含税)，以保留2位小数的卖价为计算基础（与年度报表销售额口径一致） */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span className="text-primary-600 font-semibold text-sm">
                                ¥{round2(round2(quote.sellPriceWithTax || 0) * (parseFloat(quote.quantity) || 0)).toFixed(2)}
                              </span>
                            </div>

                            {/* 利润总额 = 数量 × 单个利润(不含税)，以保留2位小数的单个利润为计算基础 */}
                            <div className="w-32 px-4 py-4 flex-shrink-0">
                              <span className={`font-semibold text-sm ${round2(round2(round2(quote.sellPriceNoTax || 0) - round2(quote.costPrice || 0)) * (parseFloat(quote.quantity) || 0)) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                                ¥{round2(round2(round2(quote.sellPriceNoTax || 0) - round2(quote.costPrice || 0)) * (parseFloat(quote.quantity) || 0)).toFixed(2)}
                              </span>
                            </div>

                            {/* 做货到期时间 */}
                            <div className="w-44 px-4 py-4 flex-shrink-0">
                              <div className="flex items-center gap-2">
                                <Clock className="text-gray-400" size={14} />
                                <span className="text-gray-500 text-sm truncate">
                                  {getProductionDeadline(quote)}
                                </span>
                              </div>
                            </div>

                            {/* 创建日期 */}
                            <div className="w-32 px-4 py-4 flex-shrink-0">
                              <div className="flex items-center gap-2">
                                <Calendar className="text-gray-400" size={14} />
                                <span className="text-gray-500 text-sm">
                                  {formatDate(quote.created_at)}
                                </span>
                              </div>
                            </div>

                            {/* 操作 - 固定列 */}
                            <div className="w-56 px-4 py-4 flex-shrink-0 sticky right-0 bg-white z-20 hover:bg-gray-50 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">
                              <div className="flex items-center gap-2">
                                {hasPermission('quotes:edit') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      navigate(`/quotes/${quote.id}/edit`)
                                    }}
                                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                    title="编辑"
                                  >
                                    <Edit size={16} />
                                  </button>
                                )}
                                {hasPermission('quotes:copy') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleCopy(quote.id)
                                    }}
                                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                    title="复制订单"
                                  >
                                    <Copy size={16} />
                                  </button>
                                )}
                                {hasPermission('quotes:print') && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      // 打印需要完整数据（含 images），通过 getById 获取
                                      const fullQuote = await api.quotes.getById(quote.id)
                                      setPrintTarget(fullQuote || quote)
                                    }}
                                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                    title="打印订单"
                                  >
                                    <Printer size={16} />
                                  </button>
                                )}
                                {hasPermission('quotes:delete') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setDeleteTarget(quote.id)
                                    }}
                                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="删除"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    {/* 显示更多按钮：订单数超过当前可见数时显示 */}
                    {group.expanded && group.quotes.length > group.visibleCount && (
                      <div
                        className="flex justify-center py-2 border-b border-gray-100 bg-gray-50/30"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => showMore(group.customerName)}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          <ChevronDown size={14} />
                          显示更多（剩余 {group.quotes.length - group.visibleCount} 条）
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {groupedQuotes.length === 0 && (
                <div className="p-8 text-center">
                  <p className="text-gray-500">
                    {(searchTerm || statusFilters.length > 0 || customerFilters.length > 0 || styleFilter || productionDateStart || productionDateEnd || productionTimeFilter)
                      ? '没有符合当前查询条件的订单，请调整筛选条件后重试'
                      : '暂无订单记录'}
                  </p>
                </div>
              )}
            </div>
          </div>

            {/* 分页控制：移出滚动区作为固定底部页脚，避免与操作列(sticky right-0)在右下角视觉重叠 */}
            {filteredCustomerCount > 0 && (() => {
              // 页数统计基于客户总数（与底部汇总口径一致）
              const totalPages = Math.max(1, Math.ceil(filteredCustomerCount / pageSize))
              const pageNumbers = getPageNumbers(currentPage, totalPages)
              return (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-t border-gray-200 bg-white flex-shrink-0">
                  {/* 左侧：客户统计 + 订单统计 + 每页条数设置 */}
                  <div className="flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                    <span>
                      客户总数 <span className="font-semibold text-gray-800">{filteredCustomerCount}</span> 个
                    </span>
                    <span className="text-gray-300">·</span>
                    <span>
                      当前页 <span className="font-semibold text-primary-600">{groupedQuotes.length}</span> 个
                    </span>
                    <span className="text-gray-300">·</span>
                    <span>
                      订单总数 <span className="font-semibold text-gray-800">{filteredCount}</span> 个
                    </span>
                    <span className="text-gray-300">·</span>
                    <span>
                      当前页订单 <span className="font-semibold text-primary-600">{groupedQuotes.reduce((sum, g) => sum + Math.min(g.visibleCount, g.quotes.length), 0)}</span> 个
                    </span>
                    <span className="text-gray-300">·</span>
                    <span>
                      第 <span className="font-semibold text-primary-600">{currentPage}</span> / {totalPages} 页
                    </span>
                    <span className="text-gray-300">·</span>
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">每页</span>
                      <select
                        value={pageSize}
                        onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
                        className="px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none cursor-pointer bg-white"
                        title="设置每页显示客户数"
                      >
                        {[10, 20, 50, 100].map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <span className="text-gray-500">个客户</span>
                    </div>
                    <span className="text-gray-300">·</span>
                    <span>
                      销售总额(含税) <span className="font-semibold text-gray-800">¥{filteredTotals.revenue.toLocaleString()}</span>
                    </span>
                    <span className="text-gray-300">·</span>
                    <span>
                      利润总额(不含税) <span className="font-semibold text-red-600">¥{filteredTotals.profitNoTax.toLocaleString()}</span>
                    </span>
                    <span className="text-gray-300">·</span>
                    <span>
                      利润(含税) <span className="font-semibold text-green-600">¥{filteredTotals.profitWithTax.toLocaleString()}</span>
                    </span>
                  </div>
                  {/* 右侧：页码导航 + 跳转 */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      {/* 上一页：整合为左侧箭头 */}
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center border border-gray-200 text-gray-700 rounded-lg hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-200 disabled:hover:text-gray-700"
                        title="上一页"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      {/* 页码：点击直接设置当前页 */}
                      {pageNumbers.map((p, i) =>
                        p === 'ellipsis' ? (
                          <span key={`ellipsis-${i}`} className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center text-sm text-gray-400 select-none">…</span>
                        ) : (
                          <button
                            key={`page-${p}`}
                            onClick={() => setCurrentPage(p)}
                            className={`w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center text-sm rounded-lg transition-colors ${
                              p === currentPage
                                ? 'bg-primary-600 text-white border border-primary-600 font-semibold'
                                : 'border border-gray-200 text-gray-700 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                      {/* 下一页：整合为右侧箭头 */}
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                        className="w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center border border-gray-200 text-gray-700 rounded-lg hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-200 disabled:hover:text-gray-700"
                        title="下一页"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    {/* 跳转：直接输入页码设置 */}
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <span>跳至</span>
                        <input
                          key={`jump-${currentPage}`}
                          type="number"
                          min={1}
                          max={totalPages}
                          defaultValue={currentPage}
                          className="w-12 px-2 py-1 text-center text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return
                            const v = parseInt(e.currentTarget.value, 10)
                            if (!isNaN(v)) setCurrentPage(Math.min(totalPages, Math.max(1, v)))
                            e.currentTarget.blur()
                          }}
                          onBlur={(e) => {
                            const v = parseInt(e.currentTarget.value, 10)
                            if (!isNaN(v)) setCurrentPage(Math.min(totalPages, Math.max(1, v)))
                          }}
                        />
                        <span>页</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>

      {deleteTarget && (
        <DeleteConfirmDialog
          entityId={deleteTarget}
          entityLabel="报价"
          deleteFn={handleDelete}
          deleteCheckFn={(id) => api.quotes.deleteCheck(id)}
          onDeleted={() => fetchQuotes()}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {showExportDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <Download className="text-primary-600" size={20} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">导出订单到 Excel</h3>
                <p className="text-sm text-gray-500">将当前筛选结果导出为 Excel 文件</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">导出范围</span>
                <span className="font-semibold text-gray-800">当前筛选结果</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-gray-600">订单数量</span>
                <span className="font-semibold text-primary-600">
                  {filteredCount} 个
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-gray-600">包含内容</span>
                <span className="text-gray-800 text-xs">订单全部字段 · 状态标签 · 价格信息 · 汇总统计</span>
              </div>
            </div>

            {exportError && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="text-red-500 flex-shrink-0" size={16} />
                <span className="text-sm text-red-600">{exportError}</span>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowExportDialog(false); setExportError('') }}
                disabled={exporting}
                className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || filteredCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    导出中...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    确认导出
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {printTarget && (
        <PrintPreviewModal
          quote={printTarget}
          styleLabel={getStyleLabelFromProducts(products, printTarget.productStyle)}
          onClose={() => setPrintTarget(null)}
        />
      )}

      {/* 收款单导出：全屏半透明遮罩 + 加载动画 */}
      {exportingPayment && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center">
          <div className="bg-white rounded-xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
            <Loader2 size={40} className="animate-spin text-primary-600" />
            <p className="text-gray-700 font-medium">数据导出中，请稍候...</p>
          </div>
        </div>
      )}

      {/* 收款单导出：错误弹窗（网络/服务器/超时/超量） */}
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
                        copyText(text).then((ok) => {
                          setPaymentToast(ok ? '错误信息已复制到剪贴板' : '复制失败，请手动选择文本复制')
                          setTimeout(() => setPaymentToast(''), 2000)
                        })
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

      {/* 收款单导出：轻提示（无数据 / 复制成功，自动消失） */}
      {paymentToast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-gray-800 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm whitespace-nowrap">
          {paymentToast}
        </div>
      )}
    </div>
  )
}