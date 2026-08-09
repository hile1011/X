/**
 * 订单数据修改历史记录服务
 *
 * 提供 quote_history 表的查询与清理能力。仅依赖 dbClient（不依赖 db.ts），
 * 因此可被定时清理脚本安全导入而不会触发迁移自动执行。
 *
 * 历史记录由 quotes 表的 INSERT/UPDATE/DELETE 触发器自动写入（见迁移 v13）。
 */
import { pool } from '../dbClient.js'

export interface QuoteHistoryRecord {
  id: number
  quote_id: string
  action: string
  old_values: string | null
  new_values: string | null
  changed_fields: string | null
  operator: string
  created_at: string
}

export interface CleanupResult {
  /** 过期记录数（清理前统计） */
  expired: number
  /** 实际删除的记录数（dry-run 时为 0） */
  deleted: number
  /** 保留天数 */
  retainDays: number
  /** 是否为预览模式 */
  dryRun: boolean
}

/**
 * 查询指定订单的修改历史（按时间正序）。
 */
export async function getHistoryByQuoteId(quoteId: string): Promise<QuoteHistoryRecord[]> {
  const [rows] = await pool.query(
    'SELECT id, quote_id, action, old_values, new_values, changed_fields, operator, created_at FROM quote_history WHERE quote_id = ? ORDER BY id ASC',
    [quoteId]
  )
  return rows as QuoteHistoryRecord[]
}

/**
 * 清理超过保留期限的历史记录（分批删除，每批 ≤ 1000 行）。
 *
 * @param retainDays 保留天数（默认 30），早于该天数的历史记录将被删除
 * @param dryRun 预览模式：仅统计不删除
 */
export async function cleanupOldHistory(retainDays = 30, dryRun = false): Promise<CleanupResult> {
  // 1. 统计过期记录数（先于删除，便于日志审计）
  const [countRows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM quote_history WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [retainDays]
  )
  const expired = Number((countRows as any[])[0]?.cnt ?? 0)

  if (expired === 0 || dryRun) {
    return { expired, deleted: 0, retainDays, dryRun }
  }

  // 2. 分批删除，避免长事务锁表（遵循数据库版本管理规范：单批 ≤ 1000 行）
  const BATCH = 1000
  let deleted = 0
  while (true) {
    const [result] = await pool.query(
      'DELETE FROM quote_history WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?',
      [retainDays, BATCH]
    )
    const affected = Number((result as any).affectedRows ?? 0)
    if (affected === 0) break
    deleted += affected
    if (affected < BATCH) break
  }

  return { expired, deleted, retainDays, dryRun }
}
