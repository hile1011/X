/**
 * 数据库迁移 v13 - add-quote-history-triggers 单元测试
 *
 * 测试目标：
 *   - quote_history 历史记录表结构
 *   - INSERT/UPDATE/DELETE 触发器自动捕获订单业务字段变更
 *   - changed_fields 精确列出变更字段；old_values/new_values 为 JSON 快照
 *   - LONGTEXT 大字段不进入快照（避免历史表膨胀）
 *   - operator 优先取 @app_operator 会话变量，回退到 CURRENT_USER()
 *   - 状态流转/复制等写操作均生成历史记录
 *   - 迁移幂等性、回滚（down）
 *   - cleanupOldHistory 定时清理逻辑（含 dry-run）
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至 v13。
 * 回滚/重新迁移测试放在文件末尾，afterAll 中恢复 schema 到最新版本。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { pool } from '../api/dbClient.js'
import { getHistoryByQuoteId, cleanupOldHistory } from '../api/services/quoteHistory.js'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

/**
 * 查询 MySQL 表的列名列表
 */
async function getTableColumns(tableName: string): Promise<string[]> {
  const rows = await db.db.prepare(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION'
  ).all(tableName)
  return rows.map((r: any) => r.COLUMN_NAME as string)
}

/** 检查表是否存在 */
async function tableExists(tableName: string): Promise<boolean> {
  const rows = await db.db.prepare(
    'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
  ).get(tableName) as { cnt: number }
  return rows.cnt > 0
}

/** 检查触发器是否存在 */
async function triggerExists(triggerName: string): Promise<boolean> {
  const rows = await db.db.prepare(
    'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?'
  ).get(triggerName) as { cnt: number }
  return rows.cnt > 0
}

/** 查询指定订单的历史记录（直接走 pool，绕过 service 以验证原始数据） */
async function getHistory(quoteId: string): Promise<any[]> {
  const [rows] = await pool.query(
    'SELECT id, quote_id, action, old_values, new_values, changed_fields, operator, created_at FROM quote_history WHERE quote_id = ? ORDER BY id ASC',
    [quoteId]
  )
  return rows as any[]
}

/** 在独占连接上设置 @app_operator 并执行 UPDATE（触发器读取会话变量） */
async function updateWithOperator(quoteId: string, operator: string): Promise<void> {
  const conn = await pool.getConnection()
  try {
    await conn.query('SET @app_operator = ?', [operator])
    await conn.query('UPDATE quotes SET status = 2 WHERE id = ?', [quoteId])
  } finally {
    // 重置会话变量，避免连接归还连接池后污染后续查询
    await conn.query('SET @app_operator = NULL')
    conn.release()
  }
}

/**
 * 确保 schema 恢复到最新版本：如果版本低于 CURRENT_SCHEMA_VERSION，直接 migrate 补齐缺失的迁移。
 */
async function ensureLatestSchema(): Promise<void> {
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
}

// 文件级 afterAll：确保所有测试结束后 schema 恢复到最新版本，不影响后续测试文件
afterAll(async () => {
  await ensureLatestSchema()
})

// ============================================================
// Schema 结构测试（不修改 schema）
// ============================================================
describe('迁移 v13 - quote_history 表结构', () => {
  it('quote_history 表已创建', async () => {
    expect(await tableExists('quote_history')).toBe(true)
  })

  it('quote_history 表包含必要字段', async () => {
    const columns = await getTableColumns('quote_history')
    expect(columns).toContain('id')
    expect(columns).toContain('quote_id')
    expect(columns).toContain('action')
    expect(columns).toContain('old_values')
    expect(columns).toContain('new_values')
    expect(columns).toContain('changed_fields')
    expect(columns).toContain('operator')
    expect(columns).toContain('created_at')
  })

  it('三个审计触发器已创建', async () => {
    expect(await triggerExists('quotes_audit_insert')).toBe(true)
    expect(await triggerExists('quotes_audit_update')).toBe(true)
    expect(await triggerExists('quotes_audit_delete')).toBe(true)
  })

  it('Schema 版本为最新版本', async () => {
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })
})


