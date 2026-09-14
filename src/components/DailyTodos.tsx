import { useState, useEffect, useMemo } from 'react'
import {
  loadTodos,
  saveTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  getAllTodosSorted,
  getTodayStr,
  extractPlainText,
  sanitizeTodoHtml,
  type TodoItem,
  type TodoDraft,
  type TodoPriority,
} from '../utils/todoStorage'
import { parseLocalDate } from '../utils/dates'
import TodoEditModal from './TodoEditModal'

/** 优先级视觉样式：左侧色条 + 名称 */
const PRIORITY_STYLES: Record<TodoPriority, { bar: string; label: string }> = {
  high: { bar: 'bg-red-500', label: '高' },
  medium: { bar: 'bg-amber-400', label: '中' },
  low: { bar: 'bg-gray-300', label: '低' },
}

/** 创建时间（今天显示时分，更早显示月/日） */
function formatCreatedTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 截止日期显示（逾期红 / 今日橙 / 明日黄 / 其他灰） */
function getDueInfo(dueDate: string): { text: string; cls: string } {
  const due = parseLocalDate(dueDate)
  if (isNaN(due.getTime())) return { text: '', cls: '' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { text: `逾期${Math.abs(diffDays)}天`, cls: 'text-red-600 font-medium' }
  if (diffDays === 0) return { text: '今天截止', cls: 'text-orange-600 font-medium' }
  if (diffDays === 1) return { text: '明天截止', cls: 'text-amber-600' }
  return { text: `${due.getMonth() + 1}/${due.getDate()}截止`, cls: 'text-gray-400' }
}

/**
 * 每日待办事项卡片（工作台）
 *
 * 纯内容展示：无卡片标题/日期头，待办文本即卡片
 * - 待办不按日期自动清空：跨日持续展示，直到用户手动删除
 * - 内容以富文本 HTML 渲染（经 sanitizeTodoHtml 清洗），
 *   编号列表/删除线/颜色/字号等编辑样式在展示界面原样呈现
 * - 无外框设计：组件无白色容器/描边/阴影，条目直接置于工作台灰底上，
 *   以淡蓝底色（blue-50）与背景区分，视觉柔和
 * - 高度撑满工作台首行（与「今日新增」卡片等高）；待办 ≤2 条时卡片占满整行并拉伸全高，
 *   多于 2 条时双列排列、超出滚动
 * - 每条待办：优先级色条 + 大号内容文本 + 截止日期/创建时间
 * - 点击即编辑（无单独新增按钮，空状态点击 = 新增）
 * - 排序：优先级高在前，同级按创建时间
 * - 数据持久化到 localStorage
 */
export default function DailyTodos() {
  const [todos, setTodos] = useState<TodoItem[]>(loadTodos)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<TodoItem | null>(null)

  // 数据变化即持久化
  useEffect(() => {
    saveTodos(todos)
  }, [todos])

  // 全部待办（跨日保留不自动清空；优先级 + 创建时间排序）
  const visibleTodos = useMemo(() => getAllTodosSorted(todos), [todos])

  /** 点击条目 → 编辑；点击空状态 → 新增 */
  const handleClick = (todo: TodoItem | null) => {
    setEditing(todo)
    setEditOpen(true)
  }

  const handleSave = (draft: TodoDraft) => {
    if (editing) {
      setTodos((prev) => updateTodo(prev, editing.id, draft))
    } else {
      setTodos((prev) => [...prev, createTodo(draft, getTodayStr())])
    }
    setEditOpen(false)
    setEditing(null)
  }

  const handleDelete = () => {
    if (editing) {
      setTodos((prev) => deleteTodo(prev, editing.id))
    }
    setEditOpen(false)
    setEditing(null)
  }

  // 待办 ≤2 条时：卡片占满整行并拉伸至容器全高（填满右侧区域）；
  // 多于 2 条时：双列网格自然排列，超出容器高度滚动
  const stretch = visibleTodos.length > 0 && visibleTodos.length <= 2

  return (
    <div className="h-full flex flex-col">
      {/* 待办网格：无标题头，内容即卡片；大屏双列，小屏单列；点击即编辑 */}
      {visibleTodos.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-sm text-gray-400 rounded-lg bg-blue-50 cursor-pointer hover:bg-blue-100/60 transition-colors"
          onClick={() => handleClick(null)}
        >
          暂无待办，点击开始记录
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-2.5 ${stretch ? 'h-full auto-rows-fr' : ''}`}>
            {visibleTodos.map((todo) => {
              const priority = todo.priority || 'medium'
              const pStyle = PRIORITY_STYLES[priority]
              // 内容为主体（富文本渲染）；旧数据无内容时回退标题纯文本
              const hasContent = extractPlainText(todo.content).length > 0
              const due = todo.dueDate ? getDueInfo(todo.dueDate) : null
              return (
                <div
                  key={todo.id}
                  className={`relative flex flex-col rounded-lg bg-blue-50 pl-4 pr-3 py-2.5 hover:bg-blue-100/60 cursor-pointer transition-colors ${stretch ? 'md:col-span-2' : ''}`}
                  onClick={() => handleClick(todo)}
                  title="点击编辑"
                >
                  {/* 优先级色条 */}
                  <span className={`absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full ${pStyle.bar}`} />

                  {/* 内容：富文本 HTML（编号列表/删除线/颜色/字号等样式原样呈现；拉伸模式不截断） */}
                  {hasContent ? (
                    <div
                      className={`text-base text-gray-800 leading-relaxed break-words [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 ${
                        stretch ? '' : 'line-clamp-4'
                      }`}
                      dangerouslySetInnerHTML={{ __html: sanitizeTodoHtml(todo.content) }}
                    />
                  ) : (
                    <p
                      className={`text-base text-gray-800 leading-relaxed whitespace-pre-line break-words ${
                        stretch ? '' : 'line-clamp-4'
                      }`}
                    >
                      {todo.title}
                    </p>
                  )}

                  {/* 元信息：截止日期 + 创建时间（拉伸模式贴卡片底部） */}
                  <div className={`flex items-center gap-2 text-xs text-gray-400 ${stretch ? 'mt-auto pt-3' : 'mt-1.5'}`}>
                    {due && due.text && <span className={due.cls}>{due.text}</span>}
                    <span className="ml-auto">{formatCreatedTime(todo.created_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 编辑/新增弹窗 */}
      {editOpen && (
        <TodoEditModal
          initial={editing}
          onSave={handleSave}
          onDelete={editing ? handleDelete : undefined}
          onClose={() => {
            setEditOpen(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
