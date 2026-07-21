import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Search, Eye, Edit, Filter, ShoppingCart } from 'lucide-react'
import type { Order } from '../types'

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    setLoading(true)
    try {
      const data = await api.orders.getAll()
      setOrders(data)
    } catch (error) {
      console.error('获取订单列表失败:', error)
      setOrders([])
    }
    setLoading(false)
  }

  const filteredOrders = orders.filter((order) => {
    const matchesSearch = order.order_number.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-700'
      case 'processing': return 'bg-blue-100 text-blue-700'
      case 'shipped': return 'bg-purple-100 text-purple-700'
      case 'completed': return 'bg-green-100 text-green-700'
      case 'cancelled': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return '待处理'
      case 'processing': return '处理中'
      case 'shipped': return '已发货'
      case 'completed': return '已完成'
      case 'cancelled': return '已取消'
      default: return status
    }
  }

  return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">订单管理</h1>
            <p className="text-gray-500 mt-1">管理所有订单</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索订单号..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="text-gray-400" size={20} />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="all">全部状态</option>
                <option value="pending">待处理</option>
                <option value="processing">处理中</option>
                <option value="shipped">已发货</option>
                <option value="completed">已完成</option>
                <option value="cancelled">已取消</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors cursor-pointer"
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="text-gray-400" size={20} />
                      <span className="font-medium text-gray-800">{order.order_number}</span>
                    </div>
                    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(order.status)}`}>
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-sm">创建时间</span>
                    <span className="text-gray-600 text-sm">{new Date(order.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-gray-500 text-sm">金额</span>
                    <span className="text-lg font-bold text-primary-600">¥{order.total_amount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-4">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}`) }}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/orders/${order.id}`) }}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <Edit size={18} />
                    </button>
                  </div>
                </div>
              ))}

              {filteredOrders.length === 0 && (
                <div className="col-span-full p-8 text-center">
                  <p className="text-gray-500">暂无订单记录</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  )
}
