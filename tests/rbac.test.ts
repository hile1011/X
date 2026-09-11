/**
 * RBAC 权限聚合服务单元测试 (api/services/rbac.ts)
 *
 * 测试目标：
 *   - getUserPermissions：默认管理员拥有全部 41 项权限
 *   - getUserRoles：默认管理员拥有 admin 角色
 *   - userHasPermission / userHasRole 判断函数
 *   - 多角色权限并集
 *   - 内存缓存：相同 userId 第二次查询命中缓存
 *   - invalidatePermissionCache：清除缓存后重新查询
 *   - 无角色用户返回空权限集
 *
 * 使用 MySQL 测试数据库，每个测试前 resetTestDatabase() 保证隔离性。
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import {
  getUserPermissions,
  getUserRoles,
  userHasPermission,
  userHasRole,
  invalidatePermissionCache,
} from '../api/services/rbac'

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
  // 清除缓存，确保每个测试读取最新数据库状态
  invalidatePermissionCache()
})

/** 创建测试用户并分配指定角色 */
async function createTestUser(userId: string, email: string, roleCodes: string[]): Promise<void> {
  // 插入用户
  await pool.execute(
    'INSERT INTO users (id, email, password_hash, name, status) VALUES (?, ?, ?, ?, ?)',
    [userId, email, 'test-hash', '测试用户', 1]
  )
  // 分配角色
  for (const code of roleCodes) {
    const [rows] = await pool.execute('SELECT id FROM roles WHERE code = ?', [code])
    const roleId = (rows as any[])[0]?.id
    if (roleId) {
      await pool.execute(
        'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, roleId]
      )
    }
  }
}

/** 创建自定义角色并分配指定权限 */
async function createTestRole(roleCode: string, permCodes: string[]): Promise<void> {
  const roleId = `role-test-${roleCode}`
  await pool.execute(
    'INSERT INTO roles (id, name, code, description, is_system) VALUES (?, ?, ?, ?, ?)',
    [roleId, `测试角色-${roleCode}`, roleCode, '测试用', 0]
  )
  for (const code of permCodes) {
    const [rows] = await pool.execute('SELECT id FROM permissions WHERE code = ?', [code])
    const permId = (rows as any[])[0]?.id
    if (permId) {
      await pool.execute(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        [roleId, permId]
      )
    }
  }
}

// ============================================================
// getUserPermissions / getUserRoles（默认管理员）
// ============================================================
describe('默认管理员 RBAC 查询', () => {
  it('getUserPermissions 返回全部 50 项权限', async () => {
    const perms = await getUserPermissions('user-admin-default')
    expect(perms.size).toBe(50)
    expect(perms.has('dashboard:view')).toBe(true)
    expect(perms.has('quotes:view')).toBe(true)
    expect(perms.has('quotes:edit')).toBe(true)
    expect(perms.has('quotes:quick-edit')).toBe(true)
    expect(perms.has('quotes:delete')).toBe(true)
    expect(perms.has('system:admin')).toBe(true)
    // v30 模块权限
    expect(perms.has('production-tracking:view')).toBe(true)
    expect(perms.has('production-tracking:edit')).toBe(true)
    expect(perms.has('reconciliation:view')).toBe(true)
    expect(perms.has('reconciliation:edit')).toBe(true)
    expect(perms.has('reconciliation:execute')).toBe(true)
    expect(perms.has('annual-report:view')).toBe(true)
  })

  it('getUserRoles 返回 admin 角色', async () => {
    const roles = await getUserRoles('user-admin-default')
    expect(roles).toContain('admin')
    expect(roles).toHaveLength(1)
  })

  it('userHasPermission 对已有权限返回 true', async () => {
    expect(await userHasPermission('user-admin-default', 'quotes:view')).toBe(true)
    expect(await userHasPermission('user-admin-default', 'quotes:edit')).toBe(true)
    expect(await userHasPermission('user-admin-default', 'system:admin')).toBe(true)
  })

  it('userHasPermission 对不存在权限返回 false', async () => {
    expect(await userHasPermission('user-admin-default', 'nonexistent:perm')).toBe(false)
  })

  it('userHasRole 对 admin 返回 true', async () => {
    expect(await userHasRole('user-admin-default', 'admin')).toBe(true)
  })

  it('userHasRole 对不存在角色返回 false', async () => {
    expect(await userHasRole('user-admin-default', 'superadmin')).toBe(false)
  })
})

// ============================================================
// 无角色用户
// ============================================================
describe('无角色用户', () => {
  it('getUserPermissions 返回空集', async () => {
    await createTestUser('user-norole', 'norole@test.com', [])
    const perms = await getUserPermissions('user-norole')
    expect(perms.size).toBe(0)
  })

  it('getUserRoles 返回空数组', async () => {
    await createTestUser('user-norole', 'norole@test.com', [])
    const roles = await getUserRoles('user-norole')
    expect(roles).toHaveLength(0)
  })

  it('userHasPermission 返回 false', async () => {
    await createTestUser('user-norole', 'norole@test.com', [])
    expect(await userHasPermission('user-norole', 'quotes:view')).toBe(false)
  })
})

