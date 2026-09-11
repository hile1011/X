/**
 * 产品成本项配置 - 列表查询页（ProductCostItemList）单元测试
 *
 * 测试目标：
 *   1. 纯函数：filterCostTree（模糊查询/多条件 AND/大小写不敏感）、buildTreeRows（树扁平化/子表头行/折叠/强制展开）、
 *      computeVisibleRange（虚拟滚动窗口）、formatDateTime
 *   2. 组件：父级表头置顶 + 子级表头随各子列表内嵌（含各成本项独立配置的自定义字段名/值）、
 *      默认完全展开、折叠交互（单节点 + 全部收起/展开）、
 *      模糊查询实时过滤 + 命中高亮 + 统计反馈 + 无结果反馈、双击/详情按钮跳转、权限控制、
 *      虚拟滚动（大列表仅渲染可视窗口行）
 *
 * Mock 策略：api / usePermission；MemoryRouter 包裹（页面使用 useNavigate）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProductCostItemList, {
  filterCostTree,
  buildTreeRows,
  computeVisibleRange,
  formatDateTime,
} from '../src/pages/ProductCostItemList'
import type { ProductCostItem } from '../src/types'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  productCostItems: {
    getAll: vi.fn(),
    createItem: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemCheck: vi.fn(),
    deleteProcess: vi.fn(),
    deleteProcessCheck: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({ api: apiMock }))

const permissionMock = vi.hoisted(() => ({ hasPermission: (_perm: string) => true }))
vi.mock('../src/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: (p: string) => permissionMock.hasPermission(p) }),
}))

// ============================ 测试数据 ============================

function makeProcess(id: string, name: string, cost: number, itemId: string) {
  return {
    id, costItemId: itemId, name, cost, formula: '', features: '', remark: '',
    customValues: {}, sortOrder: 1, createdAt: '2026-09-01T08:00:00', updatedAt: '2026-09-01T08:00:00',
  }
}

function makeItem(id: string, name: string, processes: ReturnType<typeof makeProcess>[] = []): ProductCostItem {
  return {
    id, name, sortOrder: 1, processes, fields: [],
    createdAt: '2026-09-01T08:00:00', updatedAt: '2026-09-02T10:30:00',
  }
}

const mockItems: ProductCostItem[] = [
  {
    ...makeItem('pci-1', '印刷成本', [
      { ...makeProcess('pcp-1', 'UV印刷', 0.5, 'pci-1'), formula: '面积×单价', features: '色彩还原度高', customValues: { 'pcf-1': '4色' } },
      makeProcess('pcp-2', '热转印', 0.8, 'pci-1'),
    ]),
    fields: [
      { id: 'pcf-1', costItemId: 'pci-1', name: '色数', fieldType: 'number' as const, options: [], visible: true, sortOrder: 1, createdAt: '', updatedAt: '' },
    ],
  },
  {
    ...makeItem('pci-2', '布料成本', [
      { ...makeProcess('pcp-3', '数码印花', 1.2, 'pci-2'), customValues: { 'pcf-2': '180', 'pcf-3': '150cm' } },
    ]),
    fields: [
      { id: 'pcf-2', costItemId: 'pci-2', name: '克重', fieldType: 'number' as const, options: [], visible: true, sortOrder: 1, createdAt: '', updatedAt: '' },
      { id: 'pcf-3', costItemId: 'pci-2', name: '门幅', fieldType: 'text' as const, options: [], visible: true, sortOrder: 2, createdAt: '', updatedAt: '' },
      { id: 'pcf-4', costItemId: 'pci-2', name: '隐匿字段', fieldType: 'text' as const, options: [], visible: false, sortOrder: 3, createdAt: '', updatedAt: '' },
    ],
  },
]

// ============================ 渲染辅助 ============================

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/product-cost-items']}>
      <Routes>
        <Route path="/product-cost-items" element={<ProductCostItemList />} />
        <Route path="/product-cost-items/:id" element={<div data-testid="detail-page">detail</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionMock.hasPermission = () => true
  apiMock.productCostItems.getAll.mockResolvedValue(mockItems)
})

afterEach(() => {
  cleanup()
})

/**
 * 名称单元格查询：命中高亮会把名称拆分到 mark/span 多个元素，
 * getByText 无法匹配，统一走组件渲染的 data-name 属性定位。
 */
