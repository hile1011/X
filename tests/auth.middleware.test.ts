/**
 * 认证与权限中间件单元测试 (api/middleware/auth.ts)
 *
 * 测试目标：
 *   - authenticate：无 token / 无效 token / 有效 token / AUTH_ENABLED=false 灰度
 *   - requirePermission：有权限 / 无权限
 *   - requireAnyPermission：有任一 / 全无
 *   - requireRole：有角色 / 无角色
 *
 * 使用 mock Request/Response/NextFunction 对象，不启动 Express 服务器。
 * 数据库操作使用测试数据库的真实数据（默认管理员账号）。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { signAccessToken, signRefreshToken } from '../api/services/auth'
import { authenticate, requirePermission, requireAnyPermission, requireRole } from '../api/middleware/auth'
import { invalidatePermissionCache } from '../api/services/rbac'
import type { Request, Response, NextFunction } from 'express'

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
  // 清除权限缓存，确保每个测试读取最新数据库状态
  invalidatePermissionCache()
})

// ─── Mock 工具 ──────────────────────────────────────────────────

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    ...overrides,
  } as Request
}

function createMockRes(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this },
    json(data: any) { this.body = data; return this },
  }
  return res
}

function createMockNext(): NextFunction & { mock: { calls: any[][] } } {
  return vi.fn() as any
}

/** 签发一个默认管理员的 access token */
function getAdminToken(): string {
  return signAccessToken({ id: 'user-admin-default', email: '517290808@qq.com', name: '管理员' })
}

// ============================================================
// authenticate 中间件
// ============================================================
describe('authenticate 中间件', () => {
  it('无 Authorization 头 → 401', async () => {
    const req = createMockReq()
    const res = createMockRes()
    const next = createMockNext()

    await authenticate(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBeTruthy()
    expect(next).not.toHaveBeenCalled()
  })

  it('Authorization 头无 Bearer 前缀 → 401', async () => {
    const req = createMockReq({ headers: { authorization: 'Token abc123' } } as any)
    const res = createMockRes()
    const next = createMockNext()

    await authenticate(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('无效 token → 401', async () => {
    const req = createMockReq({ headers: { authorization: 'Bearer invalid-token' } } as any)
    const res = createMockRes()
    const next = createMockNext()

    await authenticate(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toContain('无效')
    expect(next).not.toHaveBeenCalled()
  })

  it('有效 token → 设置 req.user 和 req.permissions，调用 next', async () => {
    const token = getAdminToken()
    const req = createMockReq({ headers: { authorization: `Bearer ${token}` } } as any)
    const res = createMockRes()
    const next = createMockNext()

    await authenticate(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(req.user).toBeDefined()
    expect(req.user!.id).toBe('user-admin-default')
    expect(req.user!.email).toBe('517290808@qq.com')
    expect(req.permissions).toBeDefined()
    expect(req.permissions!.size).toBeGreaterThan(0)
    expect(req.permissions!.has('quotes:view')).toBe(true)
  })

  it('refresh token 不能用于认证（type 不匹配）', async () => {
    const refreshToken = signRefreshToken('user-admin-default')
    const req = createMockReq({ headers: { authorization: `Bearer ${refreshToken}` } } as any)
    const res = createMockRes()
    const next = createMockNext()

    await authenticate(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('AUTH_ENABLED=false → 跳过认证', async () => {
    const prevValue = process.env.AUTH_ENABLED
    process.env.AUTH_ENABLED = 'false'
    try {
      const req = createMockReq()
      const res = createMockRes()
      const next = createMockNext()

      await authenticate(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(res.statusCode).toBe(200)
      // AUTH_ENABLED=false 时不设置 req.user
      expect(req.user).toBeUndefined()
    } finally {
      if (prevValue === undefined) delete process.env.AUTH_ENABLED
      else process.env.AUTH_ENABLED = prevValue
    }
  })
})

// ============================================================
// requirePermission 中间件
// ============================================================
describe('requirePermission 中间件', () => {
  it('拥有指定权限 → 调用 next', () => {
    const req = createMockReq()
    req.permissions = new Set(['quotes:view', 'quotes:edit'])
    const res = createMockRes()
    const next = createMockNext()

    requirePermission('quotes:view')(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(200)
  })

  it('缺少指定权限 → 403', () => {
    const req = createMockReq()
    req.permissions = new Set(['quotes:view'])
    const res = createMockRes()
    const next = createMockNext()

    requirePermission('quotes:delete')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('权限不足')
    expect(res.body.required).toBe('quotes:delete')
    expect(next).not.toHaveBeenCalled()
  })

  it('req.permissions 未设置 → 403', () => {
    const req = createMockReq()
    const res = createMockRes()
    const next = createMockNext()

    requirePermission('quotes:view')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})

// ============================================================
// requireAnyPermission 中间件
// ============================================================
describe('requireAnyPermission 中间件', () => {
  it('拥有其中一个权限 → 调用 next', () => {
    const req = createMockReq()
    req.permissions = new Set(['quotes:edit'])
    const res = createMockRes()
    const next = createMockNext()

    requireAnyPermission('quotes:delete', 'quotes:edit')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('全部权限都没有 → 403', () => {
    const req = createMockReq()
    req.permissions = new Set(['quotes:view'])
    const res = createMockRes()
    const next = createMockNext()

    requireAnyPermission('quotes:delete', 'quotes:edit')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(next).not.toHaveBeenCalled()
  })
})

// ============================================================
// requireRole 中间件
// ============================================================
describe('requireRole 中间件', () => {
  it('拥有指定角色 → 调用 next', async () => {
    const req = createMockReq()
    req.user = { id: 'user-admin-default', email: '517290808@qq.com', name: '管理员' }
    const res = createMockRes()
    const next = createMockNext()

    await requireRole('admin')(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('缺少指定角色 → 403', async () => {
    const req = createMockReq()
    req.user = { id: 'user-admin-default', email: '517290808@qq.com', name: '管理员' }
    const res = createMockRes()
    const next = createMockNext()

    await requireRole('superadmin')(req, res, next)

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toContain('superadmin')
    expect(next).not.toHaveBeenCalled()
  })

  it('未认证（req.user 未设置）→ 401', async () => {
    const req = createMockReq()
    const res = createMockRes()
    const next = createMockNext()

    await requireRole('admin')(req, res, next)

    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
