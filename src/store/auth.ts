import { create } from 'zustand'
import { config } from '../config'

/**
 * JWT 认证状态管理
 *
 * 功能：
 * 1. 对接后端 JWT 认证：login() 调用后端 API 获取 access/refresh token
 * 2. access token 存内存（Zustand state），refresh token 存 localStorage（轻混淆）
 * 3. 页面刷新时用 refresh token 恢复登录态（调用 /api/auth/me 获取用户信息+权限）
 * 4. access token 临近过期时弹出警告，用户可选择续期（调用 /api/auth/refresh）
 * 5. 10 分钟无操作自动登出（与 access token 过期联动）
 * 6. 权限列表随登录/刷新返回，前端用于按钮级权限控制
 */

export interface User {
  id: string
  name: string
  email: string
}

interface AuthStore {
  isAuthenticated: boolean
  user: User | null
  /** JWT access token（内存存储，刷新页面后丢失） */
  accessToken: string | null
  /** 权限码列表（如 ['quotes:view', 'quotes:edit']） */
  permissions: string[]
  /** 兼容旧代码：token 属性映射到 accessToken */
  token: string | null
  /** 是否显示过期警告弹窗 */
  showExpiryWarning: boolean
  /** 距离过期剩余秒数（用于倒计时显示） */
  secondsUntilExpiry: number
  /** 是否正在刷新 token（防止并发刷新） */
  isRefreshing: boolean
  /** 登录：调用后端 API，存储 JWT */
  login: (email: string, password: string) => Promise<void>
  /** 登出：清除所有认证信息 */
  logout: () => void
  /** 初始化认证：用 refresh token 恢复登录态 */
  initAuth: () => Promise<void>
  /** 用 refresh token 获取新的 access token */
  refreshToken: () => Promise<boolean>
  /** 记录用户活动：关闭过期警告 + token 剩余时间低于阈值时自动刷新续期 */
  recordActivity: () => void
  /** 检查 token 状态：过期则登出，临近过期则显示警告 */
  checkTokenStatus: () => void
  /** 关闭过期警告弹窗（用户选择继续操作时调用） */
  dismissExpiryWarning: () => void
  /** 设置 access token（供 api 层 401 自动刷新后更新） */
  setAccessToken: (token: string) => void
  /** 权限检查：是否拥有指定权限 */
  hasPermission: (perm: string) => boolean
  /** 权限检查：是否拥有任一权限 */
  hasAnyPermission: (...perms: string[]) => boolean
}

// ─── 加密 / 解密工具（轻混淆，非真正加密） ──────────────────────

function encrypt(plaintext: string, key: string): string {
  let result = ''
  for (let i = 0; i < plaintext.length; i++) {
    result += String.fromCharCode(plaintext.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return btoa(unescape(encodeURIComponent(result)))
}

function decrypt(ciphertext: string, key: string): string {
  try {
    const text = decodeURIComponent(escape(atob(ciphertext)))
    let result = ''
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length))
    }
    return result
  } catch {
    return ''
  }
}

// ─── refresh token 存储工具 ─────────────────────────────────────

const STORAGE_KEY = config.auth.storageKey
const ENCRYPTION_KEY = config.auth.encryptionKey

/** 进行中的刷新 token promise（单例，防止并发刷新） */
let refreshPromise: Promise<boolean> | null = null

/** 将 refresh token 加密后存入 localStorage */
function saveRefreshToken(refreshToken: string): void {
  try {
    const encrypted = encrypt(refreshToken, ENCRYPTION_KEY)
    localStorage.setItem(STORAGE_KEY, encrypted)
  } catch {
    // localStorage 不可用时静默失败
  }
}

/** 从 localStorage 读取并解密 refresh token */
function loadRefreshToken(): string | null {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY)
    if (!encrypted) return null
    const token = decrypt(encrypted, ENCRYPTION_KEY)
    return token || null
  } catch {
    return null
  }
}

/** 从 localStorage 清除 refresh token */
function clearRefreshToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}

// ─── JWT 工具 ───────────────────────────────────────────────────

/** 解析 JWT payload（不验证签名，仅读取过期时间） */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload
  } catch {
    return null
  }
}

/** 获取 access token 的过期时间戳（毫秒） */
function getAccessTokenExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return null
  return payload.exp * 1000
}

// ─── 旧版 cookie 清理 ──────────────────────────────────────────

function clearLegacyCookie(): void {
  const key = config.auth.legacyCookieKey
  document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
}

// ─── Zustand Store ─────────────────────────────────────────────