const queryName = (name: string): Element | null => document.querySelector(`[data-name="${name}"]`)

// ============================ 纯函数：filterCostTree ============================

describe('filterCostTree - 模糊查询过滤', () => {
  it('无查询条件时返回原数组', () => {
    expect(filterCostTree(mockItems, '', '')).toEqual(mockItems)
    expect(filterCostTree(mockItems, '  ', ' ')).toEqual(mockItems)
  })

  it('按成本项名称过滤（子级全量保留）', () => {
    const result = filterCostTree(mockItems, '布料', '')
    expect(result.map((i) => i.id)).toEqual(['pci-2'])
    // 命中成本项展示其全部工艺
    expect(result[0].processes.map((p) => p.id)).toEqual(['pcp-3'])
  })

  it('按工艺名称过滤（父项保留，未命中工艺隐藏）', () => {
    const result = filterCostTree(mockItems, '', 'uv')
    expect(result.map((i) => i.id)).toEqual(['pci-1'])
    expect(result[0].processes.map((p) => p.id)).toEqual(['pcp-1'])
  })

  it('工艺命中的父项保留（即使成本项名称不匹配）', () => {
    const result = filterCostTree(mockItems, '', '数码印花')
    expect(result.map((i) => i.id)).toEqual(['pci-2'])
  })

  it('多条件 AND 组合：成本项与工艺都命中才保留，工艺按条件过滤', () => {
    const result = filterCostTree(mockItems, '印刷', '热转')
    expect(result.map((i) => i.id)).toEqual(['pci-1'])
    expect(result[0].processes.map((p) => p.id)).toEqual(['pcp-2'])
  })

  it('组合查询：成本项命中但无工艺命中时整体隐藏（AND 语义）', () => {
    const result = filterCostTree(mockItems, '印刷', '数码印花')
    expect(result).toEqual([])
  })

  it('大小写不敏感匹配', () => {
    expect(filterCostTree(mockItems, 'PRINT', '')).toHaveLength(0)
    const byProcess = filterCostTree(mockItems, '', 'uv')
    expect(byProcess).toHaveLength(1)
  })
})

// ============================ 纯函数：buildTreeRows ============================

describe('buildTreeRows - 树形扁平化', () => {
  it('默认（空折叠集合）完全展开：父行 → 子表头 → 工艺行交错', () => {
    const rows = buildTreeRows(mockItems, new Set())
    expect(rows.map((r) => r.kind)).toEqual([
      'item', 'subheader', 'process', 'process',
      'item', 'subheader', 'process',
    ])
    expect(rows[1].item.id).toBe('pci-1')
    expect(rows[2].process?.id).toBe('pcp-1')
  })

  it('折叠的成本项隐藏其子表头与工艺行', () => {
    const rows = buildTreeRows(mockItems, new Set(['pci-1']))
    expect(rows.map((r) => r.kind)).toEqual(['item', 'item', 'subheader', 'process'])
    expect(rows.filter((r) => r.kind === 'item').map((r) => r.item.id)).toEqual(['pci-1', 'pci-2'])
  })

  it('forceExpand 覆盖折叠状态（查询激活时）', () => {
    const rows = buildTreeRows(mockItems, new Set(['pci-1', 'pci-2']), true)
    expect(rows.map((r) => r.kind)).toEqual([
      'item', 'subheader', 'process', 'process',
      'item', 'subheader', 'process',
    ])
  })

  it('无工艺的成本项不渲染子表头（无数据可标注）', () => {
    const rows = buildTreeRows([makeItem('pci-x', '空成本项')], new Set())
    expect(rows.map((r) => r.kind)).toEqual(['item'])
  })

  it('空数组返回空', () => {
    expect(buildTreeRows([], new Set())).toEqual([])
  })
})

// ============================ 纯函数：computeVisibleRange ============================

