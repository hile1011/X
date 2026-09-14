import { useState, useEffect } from 'react'
import { api } from '../api'
import { Lock, Loader2, Menu, MousePointerClick } from 'lucide-react'

interface PermissionItem {
  id: string
  code: string
  name: string
  module: string
  action: string
  type: string
  sort_order: number
}

const moduleNames: Record<string, string> = {
  dashboard: '工作台',
  quotes: '订单管理',
  'ai-order': 'AI智能下单',
  'production-tracking': '做货跟踪',
  reconciliation: '订单对账管理',
  'quotes-table': '订单表格版',
  'quotes-wps': '订单WPS版',
  'sheet-templates': '模板管理',
  'order-templates': '订单模板',
  'process-costs': '产品成本项配置',
  customers: '客户管理',
  products: '产品管理',
  tasks: '跟单任务',
  reports: '报表统计',
  'annual-report': '年度业务报表',
  'operation-logs': '操作日志',
  users: '用户管理',
  roles: '角色管理',
  system: '系统',
}

export default function Permissions() {
  const [grouped, setGrouped] = useState<Record<string, PermissionItem[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const data = await api.permissions.getAll()
      setGrouped(data.grouped || {})
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">加载中...</span>
      </div>
    )
  }

  const total = Object.values(grouped).reduce((sum, perms) => sum + perms.length, 0)

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
          <Lock size={24} className="text-primary-600" />
          权限管理
        </h1>
        <p className="text-gray-500 mt-1">
          系统权限目录（只读），共 {Object.keys(grouped).length} 个模块、{total} 项权限
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(grouped).map(([module, perms]) => (
          <div key={module} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                {moduleNames[module] || module}
              </h3>
              <span className="text-xs text-gray-400">{perms.length} 项</span>
            </div>
            <div className="divide-y divide-gray-50">
              {perms.map((perm) => (
                <div key={perm.id} className="px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {perm.type === 'menu' ? (
                      <Menu size={14} className="text-blue-500" />
                    ) : (
                      <MousePointerClick size={14} className="text-gray-400" />
                    )}
                    <span className="text-sm text-gray-700">{perm.name}</span>
                  </div>
                  <code className="text-xs text-gray-400 font-mono">{perm.code}</code>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
