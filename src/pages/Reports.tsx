import { useState, useEffect } from 'react'
import { api } from '../api'
import { BarChart3, ShoppingCart, Users, DollarSign, Calendar, RefreshCw } from 'lucide-react'
import { useLocation } from 'react-router-dom'

export default function Reports() {
  const location = useLocation()
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalCustomers: 0,
    totalRevenue: 0,
    avgOrderValue: 0,
  })
  const [monthlyData, setMonthlyData] = useState<{ month: string; orders: number; revenue: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [location.pathname])

  const fetchData = async () => {
    setLoading(true)
    const [orders, customers] = await Promise.all([
      api.orders.getAll(),
      api.customers.getAll(),
    ])

    const totalOrders = orders.length
    const totalCustomers = customers.length
    const totalRevenue = orders.reduce((sum: number, o: { total_amount: number }) => sum + o.total_amount, 0)
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0

    setStats({ totalOrders, totalCustomers, totalRevenue, avgOrderValue })

    const monthlyMap = new Map<string, { orders: number; revenue: number }>()
    const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

    orders.forEach((o: { created_at: string; total_amount: number }) => {
      const month = new Date(o.created_at).getMonth()
      const key = months[month]
      monthlyMap.set(key, {
        ...monthlyMap.get(key) || { orders: 0, revenue: 0 },
        orders: (monthlyMap.get(key)?.orders || 0) + 1,
        revenue: (monthlyMap.get(key)?.revenue || 0) + o.total_amount,
      })
    })

    const currentMonth = new Date().getMonth()
    const last6Months = []
    for (let i = 5; i >= 0; i--) {
      const monthIndex = (currentMonth - i + 12) % 12
      const monthName = months[monthIndex]
      const data = monthlyMap.get(monthName) || { orders: 0, revenue: 0 }
      last6Months.push({ month: monthName, ...data })
    }

    setMonthlyData(last6Months)
    setLoading(false)
  }

  const statCards = [
    {
      title: '总订单数',
      value: stats.totalOrders,
      icon: ShoppingCart,
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
    },
    {
      title: '总客户数',
      value: stats.totalCustomers,
      icon: Users,
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-600',
    },
    {
      title: '总销售额',
      value: `¥${stats.totalRevenue.toLocaleString()}`,
      icon: DollarSign,
      bgColor: 'bg-orange-50',
      textColor: 'text-orange-600',
    },
    {
      title: '平均订单价',
      value: `¥${stats.avgOrderValue.toLocaleString()}`,
      icon: BarChart3,
      bgColor: 'bg-pink-50',
      textColor: 'text-pink-600',
    },
  ]

  const maxRevenue = Math.max(...monthlyData.map(d => d.revenue), 1)

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">报表统计</h1>
            <p className="text-gray-500 mt-1">查看业务数据统计</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors min-h-[44px]"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span>刷新数据</span>
            </button>
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Calendar size={20} />
              <span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-6 sm:p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="text-gray-500 mt-4">加载中...</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
              {statCards.map((card) => {
                const Icon = card.icon
                return (
                  <div
                    key={card.title}
                    className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-gray-100"
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 ${card.bgColor} rounded-lg flex items-center justify-center shrink-0`}>
                        <Icon className={card.textColor} size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm text-gray-500">{card.title}</p>
                        <p className="text-base sm:text-lg font-bold text-gray-800 truncate">{card.value}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-gray-800 mb-4 sm:mb-6">近6个月订单趋势</h2>
                <div className="h-48 sm:h-64">
                  <div className="flex items-end justify-between h-full gap-1 sm:gap-4">
                    {monthlyData.map((data) => (
                      <div key={data.month} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                        <div className="w-full flex items-end gap-1 h-40 sm:h-48">
                          <div
                            className="flex-1 bg-green-400 rounded-t"
                            style={{ height: `${(data.orders / Math.max(...monthlyData.map(d => d.orders), 1)) * 100}%` }}
                            title={`订单: ${data.orders}`}
                          ></div>
                        </div>
                        <span className="text-xs sm:text-sm text-gray-600">{data.month}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
                <h2 className="text-base sm:text-lg font-semibold text-gray-800 mb-4 sm:mb-6">近6个月销售额趋势</h2>
                <div className="h-48 sm:h-64">
                  <div className="flex items-end justify-between h-full gap-1 sm:gap-4">
                    {monthlyData.map((data) => (
                      <div key={data.month} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                        <div
                          className="w-full bg-gradient-to-t from-primary-600 to-primary-400 rounded-t"
                          style={{ height: `${(data.revenue / maxRevenue) * 100}%` }}
                          title={`销售额: ¥${data.revenue.toLocaleString()}`}
                        ></div>
                        <span className="text-xs sm:text-sm text-gray-600">{data.month}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">6个月总销售额</span>
                    <span className="text-base sm:text-lg font-bold text-primary-600">¥{monthlyData.reduce((sum, d) => sum + d.revenue, 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 sm:mt-6 bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <h2 className="text-base sm:text-lg font-semibold text-gray-800 mb-4 sm:mb-6">数据明细</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">月份</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">订单数</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">销售额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {monthlyData.map((data) => (
                      <tr key={data.month} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">{data.month}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-gray-900">{data.orders}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-medium text-gray-900">¥{data.revenue.toLocaleString()}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
  )
}
