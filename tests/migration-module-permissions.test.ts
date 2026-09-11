/**
 * 数据库迁移 v30 - add-business-module-permissions 单元测试
 *
 * 覆盖三个功能模块的独立权限：
 *   - 做货跟踪：production-tracking:view / production-tracking:edit
 *   - 订单对账管理：reconciliation:view / reconciliation:edit / reconciliation:execute
 *   - 年度业务报表：annual-report:view
 *
 * 测试目标：
 *   - 6 项权限存在且结构正确（id/code/module/action/type/sort_order）
 *   - admin 角色持有全部 6 项
 *   - 存量兼容：按原等效权限自动分配（quotes:view→view、quotes:edit→edit、
 *     quotes:status-transition→execute、reports:view→annual-report:view），行为零回退
 *   - 迁移幂等：rollback + 重新 migrate 后权限与角色关联均无重复
 *   - down 回滚：6 项权限及全部角色关联被正确删除，Schema 版本回退到 29
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至最新版本。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

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

/** 创建测试角色并授予指定权限码（模拟升级前的存量角色） */
async function createLegacyRole(roleId: string, permCodes: string[]): Promise<void> {
  await db.db.prepare(
    'INSERT INTO roles (id, name, code, description, is_system) VALUES (?, ?, ?, ?, ?)'
  ).run(roleId, `测试角色-${roleId}`, `test-${roleId.replace(/[^a-zA-Z0-9]/g, '')}`, 'v30 存量兼容测试', 0)
  for (const code of permCodes) {
    await db.db.prepare(
      'INSERT INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE code = ?'
    ).run(roleId, code)
  }
}

/** 清理测试角色（先删关联，再删角色） */
async function dropLegacyRole(roleId: string): Promise<void> {
  await db.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId)
  await db.db.prepare('DELETE FROM roles WHERE id = ?').run(roleId)
}

// v30 新增的 6 项模块权限（code → 期望字段）
const MODULE_PERMS: Array<{ code: string; id: string; name: string; module: string; action: string; type: string; sort: number }> = [
  { code: 'production-tracking:view', id: 'perm-production-tracking-view', name: '做货跟踪-查看', module: 'production-tracking', action: 'view', type: 'menu', sort: 23 },
  { code: 'production-tracking:edit', id: 'perm-production-tracking-edit', name: '做货跟踪-编辑', module: 'production-tracking', action: 'edit', type: 'button', sort: 24 },
  { code: 'reconciliation:view', id: 'perm-reconciliation-view', name: '订单对账-查看', module: 'reconciliation', action: 'view', type: 'menu', sort: 25 },
  { code: 'reconciliation:edit', id: 'perm-reconciliation-edit', name: '订单对账-编辑', module: 'reconciliation', action: 'edit', type: 'button', sort: 26 },
  { code: 'reconciliation:execute', id: 'perm-reconciliation-execute', name: '订单对账-执行', module: 'reconciliation', action: 'execute', type: 'button', sort: 27 },
  { code: 'annual-report:view', id: 'perm-annual-report-view', name: '年度业务报表-查看', module: 'annual-report', action: 'view', type: 'menu', sort: 81 },
]

// ============================================================
// 权限目录结构
// ============================================================
describe('迁移 v30 - 权限目录', () => {
  for (const p of MODULE_PERMS) {
    it(`${p.code} 存在且字段正确`, async () => {
      const perm = await db.db.prepare('SELECT * FROM permissions WHERE code = ?').get(p.code) as any
      expect(perm).toBeTruthy()
      expect(perm.id).toBe(p.id)
      expect(perm.name).toBe(p.name)
      expect(perm.module).toBe(p.module)
      expect(perm.action).toBe(p.action)
      expect(perm.type).toBe(p.type)
      expect(perm.sort_order).toBe(p.sort)
    })
  }

  it('权限 code 全局唯一（6 项新权限未破坏唯一性）', async () => {
    const rows = await db.db.prepare('SELECT code, COUNT(*) as cnt FROM permissions GROUP BY code HAVING cnt > 1').all()
    expect(rows).toHaveLength(0)
  })

  it('权限总数为 50（44 + 6 项模块权限）', async () => {
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions').get() as any
    expect(Number(row.cnt)).toBe(50)
  })
})

// ============================================================
// admin 角色分配
// ============================================================
describe('迁移 v30 - admin 角色分配', () => {
  for (const p of MODULE_PERMS) {
    it(`admin 角色持有 ${p.code}`, async () => {
      expect(await countRolePermission('role-admin', p.code)).toBe(1)
    })
  }
})

