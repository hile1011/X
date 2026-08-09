/**
 * 路由级权限守卫
 *
 * 用于页面级权限控制，无权限时跳转到 403 页面或指定路径。
 *
 * 用法：
 * <Route path="/quotes" element={
 *   <ProtectedRoute permission="quotes:view"><Quotes /></ProtectedRoute>
 * } />
 */
import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { usePermission } from '../hooks/usePermission'

interface ProtectedRouteProps {
  /** 需要的权限码 */
  permission?: string
  /** 拥有任一权限即可 */
  anyOf?: string[]
  /** 无权限时跳转的路径（默认 /403） */
  redirectTo?: string
  children: ReactElement
}

export function ProtectedRoute({ permission, anyOf, redirectTo = '/403', children }: ProtectedRouteProps) {
  const { hasPermission, hasAnyPermission } = usePermission()

  if (permission && !hasPermission(permission)) {
    return <Navigate to={redirectTo} replace />
  }
  if (anyOf && !hasAnyPermission(...anyOf)) {
    return <Navigate to={redirectTo} replace />
  }

  return children
}
