import { LayoutDashboard, FileText, Users, Package, ClipboardList, BarChart3, LogOut, ChevronLeft, ChevronRight, Table2 } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { useNavigate, useLocation } from 'react-router-dom'

const menuItems = [
  { icon: LayoutDashboard, path: '/', label: '仪表盘' },
  { icon: FileText, path: '/quotes', label: '订单管理' },
  { icon: Table2, path: '/quotes-table/new', label: '订单管理-表格版' },
  { icon: FileText, path: '/quotes-wps', label: '订单管理-WPS版' },
  { icon: ClipboardList, path: '/process-costs', label: '工艺成本管理' },
  { icon: Users, path: '/customers', label: '客户管理' },
  { icon: Package, path: '/products', label: '产品管理' },
  { icon: ClipboardList, path: '/tasks', label: '跟单任务' },
  { icon: BarChart3, path: '/reports', label: '报表统计' },
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

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleNavigate = (path: string) => {
    navigate(path)
    onMobileClose()
  }

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

      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/')
          return (
            <button
              key={item.path}
              onClick={() => handleNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 min-h-[44px] ${
                isActive
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon size={20} className="shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-all duration-200 min-h-[44px]"
          title={isCollapsed ? '退出登录' : undefined}
        >
          <LogOut size={20} className="shrink-0" />
          {!isCollapsed && <span>退出登录</span>}
        </button>
      </div>
    </aside>
  )
}
