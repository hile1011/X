/**
 * 认证服务：JWT 签发/验证、bcrypt 密码哈希/校验
 */
import jwt, { type JwtPayload } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { pool } from '../dbClient.js'
import type { AccessTokenPayload, RefreshTokenPayload } from '../types/auth.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '-refresh'
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m'
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d'

/** 将 "15m"/"7d" 等字符串转为秒数 */
function expiresStrToSeconds(str: string): number {
  const m = str.match(/^(\d+)([smhd])$/)
  if (!m) return 900 // 默认 15 分钟
  const n = parseInt(m[1], 10)
  const unit = m[2]
  const mult = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400
  return n * mult
}

/** 签发 access token */
export function signAccessToken(user: { id: string; email: string; name: string }): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    type: 'access',
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_EXPIRES_IN as any })
}

/** 签发 refresh token */
export function signRefreshToken(userId: string): string {
  const payload: RefreshTokenPayload = {
    sub: userId,
    type: 'refresh',
  }
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN as any })
}

/** 验证 access token，返回 payload 或 null */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    if (payload.type !== 'access') return null
    return payload as AccessTokenPayload
  } catch {
    return null
  }
}

/** 验证 refresh token，返回 payload 或 null */
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_REFRESH_SECRET) as JwtPayload
    if (payload.type !== 'refresh') return null
    return payload as RefreshTokenPayload
  } catch {
    return null
  }
}

/** bcrypt 哈希密码 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10)
}

/** bcrypt 校验密码 */
export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

/** 获取 access token 有效期（秒） */
export function getAccessTokenExpiresIn(): number {
  return expiresStrToSeconds(ACCESS_EXPIRES_IN)
}

/**
 * 根据用户 ID 查询用户记录（含 password_hash）
 * 返回 null 表示用户不存在
 */
export async function findUserById(userId: string): Promise<{
  id: string
  email: string
  password_hash: string
  name: string
  phone: string
  status: number
  last_login_at: string | null
  created_at: string
  updated_at: string
} | null> {
  const [rows] = await pool.execute(
    'SELECT id, email, password_hash, name, phone, status, last_login_at, created_at, updated_at FROM users WHERE id = ?',
    [userId]
  )
  const list = rows as any[]
  return list[0] || null
}

/**
 * 根据邮箱或手机号查询用户记录（登录用）
 */
export async function findUserByEmail(email: string): Promise<{
  id: string
  email: string
  password_hash: string
  name: string
  phone: string
  status: number
  last_login_at: string | null
  created_at: string
  updated_at: string
} | null> {
  // 支持邮箱或手机号登录
  const [rows] = await pool.execute(
    'SELECT id, email, password_hash, name, phone, status, last_login_at, created_at, updated_at FROM users WHERE email = ? OR phone = ? LIMIT 1',
    [email, email]
  )
  const list = rows as any[]
  return list[0] || null
}

/** 更新最后登录时间 */
export async function updateLastLogin(userId: string): Promise<void> {
  await pool.execute('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = ?', [userId])
}

/** 更新用户密码 */
export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const hash = hashPassword(newPassword)
  await pool.execute('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, userId])
}
