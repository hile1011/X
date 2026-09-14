/**
 * 数据库迁移 v31 - product-cost-items-config 单元测试
 *
 * 「工艺成本管理」更名为「产品成本项配置」，重构为三层结构：
 *   - product_cost_items：产品成本项（父级）
 *   - product_cost_processes：可选工艺（多对一关联成本项，含名称/成本/公式/特点/备注/custom_values）
 *   - product_cost_custom_fields：自定义字段定义（text/number/date/select、显隐、排序）
 *
 * 测试目标：
 *   - 三张新表存在且结构正确（关键列 + 排序规则 utf8mb4_unicode_ci，见 v26 教训）
 *   - 存量数据迁移：旧 process_costs 每行 → 同名成本项 + 其下一条可选工艺（字段值带入）
 *   - 权限更名：4 项 process-costs:* 权限显示名更新为「产品成本项-*」，code/module/id 不变，总数不变
 *   - 幂等性：rollback + 重新 migrate 后数据无重复
 *   - down 回滚：三张表被删除、权限名回退为「工艺成本-*」、旧表数据零损失
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至最新版本。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
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

/** 统计表行数 */
async function countRows(table: string, where = '', params: any[] = []): Promise<number> {
  const [rows] = await pool.execute(`SELECT COUNT(*) as cnt FROM \`${table}\` ${where}`, params)
  return Number((rows as any[])[0].cnt)
}

/** 查询单行 */
async function queryOne(sql: string, params: any[] = []): Promise<any> {
  const [rows] = await pool.execute(sql, params)
  return (rows as any[])[0] ?? null
}

// ============================================================
// 表结构
// ============================================================
describe('迁移 v31 - 表结构', () => {
  const NEW_TABLES = ['product_cost_items', 'product_cost_processes', 'product_cost_custom_fields']

  for (const table of NEW_TABLES) {
    it(`${table} 表存在且排序规则为 utf8mb4_unicode_ci`, async () => {
      const row = await queryOne(
        'SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      )
      expect(row).toBeTruthy()
      expect(row.TABLE_COLLATION).toBe('utf8mb4_unicode_ci')
    })
  }

  it('product_cost_processes 含业务列（cost_item_id/cost/formula/features/remark/custom_values/sort_order）', async () => {
    const [cols] = await pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_cost_processes'],
    )
    const names = (cols as any[]).map((c) => c.COLUMN_NAME)
    for (const col of ['cost_item_id', 'name', 'cost', 'formula', 'features', 'remark', 'custom_values', 'sort_order']) {
      expect(names).toContain(col)
    }
  })

  it('product_cost_custom_fields 含配置列（field_type/options/visible/sort_order）', async () => {
    const [cols] = await pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_cost_custom_fields'],
    )
    const names = (cols as any[]).map((c) => c.COLUMN_NAME)
    for (const col of ['cost_item_id', 'name', 'field_type', 'options', 'visible', 'sort_order']) {
      expect(names).toContain(col)
    }
  })

  it('旧 process_costs 表保留（应用层废弃，数据零损失）', async () => {
    const row = await queryOne(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['process_costs'],
    )
    expect(row).toBeTruthy()
  })
})

// ============================================================
// 存量数据迁移
// ============================================================
describe('迁移 v31 - 存量数据迁移', () => {
  it('旧工艺成本行 → 同名成本项 + 其下一条可选工艺（字段值带入）', async () => {
    await db.runner.rollback(30)
    // 预置旧数据（模拟升级前）
    await pool.execute(
      "INSERT INTO process_costs (id, name, cost, formula) VALUES ('pc-legacy-1', 'UV印刷', 0.5, '面积×单价')"
    )
    await pool.execute(
      "INSERT INTO process_costs (id, name, cost, formula) VALUES ('pc-legacy-2', '覆膜', 0.2, '')"
    )
    await db.runner.migrate()

    // 成本项
    const item1 = await queryOne("SELECT * FROM product_cost_items WHERE id = 'pci-pc-legacy-1'")
    expect(item1).toBeTruthy()
    expect(item1.name).toBe('UV印刷')

    // 其下工艺
    const process1 = await queryOne("SELECT * FROM product_cost_processes WHERE id = 'pcp-pc-legacy-1'")
    expect(process1).toBeTruthy()
    expect(process1.cost_item_id).toBe('pci-pc-legacy-1')
    expect(process1.name).toBe('UV印刷')
    expect(Number(process1.cost)).toBe(0.5)
    expect(process1.formula).toBe('面积×单价')
    expect(process1.custom_values).toBe('{}')

    const process2 = await queryOne("SELECT * FROM product_cost_processes WHERE id = 'pcp-pc-legacy-2'")
    expect(process2).toBeTruthy()
    expect(Number(process2.cost)).toBe(0.2)

    // 迁移计数
    expect(await countRows('product_cost_items')).toBe(2)
    expect(await countRows('product_cost_processes')).toBe(2)

    // 清理本轮数据，恢复干净状态
    await pool.execute('DELETE FROM product_cost_processes WHERE cost_item_id LIKE ?', ['pci-pc-legacy-%'])
    await pool.execute('DELETE FROM product_cost_items WHERE id LIKE ?', ['pci-pc-legacy-%'])
    await pool.execute('DELETE FROM process_costs WHERE id LIKE ?', ['pc-legacy-%'])
  })

  it('空旧表时迁移不产生数据', async () => {
    await db.runner.rollback(30)
    expect(await countRows('process_costs')).toBe(0)
    await db.runner.migrate()
    expect(await countRows('product_cost_items')).toBe(0)
    expect(await countRows('product_cost_processes')).toBe(0)
  })
})