describe('computeVisibleRange - 虚拟滚动窗口', () => {
  it('行数少时全部可见（无占位）', () => {
    const range = computeVisibleRange(0, 640, 5)
    expect(range.start).toBe(0)
    expect(range.end).toBe(5)
    expect(range.padTop).toBe(0)
    expect(range.padBottom).toBe(0)
  })

  it('滚动到中部时仅计算窗口内行 ± 缓冲，padding 撑出总高度', () => {
    // 100 行 × 52px = 5200px 总高；scrollTop=2600（第 50 行附近）
    const range = computeVisibleRange(2600, 640, 100)
    expect(range.start).toBe(Math.floor(2600 / 52) - 6) // 44
    expect(range.end).toBe(Math.min(100, Math.ceil((2600 + 640) / 52) + 6)) // 69
    expect(range.padTop).toBe(44 * 52)
    expect(range.padBottom).toBe((100 - 69) * 52)
  })

  it('滚动越过底部时窗口钳制在总行数内', () => {
    const range = computeVisibleRange(10000, 640, 100)
    expect(range.end).toBe(100)
    expect(range.padBottom).toBe(0)
  })
})

// ============================ 纯函数：formatDateTime ============================

describe('formatDateTime - 时间格式化', () => {
  it('ISO 字符串转本地可读格式', () => {
    expect(formatDateTime('2026-09-02T02:30:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('空值返回占位符', () => {
    expect(formatDateTime('')).toBe('—')
  })

  it('无法解析的字符串原样返回（超长截断到 16 位）', () => {
    expect(formatDateTime('not-a-date-value-long')).toBe('not-a-date-value')
  })
})

// ============================ 组件：树形结构 ============================

describe('列表查询页 - 树形结构与表头层级', () => {
  it('父级表头置顶；子级表头随各子列表内嵌展示（不再统一置顶）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    // 父级表头字段：位于置顶 thead，各出现一次
    const thead = document.querySelector('thead')!
    for (const header of ['成本项名称', '工艺数量', '字段数量', '更新时间', '创建时间']) {
      expect(within(thead).getByText(header)).toBeTruthy()
    }

    // 子级表头字段：位于 tbody 内，每个含工艺的子列表各渲染一次（共 2 组）
    const tbody = document.querySelector('tbody')!
    for (const header of ['工艺名称', '成本金额（元）', '计算公式', '特点描述', '备注']) {
      expect(within(tbody).getAllByText(header).length).toBe(2)
    }
    // 子级表头不置顶
    expect(within(thead).queryByText('工艺名称')).toBeNull()
  })

  it('子表头紧随父行、先于该子列表工艺行（表头跟随子列表）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    const trs = Array.from(document.querySelectorAll('tbody tr'))
    const idxOf = (text: string) => trs.findIndex((tr) => tr.textContent?.includes(text))
    const parentIdx = idxOf('印刷成本')
    const subheaderIdx = idxOf('色数')
    const processIdx = idxOf('UV印刷')
    expect(parentIdx).toBeGreaterThanOrEqual(0)
    expect(subheaderIdx).toBe(parentIdx + 1) // 父行的下一行即该子列表的表头
    expect(processIdx).toBe(subheaderIdx + 1) // 表头之后是该子列表的工艺行
  })

  it('每个子列表独立展示其自定义字段名（隐藏字段不渲染）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    // pci-1 子表头的自定义字段名
    expect(screen.getByText('色数')).toBeTruthy()
    // pci-2 子表头的自定义字段名（与 pci-1 不同，逐组独立）
    expect(screen.getByText('克重')).toBeTruthy()
    expect(screen.getByText('门幅')).toBeTruthy()
    // 隐藏字段不出现在子表头
    expect(screen.queryByText('隐匿字段')).toBeNull()
  })

  it('工艺行展示所属成本项的自定义字段值（与子表头字段名逐列对应）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    // pcp-1（UV印刷）的色数值
    expect(screen.getByText('4色')).toBeTruthy()
    // pcp-3（数码印花）的克重/门幅值
    expect(screen.getByText('180')).toBeTruthy()
    expect(screen.getByText('150cm')).toBeTruthy()
    // 未配置值的工艺（热转印）自定义字段列以占位符显示
    const row = screen.getByText('热转印').closest('tr')!
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(4) // 公式/特点/备注/自定义字段
  })

  it('默认状态下完全展开（父行与全部子行可见）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())
    expect(screen.getByText('印刷成本')).toBeTruthy()
    expect(screen.getByText('热转印')).toBeTruthy()
    expect(screen.getByText('布料成本')).toBeTruthy()
    expect(screen.getByText('数码印花')).toBeTruthy()
  })

  it('点击父行折叠箭头隐藏子表头与子行，再次点击恢复', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    const collapseBtn = screen.getByRole('button', { name: '折叠 印刷成本' })
    fireEvent.click(collapseBtn)
    expect(screen.queryByText('UV印刷')).toBeNull()
    expect(screen.queryByText('热转印')).toBeNull()
    // 子表头随子列表一同隐藏
    expect(screen.queryByText('色数')).toBeNull()
    // 其他父项的子行不受影响
    expect(screen.getByText('数码印花')).toBeTruthy()

    const expandBtn = screen.getByRole('button', { name: '展开 印刷成本' })
    fireEvent.click(expandBtn)
    expect(screen.getByText('UV印刷')).toBeTruthy()
    expect(screen.getByText('色数')).toBeTruthy()
  })

  it('全部收起 / 全部展开按钮批量控制', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /全部收起/ }))
    expect(screen.queryByText('UV印刷')).toBeNull()
    expect(screen.queryByText('数码印花')).toBeNull()
    expect(screen.queryByText('色数')).toBeNull()
    expect(screen.getByText('印刷成本')).toBeTruthy()
    expect(screen.getByText('布料成本')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /全部展开/ }))
    expect(screen.getByText('UV印刷')).toBeTruthy()
    expect(screen.getByText('数码印花')).toBeTruthy()
    expect(screen.getByText('色数')).toBeTruthy()
  })
})

