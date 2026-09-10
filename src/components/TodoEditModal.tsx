import { useState, useEffect, useRef } from 'react'
import { Bold, Italic, Underline, Palette, X, Trash2 } from 'lucide-react'
import { sanitizeTodoHtml, extractPlainText, type TodoItem, type TodoDraft, type TodoPriority } from '../utils/todoStorage'

/**
 * 待办事项编辑弹窗
 *
 * 富文本编辑：基于 contentEditable + document.execCommand 实现
 * - 支持粗体/斜体/下划线/字体大小/文字颜色
 * - 工具栏按钮 onMouseDown 阻止默认行为，避免点击时丢失内容区选区
 * - styleWithCSS 让 foreColor 以 style 属性输出，渲染更稳定
 */

// 字体大小选项（execCommand fontSize 的 1~7 级别）
const FONT_SIZE_OPTIONS = [
  { label: '小', value: '2' },
  { label: '标准', value: '3' },
  { label: '大', value: '4' },
  { label: '特大', value: '5' },
  { label: '超大', value: '6' },
]

// 文字颜色色板
const COLOR_PALETTE = [
  '#1f2937', // 墨色（默认）
  '#dc2626', // 红
  '#ea580c', // 橙
  '#16a34a', // 绿
  '#2563eb', // 蓝
  '#7c3aed', // 紫
  '#db2777', // 粉
  '#0891b2', // 青
]

// 优先级选项（与列表色条颜色一致）
const PRIORITY_OPTIONS: Array<{ value: TodoPriority; label: string; active: string }> = [
  { value: 'high', label: '高', active: 'bg-red-500 text-white border-red-500' },
  { value: 'medium', label: '中', active: 'bg-amber-400 text-white border-amber-400' },
  { value: 'low', label: '低', active: 'bg-gray-400 text-white border-gray-400' },
]

interface TodoEditModalProps {
  /** 编辑已有事项；null 表示新增 */
  initial: TodoItem | null
  onSave: (draft: TodoDraft) => void
  onDelete?: () => void
  onClose: () => void
}

export default function TodoEditModal({ initial, onSave, onDelete, onClose }: TodoEditModalProps) {
  const [priority, setPriority] = useState<TodoPriority>(initial?.priority || 'medium')
  const [dueDate, setDueDate] = useState(initial?.dueDate || '')
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const colorMenuRef = useRef<HTMLDivElement>(null)

  // 弹窗打开时初始化内容区（后续由用户直接编辑，不受 React 控制）
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = initial ? sanitizeTodoHtml(initial.content) : ''
    }
    // 富文本命令以 CSS style 输出（颜色等样式随内容一起保存）
    try {
      document.execCommand('styleWithCSS', false, 'true')
    } catch {
      // 部分环境不支持时回退到标签输出，功能不受影响
    }
  }, [initial])

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // 点击色板外部关闭
  useEffect(() => {
    if (!colorMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [colorMenuOpen])

  /** 执行富文本命令（保持内容区选区） */
  const exec = (command: string, value?: string) => {
    contentRef.current?.focus()
    document.execCommand(command, false, value)
  }

  const handleSave = () => {
    const content = contentRef.current?.innerHTML || ''
    onSave({ title: '', content, priority, dueDate })
  }

  // 内容为空时不允许保存
  const canSave = extractPlainText(contentRef.current?.innerHTML || '').length > 0

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 弹窗头 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">{initial ? '编辑待办事项' : '新增待办事项'}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* 优先级 + 截止日期（一行，紧凑排布） */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-sm text-gray-700">优先级</label>
              {PRIORITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPriority(opt.value)}
                  className={`px-2.5 py-1 text-xs border rounded-md transition-colors ${
                    priority === opt.value
                      ? `${opt.active} font-medium`
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-sm text-gray-700">截止日期</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="px-2 py-1 text-sm border border-gray-200 rounded-md text-gray-600 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>

          {/* 内容（富文本，编辑主体） */}
          <div>
            <div className="border border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
              {/* 富文本工具栏 */}
              <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-50 border-b border-gray-200 flex-wrap">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec('bold')}
                  className="p-1.5 rounded hover:bg-gray-200 transition-colors"
                  title="粗体"
                  aria-label="粗体"
                >
                  <Bold size={15} className="text-gray-600" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec('italic')}
                  className="p-1.5 rounded hover:bg-gray-200 transition-colors italic"
                  title="斜体"
                  aria-label="斜体"
                >
                  <Italic size={15} className="text-gray-600" />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec('underline')}
                  className="p-1.5 rounded hover:bg-gray-200 transition-colors underline"
                  title="下划线"
                  aria-label="下划线"
                >
                  <Underline size={15} className="text-gray-600" />
                </button>

                <div className="w-px h-5 bg-gray-200 mx-1" />

                {/* 字体大小 */}
                <select
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    if (e.target.value) exec('fontSize', e.target.value)
                    e.target.value = ''
                  }}
                  defaultValue=""
                  className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-600 cursor-pointer"
                  title="字体大小"
                >
                  <option value="" disabled>字号</option>
                  {FONT_SIZE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                <div className="w-px h-5 bg-gray-200 mx-1" />

                {/* 文字颜色 */}
                <div className="relative" ref={colorMenuRef}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setColorMenuOpen(!colorMenuOpen)}
                    className="flex items-center gap-1 p-1.5 rounded hover:bg-gray-200 transition-colors"
                    title="文字颜色"
                    aria-label="文字颜色"
                  >
                    <Palette size={15} className="text-gray-600" />
                  </button>
                  {colorMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-2 flex gap-1.5">
                      {COLOR_PALETTE.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            exec('foreColor', color)
                            setColorMenuOpen(false)
                          }}
                          className="w-5 h-5 rounded-full border border-gray-200 hover:scale-110 transition-transform"
                          style={{ backgroundColor: color }}
                          title={color}
                          aria-label={`颜色 ${color}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 可编辑内容区 */}
              <div
                ref={contentRef}
                contentEditable
                suppressContentEditableWarning
                data-placeholder="请输入事项内容，支持设置字体大小、颜色、粗体、斜体、下划线等样式"
                className="min-h-[180px] max-h-[340px] overflow-y-auto px-3 py-2.5 text-sm text-gray-700 outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-400"
              />
            </div>
          </div>
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100">
          <div>
            {initial && onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={15} />
                删除
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-2 text-sm text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
