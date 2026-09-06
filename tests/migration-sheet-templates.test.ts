/**
 * 迁移 v19 + v23 单元测试：sheet_templates 表（款式一对多）+ quotes.template_id
 *
 * 测试覆盖：
 *   1. 表结构：sort_order 列、uk_style_name 唯一键、uk_style_code 已移除
 *   2. quotes.template_id 列存在（记录订单使用的模板）
 *   3. 权限种子：模板管理权限存在并分配给 admin
 *   4. CRUD：create（同款式多个/重名拒绝）/ getById / getByStyleCode（数组）/ update（改名/重名拒绝）/ remove
 *   5. quotes 读写 template_id（create → getById 回读）
 *   6. 幂等性：重新执行 migrate 不报错
 *   7. 回滚：down 到 v22 后结构恢复（含同款式去重），重新迁移后恢复一对多
 *   8. 版本号：迁移后 schema 版本为 CURRENT_SCHEMA_VERSION（23）
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

// ============================================================
// 辅助函数
// ============================================================

/** 检查指定表是否存在 */
async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName],
  )
  return (rows as any[])[0].cnt > 0
}

/** 检查指定表中是否存在指定列 */
async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  )
  return (rows as any[])[0].cnt > 0
}

/** 检查指定索引是否存在 */
async function indexExists(tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName],
  )
  return (rows as any[])[0].cnt > 0
}

/** 检查权限是否存在 */
async function permissionExists(permissionId: string): Promise<boolean> {
  const row = await db.db.prepare('SELECT id FROM permissions WHERE id = ?').get(permissionId)
  return !!row
}

/** 测试用模板数据 */
const TEST_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)'],
  ['成品', 100, 38],
  ['汇总', null, null],
]
const TEST_FORMULAS: Record<string, string> = { B3: '=B2', C3: '=C2' }

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

