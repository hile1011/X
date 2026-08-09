/**
 * 认证与权限校验中间件
 *
 * - authenticate: 验证 JWT access token，附加 req.user 和 req.permissions
 * - requirePermission(code): 要求当前用户拥有指定权限码
 * - requireAnyPermission(...codes): 拥有任一权限即可
 * - requireRole(code): 要求当前用户拥有指定角色编码
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { verifyAccessToken } from '../services/auth.js'
import { getUserPermissions, getUserRoles } from '../services/rbac.js'
import '../types/auth.js'

/**
 * 认证中间件：验证 JWT access token。
 * 验证通过后附加 req.user（{id,email,name}）和 req.permissions（Set<string>）。
 * AUTH_ENABLED 环境变量为 'false' 时跳过认证（用于灰度启用）。
 */
export const authenticate: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  // 灰度开关：AUTH_ENABLED=false 时跳过认证（开发/过渡期使用）
  if (process.env.AUTH_ENABLED === 'false') {
    return next()
  }

  // 优先从 Authorization 头获取 token；其次从 query 参数获取（用于 <img> 标签加载图片等无法设置请求头的场景）
  const authHeader = req.headers.authorization
  let token: string | undefined
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
  } else if (typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token
  }

  if (!token) {
    return res.status(401).json({ error: '未提供认证凭证' })
  }

  const payload = verifyAccessToken(token)
  if (!payload) {
    return res.status(401).json({ error: 'token 无效或已过期' })
  }

  // 附加用户信息
  req.user = { id: payload.sub, email: payload.email, name: payload.name }

  // 实时查询权限（带 30s 缓存）
  try {
    req.permissions = await getUserPermissions(payload.sub)
  } catch {
    // 权限查询失败不阻断请求（降级为空权限集，后续 requirePermission 会拦截）
    req.permissions = new Set<string>()
  }

  next()
}

/**
 * 权限校验中间件工厂：要求当前用户拥有指定权限码。
 * 需配合 authenticate 使用。
 */
export function requirePermission(perm: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.permissions || !req.permissions.has(perm)) {
      return res.status(403).json({ error: '权限不足', required: perm })
    }
    next()
  }
}

/**
 * 权限校验中间件工厂：拥有任一权限即可通过。
 */
export function requireAnyPermission(...perms: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.permissions || !perms.some((p) => req.permissions!.has(p))) {
      return res.status(403).json({ error: '权限不足', required: perms })
    }
    next()
  }
}

/**
 * 角色校验中间件工厂：要求当前用户拥有指定角色编码。
 */
export function requireRole(roleCode: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: '未认证' })
    }
    try {
      const roles = await getUserRoles(req.user.id)
      if (!roles.includes(roleCode)) {
        return res.status(403).json({ error: `需要 ${roleCode} 角色` })
      }
    } catch {
      return res.status(500).json({ error: '角色查询失败' })
    }
    next()
  }
}
