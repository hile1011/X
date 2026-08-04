import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, ShoppingCart, User, Building, Package } from 'lucide-react'
import type { Order, Product, OrderItem } from '../types'

interface OrderWithDetails extends Order {
  customer?: { name: string; contact_person: string; phone: string; email: string }
  items?: OrderItem[]
}

export default function OrderDetail() {
  const { id } = useParams()
  const [order, setOrder] = useState<OrderWithDetails | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [orderData, productsData] = await Promise.all([
        api.orders.getById(id || ''),
        api.products.getAll(),
      ])
      setOrder(orderData)
      setProducts(productsData)
      setStatus(orderData?.status || '')
    } catch (error) {
      console.error('获取订单数据失败:', error)
      setOrder(null)
      setStatus('')
    }
    setLoading(false)
  }

  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus)
    await api.orders.update(id || '', { status: newStatus })
    fetchData()
  }

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

  

  const statusOptions = [
    { value: 'pending', label: '待处理' },
    { value: 'processing', label: '处理中' },
    { value: 'shipped', label: '已发货' },
    { value: 'completed', label: '已完成' },
    { value: 'cancelled', label: '已取消' },
  ]

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/orders')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">订单详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/orders')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">订单详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <p className="text-gray-500">订单不存在</p>
        </div>
      </div>
    )
  }

  return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/orders')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">订单详情</h1>
            <p className="text-gray-500 mt-1 truncate">{(order as { order_number: string }).order_number}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingCart className="text-primary-600" size={20} />
                <h2 className="text-base sm:text-lg font-semibold text-gray-800">基本信息</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="min-w-0">
                  <label className="block text-sm text-gray-500">订单号</label>
                  <p className="font-medium text-gray-900 truncate">{order.order_number || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-500">状态</label>
                  <select
                    value={status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    className={`mt-1 px-3 py-1 inline-flex text-sm font-semibold rounded-full border border-transparent ${getStatusColor(status)} focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px]`}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-white text-gray-800">
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-500">创建时间</label>
                  <p className="text-gray-900">{order.created_at ? new Date(order.created_at).toLocaleString() : '-'}</p>
                </div>
                <div className="min-w-0">
                  <label className="block text-sm text-gray-500">报价单号</label>
                  <p className="text-gray-900 truncate">{order.quote_id ? `QT-${order.quote_id.slice(0, 8)}` : '直接创建'}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building className="text-primary-600" size={20} />
                <h2 className="text-base sm:text-lg font-semibold text-gray-800">客户信息</h2>
              </div>
              {order.customer ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">客户名称</label>
                    <p className="font-medium text-gray-900 truncate">{order.customer.name}</p>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">联系人</label>
                    <p className="text-gray-900 truncate">{order.customer.contact_person || '-'}</p>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">电话</label>
                    <p className="text-gray-900 truncate">{order.customer.phone || '-'}</p>
                  </div>
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">邮箱</label>
                    <p className="text-gray-900 truncate">{order.customer.email || '-'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">客户信息未找到</p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Package className="text-primary-600" size={20} />
                <h2 className="text-base sm:text-lg font-semibold text-gray-800">产品明细</h2>
              </div>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full min-w-[480px]">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">产品名称</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">单价</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">小计</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(order?.items || []).map((item) => {
                      const product = products.find((p) => p.id === item.product_id)
                      return (
                        <tr key={item.id}>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium text-gray-900">{product?.name || '未知产品'}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm text-gray-900">{item.quantity}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm text-gray-900">¥{item.unit_price.toLocaleString()}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-medium text-gray-900">¥{item.amount.toLocaleString()}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6">
            <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-4 sm:p-6 text-white">
              <h3 className="text-sm font-medium text-green-100 mb-2">订单总额</h3>
              <p className="text-2xl sm:text-3xl font-bold">¥{(order.total_amount || 0).toLocaleString()}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="text-primary-600" size={20} />
                <h3 className="font-semibold text-gray-800">处理人</h3>
              </div>
              <p className="text-gray-600">用户 #{order.user_id ? order.user_id.slice(0, 8) : '-'}</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 sm:p-6">
              <h3 className="font-semibold text-gray-800 mb-2">时间线</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full shrink-0"></div>
                  <span className="text-sm text-gray-600">创建于 {order.created_at ? new Date(order.created_at).toLocaleString() : '-'}</span>
                </div>
                {order.updated_at !== order.created_at && (
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0"></div>
                    <span className="text-sm text-gray-600">更新于 {order.updated_at ? new Date(order.updated_at).toLocaleString() : '-'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
