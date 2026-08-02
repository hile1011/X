import { create } from 'zustand'
import { config } from '../config'

/**
 * 持久化用户登录 Token 机制
 *
 * 功能：
 * 1. 基于 token 的身份验证，token 在浏览器会话中持续有效
 * 2. 无操作自动登出：10 分钟内无交互则自动清除 token 并登出
 * 3. token 存储在 localStorage 中，使用 XOR + base64 加密
 * 4. 登出时清除所有认证信息
 * 5. token 过期前 30 秒弹出警告提示
 * 6. 用户操作时自动续期 token
 * 7. 页面刷新或重新打开时恢复登录状态
 */

export interface User {
  id: string
  name: string
  email: string
  role: string
}

/** token 数据结构（存储在 localStorage 中） */
interface TokenData {
  user: User
  token: string
  issuedAt: number
  expiresAt: number
}

interface AuthStore {
  isAuthenticated: boolean
  user: User | null
  token: string | null
  /** 是否显示过期警告弹窗 */
  showExpiryWarning: boolean
  /** 距离过期剩余秒数（用于倒计时显示） */
  secondsUntilExpiry: number
  login: (user: User) => void
  logout: () => void
  initAuth: () => void
  /** 记录用户活动，并自动续期 token */
  recordActivity: () => void
  /** 续期 token：延长过期时间 */
  renewToken: () => void
  /** 检查 token 状态：过期则登出，临近过期则显示警告 */
  checkTokenStatus: () => void
  /** 关闭过期警告弹窗（用户选择继续操作时调用） */
  dismissExpiryWarning: () => void
}

// ─── 加密 / 解密工具 ───────────────────────────────────────────

/**
 * XOR 加密 + base64 编码
 * 注意：这是客户端混淆，不是真正的安全加密。
 * 真正的 token 安全应由后端签发和验证。
 */
function encrypt(plaintext: string, key: string): string {
  let result = ''
  for (let i = 0; i < plaintext.length; i++) {
    result += String.fromCharCode(plaintext.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  // 转为 UTF-8 安全的 base64
  return btoa(unescape(encodeURIComponent(result)))
}

/** XOR 解密 + base64 解码 */
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

// ─── localStorage 存储工具 ─────────────────────────────────────

const STORAGE_KEY = config.auth.storageKey
const ENCRYPTION_KEY = config.auth.encryptionKey

/** 将 token 数据加密后存入 localStorage */
function saveTokenData(data: TokenData): void {
  try {
    const json = JSON.stringify(data)
    const encrypted = encrypt(json, ENCRYPTION_KEY)
    localStorage.setItem(STORAGE_KEY, encrypted)
  } catch {
    // localStorage 不可用时静默失败
  }
}

/** 从 localStorage 读取并解密 token 数据 */
function loadTokenData(): TokenData | null {
  try {
    const encrypted = localStorage.getItem(STORAGE_KEY)
    if (!encrypted) return null
    const json = decrypt(encrypted, ENCRYPTION_KEY)
    if (!json) return null
    const data = JSON.parse(json) as TokenData
    if (!data.token || !data.expiresAt || !data.user) return null
    return data
  } catch {
    return null
  }
}

/** 从 localStorage 清除 token 数据 */
function clearTokenData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}

// ─── 旧版 cookie 清理 ──────────────────────────────────────────

/** 清理旧版 cookie 认证数据 */
function clearLegacyCookie(): void {
  const key = config.auth.legacyCookieKey
  document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
}

// ─── token 生成工具 ─────────────────────────────────────────────

/**
 * 生成随机 token 字符串
 * 使用 crypto.randomUUID（现代浏览器）或回退到 Math.random
 */
function generateToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '') + Date.now().toString(36)
  }
  // 回退方案
  const arr = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('') + Date.now().toString(36)
}

// ─── 初始状态同步计算 ─────────────────────────────────────────

/**
 * 从 localStorage 同步读取 token，计算初始认证状态。
 * 在 store 创建时调用，确保首次渲染时 isAuthenticated 已是正确值，
 * 避免"刷新后跳转到登录页"的竞态问题。
 */
function computeInitialAuthState(): {
  isAuthenticated: boolean
  user: User | null
  token: string | null
} {
  // 仅在浏览器环境执行（SSR 安全）
  if (typeof window === 'undefined') {
    return { isAuthenticated: false, user: null, token: null }
  }

  clearLegacyCookie()
  const tokenData = loadTokenData()
  if (!tokenData) {
    return { isAuthenticated: false, user: null, token: null }
  }

  const now = Date.now()
  // token 已过期 → 清除，返回未认证
  if (now >= tokenData.expiresAt) {
    clearTokenData()
    return { isAuthenticated: false, user: null, token: null }
  }

  // token 仍有效 → 续期并持久化（用户重新打开页面视为活动）
  const renewedExpiresAt = now + config.auth.idleTimeoutMs
  saveTokenData({ ...tokenData, expiresAt: renewedExpiresAt })

  return {
    isAuthenticated: true,
    user: tokenData.user,
    token: tokenData.token,
  }
}

