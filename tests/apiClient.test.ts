/**
 * 前端 API 客户端 单元测试
 * 测试目标：src/api/index.ts
 *   - authFetch：认证头附加（Bearer / X-Operator 中文 URL 编码）、401 自动刷新重试
 *   - handleResponse：JSON/纯文本/空响应解析、错误消息提取
 *   - 各资源端点：URL / method / body 组装
 *   - getThumbnailUrl：token / 版本参数组合
 *   - 导出：Blob 下载、服务端错误、收款单文件名解析与超时
 *   - downloadBlob：浏览器下载触发
 *
 * fetch 全量 mock，不依赖后端。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api, downloadBlob } from '../src/api/index'
import { useAuthStore } from '../src/store/auth'

// ─── 测试工具 ──────────────────────────────────────────────────

const fetchMock = vi.fn()

/** 构造 Response 风格对象（jsdom 无 fetch 实现） */
function mockResponse(init: {
  ok?: boolean
  status?: number
  body?: unknown
  text?: string
  headers?: Record<string, string | null>
}) {
  const ok = init.ok ?? (init.status ?? 200) < 400
  const text = init.text ?? JSON.stringify(init.body ?? {})
  return {
    ok,
    status: init.status ?? (ok ? 200 : 400),
    headers: { get: (k: string) => init.headers?.[k] ?? null },
    text: async () => text,
    json: async () => JSON.parse(text),
    blob: async () => new Blob([text], { type: 'application/octet-stream' }),
  }
}

/** 先通过 store login 建立带 refresh token 的登录态（供 401 重试用例复用） */
async function seedLogin(accessToken = 'tok-1', refreshToken = 'rt-1'): Promise<void> {
  fetchMock.mockResolvedValueOnce(mockResponse({
    body: {
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: { id: 'u1', name: '张三', email: 'z@x.com', permissions: [] },
    },
  }))
  await useAuthStore.getState().login('z@x.com', '123456')
  fetchMock.mockReset()
}

/** 读取 fetch 调用参数 */
function lastCall(): [string, RequestInit | undefined] {
  const c = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
  return [c[0], c[1]]
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  localStorage.clear()
  useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    accessToken: null,
    permissions: [],
    token: null,
    showExpiryWarning: false,
    secondsUntilExpiry: 0,
    isRefreshing: false,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  useAuthStore.setState({
    isAuthenticated: false,
    user: null,
    accessToken: null,
    permissions: [],
    token: null,
    showExpiryWarning: false,
    secondsUntilExpiry: 0,
    isRefreshing: false,
  })
})

// ─── authFetch：认证头 ─────────────────────────────────────────

describe('authFetch - 认证头附加', () => {
  it('附加 Bearer token 与 URL 编码后的中文操作人（X-Operator）', async () => {
    useAuthStore.setState({
      accessToken: 'tok-abc',
      user: { id: 'u1', name: '张三', email: 'z@x.com' },
    })
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { ok: 1 } }))

    await api.permissions.getAll()

    const [, init] = lastCall()
    expect(init.headers['Authorization']).toBe('Bearer tok-abc')
    expect(init.headers['X-Operator']).toBe(encodeURIComponent('张三'))
    expect(init.cache).toBe('no-store')
  })

  it('未登录（无 token / 无 user）：不附加 Authorization，操作人为 unknown', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: {} }))
    await api.users.getAll()
    const [, init] = lastCall()
    expect(init.headers['Authorization']).toBeUndefined()
    expect(init.headers['X-Operator']).toBe('unknown')
  })

  it('有 token 但无 user：仅附加 Authorization，操作人为 unknown', async () => {
    useAuthStore.setState({ accessToken: 'tok-x' })
    fetchMock.mockResolvedValueOnce(mockResponse({ body: {} }))
    await api.users.getAll()
    const [, init] = lastCall()
    expect(init.headers['Authorization']).toBe('Bearer tok-x')
    expect(init.headers['X-Operator']).toBe('unknown')
  })

  it('401 后自动刷新 token 并重试（携带新 token）', async () => {
    await seedLogin('tok-old')
    // 主请求 401 → 刷新成功 → 重试成功
    fetchMock
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, text: '' }))
      .mockResolvedValueOnce(mockResponse({ body: { accessToken: 'tok-new', expiresIn: 900 } }))
      .mockResolvedValueOnce(mockResponse({ body: { list: [1, 2] } }))

    const result = await api.users.getAll()

    expect(result).toEqual({ list: [1, 2] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [retryUrl, retryInit] = fetchMock.mock.calls[2]
    expect(retryUrl).toBe('/api/users')
    expect(retryInit.headers['Authorization']).toBe('Bearer tok-new')
  })

  it('401 后刷新失败：返回 401 响应，handleResponse 抛出状态码错误', async () => {
    await seedLogin('tok-old')
    fetchMock
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, text: '' }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 401, text: '' })) // 刷新也失败

    await expect(api.users.getAll()).rejects.toThrow('请求失败 (401)')
  })

  it('401 且本地无 refresh token（refreshToken 返回 false）：不重试', async () => {
    useAuthStore.setState({ accessToken: 'tok-old' }) // 无持久化 refresh token
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401, body: { error: '未授权' } }))

    await expect(api.users.getAll()).rejects.toThrow('未授权')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ─── handleResponse：响应解析 ──────────────────────────────────