// ============================ 组件：模糊查询 ============================

describe('列表查询页 - 模糊查询（实时响应）', () => {
  it('按成本项名称过滤：未命中的成本项及其工艺整体消失', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('按成本项名称模糊查询'), { target: { value: '布料' } })
    expect(queryName('印刷成本')).toBeNull()
    expect(queryName('UV印刷')).toBeNull()
    expect(queryName('热转印')).toBeNull()
    expect(queryName('布料成本')).toBeTruthy()
    expect(queryName('数码印花')).toBeTruthy()
  })

  it('按工艺名称过滤：仅保留命中的工艺及其父项', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('按工艺名称模糊查询'), { target: { value: 'uv' } })
    expect(queryName('印刷成本')).toBeTruthy()
    expect(queryName('UV印刷')).toBeTruthy()
    expect(queryName('热转印')).toBeNull()
    expect(queryName('布料成本')).toBeNull()
    expect(queryName('数码印花')).toBeNull()
  })

  it('输入过程中逐字符动态匹配（中间态即过滤）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    const input = screen.getByLabelText('按工艺名称模糊查询')
    fireEvent.change(input, { target: { value: '热' } })
    expect(queryName('热转印')).toBeTruthy()
    expect(queryName('UV印刷')).toBeNull()
    fireEvent.change(input, { target: { value: '热转印' } })
    expect(queryName('热转印')).toBeTruthy()
  })

  it('查询期间折叠状态被忽略（强制展开展示完整结果）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    // 先收起印刷成本
    fireEvent.click(screen.getByRole('button', { name: '折叠 印刷成本' }))
    expect(screen.queryByText('UV印刷')).toBeNull()
    // 输入查询后强制展开
    fireEvent.change(screen.getByLabelText('按工艺名称模糊查询'), { target: { value: 'uv' } })
    expect(queryName('UV印刷')).toBeTruthy()
  })

  it('命中文本高亮显示（mark 元素）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('按工艺名称模糊查询'), { target: { value: 'uv' } })
    const marks = document.querySelectorAll('mark')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].textContent).toBe('UV')
  })

  it('统计反馈：默认总量 / 查询时命中量（含原始总量）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    expect(screen.getByTestId('query-stats').textContent).toContain('共 2 个成本项')
    expect(screen.getByTestId('query-stats').textContent).toContain('3 条工艺')

    fireEvent.change(screen.getByLabelText('按工艺名称模糊查询'), { target: { value: 'uv' } })
    const stats = screen.getByTestId('query-stats').textContent
    expect(stats).toContain('命中 1 个成本项')
    expect(stats).toContain('1 条工艺')
    expect(stats).toContain('2 / 3')
  })

  it('多条件组合查询（AND）', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('按成本项名称模糊查询'), { target: { value: '印刷' } })
    fireEvent.change(screen.getByLabelText('按工艺名称模糊查询'), { target: { value: '热转' } })
    expect(queryName('印刷成本')).toBeTruthy()
    expect(queryName('热转印')).toBeTruthy()
    expect(queryName('UV印刷')).toBeNull()
    expect(queryName('布料成本')).toBeNull()
  })

  it('无结果时给出反馈并可一键清空恢复', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('按成本项名称模糊查询'), { target: { value: '不存在的项' } })
    expect(screen.getByText(/未找到匹配/)).toBeTruthy()
    expect(screen.getByText('不存在的项')).toBeTruthy() // 回显查询关键字

    fireEvent.click(screen.getByRole('button', { name: '清空查询条件' }))
    await waitFor(() => expect(queryName('印刷成本')).toBeTruthy())
    expect(queryName('UV印刷')).toBeTruthy()
  })

  it('输入框内置清除按钮：仅清空单个查询条件', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('按工艺名称模糊查询'), { target: { value: 'uv' } })
    expect(queryName('热转印')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '清空工艺查询' }))
    expect(queryName('热转印')).toBeTruthy()
  })
})

