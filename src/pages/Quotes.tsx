import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Search, Plus, Edit, Trash2, Eye, Filter, Calendar, Building, Clock, ChevronRight, ChevronLeft, Square, ChevronDown, ChevronUp, Image } from 'lucide-react'

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

  const handleNextStatus = async (id: string) => {
    try {
      const data = await api.quotes.nextStatus(id)
      setQuotes((prev) => prev.map((q) => (q.id === id ? data : q)))
    } catch (error) {
      console.error('状态流转失败:', error)
    }
  }

  const handlePrevStatus = async (id: string) => {
    try {
      const data = await api.quotes.prevStatus(id)
      setQuotes((prev) => prev.map((q) => (q.id === id ? data : q)))
    } catch (error) {
      console.error('状态退回失败:', error)
    }
  }

  const handleEndQuote = async (id: string) => {
    try {
      const data = await api.quotes.endQuote(id)
      setQuotes((prev) => prev.map((q) => (q.id === id ? data : q)))
    } catch (error) {
      console.error('结束订单失败:', error)
    }
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

  const getStyleNames = () => {
    const styles = [...new Set(quotes.map((q) => q.productStyle))]
    return styles.sort()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">订单管理</h1>
          <p className="text-gray-500 mt-1">管理所有订单</p>
        </div>
        <button
          onClick={() => navigate('/quotes/new')}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={20} />
          新增订单
        </button>
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
            <div className="min-w-[1200px]">
              {/* 表头 */}
              <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                <div className="flex">
                  <div className="w-16 px-4 py-3 flex-shrink-0"></div>
                  <div className="w-48 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单号</div>
                  <div className="w-40 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">款式</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">产品规格</div>
                  <div className="w-24 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">数量</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(不含税)</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(含税)</div>
                  <div className="w-44 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">做货到期时间</div>
                  <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单状态</div>
                  <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">创建日期</div>
                  <div className="w-56 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">状态操作</div>
                  <div className="w-56 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">操作</div>
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
                      <div className="w-56 px-4 py-4 flex-shrink-0"></div>
                      <div className="w-56 px-4 py-4 flex-shrink-0"></div>
                    </div>

                    {/* 子行 - 订单详情 */}
                    {group.expanded &&
                      group.quotes.map((quote) => {
                        const canGoNext = quote.status >= 1 && quote.status <= 5
                        const canGoPrev = quote.status >= 2 && quote.status <= 6
                        const canEnd = quote.status >= 1 && quote.status <= 5

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

                            {/* 卖价(不含税) */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span className="text-primary-600 font-semibold text-sm">
                                ¥{quote.sellPriceNoTax.toFixed(2)}
                              </span>
                            </div>

                            {/* 卖价(含税) */}
                            <div className="w-36 px-4 py-4 flex-shrink-0">
                              <span className="text-primary-600 font-semibold text-sm">
                                ¥{quote.sellPriceWithTax.toFixed(2)}
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

                            {/* 状态操作 - 固定列 */}
                            <div className="w-56 px-4 py-4 flex-shrink-0">
                              <div className="flex items-center gap-1">
                                {canGoPrev && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handlePrevStatus(quote.id)
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                    title="退回上一节点"
                                  >
                                    <ChevronLeft size={16} />
                                  </button>
                                )}
                                {canGoNext && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleNextStatus(quote.id)
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                                    title="进入下一节点"
                                  >
                                    <ChevronRight size={16} />
                                  </button>
                                )}
                                {canEnd && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEndQuote(quote.id)
                                    }}
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                    title="结束订单"
                                  >
                                    <Square size={16} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* 操作 - 固定列 */}
                            <div className="w-56 px-4 py-4 flex-shrink-0">
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
    </div>
  )
}