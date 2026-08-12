/**
 * 简易内存限流中间件
 *
 * 用于导出类接口的请求频率限制，防止恶意请求攻击。
 * 基于 userId 维度统计（未认证用户回退到 IP）。
 *
 * 注意：内存存储，适用于单实例部署（生产环境 PM2 单实例）。
 * 多实例部署需替换为 Redis 等共享存储。
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express'

interface RateLimitOptions {
  /** 时间窗口（毫秒），默认 5 分钟 */
  windowMs?: number
  /** 窗口内最大请求数，默认 3 */
  max?: number
}

interface LimitEntry {
  timestamps: number[]
}

export function createRateLimiter(options: RateLimitOptions = {}): RequestHandler {
  const windowMs = options.windowMs ?? 5 * 60 * 1000
  const max = options.max ?? 3
  const store = new Map<string, LimitEntry>()

  // 周期性清理过期条目，避免内存无限增长（每 10 分钟清理一次）
  const cleanup = () => {
    const now = Date.now()
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
      if (entry.timestamps.length === 0) store.delete(key)
    }
  }
  setInterval(cleanup, 10 * 60 * 1000).unref?.()

  return (req: Request, res: Response, next: NextFunction) => {
    // 限流维度：优先 userId，回退到 IP
    const key = req.user?.id || req.ip || 'unknown'
    const now = Date.now()
    let entry = store.get(key)
    if (!entry) {
      entry = { timestamps: [] }
      store.set(key, entry)
    }
    // 淘汰窗口外的时间戳
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)

    if (entry.timestamps.length >= max) {
      const oldest = entry.timestamps[0]
      const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000)
      res.setHeader('Retry-After', String(retryAfterSec))
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试',
        retryAfter: retryAfterSec,
      })
    }

    entry.timestamps.push(now)
    next()
  }
}