describe('handleResponse - 响应解析', () => {
  it('成功 + JSON：返回解析对象', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { data: 'x' } }))
    await expect(api.roles.getAll()).resolves.toEqual({ data: 'x' })
  })

  it('成功 + 空响应体：返回 null', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: '' }))
    await expect(api.roles.getAll()).resolves.toBeNull()
  })

  it('成功 + 非法 JSON：返回 null', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: 'not-json' }))
    await expect(api.roles.getAll()).resolves.toBeNull()
  })

  it('失败 + JSON error 字段：抛出 error 内容', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 403, body: { error: '无权限访问' } }))
    await expect(api.roles.getAll()).rejects.toThrow('无权限访问')
  })

  it('失败 + JSON message 字段（无 error）：抛出 message 内容', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 422, body: { message: '参数不合法' } }))
    await expect(api.roles.getAll()).rejects.toThrow('参数不合法')
  })

  it('失败 + 纯文本：抛出文本内容', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: '服务器内部错误' }))
    await expect(api.roles.getAll()).rejects.toThrow('服务器内部错误')
  })

  it('失败 + 空响应体：抛出默认状态码消息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 502, text: '' }))
    await expect(api.roles.getAll()).rejects.toThrow('请求失败 (502)')
  })
})

// ─── 端点组装 ─────────────────────────────────────────────────

