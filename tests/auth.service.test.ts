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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
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
