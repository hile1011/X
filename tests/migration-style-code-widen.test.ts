/**
 * 迁移 v25 单元测试：sheet_templates.style_code 扩容（VARCHAR(8) → VARCHAR(64)）
 *
 * 测试覆盖：
 *   1. 表结构：style_code 列长度为 64，注释包含产品 id 说明
 *   2. 数据读写：36 位产品 id 作为款式值可创建模板并正确回读（联动场景）
 *   3. 幂等性：直接重跑 v25.up 不报错，长度仍为 64
 *   4. 回滚：rollback(24) 后长度恢复 8；
 *      存在超长款式编码（产品 id 绑定模板）时回滚被拒绝（防截断丢数据）；
 *      重新迁移后长度恢复 64
 *   5. 版本号：CURRENT_SCHEMA_VERSION = 25，schema_migrations 包含 v25 记录
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

/** 查询 sheet_templates.style_code 列定义长度 */
async function styleCodeLength(): Promise<number> {
  const [rows] = await pool.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sheet_templates' AND COLUMN_NAME = 'style_code'`,
  )
  return Number((rows as any[])[0].len)
}

/** 测试用模板数据 */
const TEST_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)'],
  ['成品', 100, 38],
]
const TEST_FORMULAS: Record<string, string> = { B2: '=B2' }

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

describe('迁移 v25：sheet_templates.style_code 扩容至 VARCHAR(64)', () => {
  describe('表结构', () => {
    it('style_code 列长度为 64', async () => {
      expect(await styleCodeLength()).toBe(64)
    })

    it('列注释包含产品 id 说明', async () => {
      const [rows] = await pool.query(
        `SELECT COLUMN_COMMENT AS cmt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sheet_templates' AND COLUMN_NAME = 'style_code'`,
      )
      expect((rows as any[])[0].cmt).toContain('产品')
    })
  })

  describe('数据读写（产品 id 作为款式值）', () => {
    it('36 位产品 id 可创建模板并正确回读', async () => {
      const productId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
      const t = await db.sheetTemplates.create(productId, '无编码产品模板', TEST_DATA, TEST_FORMULAS, '测试用户')
      expect(t.styleCode).toBe(productId)

      const fetched = await db.sheetTemplates.getById(t.id)
      expect(fetched!.styleCode).toBe(productId)
      expect(fetched!.data).toEqual(TEST_DATA)

      const byStyle = await db.sheetTemplates.getByStyleCode(productId)
      expect(byStyle).toHaveLength(1)
      expect(byStyle[0].name).toBe('无编码产品模板')
    })

    it('既有短编码（1-6）模板不受影响', async () => {
      const t = await db.sheetTemplates.create('3', '内置款式模板', TEST_DATA, TEST_FORMULAS, 'x')
      expect(t.styleCode).toBe('3')
      expect(await db.sheetTemplates.getByStyleCode('3')).toHaveLength(1)
    })
  })

  describe('幂等性', () => {
    it('直接重跑 v25.up 不报错且长度仍为 64', async () => {
      const v25 = getMigrations().find((m) => m.version === 25)!
      await v25.up(db.db)
      expect(await styleCodeLength()).toBe(64)
    })
  })

  describe('回滚与恢复', () => {
    it('rollback(24) 后长度恢复 8（需先清理超长款式编码）', async () => {
      // 回滚前清理超长款式编码模板（生产回滚同样需先处理，防截断丢数据）
      await pool.query(`DELETE FROM sheet_templates WHERE CHAR_LENGTH(style_code) > 8`)
      await db.runner.rollback(24)
      expect(await styleCodeLength()).toBe(8)
      expect(await db.getSchemaVersion()).toBe(24)
    })

    it('重新迁移后长度恢复 64，数据保留', async () => {
      await db.runner.migrate()
      expect(await styleCodeLength()).toBe(64)
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
      // v24 状态下创建的短编码模板仍可查询
      const list = await db.sheetTemplates.getAll()
      expect(list.some((t) => t.name === '内置款式模板')).toBe(true)
    })

    it('存在超长款式编码时回滚被拒绝（防截断丢数据）', async () => {
      const productId = '01234567-89ab-cdef-0123-456789abcdef'
      await db.sheetTemplates.create(productId, '回滚保护模板', TEST_DATA, TEST_FORMULAS, 'x')

      await expect(db.runner.rollback(24)).rejects.toThrow(/无法回滚缩容/)
      // 回滚失败后长度仍为 64（v25.down 在 ALTER 前即抛出，列结构未变）
      expect(await styleCodeLength()).toBe(64)

      // 注意：rollback(24) 逆序先执行 v26.down（ALTER 统一排序规则 → DDL 隐式提交），
      // 其后的 DELETE v26 记录因 autocommit 恢复而自动提交，v25.down 虽被拒绝但版本已降至 25。
      // 这是 MySQL DDL 无法参与事务的固有行为，此处恢复到最新版本以保证后续用例。
      // 清理：删除超长模板，便于后续测试/重置
      const list = await db.sheetTemplates.getByStyleCode(productId)
      for (const t of list) {
        await db.sheetTemplates.remove(t.id)
      }
      await db.runner.migrate()
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })
  })

  describe('版本号', () => {
    it('CURRENT_SCHEMA_VERSION 为 28', () => {
      expect(CURRENT_SCHEMA_VERSION).toBe(28)
    })

    it('schema_migrations 包含 v25 记录', async () => {
      const [rows] = await pool.query(`SELECT name FROM schema_migrations WHERE version = 25`)
      expect((rows as any[])[0].name).toBe('sheet-templates-style-code-widen')
    })

    it('当前 schema 版本为 28（后续迁移全部应用后）', async () => {
      expect(await db.getSchemaVersion()).toBe(28)
    })
  })
})
