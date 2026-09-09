/**
 * 款式模板路由测试（api/routes/sheetTemplates.ts）
 *
 * 测试目标（新增产品款式模板同步）：
 *   1. 款式编码动态校验：产品管理中存在对应产品（按 code 或 id 匹配）即合法
 *      - 内置款式 1-6（默认款式产品 style-1~6）
 *      - 新增产品的自定义编码（如 7）
 *      - 无编码产品：产品 id 作为款式值（订单页同规则）
 *   2. 不存在的款式编码返回 400 并引导到产品管理
 *   3. GET ?styleCode= 过滤支持自定义编码；空值返回 400
 *
 * 说明：Express Router 本身是中间件函数，直接传入 mock req/res 调用，
 * 权限中间件通过 req.permissions（Set）注入，不启动服务器。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { Request } from 'express'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import { sheetTemplatesRouter } from '../api/routes/sheetTemplates'

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
})

// ─── Mock 工具 ──────────────────────────────────────────────────

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    query: {},
    ...overrides,
  } as Request
}

/** POST /sheet-templates 请求（注入编辑权限，绕过认证） */
function postReq(body: any): Request {
  return createMockReq({
    method: 'POST',
    url: '/',
    body,
    user: { id: 'user-test', name: '测试用户' },
    permissions: new Set(['sheet-templates:edit']),
  })
}

/** 调用路由并等待响应（res.json 时 resolve） */
function handleRoute(req: Request): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this },
      json(data: any) { resolve({ status: this.statusCode, body: data }); return this },
    }
    const next = (err?: any) => {
      if (err) reject(err)
      else resolve({ status: 500, body: { error: 'no route matched' } })
    }
    sheetTemplatesRouter(req as any, res, next)
  })
}

const TEST_DATA = [['表头', 1, 2]]
const TEST_FORMULAS = { B2: '=B1*2' }

// ============================================================

describe('款式模板路由：款式编码动态校验（新增产品款式同步）', () => {
  it('内置款式（默认款式产品 style-1~6 的 code）可创建模板', async () => {
    const r = await handleRoute(postReq({ styleCode: '2', name: '常规款', data: TEST_DATA, formulas: TEST_FORMULAS }))
    expect(r.status).toBe(201)
    expect(r.body.styleCode).toBe('2')
    expect(r.body.name).toBe('常规款')
    expect(r.body.data).toEqual(TEST_DATA)
  })

  it('新增产品的自定义编码（如 7）可创建模板并被订单页模板列表加载', async () => {
    await db.products.create({ name: '背心袋', sku: 'BX-001', code: '7', price: 1, category: '款式', stock: 0 })

    const created = await handleRoute(postReq({ styleCode: '7', name: '背心袋常规', data: TEST_DATA, formulas: TEST_FORMULAS }))
    expect(created.status).toBe(201)
    expect(created.body.styleCode).toBe('7')

    // GET /（订单页 loadOverrides 使用）：全部模板包含自定义款式模板
    const list = await handleRoute(createMockReq({ method: 'GET', url: '/' }))
    expect(list.status).toBe(200)
    expect((list.body as any[]).some((t) => t.styleCode === '7' && t.name === '背心袋常规')).toBe(true)
  })

  it('无编码产品：产品 id 作为款式值可创建模板（与订单页款式值规则一致）', async () => {
    const product = await db.products.create({ name: '束口袋', sku: 'SDK-001', code: '', price: 1, category: '款式', stock: 0 }) as any

    const r = await handleRoute(postReq({ styleCode: product.id, name: '束口袋模板', data: TEST_DATA, formulas: TEST_FORMULAS }))
    if (r.status !== 201) console.log('DEBUG 409 body:', JSON.stringify(r.body))
    expect(r.status).toBe(201)
    expect(r.body.styleCode).toBe(product.id)
  })

  it('不存在的款式编码返回 400 并引导到产品管理', async () => {
    const r = await handleRoute(postReq({ styleCode: '999', name: '孤儿模板', data: TEST_DATA, formulas: TEST_FORMULAS }))
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('产品管理')
  })

  it('GET ?styleCode= 支持自定义编码过滤', async () => {
    await db.products.create({ name: '背心袋', sku: 'BX-001', code: '7', price: 1, category: '款式', stock: 0 })
    await handleRoute(postReq({ styleCode: '7', name: '背心袋常规', data: TEST_DATA, formulas: TEST_FORMULAS }))
    await handleRoute(postReq({ styleCode: '2', name: '常规款', data: TEST_DATA, formulas: TEST_FORMULAS }))

    const r = await handleRoute(createMockReq({ method: 'GET', url: '/?styleCode=7', query: { styleCode: '7' } }))
    expect(r.status).toBe(200)
    expect(r.body).toHaveLength(1)
    expect(r.body[0].name).toBe('背心袋常规')
  })

  it('GET ?styleCode= 空值返回 400', async () => {
    const r = await handleRoute(createMockReq({ method: 'GET', url: '/?styleCode=', query: { styleCode: '' } }))
    expect(r.status).toBe(400)
  })
})
