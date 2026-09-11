/**
 * 产品成本项配置 - 编辑详情页（ProductCostItems，/product-cost-items/:id）单元测试
 *
 * 测试目标：
 *   1. URL 参数定位：按 :id 选中对应成本项并展示其工艺/字段详情
 *   2. 成本项切换器：select 切换后详情区同步更新（URL replace）
 *   3. 无效链接：id 不存在时提示并支持返回列表
 *   4. 返回列表按钮
 *   5. 编辑名称内联表单
 *
 * Mock 策略：api / usePermission；MemoryRouter 包裹（页面使用 useParams/useNavigate）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ProductCostItems from '../src/pages/ProductCostItems'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  productCostItems: {
    getAll: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    createProcess: vi.fn(),
    updateProcess: vi.fn(),
    reorderProcesses: vi.fn(),
    createField: vi.fn(),
    updateField: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemCheck: vi.fn(),
    deleteProcess: vi.fn(),
    deleteProcessCheck: vi.fn(),
    deleteField: vi.fn(),
    deleteFieldCheck: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({ api: apiMock }))

const permissionMock = vi.hoisted(() => ({ hasPermission: (_perm: string) => true }))
vi.mock('../src/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: (p: string) => permissionMock.hasPermission(p) }),
}))

// ============================ 测试数据 ============================

const mockItems = [
  {
    id: 'pci-1',
    name: '印刷成本',
    sortOrder: 1,
    processes: [
      { id: 'pcp-1', costItemId: 'pci-1', name: 'UV印刷', cost: 0.5, formula: '面积×单价', features: '色彩好', remark: '', customValues: {}, sortOrder: 1, createdAt: '', updatedAt: '' },
      { id: 'pcp-2', costItemId: 'pci-1', name: '热转印', cost: 0.8, formula: '', features: '', remark: '', customValues: {}, sortOrder: 2, createdAt: '', updatedAt: '' },
    ],
    fields: [],
    createdAt: '2026-09-01T08:00:00',
    updatedAt: '2026-09-02T10:30:00',
  },
  {
    id: 'pci-2',
    name: '布料成本',
    sortOrder: 2,
    processes: [
      { id: 'pcp-3', costItemId: 'pci-2', name: '数码印花', cost: 1.2, formula: '', features: '', remark: '', customValues: {}, sortOrder: 1, createdAt: '', updatedAt: '' },
    ],
    fields: [],
    createdAt: '2026-09-01T08:00:00',
    updatedAt: '2026-09-03T09:00:00',
  },
]

// ============================ 渲染辅助 ============================

function renderDetail(id = 'pci-2') {
  return render(
    <MemoryRouter initialEntries={[`/product-cost-items/${id}`]}>
      <Routes>
        <Route path="/product-cost-items" element={<div data-testid="list-page">list</div>} />
        <Route path="/product-cost-items/:id" element={<ProductCostItems />} />
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

// ============================ 测试 ============================

describe('编辑详情页 - URL 参数定位', () => {
  it('按 :id 选中成本项并展示其工艺详情', async () => {
    renderDetail('pci-2')
    // 直接等待目标内容（页头先于 selectedItemId 的 effect 渲染，等待页头会引入竞态）
    await waitFor(() => expect(screen.getByText('可选工艺 — 布料成本')).toBeTruthy())
    expect(screen.getByText('数码印花')).toBeTruthy()
    // 非当前成本项的工艺不渲染
    expect(screen.queryByText('UV印刷')).toBeNull()
  })

  it('切换器默认选中 URL 对应的成本项', async () => {
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())
    const select = screen.getByLabelText('当前成本项') as HTMLSelectElement
    expect(select.value).toBe('pci-1')
  })
})

describe('编辑详情页 - 成本项切换器', () => {
  it('切换 select 后详情区同步更新', async () => {
    renderDetail('pci-2')
    await waitFor(() => expect(screen.getByText('可选工艺 — 布料成本')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('当前成本项'), { target: { value: 'pci-1' } })
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())
    expect(screen.getByText('UV印刷')).toBeTruthy()
    expect(screen.queryByText('数码印花')).toBeNull()
  })

  it('仅一个成本项时切换器禁用', async () => {
    apiMock.productCostItems.getAll.mockResolvedValue([mockItems[0]])
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())
    const select = screen.getByLabelText('当前成本项') as HTMLSelectElement
    expect(select.disabled).toBe(true)
  })
})

describe('编辑详情页 - 无效链接', () => {
  it('id 不存在时提示并可返回列表', async () => {
    renderDetail('pci-not-exist')
    await waitFor(() => expect(screen.getByText('成本项不存在或已被删除')).toBeTruthy())
    // 不渲染详情区
    expect(screen.queryByText('可选工艺 —')).toBeNull()

    // 页头与错误卡片均有「返回列表」按钮，任一点击即跳转
    const buttons = screen.getAllByRole('button', { name: /返回列表/ })
    fireEvent.click(buttons[0])
    expect(screen.getByTestId('list-page')).toBeTruthy()
  })
})

describe('编辑详情页 - 返回与编辑', () => {
  it('页头「返回列表」按钮跳转列表页', async () => {
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }))
    expect(screen.getByTestId('list-page')).toBeTruthy()
  })

  it('「编辑名称」打开内联表单并回填当前名称', async () => {
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /编辑名称/ }))
    const input = screen.getByPlaceholderText('如：印刷成本、布料成本、包装成本') as HTMLInputElement
    expect(input.value).toBe('印刷成本')
    expect(screen.getByText('编辑成本项名称')).toBeTruthy()
  })

  it('「添加工艺」打开工艺表单（含自定义动态字段）', async () => {
    apiMock.productCostItems.getAll.mockResolvedValue([
      {
        ...mockItems[0],
        fields: [
          { id: 'pcf-1', costItemId: 'pci-1', name: '色数', fieldType: 'number', options: [], visible: true, sortOrder: 1, createdAt: '', updatedAt: '' },
          { id: 'pcf-2', costItemId: 'pci-1', name: 'hidden字段', fieldType: 'text', options: [], visible: false, sortOrder: 2, createdAt: '', updatedAt: '' },
        ],
      },
    ])
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /添加工艺/ }))
    expect(screen.getByText('新增可选工艺')).toBeTruthy()
    // 动态字段：显示中的可见字段渲染输入控件（限定在工艺表单内断言，字段配置表格同样展示字段名）
    const form = screen.getByPlaceholderText('如：单面数码UV印刷').closest('form')!
    expect(within(form).getByText('色数')).toBeTruthy()
    // 隐藏字段不出现在表单
    expect(within(form).queryByText('hidden字段')).toBeNull()
  })
})

describe('编辑详情页 - 可选工艺手动排序', () => {
  it('点击「上移工艺」以相邻交换后的整表新顺序调用重排接口', async () => {
    apiMock.productCostItems.reorderProcesses.mockResolvedValue(mockItems[0])
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())

    // 第二行「热转印」上移 → 新顺序 [热转印, UV印刷]
    const heatRow = screen.getByText('热转印').closest('tr')!
    fireEvent.click(within(heatRow).getByTitle('上移工艺'))

    await waitFor(() =>
      expect(apiMock.productCostItems.reorderProcesses).toHaveBeenCalledWith('pci-1', ['pcp-2', 'pcp-1']),
    )
  })

  it('首行上移与末行下移禁用', async () => {
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())

    const uvRow = screen.getByText('UV印刷').closest('tr')!
    expect((within(uvRow).getByTitle('上移工艺') as HTMLButtonElement).disabled).toBe(true)
    expect((within(uvRow).getByTitle('下移工艺') as HTMLButtonElement).disabled).toBe(false)

    const heatRow = screen.getByText('热转印').closest('tr')!
    expect((within(heatRow).getByTitle('上移工艺') as HTMLButtonElement).disabled).toBe(false)
    expect((within(heatRow).getByTitle('下移工艺') as HTMLButtonElement).disabled).toBe(true)
  })

  it('仅一条工艺时不渲染排序按钮（无移动意义）', async () => {
    renderDetail('pci-2')
    await waitFor(() => expect(screen.getByText('可选工艺 — 布料成本')).toBeTruthy())

    const digitalRow = screen.getByText('数码印花').closest('tr')!
    expect(within(digitalRow).queryByTitle('上移工艺')).toBeNull()
    expect(within(digitalRow).queryByTitle('下移工艺')).toBeNull()
  })

  it('重排失败时展示错误提示', async () => {
    apiMock.productCostItems.reorderProcesses.mockRejectedValue(
      new Error('工艺排序列表与当前配置不一致，请刷新后重试'),
    )
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())

    const heatRow = screen.getByText('热转印').closest('tr')!
    fireEvent.click(within(heatRow).getByTitle('上移工艺'))

    await waitFor(() => expect(screen.getByText('工艺排序列表与当前配置不一致，请刷新后重试')).toBeTruthy())
  })

  it('无编辑权限时不渲染排序按钮', async () => {
    permissionMock.hasPermission = (p: string) => p !== 'process-costs:edit'
    renderDetail('pci-1')
    await waitFor(() => expect(screen.getByText('可选工艺 — 印刷成本')).toBeTruthy())

    expect(screen.queryByTitle('上移工艺')).toBeNull()
    expect(screen.queryByTitle('下移工艺')).toBeNull()
  })
})