// ============================================================
// 存量角色兼容：按原等效权限自动分配
// ============================================================
describe('迁移 v30 - 存量角色兼容', () => {
  it('拥有 quotes:view 的角色自动获得做货跟踪/对账查看权限（且不越级）', async () => {
    await db.runner.rollback(29)
    await createLegacyRole('role-v30-viewer', ['quotes:view'])
    await db.runner.migrate()

    // 自动获得查看权限
    expect(await countRolePermission('role-v30-viewer', 'production-tracking:view')).toBe(1)
    expect(await countRolePermission('role-v30-viewer', 'reconciliation:view')).toBe(1)
    // 不越级：无编辑/执行/年报权限
    expect(await countRolePermission('role-v30-viewer', 'production-tracking:edit')).toBe(0)
    expect(await countRolePermission('role-v30-viewer', 'reconciliation:edit')).toBe(0)
    expect(await countRolePermission('role-v30-viewer', 'reconciliation:execute')).toBe(0)
    expect(await countRolePermission('role-v30-viewer', 'annual-report:view')).toBe(0)

    await dropLegacyRole('role-v30-viewer')
  })

  it('拥有 quotes:edit 的角色自动获得做货跟踪/对账编辑权限', async () => {
    await db.runner.rollback(29)
    await createLegacyRole('role-v30-editor', ['quotes:view', 'quotes:edit'])
    await db.runner.migrate()

    expect(await countRolePermission('role-v30-editor', 'production-tracking:view')).toBe(1)
    expect(await countRolePermission('role-v30-editor', 'production-tracking:edit')).toBe(1)
    expect(await countRolePermission('role-v30-editor', 'reconciliation:view')).toBe(1)
    expect(await countRolePermission('role-v30-editor', 'reconciliation:edit')).toBe(1)
    // 无 status-transition → 不获得对账执行权限
    expect(await countRolePermission('role-v30-editor', 'reconciliation:execute')).toBe(0)

    await dropLegacyRole('role-v30-editor')
  })

  it('拥有 quotes:status-transition 的角色自动获得对账执行权限', async () => {
    await db.runner.rollback(29)
    await createLegacyRole('role-v30-transitor', ['quotes:view', 'quotes:status-transition'])
    await db.runner.migrate()

    expect(await countRolePermission('role-v30-transitor', 'reconciliation:execute')).toBe(1)
    expect(await countRolePermission('role-v30-transitor', 'reconciliation:view')).toBe(1)
    // 无 quotes:edit → 不获得编辑权限
    expect(await countRolePermission('role-v30-transitor', 'reconciliation:edit')).toBe(0)

    await dropLegacyRole('role-v30-transitor')
  })

  it('拥有 reports:view 的角色自动获得年度业务报表权限', async () => {
    await db.runner.rollback(29)
    await createLegacyRole('role-v30-reporter', ['reports:view'])
    await db.runner.migrate()

    expect(await countRolePermission('role-v30-reporter', 'annual-report:view')).toBe(1)
    // 无 quotes:view → 不获得其他模块权限
    expect(await countRolePermission('role-v30-reporter', 'production-tracking:view')).toBe(0)
    expect(await countRolePermission('role-v30-reporter', 'reconciliation:view')).toBe(0)

    await dropLegacyRole('role-v30-reporter')
  })
})

// ============================================================
// 幂等性
// ============================================================
describe('迁移 v30 - 幂等性', () => {
  it('rollback + 重新 migrate 后权限与角色关联均无重复', async () => {
    for (let i = 0; i < 2; i++) {
      await db.runner.rollback(29)
      await db.runner.migrate()
    }

    for (const p of MODULE_PERMS) {
      expect(await countPermissionByCode(p.code)).toBe(1)
      expect(await countRolePermission('role-admin', p.code)).toBe(1)
    }
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // 最后一轮 migrate 后权限行来自迁移 INSERT（非种子重置），description 应携带说明
    const perm = await db.db.prepare('SELECT * FROM permissions WHERE code = ?').get('reconciliation:execute') as any
    expect(perm.description).toContain('确认对账')
  })
})

// ============================================================
// 回滚（down）
// ============================================================
describe('迁移 v30 - 回滚（down）', () => {
  it('回滚到 v29 后 6 项权限及角色关联被删除、版本回退', async () => {
    await db.runner.rollback(29)

    for (const p of MODULE_PERMS) {
      expect(await countPermissionByCode(p.code)).toBe(0)
      const rpRow = await db.db.prepare(
        'SELECT COUNT(*) as cnt FROM role_permissions WHERE permission_id = ?'
      ).get(p.id) as any
      expect(Number(rpRow.cnt)).toBe(0)
    }
    expect(await db.getSchemaVersion()).toBe(29)

    // 重新迁移恢复
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    for (const p of MODULE_PERMS) {
      expect(await countPermissionByCode(p.code)).toBe(1)
    }
  })
})
