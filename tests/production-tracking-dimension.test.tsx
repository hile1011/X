/**
 * 做货流程甘特图「双维度展示」组件测试（src/pages/ProductionTracking.tsx）
 *
 * 测试目标：
 *   1. 默认状态：订单优先维度 + 日期从新到旧（降序），tablist/tab 可访问性结构
 *   2. 维度切换：点击「日期优先」→ aria-selected 联动、甘特图 setRecords 收到
 *      日期分组头行（isDateHeader 标记 + date: 前缀 id），无网络请求（纯前端重排）
 *   3. 日期排序方向切换：指示器文案/提示与当前状态同步，记录顺序即时更新
 *   4. localStorage 持久化：维度与排序方向切换后写入；再次进入页面时恢复
 *   5. 两种维度下的甘特图记录顺序与分组头内容（标题/统计徽标字段）；
 *      日期优先按各步骤自身的开始日期分组（同一订单的步骤散布到多个日期组）
 *
 * Mock 说明：
 *   - api：隔离网络（getProductionTasksOverview/getAll/getImageFlags/products/saveProductionTasks）
 *   - @visactor/vtable-gantt：jsdom 无法运行真实甘特图，替换为记录 setRecords
 *     调用的假实例（顺序断言依据）
 *
 * 环境要求：jsdom（tests/setup.ts）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProductionTracking from '../src/pages/ProductionTracking'
import { useAuthStore } from '../src/store/auth'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  quotes: {
    getProductionTasksOverview: vi.fn(),
    getAll: vi.fn(),
    getImageFlags: vi.fn(),
    getThumbnailUrl: vi.fn((id: string) => `/api/quotes/${id}/thumbnail`),
    saveProductionTasks: vi.fn(),
  },
  products: { getAll: vi.fn() },
}))

/** 甘特图 mock 实例共享状态（记录 setRecords 调用顺序） */
const ganttState = vi.hoisted(() => ({ instances: [] as any[] }))

vi.mock('../src/api', () => ({ api: apiMock }))

vi.mock('@visactor/vtable-gantt', () => {
  class MockListTable {
    listeners = new Map<string, any[]>()
    on(type: string, listener: any) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type)!.push(listener)
    }
  }
  class MockGantt {
    container: any
    options: any
    recordsCalls: any[][] = []
    released = false
    taskListTableInstance: MockListTable
    listeners = new Map<string, any[]>()
    constructor(container: any, options: any) {
      this.container = container
      this.options = options
      this.taskListTableInstance = new MockListTable()
      ganttState.instances.push(this)
    }
    on(type: string, listener: any) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type)!.push(listener)
    }
    setRecords(records: any[]) { this.recordsCalls.push(records) }
    updateOption(options: any) { this.options = { ...this.options, ...options } }
    scrollToMarkLine(_date: Date) { /* no-op */ }
    release() { this.released = true }
  }
  return {
    Gantt: MockGantt,
    TYPES: { GANTT_EVENT_TYPE: {
      MOVE_END_TASK_BAR: 'move_end_task_bar',
      CHANGE_DATE_RANGE: 'change_date_range',
      CLICK_TASK_BAR: 'click_task_bar',
      CREATE_TASK_SCHEDULE: 'create_task_schedule',
    } },
  }
})

// ============================ 测试数据 ============================

/**
 * 订单开始日期（回退链结果）：
 *   q1 = 2026-09-02（旧）、q2 = 2026-09-10（新）、q3 = 无开始日期
 * 订单号：q1=B002、q2=A001、q3=C003（同日期时按订单号升序 → A001 在 B002 前）
 */
const QUOTES = [
  {
    id: 'q1', quote_number: 'B002', customerName: '客户B', productStyle: '1',
    quantity: '1000', productionTimeStart: '', productionTimeEnd: '', status: 3,
    sampleTime: '', productionStartTime: '2026-09-02', updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'q2', quote_number: 'A001', customerName: '客户A', productStyle: '2',
    quantity: '2000', productionTimeStart: '', productionTimeEnd: '', status: 3,
    sampleTime: '', productionStartTime: '2026-09-10', updated_at: '2026-09-05T00:00:00Z',
  },
  {
    id: 'q3', quote_number: 'C003', customerName: '客户C', productStyle: '3',
    quantity: '3000', productionTimeStart: '', productionTimeEnd: '', status: 2,
    sampleTime: '', productionStartTime: '', updated_at: '2026-09-06T00:00:00Z',
  },
]

