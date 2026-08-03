import { useState, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface TooltipCellProps {
  /** 单元格显示内容 */
  children: ReactNode
  /** 悬浮提示文本，默认取 children 的字符串形式 */
  tooltip?: string
  /** 外层容器样式（宽度、内边距、文字颜色、字号等） */
  className?: string
}

/**
 * 带即时悬浮提示的表格单元格。
 *
 * 替代原生 title 属性（浏览器内置 1~2 秒延迟），鼠标悬浮即时显示完整内容。
 * - 仅在内容被截断（溢出）时才显示提示，避免短文本也弹出提示
 * - 使用 Portal + fixed 定位，避免被表格滚动容器（overflow-auto）裁剪
 * - 提示框定位在单元格下方，水平居中
 */
export function TooltipCell({ children, tooltip, className = '' }: TooltipCellProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const textRef = useRef<HTMLDivElement>(null)

  const handleEnter = () => {
    const el = textRef.current
    if (!el) return
    // 仅当内容被截断（实际溢出）时才显示提示
    if (el.scrollWidth > el.clientWidth) {
      const rect = el.getBoundingClientRect()
      setPos({
        top: rect.bottom + 4,
        left: rect.left + rect.width / 2,
      })
      setShow(true)
    }
  }

  const handleLeave = () => setShow(false)

  const tipText = tooltip ?? (typeof children === 'string' ? children : '')

  return (
    <div className={`group relative flex-shrink-0 ${className}`}>
      <div
        ref={textRef}
        className="truncate"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        {children}
      </div>
      {show && tipText &&
        createPortal(
          <div
            className="fixed z-[9999] px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap pointer-events-none shadow-lg"
            style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
          >
            {tipText}
          </div>,
          document.body,
        )}
    </div>
  )
}
