import { useState } from 'react'
import Sidebar from './Sidebar'
import IdleMonitor from './IdleMonitor'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar isCollapsed={isCollapsed} onToggle={() => setIsCollapsed(!isCollapsed)} />
      <main className={`transition-all duration-300 ${isCollapsed ? 'ml-16' : 'ml-64'}`}>
        {children}
      </main>
      {/* 无操作自动登出监控 + 过期警告弹窗 */}
      <IdleMonitor />
    </div>
  )
}