describe('端点 URL / method / body 组装', () => {
  it('auth.login：POST /api/auth/login（不走 authFetch，无认证头）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { accessToken: 'a' } }))
    await api.auth.login('a@b.c', 'p')
    const [url, init] = lastCall()
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(init.headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.c', password: 'p' })
  })

  it('auth.refresh：POST /api/auth/refresh', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: {} }))
    await api.auth.refresh('r-token')
    const [url, init] = lastCall()
    expect(url).toBe('/api/auth/refresh')
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'r-token' })
  })

  it('auth.changePassword：PUT /api/auth/password', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: '' }))
    await api.auth.changePassword('old', 'new')
    const [url, init] = lastCall()
    expect(url).toBe('/api/auth/password')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ oldPassword: 'old', newPassword: 'new' })
  })

  it('users：getById / create / update / resetPassword / delete', async () => {
    fetchMock.mockResolvedValue(mockResponse({ text: '' }))
    await api.users.getById('u9')
    expect(lastCall()[0]).toBe('/api/users/u9')

    await api.users.create({ name: 'n' })
    let [url, init] = lastCall()
    expect(url).toBe('/api/users')
    expect(init.method).toBe('POST')

    await api.users.update('u9', { name: 'm' })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/users/u9')
    expect(init.method).toBe('PUT')

    await api.users.resetPassword('u9', 'np')
    ;[url, init] = lastCall()
    expect(url).toBe('/api/users/u9/password')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ newPassword: 'np' })

    await api.users.delete('u9')
    ;[url, init] = lastCall()
    expect(url).toBe('/api/users/u9')
    expect(init.method).toBe('DELETE')
  })

  it('customers.getByName：中文名称 URL 编码', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: {} }))
    await api.customers.getByName('杭州 客户')
    const [url] = lastCall()
    expect(url).toBe(`/api/customers/name/${encodeURIComponent('杭州 客户')}`)
  })

  it('quotes：做货任务 / 状态流转 / 复制 / 删除检查', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.quotes.getProductionTasks('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/production-tasks')

    await api.quotes.getProductionTasksOverview()
    expect(lastCall()[0]).toBe('/api/quotes/production-tasks/overview')

    await api.quotes.saveProductionTasks('q1', [{ name: '步骤' }])
    const [url, init] = lastCall()
    expect(url).toBe('/api/quotes/q1/production-tasks')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ tasks: [{ name: '步骤' }] })

    await api.quotes.nextStatus('q1')
    ;[lastCall()[0], lastCall()[1]!]
    expect(lastCall()[0]).toBe('/api/quotes/q1/next-status')
    expect(lastCall()[1]!.method).toBe('POST')

    await api.quotes.prevStatus('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/prev-status')

    await api.quotes.endQuote('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/end')

    await api.quotes.copy('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/copy')

    await api.quotes.deleteCheck('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/delete-check')

    await api.quotes.getImageFlags()
    expect(lastCall()[0]).toBe('/api/quotes/image-flags')
  })

  it('quotes：对账管理（v28）成本明细 / 确认对账 / 退回对账', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.quotes.getReconciliationCosts('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/reconciliation-costs')

    await api.quotes.saveReconciliationCosts('q1', [{ name: '烫金', cost: 66 }])
    const [url, init] = lastCall()
    expect(url).toBe('/api/quotes/q1/reconciliation-costs')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ costs: [{ name: '烫金', cost: 66 }] })

    await api.quotes.reconcileQuote('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/reconcile')
    expect(lastCall()[1]!.method).toBe('POST')

    await api.quotes.unreconcileQuote('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1/unreconcile')
    expect(lastCall()[1]!.method).toBe('POST')
  })

  it('sheetTemplates.getAll：styleCode 过滤参数编码', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: [] }))
    await api.sheetTemplates.getAll()
    expect(lastCall()[0]).toBe('/api/sheet-templates')

    await api.sheetTemplates.getAll('1')
    expect(lastCall()[0]).toBe('/api/sheet-templates?styleCode=1')
  })

  it('sheetTemplates.create / update：payload 透传', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.sheetTemplates.create({ styleCode: '1', name: '模板A', data: [[1]], formulas: { A1: '=1' } })
    let [url, init] = lastCall()
    expect(url).toBe('/api/sheet-templates')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ styleCode: '1', name: '模板A', data: [[1]], formulas: { A1: '=1' } })

    await api.sheetTemplates.update('t1', { name: 'B', data: [[2]], formulas: {} })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/sheet-templates/t1')
    expect(init.method).toBe('PUT')
  })

  it('orders / products / processCosts：update 与 deleteCheck', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.orders.update('o1', { status: 3 })
    expect(lastCall()[0]).toBe('/api/orders/o1')
    expect(lastCall()[1]!.method).toBe('PUT')

    await api.orders.deleteCheck('o1')
    expect(lastCall()[0]).toBe('/api/orders/o1/delete-check')

    await api.products.delete('p1')
    expect(lastCall()[0]).toBe('/api/products/p1')
    expect(lastCall()[1]!.method).toBe('DELETE')

    await api.processCosts.getAll()
    expect(lastCall()[0]).toBe('/api/process-costs')
  })
})

// ─── 其余资源端点全覆盖 ───────────────────────────────────────

