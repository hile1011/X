import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { config } from '../config'
import { AlertTriangle, Clock, LogIn } from 'lucide-react'

/**
 * 无操作自动登出监控组件
 *
 * 功能：
 * 1. 监听用户交互事件（鼠标、键盘、触摸、滚动）
 * 2. 每秒检查 token 状态：过期则登出，临近过期则显示警告
 * 3. 用户操作时自动续期 token
 * 4. 页面可见性变化时重新检查（切回标签页时验证 token 是否仍有效）
 * 5. 跨标签页同步：监听 localStorage 变化，其他标签页登出时同步登出
 */
export default function IdleMonitor() {
  const navigate = useNavigate()
  const { isAuthenticated, showExpiryWarning, secondsUntilExpiry, recordActivity, checkTokenStatus, logout, dismissExpiryWarning } = useAuthStore()

  // 用于节流 recordActivity，避免高频事件（如 mousemove）频繁写入 localStorage
  const lastActivityRef = useRef(0)

  // ─── 活动事件监听 ─────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    const ACTIVITY_THROTTLE_MS = 5000 // 每 5 秒最多触发一次续期检查，避免频繁 API 调用

    const handleActivity = () => {
      const now = Date.now()
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return
      lastActivityRef.current = now
      recordActivity()
    }

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'click',
      'scroll',
      'wheel',
    ]

    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }))

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleActivity))
    }
  }, [isAuthenticated, recordActivity])

  // ─── 定时检查 token 状态 ──────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    const interval = setInterval(() => {
      checkTokenStatus()
    }, 1000) // 每秒检查一次

    return () => clearInterval(interval)
  }, [isAuthenticated, checkTokenStatus])

  // ─── 监听 store 中 isAuthenticated 变化 → 跳转登录页 ──────────
  const wasAuthenticated = useRef(false)
  useEffect(() => {
    if (isAuthenticated) {
      wasAuthenticated.current = true
    } else if (wasAuthenticated.current) {
      // 从已登录变为未登录（token 过期自动登出）→ 跳转登录页
      wasAuthenticated.current = false
      navigate('/login')
    }
  }, [isAuthenticated, navigate])

  // ─── 页面可见性变化 ────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // 切回标签页时立即检查 token 状态
        checkTokenStatus()
        // 如果仍有效，视为用户活动 → 续期
        if (useAuthStore.getState().isAuthenticated) {
          recordActivity()
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isAuthenticated, checkTokenStatus, recordActivity])

  // ─── 跨标签页同步：监听 localStorage 变化 ─────────────────────
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === config.auth.storageKey) {
        // 其他标签页清除了 token → 当前标签页也登出
        if (!e.newValue) {
          logout()
          navigate('/login')
        } else {
          // 其他标签页续期了 token → 重新检查状态
          checkTokenStatus()
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [logout, navigate, checkTokenStatus])

  // ─── 页面卸载前保存最新状态 ──────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 页面刷新/关闭时，recordActivity 已将最新过期时间写入 localStorage
      // 下次打开时 initAuth 会恢复登录状态
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // ─── 过期警告弹窗 ─────────────────────────────────────────────
  if (!showExpiryWarning) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in duration-200">
        <div className="flex flex-col items-center text-center">
          {/* 警告图标 */}
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="text-amber-600" size={32} />
          </div>

          {/* 标题 */}
          <h3 className="text-lg font-bold text-gray-800 mb-2">即将自动登出</h3>

          {/* 倒计时 */}
          <div className="flex items-center gap-2 text-amber-600 mb-3">
            <Clock size={18} />
            <span className="text-2xl font-bold tabular-nums">{secondsUntilExpiry}s</span>
          </div>

          {/* 说明文字 */}
          <p className="text-sm text-gray-500 mb-6">
            您已长时间未操作，系统将在{' '}
            <span className="font-semibold text-amber-600">{secondsUntilExpiry} 秒</span>
            {' '}后自动登出。点击下方按钮继续操作。
          </p>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3 w-full">
            <button
              onClick={() => {
                dismissExpiryWarning()
                recordActivity()
              }}
              className="flex-1 flex items-center justify-center gap-2 bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <LogIn size={16} />
              继续操作
            </button>
            <button
              onClick={() => {
                logout()
                navigate('/login')
              }}
              className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              立即登出
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
