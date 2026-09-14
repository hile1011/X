/**
 * 数据库迁移 v34 - sheet-layout-config 单元测试
 *
 * 在线表格布局持久化：quotes 与 sheet_templates 各新增 columnWidthConfig / rowHeightConfig
 * （LONGTEXT JSON，VTable 结构 [{key:行/列号,width/height:px}]，仅记录用户拖拽调整过的行列）。
 *
 * 测试目标：
 *   - 表结构：两表均含布局列（LONGTEXT）
 *   - 版本号：CURRENT_SCHEMA_VERSION = 34
 *   - 读写往返：db.quotes / db.sheetTemplates 保存布局配置后可完整读回
 *   - 幂等性：重复 migrate 不报错、列仍存在
 *   - down 回滚：rollback(33) 后 4 个布局列全部删除，再 migrate 恢复
 *
 * 使用 MySQL 测试数据库（quote_system_test）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

const QUOTE_ID = 'quote-layout-v34-test'
const TPL_ID = 'sheet-tpl-layout-v34-test'

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

/** 查询表的所有列名 */
async function tableColumns(table: string): Promise<string[]> {
  const [cols] = await pool.execute(
    'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    [table],
  )
  return (cols as any[]).map((c) => c.COLUMN_NAME)
}

// ============================================================
// 表结构 & 版本
// ============================================================
describe('迁移 v34 - 表结构', () => {
  it('quotes 表含 columnWidthConfig / rowHeightConfig 列（LONGTEXT）', async () => {
    const names = await tableColumns('quotes')
    expect(names).toContain('columnWidthConfig')
    expect(names).toContain('rowHeightConfig')
    const widthCol = await queryOne(
      'SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = ?',
      ['quotes', 'columnWidthConfig'],
    )
    expect(widthCol.DATA_TYPE).toBe('longtext')
  })

  it('sheet_templates 表含 columnWidthConfig / rowHeightConfig 列（LONGTEXT）', async () => {
    const names = await tableColumns('sheet_templates')
    expect(names).toContain('columnWidthConfig')
    expect(names).toContain('rowHeightConfig')
    const heightCol = await queryOne(
      'SELECT DATA_TYPE FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = ?',
      ['sheet_templates', 'rowHeightConfig'],
    )
    expect(heightCol.DATA_TYPE).toBe('longtext')
  })

  it('Schema 版本为最新版本', async () => {
    const version = await db.getSchemaVersion()
    expect(version).toBe(CURRENT_SCHEMA_VERSION)
  })
})

