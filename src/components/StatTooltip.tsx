import type { ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

/**
 * 统计卡片问号说明：hover 显示计算逻辑
 * 桌面端 hover 显示，移动端点击/触摸也会触发（浏览器对 group-hover 的触摸处理）
 */
function StatTooltip({ children }: { children: ReactNode }) {
  return (
    <div className="relative inline-flex group/tip align-middle ml-0.5">
      <HelpCircle
        size={14}
        className="text-gray-400 hover:text-gray-600 cursor-help transition-colors"
        aria-label="查看计算逻辑"
      />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tip:block z-30 w-60 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-lg leading-relaxed">
        <div className="space-y-1">
          {children}
        </div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-gray-800"></div>
      </div>
    </div>
  )
}

export default StatTooltip
