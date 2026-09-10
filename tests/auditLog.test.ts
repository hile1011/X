/**
 * 审计日志服务 单元测试
 * 测试目标：api/services/auditLog.ts
 *   - logOperation：字段写入、operator 默认值、异常静默（不阻断主流程）
 *   - getOperationLogs：limit 上限 200 / offset / entityType / result 过滤
 *
 * 使用 MySQL 测试数据库；operation_logs 不在 db-reset 清单内，手动清理。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { pool } from '../api/dbClient.js'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { logOperation, getOperationLogs, type AuditLogEntry } from '../api/services/auditLog'

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  operationType: 'delete',
  entityType: 'customer',
  entityId: 'c1',
  entityName: '测试客户',
  operator: '张三',
  result: 'success',
  ipAddress: '127.0.0.1',
  ...over,
})

async function clearLogs(): Promise<void> {
  await pool.execute('DELETE FROM operation_logs')
}

async function countLogs(): Promise<number> {
  const [rows] = await pool.execute('SELECT COUNT(*) as cnt FROM operation_logs')
  return (rows as any[])[0].cnt
}

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
  await clearLogs()
})

afterEach(async () => {
  await clearLogs()
})

describe('logOperation - 写入操作日志', () => {
  it('成功写入完整字段', async () => {
    await logOperation(entry())
    const [rows] = await pool.execute('SELECT * FROM operation_logs')
    const row = (rows as any[])[0]
    expect(row.operation_type).toBe('delete')
    expect(row.entity_type).toBe('customer')
    expect(row.entity_id).toBe('c1')
    expect(row.entity_name).toBe('测试客户')
    expect(row.operator).toBe('张三')
    expect(row.result).toBe('success')
    expect(row.blocked_reason).toBeNull()
    expect(row.ip_address).toBe('127.0.0.1')
  })

  it('operator 为空时写 unknown', async () => {
    await logOperation(entry({ operator: '' }))
    const [rows] = await pool.execute('SELECT operator FROM operation_logs')
    expect((rows as any[])[0].operator).toBe('unknown')
  })

  it('blocked 结果携带 blockedReason', async () => {
    await logOperation(entry({ result: 'blocked', blockedReason: '存在关联数据' }))
    const [rows] = await pool.execute('SELECT result, blocked_reason FROM operation_logs')
    expect((rows as any[])[0].result).toBe('blocked')
    expect((rows as any[])[0].blocked_reason).toBe('存在关联数据')
  })

  it('blockedReason / ipAddress 缺省时写 NULL', async () => {
    await logOperation(entry({ blockedReason: undefined, ipAddress: undefined }))
    const [rows] = await pool.execute('SELECT blocked_reason, ip_address FROM operation_logs')
    expect((rows as any[])[0].blocked_reason).toBeNull()
    expect((rows as any[])[0].ip_address).toBeNull()
  })

  it('写入失败时静默（不抛出，主流程不受影响）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // 超长 entity_id 触发写入失败（VARCHAR(255) 超限报错）
    const long = 'x'.repeat(300)
    await expect(logOperation(entry({ entityId: long }))).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('getOperationLogs - 查询操作日志', () => {
  beforeEach(async () => {
    // 造 5 条数据：3 条 customer（2 blocked / 1 success），2 条 product
    await logOperation(entry({ entityId: 'c1', result: 'blocked', blockedReason: '被报价引用' }))
    await logOperation(entry({ entityId: 'c2', result: 'blocked', blockedReason: '被订单引用' }))
    await logOperation(entry({ entityId: 'c3', result: 'success' }))
    await logOperation(entry({ entityType: 'product', entityId: 'p1', result: 'success' }))
    await logOperation(entry({ entityType: 'product', entityId: 'p2', result: 'success' }))
  })

  it('默认返回全部（total=5）', async () => {
    const { rows, total } = await getOperationLogs({})
    expect(total).toBe(5)
    expect(rows).toHaveLength(5)
  })

  it('按实体类型过滤', async () => {
    const { rows, total } = await getOperationLogs({ entityType: 'product' })
    expect(total).toBe(2)
    expect(rows.every((r) => r.entity_type === 'product')).toBe(true)
  })

  it('按结果过滤', async () => {
    const { rows, total } = await getOperationLogs({ result: 'blocked' })
    expect(total).toBe(2)
    expect(rows.every((r) => r.result === 'blocked')).toBe(true)
  })

  it('实体类型 + 结果组合过滤', async () => {
    const { rows, total } = await getOperationLogs({ entityType: 'customer', result: 'blocked' })
    expect(total).toBe(2)
    expect(rows.every((r) => r.entity_type === 'customer' && r.result === 'blocked')).toBe(true)
  })

  it('limit 生效', async () => {
    const { rows, total } = await getOperationLogs({ limit: 2 })
    expect(rows).toHaveLength(2)
    expect(total).toBe(5) // total 不受 limit 影响
  })

  it('limit 上限 200（超出时截断）', async () => {
    const { rows } = await getOperationLogs({ limit: 500 })
    expect(rows.length).toBeLessThanOrEqual(200)
  })

  it('offset 生效', async () => {
    const page1 = await getOperationLogs({ limit: 2, offset: 0 })
    const page2 = await getOperationLogs({ limit: 2, offset: 2 })
    expect(page1.rows[0].id).not.toBe(page2.rows[0].id)
    expect(page2.rows.length).toBe(2)
    // 全部页加起来等于 total
    const page3 = await getOperationLogs({ limit: 2, offset: 4 })
    expect(page1.rows.length + page2.rows.length + page3.rows.length).toBe(5)
  })

  it('按 created_at 倒序（最新在前）', async () => {
    const { rows } = await getOperationLogs({})
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[i].created_at).getTime()
      )
    }
  })

  it('空表返回空列表', async () => {
    await clearLogs()
    const { rows, total } = await getOperationLogs({})
    expect(rows).toHaveLength(0)
    expect(total).toBe(0)
  })
})
