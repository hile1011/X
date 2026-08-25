import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Plus, Search, Eye, Edit, Trash2, Users, Building2, Mail, Phone } from 'lucide-react'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { parseCustomerTags } from '../utils/customerTags'
import type { Customer } from '../types'

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async () => {
    setLoading(true)
    const data = await api.customers.getAll()
    setCustomers(data)
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    await api.customers.delete(id)
    fetchCustomers()
  }

  const filteredCustomers = customers.filter((customer) => {
    const search = searchTerm.toLowerCase()
    return customer.name.toLowerCase().includes(search) ||
           (customer.contact_person && customer.contact_person.toLowerCase().includes(search)) ||
           (customer.industry && customer.industry.toLowerCase().includes(search)) ||
           (customer.tags && customer.tags.toLowerCase().includes(search))
  })

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">客户管理</h1>
            <p className="text-gray-500 mt-1">管理所有客户信息</p>
          </div>
          <button
            onClick={() => navigate('/customers/new')}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors min-h-[44px] justify-center"
          >
            <Plus size={20} />
            添加客户
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索客户名称、联系人或行业..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-6 sm:p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 p-3 sm:p-4">
              {filteredCustomers.map((customer) => (
                <div
                  key={customer.id}
                  className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center shrink-0">
                        <Users className="text-primary-600" size={20} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-800 truncate">{customer.name}</h3>
                        <p className="text-sm text-gray-500">{customer.industry || '未分类'}</p>
                      </div>
                    </div>
                  </div>

                  {parseCustomerTags(customer.tags).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {parseCustomerTags(customer.tags).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-primary-50 text-primary-600 text-xs rounded-full border border-primary-100 truncate max-w-[140px]"
                          title={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building2 size={16} className="text-gray-400" />
                      <span>{customer.contact_person || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone size={16} className="text-gray-400" />
                      <span>{customer.phone || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Mail size={16} className="text-gray-400" />
                      <span className="truncate">{customer.email || '-'}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1 sm:gap-2 mt-4 pt-3 border-t border-gray-200">
                    <button
                      onClick={() => navigate(`/customers/${customer.id}`)}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="查看详情"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      onClick={() => navigate(`/customers/${customer.id}/edit`)}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="编辑"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(customer.id)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="删除"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}

              {filteredCustomers.length === 0 && (
                <div className="col-span-full p-8 text-center">
                  <p className="text-gray-500">暂无客户记录</p>
                </div>
              )}
            </div>
          )}
        </div>

        {deleteTarget && (
          <DeleteConfirmDialog
            entityId={deleteTarget}
            entityLabel="客户"
            deleteFn={handleDelete}
            deleteCheckFn={(id) => api.customers.deleteCheck(id)}
            onDeleted={() => fetchCustomers()}
            onClose={() => setDeleteTarget(null)}
          />
        )}
      </div>
  )
}
