import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Plus, Search, Eye, Edit, Filter, ClipboardList, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import type { Task } from '../types'

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    setLoading(true)
    const data = await api.tasks.getAll()
    setTasks(data)
    setLoading(false)
  }

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-700'
      case 'in_progress': return 'bg-blue-100 text-blue-700'
      case 'completed': return 'bg-green-100 text-green-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return '待处理'
      case 'in_progress': return '进行中'
      case 'completed': return '已完成'
      default: return status
    }
  }

  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false
    return new Date(dueDate) < new Date()
  }

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">跟单任务</h1>
            <p className="text-gray-500 mt-1">管理所有跟单任务</p>
          </div>
          <button
            onClick={() => navigate('/tasks/new')}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors min-h-[44px] justify-center"
          >
            <Plus size={20} />
            创建任务
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索任务标题..."
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
                <option value="in_progress">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-6 sm:p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredTasks.map((task: { id: string; title: string; description: string; status: string; due_date: string; order_id: string }) => (
                <div
                  key={task.id}
                  className="p-3 sm:p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${getStatusColor(task.status)}`}>
                        {task.status === 'completed' ? (
                          <CheckCircle className="text-white" size={20} />
                        ) : task.status === 'in_progress' ? (
                          <Clock className="text-white" size={20} />
                        ) : (
                          <ClipboardList className="text-white" size={20} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-800 truncate">{task.title}</h3>
                          {isOverdue(task.due_date) && task.status !== 'completed' && (
                            <AlertCircle className="text-red-500 shrink-0" size={16} />
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{task.description || '暂无描述'}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                          {task.order_id && (
                            <span className="text-sm text-gray-500">订单 #{task.order_id.slice(0, 8)}</span>
                          )}
                          {task.due_date && (
                            <span className={`text-sm ${isOverdue(task.due_date) && task.status !== 'completed' ? 'text-red-500' : 'text-gray-500'}`}>
                              截止: {new Date(task.due_date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(task.status)}`}>
                        {getStatusLabel(task.status)}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/tasks/${task.id}`) }}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/tasks/${task.id}`) }}
                          className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        >
                          <Edit size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {filteredTasks.length === 0 && (
                <div className="p-6 sm:p-8 text-center">
                  <p className="text-gray-500">暂无任务记录</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  )
}