// ─── Zustand Store ─────────────────────────────────────────────

// 同步计算初始状态，确保首次渲染即为正确值
const initialState = computeInitialAuthState()

export const useAuthStore = create<AuthStore>((set, get) => ({
  isAuthenticated: initialState.isAuthenticated,
  user: initialState.user,
  token: initialState.token,
  showExpiryWarning: false,
  secondsUntilExpiry: 0,

  login: (user) => {
    const now = Date.now()
    const tokenData: TokenData = {
      user,
      token: generateToken(),
      issuedAt: now,
      expiresAt: now + config.auth.idleTimeoutMs,
    }
    saveTokenData(tokenData)
    clearLegacyCookie()
    set({
      isAuthenticated: true,
      user,
      token: tokenData.token,
      showExpiryWarning: false,
      secondsUntilExpiry: 0,
    })
  },

  logout: () => {
    clearTokenData()
    clearLegacyCookie()
    set({
      isAuthenticated: false,
      user: null,
      token: null,
      showExpiryWarning: false,
      secondsUntilExpiry: 0,
    })
  },

  initAuth: () => {
    // 初始状态已在 store 创建时同步计算，此方法保留兼容性但无需重复执行
    // （App.tsx 中的 useEffect 仍会调用，但计算结果与初始值一致）
    clearLegacyCookie()
    const tokenData = loadTokenData()
    if (!tokenData) {
      if (get().isAuthenticated) {
        set({ isAuthenticated: false, user: null, token: null })
      }
      return
    }

    const now = Date.now()
    // token 已过期 → 清除
    if (now >= tokenData.expiresAt) {
      clearTokenData()
      set({ isAuthenticated: false, user: null, token: null })
      return
    }

    // token 仍有效 → 恢复登录状态，并续期（用户重新打开页面视为活动）
    const renewedExpiresAt = now + config.auth.idleTimeoutMs
    const renewedData: TokenData = { ...tokenData, expiresAt: renewedExpiresAt }
    saveTokenData(renewedData)

    set({
      isAuthenticated: true,
      user: tokenData.user,
      token: tokenData.token,
      showExpiryWarning: false,
      secondsUntilExpiry: Math.floor((renewedExpiresAt - now) / 1000),
    })
  },

  recordActivity: () => {
    const state = get()
    if (!state.isAuthenticated) return

    // 续期 token
    const now = Date.now()
    const newExpiresAt = now + config.auth.idleTimeoutMs

    const tokenData = loadTokenData()
    if (tokenData) {
      saveTokenData({ ...tokenData, expiresAt: newExpiresAt })
    }

    // 如果正在显示警告，用户有活动 → 关闭警告并续期
    if (state.showExpiryWarning) {
      set({ showExpiryWarning: false, secondsUntilExpiry: Math.floor(config.auth.idleTimeoutMs / 1000) })
    }
  },

  renewToken: () => {
    const state = get()
    if (!state.isAuthenticated) return

    const now = Date.now()
    const newExpiresAt = now + config.auth.idleTimeoutMs

    const tokenData = loadTokenData()
    if (tokenData) {
      saveTokenData({ ...tokenData, expiresAt: newExpiresAt })
    }

    set({ showExpiryWarning: false, secondsUntilExpiry: Math.floor(config.auth.idleTimeoutMs / 1000) })
  },

  checkTokenStatus: () => {
    const state = get()
    if (!state.isAuthenticated) return

    const tokenData = loadTokenData()
    if (!tokenData) {
      set({ isAuthenticated: false, user: null, token: null, showExpiryWarning: false })
      return
    }

    const now = Date.now()
    const remaining = tokenData.expiresAt - now

    // token 已过期 → 登出
    if (remaining <= 0) {
      clearTokenData()
      set({
        isAuthenticated: false,
        user: null,
        token: null,
        showExpiryWarning: false,
        secondsUntilExpiry: 0,
      })
      return
    }

    const secondsRemaining = Math.floor(remaining / 1000)

    // 临近过期（剩余时间 ≤ 警告时间）→ 显示警告
    if (remaining <= config.auth.warningBeforeMs) {
      set({ showExpiryWarning: true, secondsUntilExpiry: secondsRemaining })
    } else {
      // 还有充足时间，确保警告关闭
      if (state.showExpiryWarning) {
        set({ showExpiryWarning: false })
      }
      // 更新倒计时（仅在警告期间才需要精确值）
      set({ secondsUntilExpiry: secondsRemaining })
    }
  },

  dismissExpiryWarning: () => {
    // 用户手动关闭警告 = 继续操作 → 续期
    get().renewToken()
  },
}))