export const useAuthStore = create<AuthStore>((set, get) => ({
  isAuthenticated: false,
  user: null,
  accessToken: null,
  permissions: [],
  token: null, // 兼容旧代码：token === accessToken
  showExpiryWarning: false,
  secondsUntilExpiry: 0,
  isRefreshing: false,

  login: async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '登录失败' }))
      throw new Error(err.error || '登录失败')
    }
    const data = await res.json()

    // 存储 refresh token 到 localStorage
    saveRefreshToken(data.refreshToken)
    clearLegacyCookie()

    set({
      isAuthenticated: true,
      user: { id: data.user.id, name: data.user.name, email: data.user.email },
      accessToken: data.accessToken,
      token: data.accessToken, // 兼容旧代码
      permissions: data.user.permissions || [],
      showExpiryWarning: false,
      secondsUntilExpiry: data.expiresIn || 900,
    })
  },

  logout: () => {
    clearRefreshToken()
    clearLegacyCookie()
    set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      token: null,
      permissions: [],
      showExpiryWarning: false,
      secondsUntilExpiry: 0,
    })
  },

  initAuth: async () => {
    clearLegacyCookie()
    const refreshTokenStr = loadRefreshToken()
    if (!refreshTokenStr) {
      // 没有 refresh token，确保未认证状态
      if (get().isAuthenticated) {
        set({ isAuthenticated: false, user: null, accessToken: null, token: null, permissions: [] })
      }
      return
    }

    // 用 refresh token 获取新的 access token
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshTokenStr }),
      })
      if (!res.ok) {
        // refresh token 无效或过期 → 清除登录态
        clearRefreshToken()
        set({ isAuthenticated: false, user: null, accessToken: null, token: null, permissions: [] })
        return
      }
      const tokenData = await res.json()

      // 用新 access token 获取用户信息
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${tokenData.accessToken}` },
      })
      if (!meRes.ok) {
        clearRefreshToken()
        set({ isAuthenticated: false, user: null, accessToken: null, token: null, permissions: [] })
        return
      }
      const me = await meRes.json()

      set({
        isAuthenticated: true,
        user: { id: me.id, name: me.name, email: me.email },
        accessToken: tokenData.accessToken,
        token: tokenData.accessToken,
        permissions: me.permissions || [],
        showExpiryWarning: false,
        secondsUntilExpiry: tokenData.expiresIn || 900,
      })
    } catch {
      // 网络错误等 → 保持未认证
      clearRefreshToken()
      set({ isAuthenticated: false, user: null, accessToken: null, token: null, permissions: [] })
    }
  },

  refreshToken: async () => {
    // 单例 promise：并发调用复用同一个刷新请求（避免 401 重试和 recordActivity 同时触发两次刷新）
    if (refreshPromise) return refreshPromise
    const refreshTokenStr = loadRefreshToken()
    if (!refreshTokenStr) return false

    set({ isRefreshing: true })
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: refreshTokenStr }),
        })
        if (!res.ok) {
          clearRefreshToken()
          set({ isAuthenticated: false, user: null, accessToken: null, token: null, permissions: [] })
          return false
        }
        const data = await res.json()
        set({
          accessToken: data.accessToken,
          token: data.accessToken,
          showExpiryWarning: false,
          secondsUntilExpiry: data.expiresIn || 900,
        })
        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
        set({ isRefreshing: false })
      }
    })()
    return refreshPromise
  },

  recordActivity: () => {
    const state = get()

    // 用户有活动时关闭过期警告
    if (state.showExpiryWarning) {
      set({ showExpiryWarning: false })
    }

    // 用户活动时，如果 token 剩余时间低于阈值，自动刷新续期
    // 这样活跃用户不会看到"即将登出"弹窗，只有真正闲置的用户才会触发警告
    if (state.accessToken && !state.isRefreshing) {
      const expiry = getAccessTokenExpiry(state.accessToken)
      if (expiry) {
        const remaining = expiry - Date.now()
        if (remaining > 0 && remaining <= config.auth.autoRefreshThresholdMs) {
          get().refreshToken()
        }
      }
    }
  },

  checkTokenStatus: () => {
    const state = get()
    if (!state.isAuthenticated || !state.accessToken) return

    const expiry = getAccessTokenExpiry(state.accessToken)
    if (!expiry) return

    const now = Date.now()
    const remaining = expiry - now

    // access token 已过期 → 尝试刷新，失败则登出
    if (remaining <= 0) {
      // 异步刷新，不阻塞
      get().refreshToken()
      return
    }

    const secondsRemaining = Math.floor(remaining / 1000)

    // 临近过期（剩余 ≤ 警告时间）→ 显示警告
    if (remaining <= config.auth.warningBeforeMs) {
      set({ showExpiryWarning: true, secondsUntilExpiry: secondsRemaining })
    } else {
      if (state.showExpiryWarning) {
        set({ showExpiryWarning: false })
      }
      set({ secondsUntilExpiry: secondsRemaining })
    }
  },

  dismissExpiryWarning: () => {
    // 用户选择继续操作 → 用 refresh token 续期
    get().refreshToken()
  },

  setAccessToken: (token: string) => {
    set({ accessToken: token, token })
  },

  hasPermission: (perm: string) => {
    return get().permissions.includes(perm)
  },

  hasAnyPermission: (...perms: string[]) => {
    const list = get().permissions
    return perms.some((p) => list.includes(p))
  },
}))