// ============================ 组件：交互与权限 ============================

describe('列表查询页 - 跳转与权限', () => {
  it('点击父行详情按钮跳转编辑详情页', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    const row = screen.getByText('布料成本').closest('tr')!
    fireEvent.click(within(row).getByTitle('查看 / 编辑详情'))
    expect(screen.getByTestId('detail-page')).toBeTruthy()
  })

  it('双击父行跳转编辑详情页', async () => {
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())

    fireEvent.doubleClick(screen.getByText('布料成本'))
    expect(screen.getByTestId('detail-page')).toBeTruthy()
  })

  it('无删除权限时不渲染删除按钮', async () => {
    permissionMock.hasPermission = (p: string) => p !== 'process-costs:delete'
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())
    expect(screen.queryByTitle('删除成本项')).toBeNull()
    expect(screen.queryByTitle('删除可选工艺')).toBeNull()
  })

  it('无新增权限时不渲染新增按钮', async () => {
    permissionMock.hasPermission = (p: string) => p !== 'process-costs:create'
    renderList()
    await waitFor(() => expect(screen.getByText('UV印刷')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /新增成本项/ })).toBeNull()
  })
})

// ============================ 组件：虚拟滚动 ============================

describe('列表查询页 - 虚拟滚动', () => {
  it('大数据量时仅渲染可视窗口内的行（窗口外用占位行）', async () => {
    // 100 个成本项 × 每项 2 工艺 = 300 行；jsdom 视口兜底 640px ≈ 19 行
    const bigItems = Array.from({ length: 100 }, (_, i) =>
      makeItem(`pci-big-${i}`, `成本项${String(i).padStart(3, '0')}`, [
        makeProcess(`pcp-a-${i}`, `工艺A${String(i).padStart(3, '0')}`, 1, `pci-big-${i}`),
        makeProcess(`pcp-b-${i}`, `工艺B${String(i).padStart(3, '0')}`, 2, `pci-big-${i}`),
      ]),
    )
    apiMock.productCostItems.getAll.mockResolvedValue(bigItems)
    renderList()

    await waitFor(() => expect(screen.getByText('成本项000')).toBeTruthy())
    // 窗口内：前几行可见
    expect(screen.getByText('工艺A000')).toBeTruthy()
    // 窗口外：中后部行未渲染（虚拟滚动跳过）
    expect(screen.queryByText('成本项050')).toBeNull()
    expect(screen.queryByText('工艺A099')).toBeNull()
    // 底部有占位 spacer 行撑出完整滚动高度
    const spacer = document.querySelector('tbody tr[aria-hidden="true"][style*="height"]')
    expect(spacer).toBeTruthy()
  })
})
