/**
 * 认证状态管理（Zustand store）单元测试
 * 测试目标：src/store/auth.ts
 *   - login：成功/失败、refresh token 加密持久化、旧 cookie 清理
 *   - logout：状态与持久化清理
 *   - initAuth：用 refresh token 恢复登录态（成功/各失败分支）
 *   - refreshToken：成功/失败/无 token/并发单例
 *   - recordActivity：活动关闭警告 + 临近过期自动续期
 *   - checkTokenStatus：过期/临近过期/远离过期
 *   - 权限检查 hasPermission / hasAnyPermission
 *
 * fetch 全量 mock，不依赖后端。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuthStore } from '../../src/store/auth'

// ─── 测试工具 ──────────────────────────────────────────────────

/** 构造 Response 风格对象（jsdom 无 fetch 实现） */
function mockResponse(init: { ok?: boolean; status?: number; body?: unknown; text?: string }) {
  const ok = init.ok ?? (init.status ?? 200) < 400
  const text = init.text ?? JSON.stringify(init.body ?? {})
  return {
    ok,
    status: init.status ?? (ok ? 200 : 400),
    json: async () => JSON.parse(text),
    text: async () => text,
  }
}

/** 构造指定过期时间（秒级 exp）的 JWT 形态 token */
function makeJwt(exp?: number): string {
  const payload = btoa(JSON.stringify(exp === undefined ? {} : { exp }))
  return `header.${payload}.signature`
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  localStorage.clear()
  document.cookie = 'quote_system_auth=legacy; path=/'
  // 每个用例前重置 store 状态（单例，防止用例间/文件间污染）
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

// ─── login ─────────────────────────────────────────────────────

describe('login - 登录', () => {
  it('成功：设置用户态、加密存储 refresh token、清理旧 cookie', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresIn: 900,
        user: { id: 'u1', name: '张三', email: 'z@x.com', permissions: ['quotes:view'] },
      },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.user).toEqual({ id: 'u1', name: '张三', email: 'z@x.com' })
    expect(s.accessToken).toBe('access-1')
    expect(s.token).toBe('access-1') // 兼容旧代码：token === accessToken
    expect(s.permissions).toEqual(['quotes:view'])
    expect(s.secondsUntilExpiry).toBe(900)
    // refresh token 已加密持久化（非明文）
    const stored = localStorage.getItem('quote_system_auth_token')
    expect(stored).toBeTruthy()
    expect(stored).not.toContain('refresh-1')
    // 旧 cookie 已清理
    expect(document.cookie).not.toContain('quote_system_auth=')
  })

  it('请求体携带邮箱与密码（JSON POST）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: {
        accessToken: 'a', refreshToken: 'r',
        user: { id: 'u1', name: 'n', email: 'e' },
      },
    }))
    await useAuthStore.getState().login('user@x.com', 'secret')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ email: 'user@x.com', password: 'secret' })
  })

  it('失败（401 + JSON error）：抛出后端错误信息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401, body: { error: '邮箱或密码错误' } }))
    await expect(useAuthStore.getState().login('z@x.com', 'bad')).rejects.toThrow('邮箱或密码错误')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('失败（响应体非法 JSON）：抛出默认错误信息', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: '<html>boom</html>' }))
    await expect(useAuthStore.getState().login('z@x.com', 'bad')).rejects.toThrow('登录失败')
  })
})

// ─── logout ────────────────────────────────────────────────────

describe('logout - 登出', () => {
  it('清除全部状态与持久化的 refresh token', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    expect(localStorage.getItem('quote_system_auth_token')).toBeTruthy()

    useAuthStore.getState().logout()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.token).toBeNull()
    expect(s.permissions).toEqual([])
    expect(localStorage.getItem('quote_system_auth_token')).toBeNull()
  })
})

// ─── initAuth ──────────────────────────────────────────────────

