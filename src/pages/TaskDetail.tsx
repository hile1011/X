import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, ClipboardList, Clock, User, ShoppingCart, CheckCircle, AlertCircle, PlayCircle } from 'lucide-react'

export default function TaskDetail() {
  const { id } = useParams()
  const [task, setTask] = useState<unknown>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    setLoading(true)
    const data = await api.tasks.getById(id || '')
    setTask(data)
    setStatus((data as { status: string }).status || '')
    setLoading(false)
  }

  const handleStatusChange = async (newStatus: string) => {
    setStatus(newStatus)
    await api.tasks.update(id || '', { status: newStatus })
    fetchData()
  }

  

  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false
    return new Date(dueDate) < new Date()
  }

  const statusOptions = [
    { value: 'pending', label: '待处理', icon: AlertCircle },
    { value: 'in_progress', label: '进行中', icon: PlayCircle },
    { value: 'completed', label: '已完成', icon: CheckCircle },
  ]

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/tasks')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">任务详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/tasks')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-2xl font-bold text-gray-800">任务详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <p className="text-gray-500">任务不存在</p>
        </div>
      </div>
    )
  }

  return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/tasks')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">任务详情</h1>
              <p className="text-gray-500 mt-1">{(task as { title: string }).title}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardList className="text-primary-600" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">任务信息</h2>
              </div>
              <div className="mb-4">
                <label className="block text-sm text-gray-500 mb-2">任务标题</label>
                <h3 className="text-xl font-bold text-gray-800">{(task as { title: string }).title}</h3>
              </div>
              <div>
                <label className="block text-sm text-gray-500 mb-2">任务描述</label>
                <p className="text-gray-700">{(task as { description: string }).description || '暂无描述'}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="text-primary-600" size={20} />
                <h2 className="text-lg font-semibold text-gray-800">截止日期</h2>
              </div>
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isOverdue((task as { due_date: string }).due_date) && status !== 'completed' ? 'bg-red-100' : 'bg-blue-100'}`}>
                  <Clock className={`size-20 ${isOverdue((task as { due_date: string }).due_date) && status !== 'completed' ? 'text-red-600' : 'text-blue-600'}`} />
                </div>
                <div>
                  <label className="block text-sm text-gray-500">截止时间</label>
                  <p className={`text-xl font-bold ${isOverdue((task as { due_date: string }).due_date) && status !== 'completed' ? 'text-red-600' : 'text-gray-800'}`}>
                    {(task as { due_date: string }).due_date ? new Date((task as { due_date: string }).due_date).toLocaleDateString() : '未设置'}
                  </p>
                  {isOverdue((task as { due_date: string }).due_date) && status !== 'completed' && (
                    <p className="text-sm text-red-500 mt-1">已逾期</p>
                  )}
                </div>
              </div>
            </div>

            {(task as { order_id: string }).order_id && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center gap-2 mb-4">
                  <ShoppingCart className="text-primary-600" size={20} />
                  <h2 className="text-lg font-semibold text-gray-800">关联订单</h2>
                </div>
                <button
                  onClick={() => navigate(`/orders/${(task as { order_id: string }).order_id}`)}
                  className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors w-full"
                >
                  <ShoppingCart className="text-gray-400" size={24} />
                  <div>
                    <p className="font-medium text-gray-800">订单 #{(task as { order_id: string }).order_id.slice(0, 8)}</p>
                    <p className="text-sm text-gray-500">点击查看订单详情</p>
                  </div>
                </button>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-semibold text-gray-800 mb-4">任务状态</h3>
              <div className="space-y-3">
                {statusOptions.map((option) => {
                  const Icon = option.icon
                  const isActive = status === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleStatusChange(option.value)}
                      className={`w-full flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                        isActive
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className={`size-20 ${isActive ? 'text-primary-600' : 'text-gray-400'}`} />
                      <span className={`font-medium ${isActive ? 'text-primary-700' : 'text-gray-700'}`}>
                        {option.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="text-primary-600" size={20} />
                <h3 className="font-semibold text-gray-800">负责人</h3>
              </div>
              <p className="text-gray-600">用户 #{(task as { user_id: string }).user_id.slice(0, 8)}</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="font-semibold text-gray-800 mb-2">时间线</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-gray-600">创建于 {new Date((task as { created_at: string }).created_at).toLocaleString()}</span>
                </div>
                {((task as { updated_at: string }).updated_at !== (task as { created_at: string }).created_at) && (
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="text-sm text-gray-600">更新于 {new Date((task as { updated_at: string }).updated_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