// ============================================================
// 权限更名
// ============================================================
describe('迁移 v31 - 权限更名', () => {
  const RENAMED_PERMS: Array<{ code: string; id: string; module: string; newName: string; oldName: string }> = [
    { code: 'process-costs:view', id: 'perm-process-costs-view', module: 'process-costs', newName: '产品成本项-查看', oldName: '工艺成本-查看' },
    { code: 'process-costs:create', id: 'perm-process-costs-create', module: 'process-costs', newName: '产品成本项-新增', oldName: '工艺成本-新增' },
    { code: 'process-costs:edit', id: 'perm-process-costs-edit', module: 'process-costs', newName: '产品成本项-编辑', oldName: '工艺成本-编辑' },
    { code: 'process-costs:delete', id: 'perm-process-costs-delete', module: 'process-costs', newName: '产品成本项-删除', oldName: '工艺成本-删除' },
  ]

  for (const p of RENAMED_PERMS) {
    it(`${p.code} 显示名更新为「${p.newName}」，code/module/id 不变`, async () => {
      const perm = await queryOne('SELECT * FROM permissions WHERE code = ?', [p.code])
      expect(perm).toBeTruthy()
      expect(perm.name).toBe(p.newName)
      expect(perm.id).toBe(p.id)
      expect(perm.module).toBe(p.module)
      // admin 角色关联不受影响（按 permission_id 关联）
      const rp = await queryOne(
        'SELECT COUNT(*) as cnt FROM role_permissions WHERE role_id = ? AND permission_id = ?',
        ['role-admin', p.id],
      )
      expect(Number(rp.cnt)).toBe(1)
    })
  }

  it('权限总数不变（v31 无新增权限；总数 52 来自 v35 AI 智能下单模块）', async () => {
    expect(await countRows('permissions')).toBe(52)
  })
})

// ============================================================
// 幂等性
// ============================================================
describe('迁移 v31 - 幂等性', () => {
  it('rollback + 重新 migrate 后权限与表结构无异常', async () => {
    for (let i = 0; i < 2; i++) {
      await db.runner.rollback(30)
      await db.runner.migrate()
    }
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    // 表仍存在
    for (const table of ['product_cost_items', 'product_cost_processes', 'product_cost_custom_fields']) {
      const row = await queryOne(
        'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      )
      expect(row).toBeTruthy()
    }
    // 权限无重复（无重复 code 时 GROUP BY HAVING 结果集为空）
    const [dupRows] = await pool.execute(
      'SELECT code FROM permissions GROUP BY code HAVING COUNT(*) > 1'
    )
    expect((dupRows as any[]).length).toBe(0)
    expect(await countRows('permissions', "WHERE code = 'process-costs:view'")).toBe(1)
  })
})

// ============================================================
// 回滚（down）
// ============================================================
describe('迁移 v31 - 回滚（down）', () => {
  it('回滚到 v30 后三张表删除、权限名回退、旧表数据零损失', async () => {
    // 准备：旧表预置数据 + 新表构造数据
    await pool.execute(
      "INSERT INTO process_costs (id, name, cost, formula) VALUES ('pc-rollback', '烫金', 1.2, '单价×数量')"
    )
    await db.runner.rollback(30)

    // 三张新表被删除
    for (const table of ['product_cost_items', 'product_cost_processes', 'product_cost_custom_fields']) {
      const row = await queryOne(
        'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table],
      )
      expect(row).toBeFalsy()
    }

    // 权限名回退为「工艺成本-*」
    const perm = await queryOne("SELECT * FROM permissions WHERE code = 'process-costs:view'")
    expect(perm.name).toBe('工艺成本-查看')

    // 旧表数据零损失
    const legacy = await queryOne("SELECT * FROM process_costs WHERE id = 'pc-rollback'")
    expect(legacy).toBeTruthy()
    expect(legacy.name).toBe('烫金')
    expect(Number(legacy.cost)).toBe(1.2)

    expect(await db.getSchemaVersion()).toBe(30)

    // 清理并重新迁移恢复
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    // 重新迁移后旧数据被迁入新表（INSERT IGNORE 幂等，不会重复）
    const item = await queryOne("SELECT * FROM product_cost_items WHERE id = 'pci-pc-rollback'")
    expect(item).toBeTruthy()
    await pool.execute('DELETE FROM product_cost_processes WHERE cost_item_id = ?', ['pci-pc-rollback'])
    await pool.execute('DELETE FROM product_cost_items WHERE id = ?', ['pci-pc-rollback'])
    await pool.execute('DELETE FROM process_costs WHERE id = ?', ['pc-rollback'])
  })
})
