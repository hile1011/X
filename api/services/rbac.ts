/**
 * RBAC 权限聚合查询：用户 → 角色 → 权限
 *
 * 提供带 TTL 的内存缓存，权限变更时通过 invalidatePermissionCache() 失效。
 */
import { pool } from '../dbClient.js'

/** 内存缓存：userId → { permissions, expireAt } */
const permCache = new Map<string, { permissions: Set<string>; expireAt: number }>()
/** 内存缓存：userId → { roles, expireAt } */
const roleCache = new Map<string, { roles: string[]; expireAt: number }>()

const CACHE_TTL_MS = 30 * 1000 // 30 秒

/**
 * 获取用户的所有权限码（多角色取并集）。
 * 使用 30 秒内存缓存，减少高频请求的 DB 查询。
 */
export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const cached = permCache.get(userId)
  if (cached && cached.expireAt > Date.now()) {
    return cached.permissions
  }

  const [rows] = await pool.execute(
    `SELECT DISTINCT p.code
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ?`,
    [userId]
  )
  const perms = new Set<string>((rows as any[]).map((r) => r.code))
  permCache.set(userId, { permissions: perms, expireAt: Date.now() + CACHE_TTL_MS })
  return perms
}

/**
 * 获取用户的所有角色编码列表。
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  const cached = roleCache.get(userId)
  if (cached && cached.expireAt > Date.now()) {
    return cached.roles
  }

  const [rows] = await pool.execute(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    [userId]
  )
  const roles = (rows as any[]).map((r) => r.code)
  roleCache.set(userId, { roles, expireAt: Date.now() + CACHE_TTL_MS })
  return roles
}

/**
 * 判断用户是否拥有指定权限码。
 */
export async function userHasPermission(userId: string, permCode: string): Promise<boolean> {
  const perms = await getUserPermissions(userId)
  return perms.has(permCode)
}

/**
 * 判断用户是否拥有指定角色编码。
 */
export async function userHasRole(userId: string, roleCode: string): Promise<boolean> {
  const roles = await getUserRoles(userId)
  return roles.includes(roleCode)
}

/**
 * 清除权限缓存。
 * - 传入 userId：仅清除该用户的权限和角色缓存
 * - 不传：清除全部缓存（角色/权限变更影响所有用户时使用）
 */
export function invalidatePermissionCache(userId?: string): void {
  if (userId) {
    permCache.delete(userId)
    roleCache.delete(userId)
  } else {
    permCache.clear()
    roleCache.clear()
  }
}