describe('initAuth - 恢复登录态', () => {
  it('无 refresh token：保持未认证（已认证则重置）', async () => {
    useAuthStore.setState({ isAuthenticated: true, accessToken: 'stale', user: { id: 'u', name: 'n', email: 'e' } })
    await useAuthStore.getState().initAuth()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.accessToken).toBeNull()
  })

  it('refresh + me 均成功：恢复登录态与权限', async () => {
    // 先登录获得加密持久化的 refresh token
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()

    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { accessToken: 'new-access', expiresIn: 600 } }))
      .mockResolvedValueOnce(mockResponse({ body: { id: 'u1', name: '张三', email: 'z@x.com', permissions: ['orders:view'] } }))

    await useAuthStore.getState().initAuth()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.accessToken).toBe('new-access')
    expect(s.user?.name).toBe('张三')
    expect(s.permissions).toEqual(['orders:view'])
    expect(s.secondsUntilExpiry).toBe(600)
  })

  it('refresh 失败（token 过期）：清除登录态与持久化', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'bad', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401 }))

    await useAuthStore.getState().initAuth()

    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(localStorage.getItem('quote_system_auth_token')).toBeNull()
  })

  it('me 接口失败：清除登录态', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock
      .mockResolvedValueOnce(mockResponse({ body: { accessToken: 'new-access', expiresIn: 600 } }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 401 }))

    await useAuthStore.getState().initAuth()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(localStorage.getItem('quote_system_auth_token')).toBeNull()
  })

  it('网络异常：保持未认证（try/catch 兜底）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))

    await useAuthStore.getState().initAuth()

    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

// ─── refreshToken ──────────────────────────────────────────────

describe('refreshToken - 续期', () => {
  it('无持久化 token：返回 false 且不发请求', async () => {
    await expect(useAuthStore.getState().refreshToken()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('成功：更新 access token、关闭过期警告', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { accessToken: 'new-token', expiresIn: 900 } }))
    useAuthStore.setState({ showExpiryWarning: true })

    await expect(useAuthStore.getState().refreshToken()).resolves.toBe(true)
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('new-token')
    expect(s.token).toBe('new-token')
    expect(s.showExpiryWarning).toBe(false)
    expect(s.isRefreshing).toBe(false)
    // 请求携带 refresh token
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/auth/refresh')
    expect(JSON.parse(init.body).refreshToken).toBe('r')
  })

  it('失败（401）：返回 false 并清除登录态', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 401 }))

    await expect(useAuthStore.getState().refreshToken()).resolves.toBe(false)
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.isRefreshing).toBe(false)
  })

  it('网络异常：返回 false 不修改登录态', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))

    await expect(useAuthStore.getState().refreshToken()).resolves.toBe(false)
    // catch 分支不清除登录态（区别于 401）
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().isRefreshing).toBe(false)
  })

  it('并发调用复用同一个刷新请求（单例 promise）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    let resolveRefresh!: (v: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((r) => { resolveRefresh = r }))

    const p1 = useAuthStore.getState().refreshToken()
    const p2 = useAuthStore.getState().refreshToken()
    // 行为验证：两次并发调用只发起一次刷新请求（单例复用），正在刷新状态置位
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().isRefreshing).toBe(true)

    resolveRefresh(mockResponse({ body: { accessToken: 'x', expiresIn: 100 } }))
    // 两个调用方拿到相同结果
    await expect(p1).resolves.toBe(true)
    await expect(p2).resolves.toBe(true)
    expect(useAuthStore.getState().isRefreshing).toBe(false)
  })
})

// ─── recordActivity ────────────────────────────────────────────