/** 任务行（q1 两步 / q2 一步 / q3 一步；orderStatus 均在默认状态筛选 [2,3,4] 内） */
const OVERVIEW = [
  {
    id: 'q1-s1', quoteId: 'q1', quoteNumber: 'B002', stepOrder: 1, name: '面料采购',
    planStart: '2026-09-02', planEnd: '2026-09-04', actualStart: null, actualEnd: null,
    status: 0, remark: '', materials: [], customerName: '客户B', quantity: '1000',
    orderStatus: 3, quoteUpdatedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'q1-s2', quoteId: 'q1', quoteNumber: 'B002', stepOrder: 2, name: '裁剪',
    planStart: '2026-09-05', planEnd: '2026-09-08', actualStart: null, actualEnd: null,
    status: 0, remark: '', materials: [], customerName: '客户B', quantity: '1000',
    orderStatus: 3, quoteUpdatedAt: '2026-09-01T00:00:00Z',
  },
  {
    id: 'q2-s1', quoteId: 'q2', quoteNumber: 'A001', stepOrder: 1, name: '印花',
    planStart: '2026-09-10', planEnd: '2026-09-12', actualStart: null, actualEnd: null,
    status: 0, remark: '', materials: [], customerName: '客户A', quantity: '2000',
    orderStatus: 3, quoteUpdatedAt: '2026-09-05T00:00:00Z',
  },
  {
    id: 'q3-s1', quoteId: 'q3', quoteNumber: 'C003', stepOrder: 1, name: '等待排期',
    planStart: null, planEnd: null, actualStart: null, actualEnd: null,
    status: 0, remark: '', materials: [], customerName: '客户C', quantity: '3000',
    orderStatus: 2, quoteUpdatedAt: '2026-09-06T00:00:00Z',
  },
]

/** 渲染页面（等待数据加载完成） */
async function renderLoaded() {
  render(
    <MemoryRouter>
      <ProductionTracking />
    </MemoryRouter>,
  )
  await screen.findByText(/3 个订单 · 4 个步骤 · 0 步完成/)
}

/** 甘特图最近一次 setRecords 的记录（维度/排序切换断言依据） */
function lastRecords(): any[] {
  const gantt = ganttState.instances[0]
  expect(gantt).toBeTruthy()
  const calls = gantt.recordsCalls as any[][]
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]
}

// ============================ 测试用例 ============================

