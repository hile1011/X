/**
 * 权限检查 Hook
 *
 * 从 auth store 读取权限列表，提供权限检查方法。
 * 用于组件内按钮级权限控制。
 */
import { useAuthStore } from '../store/auth'

export function usePermission() {
  const permissions = useAuthStore((s) => s.permissions)
  return {
    permissions,
    hasPermission: (perm: string) => permissions.includes(perm),
    hasAnyPermission: (...perms: string[]) => perms.some((p) => permissions.includes(p)),
    hasAllPermissions: (...perms: string[]) => perms.every((p) => permissions.includes(p)),
  }
}

/** 单权限检查 Hook（更简洁，适合单个按钮控制） */
export function useHasPermission(perm: string): boolean {
  return useAuthStore((s) => s.permissions.includes(perm))
}

/** 任一权限检查 Hook */
export function useHasAnyPermission(...perms: string[]): boolean {
  return useAuthStore((s) => perms.some((p) => s.permissions.includes(p)))
}
