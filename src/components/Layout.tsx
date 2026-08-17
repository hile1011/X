import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import IdleMonitor from './IdleMonitor'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  // 桌面端侧边栏折叠（md+），默认收缩仅显示图标
  const [isCollapsed, setIsCollapsed] = useState(true)
  // 移动端 drawer 开关（<md）
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const location = useLocation()

  // 路由变化时自动关闭移动 drawer
  useEffect(() => {
    setIsMobileOpen(false)
  }, [location.pathname])

  // drawer 打开时锁定 body 滚动
  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobileOpen])

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        isCollapsed={isCollapsed}
        onToggle={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
      />

      {/* 移动端背景遮罩（<md，drawer 打开时显示） */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          aria-hidden="true"
        />
      )}

      {/* 移动端顶栏（<md）：汉堡按钮 + 标题 */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 z-40 bg-white border-b border-gray-200 flex items-center px-4">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="p-2 -ml-2 rounded-lg hover:bg-gray-100 text-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="打开菜单"
        >
          <Menu size={24} />
        </button>
        <h1 className="ml-2 text-base font-semibold text-gray-800">报价跟单系统</h1>
      </header>

      {/* 主内容：移动端无左偏移、顶部留 56px 给移动顶栏；md+ 恢复桌面偏移 */}
      <main className={`transition-all duration-300 pt-14 md:pt-0 ${isCollapsed ? 'md:ml-16' : 'md:ml-64'}`}>
        {children}
      </main>

      {/* 无操作自动登出监控 + 过期警告弹窗 */}
      <IdleMonitor />
    </div>
  )
}
