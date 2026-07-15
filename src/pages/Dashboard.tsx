import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ShoppingCart, CheckCircle, TrendingUp, Plus, Clock, ArrowRight } from 'lucide-react'
import type { Task } from '../types'

export default function Dashboard() {
  const [stats, setStats] = useState({
    pendingOrders: 0,
    totalRevenue: 0,
  })
  const [pendingTasks, setPendingTasks] = useState<Task[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [orders, tasks] = await Promise.all([
      api.orders.getAll() as Promise<{ status: string; total_amount: number }[]>,
      api.tasks.getAll() as Promise<Task[]>,
    ])

    const pendingOrders = orders.filter((o) => o.status === 'pending').length
    const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0)

    setStats({ pendingOrders, totalRevenue })
    setPendingTasks(tasks.filter((t) => t.status === 'pending').slice(0, 5))
  }

  const statCards = [
    {
      title: '待处理订单',
      value: stats.pendingOrders,
      icon: ShoppingCart,
      bgColor: 'bg-orange-50',
      textColor: 'text-orange-600',
    },
    {
      title: '总销售额',
      value: `¥${stats.totalRevenue.toLocaleString()}`,
      icon: CheckCircle,
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-600',
    },
    {
      title: '待办任务',
      value: pendingTasks.length,
      icon: Clock,
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
    },
    {
      title: '转化率',
      value: '—',
      icon: TrendingUp,
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
    },
  ]

  return (
      <div className="p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-800">仪表盘</h1>
          <p className="text-gray-500 mt-1">欢迎回来，查看今日业务概览</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">待办事项</h2>
              <button
                onClick={() => navigate('/tasks')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                查看全部 <ArrowRight size={16} className="inline" />
              </button>
            </div>

            {pendingTasks.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无待办事项</p>
            ) : (
              <div className="space-y-3">
                {pendingTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="text-gray-400" size={18} />
                      <span className="text-gray-700">{task.title}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {task.due_date ? new Date(task.due_date).toLocaleDateString() : '无截止日期'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">最近订单</h2>
              <button
                onClick={() => navigate('/orders')}
                className="text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                查看全部 <ArrowRight size={16} className="inline" />
              </button>
            </div>
            <RecentOrders />
          </div>
        </div>

        <div className="mt-6">
          <div className="bg-gradient-to-r from-primary-600 to-blue-600 rounded-xl p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">快速开始</h2>
                <p className="text-blue-100 mt-1">创建报价或添加客户，开始您的业务流程</p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => navigate('/quotes')}
                  className="flex items-center gap-2 bg-white text-primary-600 px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                >
                  <Plus size={20} />
                  报价管理
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

function RecentOrders() {
  const [orders, setOrders] = useState<{ id: string; order_number: string; status: string; total_amount: number; created_at: string }[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api.orders.getAll().then((data) => setOrders(data.slice(0, 5)))
  }, [])

  if (orders.length === 0) {
    return <p className="text-gray-500 text-center py-8">暂无订单记录</p>
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <div
          key={order.id}
          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
          onClick={() => navigate(`/orders/${order.id}`)}
        >
          <div className="flex items-center gap-3">
            <ShoppingCart className="text-gray-400" size={18} />
            <span className="text-gray-700">{order.order_number}</span>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-gray-800">¥{order.total_amount.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{order.status}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
