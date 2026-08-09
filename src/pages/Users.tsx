import { useState, useEffect } from 'react'
import { api } from '../api'
import { usePermission } from '../hooks/usePermission'
import { useAuthStore } from '../store/auth'
import { Plus, Search, Users as UsersIcon, X, Loader2, Pencil, KeyRound, Trash2, UserX } from 'lucide-react'

interface UserRole {
  id: string
  name: string
  code: string
}

interface UserItem {
  id: string
  email: string
  name: string
  phone: string
  status: number
  last_login_at: string | null
  created_at: string
  roles: UserRole[]
}

interface RoleItem {
  id: string
  name: string
  code: string
  is_system: boolean
}

// ─── 辅助：格式化日期 ─────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '从未登录'
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN')
}

// ─── 辅助：角色 pill 样式 ─────────────────────────────────────
function rolePillClass(code: string): string {
  if (code === 'admin') return 'bg-indigo-100 text-indigo-700'
  return 'bg-blue-100 text-blue-700'
}

export default function Users() {
  const { hasPermission } = usePermission()
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [users, setUsers] = useState<UserItem[]>([])
  const [roles, setRoles] = useState<RoleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null)
  const [resetTarget, setResetTarget] = useState<UserItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 表单状态
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formStatus, setFormStatus] = useState(1)
  const [formRoleIds, setFormRoleIds] = useState<string[]>([])

  // 重置密码表单
  const [newPassword, setNewPassword] = useState('')

  const canEdit = hasPermission('users:edit')
  const canDelete = hasPermission('users:delete')
  const canCreate = hasPermission('users:create')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [usersData, rolesData] = await Promise.all([api.users.getAll(), api.roles.getAll()])
      setUsers(usersData)
      setRoles(rolesData)
    } catch (err: any) {
      setError(err.message || '加载数据失败')
    } finally {
      setLoading(false)
    }
  }

  const openCreate = () => {
    setEditingUser(null)
    setFormName('')
    setFormEmail('')
    setFormPhone('')
    setFormPassword('')
    setFormStatus(1)
    setFormRoleIds([])
    setError('')
    setShowModal(true)
  }

  const openEdit = (user: UserItem) => {
    setEditingUser(user)
    setFormName(user.name)
    setFormEmail(user.email)
    setFormPhone(user.phone)
    setFormPassword('')
    setFormStatus(user.status)
    setFormRoleIds(user.roles.map((r) => r.id))
    setError('')
    setShowModal(true)
  }

  const handleSubmit = async () => {
    setError('')
    if (!formName.trim()) {
      setError('请输入姓名')
      return
    }
    if (!formPhone.trim()) {
      setError('请输入手机号')
      return
    }
    if (!editingUser && !formPassword) {
      setError('请输入密码')
      return
    }
    if (formPassword && formPassword.length < 6) {
      setError('密码长度不能少于6位')
      return
    }

    setSubmitting(true)
    try {
      if (editingUser) {
        await api.users.update(editingUser.id, {
          name: formName,
          email: formEmail,
          phone: formPhone,
          status: formStatus,
          roleIds: formRoleIds,
        })
      } else {
        await api.users.create({
          name: formName,
          email: formEmail,
          phone: formPhone,
          password: formPassword,
          roleIds: formRoleIds,
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
      await api.users.delete(deleteTarget.id)
      setDeleteTarget(null)
      fetchData()
    } catch (err: any) {
      setError(err.message || '删除失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetTarget) return
    if (!newPassword || newPassword.length < 6) {
      setError('密码长度不能少于6位')
      return
    }
    setSubmitting(true)
    try {
      await api.users.resetPassword(resetTarget.id, newPassword)
      setResetTarget(null)
      setNewPassword('')
      setError('')
    } catch (err: any) {
      setError(err.message || '重置失败')
    } finally {
      setSubmitting(false)
    }
  }

  const toggleRole = (roleId: string) => {
    setFormRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId]
    )
  }

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.phone || '').toLowerCase().includes(searchTerm.toLowerCase())
  )

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
            <UsersIcon size={24} className="text-primary-600" />
            用户管理
          </h1>
          <p className="text-gray-500 mt-1">管理系统用户账号和角色分配</p>
        </div>
        {canCreate && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors shadow-sm"
          >
            <Plus size={20} />
            新增用户
          </button>
        )}
      </div>

      {/* 搜索栏 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-4">
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索姓名/邮箱/手机号..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* 用户列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">姓名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">邮箱</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">手机</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">角色</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">最后登录</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map((user) => {
                const isActive = user.status === 1
                const isSelf = user.id === currentUserId
                return (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    {/* 姓名 + 头像 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${isActive ? 'bg-gradient-to-br from-primary-500 to-blue-600' : 'bg-gradient-to-br from-gray-400 to-gray-500'}`}>
                          {user.name.charAt(0) || '?'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800 truncate">{user.name}</span>
                            {isSelf && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 font-medium">我</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* 邮箱 */}
                    <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                    {/* 手机 */}
                    <td className="px-4 py-3 text-sm text-gray-600">{user.phone || <span className="text-gray-300">-</span>}</td>
                    {/* 角色 */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(!user.roles || user.roles.length === 0) ? (
                          <span className="text-xs text-gray-400">未分配</span>
                        ) : (
                          user.roles.map((role) => (
                            <span key={role.id} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rolePillClass(role.code)}`}>
                              {role.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    {/* 状态 */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isActive ? 'bg-green-500' : 'bg-red-500'}`} />
                        {isActive ? '启用' : '禁用'}
                      </span>
                    </td>
                    {/* 最后登录 */}
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(user.last_login_at)}</td>
                    {/* 操作 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <button
                            onClick={() => openEdit(user)}
                            className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            title="编辑用户"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => { setResetTarget(user); setNewPassword(''); setError('') }}
                            className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="重置密码"
                          >
                            <KeyRound size={16} />
                          </button>
                        )}
                        {canDelete && !isSelf && (
                          <button
                            onClick={() => setDeleteTarget(user)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="删除用户"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* 空状态 */}
          {filteredUsers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <UserX size={48} className="mb-3 text-gray-300" />
              <p className="text-sm">{searchTerm ? '没有找到匹配的用户' : '暂无用户数据'}</p>
            </div>
          )}
        </div>

        {/* 底部统计 */}
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500">
          共 <span className="font-semibold text-gray-700">{filteredUsers.length}</span> 个用户
          {searchTerm && users.length !== filteredUsers.length && (
            <span className="ml-1">（筛选自 {users.length} 个）</span>
          )}
        </div>
      </div>

      {/* 创建/编辑 Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingUser ? '编辑用户' : '新增用户'}
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">手机 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="请输入手机号"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
                <input
                  type="text"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="选填"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">密码 <span className="text-red-500">*</span></label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder="至少6位"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">角色分配</label>
                <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                  {roles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formRoleIds.includes(role.id)}
                        onChange={() => toggleRole(role.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-gray-700">{role.name}</span>
                      {role.is_system && (
                        <span className="text-xs text-gray-400">（系统）</span>
                      )}
                      <span className="text-xs text-gray-400">{role.code}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editingUser && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formStatus === 1}
                      onChange={(e) => setFormStatus(e.target.checked ? 1 : 0)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700">启用账号</span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button onClick={() => setShowModal(false)} className="px-5 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {editingUser ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重置密码 Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setResetTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">重置密码</h3>
              <button onClick={() => setResetTarget(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}
              <p className="text-sm text-gray-600">
                正在为 <span className="font-semibold">{resetTarget.name}</span>（{resetTarget.email}）重置密码
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少6位"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button onClick={() => setResetTarget(null)} className="px-5 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleResetPassword}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                确认重置
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
                确定要删除用户 <span className="font-semibold text-gray-800">{deleteTarget.name}</span>（{deleteTarget.email}）吗？
              </p>
              <p className="text-xs text-gray-400 mt-2">此操作不可撤销，删除后该用户将无法登录。</p>
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