describe('recordActivity - 用户活动', () => {
  it('关闭已显示的过期警告', () => {
    useAuthStore.setState({ showExpiryWarning: true })
    useAuthStore.getState().recordActivity()
    expect(useAuthStore.getState().showExpiryWarning).toBe(false)
  })

  it('token 临近过期（剩余 ≤ 5 分钟）：自动触发续期', () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    return useAuthStore.getState().login('z@x.com', '123456').then(() => {
      fetchMock.mockReset()
      // 4 分钟后过期（阈值 5 分钟内）
      useAuthStore.setState({ accessToken: makeJwt(Math.floor(Date.now() / 1000) + 240), token: makeJwt(Math.floor(Date.now() / 1000) + 240) })
      fetchMock.mockResolvedValueOnce(mockResponse({ body: { accessToken: 'renewed', expiresIn: 900 } }))

      useAuthStore.getState().recordActivity()
      // 自动刷新已发起（异步完成）
      return Promise.resolve().then(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.anything())
      })
    })
  })

  it('token 充裕（剩余 > 5 分钟）：不触发续期', () => {
    useAuthStore.setState({ accessToken: makeJwt(Math.floor(Date.now() / 1000) + 3600) })
    useAuthStore.getState().recordActivity()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正在刷新中 / 未登录：不重复触发', () => {
    useAuthStore.setState({ accessToken: makeJwt(Math.floor(Date.now() / 1000) + 240), isRefreshing: true })
    useAuthStore.getState().recordActivity()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('token 无法解析过期时间（无 exp）：不触发续期', () => {
    useAuthStore.setState({ accessToken: makeJwt(undefined) })
    useAuthStore.getState().recordActivity()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── checkTokenStatus ──────────────────────────────────────────

describe('checkTokenStatus - token 状态检查', () => {
  it('未登录 / 无 token：直接返回', () => {
    expect(() => useAuthStore.getState().checkTokenStatus()).not.toThrow()
    useAuthStore.setState({ isAuthenticated: true, accessToken: null })
    expect(() => useAuthStore.getState().checkTokenStatus()).not.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('token 无 exp：直接返回', () => {
    useAuthStore.setState({ isAuthenticated: true, accessToken: 'not.a.jwt' })
    useAuthStore.getState().checkTokenStatus()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('已过期：异步触发续期', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    useAuthStore.setState({ accessToken: makeJwt(Math.floor(Date.now() / 1000) - 10) })
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { accessToken: 're', expiresIn: 900 } }))

    useAuthStore.getState().checkTokenStatus()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.anything())
  })

  it('临近过期（剩余 ≤ 30 秒）：显示警告并更新倒计时', () => {
    useAuthStore.setState({ isAuthenticated: true, accessToken: makeJwt(Math.floor(Date.now() / 1000) + 20) })
    useAuthStore.getState().checkTokenStatus()
    const s = useAuthStore.getState()
    expect(s.showExpiryWarning).toBe(true)
    expect(s.secondsUntilExpiry).toBeLessThanOrEqual(20)
    expect(s.secondsUntilExpiry).toBeGreaterThan(15)
  })

  it('远离过期（剩余 > 30 秒）：更新倒计时且关闭警告', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      accessToken: makeJwt(Math.floor(Date.now() / 1000) + 120),
      showExpiryWarning: true,
    })
    useAuthStore.getState().checkTokenStatus()
    const s = useAuthStore.getState()
    expect(s.showExpiryWarning).toBe(false)
    expect(s.secondsUntilExpiry).toBeGreaterThan(100)
  })
})

// ─── localStorage 异常防御 ──────────────────────────────────────

describe('refresh token 存储异常防御', () => {
  it('持久化数据非法（非 base64）：解密失败按无 token 处理', async () => {
    localStorage.setItem('quote_system_auth_token', '%%%not-base64%%%')
    await useAuthStore.getState().initAuth()
    // 解密失败 → loadRefreshToken 返回 null → 不发请求、保持未认证
    expect(fetchMock).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('localStorage 不可用（getItem 抛异常）：按无 token 处理', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    try {
      await useAuthStore.getState().initAuth()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(useAuthStore.getState().isAuthenticated).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('localStorage 不可用（setItem 抛异常）：登录不中断', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      fetchMock.mockResolvedValueOnce(mockResponse({
        body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
      }))
      await expect(useAuthStore.getState().login('z@x.com', '123456')).resolves.toBeUndefined()
      // 状态正常设置（仅持久化失败被静默忽略）
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

// ─── 其他 action ───────────────────────────────────────────────

describe('dismissExpiryWarning / setAccessToken / 权限检查', () => {
  it('dismissExpiryWarning：触发续期（用户选择继续操作）', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({
      body: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'n', email: 'e' } },
    }))
    await useAuthStore.getState().login('z@x.com', '123456')
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(mockResponse({ body: { accessToken: 'x', expiresIn: 900 } }))

    useAuthStore.getState().dismissExpiryWarning()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/refresh', expect.anything())
  })

  it('setAccessToken：同步更新 accessToken 与兼容字段 token', () => {
    useAuthStore.getState().setAccessToken('t-new')
    const s = useAuthStore.getState()
    expect(s.accessToken).toBe('t-new')
    expect(s.token).toBe('t-new')
  })

  it('hasPermission：精确匹配权限码', () => {
    useAuthStore.setState({ permissions: ['quotes:view', 'orders:edit'] })
    expect(useAuthStore.getState().hasPermission('quotes:view')).toBe(true)
    expect(useAuthStore.getState().hasPermission('quotes:edit')).toBe(false)
    expect(useAuthStore.getState().hasPermission('')).toBe(false)
  })

  it('hasAnyPermission：任一匹配即通过', () => {
    useAuthStore.setState({ permissions: ['quotes:view'] })
    expect(useAuthStore.getState().hasAnyPermission('orders:view', 'quotes:view')).toBe(true)
    expect(useAuthStore.getState().hasAnyPermission('orders:view', 'orders:edit')).toBe(false)
    expect(useAuthStore.getState().hasAnyPermission()).toBe(false)
  })
})
