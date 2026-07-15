import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, Building2, User, Phone, Mail, MapPin, Briefcase, ShoppingCart } from 'lucide-react'
import type { Customer, Order } from '../types'

export default function CustomerDetail() {
  const { id } = useParams()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    setLoading(true)
    const [customerData, ordersData] = await Promise.all([
      api.customers.getById(id || '') as Promise<Customer>,
      api.orders.getAll() as Promise<Order[]>,
    ])
    setCustomer(customerData)
    setOrders(ordersData.filter((o) => o.customer_id === id))
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/customers')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">客户详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/customers')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">客户详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-gray-500">客户不存在</p>
        </div>
      </div>
    )
  }

  return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/customers')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">客户详情</h1>
              <p className="text-gray-500 mt-1">{(customer as { name: string }).name}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/customers/new')}
            className="text-primary-600 hover:text-primary-700 font-medium"
          >
            编辑客户
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="text-primary-600" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">基本信息</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <User className="text-gray-400" size={20} />
                  <div>
                    <label className="block text-sm text-gray-500">联系人</label>
                    <p className="text-gray-900">{(customer as { contact_person: string }).contact_person || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="text-gray-400" size={20} />
                  <div>
                    <label className="block text-sm text-gray-500">电话</label>
                    <p className="text-gray-900">{(customer as { phone: string }).phone || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="text-gray-400" size={20} />
                  <div>
                    <label className="block text-sm text-gray-500">邮箱</label>
                    <p className="text-gray-900">{(customer as { email: string }).email || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Briefcase className="text-gray-400" size={20} />
                  <div>
                    <label className="block text-sm text-gray-500">行业</label>
                    <p className="text-gray-900">{(customer as { industry: string }).industry || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 col-span-2">
                  <MapPin className="text-gray-400" size={20} />
                  <div>
                    <label className="block text-sm text-gray-500">地址</label>
                    <p className="text-gray-900">{(customer as { address: string }).address || '-'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingCart className="text-primary-600" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">历史订单</h2>
              </div>
              {orders.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无订单记录</p>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => navigate(`/orders/${order.id}`)}
                    >
                      <div>
                        <p className="font-medium text-gray-800">{order.order_number}</p>
                        <p className="text-sm text-gray-500">{new Date(order.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-gray-800">¥{order.total_amount.toLocaleString()}</p>
                        <span className={`text-xs ${order.status === 'completed' ? 'text-green-600' : order.status === 'cancelled' ? 'text-red-600' : 'text-blue-600'}`}>
                          {order.status === 'completed' ? '已完成' : order.status === 'cancelled' ? '已取消' : '处理中'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl p-6 text-white">
              <h3 className="text-sm font-medium text-blue-100 mb-2">客户统计</h3>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-2xl font-bold">{orders.length}</p>
                  <p className="text-blue-100 text-sm">订单数量</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">¥{orders.reduce((sum, o) => sum + o.total_amount, 0).toLocaleString()}</p>
                  <p className="text-blue-100 text-sm">订单总额</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-semibold text-gray-800 mb-4">快捷操作</h3>
              <div className="space-y-2">
                <button
                  onClick={() => navigate('/quotes')}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Briefcase size={18} />
                  创建报价
                </button>
                <button
                  onClick={() => navigate('/customers/new')}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <Building2 size={18} />
                  编辑客户
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
