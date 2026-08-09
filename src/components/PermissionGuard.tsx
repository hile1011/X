/**
 * 权限守卫组件
 *
 * 用于按钮级权限控制，无权限时隐藏内容或显示替代内容。
 *
 * 用法：
 * <PermissionGuard permission="quotes:edit">
 *   <button>编辑</button>
 * </PermissionGuard>
 *
 * <PermissionGuard anyOf={['quotes:edit', 'quotes:delete']} fallback={<span>无权限</span>}>
 *   <button>操作</button>
 * </PermissionGuard>
 */
import type { ReactNode } from 'react'
import { usePermission } from '../hooks/usePermission'

interface PermissionGuardProps {
  /** 需要的权限码 */
  permission?: string
  /** 拥有任一权限即可 */
  anyOf?: string[]
  /** 需要同时拥有所有权限 */
  allOf?: string[]
  /** 无权限时显示的替代内容（默认 null = 隐藏） */
  fallback?: ReactNode
  children: ReactNode
}

export function PermissionGuard({ permission, anyOf, allOf, fallback = null, children }: PermissionGuardProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermission()

  let ok = true
  if (permission) ok = ok && hasPermission(permission)
  if (anyOf) ok = ok && hasAnyPermission(...anyOf)
  if (allOf) ok = ok && hasAllPermissions(...allOf)

  return <>{ok ? children : fallback}</>
}
