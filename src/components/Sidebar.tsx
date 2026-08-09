import { useState, useEffect } from 'react'
import {
  LayoutDashboard, FileText, Users, Package, ClipboardList, BarChart3,
  LogOut, ChevronLeft, ChevronRight, ChevronDown, Shield, KeyRound, Lock,
  Settings, UserCog, type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { usePermission } from '../hooks/usePermission'
import { useNavigate, useLocation } from 'react-router-dom'

/** 一级菜单项 */
interface MenuItem {
  icon: LucideIcon
  path?: string
  label: string
  permission?: string
  children?: MenuItem[]
}

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, path: '/', label: '仪表盘', permission: 'dashboard:view' },
  { icon: FileText, path: '/quotes', label: '订单管理', permission: 'quotes:view' },
  {
    icon: Settings,
    label: '基础设置',
    children: [
      { icon: ClipboardList, path: '/process-costs', label: '工艺成本管理', permission: 'process-costs:view' },
      { icon: Users, path: '/customers', label: '客户管理', permission: 'customers:view' },
      { icon: Package, path: '/products', label: '产品管理', permission: 'products:view' },
    ],
  },
  { icon: BarChart3, path: '/reports', label: '报表统计', permission: 'reports:view' },
  {
    icon: UserCog,
    label: '用户信息管理',
    children: [
      { icon: Shield, path: '/users', label: '用户管理', permission: 'users:view' },
      { icon: KeyRound, path: '/roles', label: '角色管理', permission: 'roles:view' },
      { icon: Lock, path: '/permissions', label: '权限管理', permission: 'users:view' },
    ],
  },
]

interface SidebarProps {
  isCollapsed: boolean
  onToggle: () => void
  isMobileOpen: boolean
  onMobileClose: () => void
}

export default function Sidebar({ isCollapsed, onToggle, isMobileOpen, onMobileClose }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { logout } = useAuthStore()
  const { hasPermission } = usePermission()

  // 展开/折叠的父菜单 path 集合（用 label 作为 key，因为父菜单没有 path）
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // 路由变化时自动展开包含当前页面的分组
  useEffect(() => {
    for (const item of menuItems) {
      if (item.children) {
        const hasActiveChild = item.children.some(
          (child) => child.path && (location.pathname === child.path || location.pathname.startsWith(child.path + '/'))
        )
        if (hasActiveChild) {
          setExpandedGroups((prev) => new Set(prev).add(item.label))
        }
      }
    }
  }, [location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleNavigate = (path: string) => {
    navigate(path)
    onMobileClose()
  }

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      return next
    })
  }

  /** 检查菜单项是否有权限（有子项时任一子项有权限即可） */
  const hasMenuPermission = (item: MenuItem): boolean => {
    if (item.children) {
      return item.children.some((child) => !child.permission || hasPermission(child.permission))
    }
    return !item.permission || hasPermission(item.permission)
  }

  /** 判断子菜单是否激活 */
  const isChildActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  /** 判断父菜单是否包含激活的子菜单 */
  const hasActiveChild = (item: MenuItem) =>
    item.children?.some((child) => child.path && isChildActive(child.path)) ?? false

  const visibleItems = menuItems.filter(hasMenuPermission)

  return (
    <aside className={`fixed left-0 top-0 h-screen bg-white border-r border-gray-200 flex flex-col z-50
      transition-transform duration-300 md:transition-all
      ${isCollapsed ? 'w-16' : 'w-64'}
      ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
      md:translate-x-0
      shadow-xl md:shadow-none`}>
      <div className="p-4 border-b border-gray-200 flex items-center justify-between">
        {!isCollapsed && (
          <h1 className="text-xl font-bold text-primary-800">报价跟单系统</h1>
        )}
        <button
          onClick={onToggle}
          className="hidden md:flex p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors min-h-[44px] min-w-[44px] items-center justify-center"
          aria-label="折叠侧边栏"
        >
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon

          // 有子菜单的父项
          if (item.children) {
            const isExpanded = expandedGroups.has(item.label) || isCollapsed
            const activeChild = hasActiveChild(item)
            const visibleChildren = item.children.filter(hasMenuPermission)

            return (
              <div key={item.label}>
                <button
                  onClick={() => !isCollapsed && toggleGroup(item.label)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 min-h-[44px] ${
                    activeChild
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  } ${isCollapsed ? 'justify-center' : ''}`}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon size={20} className="shrink-0" />
                  {!isCollapsed && (
                    <>
                      <span className="truncate flex-1 text-left">{item.label}</span>
                      <ChevronDown
                        size={16}
                        className={`shrink-0 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </>
                  )}
                </button>
                {/* 子菜单 */}
                {!isCollapsed && isExpanded && (
                  <div className="mt-0.5 ml-3 pl-4 border-l border-gray-200 space-y-0.5">
                    {visibleChildren.map((child) => {
                      const ChildIcon = child.icon
                      const isActive = child.path ? isChildActive(child.path) : false
                      return (
                        <button
                          key={child.path}
                          onClick={() => child.path && handleNavigate(child.path)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-200 min-h-[40px] text-sm ${
                            isActive
                              ? 'bg-primary-50 text-primary-700 font-medium'
                              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                          }`}
                        >
                          <ChildIcon size={16} className="shrink-0" />
                          <span className="truncate">{child.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }

          // 无子菜单的普通项
          const isActive = item.path ? isChildActive(item.path) : false
          return (
            <button
              key={item.label}
              onClick={() => item.path && handleNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 min-h-[44px] ${
                isActive
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              } ${isCollapsed ? 'justify-center' : ''}`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={20} className="shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="p-3 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all duration-200 min-h-[44px]"
          title={isCollapsed ? '退出登录' : undefined}
        >
          <LogOut size={20} className="shrink-0" />
          {!isCollapsed && <span>退出登录</span>}
        </button>
      </div>
    </aside>
  )
}