describe('迁移 v19+v23：sheet_templates 一对多 + quotes.template_id', () => {
  describe('表结构', () => {
    it('sheet_templates 表已创建', async () => {
      expect(await tableExists('sheet_templates')).toBe(true)
    })

    it('包含全部业务列（含 v23 新增 sort_order）', async () => {
      for (const col of ['id', 'style_code', 'name', 'data', 'formulas', 'sort_order', 'updated_by', 'created_at', 'updated_at']) {
        expect(await columnExists('sheet_templates', col)).toBe(true)
      }
    })

    it('uk_style_name 唯一键存在（同款式模板名唯一）', async () => {
      expect(await indexExists('sheet_templates', 'uk_style_name')).toBe(true)
    })

    it('uk_style_code 唯一键已移除（放开一对多约束）', async () => {
      expect(await indexExists('sheet_templates', 'uk_style_code')).toBe(false)
    })

    it('quotes 表包含 template_id 列', async () => {
      expect(await columnExists('quotes', 'template_id')).toBe(true)
    })
  })

  describe('权限种子数据', () => {
    it('模板查看/编辑权限已插入', async () => {
      expect(await permissionExists('perm-sheet-templates-view')).toBe(true)
      expect(await permissionExists('perm-sheet-templates-edit')).toBe(true)
    })
  })

  describe('CRUD 读写（一对多）', () => {
    it('create：同款式可创建多个模板，data/formulas 正确反序列化', async () => {
      const t1 = await db.sheetTemplates.create('2', '常规款', TEST_DATA, TEST_FORMULAS, '测试用户')
      const t2 = await db.sheetTemplates.create('2', '加厚款', TEST_DATA, TEST_FORMULAS, '测试用户')
      expect(t1.styleCode).toBe('2')
      expect(t1.name).toBe('常规款')
      expect(t1.data).toEqual(TEST_DATA)
      expect(t1.formulas).toEqual(TEST_FORMULAS)
      expect(t2.name).toBe('加厚款')
      expect(t1.id).not.toBe(t2.id)

      const all = await db.sheetTemplates.getByStyleCode('2')
      expect(all).toHaveLength(2)
      // 不依赖排序规则：仅校验两条记录均存在
      expect(all.map((t) => t.name)).toEqual(expect.arrayContaining(['常规款', '加厚款']))
    })

    it('create：同款式重名被拒绝', async () => {
      await expect(db.sheetTemplates.create('2', '常规款', TEST_DATA, TEST_FORMULAS, 'x')).rejects.toThrow(/同名/)
      // 不同款式同名允许
      const t = await db.sheetTemplates.create('3', '常规款', TEST_DATA, TEST_FORMULAS, 'x')
      expect(t.styleCode).toBe('3')
    })

    it('create：空名称被拒绝', async () => {
      await expect(db.sheetTemplates.create('2', '  ', TEST_DATA, TEST_FORMULAS, 'x')).rejects.toThrow(/名称/)
    })

    it('getById / remove：按 id 操作', async () => {
      const t = await db.sheetTemplates.create('5', '临时模板', TEST_DATA, TEST_FORMULAS, 'x')
      const fetched = await db.sheetTemplates.getById(t.id)
      expect(fetched!.name).toBe('临时模板')
      expect(await db.sheetTemplates.remove(t.id)).toBe(true)
      expect(await db.sheetTemplates.getById(t.id)).toBeNull()
      expect(await db.sheetTemplates.remove(t.id)).toBe(false)
    })

    it('update：更新内容与改名', async () => {
      const t = await db.sheetTemplates.create('6', '原名称', TEST_DATA, TEST_FORMULAS, 'x')
      const updatedData = [...TEST_DATA, ['新增行', 1, 2]]
      const saved = await db.sheetTemplates.update(t.id, '新名称', updatedData, { B3: '=B2*2' }, '用户B')
      expect(saved!.name).toBe('新名称')
      expect(saved!.data).toEqual(updatedData)
      expect(saved!.updatedBy).toBe('用户B')
      // 名称不变时（undefined）仅更新内容
      const again = await db.sheetTemplates.update(t.id, undefined, updatedData, { B3: '=B2*2' }, '用户B')
      expect(again!.name).toBe('新名称')
    })

    it('update：改名与其他模板重名被拒绝', async () => {
      const t1 = await db.sheetTemplates.create('4', '模板A', TEST_DATA, TEST_FORMULAS, 'x')
      await db.sheetTemplates.create('4', '模板B', TEST_DATA, TEST_FORMULAS, 'x')
      await expect(db.sheetTemplates.update(t1.id, '模板B', TEST_DATA, TEST_FORMULAS, 'x')).rejects.toThrow(/同名/)
      // 更新不存在的模板返回 null
      expect(await db.sheetTemplates.update('not-exist', 'x', TEST_DATA, TEST_FORMULAS, 'x')).toBeNull()
    })

    it('getAll：跨款式返回全部模板', async () => {
      const all = await db.sheetTemplates.getAll()
      expect(all.length).toBeGreaterThanOrEqual(4)
      const codes = all.map((t) => t.styleCode)
      const sorted = [...codes].sort()
      expect(codes).toEqual(sorted)
    })
  })

  describe('quotes 关联 template_id', () => {
    it('创建订单带 templateId，读取时回读', async () => {
      const t = await db.sheetTemplates.create('1', '订单测试模板', TEST_DATA, TEST_FORMULAS, 'x')
      const created = await db.quotes.create({
        customerName: '模板关联客户',
        productStyle: '1',
        templateId: t.id,
        quantity: '100',
        sellPriceNoTax: 10,
      } as any)
      expect((created as any).templateId).toBe(t.id)
      const fetched = await db.quotes.getById(created.id)
      expect((fetched as any).templateId).toBe(t.id)
    })

    it('更新订单可修改 templateId（含清空回退内置）', async () => {
      const t = await db.sheetTemplates.create('1', '更新测试模板', TEST_DATA, TEST_FORMULAS, 'x')
      const created = await db.quotes.create({
        customerName: '模板更新客户',
        productStyle: '1',
        quantity: '50',
      } as any)
      expect((created as any).templateId).toBe('')
      await db.quotes.update(created.id, { templateId: t.id } as any)
      let fetched = await db.quotes.getById(created.id)
      expect((fetched as any).templateId).toBe(t.id)
      await db.quotes.update(created.id, { templateId: '' } as any)
      fetched = await db.quotes.getById(created.id)
      expect((fetched as any).templateId).toBe('')
    })

    it('复制订单保留 templateId', async () => {
      const t = await db.sheetTemplates.create('2', '复制测试模板', TEST_DATA, TEST_FORMULAS, 'x')
      const created = await db.quotes.create({
        customerName: '模板复制客户',
        productStyle: '2',
        templateId: t.id,
        quantity: '30',
      } as any)
      const copied = await db.quotes.copy(created.id, 'operator')
      expect((copied as any).templateId).toBe(t.id)
    })
  })

  describe('幂等性与回滚', () => {
    it('幂等：重新执行 migrate 不报错且结构保留', async () => {
      await db.runner.migrate()
      expect(await tableExists('sheet_templates')).toBe(true)
      expect(await columnExists('quotes', 'template_id')).toBe(true)
      expect(await indexExists('sheet_templates', 'uk_style_name')).toBe(true)
      expect(await indexExists('sheet_templates', 'uk_style_code')).toBe(false)
    })

    it('版本号为 CURRENT_SCHEMA_VERSION', async () => {
      const version = await db.getSchemaVersion()
      expect(version).toBe(CURRENT_SCHEMA_VERSION)
    })

    it('schema_migrations 包含 v23 记录', async () => {
      const [rows] = await pool.query(`SELECT name FROM schema_migrations WHERE version = 23`)
      expect((rows as any[])[0].name).toBe('sheet-templates-one-to-many')
    })

    it('回滚到 v22 后恢复一对一结构', async () => {
      await db.runner.rollback(22)
      expect(await columnExists('quotes', 'template_id')).toBe(false)
      expect(await columnExists('sheet_templates', 'sort_order')).toBe(false)
      expect(await indexExists('sheet_templates', 'uk_style_name')).toBe(false)
      expect(await indexExists('sheet_templates', 'uk_style_code')).toBe(true)
      expect(await db.getSchemaVersion()).toBe(22)
    })

    it('回滚时同款式模板去重（保留 updated_at 最新一条）', async () => {
      // v22 状态下 uk_style_code 已恢复：每个款式只剩一条
      const [rows] = await pool.query(`SELECT style_code, COUNT(*) AS cnt FROM sheet_templates GROUP BY style_code HAVING cnt > 1`)
      expect((rows as any[]).length).toBe(0)
    })

    it('重新迁移后一对多结构恢复', async () => {
      await db.runner.migrate()
      expect(await columnExists('quotes', 'template_id')).toBe(true)
      expect(await columnExists('sheet_templates', 'sort_order')).toBe(true)
      expect(await indexExists('sheet_templates', 'uk_style_name')).toBe(true)
      expect(await indexExists('sheet_templates', 'uk_style_code')).toBe(false)
      expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    })
  })
})
