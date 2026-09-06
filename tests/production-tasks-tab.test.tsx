/**
 * 订单做货流程标签页（ProductionTasksTab.tsx）组件测试
 *
 * 测试目标（v24 新功能）：
 *   1. 数据加载：任务列表渲染、汇总信息、空数据初始化默认 6 步、加载失败提示
 *   2. 权限控制：readOnly 模式隐藏编辑按钮与同步徽标、甘特图容器禁用交互
 *   3. 状态提示：orderStatus < 3 预排期提示、全部完成提示
 *   4. 一键排期：无日期报错、有日期均分排期并触发保存
 *   5. 任务编辑：点击任务条选中、改名称/实际时间状态联动、上移/下移/删除、添加步骤
 *   6. 材料准备：添加/修改/勾选/删除
 *   7. 双向同步：600ms debounce 自动保存、手动保存、保存失败徽标
 *
 * Mock 说明：
 *   - api：隔离网络
 *   - @visactor/vtable-gantt：jsdom 无法运行真实甘特图，替换为可触发事件的假实例
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ProductionTasksTab from '../src/components/ProductionTasksTab'
import { toDateStr, computeInitialFocusDate } from '../src/services/productionTasks'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  quotes: {
    getProductionTasks: vi.fn(),
    saveProductionTasks: vi.fn(),
  },
}))

/** 甘特图 mock 实例共享状态（测试需要拿到实例触发事件） */
const ganttState = vi.hoisted(() => ({ instances: [] as any[] }))

vi.mock('../src/api', () => ({ api: apiMock }))

vi.mock('@visactor/vtable-gantt', () => {
  /** 左侧任务列表 mock（taskListTableInstance）：支持 on/emit click_cell */
  class MockListTable {
    listeners = new Map<string, any[]>()
    on(type: string, listener: any) {
      if (!this.listeners.has(type)) this.listeners.set(type, [])
      this.listeners.get(type)!.push(listener)
    }
    emit(type: string, args: any) {
      for (const listener of this.listeners.get(type) || []) listener(args)
    }
  }
  class MockGantt {
    container: any
    options: any
    listeners = new Map<string, any[]>()
    released = false
    scrolledTo: Date[] = []
    taskListTableInstance: MockListTable
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
    /** 测试辅助：触发指定事件 */
    emit(type: string, args: any) {
      for (const listener of this.listeners.get(type) || []) listener(args)
    }
    setRecords(_records: any) { /* no-op */ }
    updateOption(options: any) { this.options = options }
    scrollToMarkLine(date: Date) { this.scrolledTo.push(date) }
    release() { this.released = true }
  }
  return {
    Gantt: MockGantt,
    TYPES: {
      GANTT_EVENT_TYPE: {
        MOVE_END_TASK_BAR: 'move_end_task_bar',
        CHANGE_DATE_RANGE: 'change_date_range',
        CLICK_TASK_BAR: 'click_task_bar',
      },
    },
  }
})

// ============================ 测试数据 ============================

const TASKS = [
  {
    id: 'pt-1', stepOrder: 1, name: '面料采购',
    planStart: '2026-09-01', planEnd: '2026-09-02',
    actualStart: '2026-09-01', actualEnd: null,
    status: 1, remark: '',
    materials: [{ name: '白坯布', spec: '10安', quantity: 100, unit: 'kg', ready: true }],
  },
  {
    id: 'pt-2', stepOrder: 2, name: '裁剪',
    planStart: '2026-09-03', planEnd: '2026-09-05',
    actualStart: null, actualEnd: null,
    status: 0, remark: '', materials: [],
  },
]

const DEFAULT_PROPS = {
  quoteId: 'quote-1',
  readOnly: false,
  orderStatus: 3,
  productionTimeStart: '2026-09-01',
  productionTimeEnd: '2026-09-12',
}

function renderTab(props: Partial<typeof DEFAULT_PROPS> = {}) {
  return render(<ProductionTasksTab {...DEFAULT_PROPS} {...props} />)
}

/** 等待加载完成（图例仅在非 loading 时渲染） */
async function waitLoaded() {
  await screen.findByText(/计划（可拖拽移动/)
}

// ============================ 测试用例 ============================