// ============================================================
// 触发器功能测试（每个测试前重置数据）
// ============================================================
describe('触发器自动记录订单变更', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('INSERT 触发器：创建订单时写入 insert 记录', async () => {
    const quote = await db.quotes.create({ customerName: '审计客户', productStyle: '1' })

    const history = await getHistory(quote.id)
    expect(history).toHaveLength(1)
    expect(history[0].action).toBe('insert')
    expect(history[0].old_values).toBeNull()
    expect(history[0].new_values).not.toBeNull()
    expect(history[0].changed_fields).toBeNull()

    const newValues = JSON.parse(history[0].new_values)
    // v37：customerName 不再落库，审计快照记录 customer_id（解析后的客户关联）
    expect(newValues.customer_id).toBeTruthy()
    expect(newValues).not.toHaveProperty('customerName')
    expect(newValues.productStyle).toBe('1')
    expect(newValues.status).toBe(1)
  })

  it('UPDATE 触发器：编辑订单时写入 update 记录并精确列出变更字段', async () => {
    const quote = await db.quotes.create({ customerName: '原客户名', productStyle: '1' })

    await db.quotes.update(quote.id, {
      customerName: '新客户名',
      sellPriceNoTax: 100,
      status: 2,
    })

    const history = await getHistory(quote.id)
    // 1 条 insert + 1 条 update
    expect(history).toHaveLength(2)
    const updateRec = history[1]
    expect(updateRec.action).toBe('update')

    const changed = (updateRec.changed_fields || '').split(',').filter(Boolean)
    // v37：改名体现为 customer_id 变更（原客户名/新客户名解析为不同客户）
    expect(changed).toContain('customer_id')
    expect(changed).toContain('sellPriceNoTax')
    expect(changed).toContain('status')
    // 未修改的字段不应出现在变更列表
    expect(changed).not.toContain('productStyle')
    expect(changed).not.toContain('quantity')

    const oldValues = JSON.parse(updateRec.old_values)
    const newValues = JSON.parse(updateRec.new_values)
    expect(oldValues.customer_id).toBeTruthy()
    expect(newValues.customer_id).toBeTruthy()
    expect(oldValues.customer_id).not.toBe(newValues.customer_id)
    expect(oldValues.status).toBe(1)
    expect(newValues.status).toBe(2)
  })

  it('UPDATE 触发器：仅修改单字段时 changed_fields 只含该字段', async () => {
    const quote = await db.quotes.create({ customerName: '单字段测试', productStyle: '2' })

    // 直接 SQL 更新单个字段（绕过 dbApi 的 updated_at 联动），验证触发器精确性
    await pool.query('UPDATE quotes SET quantity = ? WHERE id = ?', ['500', quote.id])

    const history = await getHistory(quote.id)
    expect(history).toHaveLength(2)
    const updateRec = history[1]
    const changed = (updateRec.changed_fields || '').split(',').filter(Boolean)
    expect(changed).toEqual(['quantity'])
  })

  it('DELETE 触发器：删除订单时写入 delete 记录', async () => {
    const quote = await db.quotes.create({ customerName: '待删除客户', productStyle: '1' })
    await db.quotes.delete(quote.id)

    const history = await getHistory(quote.id)
    // 1 insert + 1 delete
    expect(history).toHaveLength(2)
    const deleteRec = history[1]
    expect(deleteRec.action).toBe('delete')
    expect(deleteRec.old_values).not.toBeNull()
    expect(deleteRec.new_values).toBeNull()
    expect(deleteRec.changed_fields).toBeNull()

    const oldValues = JSON.parse(deleteRec.old_values)
    expect(oldValues.customer_id).toBeTruthy()
  })

  it('快照排除 LONGTEXT 大字段（images/tableData/allFormulas 等不进入 new_values）', async () => {
    const quote = await db.quotes.create({
      customerName: '大字段排除测试',
      productStyle: '1',
      images: ['data:image/png;base64,xxx'],
      tableData: [{ a: 1 }],
    })

    const history = await getHistory(quote.id)
    const newValues = JSON.parse(history[0].new_values)
    // LONGTEXT 字段不在快照中
    expect(newValues).not.toHaveProperty('images')
    expect(newValues).not.toHaveProperty('tableData')
    expect(newValues).not.toHaveProperty('allFormulas')
    expect(newValues).not.toHaveProperty('modifiedFormulas')
    expect(newValues).not.toHaveProperty('removedFormulaAddresses')
    expect(newValues).not.toHaveProperty('productionStepStatus')
    // 业务字段在快照中（v37：customerName 已由 customer_id 替代）
    expect(newValues).toHaveProperty('customer_id')
    expect(newValues).toHaveProperty('status')
  })

  it('operator 默认回退到数据库用户（非空）', async () => {
    const quote = await db.quotes.create({ customerName: '操作人测试', productStyle: '1' })
    const history = await getHistory(quote.id)
    expect(history[0].operator).toBeTruthy()
    // CURRENT_USER() 形如 root@127.0.0.1
    expect(history[0].operator).toContain('@')
  })

  it('operator 优先取 @app_operator 会话变量', async () => {
    const quote = await db.quotes.create({ customerName: '会话变量测试', productStyle: '1' })
    await updateWithOperator(quote.id, '张三-admin')

    const history = await getHistory(quote.id)
    const updateRec = history[1]
    expect(updateRec.action).toBe('update')
    expect(updateRec.operator).toBe('张三-admin')
    // changed_fields 仅含 status
    const changed = (updateRec.changed_fields || '').split(',').filter(Boolean)
    expect(changed).toEqual(['status'])
  })

  it('状态流转 nextStatus 生成 update 历史记录', async () => {
    const quote = await db.quotes.create({ customerName: '状态流转测试', productStyle: '1' })
    await db.quotes.nextStatus(quote.id) // 1 → 2

    const history = await getHistory(quote.id)
    expect(history).toHaveLength(2)
    const updateRec = history[1]
    const changed = (updateRec.changed_fields || '').split(',').filter(Boolean)
    expect(changed).toContain('status')
    expect(changed).toContain('sampleTime')
    const newValues = JSON.parse(updateRec.new_values)
    expect(newValues.status).toBe(2)
  })

  it('复制订单 copy 生成 insert 历史记录', async () => {
    const quote = await db.quotes.create({ customerName: '复制源客户', productStyle: '1' })
    const copied = await db.quotes.copy(quote.id)

    const sourceHistory = await getHistory(quote.id)
    const copiedHistory = await getHistory(copied.id)
    // 源订单：1 insert；复制订单：1 insert
    expect(sourceHistory).toHaveLength(1)
    expect(copiedHistory).toHaveLength(1)
    expect(copiedHistory[0].action).toBe('insert')
    // v37：复制继承原订单的 customer_id 关联
    expect(JSON.parse(copiedHistory[0].new_values).customer_id).toBeTruthy()
  })
})