// ============================================================
// 读写往返（db 层布局配置存取）
// ============================================================
describe('迁移 v34 - 布局配置读写往返', () => {
  it('quotes.update 保存布局配置后 getById 完整读回', async () => {
    await pool.execute('DELETE FROM quotes WHERE id = ?', [QUOTE_ID])
    const created = await db.quotes.create({
      customerName: '布局测试客户',
      productStyle: '1',
      status: 1,
    } as any)
    // create 自动生成 id（quote-{timestamp}），测试用固定 id 迁移到目标行
    await pool.execute('UPDATE quotes SET id = ? WHERE id = ?', [QUOTE_ID, created.id])

    const widths = [{ key: 0, width: 120 }, { key: 5, width: 88.5 }]
    const heights = [{ key: 2, height: 60 }, { key: 19, height: 45 }]
    await db.quotes.update(QUOTE_ID, {
      columnWidthConfig: widths,
      rowHeightConfig: heights,
    } as any)

    const loaded = await db.quotes.getById(QUOTE_ID)
    expect(loaded).toBeTruthy()
    expect((loaded as any).columnWidthConfig).toEqual(widths)
    expect((loaded as any).rowHeightConfig).toEqual(heights)
  })

  it('quotes 局部更新（不带布局字段）不覆盖已存布局', async () => {
    await db.quotes.update(QUOTE_ID, { status: 2 } as any)
    const loaded = await db.quotes.getById(QUOTE_ID)
    expect((loaded as any).columnWidthConfig).toEqual([{ key: 0, width: 120 }, { key: 5, width: 88.5 }])
    expect((loaded as any).rowHeightConfig).toEqual([{ key: 2, height: 60 }, { key: 19, height: 45 }])
  })

  it('quotes.copy 复制订单时布局配置一并复制', async () => {
    const copied = await db.quotes.copy(QUOTE_ID, 'layout-copy-test') as any
    expect(copied).toBeTruthy()
    expect(copied.columnWidthConfig).toEqual([{ key: 0, width: 120 }, { key: 5, width: 88.5 }])
    expect(copied.rowHeightConfig).toEqual([{ key: 2, height: 60 }, { key: 19, height: 45 }])
    const loaded = await db.quotes.getById(copied.id) as any
    expect(loaded.columnWidthConfig).toEqual([{ key: 0, width: 120 }, { key: 5, width: 88.5 }])
    expect(loaded.rowHeightConfig).toEqual([{ key: 2, height: 60 }, { key: 19, height: 45 }])
    await pool.execute('DELETE FROM quotes WHERE id = ?', [copied.id])
  })

  it('sheetTemplates.create/update 保存布局配置后读回', async () => {
    await pool.execute('DELETE FROM sheet_templates WHERE name = ?', ['布局测试模板'])
    const widths = [{ key: 1, width: 200 }]
    const heights = [{ key: 3, height: 66 }]
    const created = await db.sheetTemplates.create('1', '布局测试模板', [[null, '数量']], {}, 'tester', {
      columnWidthConfig: widths,
      rowHeightConfig: heights,
    })
    // create 自动生成 id（sheet-tpl-{timestamp}-{random}）
    const tplId = created.id
    let loaded = await db.sheetTemplates.getById(tplId) as any
    expect(loaded.columnWidthConfig).toEqual(widths)
    expect(loaded.rowHeightConfig).toEqual(heights)

    // 更新（不带布局）：保持已存布局
    await db.sheetTemplates.update(tplId, '布局测试模板', [[null, '数量2']], {})
    loaded = await db.sheetTemplates.getById(tplId) as any
    expect(loaded.columnWidthConfig).toEqual(widths)
    expect(loaded.rowHeightConfig).toEqual(heights)

    // 更新（带新布局）：覆盖
    const widths2 = [{ key: 2, width: 150 }]
    await db.sheetTemplates.update(tplId, '布局测试模板', [[null, '数量2']], {}, 'tester', {
      columnWidthConfig: widths2,
      rowHeightConfig: [],
    })
    loaded = await db.sheetTemplates.getById(tplId) as any
    expect(loaded.columnWidthConfig).toEqual(widths2)
    expect(loaded.rowHeightConfig).toEqual([])
  })
})

// ============================================================
// 幂等性 & 回滚
// ============================================================
describe('迁移 v34 - 幂等性与回滚', () => {
  it('重复 migrate 幂等（列仍存在、版本不变）', async () => {
    await db.runner.migrate()
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const quoteCols = await tableColumns('quotes')
    expect(quoteCols).toContain('columnWidthConfig')
    expect(quoteCols).toContain('rowHeightConfig')
    const tplCols = await tableColumns('sheet_templates')
    expect(tplCols).toContain('columnWidthConfig')
    expect(tplCols).toContain('rowHeightConfig')
  })

  it('rollback(33) 后 4 个布局列全部删除，再 migrate 恢复', async () => {
    await db.runner.rollback(33)
    expect(await db.getSchemaVersion()).toBe(33)
    const quoteCols = await tableColumns('quotes')
    expect(quoteCols).not.toContain('columnWidthConfig')
    expect(quoteCols).not.toContain('rowHeightConfig')
    const tplCols = await tableColumns('sheet_templates')
    expect(tplCols).not.toContain('columnWidthConfig')
    expect(tplCols).not.toContain('rowHeightConfig')

    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    const quoteCols2 = await tableColumns('quotes')
    expect(quoteCols2).toContain('columnWidthConfig')
    expect(quoteCols2).toContain('rowHeightConfig')
    const tplCols2 = await tableColumns('sheet_templates')
    expect(tplCols2).toContain('columnWidthConfig')
    expect(tplCols2).toContain('rowHeightConfig')
  })
})
