/**
 * 数据库迁移 v12 - add-auth-rbac 单元测试
 *
 * 测试目标：
 *   - 5 张 RBAC 表已创建（users, roles, permissions, role_permissions, user_roles）
 *   - 43 项权限目录已预置（v12-v20 初始目录，后续迁移按需追加至当前总数）
 *   - admin 角色拥有全部权限
 *   - 默认管理员账号存在且关联 admin 角色
 *   - 默认管理员密码可校验
 *   - 迁移幂等：重新执行不重复插入
 *   - down 迁移：回滚到 v11 后表被删除
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至最新版本。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'
import bcrypt from 'bcryptjs'

beforeAll(async () => {
  // 确保 schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
  await db.runner.migrate()
  // 重置数据：前一个测试文件可能修改了种子数据（如改密码），确保 fresh 数据
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

/**
 * 查询 MySQL 表的列名列表
 */
async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await db.db.prepare(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION'
  ).all(tableName)
  return rows.map((r: any) => r.COLUMN_NAME as string)
}

/** 检查表是否存在 */
async function tableExists(tableName: string): Promise<boolean> {
  const rows = await db.db.prepare(
    'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
  ).get(tableName) as { cnt: number }
  return rows.cnt > 0
}

// ============================================================
// Schema 结构 & 种子数据测试
// ============================================================
describe('迁移 v12 - add-auth-rbac 表结构', () => {
  it('5 张 RBAC 表已创建', async () => {
    expect(await tableExists('users')).toBe(true)
    expect(await tableExists('roles')).toBe(true)
    expect(await tableExists('permissions')).toBe(true)
    expect(await tableExists('role_permissions')).toBe(true)
    expect(await tableExists('user_roles')).toBe(true)
  })

  it('users 表包含必要字段', async () => {
    const columns = await getTableColumns('users')
    expect(columns).toContain('id')
    expect(columns).toContain('email')
    expect(columns).toContain('password_hash')
    expect(columns).toContain('name')
    expect(columns).toContain('status')
    expect(columns).toContain('last_login_at')
    expect(columns).toContain('created_at')
    expect(columns).toContain('updated_at')
  })

  it('roles 表包含 is_system 字段', async () => {
    const columns = await getTableColumns('roles')
    expect(columns).toContain('id')
    expect(columns).toContain('name')
    expect(columns).toContain('code')
    expect(columns).toContain('is_system')
  })

  it('permissions 表包含 module/action/type 字段', async () => {
    const columns = await getTableColumns('permissions')
    expect(columns).toContain('id')
    expect(columns).toContain('code')
    expect(columns).toContain('name')
    expect(columns).toContain('module')
    expect(columns).toContain('action')
    expect(columns).toContain('type')
    expect(columns).toContain('sort_order')
  })

  it('email 唯一索引：插入重复 email 报错', async () => {
    await expect(
      db.db.prepare(
        `INSERT INTO users (id, email, password_hash, name, status) VALUES (?, ?, ?, ?, ?)`
      ).run('dup-user', '517290808@qq.com', 'hash', '重复', 1)
    ).rejects.toThrow()
  })
})

describe('迁移 v12 - 权限目录种子数据', () => {
  it('预置 50 项权限（含 v29 双击编辑、v30 三个业务模块权限）', async () => {
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions').get() as { cnt: number }
    expect(row.cnt).toBe(50)
  })

  it('权限码格式为 module:action', async () => {
    const rows = await db.db.prepare('SELECT code FROM permissions').all() as { code: string }[]
    rows.forEach((r) => {
      expect(r.code).toMatch(/^[a-z-]+:[a-z-]+$/)
    })
  })

  it('包含核心订单权限', async () => {
    const rows = await db.db.prepare('SELECT code FROM permissions WHERE module = ?').all('quotes') as { code: string }[]
    const codes = rows.map((r) => r.code)
    expect(codes).toContain('quotes:view')
    expect(codes).toContain('quotes:create')
    expect(codes).toContain('quotes:edit')
    expect(codes).toContain('quotes:delete')
    expect(codes).toContain('quotes:copy')
    expect(codes).toContain('quotes:export')
    expect(codes).toContain('quotes:print')
    expect(codes).toContain('quotes:quick-edit')
  })

  it('包含 v30 业务模块权限（做货跟踪/订单对账/年度业务报表）', async () => {
    const rows = await db.db.prepare('SELECT code FROM permissions').all() as { code: string }[]
    const codes = rows.map((r) => r.code)
    expect(codes).toContain('production-tracking:view')
    expect(codes).toContain('production-tracking:edit')
    expect(codes).toContain('reconciliation:view')
    expect(codes).toContain('reconciliation:edit')
    expect(codes).toContain('reconciliation:execute')
    expect(codes).toContain('annual-report:view')
  })

  it('权限 code 唯一', async () => {
    const rows = await db.db.prepare('SELECT code, COUNT(*) as cnt FROM permissions GROUP BY code HAVING cnt > 1').all()
    expect(rows).toHaveLength(0)
  })
})

