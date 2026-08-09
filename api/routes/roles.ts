/**
 * 角色管理 CRUD 路由
 *
 * - GET    /api/roles          角色列表（含权限数、用户数）
 * - GET    /api/roles/:id      角色详情（含权限 ID 列表）
 * - POST   /api/roles          创建角色（name, code, description, permissionIds[]）
 * - PUT    /api/roles/:id      编辑角色（name, description, permissionIds[]）
 * - DELETE /api/roles/:id      删除角色（系统角色不可删，有用户关联时不可删）
 */
import { Router } from 'express'
import { randomUUID } from 'crypto'
import { asyncHandler } from '../asyncHandler.js'
import { pool } from '../dbClient.js'
import { invalidatePermissionCache } from '../services/rbac.js'
import { requirePermission } from '../middleware/auth.js'

export const rolesRouter = Router()

/**
 * GET /api/roles
 * 角色列表，含每个角色的权限数和用户数
 */
rolesRouter.get(
  '/',
  requirePermission('roles:view'),
  asyncHandler(async (_req, res) => {
    const [roles] = await pool.execute(
      'SELECT id, name, code, description, is_system, created_at, updated_at FROM roles ORDER BY is_system DESC, created_at ASC'
    )

    // 批量统计权限数
    const [permCounts] = await pool.execute(
      'SELECT role_id, COUNT(*) AS cnt FROM role_permissions GROUP BY role_id'
    )
    const permMap: Record<string, number> = {}
    for (const p of permCounts as any[]) {
      permMap[p.role_id] = p.cnt
    }

    // 批量统计用户数
    const [userCounts] = await pool.execute(
      'SELECT role_id, COUNT(*) AS cnt FROM user_roles GROUP BY role_id'
    )
    const userMap: Record<string, number> = {}
    for (const u of userCounts as any[]) {
      userMap[u.role_id] = u.cnt
    }

    res.json(
      (roles as any[]).map((r) => ({
        ...r,
        is_system: !!r.is_system,
        permission_count: permMap[r.id] || 0,
        user_count: userMap[r.id] || 0,
      }))
    )
  })
)

/**
 * GET /api/roles/:id
 * 角色详情，含权限 ID 列表
 */
rolesRouter.get(
  '/:id',
  requirePermission('roles:view'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const [rows] = await pool.execute(
      'SELECT id, name, code, description, is_system, created_at, updated_at FROM roles WHERE id = ?',
      [id]
    )
    const role = (rows as any[])[0]
    if (!role) {
      return res.status(404).json({ error: '角色不存在' })
    }

    const [permRows] = await pool.execute(
      'SELECT permission_id FROM role_permissions WHERE role_id = ?',
      [id]
    )

    res.json({
      ...role,
      is_system: !!role.is_system,
      permissionIds: (permRows as any[]).map((p) => p.permission_id),
    })
  })
)

/**
 * POST /api/roles
 * 创建角色
 */
rolesRouter.post(
  '/',
  requirePermission('roles:create'),
  asyncHandler(async (req, res) => {
    const { name, code, description, permissionIds } = req.body || {}

    if (!name || !code) {
      return res.status(400).json({ error: '角色名称和编码为必填项' })
    }

    // 检查 code 唯一性
    const [existing] = await pool.execute('SELECT id FROM roles WHERE code = ?', [code])
    if ((existing as any[]).length > 0) {
      return res.status(409).json({ error: '角色编码已存在' })
    }

    const roleId = randomUUID()
    await pool.execute(
      'INSERT INTO roles (id, name, code, description, is_system) VALUES (?, ?, ?, ?, ?)',
      [roleId, name, code, description || '', 0]
    )

    // 分配权限
    if (Array.isArray(permissionIds) && permissionIds.length > 0) {
      for (const permId of permissionIds) {
        await pool.execute('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, permId])
      }
    }

    res.status(201).json({ id: roleId, name, code, message: '角色创建成功' })
  })
)

/**
 * PUT /api/roles/:id
 * 编辑角色（系统角色不可改 code）
 */
rolesRouter.put(
  '/:id',
  requirePermission('roles:edit'),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const { name, description, permissionIds } = req.body || {}

    const [rows] = await pool.execute('SELECT id, is_system FROM roles WHERE id = ?', [id])
    const role = (rows as any[])[0]
    if (!role) {
      return res.status(404).json({ error: '角色不存在' })
    }

    await pool.execute(
      'UPDATE roles SET name = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [name ?? '', description ?? '', id]
    )

    // 更新权限关联（先删后插）
    if (Array.isArray(permissionIds)) {
      await pool.execute('DELETE FROM role_permissions WHERE role_id = ?', [id])
      for (const permId of permissionIds) {
        await pool.execute('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [id, permId])
      }
      // 权限变更影响所有关联用户，清除全部缓存
      invalidatePermissionCache()
    }

    res.json({ message: '角色更新成功' })
  })
)

/**
 * DELETE /api/roles/:id
 * 删除角色（系统角色不可删，有用户关联时不可删）
 */
rolesRouter.delete(
  '/:id',
  requirePermission('roles:delete'),
  asyncHandler(async (req, res) => {
    const { id } = req.params

    const [rows] = await pool.execute('SELECT id, is_system FROM roles WHERE id = ?', [id])
    const role = (rows as any[])[0]
    if (!role) {
      return res.status(404).json({ error: '角色不存在' })
    }
    if (role.is_system) {
      return res.status(400).json({ error: '系统内置角色不可删除' })
    }

    // 检查是否有用户关联
    const [userRows] = await pool.execute('SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = ?', [id])
    if ((userRows as any[])[0].cnt > 0) {
      return res.status(400).json({ error: '该角色下仍有用户，无法删除' })
    }

    await pool.execute('DELETE FROM role_permissions WHERE role_id = ?', [id])
    await pool.execute('DELETE FROM roles WHERE id = ?', [id])

    res.json({ message: '角色删除成功' })
  })
)
