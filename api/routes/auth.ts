/**
 * 认证路由：登录、获取当前用户、刷新 token、登出、修改密码
 *
 * - POST /api/auth/login     公开，返回 access+refresh token 和用户信息
 * - GET  /api/auth/me        需认证，返回当前用户信息+权限
 * - POST /api/auth/refresh   公开，用 refresh token 换取新 access token
 * - POST /api/auth/logout    需认证，前端清除 token（stateless，后端无需操作）
 * - PUT  /api/auth/password  需认证，修改自己的密码
 */
import { Router } from 'express'
import { asyncHandler } from '../asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  findUserByEmail,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getAccessTokenExpiresIn,
  updateLastLogin,
  updateUserPassword,
  findUserById,
} from '../services/auth.js'
import { getUserPermissions, getUserRoles } from '../services/rbac.js'

export const authRouter = Router()

/**
 * POST /api/auth/login
 * 登录：邮箱+密码 → 返回 token + 用户信息 + 权限列表
 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' })
    }

    const user = await findUserByEmail(String(email).trim().toLowerCase())
    if (!user) {
      return res.status(401).json({ error: '邮箱或密码错误' })
    }

    // 校验密码
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '邮箱或密码错误' })
    }

    // 检查账号状态
    if (user.status !== 1) {
      return res.status(403).json({ error: '账号已被禁用，请联系管理员' })
    }

    // 签发 token
    const accessToken = signAccessToken({ id: user.id, email: user.email, name: user.name })
    const refreshToken = signRefreshToken(user.id)

    // 更新最后登录时间
    await updateLastLogin(user.id)

    // 查询角色和权限
    const roles = await getUserRoles(user.id)
    const permissions = Array.from(await getUserPermissions(user.id))

    res.json({
      accessToken,
      refreshToken,
      expiresIn: getAccessTokenExpiresIn(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        permissions,
      },
    })
  })
)

/**
 * GET /api/auth/me
 * 获取当前登录用户信息 + 权限（用于刷新页面后恢复状态）
 */
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id
    const user = await findUserById(userId)
    if (!user) {
      return res.status(404).json({ error: '用户不存在' })
    }
    if (user.status !== 1) {
      return res.status(403).json({ error: '账号已被禁用' })
    }

    const roles = await getUserRoles(userId)
    const permissions = Array.from(await getUserPermissions(userId))

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      roles,
      permissions,
    })
  })
)

/**
 * POST /api/auth/refresh
 * 用 refresh token 换取新的 access token
 */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {}
    if (!refreshToken) {
      return res.status(401).json({ error: '未提供 refresh token' })
    }

    const payload = verifyRefreshToken(refreshToken)
    if (!payload) {
      return res.status(401).json({ error: 'refresh token 无效或已过期' })
    }

    // 查询用户，确保账号仍有效
    const user = await findUserById(payload.sub)
    if (!user || user.status !== 1) {
      return res.status(403).json({ error: '账号不可用' })
    }

    const newAccessToken = signAccessToken({ id: user.id, email: user.email, name: user.name })
    res.json({
      accessToken: newAccessToken,
      expiresIn: getAccessTokenExpiresIn(),
    })
  })
)

/**
 * POST /api/auth/logout
 * 登出：stateless JWT 无需后端操作，前端清除 token 即可。
 * 保留接口以备后续扩展（如 refresh token 黑名单）。
 */
authRouter.post('/logout', authenticate, (_req, res) => {
  res.json({ message: '已登出' })
})

/**
 * PUT /api/auth/password
 * 修改自己的密码（需提供旧密码）
 */
authRouter.put(
  '/password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {}
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '请提供旧密码和新密码' })
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于6位' })
    }

    const userId = req.user!.id
    const user = await findUserById(userId)
    if (!user) {
      return res.status(404).json({ error: '用户不存在' })
    }

    if (!verifyPassword(oldPassword, user.password_hash)) {
      return res.status(400).json({ error: '旧密码错误' })
    }

    await updateUserPassword(userId, newPassword)
    res.json({ message: '密码修改成功' })
  })
)
