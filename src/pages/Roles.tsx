import { useState, useEffect } from 'react'
import { api } from '../api'
import { usePermission } from '../hooks/usePermission'
import { Plus, KeyRound, X, Loader2, Check, Pencil, Trash2, Shield, ShieldCheck } from 'lucide-react'

interface PermissionItem {
  id: string
  code: string
  name: string
  module: string
  action: string
  type: string
  sort_order: number
}

interface RoleItem {
  id: string
  name: string
  code: string
  description: string
  is_system: boolean
  permission_count: number
  user_count: number
}

const moduleNames: Record<string, string> = {
  dashboard: '工作台',
  quotes: '订单管理',
  'quotes-table': '订单表格版',
  'quotes-wps': '订单WPS版',
  'process-costs': '工艺成本',
  customers: '客户管理',
  products: '产品管理',
  tasks: '跟单任务',
  reports: '报表统计',
  'operation-logs': '操作日志',
  users: '用户管理',
  roles: '角色管理',
  system: '系统',
}

export default function Roles() {
  const { hasPermission } = usePermission()

  const [roles, setRoles] = useState<RoleItem[]>([])
  const [permissions, setPermissions] = useState<PermissionItem[]>([])
  const [permissionsGrouped, setPermissionsGrouped] = useState<Record<string, PermissionItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RoleItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 表单状态
  const [formName, setFormName] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPermissionIds, setFormPermissionIds] = useState<string[]>([])

  const canEdit = hasPermission('roles:edit')
  const canDelete = hasPermission('roles:delete')
  const canCreate = hasPermission('roles:create')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [rolesData, permsData] = await Promise.all([api.roles.getAll(), api.permissions.getAll()])
      setRoles(rolesData)
      setPermissions(permsData.permissions)
      setPermissionsGrouped(permsData.grouped)
    } catch (err: any) {
      setError(err.message || '加载数据失败')
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditingRole(null)
    setFormName('')
    setFormCode('')
    setFormDescription('')
    setFormPermissionIds([])
    setError('')
    setShowModal(true)
  }

  const openEdit = async (role: RoleItem) => {
    try {
      const detail = await api.roles.getById(role.id)
      setEditingRole(role)
      setFormName(role.name)
      setFormCode(role.code)
      setFormDescription(role.description)
      setFormPermissionIds(detail.permissionIds || [])
      setError('')
      setShowModal(true)
    } catch (err: any) {
      setError(err.message || '加载角色详情失败')
    }
  }

  const handleSubmit = async () => {
    setError('')
    if (!formName.trim()) {
      setError('请输入角色名称')
      return
    }
    if (!editingRole && !formCode.trim()) {
      setError('请输入角色编码')
      return
    }

    setSubmitting(true)
    try {
      if (editingRole) {
        await api.roles.update(editingRole.id, {
          name: formName,
          description: formDescription,
          permissionIds: formPermissionIds,
        })
      } else {
        await api.roles.create({
          name: formName,
          code: formCode,
          description: formDescription,
          permissionIds: formPermissionIds,
        })
      }
      setShowModal(false)
      fetchData()
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await api.roles.delete(deleteTarget.id)
      setDeleteTarget(null)
      fetchData()
    } catch (err: any) {
      setError(err.message || '删除失败')
    } finally {
      setSubmitting(false)
    }
  }

  const togglePermission = (permId: string) => {
    setFormPermissionIds((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId]
    )
  }

  const toggleModule = (module: string) => {
    const modulePermIds = (permissionsGrouped[module] || []).map((p) => p.id)
    const allSelected = modulePermIds.every((id) => formPermissionIds.includes(id))
    if (allSelected) {
      setFormPermissionIds((prev) => prev.filter((id) => !modulePermIds.includes(id)))
    } else {
      setFormPermissionIds((prev) => [...new Set([...prev, ...modulePermIds])])
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

  return (
    <div className="p-4 sm:p-6">
      {/* 标题栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
            <KeyRound size={24} className="text-primary-600" />
            角色管理
          </h1>
          <p className="text-gray-500 mt-1">管理系统角色和权限分配</p>
        </div>
        {canCreate && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm"
          >
            <Plus size={20} />
            新增角色
          </button>
        )}
      </div>

      {/* 角色列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">角色名称</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">编码</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">描述</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">类型</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">权限数</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">用户数</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roles.map((role) => {
                const isSystem = role.is_system
                const canDeleteRole = canDelete && !isSystem && role.user_count === 0
                return (
                  <tr key={role.id} className="hover:bg-gray-50 transition-colors">
                    {/* 角色名称 + 图标 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isSystem ? 'bg-indigo-100 text-indigo-600' : 'bg-primary-100 text-primary-600'}`}>
                          {isSystem ? <ShieldCheck size={18} /> : <Shield size={18} />}
                        </div>
                        <span className="font-medium text-gray-800">{role.name}</span>
                      </div>
                    </td>
                    {/* 编码 */}
                    <td className="px-4 py-3">
                      <code className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded font-mono">{role.code}</code>
                    </td>
                    {/* 描述 */}
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                      {role.description || <span className="text-gray-300">-</span>}
                    </td>
                    {/* 类型 */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isSystem ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                        {isSystem ? '系统内置' : '自定义'}
                      </span>
                    </td>
                    {/* 权限数 */}
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                        {role.permission_count ?? 0}
                      </span>
                    </td>
                    {/* 用户数 */}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold ${(role.user_count ?? 0) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400'}`}>
                        {role.user_count ?? 0}
                      </span>
                    </td>
                    {/* 操作 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <button
                            onClick={() => openEdit(role)}
                            className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            title="编辑角色与权限"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {canDeleteRole && (
                          <button
                            onClick={() => setDeleteTarget(role)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="删除角色"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        {!canDeleteRole && canDelete && (
                          <span className="text-xs text-gray-300 px-2" title={isSystem ? '系统内置角色不可删除' : '有关联用户的角色不可删除'}>
                            {isSystem ? '系统' : (role.user_count ?? 0) > 0 ? '使用中' : ''}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* 空状态 */}
          {roles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Shield size={48} className="mb-3 text-gray-300" />
              <p className="text-sm">暂无角色数据</p>
            </div>
          )}
        </div>

        {/* 底部统计 */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500">
          共 <span className="font-semibold text-gray-700">{roles.length}</span> 个角色
          · 系统内置 <span className="font-semibold text-gray-700">{roles.filter((r) => r.is_system).length}</span> 个
          · 自定义 <span className="font-semibold text-gray-700">{roles.filter((r) => !r.is_system).length}</span> 个
        </div>
      </div>

      {/* 创建/编辑 Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingRole ? '编辑角色' : '新增角色'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
              {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">角色名称 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">角色编码 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    disabled={!!editingRole}
                    placeholder="如 editor, viewer"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  {editingRole && <p className="text-xs text-gray-400 mt-1">编码创建后不可修改</p>}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <input
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    权限分配
                    <span className="ml-2 text-xs text-gray-400">
                      已选 {formPermissionIds.length} / {permissions.length}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormPermissionIds(permissions.map((p) => p.id))}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormPermissionIds([])}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      清空
                    </button>
                  </div>
                </div>
                <div className="space-y-3 border border-gray-200 rounded-lg p-3 max-h-80 overflow-y-auto">
                  {Object.entries(permissionsGrouped).map(([module, perms]) => {
                    const modulePermIds = perms.map((p) => p.id)
                    const allSelected = modulePermIds.every((id) => formPermissionIds.includes(id))
                    const someSelected = modulePermIds.some((id) => formPermissionIds.includes(id))
                    return (
                      <div key={module}>
                        <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = !allSelected && someSelected
                            }}
                            onChange={() => toggleModule(module)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-sm font-semibold text-gray-700">
                            {moduleNames[module] || module}
                          </span>
                          <span className="text-xs text-gray-400">({perms.length})</span>
                        </label>
                        <div className="ml-6 grid grid-cols-2 gap-1">
                          {perms.map((perm) => (
                            <label key={perm.id} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                              <input
                                type="checkbox"
                                checked={formPermissionIds.includes(perm.id)}
                                onChange={() => togglePermission(perm.id)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                              <span className="text-xs text-gray-600">{perm.name}</span>
                              {perm.type === 'menu' && (
                                <span className="text-[10px] text-blue-500 bg-blue-50 px-1 rounded">菜单</span>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4 flex-shrink-0">
              <button onClick={() => setShowModal(false)} className="px-5 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {editingRole ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">确认删除</h3>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4">
              {error && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
              <p className="text-sm text-gray-600">
                确定要删除角色 <span className="font-semibold text-gray-800">{deleteTarget.name}</span>（{deleteTarget.code}）吗？
              </p>
              <p className="text-xs text-gray-400 mt-2">此操作不可撤销，删除后该角色的权限配置将丢失。</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button onClick={() => setDeleteTarget(null)} className="px-5 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
