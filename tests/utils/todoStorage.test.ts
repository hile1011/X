/**
 * 每日待办本地存储层 单元测试
 * 测试目标：src/utils/todoStorage.ts
 *   - sanitizeTodoHtml：XSS 防御清洗（script/iframe/行内事件/javascript 协议）
 *   - extractPlainText：富文本 → 纯文本
 *   - loadTodos / saveTodos：localStorage 读写 + 损坏数据防御
 *   - createTodo / updateTodo / deleteTodo：不可变数据操作
 *   - getTodosForDate：日期过滤 + 优先级排序
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getTodayStr,
  sanitizeTodoHtml,
  extractPlainText,
  loadTodos,
  saveTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  getTodosForDate,
  type TodoItem,
  type TodoDraft,
} from '../../src/utils/todoStorage'

const draft = (over: Partial<TodoDraft> = {}): TodoDraft => ({
  title: '标题',
  content: '<p>内容</p>',
  priority: 'medium',
  dueDate: '',
  ...over,
})

const makeTodo = (over: Partial<TodoItem> = {}): TodoItem => ({
  id: 'id-1',
  title: '标题',
  content: '<p>内容</p>',
  date: '2026-09-10',
  priority: 'medium',
  created_at: '2026-09-10T00:00:00.000Z',
  updated_at: '2026-09-10T00:00:00.000Z',
  ...over,
})

beforeEach(() => {
  localStorage.clear()
})

// ============================ getTodayStr ============================

describe('getTodayStr - 今日日期', () => {
  it('返回本地 YYYY-MM-DD 格式', () => {
    const today = getTodayStr()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ============================ sanitizeTodoHtml ============================

describe('sanitizeTodoHtml - XSS 清洗', () => {
  it('移除 script 标签（含内容）', () => {
    expect(sanitizeTodoHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>')
  })

  it('移除 iframe 标签（含内容）', () => {
    expect(sanitizeTodoHtml('<iframe src="https://evil"></iframe><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('移除双引号行内事件属性', () => {
    expect(sanitizeTodoHtml('<div onclick="alert(1)">点我</div>')).toBe('<div>点我</div>')
  })

  it('移除单引号行内事件属性', () => {
    expect(sanitizeTodoHtml("<div onmouseover='alert(1)'>悬停</div>")).toBe('<div>悬停</div>')
  })

  it('移除无引号行内事件属性', () => {
    expect(sanitizeTodoHtml('<div onmouseenter=alert(1)>悬停</div>')).toBe('<div>悬停</div>')
  })

  it('移除 javascript: 协议', () => {
    expect(sanitizeTodoHtml('<a href="javascript:alert(1)">链接</a>')).toBe('<a href="alert(1)">链接</a>')
  })

  it('普通 HTML 不受影响', () => {
    const html = '<p style="color:red">正常<b>内容</b></p>'
    expect(sanitizeTodoHtml(html)).toBe(html)
  })

  it('空字符串返回空字符串', () => {
    expect(sanitizeTodoHtml('')).toBe('')
  })
})

// ============================ extractPlainText ============================

describe('extractPlainText - 富文本提取纯文本', () => {
  it('<br> 转换为换行', () => {
    expect(extractPlainText('第一行<br>第二行')).toBe('第一行\n第二行')
  })

  it('块级标签结束转换为换行（p/div/li/h1-h6）', () => {
    expect(extractPlainText('<p>段落一</p><p>段落二</p>')).toBe('段落一\n段落二')
    expect(extractPlainText('<div>A</div><div>B</div>')).toBe('A\nB')
    expect(extractPlainText('<ul><li>项1</li><li>项2</li></ul>')).toBe('项1\n项2')
    expect(extractPlainText('<h1>标题</h1><h6>小标题</h6>')).toBe('标题\n小标题')
  })

  it('移除其余 HTML 标签', () => {
    expect(extractPlainText('<b>粗体</b><i>斜体</i>')).toBe('粗体斜体')
  })

  it('解码常见实体（&nbsp; &lt; &gt; &amp;）', () => {
    expect(extractPlainText('a&nbsp;b')).toBe('a b')
    expect(extractPlainText('&lt;tag&gt;')).toBe('<tag>')
    expect(extractPlainText('a&amp;b')).toBe('a&b')
  })

  it('连续空格/制表符合并为单空格', () => {
    expect(extractPlainText('a    b\t\tc')).toBe('a b c')
  })

  it('3 个以上连续换行压缩为 2 个', () => {
    expect(extractPlainText('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('换行前后空格被修剪', () => {
    expect(extractPlainText('a \n b')).toBe('a\nb')
  })

  it('首尾空白被 trim', () => {
    expect(extractPlainText('  <p>内容</p>  ')).toBe('内容')
  })

  it('空字符串返回空字符串', () => {
    expect(extractPlainText('')).toBe('')
  })
})

// ============================ loadTodos / saveTodos ============================

describe('loadTodos / saveTodos - localStorage 持久化', () => {
  it('空存储返回空数组', () => {
    expect(loadTodos()).toEqual([])
  })

  it('保存后读取一致', () => {
    const todos = [makeTodo({ id: 'a' }), makeTodo({ id: 'b' })]
    saveTodos(todos)
    expect(loadTodos()).toEqual(todos)
  })

  it('非法 JSON 返回空数组', () => {
    localStorage.setItem('daily_todos_v1', '{broken json')
    expect(loadTodos()).toEqual([])
  })

  it('JSON 非数组返回空数组', () => {
    localStorage.setItem('daily_todos_v1', '{"not":"array"}')
    expect(loadTodos()).toEqual([])
  })

  it('过滤结构不合法的记录（缺 id/title/content 任一）', () => {
    localStorage.setItem('daily_todos_v1', JSON.stringify([
      makeTodo({ id: 'ok' }),
      { id: 'no-title' },            // 缺 title/content
      { id: 123, title: 'x' },        // id 非字符串
      null,                           // 空记录
      'string-item',                  // 非对象
    ]))
    const loaded = loadTodos()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('ok')
  })

  it('saveTodos 在 localStorage 抛错时静默失败（不抛出）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveTodos([makeTodo()])).not.toThrow()
    spy.mockRestore()
  })

  it('loadTodos 在 localStorage 抛错时返回空数组', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(loadTodos()).toEqual([])
    spy.mockRestore()
  })
})

// ============================ createTodo / updateTodo / deleteTodo ============================

describe('createTodo - 新建待办', () => {
  it('生成唯一 id 与时间戳，content 经清洗', () => {
    const t = createTodo(draft({ content: '<script>bad()</script><p>好</p>' }), '2026-09-10')
    expect(t.id).toBeTruthy()
    expect(t.content).toBe('<p>好</p>')
    expect(t.title).toBe('标题')
    expect(t.date).toBe('2026-09-10')
    expect(t.priority).toBe('medium')
    expect(t.created_at).toBe(t.updated_at)
  })

  it('dueDate 为空字符串时存为 undefined', () => {
    const t = createTodo(draft({ dueDate: '' }), '2026-09-10')
    expect(t.dueDate).toBeUndefined()
  })

  it('dueDate 非空时保留', () => {
    const t = createTodo(draft({ dueDate: '2026-09-11' }), '2026-09-10')
    expect(t.dueDate).toBe('2026-09-11')
  })

  it('两次生成的 id 不同', () => {
    const a = createTodo(draft(), '2026-09-10')
    const b = createTodo(draft(), '2026-09-10')
    expect(a.id).not.toBe(b.id)
  })
})

describe('updateTodo - 更新待办（不可变）', () => {
  const todos = [makeTodo({ id: 'a' }), makeTodo({ id: 'b' })]

  it('仅更新目标记录，其余保持原引用', () => {
    const next = updateTodo(todos, 'a', draft({ title: '新标题' }))
    expect(next[0].title).toBe('新标题')
    expect(next[0]).not.toBe(todos[0])
    expect(next[1]).toBe(todos[1])
    // 原数组不变
    expect(todos[0].title).toBe('标题')
  })

  it('更新 content 时重新清洗，dueDate 空串归一为 undefined', () => {
    const next = updateTodo(todos, 'a', draft({ content: '<p onclick="x()">n</p>', dueDate: '' }))
    expect(next[0].content).toBe('<p>n</p>')
    expect(next[0].dueDate).toBeUndefined()
  })

  it('updated_at 刷新为当前时间', () => {
    const before = new Date('2026-01-01T00:00:00Z').getTime()
    const next = updateTodo([makeTodo({ id: 'a', updated_at: new Date(before).toISOString() })], 'a', draft())
    expect(new Date(next[0].updated_at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('未命中 id 时返回原数组内容（各记录保持不变）', () => {
    const next = updateTodo(todos, 'not-exist', draft({ title: 'X' }))
    expect(next.map((t) => t.title)).toEqual(['标题', '标题'])
  })
})

describe('deleteTodo - 删除待办（不可变）', () => {
  it('删除目标记录，其余保留', () => {
    const todos = [makeTodo({ id: 'a' }), makeTodo({ id: 'b' }), makeTodo({ id: 'c' })]
    const next = deleteTodo(todos, 'b')
    expect(next.map((t) => t.id)).toEqual(['a', 'c'])
    // 原数组不变
    expect(todos).toHaveLength(3)
  })

  it('未命中 id 返回等长数组', () => {
    const todos = [makeTodo({ id: 'a' })]
    expect(deleteTodo(todos, 'x')).toHaveLength(1)
  })
})

// ============================ getTodosForDate ============================

describe('getTodosForDate - 日期过滤与排序', () => {
  it('仅返回指定日期的待办', () => {
    const todos = [
      makeTodo({ id: 'a', date: '2026-09-10' }),
      makeTodo({ id: 'b', date: '2026-09-11' }),
      makeTodo({ id: 'c', date: '2026-09-10' }),
    ]
    const result = getTodosForDate(todos, '2026-09-10')
    expect(result.map((t) => t.id).sort()).toEqual(['a', 'c'])
  })

  it('优先级排序：high → medium → low', () => {
    const todos = [
      makeTodo({ id: 'low', priority: 'low', created_at: '2026-09-10T03:00:00Z' }),
      makeTodo({ id: 'med', priority: 'medium', created_at: '2026-09-10T02:00:00Z' }),
      makeTodo({ id: 'high', priority: 'high', created_at: '2026-09-10T01:00:00Z' }),
    ]
    const result = getTodosForDate(todos, '2026-09-10')
    expect(result.map((t) => t.id)).toEqual(['high', 'med', 'low'])
  })

  it('同级按创建时间升序', () => {
    const todos = [
      makeTodo({ id: 'late', priority: 'high', created_at: '2026-09-10T09:00:00Z' }),
      makeTodo({ id: 'early', priority: 'high', created_at: '2026-09-10T01:00:00Z' }),
    ]
    const result = getTodosForDate(todos, '2026-09-10')
    expect(result.map((t) => t.id)).toEqual(['early', 'late'])
  })

  it('旧数据无 priority 字段视为 medium', () => {
    const todos = [
      makeTodo({ id: 'legacy', priority: undefined, created_at: '2026-09-10T01:00:00Z' }),
      makeTodo({ id: 'low', priority: 'low', created_at: '2026-09-10T02:00:00Z' }),
    ]
    const result = getTodosForDate(todos, '2026-09-10')
    expect(result.map((t) => t.id)).toEqual(['legacy', 'low'])
  })

  it('两条旧数据均无 priority 字段：均视为 medium，按创建时间排序', () => {
    const todos = [
      makeTodo({ id: 'later', priority: undefined, created_at: '2026-09-10T09:00:00Z' }),
      makeTodo({ id: 'earlier', priority: undefined, created_at: '2026-09-10T01:00:00Z' }),
    ]
    const result = getTodosForDate(todos, '2026-09-10')
    expect(result.map((t) => t.id)).toEqual(['earlier', 'later'])
  })

  it('空数组返回空数组', () => {
    expect(getTodosForDate([], '2026-09-10')).toEqual([])
  })
})
