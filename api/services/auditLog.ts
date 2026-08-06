/**
 * 审计日志服务
 *
 * 记录所有删除操作（成功和被阻止），包含操作人、时间、数据ID、操作结果等。
 */
import { pool } from '../dbClient.js'

export type OperationResult = 'success' | 'blocked'

export interface AuditLogEntry {
  operationType: string         // 'delete'
  entityType: string             // 'customer' | 'product' | 'quote' | 'order' | 'task' | 'process_cost'
  entityId: string
  entityName: string             // 显示名称，便于阅读
  operator: string               // 操作人
  result: OperationResult        // 'success' | 'blocked'
  blockedReason?: string         // 被阻止时的原因
  ipAddress?: string
}

/**
 * 记录一条操作日志
 */
export async function logOperation(entry: AuditLogEntry): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO operation_logs (operation_type, entity_type, entity_id, entity_name, operator, result, blocked_reason, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.operationType,
        entry.entityType,
        entry.entityId,
        entry.entityName,
        entry.operator || 'unknown',
        entry.result,
        entry.blockedReason || null,
        entry.ipAddress || null,
      ]
    )
  } catch (err) {
    // 审计日志失败不应阻断主流程，仅记录错误
    console.error('[auditLog] 记录操作日志失败:', err)
  }
}

/**
 * 查询操作日志
 */
export async function getOperationLogs(options: {
  limit?: number
  offset?: number
  entityType?: string
  result?: string
}): Promise<{ rows: any[]; total: number }> {
  const limit = Math.min(options.limit || 50, 200)
  const offset = options.offset || 0
  const conditions: string[] = []
  const params: any[] = []

  if (options.entityType) {
    conditions.push('entity_type = ?')
    params.push(options.entityType)
  }
  if (options.result) {
    conditions.push('result = ?')
    params.push(options.result)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM operation_logs ${whereClause}`,
    params
  )
  const total = (countRows as any[])[0].cnt

  const [rows] = await pool.execute(
    `SELECT * FROM operation_logs ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  )

  return { rows: rows as any[], total }
}
