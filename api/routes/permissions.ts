/**
 * 权限目录查询路由
 *
 * - GET /api/permissions  返回全部权限目录（按 module 分组），供角色管理界面使用
 */
import { Router } from 'express'
import { asyncHandler } from '../asyncHandler.js'
import { pool } from '../dbClient.js'

export const permissionsRouter = Router()

/**
 * GET /api/permissions
 * 返回权限目录，按 module 分组，按 sort_order 排序
 */
permissionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.execute(
      'SELECT id, code, name, module, action, type, description, sort_order FROM permissions ORDER BY sort_order ASC, code ASC'
    )
    const perms = rows as any[]

    // 按 module 分组
    const grouped: Record<string, any[]> = {}
    for (const p of perms) {
      if (!grouped[p.module]) grouped[p.module] = []
      grouped[p.module].push(p)
    }

    res.json({
      permissions: perms,
      grouped,
    })
  })
)
