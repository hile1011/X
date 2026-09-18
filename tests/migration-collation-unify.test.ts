/**
 * 迁移 v26 单元测试：统一 quote_production_tasks / sheet_templates 表排序规则
 *
 * 背景：v23/v24 增量迁移的 CREATE TABLE 未显式指定 COLLATE，在 MySQL 8
 * （服务器默认 utf8mb4_0900_ai_ci）上建出的表与既有表（utf8mb4_unicode_ci）不一致，
 * quote_id JOIN quotes.id 时报 Illegal mix of collations（做货跟踪总览接口 500）。
 * 全量脚本建表环境已带正确 COLLATE，v26.up 对其幂等跳过。
 *
 * 测试覆盖：
 *   1. 表结构：两张表 TABLE_COLLATION 为 utf8mb4_unicode_ci，关键字符串列 collation 一致
 *   2. JOIN 正确性：quote_production_tasks JOIN quotes 不再抛 collation 冲突，数据正确关联
 *   3. 幂等性：直接重跑 v26.up 不报错
 *   4. 回滚：rollback(25) 后回到 utf8mb4_0900_ai_ci；重新 migrate 恢复统一
 *   5. 版本号：CURRENT_SCHEMA_VERSION = 26，schema_migrations 包含 v26 记录
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

/** 查询表排序规则 */
async function tableCollation(table: string): Promise<string> {
  const [rows] = await pool.query(
    `SELECT TABLE_COLLATION AS c FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  )
  return String((rows as any[])[0]?.c ?? '')
}

/** 查询表中所有字符串列的排序规则（去重） */
async function columnCollations(table: string): Promise<string[]> {
  const [rows] = await pool.query(
    `SELECT DISTINCT COLLATION_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLLATION_NAME IS NOT NULL`,
    [table],
  )
  return (rows as any[]).map((r) => String(r.c))
}

/** 执行做货跟踪总览的核心 JOIN（修复前会抛 Illegal mix of collations） */
async function overviewJoinCount(): Promise<number> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM quote_production_tasks t JOIN quotes q ON q.id = t.quote_id`,
  )
  return Number((rows as any[])[0].cnt)
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

describe('迁移 v26：统一表排序规则为 utf8mb4_unicode_ci', () => {
  describe('表结构', () => {
    it('quote_production_tasks 表排序规则为 utf8mb4_unicode_ci', async () => {
      expect(await tableCollation('quote_production_tasks')).toBe('utf8mb4_unicode_ci')
    })

    it('sheet_templates 表排序规则为 utf8mb4_unicode_ci', async () => {
      expect(await tableCollation('sheet_templates')).toBe('utf8mb4_unicode_ci')
    })

    it('两张表所有字符串列排序规则与表一致（无列级覆盖残留）', async () => {
      for (const table of ['quote_production_tasks', 'sheet_templates']) {
        const collations = await columnCollations(table)
        expect(collations).toEqual(['utf8mb4_unicode_ci'])
      }
    })
  })

  describe('JOIN 正确性（修复目标场景）', () => {
    it('quote_production_tasks JOIN quotes 不抛 collation 冲突', async () => {
      // 空表 JOIN 也执行列比较；有数据时验证关联结果
      await expect(overviewJoinCount()).resolves.not.toThrow()
    })

    it('插入数据后 JOIN 正确关联', async () => {
      // 准备一个客户 + 一个订单 + 一个任务行，验证 JOIN 数据链路
      const customerId = 'test-collation-customer'
      const quoteId = 'test-collation-quote'
      const taskId = 'test-collation-task'
      await pool.query(
        `INSERT IGNORE INTO customers (id, name) VALUES (?, '排序规则测试客户')`,
        [customerId],
      )
      await pool.query(
        `INSERT IGNORE INTO quotes (id, quote_number, customer_id, quantity, status, productionTimeStart, productionTimeEnd, sampleTime, productStyle, created_at, updated_at)
         VALUES (?, '2026091012345678', ?, '100', 3, '2026-09-01', '2026-09-10', '2026-08-01', '1', NOW(), NOW())`,
        [quoteId, customerId],
      )
      await pool.query(
        `INSERT IGNORE INTO quote_production_tasks (id, quote_id, step_order, name, status, remark, materials, created_at, updated_at)
         VALUES (?, ?, 1, '面料采购', 0, '', '[]', NOW(), NOW())`,
        [taskId, quoteId],
      )
      const [rows] = await pool.query(
        `SELECT t.name, c.name AS customerName FROM quote_production_tasks t JOIN quotes q ON q.id = t.quote_id LEFT JOIN customers c ON q.customer_id = c.id WHERE t.id = ?`,
        [taskId],
      )
      const row = (rows as any[])[0]
      expect(row.name).toBe('面料采购')
      expect(row.customerName).toBe('排序规则测试客户')

      // 清理
      await pool.query('DELETE FROM quote_production_tasks WHERE id = ?', [taskId])
      await pool.query('DELETE FROM quotes WHERE id = ?', [quoteId])
      await pool.query('DELETE FROM customers WHERE id = ?', [customerId])
    })
  })

  describe('幂等性', () => {
    it('直接重跑 v26.up 不报错且排序规则保持统一', async () => {
      const v26 = getMigrations().find((m) => m.version === 26)!
      await v26.up(db.db)
      expect(await tableCollation('quote_production_tasks')).toBe('utf8mb4_unicode_ci')
      expect(await tableCollation('sheet_templates')).toBe('utf8mb4_unicode_ci')
    })
  })

  describe('回滚与恢复', () => {
    it('rollback(25) 后两张表回到 utf8mb4_0900_ai_ci', async () => {
      await db.runner.rollback(25)
      expect(await tableCollation('quote_production_tasks')).toBe('utf8mb4_0900_ai_ci')
      expect(await tableCollation('sheet_templates')).toBe('utf8mb4_0900_ai_ci')
      expect(await db.getSchemaVersion()).toBe(25)
    })

    it('回滚状态下 JOIN 重新出现 collation 冲突（验证 down 语义）', async () => {
      await expect(overviewJoinCount()).rejects.toThrow(/collation/i)
    })

    it('重新迁移后排序规则恢复统一，JOIN 正常', async () => {
      await db.runner.migrate()
      expect(await tableCollation('quote_production_tasks')).toBe('utf8mb4_unicode_ci')
      expect(await tableCollation('sheet_templates')).toBe('utf8mb4_unicode_ci')
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
      await expect(overviewJoinCount()).resolves.toBeGreaterThanOrEqual(0)
    })
  })

  describe('版本号', () => {
    it('CURRENT_SCHEMA_VERSION ≥ 26（v26 迁移已包含）', () => {
      expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(26)
    })

    it('schema_migrations 包含 v26 记录', async () => {
      const [rows] = await pool.query(`SELECT name FROM schema_migrations WHERE version = 26`)
      expect((rows as any[])[0].name).toBe('unify-table-collation')
    })

    it('当前 schema 版本为最新', async () => {
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })
  })
})
