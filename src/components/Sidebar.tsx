import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  LayoutDashboard, FileText, Users, Package, ClipboardList, BarChart3, Table2,
  LogOut, ChevronLeft, ChevronRight, ChevronDown, Shield, KeyRound, Lock,
  Settings, UserCog, TrendingUp, Scale, GanttChart, type LucideIcon,
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
  { icon: LayoutDashboard, path: '/', label: '工作台', permission: 'dashboard:view' },
  { icon: FileText, path: '/quotes', label: '订单管理', permission: 'quotes:view' },
  // 做货跟踪：订单做货流程甘特图 + 订单状态跟踪（自仪表盘迁移；v30 独立模块权限）
  { icon: GanttChart, path: '/production-tracking', label: '做货跟踪', permission: 'production-tracking:view' },
  // 订单对账管理：已发货已收款订单的成本核对与对账确认（v28；v30 独立模块权限）
  { icon: Scale, path: '/reconciliation-alerts', label: '订单对账管理', permission: 'reconciliation:view' },
  {
    icon: BarChart3,
    label: '报表统计',
    children: [
      // 年度业务报表（v30 独立模块权限）
      { icon: TrendingUp, path: '/annual-report', label: '年度业务报表', permission: 'annual-report:view' },
    ],
  },
  {
    icon: Settings,
    label: '基础设置',
    children: [
      { icon: ClipboardList, path: '/product-cost-items', label: '产品成本项配置', permission: 'process-costs:view' },
      { icon: Table2, path: '/sheet-templates', label: '款式模板管理', permission: 'sheet-templates:view' },
      { icon: Users, path: '/customers', label: '客户管理', permission: 'customers:view' },
      { icon: Package, path: '/products', label: '产品管理', permission: 'products:view' },
    ],
  },
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

  // ─── 折叠态浮层子菜单 ──────────────────────────────────────
  // 用 Portal 渲染到 body，避免被 nav 的 overflow-y-auto 裁剪
  const [openPopup, setOpenPopup] = useState<string | null>(null)
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const hideTimerRef = useRef<number | null>(null)
  const popupItemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  /** 显示浮层：计算锚点按钮位置，定位到按钮右侧 */
  const showPopup = useCallback((label: string) => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    const el = popupItemRefs.current[label]
    if (el) {
      const rect = el.getBoundingClientRect()
      // 浮层贴在菜单项右侧 4px，顶部对齐菜单项顶部
      setPopupPos({ top: rect.top, left: rect.right + 4 })
    }
    setOpenPopup(label)
  }, [])

  /** 立即隐藏浮层 */
  const hidePopup = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    setOpenPopup(null)
  }, [])

  /** 延迟隐藏（200ms 容差，便于鼠标从菜单项移到浮层） */
  const scheduleHidePopup = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => setOpenPopup(null), 200)
  }, [])

  /** 取消延迟隐藏 */
  const cancelHidePopup = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  // 路由变化时关闭浮层
  useEffect(() => {
    setOpenPopup(null)
  }, [location.pathname])

  // 点击外部关闭浮层（捕获阶段，避免本组件 click 先触发）
  useEffect(() => {
    if (!openPopup) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const popupEl = document.getElementById('sidebar-popup-' + openPopup)
      const triggerEl = popupItemRefs.current[openPopup]
      if (popupEl && popupEl.contains(target)) return
      if (triggerEl && triggerEl.contains(target)) return
      setOpenPopup(null)
    }
    document.addEventListener('click', handleClickOutside, true)
    return () => document.removeEventListener('click', handleClickOutside, true)
  }, [openPopup])

  // 组件卸载时清理 timer
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

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
                  ref={(el) => { popupItemRefs.current[item.label] = el }}
                  onClick={() => {
                    if (isCollapsed) {
                      // 折叠态：点击切换浮层（移动端主要交互方式）
                      if (openPopup === item.label) hidePopup()
                      else showPopup(item.label)
                    } else {
                      toggleGroup(item.label)
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (isCollapsed) {
                      const el = e.currentTarget as HTMLButtonElement
                      popupItemRefs.current[item.label] = el
                      showPopup(item.label)
                    }
                  }}
                  onMouseLeave={() => {
                    if (isCollapsed) scheduleHidePopup()
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 min-h-[44px] ${
                    activeChild || (isCollapsed && openPopup === item.label)
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  } ${isCollapsed ? 'justify-center' : ''}`}
                  title={isCollapsed ? item.label : undefined}
                  aria-haspopup="menu"
                  aria-expanded={isCollapsed && openPopup === item.label}
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

      {/* 折叠态浮层子菜单：用 Portal 渲染到 body，避免被 nav 的 overflow-y-auto 裁剪。
          每个父菜单对应一个浮层，通过 class 切换可见性实现平滑过渡。 */}
      {isCollapsed && visibleItems
        .filter((item) => item.children)
        .map((item) => {
          const visibleChildren = item.children!.filter(hasMenuPermission)
          if (visibleChildren.length === 0) return null
          const isOpen = openPopup === item.label
          return createPortal(
            <div
              id={'sidebar-popup-' + item.label}
              onMouseEnter={cancelHidePopup}
              onMouseLeave={scheduleHidePopup}
              style={{
                position: 'fixed',
                top: `${popupPos.top}px`,
                left: `${popupPos.left}px`,
                maxHeight: 'calc(100vh - 32px)',
              }}
              className={`z-50 min-w-[200px] py-2 bg-white rounded-lg shadow-xl border border-gray-200
                transition-[opacity,transform] duration-200 ease-out origin-left
                ${isOpen
                  ? 'opacity-100 translate-x-0 pointer-events-auto'
                  : 'opacity-0 -translate-x-2 pointer-events-none'
                }`}
              role="menu"
              aria-hidden={!isOpen}
            >
              <div className="px-4 py-1.5 text-xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 mb-1">
                {item.label}
              </div>
              {visibleChildren.map((child) => {
                const ChildIcon = child.icon
                const isActive = child.path ? isChildActive(child.path) : false
                return (
                  <button
                    key={child.path}
                    onClick={() => {
                      if (child.path) {
                        handleNavigate(child.path)
                        hidePopup()
                      }
                    }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-150 min-h-[40px] ${
                      isActive
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                    role="menuitem"
                  >
                    <ChildIcon size={16} className="shrink-0" />
                    <span className="truncate">{child.label}</span>
                  </button>
                )
              })}
            </div>,
            document.body
          )
        })}
    </aside>
  )
}
