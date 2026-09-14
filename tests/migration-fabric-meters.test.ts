/**
 * 数据库迁移 v33 - fabric-meters-ceil 单元测试
 *
 * 布料米数列系统性向上取整：存量 quotes（tableData/allFormulas）与
 * sheet_templates（data/formulas）规范化（数值向上取整、公式整体包裹 CEILING(...,1)），
 * 变更明细存入 fabric_meters_ceil_audit 审计表。
 *
 * 测试目标：
 *   - fabric_meters_ceil_audit 表存在且结构正确（关键列 + 唯一键 + 排序规则）
 *   - 存量数据取整：quotes / sheet_templates 的小数米数被取整、M 列公式被包裹
 *   - 审计记录：原值与取整值明细写入审计表
 *   - 幂等性：重复 migrate 无二次变更、审计无重复
 *   - down 回滚：依据审计表恢复原值与原公式、审计表删除
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

/** 测试用订单：布料米数列（M，col=12）含小数 1.5 与 403.2 */
const QUOTE_ID = 'quote-fm-ceil-test'
const QUOTE_TABLE_DATA = JSON.stringify([
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 1.5, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
])
const QUOTE_ALL_FORMULAS = JSON.stringify({
  M3: '=I3/100*2*B3/INT(J3/H3)',
  M4: '=I4/100*2*B4/INT(J4/H4)',
  N3: '=J3/(MIN(H3,I3))',
})

/** 测试用模板：同结构（表头 + 两行小数米数） */
const TPL_ID = 'sheet-tpl-fm-ceil-test'
const TPL_DATA = JSON.stringify([
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 9.999, 3.7561, 907.2, 12342.8571],
])
const TPL_FORMULAS = JSON.stringify({ M2: '=I2/100*2*B2/INT(J2/H2)' })

beforeAll(async () => {
  // 确保 schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
  await db.runner.migrate()
  // 重置数据：确保干净的种子状态
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

/** 查询单行 */
async function queryOne(sql: string, params: any[] = []): Promise<any> {
  const [rows] = await pool.execute(sql, params)
  return (rows as any[])[0] ?? null
}

/** 插入测试用订单（含未取整的布料米数与未包裹的 M 列公式） */
async function insertTestQuote(): Promise<void> {
  await pool.execute(
    'DELETE FROM quotes WHERE id = ?',
    [QUOTE_ID],
  )
  await pool.execute(
    'INSERT INTO quotes (id, quote_number, customerName, tableData, allFormulas) VALUES (?, ?, ?, ?, ?)',
    [QUOTE_ID, '1234567890123456', '取整测试客户', QUOTE_TABLE_DATA, QUOTE_ALL_FORMULAS],
  )
}

/** 插入测试用模板 */
async function insertTestTemplate(): Promise<void> {
  await pool.execute(
    'DELETE FROM sheet_templates WHERE id = ?',
    [TPL_ID],
  )
  await pool.execute(
    'INSERT INTO sheet_templates (id, style_code, name, data, formulas) VALUES (?, ?, ?, ?, ?)',
    [TPL_ID, '1', '取整测试模板', TPL_DATA, TPL_FORMULAS],
  )
}

// ============================================================
// 表结构 & 版本
// ============================================================
describe('迁移 v33 - 表结构', () => {
  it('fabric_meters_ceil_audit 表存在且排序规则为 utf8mb4_unicode_ci', async () => {
    const row = await queryOne(
      'SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['fabric_meters_ceil_audit'],
    )
    expect(row).toBeTruthy()
    expect(row.TABLE_COLLATION).toBe('utf8mb4_unicode_ci')
  })

  it('fabric_meters_ceil_audit 含业务列（entity_type/entity_id/ceil_changes/formula_changes）与唯一键', async () => {
    const [cols] = await pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      ['fabric_meters_ceil_audit'],
    )
    const names = (cols as any[]).map((c) => c.COLUMN_NAME)
    for (const col of ['entity_type', 'entity_id', 'ceil_changes', 'formula_changes', 'created_at']) {
      expect(names).toContain(col)
    }
    const [indexes] = await pool.execute(
      'SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?',
      ['fabric_meters_ceil_audit'],
    )
    expect((indexes as any[]).map((i) => i.INDEX_NAME)).toContain('uk_fm_entity')
  })

  it('Schema 版本为最新版本（33）', async () => {
    const version = await db.getSchemaVersion()
    expect(version).toBe(CURRENT_SCHEMA_VERSION)
    expect(version).toBe(33)
  })
})

// ============================================================
// 存量数据取整（迁移核心逻辑）
// ============================================================
describe('迁移 v33 - 存量数据取整', () => {
  it('回滚到 v32 后插入含小数米数的存量数据', async () => {
    await db.runner.rollback(32)
    expect(await db.getSchemaVersion()).toBe(32)
    // 回滚后审计表应被删除
    const row = await queryOne(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['fabric_meters_ceil_audit'],
    )
    expect(row).toBeNull()
    // 插入未取整的存量数据
    await insertTestQuote()
    await insertTestTemplate()
  })

  it('migrate 后 quotes 布料米数被向上取整、M 列公式被包裹', async () => {
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(33)

    const row = await queryOne('SELECT tableData, allFormulas FROM quotes WHERE id = ?', [QUOTE_ID])
    expect(row).toBeTruthy()
    const tableData = JSON.parse(row.tableData)
    const allFormulas = JSON.parse(row.allFormulas)
    // 1.5 → 2，403.2 → 404；其他列小数不受影响
    expect(tableData[2][12]).toBe(2)
    expect(tableData[3][12]).toBe(404)
    expect(tableData[2][13]).toBe(3.7561)
    expect(tableData[2][14]).toBe(907.2)
    // M 列公式整体包裹 CEILING(...,1)；非 M 列公式不变
    expect(allFormulas.M3).toBe('=CEILING(I3/100*2*B3/INT(J3/H3),1)')
    expect(allFormulas.M4).toBe('=CEILING(I4/100*2*B4/INT(J4/H4),1)')
    expect(allFormulas.N3).toBe('=J3/(MIN(H3,I3))')
  })

  it('migrate 后 sheet_templates 布料米数被向上取整、公式被包裹', async () => {
    const row = await queryOne('SELECT data, formulas FROM sheet_templates WHERE id = ?', [TPL_ID])
    expect(row).toBeTruthy()
    const data = JSON.parse(row.data)
    const formulas = JSON.parse(row.formulas)
    expect(data[1][12]).toBe(10) // 9.999 → 10
    expect(formulas.M2).toBe('=CEILING(I2/100*2*B2/INT(J2/H2),1)')
  })

  it('审计表记录了原值与取整值明细（quote 与 sheet_template 各一条）', async () => {
    const [audits] = await pool.execute(
      'SELECT entity_type, entity_id, ceil_changes, formula_changes FROM fabric_meters_ceil_audit ORDER BY entity_type',
    )
    const list = audits as any[]
    expect(list).toHaveLength(2)

    // mysql2 将 JSON 列解析为对象返回（字符串形态也兼容）
    const parseJsonCol = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)

    const quoteAudit = list.find((a) => a.entity_type === 'quote')
    expect(quoteAudit.entity_id).toBe(QUOTE_ID)
    const ceilChanges = parseJsonCol(quoteAudit.ceil_changes)
    expect(ceilChanges).toEqual([
      { address: 'M3', row: 2, from: 1.5, to: 2 },
      { address: 'M4', row: 3, from: 403.2, to: 404 },
    ])
    const formulaChanges = parseJsonCol(quoteAudit.formula_changes)
    expect(formulaChanges.map((c: any) => c.address).sort()).toEqual(['M3', 'M4'])
    expect(formulaChanges[0].from).toMatch(/^=I[34]\/100/)

    const tplAudit = list.find((a) => a.entity_type === 'sheet_template')
    expect(tplAudit.entity_id).toBe(TPL_ID)
    expect(parseJsonCol(tplAudit.ceil_changes)).toEqual([
      { address: 'M2', row: 1, from: 9.999, to: 10 },
    ])
  })
})