describe('剩余端点 URL / method / body 组装（补全覆盖）', () => {
  it('auth.me：GET /api/auth/me', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { id: 'u1' } }))
    await api.auth.me()
    const [url, init] = lastCall()
    expect(url).toBe('/api/auth/me')
    expect(init.method).toBeUndefined()
  })

  it('roles：getById / create / update / delete', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.roles.getById('r1')
    expect(lastCall()[0]).toBe('/api/roles/r1')

    await api.roles.create({ name: '角色' })
    let [url, init] = lastCall()
    expect(url).toBe('/api/roles')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: '角色' })

    await api.roles.update('r1', { name: '改名' })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/roles/r1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ name: '改名' })

    await api.roles.delete('r1')
    ;[url, init] = lastCall()
    expect(url).toBe('/api/roles/r1')
    expect(init.method).toBe('DELETE')
  })

  it('orders：getAll / getById / delete', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.orders.getAll()
    expect(lastCall()[0]).toBe('/api/orders')

    await api.orders.getById('o1')
    expect(lastCall()[0]).toBe('/api/orders/o1')

    await api.orders.delete('o1')
    expect(lastCall()[0]).toBe('/api/orders/o1')
    expect(lastCall()[1]!.method).toBe('DELETE')
  })

  it('customers：getAll / getById / create / update / delete / deleteCheck', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.customers.getAll()
    expect(lastCall()[0]).toBe('/api/customers')

    await api.customers.getById('c1')
    expect(lastCall()[0]).toBe('/api/customers/c1')

    await api.customers.create({ name: '客户A' })
    let [url, init] = lastCall()
    expect(url).toBe('/api/customers')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: '客户A' })

    await api.customers.update('c1', { name: '客户B' })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/customers/c1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ name: '客户B' })

    await api.customers.delete('c1')
    ;[url, init] = lastCall()
    expect(url).toBe('/api/customers/c1')
    expect(init.method).toBe('DELETE')

    await api.customers.deleteCheck('c1')
    expect(lastCall()[0]).toBe('/api/customers/c1/delete-check')
  })

  it('products：getAll / getById / create / update / deleteCheck', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.products.getAll()
    expect(lastCall()[0]).toBe('/api/products')

    await api.products.getById('p1')
    expect(lastCall()[0]).toBe('/api/products/p1')

    await api.products.create({ name: '产品' })
    let [url, init] = lastCall()
    expect(url).toBe('/api/products')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: '产品' })

    await api.products.update('p1', { name: '新品' })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/products/p1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ name: '新品' })

    await api.products.deleteCheck('p1')
    expect(lastCall()[0]).toBe('/api/products/p1/delete-check')
  })

  it('quotes：getAll / getById / create / update / delete', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.quotes.getAll()
    expect(lastCall()[0]).toBe('/api/quotes')

    await api.quotes.getById('q1')
    expect(lastCall()[0]).toBe('/api/quotes/q1')

    await api.quotes.create({ customerName: '客户' })
    let [url, init] = lastCall()
    expect(url).toBe('/api/quotes')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ customerName: '客户' })

    await api.quotes.update('q1', { status: 3 })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/quotes/q1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ status: 3 })

    await api.quotes.delete('q1')
    ;[url, init] = lastCall()
    expect(url).toBe('/api/quotes/q1')
    expect(init.method).toBe('DELETE')
  })

  it('processCosts：getById / create / update / delete / deleteCheck', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.processCosts.getById('pc1')
    expect(lastCall()[0]).toBe('/api/process-costs/pc1')

    await api.processCosts.create({ name: '烫金' })
    let [url, init] = lastCall()
    expect(url).toBe('/api/process-costs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: '烫金' })

    await api.processCosts.update('pc1', { name: '压花' })
    ;[url, init] = lastCall()
    expect(url).toBe('/api/process-costs/pc1')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ name: '压花' })

    await api.processCosts.delete('pc1')
    ;[url, init] = lastCall()
    expect(url).toBe('/api/process-costs/pc1')
    expect(init.method).toBe('DELETE')

    await api.processCosts.deleteCheck('pc1')
    expect(lastCall()[0]).toBe('/api/process-costs/pc1/delete-check')
  })

  it('sheetTemplates：getById / delete', async () => {
    fetchMock.mockResolvedValue(mockResponse({ body: {} }))
    await api.sheetTemplates.getById('t1')
    expect(lastCall()[0]).toBe('/api/sheet-templates/t1')

    await api.sheetTemplates.delete('t1')
    expect(lastCall()[0]).toBe('/api/sheet-templates/t1')
    expect(lastCall()[1]!.method).toBe('DELETE')
  })
})

// ─── getThumbnailUrl ──────────────────────────────────────────

describe('getThumbnailUrl - 缩略图 URL', () => {
  it('携带 token 与版本参数', () => {
    useAuthStore.setState({ accessToken: 'tok' })
    const url = api.quotes.getThumbnailUrl('q1', '2026-09-10T00:00:00.000Z')
    expect(url).toContain('/api/quotes/q1/thumbnail?')
    expect(url).toContain('token=tok')
    expect(url).toContain('_v=' + encodeURIComponent('2026-09-10T00:00:00.000Z'))
  })

  it('仅 token 无版本', () => {
    useAuthStore.setState({ accessToken: 'tok' })
    const url = api.quotes.getThumbnailUrl('q1')
    expect(url).toBe('/api/quotes/q1/thumbnail?token=tok')
  })

  it('无 token 无版本：裸 URL', () => {
    const url = api.quotes.getThumbnailUrl('q1')
    expect(url).toBe('/api/quotes/q1/thumbnail')
  })
})

// ─── 导出 ─────────────────────────────────────────────────────

