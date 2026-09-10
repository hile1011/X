/**
 * 迁移 v27 单元测试：仪表盘更名为工作台
 *
 * 背景：工作台（原仪表盘）菜单更名，权限管理页直接展示 permissions.name，
 * 需将 dashboard:view 权限的显示名由「仪表盘」更新为「工作台」。
 *
 * 测试覆盖：
 *   1. 数据更新：迁移后 dashboard:view 权限名为「工作台」，code/module 不变
 *   2. 幂等性：重跑 v27.up 不报错，名称保持「工作台」；名称已变更时不误改
 *   3. 回滚：rollback(26) 后名称恢复「仪表盘」；重新 migrate 恢复「工作台」
 *   4. 种子数据：resetTestDatabase 重建后权限名为「工作台」
 *   5. 版本号：CURRENT_SCHEMA_VERSION = 28（v27 后续新增 v28 对账管理），schema_migrations 包含 v27 记录
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { CURRENT_SCHEMA_VERSION, getMigrations } from '../api/migrations/index.js'

// ============================================================
// 辅助函数
// ============================================================

async function getDashboardPermName(): Promise<string> {
  const [rows] = await pool.query(
    `SELECT name, code, module FROM permissions WHERE id = 'perm-dashboard-view'`,
  )
  const row = (rows as any[])[0]
  expect(row).toBeTruthy()
  return String(row.name)
}

async function setDashboardPermName(name: string): Promise<void> {
  await pool.query(`UPDATE permissions SET name = ? WHERE id = 'perm-dashboard-view'`, [name])
}

// ============================================================
// 测试
// ============================================================

beforeAll(async () => {
  await db.runner.migrate()
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

describe('迁移 v27：仪表盘更名为工作台', () => {
  describe('数据更新', () => {
    it('dashboard:view 权限名为「工作台」', async () => {
      expect(await getDashboardPermName()).toBe('工作台')
    })

    it('权限 code 与 module 保持不变', async () => {
      const [rows] = await pool.query(
        `SELECT code, module FROM permissions WHERE id = 'perm-dashboard-view'`,
      )
      const row = (rows as any[])[0]
      expect(row.code).toBe('dashboard:view')
      expect(row.module).toBe('dashboard')
    })
  })

  describe('幂等性', () => {
    it('直接重跑 v27.up 不报错且名称保持「工作台」', async () => {
      const v27 = getMigrations().find((m) => m.version === 27)!
      await v27.up(db.db)
      expect(await getDashboardPermName()).toBe('工作台')
    })

    it('名称为自定义值时重跑 up 不误伤（仅转换旧名「仪表盘」）', async () => {
      await setDashboardPermName('自定义菜单名')
      const v27 = getMigrations().find((m) => m.version === 27)!
      await v27.up(db.db)
      expect(await getDashboardPermName()).toBe('自定义菜单名')
      // 恢复为预期值
      await setDashboardPermName('工作台')
    })
  })

  describe('回滚与恢复', () => {
    it('rollback(26) 后名称恢复为「仪表盘」', async () => {
      await db.runner.rollback(26)
      expect(await getDashboardPermName()).toBe('仪表盘')
      expect(await db.getSchemaVersion()).toBe(26)
    })

    it('重新迁移后名称恢复「工作台」，版本回到 28', async () => {
      await db.runner.migrate()
      expect(await getDashboardPermName()).toBe('工作台')
      expect(await db.getSchemaVersion()).toBe(28)
    })
  })

  describe('种子数据', () => {
    it('resetTestDatabase 重建后 dashboard:view 权限名为「工作台」', async () => {
      await resetTestDatabase()
      expect(await getDashboardPermName()).toBe('工作台')
    })
  })

  describe('版本号', () => {
    it('CURRENT_SCHEMA_VERSION 为 28', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(28)
    })

    it('schema_migrations 包含 v27 记录', async () => {
      const [rows] = await pool.query(`SELECT name FROM schema_migrations WHERE version = 27`)
      expect((rows as any[])[0].name).toBe('rename-dashboard-to-workbench')
    })

    it('当前 schema 版本为 28', async () => {
      expect(await db.getSchemaVersion()).toBe(28)
    })
  })
})
