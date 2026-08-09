/**
 * 用户管理 CRUD 路由
 *
 * - GET    /api/users              用户列表（含角色信息）
 * - GET    /api/users/:id          用户详情（含角色列表）
 * - POST   /api/users              创建用户（email, name, phone, password, roleIds[]）
 * - PUT    /api/users/:id          编辑用户（name, phone, status, roleIds[]）
 * - PUT    /api/users/:id/password 重置密码
 * - DELETE /api/users/:id          删除用户
 */
import { Router } from 'express'
import { randomUUID } from 'crypto'
import { asyncHandler } from '../asyncHandler.js'
import { pool } from '../dbClient.js'
import { hashPassword } from '../services/auth.js'
import { invalidatePermissionCache } from '../services/rbac.js'
import { requirePermission } from '../middleware/auth.js'

export const usersRouter = Router()

/**
 * GET /api/users
 * 用户列表，每行附带 roles 数组
 */
usersRouter.get(
  '/',
  requirePermission('users:view'),
  asyncHandler(async (_req, res) => {
    const [users] = await pool.execute(
      `SELECT id, email, name, phone, status, last_login_at, created_at, updated_at FROM users ORDER BY created_at DESC`
    )
    const userList = users as any[]

    // 批量查询角色关联
    const [userRoles] = await pool.execute(
      `SELECT ur.user_id, r.id AS role_id, r.name AS role_name, r.code AS role_code
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id`
    )
    const roleMap: Record<string, { id: string; name: string; code: string }[]> = {}
    for (const ur of userRoles as any[]) {
      if (!roleMap[ur.user_id]) roleMap[ur.user_id] = []
      roleMap[ur.user_id].push({ id: ur.role_id, name: ur.role_name, code: ur.role_code })
    }

    res.json(
      userList.map((u) => ({
        ...u,
        roles: roleMap[u.id] || [],
      }))
    )
  })
)

/**
 * GET /api/users/:id
 * 用户详情（含角色列表）
 */
usersRouter.get(
  '/:id',
  requirePermission('users:view'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const [rows] = await pool.execute(
      'SELECT id, email, name, phone, status, last_login_at, created_at, updated_at FROM users WHERE id = ?',
      [id]
    )
    const user = (rows as any[])[0]
    if (!user) {
      return res.status(404).json({ error: '用户不存在' })
    }

    const [roleRows] = await pool.execute(
      `SELECT r.id, r.name, r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [id]
    )

    res.json({ ...user, roles: roleRows })
  })
)

/**
 * POST /api/users
 * 创建用户
 */
usersRouter.post(
  '/',
  requirePermission('users:create'),
  asyncHandler(async (req, res) => {
    const { email, name, phone, password, roleIds } = req.body || {}

    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码为必填项' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度不能少于6位' })
    }

    // 检查手机号唯一性
    const [existingPhone] = await pool.execute('SELECT id FROM users WHERE phone = ?', [phone])
    if ((existingPhone as any[]).length > 0) {
      return res.status(409).json({ error: '该手机号已被注册' })
    }

    // 邮箱非必填，但若填写则检查唯一性
    if (email) {
      const [existingEmail] = await pool.execute('SELECT id FROM users WHERE email = ?', [email])
      if ((existingEmail as any[]).length > 0) {
        return res.status(409).json({ error: '该邮箱已被注册' })
      }
    }

    const userId = randomUUID()
    const passwordHash = hashPassword(password)

    await pool.execute(
      'INSERT INTO users (id, email, password_hash, name, phone, status) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, email || '', passwordHash, name || '', phone, 1]
    )

    // 分配角色
    if (Array.isArray(roleIds) && roleIds.length > 0) {
      for (const roleId of roleIds) {
        await pool.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
      }
      invalidatePermissionCache(userId)
    }

    res.status(201).json({ id: userId, email, name: name || '', phone: phone || '', message: '用户创建成功' })
  })
)

/**
 * PUT /api/users/:id
 * 编辑用户信息（不含密码），可同时更新角色
 */
usersRouter.put(
  '/:id',
  requirePermission('users:edit'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const { email, name, phone, status, roleIds } = req.body || {}

    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [id])
    if ((rows as any[]).length === 0) {
      return res.status(404).json({ error: '用户不存在' })
    }

    // 若修改了手机号，检查唯一性（排除当前用户）
    if (phone) {
      const [existingPhone] = await pool.execute(
        'SELECT id FROM users WHERE phone = ? AND id != ?',
        [phone, id]
      )
      if ((existingPhone as any[]).length > 0) {
        return res.status(409).json({ error: '该手机号已被注册' })
      }
    }

    // 若修改了邮箱（非空），检查唯一性（排除当前用户）
    if (email) {
      const [existingEmail] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      )
      if ((existingEmail as any[]).length > 0) {
        return res.status(409).json({ error: '该邮箱已被注册' })
      }
    }

    await pool.execute(
      'UPDATE users SET email = ?, name = ?, phone = ?, status = ?, updated_at = NOW() WHERE id = ?',
      [email ?? '', name ?? '', phone ?? '', status ?? 1, id]
    )

    // 更新角色关联（先删后插）
    if (Array.isArray(roleIds)) {
      await pool.execute('DELETE FROM user_roles WHERE user_id = ?', [id])
      for (const roleId of roleIds) {
        await pool.execute('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, roleId])
      }
      invalidatePermissionCache(id)
    }

    res.json({ message: '用户更新成功' })
  })
)

/**
 * PUT /api/users/:id/password
 * 重置密码（管理员操作，无需旧密码）
 */
usersRouter.put(
  '/:id/password',
  requirePermission('users:edit'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const { newPassword } = req.body || {}

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于6位' })
    }

    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [id])
    if ((rows as any[]).length === 0) {
      return res.status(404).json({ error: '用户不存在' })
    }

    const passwordHash = hashPassword(newPassword)
    await pool.execute('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [passwordHash, id])

    res.json({ message: '密码重置成功' })
  })
)

/**
 * DELETE /api/users/:id
 * 删除用户（防止删除自己）
 */
usersRouter.delete(
  '/:id',
  requirePermission('users:delete'),
  asyncHandler(async (req, res) => {
    const { id } = req.params

    // 不能删除自己
    if (req.user!.id === id) {
      return res.status(400).json({ error: '不能删除当前登录用户' })
    }

    const [rows] = await pool.execute('SELECT id FROM users WHERE id = ?', [id])
    if ((rows as any[]).length === 0) {
      return res.status(404).json({ error: '用户不存在' })
    }

    // 删除关联数据和用户
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', [id])
    await pool.execute('DELETE FROM users WHERE id = ?', [id])
    invalidatePermissionCache(id)

    res.json({ message: '用户删除成功' })
  })
)