describe('订单做货流程标签页', () => {
  beforeEach(() => {
    apiMock.quotes.getProductionTasks.mockReset()
    apiMock.quotes.saveProductionTasks.mockReset()
    apiMock.quotes.getProductionTasks.mockResolvedValue(TASKS)
    apiMock.quotes.saveProductionTasks.mockImplementation(async (_id: string, tasks: any[]) => tasks)
    ganttState.instances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  describe('数据加载与渲染', () => {
    it('加载任务并渲染标题、汇总、甘特图实例与图例', async () => {
      renderTab()
      await waitLoaded()

      expect(apiMock.quotes.getProductionTasks).toHaveBeenCalledWith('quote-1')
      expect(screen.getByText('订单做货流程')).toBeTruthy()
      // 汇总：0/2 完成（status 1/0 均不计入完成）· 材料 1/1 备齐
      expect(screen.getByText(/0\/2 步完成/)).toBeTruthy()
      expect(screen.getByText(/材料 1\/1 备齐/)).toBeTruthy()
      // 甘特图 mock 实例已创建，初始视口定位到「今天 vs 最早计划开始」中较早者（rAF 后触发）
      expect(ganttState.instances).toHaveLength(1)
      const gantt = ganttState.instances[0]
      await waitFor(() => expect(gantt.scrolledTo).toHaveLength(1))
      expect(toDateStr(gantt.scrolledTo[0])).toBe(toDateStr(computeInitialFocusDate(TASKS)))
      expect(screen.getByText('实际执行')).toBeTruthy()
      expect(screen.getByText('已完成计划')).toBeTruthy()
      // 回归：barStyle 为函数时返回值不与库默认样式合并，缺少 width（条高）会导致
      // 任务条 y=NaN/height=undefined 而整体不可见（vtable-gantt 1.26.6 行为）
      const barStyle = gantt.options.taskBar.barStyle
      expect(typeof barStyle).toBe('function')
      const style0 = barStyle({ index: 0, taskRecord: TASKS[0] })
      const style1 = barStyle({ index: 1, taskRecord: TASKS[1] })
      expect(style0.width).toBe(30)
      expect(style0.barColor).toBe('#2563eb') // 进行中
      expect(style1.barColor).toBe('#60a5fa') // 未开始
    })

    it('空数据时初始化默认 6 步（内存态）', async () => {
      apiMock.quotes.getProductionTasks.mockResolvedValue([])
      renderTab()
      await waitLoaded()

      expect(screen.getByText(/0\/6 步完成/)).toBeTruthy()
      expect(screen.getByText('未修改')).toBeTruthy()
    })

    it('加载失败显示错误提示', async () => {
      apiMock.quotes.getProductionTasks.mockRejectedValue(new Error('network'))
      renderTab()
      await waitFor(() => expect(screen.getByText('做货流程加载失败，请刷新重试')).toBeTruthy())
    })
  })

  describe('readOnly 与状态提示', () => {
    it('readOnly：隐藏编辑按钮与徽标', async () => {
      renderTab({ readOnly: true })
      await waitLoaded()

      expect(screen.queryByText('一键排期')).not.toBeTruthy()
      expect(screen.queryByText('添加步骤')).not.toBeTruthy()
      expect(screen.queryByText('保存')).not.toBeTruthy()
      expect(screen.queryByText('未修改')).not.toBeTruthy()
    })

    it('orderStatus < 3：显示预排期提示', async () => {
      renderTab({ orderStatus: 1 })
      await waitLoaded()
      expect(screen.getByText(/做货尚未开始，当前为预排期/)).toBeTruthy()
    })

    it('orderStatus = 3：无预排期提示；全部完成时显示流转提示', async () => {
      renderTab()
      await waitLoaded()
      expect(screen.queryByText(/预排期/)).not.toBeTruthy()

      cleanup()
      apiMock.quotes.getProductionTasks.mockResolvedValue(
        TASKS.map((t) => ({ ...t, status: 2 })),
      )
      renderTab()
      await waitLoaded()
      expect(screen.getByText(/做货流程已全部完成/)).toBeTruthy()
    })
  })

  describe('一键排期', () => {
    it('缺少做货日期时提示错误', async () => {
      renderTab({ productionTimeStart: '', productionTimeEnd: '' })
      await waitLoaded()
      fireEvent.click(screen.getByText('一键排期'))
      expect(screen.getByText('一键排期需要先填写订单的做货开始与结束日期')).toBeTruthy()
      expect(apiMock.quotes.saveProductionTasks).not.toHaveBeenCalled()
    })

    it('按区间均分排期并自动保存', async () => {
      renderTab()
      await waitLoaded()
      vi.useFakeTimers()
      fireEvent.click(screen.getByText('一键排期'))
      await vi.advanceTimersByTimeAsync(700)

      expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalledTimes(1)
      const saved = apiMock.quotes.saveProductionTasks.mock.calls[0][1]
      // 12 天 / 2 任务：09-01~09-06 与 09-07~09-12
      expect(saved[0]).toMatchObject({ planStart: '2026-09-01', planEnd: '2026-09-06' })
      expect(saved[1]).toMatchObject({ planStart: '2026-09-07', planEnd: '2026-09-12' })
    })
  })

  describe('任务详情编辑', () => {
    /** 选中第一个任务并等待详情区出现 */
    async function selectFirstTask() {
      const gantt = ganttState.instances[ganttState.instances.length - 1]
      await act(async () => {
        gantt.emit('click_task_bar', { record: { id: 'pt-1' } })
      })
      return screen.findByText('步骤详情')
    }

    it('点击任务条显示详情编辑区', async () => {
      renderTab()
      await waitLoaded()
      await selectFirstTask()

      expect(screen.getByDisplayValue('面料采购')).toBeTruthy()
      expect(screen.getByText('计划开始')).toBeTruthy()
      expect(screen.getByText('实际开始')).toBeTruthy()
      expect(screen.getByText('材料准备')).toBeTruthy()
    })

    it('点击左侧任务列表行同样联动选中', async () => {
      renderTab()
      await waitLoaded()
      const gantt = ganttState.instances[ganttState.instances.length - 1]
      await act(async () => {
        gantt.taskListTableInstance.emit('click_cell', { originData: { id: 'pt-2' } })
      })
      await screen.findByText('步骤详情')
      expect(screen.getByDisplayValue('裁剪')).toBeTruthy()
    })

    it('填写实际开始时间后状态联动为进行中', async () => {
      renderTab()
      await waitLoaded()
      await selectFirstTask()

      // 详情区日期输入顺序：计划开始 / 计划结束 / 实际开始 / 实际结束
      const dateInputs = document.querySelectorAll('input[type="date"]')
      expect((dateInputs[2] as HTMLInputElement).value).toBe('2026-09-01')

      // 清空实际开始 → 状态回退未开始
      fireEvent.change(dateInputs[2], { target: { value: '' } })
      await waitFor(() => expect((screen.getByDisplayValue('未开始') as HTMLSelectElement).value).toBe('0'))

      // 重新填写 → 状态联动为进行中
      fireEvent.change(dateInputs[2], { target: { value: '2026-09-02' } })
      await waitFor(() => expect((screen.getByDisplayValue('进行中') as HTMLSelectElement).value).toBe('1'))
    })

    it('上移/下移调整步骤顺序', async () => {
      renderTab()
      await waitLoaded()
      // 选中第二个任务（裁剪）
      const gantt = ganttState.instances[ganttState.instances.length - 1]
      await act(async () => {
        gantt.emit('click_task_bar', { record: { id: 'pt-2' } })
      })
      await screen.findByText('步骤详情')

      // 上移后选中项（idx 0）为「裁剪」
      fireEvent.click(screen.getByTitle('上移'))
      await waitFor(() => expect(screen.getByDisplayValue('裁剪')).toBeTruthy())
      // 已到顶部：上移禁用
      expect((screen.getByTitle('上移') as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByTitle('下移') as HTMLButtonElement).disabled).toBe(false)
    })

    it('删除步骤后详情区关闭', async () => {
      renderTab()
      await waitLoaded()
      await selectFirstTask()

      fireEvent.click(screen.getByTitle('删除步骤'))
      await waitFor(() => expect(screen.queryByText('步骤详情')).not.toBeTruthy())
      expect(screen.getByText(/0\/1 步完成/)).toBeTruthy()
    })

    it('添加步骤：新增「新步骤」并选中', async () => {
      renderTab()
      await waitLoaded()
      fireEvent.click(screen.getByText('添加步骤'))

      expect(await screen.findByDisplayValue('新步骤')).toBeTruthy()
      expect(screen.getByText(/0\/3 步完成/)).toBeTruthy()
    })

    it('编辑名称后 600ms debounce 自动保存', async () => {
      renderTab()
      await waitLoaded()
      await selectFirstTask()

      vi.useFakeTimers()
      fireEvent.change(screen.getByDisplayValue('面料采购'), { target: { value: '面料采购加急' } })
      expect(apiMock.quotes.saveProductionTasks).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(700)
      expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalledTimes(1)
      const saved = apiMock.quotes.saveProductionTasks.mock.calls[0][1]
      expect(saved[0].name).toBe('面料采购加急')
    })
  })

  describe('甘特图拖拽/拉伸同步', () => {
    // 真实库行为：change_date_range 事件的 startDate/endDate 为库 formatDate 后的
    // 'yyyy-mm-dd' 字符串（非 Date），移动与拉伸结束均触发此事件
    it('拖拽移动任务条（change_date_range）更新计划时间并保存', async () => {
      renderTab()
      await waitLoaded()
      const gantt = ganttState.instances[ganttState.instances.length - 1]

      vi.useFakeTimers()
      await act(async () => {
        gantt.emit('change_date_range', {
          record: { id: 'pt-1' },
          startDate: '2026-09-10',
          endDate: '2026-09-12',
        })
      })
      await vi.advanceTimersByTimeAsync(700)

      expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalledTimes(1)
      const saved = apiMock.quotes.saveProductionTasks.mock.calls[0][1]
      expect(saved[0]).toMatchObject({ planStart: '2026-09-10', planEnd: '2026-09-12' })
    })

    it('拉伸任务条两端调整时长（change_date_range）更新计划时间并保存', async () => {
      renderTab()
      await waitLoaded()
      const gantt = ganttState.instances[ganttState.instances.length - 1]

      vi.useFakeTimers()
      await act(async () => {
        // 拉伸右端缩短时长：09-03 ~ 09-05 → 09-03 ~ 09-04
        gantt.emit('change_date_range', {
          record: { id: 'pt-2' },
          startDate: '2026-09-03',
          endDate: '2026-09-04',
        })
      })
      await vi.advanceTimersByTimeAsync(700)

      expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalledTimes(1)
      const saved = apiMock.quotes.saveProductionTasks.mock.calls[0][1]
      expect(saved[1]).toMatchObject({ planStart: '2026-09-03', planEnd: '2026-09-04' })
    })

    it('事件日期非法（非 yyyy-mm-dd）时不更新不保存', async () => {
      renderTab()
      await waitLoaded()
      const gantt = ganttState.instances[ganttState.instances.length - 1]

      await act(async () => {
        gantt.emit('change_date_range', {
          record: { id: 'pt-1' },
          startDate: 'invalid-date',
          endDate: '2026-09-12',
        })
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(apiMock.quotes.saveProductionTasks).not.toHaveBeenCalled()
    })

    it('readOnly 拖拽/拉伸不触发保存', async () => {
      renderTab({ readOnly: true })
      await waitLoaded()
      const gantt = ganttState.instances[ganttState.instances.length - 1]

      await act(async () => {
        gantt.emit('change_date_range', {
          record: { id: 'pt-1' },
          startDate: '2026-09-10',
          endDate: '2026-09-12',
        })
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(apiMock.quotes.saveProductionTasks).not.toHaveBeenCalled()
    })
  })

  describe('材料准备', () => {
    async function openMaterials() {
      renderTab()
      await waitLoaded()
      const gantt = ganttState.instances[ganttState.instances.length - 1]
      await act(async () => {
        gantt.emit('click_task_bar', { record: { id: 'pt-1' } })
      })
      await screen.findByText('材料准备')
    }

    it('展示已有材料并支持勾选备齐', async () => {
      await openMaterials()
      expect(screen.getByDisplayValue('白坯布')).toBeTruthy()
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    })

    it('添加/修改/删除材料', async () => {
      await openMaterials()
      fireEvent.click(screen.getByText('+ 材料'))
      const nameInputs = screen.getAllByPlaceholderText('名称')
      expect(nameInputs).toHaveLength(2)

      fireEvent.change(nameInputs[1], { target: { value: '油墨' } })
      fireEvent.click(screen.getAllByTitle('删除材料')[1])
      await waitFor(() => expect(screen.getAllByPlaceholderText('名称')).toHaveLength(1))
    })
  })

  describe('保存与状态徽标', () => {
    it('手动保存按钮立即触发 PUT', async () => {
      renderTab()
      await waitLoaded()
      fireEvent.click(screen.getByText('保存'))
      await waitFor(() => expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalledTimes(1))
      await screen.findByText('已保存')
    })

    it('保存失败显示错误徽标，可重试', async () => {
      renderTab()
      await waitLoaded()
      apiMock.quotes.saveProductionTasks.mockRejectedValueOnce(new Error('save failed'))

      fireEvent.click(screen.getByText('保存'))
      await screen.findByText('保存失败，点击保存重试')

      apiMock.quotes.saveProductionTasks.mockClear()
      fireEvent.click(screen.getByText('保存'))
      await waitFor(() => expect(apiMock.quotes.saveProductionTasks).toHaveBeenCalledTimes(1))
    })
  })
})