describe('做货流程甘特图双维度展示', () => {
  beforeEach(() => {
    localStorage.clear()
    apiMock.quotes.getProductionTasksOverview.mockReset().mockResolvedValue(OVERVIEW)
    apiMock.quotes.getAll.mockReset().mockResolvedValue(QUOTES)
    apiMock.quotes.getImageFlags.mockReset().mockResolvedValue({})
    apiMock.quotes.saveProductionTasks.mockReset().mockImplementation(
      (_quoteId: string, tasks: any[]) => Promise.resolve(
        tasks.map((t: any, i: number) => ({ ...t, id: `srv-${i + 1}` })),
      ),
    )
    apiMock.products.getAll.mockReset().mockResolvedValue([])
    ganttState.instances.length = 0
    useAuthStore.setState({ permissions: ['quotes:edit'] })
  })

  afterEach(() => {
    cleanup()
  })

  describe('默认状态与可访问性', () => {
    it('默认订单优先 + 日期从新到旧；tablist/tab 结构完整', async () => {
      await renderLoaded()

      const tablist = screen.getByRole('tablist', { name: '展示维度' })
      expect(tablist).toBeTruthy()
      const orderTab = screen.getByRole('tab', { name: /订单优先/ })
      const dateTab = screen.getByRole('tab', { name: /日期优先/ })
      expect(orderTab.getAttribute('aria-selected')).toBe('true')
      expect(dateTab.getAttribute('aria-selected')).toBe('false')
      // 日期排序指示器：默认降序（↓ 从新到旧），图标与状态同步
      expect(screen.getByText('日期从新到旧')).toBeTruthy()
      // 图例区维度说明（订单优先 + 降序）
      expect(screen.getByText(/订单优先：按开始日期从新到旧排序/)).toBeTruthy()
    })

    it('加载态反馈：加载中显示指示器，完成后展示汇总', async () => {
      let resolveOverview: (v: any) => void = () => {}
      apiMock.quotes.getProductionTasksOverview.mockReturnValue(
        new Promise((res) => { resolveOverview = res }),
      )
      render(
        <MemoryRouter>
          <ProductionTracking />
        </MemoryRouter>,
      )
      expect(screen.getByText('加载中...')).toBeTruthy()
      resolveOverview(OVERVIEW)
      await screen.findByText(/3 个订单 · 4 个步骤 · 0 步完成/)
      expect(screen.queryByText('加载中...')).toBeNull()
    })
  })

  describe('维度切换（订单优先 ↔ 日期优先）', () => {
    it('订单优先（默认降序）：记录按开始日期新→旧排序，无开始日期最后', async () => {
      await renderLoaded()

      const records = lastRecords()
      expect(records.map((r) => r.id)).toEqual([
        'q2:q2-s1',           // 2026-09-10（新）
        'q1:q1-s1', 'q1:q1-s2', // 2026-09-02（旧；订单内 stepOrder 升序）
        'q3:q3-s1',           // 无开始日期最后
      ])
      // 无分组头行
      expect(records.every((r) => !r.isDateHeader)).toBe(true)
    })

    it('切换到日期优先：aria-selected 联动，记录插入日期分组头行', async () => {
      await renderLoaded()
      const callsBefore = ganttState.instances[0].recordsCalls.length

      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))

      // 维度切换为纯前端重排：不重新请求数据，仅一次 setRecords
      await waitFor(() => {
        expect(ganttState.instances[0].recordsCalls.length).toBe(callsBefore + 1)
      })
      expect(apiMock.quotes.getProductionTasksOverview).toHaveBeenCalledTimes(1)

      const dateTab = screen.getByRole('tab', { name: /日期优先/ })
      const orderTab = screen.getByRole('tab', { name: /订单优先/ })
      expect(dateTab.getAttribute('aria-selected')).toBe('true')
      expect(orderTab.getAttribute('aria-selected')).toBe('false')

      const records = lastRecords()
      // 按各步骤自身的开始日期分组：q1 两步散布 09-02 / 09-05 两组（不再按订单级日期聚合）
      expect(records.map((r) => r.id)).toEqual([
        'date:2026-09-10', 'q2:q2-s1',
        'date:2026-09-05', 'q1:q1-s2',
        'date:2026-09-02', 'q1:q1-s1',
        'date:none', 'q3:q3-s1',
      ])
      // 分组头行标记 + 甘特区无任务条（计划日期 null）
      const header = records[0]
      expect(header.isDateHeader).toBe(true)
      expect(header.planStart).toBeNull()
      expect(header.planEnd).toBeNull()
      // 分组头左列表字段：日期标题（customerName 列）+ 统计（name 列）+ 日期徽标
      expect(header.customerName).toBe('2026/9/10 周四')
      expect(header.name).toBe('1 单 · 1 步')
      expect(String(header.imageUrl)).toContain('data:image/svg+xml')
      // 图例区维度说明切换为日期优先
      expect(screen.getByText(/日期优先：按步骤开始日期分组（从新到旧）/)).toBeTruthy()
    })

    it('切回订单优先：分组头行移除，恢复任务行序列', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))
      await waitFor(() => expect(lastRecords().some((r) => r.isDateHeader)).toBe(true))

      fireEvent.click(screen.getByRole('tab', { name: /订单优先/ }))
      await waitFor(() => {
        const records = lastRecords()
        expect(records.every((r) => !r.isDateHeader)).toBe(true)
        expect(records.map((r) => r.id)).toEqual(['q2:q2-s1', 'q1:q1-s1', 'q1:q1-s2', 'q3:q3-s1'])
      })
    })

    it('维度偏好持久化到 localStorage，重新进入页面恢复', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))
      await waitFor(() => expect(lastRecords().some((r) => r.isDateHeader)).toBe(true))
      expect(localStorage.getItem('production_tracking_dimension')).toBe('date')

      // 卸载后重新进入（localStorage 保留）
      cleanup()
      ganttState.instances.length = 0
      await renderLoaded()
      expect(screen.getByRole('tab', { name: /日期优先/ }).getAttribute('aria-selected')).toBe('true')
      expect(lastRecords().some((r) => r.isDateHeader)).toBe(true)
    })
  })

  describe('日期排序方向切换', () => {
    it('点击指示器：降序 → 升序，文案与记录顺序即时更新', async () => {
      await renderLoaded()
      const callsBefore = ganttState.instances[0].recordsCalls.length

      fireEvent.click(screen.getByText('日期从新到旧'))

      await waitFor(() => {
        expect(ganttState.instances[0].recordsCalls.length).toBe(callsBefore + 1)
      })
      expect(screen.getByText('日期从旧到新')).toBeTruthy()
      expect(screen.getByText(/订单优先：按开始日期从旧到新排序/)).toBeTruthy()

      // 升序：2026-09-02 在前，无开始日期仍在最后
      expect(lastRecords().map((r) => r.id)).toEqual([
        'q1:q1-s1', 'q1:q1-s2',
        'q2:q2-s1',
        'q3:q3-s1',
      ])
      expect(localStorage.getItem('production_tracking_date_sort')).toBe('asc')
    })

    it('再次点击恢复降序（双向切换）', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByText('日期从新到旧'))
      await waitFor(() => expect(screen.getByText('日期从旧到新')).toBeTruthy())

      fireEvent.click(screen.getByText('日期从旧到新'))
      await waitFor(() => expect(screen.getByText('日期从新到旧')).toBeTruthy())
      expect(lastRecords().map((r) => r.id)).toEqual(['q2:q2-s1', 'q1:q1-s1', 'q1:q1-s2', 'q3:q3-s1'])
      expect(localStorage.getItem('production_tracking_date_sort')).toBe('desc')
    })

    it('日期优先模式下切换排序方向：组序反转，分组头行保留', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))
      await waitFor(() => expect(lastRecords().some((r) => r.isDateHeader)).toBe(true))

      fireEvent.click(screen.getByText('日期从新到旧'))
      await waitFor(() => {
        expect(lastRecords().map((r) => r.id)).toEqual([
          'date:2026-09-02', 'q1:q1-s1',
          'date:2026-09-05', 'q1:q1-s2',
          'date:2026-09-10', 'q2:q2-s1',
          'date:none', 'q3:q3-s1',
        ])
      })
      expect(screen.getByText(/日期优先：按步骤开始日期分组（从旧到新）/)).toBeTruthy()
    })

    it('排序偏好持久化到 localStorage，重新进入页面恢复', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByText('日期从新到旧'))
      await waitFor(() => expect(localStorage.getItem('production_tracking_date_sort')).toBe('asc'))

      cleanup()
      ganttState.instances.length = 0
      await renderLoaded()
      expect(screen.getByText('日期从旧到新')).toBeTruthy()
      expect(lastRecords().map((r) => r.id)).toEqual([
        'q1:q1-s1', 'q1:q1-s2', 'q2:q2-s1', 'q3:q3-s1',
      ])
    })
  })

  describe('无效持久化值的防御', () => {
    it('localStorage 存在非法值时回退默认（订单优先 + 降序）', async () => {
      localStorage.setItem('production_tracking_dimension', 'invalid')
      localStorage.setItem('production_tracking_date_sort', 'wrong')
      await renderLoaded()

      expect(screen.getByRole('tab', { name: /订单优先/ }).getAttribute('aria-selected')).toBe('true')
      expect(screen.getByText('日期从新到旧')).toBeTruthy()
      expect(lastRecords().map((r) => r.id)).toEqual(['q2:q2-s1', 'q1:q1-s1', 'q1:q1-s2', 'q3:q3-s1'])
    })
  })

  describe('日期分组头内容（按步骤开始日期分组）', () => {
    it('scheduleCreatable 按行控制：分组头行禁止创建排期，普通步骤行（含无日期步骤）允许', async () => {
      await renderLoaded()
      const gantt = ganttState.instances[0]
      const creatable = gantt.options.taskBar.scheduleCreatable
      expect(typeof creatable).toBe('function')
      // 分组头行（日期优先模式的分组头 record）：不显示「+」创建按钮（不属于任何订单，避免误解）
      expect(creatable({ taskRecord: { isDateHeader: true } })).toBe(false)
      // 普通步骤行（含无日期步骤）：显示「+」创建按钮，点击后单日排期
      expect(creatable({ taskRecord: { isDateHeader: false } })).toBe(true)
      expect(creatable({ taskRecord: {} })).toBe(true)
    })

    it('分组头徽标为日期徽标图，统计字段正确；同订单步骤散布各自日期组', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))
      await waitFor(() => expect(lastRecords().some((r) => r.isDateHeader)).toBe(true))

      const records = lastRecords()
      const headers = records.filter((r) => r.isDateHeader)
      // q1 的两个步骤分别落入 09-02 / 09-05 两组（步骤级分组，非订单级）
      expect(records.map((r) => r.id)).toEqual([
        'date:2026-09-10', 'q2:q2-s1',
        'date:2026-09-05', 'q1:q1-s2',
        'date:2026-09-02', 'q1:q1-s1',
        'date:none', 'q3:q3-s1',
      ])
      // 2026-09-10 组：徽标含日号 10；统计 1 单 · 1 步
      const h0910 = headers.find((h) => h.id === 'date:2026-09-10')!
      expect(decodeURIComponent(String(h0910.imageUrl))).toContain('>10<')
      expect(h0910.name).toBe('1 单 · 1 步')
      expect(h0910.customerName).toBe('2026/9/10 周四')
      // 2026-09-05 组：q1 第二步所在组（1 单 · 1 步）
      const h0905 = headers.find((h) => h.id === 'date:2026-09-05')!
      expect(h0905.name).toBe('1 单 · 1 步')
      expect(h0905.customerName).toBe('2026/9/5 周六')
      // 无开始日期组：显示「无」徽标
      const hNone = headers.find((h) => h.id === 'date:none')!
      expect(decodeURIComponent(String(hNone.imageUrl))).toContain('>无<')
      expect(hNone.customerName).toBe('无开始日期')
    })
  })

  describe('分组头行添加步骤（修复：分组行无法新增）', () => {
    /** 触发甘特图左列表事件（click_cell），originData 为行 record */
    function emitListEvent(type: string, originData: any) {
      const gantt = ganttState.instances[0]
      const listeners = (gantt.taskListTableInstance as any).listeners.get(type) ?? []
      listeners.forEach((fn: any) => fn({ originData }))
    }

    /** 切换到日期优先维度并等待分组头行出现 */
    async function switchToDateDim() {
      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))
      await waitFor(() => expect(lastRecords().some((r) => r.isDateHeader)).toBe(true))
    }

    it('分组头 record 携带组内第一个任务行定位（firstQuoteId/firstTaskId）', async () => {
      await renderLoaded()
      await switchToDateDim()

      const records = lastRecords()
      const h0910 = records.find((r) => r.id === 'date:2026-09-10')!
      expect(h0910.firstQuoteId).toBe('q2')
      expect(h0910.firstTaskId).toBe('q2-s1')
      // quoteId/taskId 本身为空：双击分组头行不打开订单
      expect(h0910.quoteId).toBe('')
      expect(h0910.taskId).toBe('')
      const hNone = records.find((r) => r.id === 'date:none')!
      expect(hNone.firstQuoteId).toBe('q3')
      expect(hNone.firstTaskId).toBe('q3-s1')
    })

    it('点击日期分组头行：选中组内第一个步骤，「添加步骤」按钮变为可用', async () => {
      await renderLoaded()
      await switchToDateDim()

      // 初始未选中任何步骤 → 按钮禁用
      const addBtn = () => screen.getByRole('button', { name: /添加步骤/ }) as HTMLButtonElement
      expect(addBtn().disabled).toBe(true)

      // 点击 09-10 分组头行 → 选中组内第一个步骤（q2-s1 印花）
      emitListEvent('click_cell', lastRecords().find((r) => r.id === 'date:2026-09-10'))
      await waitFor(() => expect(addBtn().disabled).toBe(false))
      // 详情编辑区显示所选步骤（q2 第 1/1 步 · 印花）
      expect(screen.getByText('A001 · 客户A · 第 1/1 步')).toBeTruthy()
    })

    it('日期优先：点击分组头行后添加步骤 → 新步骤继承组日期，出现在同一日期组', async () => {
      await renderLoaded()
      await switchToDateDim()

      // 点击 09-10 分组头行 → 添加步骤
      emitListEvent('click_cell', lastRecords().find((r) => r.id === 'date:2026-09-10'))
      await waitFor(() => expect((screen.getByRole('button', { name: /添加步骤/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /添加步骤/ }))

      // 新步骤继承所选步骤（q2-s1）的开始日期 2026-09-10（单日排期）→ 出现在同一分组
      await waitFor(() => {
        const records = lastRecords()
        expect(records[0].id).toBe('date:2026-09-10')
        expect(records[0].name).toBe('1 单 · 2 步')
        expect(records[1].id).toBe('q2:q2-s1')
        expect(String(records[2].id).startsWith('q2:tmp-')).toBe(true)
        expect(records[2].planStart).toBe('2026-09-10')
        expect(records[2].planEnd).toBe('2026-09-10')
        // 其余分组不受影响
        expect(records[3].id).toBe('date:2026-09-05')
      })
      // 添加后自动选中新步骤（q2 第 2/2 步）
      expect(screen.getByText('A001 · 客户A · 第 2/2 步')).toBeTruthy()
    })

    it('日期优先：无开始日期组的分组头添加步骤 → 新步骤无日期，留在「无开始日期」组', async () => {
      await renderLoaded()
      await switchToDateDim()

      emitListEvent('click_cell', lastRecords().find((r) => r.id === 'date:none'))
      await waitFor(() => expect((screen.getByRole('button', { name: /添加步骤/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /添加步骤/ }))

      await waitFor(() => {
        const records = lastRecords()
        const noneIdx = records.findIndex((r) => r.id === 'date:none')
        expect(records[noneIdx].name).toBe('1 单 · 2 步')
        expect(records[noneIdx + 1].id).toBe('q3:q3-s1')
        expect(String(records[noneIdx + 2].id).startsWith('q3:tmp-')).toBe(true)
        expect(records[noneIdx + 2].planStart).toBeNull()
      })
    })

    it('日期优先：添加后新步骤经防抖同步保存（PUT payload 含继承日期的新步骤）', async () => {
      await renderLoaded()
      await switchToDateDim()

      emitListEvent('click_cell', lastRecords().find((r) => r.id === 'date:2026-09-10'))
      await waitFor(() => expect((screen.getByRole('button', { name: /添加步骤/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /添加步骤/ }))

      // 防抖 600ms 后调用保存接口，payload 中包含继承日期的新步骤
      await vi.waitFor(() => {
        expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalled()
      }, { timeout: 2000 })
      const payload = apiMock.quotes.saveProductionTasks.mock.calls[0][1]
      const appended = (payload.tasks ?? payload).find?.((t: any) => t?.name === '新步骤')
        ?? (Array.isArray(payload) ? payload.find((t: any) => t?.name === '新步骤') : undefined)
      expect(appended?.planStart).toBe('2026-09-10')
      expect(appended?.planEnd).toBe('2026-09-10')
    })

    it('订单优先：点击任务行添加步骤保持原行为（新步骤无默认日期）', async () => {
      await renderLoaded()

      // 订单优先模式下点击任务行（q2-s1）→ 添加步骤
      emitListEvent('click_cell', { quoteId: 'q2', taskId: 'q2-s1' })
      await waitFor(() => expect((screen.getByRole('button', { name: /添加步骤/ }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: /添加步骤/ }))

      await waitFor(() => {
        const newRec = lastRecords().find((r) => String(r.id).startsWith('q2:tmp-'))
        expect(newRec).toBeTruthy()
        expect(newRec.planStart).toBeNull()
        expect(newRec.planEnd).toBeNull()
      })
    })
  })

  describe('空白行创建排期（CREATE_TASK_SCHEDULE，修复：分组行不能设置排期）', () => {
    /** 触发甘特图事件 */
    function emitGanttEvent(type: string, args: any) {
      const gantt = ganttState.instances[0]
      const listeners = gantt.listeners.get(type) ?? []
      listeners.forEach((fn: any) => fn(args))
    }

    it('日期优先：无日期步骤行创建排期 → 离开「无开始日期」组进入新日期组，并防抖保存', async () => {
      await renderLoaded()
      fireEvent.click(screen.getByRole('tab', { name: /日期优先/ }))
      await waitFor(() => expect(lastRecords().some((r) => r.isDateHeader)).toBe(true))

      // q3-s1（等待排期，无日期）在空白行点击「+」，于 2026-09-15 创建单日排期
      emitGanttEvent('create_task_schedule', {
        record: { quoteId: 'q3', taskId: 'q3-s1' },
        startDate: '2026-09-15',
        endDate: '2026-09-15',
      })

      // q3-s1 离开「无开始日期」组，新组 2026-09-15 排最前（降序）；
      // 防抖保存响应回填会替换服务端 id，故用前缀定位 q3 的行
      await waitFor(() => {
        const records = lastRecords()
        expect(records[0].id).toBe('date:2026-09-15')
        expect(String(records[1].id).startsWith('q3:')).toBe(true)
        expect(records[1].planStart).toBe('2026-09-15')
        expect(records[1].planEnd).toBe('2026-09-15')
        expect(records[2].id).toBe('date:2026-09-10')
        expect(records[3].id).toBe('q2:q2-s1')
        expect(records[4].id).toBe('date:2026-09-05')
        expect(records[5].id).toBe('q1:q1-s2')
        expect(records[6].id).toBe('date:2026-09-02')
        expect(records[7].id).toBe('q1:q1-s1')
        // 「无开始日期」组消失（q3 唯一步骤已有日期）
        expect(records.some((r) => r.id === 'date:none')).toBe(false)
      })

      // 防抖保存：payload 中 q3 步骤带新计划日期
      await vi.waitFor(() => {
        expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalled()
      }, { timeout: 2000 })
      const payload = apiMock.quotes.saveProductionTasks.mock.calls[0][1]
      const task = (payload.tasks ?? payload).find?.((t: any) => t?.name === '等待排期')
        ?? (Array.isArray(payload) ? payload.find((t: any) => t?.name === '等待排期') : undefined)
      expect(task?.planStart).toBe('2026-09-15')
      expect(task?.planEnd).toBe('2026-09-15')
    })

    it('订单优先：无日期步骤行创建排期 → 任务条出现在对应位置', async () => {
      await renderLoaded()

      emitGanttEvent('create_task_schedule', {
        record: { quoteId: 'q3', taskId: 'q3-s1' },
        startDate: '2026-09-15',
        endDate: '2026-09-16',
      })

      // 防抖保存响应回填会替换服务端 id，用前缀定位 q3 的行
      await waitFor(() => {
        const rec = lastRecords().find((r) => String(r.id).startsWith('q3:'))
        expect(rec).toBeTruthy()
        expect(rec.planStart).toBe('2026-09-15')
        expect(rec.planEnd).toBe('2026-09-16')
      })
    })

    it('非法事件参数（缺 quoteId/日期倒置）被忽略，不触发保存', async () => {
      await renderLoaded()

      emitGanttEvent('create_task_schedule', {
        record: { taskId: 'q3-s1' }, // 缺 quoteId
        startDate: '2026-09-15',
        endDate: '2026-09-15',
      })
      emitGanttEvent('create_task_schedule', {
        record: { quoteId: 'q3', taskId: 'q3-s1' },
        startDate: '2026-09-16',
        endDate: '2026-09-15', // 开始 > 结束
      })

      const rec = lastRecords().find((r) => r.id === 'q3:q3-s1')
      expect(rec.planStart).toBeNull()
      // 600ms 防抖 + 余量后仍未保存
      await new Promise((r) => setTimeout(r, 900))
      expect(apiMock.quotes.saveProductionTasks).not.toHaveBeenCalled()
    })
  })
})