describe('迁移 v12 - admin 角色种子数据', () => {
  it('admin 角色存在且为系统角色', async () => {
    const role = await db.db.prepare('SELECT * FROM roles WHERE code = ?').get('admin') as any
    expect(role).toBeTruthy()
    expect(role.id).toBe('role-admin')
    expect(role.name).toBe('系统管理员')
    expect(role.is_system).toBe(1)
  })

  it('admin 角色拥有全部 50 项权限', async () => {
    const row = await db.db.prepare(
      'SELECT COUNT(*) as cnt FROM role_permissions WHERE role_id = ?'
    ).get('role-admin') as { cnt: number }
    expect(row.cnt).toBe(50)
  })

  it('roles code 唯一索引：插入重复 code 报错', async () => {
    await expect(
      db.db.prepare(
        `INSERT INTO roles (id, name, code, is_system) VALUES (?, ?, ?, ?)`
      ).run('dup-role', '重复角色', 'admin', 0)
    ).rejects.toThrow()
  })
})

describe('迁移 v12 - 默认管理员账号', () => {
  it('默认管理员账号存在', async () => {
    const user = await db.db.prepare('SELECT * FROM users WHERE email = ?').get('517290808@qq.com') as any
    expect(user).toBeTruthy()
    expect(user.id).toBe('user-admin-default')
    expect(user.name).toBe('管理员')
    expect(user.status).toBe(1)
  })

  it('默认管理员密码为 123456（bcrypt 可校验）', async () => {
    const user = await db.db.prepare('SELECT password_hash FROM users WHERE id = ?').get('user-admin-default') as any
    expect(bcrypt.compareSync('123456', user.password_hash)).toBe(true)
    expect(bcrypt.compareSync('wrong-password', user.password_hash)).toBe(false)
  })

  it('默认管理员关联 admin 角色', async () => {
    const row = await db.db.prepare(
      'SELECT COUNT(*) as cnt FROM user_roles WHERE user_id = ? AND role_id = ?'
    ).get('user-admin-default', 'role-admin') as { cnt: number }
    expect(row.cnt).toBe(1)
  })

  it('默认管理员通过 RBAC 拥有全部权限', async () => {
    const rows = await db.db.prepare(
      `SELECT COUNT(DISTINCT p.code) as cnt
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`
    ).get('user-admin-default') as { cnt: number }
    expect(rows.cnt).toBe(50)
  })
})

describe('迁移 v12 - 幂等性', () => {
  it('重新执行 migrate 不重复插入权限', async () => {
    await db.runner.migrate()
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions').get() as { cnt: number }
    expect(row.cnt).toBe(50)
  })

  it('重新执行 migrate 不重复插入 admin 角色', async () => {
    await db.runner.migrate()
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM roles WHERE code = ?').get('admin') as { cnt: number }
    expect(row.cnt).toBe(1)
  })

  it('重新执行 migrate 不重复插入默认管理员', async () => {
    await db.runner.migrate()
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM users WHERE email = ?').get('517290808@qq.com') as { cnt: number }
    expect(row.cnt).toBe(1)
  })

  it('Schema 版本为最新版本', async () => {
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })
})

// ============================================================
// 回滚测试（修改 schema，afterAll 中恢复）
// ============================================================
describe('迁移 v12 回滚（down）', () => {
  it('回滚到 v11 后 5 张 RBAC 表被删除', async () => {
    await db.runner.rollback(11)

    expect(await tableExists('user_roles')).toBe(false)
    expect(await tableExists('role_permissions')).toBe(false)
    expect(await tableExists('permissions')).toBe(false)
    expect(await tableExists('roles')).toBe(false)
    expect(await tableExists('users')).toBe(false)

    expect(await db.getSchemaVersion()).toBe(11)
  })

  it('重新迁移到最新版本后表和数据恢复', async () => {
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // 验证数据恢复
    const permCount = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions').get() as { cnt: number }
    expect(permCount.cnt).toBe(50)

    const admin = await db.db.prepare('SELECT * FROM users WHERE email = ?').get('517290808@qq.com') as any
    expect(admin).toBeTruthy()
  })
})