// ============================================================
// 多角色权限并集
// ============================================================
describe('多角色权限并集', () => {
  it('用户拥有多个角色时权限取并集', async () => {
    // 创建两个自定义角色，各分配不同的权限
    await createTestRole('viewer', ['quotes:view', 'dashboard:view'])
    await createTestRole('editor', ['quotes:edit', 'quotes:create'])

    // 创建用户并分配两个角色
    await createTestUser('user-multi', 'multi@test.com', ['viewer', 'editor'])

    const perms = await getUserPermissions('user-multi')
    expect(perms.size).toBe(4)
    expect(perms.has('quotes:view')).toBe(true)
    expect(perms.has('dashboard:view')).toBe(true)
    expect(perms.has('quotes:edit')).toBe(true)
    expect(perms.has('quotes:create')).toBe(true)
    // 不应包含未分配的权限
    expect(perms.has('quotes:delete')).toBe(false)
  })

  it('用户拥有 admin 角色和自定义角色时，权限仍为并集', async () => {
    await createTestRole('viewer', ['quotes:view'])
    await createTestUser('user-admin-plus', 'adminplus@test.com', ['admin', 'viewer'])

    const perms = await getUserPermissions('user-admin-plus')
    // admin 有 50 项 + viewer 的 quotes:view 已在 admin 中，所以仍为 50
    expect(perms.size).toBe(50)

    const roles = await getUserRoles('user-admin-plus')
    expect(roles).toHaveLength(2)
    expect(roles).toContain('admin')
    expect(roles).toContain('viewer')
  })
})

// ============================================================
// 内存缓存
// ============================================================
describe('内存缓存', () => {
  it('相同 userId 第二次查询命中缓存（不查数据库）', async () => {
    // 第一次查询：命中数据库
    const perms1 = await getUserPermissions('user-admin-default')
    expect(perms1.size).toBe(50)

    // 在数据库中删除管理员的角色关联（模拟数据变更）
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', ['user-admin-default'])

    // 第二次查询：应返回缓存结果（仍有 43 项权限，因为缓存未失效）
    const perms2 = await getUserPermissions('user-admin-default')
    expect(perms2.size).toBe(50)
  })

  it('invalidatePermissionCache(userId) 清除指定用户缓存后重新查询', async () => {
    // 第一次查询：填充缓存
    const perms1 = await getUserPermissions('user-admin-default')
    expect(perms1.size).toBe(50)

    // 删除角色关联
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', ['user-admin-default'])

    // 清除缓存
    invalidatePermissionCache('user-admin-default')

    // 第二次查询：缓存已清除，重新查数据库 → 权限为空
    const perms2 = await getUserPermissions('user-admin-default')
    expect(perms2.size).toBe(0)
  })

  it('invalidatePermissionCache() 清除全部缓存', async () => {
    // 填充两个用户的缓存
    await getUserPermissions('user-admin-default')
    await getUserRoles('user-admin-default')

    // 清除全部缓存
    invalidatePermissionCache()

    // 删除角色关联
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', ['user-admin-default'])

    // 重新查询应反映数据库的最新状态
    const perms = await getUserPermissions('user-admin-default')
    expect(perms.size).toBe(0)
  })

  it('角色缓存也受 invalidatePermissionCache 控制', async () => {
    // 第一次查询角色：填充缓存
    const roles1 = await getUserRoles('user-admin-default')
    expect(roles1).toContain('admin')

    // 删除角色关联
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', ['user-admin-default'])

    // 清除缓存
    invalidatePermissionCache('user-admin-default')

    // 重新查询角色 → 应为空
    const roles2 = await getUserRoles('user-admin-default')
    expect(roles2).toHaveLength(0)
  })

  it('getUserRoles 第二次查询命中角色缓存（不查数据库）', async () => {
    // 第一次查询：填充角色缓存
    const roles1 = await getUserRoles('user-admin-default')
    expect(roles1).toContain('admin')

    // 数据库删除角色关联（模拟数据变更）
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', ['user-admin-default'])

    // 第二次查询：命中缓存，仍返回 admin
    const roles2 = await getUserRoles('user-admin-default')
    expect(roles2).toContain('admin')
  })

  it('缓存 TTL（30 秒）过期后重新查数据库', async () => {
    // 第一次查询：填充权限与角色缓存
    const perms1 = await getUserPermissions('user-admin-default')
    expect(perms1.size).toBe(50)
    const roles1 = await getUserRoles('user-admin-default')
    expect(roles1).toContain('admin')

    // 数据库删除角色关联（模拟数据变更）
    await pool.execute('DELETE FROM user_roles WHERE user_id = ?', ['user-admin-default'])

    // 时间前进 31 秒（超过 30 秒 TTL）
    const realNow = Date.now
    const offset = 31 * 1000
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset)
    try {
      // TTL 过期 → 重新查数据库 → 数据已变更为空
      const perms2 = await getUserPermissions('user-admin-default')
      expect(perms2.size).toBe(0)
      const roles2 = await getUserRoles('user-admin-default')
      expect(roles2).toHaveLength(0)
    } finally {
      vi.restoreAllMocks()
    }
  })
})

// ============================================================
// 不存在的用户
// ============================================================
describe('不存在的用户', () => {
  it('getUserPermissions 返回空集', async () => {
    const perms = await getUserPermissions('nonexistent-user')
    expect(perms.size).toBe(0)
  })

  it('getUserRoles 返回空数组', async () => {
    const roles = await getUserRoles('nonexistent-user')
    expect(roles).toHaveLength(0)
  })
})
