/**
 * 认证服务单元测试 (api/services/auth.ts)
 *
 * 测试目标：
 *   - JWT access token 签发/验证/过期
 *   - JWT refresh token 签发/验证
 *   - token 类型不可混用（access 不能当 refresh 用，反之亦然）
 *   - bcrypt 密码哈希/校验
 *   - findUserByEmail / findUserById 数据库查询
 *   - updateLastLogin / updateUserPassword
 *
 * 使用 MySQL 测试数据库，每个测试前 resetTestDatabase() 保证隔离性。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashPassword,
  verifyPassword,
  findUserByEmail,
  findUserById,
  updateLastLogin,
  updateUserPassword,
  getAccessTokenExpiresIn,
} from '../api/services/auth'

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
})

// ============================================================
// JWT access token
// ============================================================
describe('JWT access token', () => {
  it('签发并验证 access token', () => {
    const token = signAccessToken({ id: 'user-1', email: 'test@test.com', name: '测试' })
    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')

    const payload = verifyAccessToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-1')
    expect(payload!.email).toBe('test@test.com')
    expect(payload!.name).toBe('测试')
    expect(payload!.type).toBe('access')
  })

  it('无效 token 返回 null', () => {
    expect(verifyAccessToken('invalid-token')).toBeNull()
    expect(verifyAccessToken('')).toBeNull()
    expect(verifyAccessToken('a.b.c')).toBeNull()
  })

  it('同密钥但类型非 access 的 token：类型校验分支返回 null', () => {
    // 用 access 密钥签发但 type 为 refresh（签名验证通过，走到类型判断分支）
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me-in-production'
    const wrongType = jwt.sign({ sub: 'user-1', type: 'refresh' }, secret, { expiresIn: '1m' })
    expect(verifyAccessToken(wrongType)).toBeNull()

    // 无 type 字段的历史 token 同样被拒绝
    const noType = jwt.sign({ sub: 'user-1' }, secret, { expiresIn: '1m' })
    expect(verifyAccessToken(noType)).toBeNull()
  })

  it('access token 不能当作 refresh token 使用', () => {
    const accessToken = signAccessToken({ id: 'user-1', email: 't@t.com', name: 'T' })
    expect(verifyRefreshToken(accessToken)).toBeNull()
  })

  it('getAccessTokenExpiresIn 返回正数', () => {
    const expires = getAccessTokenExpiresIn()
    expect(expires).toBeGreaterThan(0)
  })
})

// ============================================================
// JWT refresh token
// ============================================================
describe('JWT refresh token', () => {
  it('签发并验证 refresh token', () => {
    const token = signRefreshToken('user-1')
    expect(token).toBeTruthy()

    const payload = verifyRefreshToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-1')
    expect(payload!.type).toBe('refresh')
  })

  it('refresh token 不能当作 access token 使用', () => {
    const refreshToken = signRefreshToken('user-1')
    expect(verifyAccessToken(refreshToken)).toBeNull()
  })

  it('无效 refresh token 返回 null', () => {
    expect(verifyRefreshToken('invalid')).toBeNull()
  })

  it('同密钥但类型非 refresh 的 token：类型校验分支返回 null', () => {
    // 用 refresh 密钥签发但 type 为 access（签名验证通过，走到类型判断分支）
    const accessSecret = process.env.JWT_SECRET || 'dev-secret-change-me-in-production'
    const secret = process.env.JWT_REFRESH_SECRET || accessSecret + '-refresh'
    const wrongType = jwt.sign({ sub: 'user-1', type: 'access' }, secret, { expiresIn: '1m' })
    expect(verifyRefreshToken(wrongType)).toBeNull()

    // 无 type 字段的历史 token 同样被拒绝
    const noType = jwt.sign({ sub: 'user-1' }, secret, { expiresIn: '1m' })
    expect(verifyRefreshToken(noType)).toBeNull()
  })
})

// ============================================================
// bcrypt 密码
// ============================================================
describe('bcrypt 密码哈希', () => {
  it('hashPassword 生成与原密码不同的哈希', () => {
    const password = 'MyPassword123!'
    const hash = hashPassword(password)
    expect(hash).not.toBe(password)
    expect(hash).toHaveLength(60) // bcrypt 哈希固定 60 字符
  })

  it('verifyPassword 正确密码返回 true', () => {
    const password = 'MyPassword123!'
    const hash = hashPassword(password)
    expect(verifyPassword(password, hash)).toBe(true)
  })

  it('verifyPassword 错误密码返回 false', () => {
    const hash = hashPassword('correct-password')
    expect(verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('相同密码每次生成不同哈希（含随机盐）', () => {
    const password = 'SamePassword'
    const hash1 = hashPassword(password)
    const hash2 = hashPassword(password)
    expect(hash1).not.toBe(hash2)
    expect(verifyPassword(password, hash1)).toBe(true)
    expect(verifyPassword(password, hash2)).toBe(true)
  })
})

// ============================================================
// 用户查询（数据库）
// ============================================================
describe('findUserByEmail / findUserById', () => {
  it('通过邮箱查找默认管理员', async () => {
    const user = await findUserByEmail('517290808@qq.com')
    expect(user).not.toBeNull()
    expect(user!.id).toBe('user-admin-default')
    expect(user!.name).toBe('管理员')
    expect(user!.status).toBe(1)
    expect(user!.password_hash).toBeTruthy()
  })

  it('邮箱前后空格不影响查找（调用方应 trim）', async () => {
    // findUserByEmail 直接使用传入值查询，路由层负责 trim+toLowerCase
    // 这里测试 service 层：传入带空格的邮箱应返回 null（未匹配）
    const user = await findUserByEmail(' 517290808@qq.com')
    expect(user).toBeNull()
  })

  it('不存在的邮箱返回 null', async () => {
    const user = await findUserByEmail('nonexistent@test.com')
    expect(user).toBeNull()
  })

  it('通过 ID 查找默认管理员', async () => {
    const user = await findUserById('user-admin-default')
    expect(user).not.toBeNull()
    expect(user!.email).toBe('517290808@qq.com')
  })

  it('不存在的 ID 返回 null', async () => {
    const user = await findUserById('nonexistent-id')
    expect(user).toBeNull()
  })
})

// ============================================================
// 更新操作（数据库）
// ============================================================
describe('updateLastLogin / updateUserPassword', () => {
  it('updateLastLogin 更新最后登录时间', async () => {
    const before = await findUserById('user-admin-default')
    expect(before!.last_login_at).toBeNull()

    await updateLastLogin('user-admin-default')

    const after = await findUserById('user-admin-default')
    expect(after!.last_login_at).not.toBeNull()
  })

  it('updateUserPassword 更新密码哈希', async () => {
    const newPassword = 'NewPassword789!'
    await updateUserPassword('user-admin-default', newPassword)

    const user = await findUserById('user-admin-default')
    expect(verifyPassword(newPassword, user!.password_hash)).toBe(true)
    // 旧密码不再有效
    expect(verifyPassword('123456', user!.password_hash)).toBe(false)
  })
})

// ============================================================
// 有效期字符串解析（expiresStrToSeconds，经 getAccessTokenExpiresIn 触发）
// ============================================================
describe('JWT_ACCESS_EXPIRES_IN 单位解析', () => {
  const ORIGINAL = process.env.JWT_ACCESS_EXPIRES_IN

  afterEach(() => {
    // 恢复环境变量与模块缓存，避免污染其他测试
    if (ORIGINAL === undefined) delete process.env.JWT_ACCESS_EXPIRES_IN
    else process.env.JWT_ACCESS_EXPIRES_IN = ORIGINAL
    vi.resetModules()
  })

  async function loadAndGetExpiresIn(): Promise<number> {
    vi.resetModules()
    const mod = await import('../api/services/auth')
    return mod.getAccessTokenExpiresIn()
  }

  it('"45s" → 45 秒', async () => {
    process.env.JWT_ACCESS_EXPIRES_IN = '45s'
    await expect(loadAndGetExpiresIn()).resolves.toBe(45)
  })

  it('"30m" → 1800 秒', async () => {
    process.env.JWT_ACCESS_EXPIRES_IN = '30m'
    await expect(loadAndGetExpiresIn()).resolves.toBe(1800)
  })

  it('"3h" → 10800 秒', async () => {
    process.env.JWT_ACCESS_EXPIRES_IN = '3h'
    await expect(loadAndGetExpiresIn()).resolves.toBe(10800)
  })

  it('"2d" → 172800 秒', async () => {
    process.env.JWT_ACCESS_EXPIRES_IN = '2d'
    await expect(loadAndGetExpiresIn()).resolves.toBe(172800)
  })

  it('非法格式回退默认 900 秒（15 分钟）', async () => {
    process.env.JWT_ACCESS_EXPIRES_IN = 'bogus'
    await expect(loadAndGetExpiresIn()).resolves.toBe(900)
  })

  it('未设置时默认 900 秒（15m）', async () => {
    delete process.env.JWT_ACCESS_EXPIRES_IN
    await expect(loadAndGetExpiresIn()).resolves.toBe(900)
  })
})
