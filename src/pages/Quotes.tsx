import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, downloadBlob } from '../api'
import { Search, Plus, Edit, Trash2, Eye, Filter, Calendar, Building, Clock, ChevronDown, ChevronUp, Image, Copy, Download, Loader2, AlertCircle } from 'lucide-react'

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
  status: 1 | 2 | 3 | 4 | 5 | 6
  quoteTime: string
  sampleTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
  endTime: string
  images: string[]
  created_at: string
  updated_at: string
}

const STATUS_OPTIONS = [
  { value: 1, label: '报价中' },
  { value: 2, label: '打样中' },
  { value: 3, label: '做货中' },
  { value: 4, label: '已发货未收款' },
  { value: 5, label: '已发货已收款' },
  { value: 6, label: '结束' },
]

const PRODUCT_STYLE_OPTIONS = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

const getStyleLabel = (value: string): string => {
  const option = PRODUCT_STYLE_OPTIONS.find((opt) => opt.value === value)
  return option ? option.label : value
}

interface GroupedQuotes {
  customerName: string
  expanded: boolean
  quotes: Quote[]
}

export default function Quotes() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [groupedQuotes, setGroupedQuotes] = useState<GroupedQuotes[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [customerFilter, setCustomerFilter] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    fetchQuotes()
  }, [])

  useEffect(() => {
    groupQuotes()
  }, [quotes, searchTerm, statusFilter, customerFilter, styleFilter])

  const fetchQuotes = async () => {
    setLoading(true)
    try {
      const data = await api.quotes.getAll()
      setQuotes(data)
    } catch (error) {
      console.error('获取订单列表失败:', error)
      setQuotes([])
    }
    setLoading(false)
  }

  const groupQuotes = () => {
    let filtered = quotes.filter((quote) => {
      const matchesSearch = 
        quote.quote_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        quote.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        getStyleLabel(quote.productStyle).toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesStatus = 
        statusFilter === 'all' ||
        (statusFilter === 'active' && quote.status < 6) ||
        quote.status === parseInt(statusFilter)
      
      const matchesCustomer = !customerFilter || 
        quote.customerName.toLowerCase().includes(customerFilter.toLowerCase())
      
      const matchesStyle = !styleFilter || 
        quote.productStyle.toLowerCase().includes(styleFilter.toLowerCase()) ||
        getStyleLabel(quote.productStyle).toLowerCase().includes(styleFilter.toLowerCase())
      
      return matchesSearch && matchesStatus && matchesCustomer && matchesStyle
    })

    const grouped: Record<string, Quote[]> = {}
    filtered.forEach((quote) => {
      if (!grouped[quote.customerName]) {
        grouped[quote.customerName] = []
      }
      grouped[quote.customerName].push(quote)
    })

    setGroupedQuotes(
      Object.entries(grouped).map(([customerName, quotes]) => ({
        customerName,
        expanded: true,
        quotes,
      }))
    )
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

  const handleDelete = async (id: string) => {
    try {
      await api.quotes.delete(id)
      fetchQuotes()
    } catch (error) {
      console.error('删除订单失败:', error)
    }
    setShowDeleteConfirm(null)
  }

  const handleCopy = async (id: string) => {
    try {
      const source = await api.quotes.getById(id)
      if (!source) return
      const { id: _, quote_number: __, status: ___, created_at: ____, updated_at: _____, ...rest } = source
      const copyData = {
        ...rest,
        status: 1 as const,
        quoteTime: new Date().toISOString().split('T')[0],
        sampleTime: '',
        productionStartTime: '',
        shippingTime: '',
        paymentTime: '',
        endTime: '',
      }
      await api.quotes.create(copyData)
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
      // 收集当前筛选后的所有订单 ID
      const orderIds = groupedQuotes.flatMap((g) => g.quotes.map((q) => q.id))
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

  const getStatusColor = (status: number) => {
    switch (status) {
      case 1: return 'bg-blue-100 text-blue-700'
      case 2: return 'bg-yellow-100 text-yellow-700'
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">订单管理</h1>
          <p className="text-gray-500 mt-1">管理所有订单</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setExportError(''); setShowExportDialog(true) }}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 border border-primary-200 text-primary-700 bg-white rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            导出 Excel
          </button>
          <button
            onClick={() => navigate('/quotes/new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus size={20} />
            新增订单
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col h-[calc(100vh-200px)]">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-4 flex-shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索订单号..."
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
                {PRODUCT_STYLE_OPTIONS.map((style) => (
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
          <div className="flex-1 overflow-auto">
            <div className="min-w-[1700px]">
              {/* 表头 */}
              <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <div className="flex">
                  <div className="w-16 px-4 py-3 flex-shrink-0"></div>
                  <div className="w-48 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单号</div>
                  <div className="w-40 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">款式</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">产品规格</div>
                  <div className="w-24 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">数量</div>
                  <div className="w-28 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">成本价</div>
                  <div className="w-28 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">含税价</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(不含税)</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(含税)</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">利润(不含税)</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">利润(含税)</div>
                  <div className="w-44 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">做货到期时间</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单状态</div>
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

                    {/* 子行 - 订单详情 */}
                    {group.expanded &&
                      group.quotes.map((quote) => {
                        return (
                          <div
                            key={quote.id}
                            className="flex items-center hover:bg-gray-50 cursor-pointer transition-colors"
                            onDoubleClick={() => navigate(`/quotes/${quote.id}`)}
                          >
                            {/* 产品图 */}
                            <div className="w-16 px-4 py-4 flex-shrink-0 flex items-center justify-center">
                              {quote.images && quote.images.length > 0 ? (
                                <img
                                  src={quote.images[0]}
                                  alt="产品图"
                                  className="w-10 h-10 rounded-lg object-cover border border-gray-200"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                                  <Image className="text-gray-400" size={18} />
                                </div>
                              )}
                            </div>

                            {/* 订单号 */}
                            <div className="w-48 px-4 py-4 flex-shrink-0">
                              <span className="font-medium text-gray-800 text-sm truncate block">
                                {quote.quote_number}
                              </span>
                            </div>

                            {/* 款式 */}
                            <div className="w-40 px-4 py-4 flex-shrink-0 text-gray-600 text-sm">
                              {getStyleLabel(quote.productStyle)}
                            </div>

                            {/* 产品规格 */}
                            <div className="w-36 px-4 py-4 flex-shrink-0 text-gray-600 text-sm">
                              {quote.productSpec}{quote.productSpec ? 'CM' : ''}
                            </div>

                            {/* 数量 */}
                            <div className="w-24 px-4 py-4 flex-shrink-0 text-gray-600 text-sm">
                              {quote.quantity}{quote.quantity ? '个' : ''}
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

                            {/* 订单状态 */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span
                                className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(quote.status)}`}
                              >
                                {getStatusLabel(quote.status)}
                              </span>
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
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setShowDeleteConfirm(quote.id)
                                  }}
                                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="删除"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
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
        )}
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">确认删除</h3>
            <p className="text-gray-500 mb-6">确定要删除此订单吗？此操作无法撤销。</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
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
                  {groupedQuotes.reduce((sum, g) => sum + g.quotes.length, 0)} 个
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
                disabled={exporting || groupedQuotes.reduce((sum, g) => sum + g.quotes.length, 0) === 0}
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
    </div>
  )
}