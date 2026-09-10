/**
 * 删除处理辅助函数 单元测试
 * 测试目标：api/services/deleteHandler.ts
 *   - createDeleteCheckHandler：透传 checkDelete 结果
 *   - createProtectedDeleteHandler：
 *     - 实体不存在 → 404 + blocked 日志
 *     - 阻断性关联 → 409 + 关联详情 + blocked 日志
 *     - 删除执行失败（deleteFn 返回 false）→ 404 + blocked 日志
 *     - 删除成功 → 200 + success 日志
 *   - 操作人提取：req.user 优先 / X-Operator 头（URL 编码）/ unknown
 *   - 客户端 IP 提取：X-Forwarded-For 优先
 *
 * MySQL 测试库提供真实 deleteGuard/auditLog 行为，req/res 对象 mock。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response } from 'express'
import { pool } from '../api/dbClient.js'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import {
  createDeleteCheckHandler,
  createProtectedDeleteHandler,
} from '../api/services/deleteHandler'

// ─── mock 工具 ─────────────────────────────────────────────────

function mockReq(over: Partial<Request> = {}): Request {
  return {
    params: { id: 'target-1' },
    headers: {},
    socket: { remoteAddress: '192.168.1.10' },
    ...over,
  } as unknown as Request
}

function mockRes(): Response & { statusCode: number } {
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json: vi.fn(),
  }
  return res as unknown as Response & { statusCode: number }
}

async function clearLogs(): Promise<void> {
  await pool.execute('DELETE FROM operation_logs')
}

async function lastLog(): Promise<any> {
  const [rows] = await pool.execute(
    'SELECT * FROM operation_logs ORDER BY id DESC LIMIT 1'
  )
  return (rows as any[])[0]
}

// ─── 测试 ──────────────────────────────────────────────────────

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

describe('createDeleteCheckHandler - 删除前检查', () => {
  it('透传 checkDelete 结果（客户不存在场景）', async () => {
    const handler = createDeleteCheckHandler('customer')
    const req = mockReq({ params: { id: 'ghost' } })
    const res = mockRes()

    await handler(req, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        canDelete: false,
        entityInfo: expect.objectContaining({ name: '(不存在)', type: 'customer' }),
      })
    )
  })

  it('可删除实体返回 canDelete=true', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createDeleteCheckHandler('customer')
    const res = mockRes()

    await handler(mockReq(), res as never)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ canDelete: true })
    )
  })
})

describe('createProtectedDeleteHandler - 受保护删除', () => {
  const deleteFn = vi.fn()

  beforeEach(() => {
    deleteFn.mockReset().mockResolvedValue(true)
  })

  it('实体不存在 → 404 + blocked 日志（原因：实体不存在）', async () => {
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const res = mockRes()

    await handler(mockReq(), res as never)

    expect(res.statusCode).toBe(404)
    expect(res.json).toHaveBeenCalledWith({ error: '数据不存在' })
    expect(deleteFn).not.toHaveBeenCalled()
    const log = await lastLog()
    expect(log.result).toBe('blocked')
    expect(log.blocked_reason).toBe('实体不存在')
    expect(log.operator).toBe('unknown')
    expect(log.ip_address).toBe('192.168.1.10')
  })

  it('存在阻断性关联 → 409 + 关联详情', async () => {
    // 客户被报价引用 → deleteGuard 阻断
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '被引用客户')"
    )
    await db.quotes.create({ customerName: '被引用客户', productStyle: '1' })

    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const res = mockRes()

    await handler(mockReq(), res as never)

    expect(res.statusCode).toBe(409)
    const payload = res.json.mock.calls[0][0]
    expect(payload.error).toBe('存在关联数据，无法删除')
    expect(payload.relationships).toHaveLength(1)
    expect(payload.entityInfo.name).toBe('被引用客户')
    expect(deleteFn).not.toHaveBeenCalled()
    const log = await lastLog()
    expect(log.result).toBe('blocked')
    expect(log.blocked_reason).toContain('报价/订单引用')
  })

  it('无关联 → 执行删除并返回成功 + success 日志', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const res = mockRes()

    await handler(mockReq(), res as never)

    expect(deleteFn).toHaveBeenCalledWith('target-1')
    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith({ message: '删除成功' })
    const log = await lastLog()
    expect(log.result).toBe('success')
    expect(log.entity_name).toBe('自由客户')
    expect(log.blocked_reason).toBeNull()
  })

  it('deleteFn 返回 false → 404（数据可能已被并发删除）', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    deleteFn.mockResolvedValue(false)
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const res = mockRes()

    await handler(mockReq(), res as never)

    expect(res.statusCode).toBe(404)
    expect(res.json).toHaveBeenCalledWith({ error: '数据不存在' })
    const log = await lastLog()
    expect(log.result).toBe('blocked')
    expect(log.blocked_reason).toContain('删除执行失败')
  })

  it('操作人提取：req.user.name 优先', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const req = mockReq({ user: { name: 'JWT用户' } } as Partial<Request>)

    await handler(req, mockRes() as never)

    const log = await lastLog()
    expect(log.operator).toBe('JWT用户')
  })

  it('操作人提取：X-Operator 头 URL 解码（中文操作人）', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const req = mockReq({ headers: { 'x-operator': encodeURIComponent('头部操作人') } } as Partial<Request>)

    await handler(req, mockRes() as never)

    const log = await lastLog()
    expect(log.operator).toBe('头部操作人')
  })

  it('操作人提取：X-Operator 头非法编码时原样使用', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const req = mockReq({ headers: { 'x-operator': '%E4%BD%%坏的编码' } } as Partial<Request>)

    await handler(req, mockRes() as never)

    const log = await lastLog()
    expect(log.operator).toBe('%E4%BD%%坏的编码')
  })

  it('IP 提取：X-Forwarded-For 首个地址优先', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const req = mockReq({
      headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.1' },
    } as Partial<Request>)

    await handler(req, mockRes() as never)

    const log = await lastLog()
    expect(log.ip_address).toBe('10.0.0.1')
  })

  it('IP 提取：无代理头时用 socket.remoteAddress', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)

    await handler(mockReq(), mockRes() as never)

    const log = await lastLog()
    expect(log.ip_address).toBe('192.168.1.10')
  })

  it('IP 提取：代理头为空串时回退 socket.remoteAddress', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const req = mockReq({
      headers: { 'x-forwarded-for': '' },
    } as Partial<Request>)

    await handler(req, mockRes() as never)

    const log = await lastLog()
    expect(log.ip_address).toBe('192.168.1.10')
  })

  it('IP 提取：无代理头且无 remoteAddress 时为空串', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name) VALUES ('target-1', '自由客户')"
    )
    const handler = createProtectedDeleteHandler('customer', deleteFn)
    const req = mockReq({
      socket: { remoteAddress: undefined },
    } as Partial<Request>)

    await handler(req, mockRes() as never)

    const log = await lastLog()
    expect(log.ip_address ?? '').toBe('')
  })
})