// ============================================================
// 幂等性
// ============================================================
describe('迁移 v33 - 幂等性', () => {
  it('重复 migrate 不产生二次变更、审计无重复记录', async () => {
    await db.runner.migrate()
    // 数据保持取整后的值
    const quoteRow = await queryOne('SELECT tableData, allFormulas FROM quotes WHERE id = ?', [QUOTE_ID])
    const tableData = JSON.parse(quoteRow.tableData)
    expect(tableData[2][12]).toBe(2)
    expect(tableData[3][12]).toBe(404)
    // 公式不会被二次包裹（嵌套 CEILING）
    const allFormulas = JSON.parse(quoteRow.allFormulas)
    expect(allFormulas.M3).toBe('=CEILING(I3/100*2*B3/INT(J3/H3),1)')
    // 审计表仍只有两条记录（uk 防重 + 无变更不写入）
    const [audits] = await pool.execute('SELECT COUNT(*) as cnt FROM fabric_meters_ceil_audit')
    expect(Number((audits as any[])[0].cnt)).toBe(2)
  })
})

// ============================================================
// down 回滚
// ============================================================
describe('迁移 v33 - down 回滚', () => {
  it('rollback(32)：数据恢复原值、公式去包裹、审计表删除', async () => {
    await db.runner.rollback(32)
    expect(await db.getSchemaVersion()).toBe(32)

    // quotes 恢复原始小数与原公式
    const quoteRow = await queryOne('SELECT tableData, allFormulas FROM quotes WHERE id = ?', [QUOTE_ID])
    const tableData = JSON.parse(quoteRow.tableData)
    const allFormulas = JSON.parse(quoteRow.allFormulas)
    expect(tableData[2][12]).toBe(1.5)
    expect(tableData[3][12]).toBe(403.2)
    expect(allFormulas.M3).toBe('=I3/100*2*B3/INT(J3/H3)')
    expect(allFormulas.M4).toBe('=I4/100*2*B4/INT(J4/H4)')
    expect(allFormulas.N3).toBe('=J3/(MIN(H3,I3))')

    // sheet_templates 恢复
    const tplRow = await queryOne('SELECT data, formulas FROM sheet_templates WHERE id = ?', [TPL_ID])
    const tplData = JSON.parse(tplRow.data)
    const tplFormulas = JSON.parse(tplRow.formulas)
    expect(tplData[1][12]).toBe(9.999)
    expect(tplFormulas.M2).toBe('=I2/100*2*B2/INT(J2/H2)')

    // 审计表被删除
    const tbl = await queryOne(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['fabric_meters_ceil_audit'],
    )
    expect(tbl).toBeNull()
  })

  it('重新 migrate：数据再次取整且版本回到最新', async () => {
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)

    const quoteRow = await queryOne('SELECT tableData, allFormulas FROM quotes WHERE id = ?', [QUOTE_ID])
    const tableData = JSON.parse(quoteRow.tableData)
    expect(tableData[2][12]).toBe(2)
    expect(tableData[3][12]).toBe(404)

    // 清理测试数据，避免影响后续测试文件
    await pool.execute('DELETE FROM quotes WHERE id = ?', [QUOTE_ID])
    await pool.execute('DELETE FROM sheet_templates WHERE id = ?', [TPL_ID])
    await pool.execute('DELETE FROM fabric_meters_ceil_audit')
  })
})
