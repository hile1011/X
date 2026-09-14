/**
 * 数据库迁移 v35 - ai-order-module-permissions 单元测试
 *
 * AI 智能下单模块权限：
 *   - ai-order:view（menu，模块入口）
 *   - ai-order:analyze（button，智能分析操作）
 *
 * 测试目标：
 *   - 2 项权限存在且结构正确（id/code/module/action/type/sort_order）
 *   - admin 角色持有全部 2 项
 *   - 存量兼容：拥有 quotes:create 的角色自动获得 2 项权限（AI 下单为创建订单的前置流程），
 *     无 quotes:create 的角色不越级获得
 *   - 迁移幂等：rollback + 重新 migrate 后权限与角色关联均无重复
 *   - down 回滚：2 项权限及全部角色关联被正确删除，Schema 版本回退到 34
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
  ).run(roleId, `测试角色-${roleId}`, `test-${roleId.replace(/[^a-zA-Z0-9]/g, '')}`, 'v35 存量兼容测试', 0)
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

// v35 新增的 2 项 AI 智能下单权限（code → 期望字段）
const AI_ORDER_PERMS: Array<{ code: string; id: string; name: string; module: string; action: string; type: string; sort: number }> = [
  { code: 'ai-order:view', id: 'perm-ai-order-view', name: 'AI智能下单-查看', module: 'ai-order', action: 'view', type: 'menu', sort: 28 },
  { code: 'ai-order:analyze', id: 'perm-ai-order-analyze', name: 'AI智能下单-智能分析', module: 'ai-order', action: 'analyze', type: 'button', sort: 29 },
]

// ============================================================
// 权限目录结构
// ============================================================
describe('迁移 v35 - 权限目录', () => {
  for (const p of AI_ORDER_PERMS) {
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

  it('权限 code 全局唯一（2 项新权限未破坏唯一性）', async () => {
    const rows = await db.db.prepare('SELECT code, COUNT(*) as cnt FROM permissions GROUP BY code HAVING cnt > 1').all()
    expect(rows).toHaveLength(0)
  })

  it('权限总数为 52（v35 新增 2 项后）', async () => {
    const row = await db.db.prepare('SELECT COUNT(*) as cnt FROM permissions').get() as any
    expect(Number(row.cnt)).toBe(52)
  })
})

// ============================================================
// admin 角色分配
// ============================================================
describe('迁移 v35 - admin 角色分配', () => {
  for (const p of AI_ORDER_PERMS) {
    it(`admin 角色持有 ${p.code}`, async () => {
      expect(await countRolePermission('role-admin', p.code)).toBe(1)
    })
  }
})

// ============================================================
// 存量角色兼容：拥有 quotes:create 的角色自动分配
// ============================================================
describe('迁移 v35 - 存量角色兼容', () => {
  it('拥有 quotes:create 的角色自动获得 AI 下单两项权限', async () => {
    await db.runner.rollback(34)
    await createLegacyRole('role-v35-creator', ['quotes:create'])
    await db.runner.migrate()

    expect(await countRolePermission('role-v35-creator', 'ai-order:view')).toBe(1)
    expect(await countRolePermission('role-v35-creator', 'ai-order:analyze')).toBe(1)

    await dropLegacyRole('role-v35-creator')
  })

  it('仅拥有 quotes:view（无 create）的角色不获得 AI 下单权限（不越级）', async () => {
    await db.runner.rollback(34)
    await createLegacyRole('role-v35-viewer', ['quotes:view'])
    await db.runner.migrate()

    expect(await countRolePermission('role-v35-viewer', 'ai-order:view')).toBe(0)
    expect(await countRolePermission('role-v35-viewer', 'ai-order:analyze')).toBe(0)

    await dropLegacyRole('role-v35-viewer')
  })
})

// ============================================================
// 幂等性
// ============================================================
describe('迁移 v35 - 幂等性', () => {
  it('rollback + 重新 migrate 后权限与角色关联均无重复', async () => {
    for (let i = 0; i < 2; i++) {
      await db.runner.rollback(34)
      await db.runner.migrate()
    }

    for (const p of AI_ORDER_PERMS) {
      expect(await countPermissionByCode(p.code)).toBe(1)
      expect(await countRolePermission('role-admin', p.code)).toBe(1)
    }
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // 最后一轮 migrate 后权限行来自迁移 INSERT（非种子重置），description 应携带说明
    const perm = await db.db.prepare('SELECT * FROM permissions WHERE code = ?').get('ai-order:analyze') as any
    expect(perm.description).toContain('AI 分析')
  })
})

// ============================================================
// 回滚（down）
// ============================================================
describe('迁移 v35 - 回滚（down）', () => {
  it('回滚到 v34 后 2 项权限及角色关联被删除、版本回退', async () => {
    await db.runner.rollback(34)

    for (const p of AI_ORDER_PERMS) {
      expect(await countPermissionByCode(p.code)).toBe(0)
      const rpRow = await db.db.prepare(
        'SELECT COUNT(*) as cnt FROM role_permissions WHERE permission_id = ?'
      ).get(p.id) as any
      expect(Number(rpRow.cnt)).toBe(0)
    }
    expect(await db.getSchemaVersion()).toBe(34)

    // 重新迁移恢复
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    for (const p of AI_ORDER_PERMS) {
      expect(await countPermissionByCode(p.code)).toBe(1)
    }
  })
})

// ============================================================
// 版本号
// ============================================================
describe('迁移 v35 - 版本号', () => {
  it('CURRENT_SCHEMA_VERSION 为 35', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(35)
  })
})
