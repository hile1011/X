/**
 * 批次号徽标（v36）——订单详情/编辑页显示
 *
 * - 订单号旁显示所属批次（PN-秒级时间戳，amber 样式与订单列表一致）
 * - 点击徽标展开同批次订单列表（惰性加载一次全量列表后本地过滤），支持批次内订单快速跳转
 *   （拥有 quotes:edit 权限跳编辑页，否则跳查看页）
 */
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Loader2, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { OrderStatus } from '../constants/OrderStatus'
import type { Quote } from '../types'

interface BatchBadgeProps {
  batchNumber: string
  /** 当前订单 id（列表中高亮标记） */
  currentId: string
  /** 是否可编辑（决定跳转编辑页还是查看页） */
  canEdit: boolean
}

/** 同批次订单最小结构 */
type BatchOrder = Pick<Quote, 'id' | 'quote_number' | 'customerName' | 'status'> & { batchNumber?: string | null }

export function BatchBadge({ batchNumber, currentId, canEdit }: BatchBadgeProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState<BatchOrder[]>([])
  const [loadError, setLoadError] = useState('')
  const navigate = useNavigate()
  const boxRef = useRef<HTMLDivElement>(null)

  // 展开浮层：首次惰性加载订单列表并按批次过滤
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && orders.length === 0 && !loadError) {
      setLoading(true)
      try {
        const all = await api.quotes.getAll() as BatchOrder[]
        setOrders(all.filter((q) => q.batchNumber === batchNumber))
      } catch (err) {
        console.error('获取同批次订单失败:', err)
        setLoadError('同批次订单加载失败，请重试')
      }
      setLoading(false)
    }
  }

  // 点击浮层外部关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={boxRef} className="relative inline-block max-w-full">
      <button
        type="button"
        onClick={toggle}
        title={`批次 ${batchNumber}（点击查看同批次订单）`}
        className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors max-w-full"
      >
        <Layers size={11} className="flex-shrink-0" />
        <span className="truncate">{batchNumber}</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 w-72 bg-white rounded-lg shadow-xl border border-amber-200 overflow-hidden">
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-100 text-xs font-semibold text-amber-800 flex items-center justify-between">
            <span>同批次订单（{orders.length || (loading ? '…' : 0)}）</span>
            <span className="font-mono font-normal text-amber-600 truncate ml-2">{batchNumber}</span>
          </div>
          <div className="max-h-56 overflow-auto">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                <Loader2 size={14} className="animate-spin" /> 加载中...
              </div>
            )}
            {!loading && loadError && (
              <div className="px-3 py-4 text-sm text-red-500 text-center">{loadError}</div>
            )}
            {!loading && !loadError && orders.length === 0 && (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">暂无订单数据</div>
            )}
            {!loading && orders.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  // replace（v36）：批次内跳转视为同一编辑上下文的订单切换，替换当前历史记录而非压栈，
                  // 与编辑页「返回」导航逻辑解耦——返回始终回到进入编辑页前的来源页，不被批次切换链干扰
                  navigate(canEdit ? `/quotes/${q.id}/edit` : `/quotes/${q.id}`, { replace: true })
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50 transition-colors border-b border-gray-50 last:border-0 ${
                  q.id === currentId ? 'bg-amber-50/60' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-gray-700 truncate">{q.quote_number}</div>
                  <div className="text-xs text-gray-400 truncate">
                    {q.customerName || '未填客户'} · {OrderStatus.getLabel(q.status)}
                  </div>
                </div>
                {q.id === currentId && (
                  <span className="text-[10px] px-1 py-0.5 bg-amber-100 text-amber-700 rounded flex-shrink-0">当前</span>
                )}
                <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
