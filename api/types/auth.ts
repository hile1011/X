/**
 * 认证与权限相关类型定义
 */

/** 用户基本信息（JWT payload 中携带） */
export interface JwtUser {
  id: string
  email: string
  name: string
}

/** Access Token payload */
export interface AccessTokenPayload {
  sub: string
  email: string
  name: string
  type: 'access'
  iat?: number
  exp?: number
}

/** Refresh Token payload */
export interface RefreshTokenPayload {
  sub: string
  type: 'refresh'
  iat?: number
  exp?: number
}

/** 登录响应 */
export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: {
    id: string
    email: string
    name: string
    roles: string[]
    permissions: string[]
  }
}

/** Express Request 扩展：认证中间件附加字段 */
declare global {
  namespace Express {
    interface Request {
      user?: JwtUser
      permissions?: Set<string>
    }
  }
}

export {}
