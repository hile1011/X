/**
 * 数据库迁移 v29 - add-quotes-quick-edit-permission 单元测试
 *
 * 测试目标：
 *   - quotes:quick-edit 权限存在且结构正确（id/module/action/type/name/sort_order）
 *   - admin 角色持有该权限
 *   - 存量兼容：拥有 quotes:edit 的角色在迁移执行时自动获得 quick-edit（行为不回退）
 *   - 迁移幂等：rollback + 重新 migrate 后权限与角色关联均无重复
 *   - down 回滚：权限及全部角色关联被正确删除，Schema 版本回退
 *   - 版本号：CURRENT_SCHEMA_VERSION ≥ 29，迁移版本连续无跳号
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至最新版本。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION, migrations } from '../api/migrations/index.js'

beforeAll(async () => {
  // 确保 schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
  await db.runner.migrate()
  // 重置数据：确保权限目录/角色为干净的种子状态
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

/** 统计指定权限码在 permissions 表中的行数 */
async function countPermissionByCode(code: string): Promise<number> {
  const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions WHERE code = ?').get(code) as any
  return Number(row.cnt)
}

/** 统计指定角色持有某权限码的关联行数 */
async function countRolePermission(roleId: string, permCode: string): Promise<number> {
  const row = await db.db.prepare(
    `SELECT COUNT(*) as cnt FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ? AND p.code = ?`
  ).get(roleId, permCode) as any
  return Number(row.cnt)
}

// ============================================================
// 权限目录结构
// ============================================================
describe('迁移 v29 - 权限目录', () => {
  it('quotes:quick-edit 权限存在且字段正确', async () => {
    const perm = await db.db.prepare('SELECT * FROM permissions WHERE code = ?').get('quotes:quick-edit') as any
    expect(perm).toBeTruthy()
    expect(perm.id).toBe('perm-quotes-quick-edit')
    expect(perm.name).toBe('订单-双击进入编辑')
    expect(perm.module).toBe('quotes')
    expect(perm.action).toBe('quick-edit')
    expect(perm.type).toBe('button')
    expect(perm.sort_order).toBe(18)
    // 注：description 断言见「幂等性」describe——种子重置（resetTestDatabase）会将
    // description 置空，仅迁移路径插入的行（rollback 后重新 migrate）携带描述
  })

  it('权限 code 全局唯一（新权限未破坏唯一性）', async () => {
    const rows = await db.db.prepare('SELECT code, COUNT(*) as cnt FROM permissions GROUP BY code HAVING cnt > 1').all()
    expect(rows).toHaveLength(0)
  })

  it('权限总数为 52（v30 新增 6 项模块权限、v35 新增 2 项 AI 智能下单权限后）', async () => {
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions').get() as any
    expect(Number(row.cnt)).toBe(52)
  })
})

// ============================================================
// admin 角色分配
// ============================================================
describe('迁移 v29 - admin 角色分配', () => {
  it('admin 角色持有 quotes:quick-edit', async () => {
    const cnt = await countRolePermission('role-admin', 'quotes:quick-edit')
    expect(cnt).toBe(1)
  })
})

// ============================================================
// 存量角色兼容：拥有 quotes:edit 的角色自动获得 quick-edit
// ============================================================
describe('迁移 v29 - 存量角色兼容', () => {
  it('拥有 quotes:edit 的角色在迁移执行时自动获得 quotes:quick-edit', async () => {
    // 1. 回滚 v29，模拟升级前的库（无 quick-edit 权限）
    await db.runner.rollback(28)
    expect(await countPermissionByCode('quotes:quick-edit')).toBe(0)

    // 2. 创建一个仅持有 quotes:edit 的存量角色（模拟升级前的自定义编辑角色）
    await db.db.prepare(
      'INSERT INTO roles (id, name, code, description, is_system) VALUES (?, ?, ?, ?, ?)'
    ).run('role-legacy-editor', '存量编辑角色', 'legacy-editor', '测试用', 0)
    const editPerm = await db.db.prepare('SELECT id FROM permissions WHERE code = ?').get('quotes:edit') as any
    await db.db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
    ).run('role-legacy-editor', editPerm.id)

    // 3. 重新执行迁移（升级）→ 存量角色自动获得 quick-edit，双击编辑行为不回退
    await db.runner.migrate()
    expect(await countRolePermission('role-legacy-editor', 'quotes:quick-edit')).toBe(1)
    // admin 同时恢复持有
    expect(await countRolePermission('role-admin', 'quotes:quick-edit')).toBe(1)

    // 4. 清理测试角色（先删关联，再删角色）
    await db.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run('role-legacy-editor')
    await db.db.prepare('DELETE FROM roles WHERE id = ?').run('role-legacy-editor')
  })
})

// ============================================================
// 幂等性
// ============================================================
describe('迁移 v29 - 幂等性', () => {
  it('rollback + 重新 migrate 后权限与角色关联均无重复', async () => {
    // 两次回滚 + 重放，验证 INSERT IGNORE 与 SELECT 自动分配的幂等性
    for (let i = 0; i < 2; i++) {
      await db.runner.rollback(28)
      await db.runner.migrate()
    }

    expect(await countPermissionByCode('quotes:quick-edit')).toBe(1)
    expect(await countRolePermission('role-admin', 'quotes:quick-edit')).toBe(1)
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // 最后一轮 migrate 后权限行来自迁移 INSERT（非种子重置），description 应携带依赖说明
    const perm = await db.db.prepare('SELECT * FROM permissions WHERE code = ?').get('quotes:quick-edit') as any
    expect(perm.description).toContain('双击订单行直接进入编辑模式')
  })
})

// ============================================================
// 回滚（down）
// ============================================================
describe('迁移 v29 - 回滚（down）', () => {
  it('回滚到 v28 后权限及角色关联被删除、版本回退', async () => {
    await db.runner.rollback(28)

    expect(await countPermissionByCode('quotes:quick-edit')).toBe(0)
    const rpRow = await db.db.prepare(
      'SELECT COUNT(*) as cnt FROM role_permissions WHERE permission_id = ?'
    ).get('perm-quotes-quick-edit') as any
    expect(Number(rpRow.cnt)).toBe(0)
    expect(await db.getSchemaVersion()).toBe(28)

    // 重新迁移恢复
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    expect(await countPermissionByCode('quotes:quick-edit')).toBe(1)
  })
})

// ============================================================
// 版本号
// ============================================================
describe('迁移版本号', () => {
  it('迁移版本从 1 连续无跳号，末尾版本 = CURRENT_SCHEMA_VERSION', () => {
    const versions = migrations.map((m) => m.version)
    expect(versions[0]).toBe(1)
    expect(versions[versions.length - 1]).toBe(CURRENT_SCHEMA_VERSION)
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBe(versions[i - 1] + 1)
    }
  })
})
