import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, downloadBlob } from '../api'
import { Search, Plus, Edit, Trash2, Eye, Filter, Calendar, Building, Clock, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Image, Copy, Download, Loader2, AlertCircle, Printer, Receipt, X } from 'lucide-react'
import { fetchStyleOptions, getStyleLabelFromProducts, type StyleOption } from '../services/productStyles'
import { OrderStatus } from '../constants/OrderStatus'
import { TooltipCell } from '../components/TooltipCell'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { PrintPreviewModal } from '../components/PrintPreviewModal'
import { usePermission } from '../hooks/usePermission'
import type { Product } from '../types'

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
  status: 1 | 2 | 3 | 4 | 5 | 6 | 7
  quoteTime: string
  sampleTime: string
  sampleCompletedTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
  endTime: string
  images: string[]
  // 在线表格二维数据（用户编辑后的值）
  tableData?: (string | number | null)[][]
  // 用户已删除的公式地址列表
  removedFormulaAddresses?: string[]
  created_at: string
  updated_at: string
}

// 订单状态选项统一使用 OrderStatus 枚举类，消除重复定义
const STATUS_OPTIONS = OrderStatus.getAll()

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

export default function Quotes() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [groupedQuotes, setGroupedQuotes] = useState<GroupedQuotes[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [customerFilter, setCustomerFilter] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
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
  const [pageSize, setPageSize] = useState(20)
  const [currentPage, setCurrentPage] = useState(1)
  const [filteredCount, setFilteredCount] = useState(0)
  // 筛选后的客户总数（以客户名称维度统计，一个客户下多条订单只算一个）
  const [filteredCustomerCount, setFilteredCustomerCount] = useState(0)
  // 订单图片标识（id -> 是否有图片），通过轻量级 API 获取
  const [imageFlags, setImageFlags] = useState<Record<string, boolean>>({})
  const navigate = useNavigate()
  const { hasPermission } = usePermission()

  useEffect(() => {
    fetchQuotes()
    fetchStyleOptions().then(setStyleOptions)
    api.products.getAll().then((data: Product[]) => setProducts(data))
  }, [])

  // 筛选条件变化时重置到第 1 页
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, statusFilter, customerFilter, styleFilter])

  useEffect(() => {
    groupQuotes()
  }, [quotes, searchTerm, statusFilter, customerFilter, styleFilter, products, currentPage, pageSize])

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

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && quote.status !== 6) ||
        quote.status === parseInt(statusFilter)

      const matchesCustomer = !customerFilter ||
        quote.customerName.toLowerCase().includes(customerFilter.toLowerCase())

      const matchesStyle = !styleFilter ||
        quote.productStyle === styleFilter ||
        getStyleLabelFromProducts(products, quote.productStyle) === getStyleLabelFromProducts(products, styleFilter)

      return matchesSearch && matchesStatus && matchesCustomer && matchesStyle
    })
  }

  const groupQuotes = () => {
    const filtered = getFilteredQuotes()

    // 记录筛选后订单总数（用于导出等场景）
    setFilteredCount(filtered.length)

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
      await api.quotes.copy(id)
      fetchQuotes()
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
        customerFilter,
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">
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
            <div className="relative">
              <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={customerFilter}
                onChange={(e) => setCustomerFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none appearance-none cursor-pointer"
              >
                <option value="">客户名称</option>
                {getCustomerNames().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
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
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none appearance-none cursor-pointer"
              >
                <option value="all">全部状态</option>
                <option value="active">进行中</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
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
          <div className="flex-1 overflow-auto min-h-0">
            <div className="min-w-[1764px]">
              {/* 表头 */}
              <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <div className="flex">
                  <div className="w-16 px-4 py-3 flex-shrink-0"></div>
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
                            onDoubleClick={() => navigate(`/quotes/${quote.id}`)}
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
                                {hasPermission('quotes:view') && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      navigate(`/quotes/${quote.id}`)
                                    }}
                                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                    title="查看详情"
                                  >
                                    <Eye size={16} />
                                  </button>
                                )}
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
                  <p className="text-gray-500">暂无订单记录</p>
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

      {/* 收款单导出：轻提示（无数据 / 复制成功，自动消失） */}
      {paymentToast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-gray-800 text-white px-5 py-2.5 rounded-lg shadow-lg text-sm whitespace-nowrap">
          {paymentToast}
        </div>
      )}
    </div>
  )
}