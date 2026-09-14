/**
 * 每日待办事项 — 本地存储层
 *
 * 数据持久化方案：localStorage（键 daily_todos_v1）
 * - 每条待办归属一个日期（date: YYYY-MM-DD，记录创建日）
 * - 待办不按日期自动清空：持续展示直到用户手动删除（跨日保留）
 * - content 为富文本 HTML（编辑器 toolbar 应用字体大小/颜色/粗体/斜体/下划线/删除线/编号列表）
 * - 存入前经 sanitizeTodoHtml 清洗，防止 script/事件处理器注入
 */

import { toLocalDateStr } from './dates'

export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  /** 事项标题（纯文本） */
  title: string
  /** 事项内容（富文本 HTML） */
  content: string
  /** 归属日期 YYYY-MM-DD（当日待办按此过滤） */
  date: string
  /** 优先级（旧数据无此字段视为 medium） */
  priority?: TodoPriority
  /** 截止日期 YYYY-MM-DD（可选） */
  dueDate?: string
  /** 创建时间 ISO 字符串 */
  created_at: string
  /** 最后修改时间 ISO 字符串 */
  updated_at: string
}

/** 编辑弹窗保存的数据 */
export interface TodoDraft {
  title: string
  content: string
  priority: TodoPriority
  dueDate: string
}

/** 优先级排序权重（高在前） */
const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 }

const STORAGE_KEY = 'daily_todos_v1'

/** 生成本地 YYYY-MM-DD（今日） */
export function getTodayStr(): string {
  return toLocalDateStr(new Date())
}

/** 生成短随机 id（时间戳 + 随机段，本地单用户场景足够） */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 清洗富文本 HTML：移除 script/iframe 标签、行内事件属性与 javascript: 协议
 * （数据仅存于本地浏览器，此处为防御性清洗）
 */
export function sanitizeTodoHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    // 行内事件：on*="..." / on*='...' / on*=bare
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

/** 从富文本 HTML 提取纯文本（保留换行：<br> 与块级结束标签转为 \n；有序列表加 "1. " 编号前缀） */
export function extractPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    // 有序列表：<li> 前插入编号（每个 <ol> 内计数器重置）
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
      let i = 0
      return inner.replace(/<li[^>]*>/gi, () => `${++i}. `)
    })
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ ?\n ?/g, '\n')
    .trim()
}

/** 读取全部待办（localStorage 不可用或数据损坏时返回空数组） */
export function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 过滤掉结构不合法的记录，保证类型安全
    return parsed.filter(
      (t): t is TodoItem =>
        t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.content === 'string',
    )
  } catch {
    return []
  }
}

/** 保存全部待办 */
export function saveTodos(todos: TodoItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  } catch {
    // localStorage 不可用（隐私模式/容量满），忽略
  }
}

/** 新建待办事项 */
export function createTodo(draft: TodoDraft, date: string): TodoItem {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    title: draft.title,
    content: sanitizeTodoHtml(draft.content),
    date,
    priority: draft.priority,
    dueDate: draft.dueDate || undefined,
    created_at: now,
    updated_at: now,
  }
}

/** 更新待办（返回新数组，不修改原数组） */
export function updateTodo(todos: TodoItem[], id: string, draft: TodoDraft): TodoItem[] {
  return todos.map((t) =>
    t.id === id
      ? {
          ...t,
          title: draft.title,
          content: sanitizeTodoHtml(draft.content),
          priority: draft.priority,
          dueDate: draft.dueDate || undefined,
          updated_at: new Date().toISOString(),
        }
      : t,
  )
}

/** 删除待办（返回新数组，不修改原数组） */
export function deleteTodo(todos: TodoItem[], id: string): TodoItem[] {
  return todos.filter((t) => t.id !== id)
}

/** 获取全部待办（不按日期过滤、跨日保留，直到手动删除；优先级高在前，同级按创建时间升序） */
export function getAllTodosSorted(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority || 'medium']
    const pb = PRIORITY_ORDER[b.priority || 'medium']
    if (pa !== pb) return pa - pb
    return a.created_at.localeCompare(b.created_at)
  })
}
