import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { TrendingUp, AlertTriangle, AlertCircle, Calendar, ArrowRight, Plus, Activity } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 1, label: '报价中', color: 'bg-blue-100 text-blue-700', bgColor: 'bg-blue-500' },
  { value: 2, label: '打样中', color: 'bg-yellow-100 text-yellow-700', bgColor: 'bg-yellow-500' },
  { value: 3, label: '做货中', color: 'bg-purple-100 text-purple-700', bgColor: 'bg-purple-500' },
  { value: 4, label: '已发货未收款', color: 'bg-orange-100 text-orange-700', bgColor: 'bg-orange-500' },
  { value: 5, label: '已发货已收款', color: 'bg-green-100 text-green-700', bgColor: 'bg-green-500' },
  { value: 6, label: '结束', color: 'bg-gray-100 text-gray-700', bgColor: 'bg-gray-500' },
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

interface Quote {
  id: string
  quote_number: string
  customerName: string
  productStyle: string
  productSpec: string
  quantity: string
  productionTimeStart: string
  productionTimeEnd: string
  status: number
  sellPriceNoTax: number
  sellPriceWithTax: number
  quoteTime: string
  sampleTime: string
  productionStartTime: string
  shippingTime: string
}

export default function Dashboard() {
  const [stats, setStats] = useState({
    monthlyRevenue: 0,
    monthlyProfit: 0,
  })
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [alertQuotes, setAlertQuotes] = useState<Quote[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const quotesData = await api.quotes.getAll() as Quote[]
    setQuotes(quotesData)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0)

    // 计算当月总销售额和总利润（状态为做货中且做货开始时间在当月）
    const productionQuotes = quotesData.filter((quote) => {
      if (quote.status !== 3) return false
      const productionDate = new Date(quote.productionStartTime || quote.productionTimeStart)
      return productionDate >= currentMonthStart && productionDate <= currentMonthEnd
    })

    const monthlyRevenue = productionQuotes.reduce((sum, quote) => {
      const quantity = parseFloat(quote.quantity) || 0
      return sum + quantity * quote.sellPriceWithTax
    }, 0)

    const monthlyProfit = productionQuotes.reduce((sum, quote) => {
      const quantity = parseFloat(quote.quantity) || 0
      return sum + quantity * (quote.sellPriceWithTax - quote.sellPriceNoTax)
    }, 0)

    setStats({ monthlyRevenue, monthlyProfit })

    // 交期预警（3天内）
    const alertDate = new Date(today)
    alertDate.setDate(today.getDate() + 3)

    const alerts = quotesData.filter((quote) => {
      if (quote.status >= 4 && quote.status !== 4) return false
      if (!quote.productionTimeEnd) return false
      const endDate = new Date(quote.productionTimeEnd)
      endDate.setHours(0, 0, 0, 0)
      return endDate <= alertDate && endDate >= today
    })

    setAlertQuotes(alerts)
  }

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

  // 获取甘特图日期范围（从最早的开始日期到最晚的结束日期）
  const getGanttRange = () => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    
    const filteredQuotes = quotes.filter(q => q.status >= 1 && q.status <= 4)
    
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

  const statCards = [
    {
      title: '当月总销售额',
      value: `¥${stats.monthlyRevenue.toLocaleString()}`,
      icon: TrendingUp,
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-600',
    },
    {
      title: '当月总利润',
      value: `¥${stats.monthlyProfit.toLocaleString()}`,
      icon: Activity,
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
    },
    {
      title: '交期预警',
      value: alertQuotes.length,
      icon: AlertTriangle,
      bgColor: 'bg-red-50',
      textColor: 'text-red-600',
    },
  ]

  // 只显示报价中、打样中、做货中、已发货未收款状态的订单
  const activeQuotes = quotes.filter((q) => q.status >= 1 && q.status <= 4)

  return (
      <div className="p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-800">仪表盘</h1>
          <p className="text-gray-500 mt-1">欢迎回来，查看今日业务概览</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {statCards.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.title}
                className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{card.title}</p>
                    <p className="text-2xl font-bold text-gray-800 mt-1">{card.value}</p>
                  </div>
                  <div className={`w-12 h-12 ${card.bgColor} rounded-lg flex items-center justify-center`}>
                    <Icon className={card.textColor} size={24} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mb-8">
          {/* 订单状态跟踪甘特图 - 独立一行 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">订单状态跟踪</h2>
              <button
                onClick={() => navigate('/quotes')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                查看全部 <ArrowRight size={16} className="inline" />
              </button>
            </div>

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
                      <div key={quote.id} className="flex items-center gap-4 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                        <div className="w-56 shrink-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(quote.status)}`}>
                              {getStatusLabel(quote.status)}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-800 truncate">{quote.customerName}</p>
                          <p className="text-xs text-gray-500">{getStyleLabel(quote.productStyle)} - {quote.quantity}个</p>
                        </div>
                        <div className="flex-1 relative h-10">
                          {/* 背景轨道 */}
                          <div className="absolute inset-y-3 left-0 right-0 bg-gray-100 rounded-full"></div>
                          {/* 进度条 */}
                          <div
                            className={`absolute inset-y-3 rounded-full transition-all duration-300 ${getStatusBgColor(quote.status)}`}
                            style={{ ...barStyle }}
                          >
                            {/* 进度指示 */}
                            <div
                              className="absolute top-0 bottom-0 left-0 bg-white/40 rounded-full"
                              style={{ width: `${progress}%` }}
                            ></div>
                          </div>
                          {/* 当前日期标记 */}
                          <div
                            className="absolute top-0 bottom-0 w-1 bg-red-500 rounded-full z-10"
                            style={{ left: `${((new Date().getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * 100}%` }}
                          ></div>
                        </div>
                        <div className="w-24 shrink-0 text-right">
                          <p className="text-xs text-gray-500">{formatDate(quote.productionTimeStart)}</p>
                          <p className="text-xs text-gray-500">至</p>
                          <p className="text-xs text-gray-500">{formatDate(quote.productionTimeEnd || new Date().toISOString().split('T')[0])}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 交期预警 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-red-500" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">交期预警（3天内）</h2>
              </div>
              <button
                onClick={() => navigate('/quotes')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                查看全部 <ArrowRight size={16} className="inline" />
              </button>
            </div>

            {alertQuotes.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                <p className="text-gray-500">暂无即将到期的订单</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alertQuotes.map((quote) => {
                  const daysLeft = getDaysUntilDue(quote.productionTimeEnd)
                  return (
                    <div
                      key={quote.id}
                      className={`p-3 rounded-lg border-l-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                        daysLeft === 0 ? 'bg-red-50 border-red-500' :
                        daysLeft <= 1 ? 'bg-orange-50 border-orange-500' :
                        'bg-yellow-50 border-yellow-500'
                      }`}
                      onClick={() => navigate(`/quotes/${quote.id}`)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-gray-700 font-medium">
                            {quote.customerName}-{getStyleLabel(quote.productStyle)}-{quote.quantity}个-{quote.productSpec}CM
                          </span>
                        </div>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${getStatusColor(quote.status)}`}>
                          {getStatusLabel(quote.status)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Calendar size={14} />
                          <span>{formatDate(quote.productionTimeEnd)}</span>
                        </div>
                        <div className={`text-sm font-semibold ${
                          daysLeft === 0 ? 'text-red-600' :
                          daysLeft <= 1 ? 'text-orange-600' :
                          'text-yellow-600'
                        }`}>
                          {daysLeft === 0 ? '今日到期' : `剩${daysLeft}天`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="bg-gradient-to-r from-primary-600 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">快速开始</h2>
                <p className="text-blue-100 mt-1">创建订单或添加客户，开始您的业务流程</p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => navigate('/quotes')}
                  className="flex items-center gap-2 bg-white text-primary-600 px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                >
                  <Plus size={20} />
                  订单管理
                </button>
                <button
                  onClick={() => navigate('/customers/new')}
                  className="flex items-center gap-2 bg-white/20 text-white px-6 py-3 rounded-lg font-medium hover:bg-white/30 transition-colors"
                >
                  <Plus size={20} />
                  添加客户
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}