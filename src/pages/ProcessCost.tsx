import { useState, useEffect } from 'react'
import { Plus, Edit2, Trash2, Save, X } from 'lucide-react'
import { api } from '../api'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import type { ProcessCost as ProcessCostType } from '../types'

interface ProcessCostFormData {
  name: string
  cost: string
  formula: string
}

export default function ProcessCost() {
  const [processCosts, setProcessCosts] = useState<ProcessCostType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingItem, setEditingItem] = useState<ProcessCostType | null>(null)
  const [formData, setFormData] = useState<ProcessCostFormData>({
    name: '',
    cost: '',
    formula: '',
  })

  useEffect(() => {
    loadProcessCosts()
  }, [])

  const loadProcessCosts = async () => {
    setIsLoading(true)
    const data = await api.processCosts.getAll()
    setProcessCosts(data)
    setIsLoading(false)
  }

  const handleCreate = () => {
    setEditingItem(null)
    setFormData({ name: '', cost: '', formula: '' })
    setShowForm(true)
  }

  const handleEdit = (item: ProcessCostType) => {
    setEditingItem(item)
    setFormData({
      name: item.name,
      cost: item.cost.toString(),
      formula: item.formula,
    })
    setShowForm(true)
  }

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    await api.processCosts.delete(id)
    loadProcessCosts()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const data = {
      name: formData.name,
      cost: parseFloat(formData.cost) || 0,
      formula: formData.formula,
    }

    if (editingItem) {
      await api.processCosts.update(editingItem.id, data)
    } else {
      await api.processCosts.create(data)
    }

    setShowForm(false)
    loadProcessCosts()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">工艺成本管理</h1>
          <p className="text-gray-500 mt-1">管理工艺名称、工艺成本和工艺计算公式</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors min-h-[44px] justify-center"
        >
          <Plus size={20} />
          添加工艺成本
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
              {editingItem ? '编辑工艺成本' : '添加工艺成本'}
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="text-gray-400 hover:text-gray-600 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100"
              aria-label="关闭"
            >
              <X size={24} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">工艺名称</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                placeholder="请输入工艺名称"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">工艺成本（元）</label>
              <input
                type="number"
                name="cost"
                value={formData.cost}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                placeholder="请输入工艺成本"
                required
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">工艺计算公式</label>
              <textarea
                name="formula"
                value={formData.formula}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入工艺计算公式"
                rows={3}
                required
              />
            </div>
            <div className="flex flex-col sm:flex-row justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 min-h-[44px]"
              >
                取消
              </button>
              <button
                type="submit"
                className="flex items-center gap-2 justify-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 min-h-[44px]"
              >
                <Save size={16} />
                {editingItem ? '保存修改' : '添加'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工艺名称</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工艺成本（元）</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工艺计算公式</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 sm:px-6 py-12 text-center text-gray-500">
                    加载中...
                  </td>
                </tr>
              ) : processCosts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 sm:px-6 py-12 text-center text-gray-500">
                    暂无工艺成本数据
                  </td>
                </tr>
              ) : (
                processCosts.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-500">¥{item.cost.toFixed(2)}</td>
                    <td className="px-4 sm:px-6 py-4 text-sm text-gray-500">{item.formula}</td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => handleEdit(item)}
                        className="text-blue-600 hover:text-blue-900 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-blue-50"
                        title="编辑"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(item.id)}
                        className="text-red-600 hover:text-red-900 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-50 ml-1"
                        title="删除"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteTarget && (
        <DeleteConfirmDialog
          entityId={deleteTarget}
          entityLabel="工艺成本"
          deleteFn={handleDelete}
          deleteCheckFn={(id) => api.processCosts.deleteCheck(id)}
          onDeleted={() => loadProcessCosts()}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}