// ============================================================
// 定时清理逻辑测试
// ============================================================
describe('cleanupOldHistory 定时清理', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('dry-run 模式不删除任何记录', async () => {
    const quote = await db.quotes.create({ customerName: '清理测试', productStyle: '1' })
    // 将历史记录回拨到 40 天前
    await pool.query('UPDATE quote_history SET created_at = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE quote_id = ?', [quote.id])

    const before = await getHistory(quote.id)
    expect(before).toHaveLength(1)

    const result = await cleanupOldHistory(30, true)
    expect(result.dryRun).toBe(true)
    expect(result.expired).toBe(1)
    expect(result.deleted).toBe(0)

    const after = await getHistory(quote.id)
    expect(after).toHaveLength(1)
  })

  it('清理超过保留期限的记录，保留近期记录', async () => {
    const quote = await db.quotes.create({ customerName: '清理保留测试', productStyle: '1' })
    // 第一条历史记录（insert）回拨到 40 天前
    await pool.query('UPDATE quote_history SET created_at = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE quote_id = ?', [quote.id])
    // 触发一条新的 update 历史（created_at 为当前时间）
    await db.quotes.update(quote.id, { sellPriceNoTax: 200 })

    const before = await getHistory(quote.id)
    expect(before).toHaveLength(2) // 1 条 40 天前 + 1 条近期

    const result = await cleanupOldHistory(30, false)
    expect(result.expired).toBe(1)
    expect(result.deleted).toBe(1)

    const after = await getHistory(quote.id)
    expect(after).toHaveLength(1)
    // 保留下的是近期的 update 记录
    expect(after[0].action).toBe('update')
  })

  it('无过期记录时返回 expired=0 且不删除', async () => {
    const quote = await db.quotes.create({ customerName: '无过期测试', productStyle: '1' })
    const before = await getHistory(quote.id)
    expect(before).toHaveLength(1)

    const result = await cleanupOldHistory(30, false)
    expect(result.expired).toBe(0)
    expect(result.deleted).toBe(0)

    const after = await getHistory(quote.id)
    expect(after).toHaveLength(1)
  })

  it('getHistoryByQuoteId 返回正序历史记录', async () => {
    const quote = await db.quotes.create({ customerName: '查询顺序测试', productStyle: '1' })
    await db.quotes.update(quote.id, { status: 2 })
    await db.quotes.update(quote.id, { status: 3 })

    const history = await getHistoryByQuoteId(quote.id)
    expect(history).toHaveLength(3)
    expect(history[0].action).toBe('insert')
    expect(history[1].action).toBe('update')
    expect(history[2].action).toBe('update')
    // 按 id 正序，id 递增
    expect(history[1].id).toBeGreaterThan(history[0].id)
    expect(history[2].id).toBeGreaterThan(history[1].id)
  })
})


// ============================================================
// 迁移幂等性 & 回滚测试（修改 schema，afterAll 中恢复）
// ============================================================
describe('迁移 v13 幂等性 & 回滚', () => {
  it('重新执行 migrate 不报错（触发器 DROP IF EXISTS + CREATE 幂等）', async () => {
    await db.runner.migrate()
    expect(await triggerExists('quotes_audit_insert')).toBe(true)
    expect(await triggerExists('quotes_audit_update')).toBe(true)
    expect(await triggerExists('quotes_audit_delete')).toBe(true)
    expect(await tableExists('quote_history')).toBe(true)
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('回滚到 v12 后 quote_history 表和触发器被删除', async () => {
    await db.runner.rollback(12)

    expect(await tableExists('quote_history')).toBe(false)
    expect(await triggerExists('quotes_audit_insert')).toBe(false)
    expect(await triggerExists('quotes_audit_update')).toBe(false)
    expect(await triggerExists('quotes_audit_delete')).toBe(false)
    expect(await db.getSchemaVersion()).toBe(12)

    // 重新迁移到最新版本恢复
    await db.runner.migrate()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
    expect(await tableExists('quote_history')).toBe(true)
    expect(await triggerExists('quotes_audit_insert')).toBe(true)
  })
})
