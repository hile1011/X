import { useRef, useEffect, useMemo } from 'react'
import type { Quote } from '../pages/Quotes'
import { OrderStatus } from '../constants/OrderStatus'
import { TableConstants } from '../constants/TableConstants'
import { getPrintTableRows, isTableTitleRow } from '../utils/printTableRange'

interface PrintPreviewModalProps {
  quote: Quote
  styleLabel: string
  onClose: () => void
}

const STATUS_COLORS: Record<number, string> = {
  1: '#3b82f6',
  2: '#eab308',
  3: '#a855f7',
  4: '#f97316',
  5: '#22c55e',
  6: '#6b7280',
}

/**
 * 订单打印预览组件
 *
 * 流程：将 A4 预览内容渲染到隐藏 DOM → 提取 HTML → 在新标签页中展示预览 + 打印按钮
 * 新标签页包含完整样式（复制父文档样式表），用户确认后调用浏览器打印。
 */
export function PrintPreviewModal({ quote, styleLabel, onClose }: PrintPreviewModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // 组件挂载后：提取渲染好的 HTML，在新标签页中打开预览
  // 使用 ref 保证只执行一次，避免父组件重渲染时 onClose 引用变化导致重复弹窗
  const openedRef = useRef(false)
  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true

    if (!contentRef.current) {
      onClose()
      return
    }

    const contentHtml = contentRef.current.outerHTML

    const win = window.open('', '_blank')
    if (!win) {
      alert('弹出窗口被浏览器拦截，请允许弹出窗口后重试')
      onClose()
      return
    }

    const doc = win.document

    // 复制父文档所有样式表（含 Tailwind CSS），确保预览内容样式一致
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      doc.head.appendChild(node.cloneNode(true))
    })

    // 预览页面专用样式
    const printStyle = doc.createElement('style')
    printStyle.textContent = `
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      /* 跨浏览器打印兼容：强制保留背景色（标题行蓝底/状态徽章），确保打印预览与实际打印效果一致
         （Chrome/Edge/Safari 支持 -webkit-print-color-adjust，Firefox/新版 Safari 支持 print-color-adjust） */
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .print-toolbar {
        position: fixed; top: 0; left: 0; right: 0;
        background: white; border-bottom: 1px solid #e5e7eb;
        padding: 10px 24px; display: flex; justify-content: space-between; align-items: center;
        z-index: 100; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }
      .print-toolbar h3 { font-size: 16px; font-weight: 600; color: #374151; margin: 0; }
      .print-toolbar .actions { display: flex; gap: 12px; }
      .print-toolbar button { padding: 8px 20px; border-radius: 8px; font-size: 14px; cursor: pointer; border: none; transition: all 0.15s; }
      .print-toolbar .btn-cancel { border: 1px solid #d1d5db; color: #4b5563; background: white; }
      .print-toolbar .btn-cancel:hover { background: #f9fafb; }
      .print-toolbar .btn-print { background: #4f46e5; color: white; }
      .print-toolbar .btn-print:hover { background: #4338ca; }
      .preview-area { padding: 70px 20px 40px; display: flex; justify-content: center; }
      .print-page { background: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      @media print {
        .print-toolbar { display: none !important; }
        .preview-area { padding: 0; }
        .print-page { box-shadow: none !important; width: auto !important; min-height: auto !important; }
        .print-content { padding: 10mm 14mm !important; }
      }
    `
    doc.head.appendChild(printStyle)

    doc.title = quote.quote_number || '打印'

    doc.body.innerHTML = `
      <div class="print-toolbar">
        <h3>打印预览 — ${quote.quote_number}</h3>
        <div class="actions">
          <button class="btn-cancel" onclick="window.close()">取消</button>
          <button class="btn-print" onclick="window.print()">确认打印</button>
        </div>
      </div>
      <div class="preview-area">${contentHtml}</div>
    `

    win.focus()

    // 新标签页已打开，关闭当前页的隐藏 DOM
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN')
  }

  // 在线表格数值格式化：与页面 fieldFormat 规则一致 —— 数字默认保留 2 位小数，非数字原样显示
  const formatTableCell = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number' && !isNaN(value)) {
      return value.toFixed(2)
    }
    return String(value)
  }

  const statusLabel = OrderStatus.getLabel(quote.status) || '未知'
  const statusColor = STATUS_COLORS[quote.status] || '#6b7280'

  // 在线表格列宽百分比（按 COL_WIDTHS 比例分配，适配 A4 宽度）
  const colPercents = useMemo(() => {
    const widths = TableConstants.COL_WIDTHS
    const total = widths.reduce((s, w) => s + w, 0)
    return widths.map((w) => `${(w / total) * 100}%`)
  }, [])
  const colCount = TableConstants.getColumnCount()
  // 打印范围限制：仅保留第二个标题行之前的内容（过滤空行 + 截断，详见 printTableRange.ts）
  const printTableRows = useMemo(() => getPrintTableRows(quote.tableData), [quote.tableData])
  const hasTableData = printTableRows.length > 0

  // 隐藏渲染：内容会被提取到新标签页，用户不可见
  return (
    <div style={{ position: 'fixed', left: '-9999px', top: 0, opacity: 0 }} aria-hidden="true">
      <div
        ref={contentRef}
        className="print-page bg-white"
        style={{ width: '794px', minHeight: '1123px' }}
      >
        <div className="print-content" style={{ padding: '48px 56px' }}>
          {/* 客户信息 */}
          <div className="mb-5">
            <h2 style={{ fontSize: '13px', fontWeight: 600 }} className="text-gray-700 mb-2 pb-1.5 border-b border-gray-300">
              客户信息
            </h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1" style={{ fontSize: '12px' }}>
              <div>
                <span className="text-gray-500">客户名称：</span>
                <span className="text-gray-800">{quote.customerName}</span>
              </div>
              <div>
                <span className="text-gray-500">收货地址：</span>
                <span className="text-gray-800">{quote.shippingAddress || '-'}</span>
              </div>
            </div>
          </div>

          {/* 时间信息（位于产品信息之前） */}
          <div className="mb-5">
            <h2 style={{ fontSize: '13px', fontWeight: 600 }} className="text-gray-700 mb-2 pb-1.5 border-b border-gray-300">
              时间信息
            </h2>
            <div className="grid grid-cols-3 gap-x-6 gap-y-1" style={{ fontSize: '12px' }}>
              <div>
                <span className="text-gray-500">报价时间：</span>
                <span className="text-gray-800">{formatDate(quote.quoteTime)}</span>
              </div>
              <div>
                <span className="text-gray-500">打样时间：</span>
                <span className="text-gray-800">{formatDate(quote.sampleTime)}</span>
              </div>
              <div>
                <span className="text-gray-500">做货开始：</span>
                <span className="text-gray-800">
                  {formatDate(quote.productionStartTime || quote.productionTimeStart)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">做货结束：</span>
                <span className="text-gray-800">{formatDate(quote.productionTimeEnd)}</span>
              </div>
              <div>
                <span className="text-gray-500">发货时间：</span>
                <span className="text-gray-800">{formatDate(quote.shippingTime)}</span>
              </div>
              <div>
                <span className="text-gray-500">收款时间：</span>
                <span className="text-gray-800">{formatDate(quote.paymentTime)}</span>
              </div>
              <div>
                <span className="text-gray-500">打样费：</span>
                <span className="text-gray-800">{quote.sampleFee || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">打样天数：</span>
                <span className="text-gray-800">{quote.sampleDays || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">大货天数：</span>
                <span className="text-gray-800">{quote.massDays || '-'}</span>
              </div>
            </div>
          </div>

          {/* 产品信息 */}
          <div className="mb-5">
            <h2 style={{ fontSize: '13px', fontWeight: 600 }} className="text-gray-700 mb-2 pb-1.5 border-b border-gray-300">
              产品信息
            </h2>
            {/* 订单号 + 状态：产品信息框第一行（字号放大突出显示） */}
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200" style={{ fontSize: '12px' }}>
              <div>
                <span style={{ fontSize: '16px' }} className="text-gray-500">订单号：</span>
                <span style={{ fontSize: '18px', fontWeight: 700 }} className="text-gray-800">
                  {quote.quote_number}
                </span>
              </div>
              <span
                className="px-3 py-1 rounded text-white"
                style={{ backgroundColor: statusColor, fontSize: '16px', fontWeight: 700 }}
              >
                {statusLabel}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1" style={{ fontSize: '12px' }}>
              <div>
                <span className="text-gray-500">款式：</span>
                <span className="text-gray-800">{styleLabel}</span>
              </div>
              <div>
                <span className="text-gray-500">产品规格：</span>
                <span className="text-gray-800">
                  {quote.productSpec ? `${quote.productSpec}CM` : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">数量：</span>
                <span className="text-gray-800">
                  {quote.quantity ? `${quote.quantity}个` : '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">箱规：</span>
                <span className="text-gray-800">{quote.boxSpec || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">面料材质：</span>
                <span className="text-gray-800">{quote.fabricMaterial || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">工艺：</span>
                <span className="text-gray-800">{quote.process || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">手提：</span>
                <span className="text-gray-800">
                  {[quote.handleMaterial, quote.handleSpec].filter(Boolean).join('：') || '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-500">备注：</span>
                <span className="text-gray-800 break-words">{quote.remark || '-'}</span>
              </div>
            </div>
          </div>

          {/* 产品图片 */}
          {quote.images && quote.images.length > 0 && (
            <div className="mb-5">
              <h2 style={{ fontSize: '13px', fontWeight: 600 }} className="text-gray-700 mb-2 pb-1.5 border-b border-gray-300">
                产品图片
              </h2>
              <div className="flex flex-wrap gap-2">
                {quote.images.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`产品图${i + 1}`}
                    className="w-28 h-28 object-cover border border-gray-300 rounded"
                    crossOrigin="anonymous"
                  />
                ))}
              </div>
            </div>
          )}

          {/* 在线表格（仅打印第二个标题行之前的内容） */}
          {hasTableData && (
            <div className="mb-5">
              <h2 style={{ fontSize: '13px', fontWeight: 600 }} className="text-gray-700 mb-2 pb-1.5 border-b border-gray-300">
                在线表格
              </h2>
              <table
                className="w-full border-collapse"
                style={{ tableLayout: 'fixed', fontSize: '10px' }}
              >
                <colgroup>
                  {colPercents.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <tbody>
                  {printTableRows.map((row, rowIdx) => {
                    // 标题行保留在线表格原有样式：蓝底白字加粗（#4472C4 / #FFFFFF）
                    const isTitle = isTableTitleRow(row)
                    return (
                      <tr key={rowIdx}>
                        {Array.from({ length: colCount }).map((_, colIdx) => (
                          <td
                            key={colIdx}
                            className="border border-black align-middle text-gray-800"
                            style={{
                              padding: '2px 3px',
                              // 所有单元格允许换行：内容显示不全时自动换行完整展示，不再省略截断
                              whiteSpace: 'normal',
                              overflowWrap: 'break-word',
                              wordBreak: 'break-all',
                              // 标题行蓝底白字居中（与在线表格样式一致）
                              ...(isTitle ? {
                                backgroundColor: '#4472C4',
                                color: '#FFFFFF',
                                fontWeight: 600,
                                textAlign: 'center',
                                lineHeight: 1.3,
                              } : {}),
                            }}
                          >
                            {formatTableCell(row[colIdx])}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