describe('api.export.orders - 订单列表导出', () => {
  it('成功：返回 Blob', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: 'binary-content' }))
    const blob = await api.export.orders(['q1', 'q2'])
    expect(blob).toBeInstanceOf(Blob)
    const [url, init] = lastCall()
    expect(url).toBe('/api/export/orders')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ orderIds: ['q1', 'q2'] })
  })

  it('失败（JSON error）：抛出服务端错误信息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 403, body: { error: '无导出权限' } }))
    await expect(api.export.orders([])).rejects.toThrow('无导出权限')
  })

  it('失败（纯文本）：抛出文本内容', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: '服务器开小差了' }))
    await expect(api.export.orders([])).rejects.toThrow('服务器开小差了')
  })

  it('失败（空响应体）：抛出默认状态码消息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: '' }))
    await expect(api.export.orders([])).rejects.toThrow('导出失败 (500)')
  })
})

describe('api.export.orderWithTable - 单订单 + 在线表格导出', () => {
  it('成功：返回 Blob', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: 'xlsx-bytes' }))
    const blob = await api.export.orderWithTable('q1', { data: [[1]], formulas: {} })
    expect(blob).toBeInstanceOf(Blob)
    const [url, init] = lastCall()
    expect(url).toBe('/api/export/order-with-table')
    expect(JSON.parse(init.body)).toEqual({ orderId: 'q1', tableData: { data: [[1]], formulas: {} } })
  })

  it('失败：抛出服务端错误信息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, body: { error: '订单不存在' } }))
    await expect(api.export.orderWithTable('q1', { data: [], formulas: {} })).rejects.toThrow('订单不存在')
  })
})

describe('api.export.paymentReceipts - 收款单导出', () => {
  it('成功：从 X-Export-Filename 头解析文件名（URL 解码）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      text: 'xlsx-data',
      headers: { 'X-Export-Filename': encodeURIComponent('收款单_20260910.xlsx') },
    }))
    const { blob, filename } = await api.export.paymentReceipts(['q1'], '')
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toBe('收款单_20260910.xlsx')
  })

  it('无文件名头：回退默认命名（收款单_时间戳.xlsx）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: 'x' }))
    const { filename } = await api.export.paymentReceipts(['q1'], '客户A')
    expect(filename).toMatch(/^收款单_\d{14}\.xlsx$/)
    const [, init] = lastCall()
    expect(JSON.parse(init.body)).toEqual({ orderIds: ['q1'], customerFilter: '客户A' })
  })

  it('非法 URL 编码的文件名头：原样使用', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      text: 'x',
      headers: { 'X-Export-Filename': '%invalid%-name' },
    }))
    const { filename } = await api.export.paymentReceipts(['q1'], '')
    expect(filename).toBe('%invalid%-name')
  })

  it('失败：透传服务端错误码与消息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      ok: false, status: 400, body: { error: '所选订单不含未收款订单', code: 'NO_RECEIVABLE' },
    }))
    const err = await api.export.paymentReceipts(['q1'], '').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('所选订单不含未收款订单')
    expect(err.code).toBe('NO_RECEIVABLE')
  })

  it('超时（AbortError）：抛出 timeout 标记错误', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
    const err = await api.export.paymentReceipts(['q1'], '').catch((e) => e)
    expect(err.message).toBe('导出超时，请尝试减少数据量后重试')
    expect(err.timeout).toBe(true)
  })

  it('网络异常（非 AbortError）：原样透传错误', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await api.export.paymentReceipts(['q1'], '').catch((e) => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(err.message).toBe('Failed to fetch')
    expect(err.timeout).toBeUndefined()
  })
})

// ─── downloadBlob ─────────────────────────────────────────────

describe('downloadBlob - 浏览器下载触发', () => {
  it('创建 <a download> 并点击，延迟释放 objectURL', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
    // downloadBlob 同步执行完会将 <a> 移出 DOM，在 click 时捕获节点检查属性
    let clicked: HTMLAnchorElement | null = null
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this
    })

    vi.useFakeTimers()
    try {
      downloadBlob(new Blob(['x']), '文件.xlsx')
      expect(clicked).not.toBeNull()
      expect(clicked!.download).toBe('文件.xlsx')
      expect(clicked!.href).toContain('blob:mock-url')
      expect(clickSpy).toHaveBeenCalledTimes(1)
      // 点击后从 DOM 移除
      expect(document.querySelector('a[download]')).toBeNull()
      // 尚未释放
      expect(revokeObjectURL).not.toHaveBeenCalled()
      // 1 秒后释放
      vi.advanceTimersByTime(1000)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    } finally {
      vi.useRealTimers()
      clickSpy.mockRestore()
    }
  })
})
