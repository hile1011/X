/**
 * 订单对账详情页（ReconciliationDetail，v28）单元测试
 *
 * 测试目标：
 *   1. 只读信息：订单基本信息 + 在线表格信息（标题行/公式单元格底色）
 *   2. 状态门槛：仅 已发货已收款(5)/已对账(8) 支持对账，其余状态提示不支持
 *   3. 工艺成本录入（状态5）：添加/删除行、单价×数量自动联动成本、必填校验、保存回填
 *   4. 确认对账（5→8）：先保存明细再流转，失败不跳转
 *   5. 已对账（状态8）：明细只读、退回按钮调用 unreconcile 并刷新
 *   6. 成本对比：累计工艺成本总额 / 订单不含税成本 / 差额（正负零三态）
 *   7. 权限控制：无编辑权限只读；无流转权限无确认对账/退回按钮
 *
 * Mock 策略：api / usePermission；MemoryRouter 包裹（页面使用 useNavigate/useParams）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ReconciliationDetail from '../src/pages/ReconciliationDetail'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  quotes: {
    getById: vi.fn(),
    getReconciliationCosts: vi.fn(),
    saveReconciliationCosts: vi.fn(),
    reconcileQuote: vi.fn(),
    unreconcileQuote: vi.fn(),
  },
  products: {
    getAll: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({ api: apiMock }))

const permissionMock = vi.hoisted(() => ({ hasPermission: (_perm: string) => true }))
vi.mock('../src/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: (p: string) => permissionMock.hasPermission(p) }),
}))

// ============================ 测试数据 ============================

const mockProducts = [
  { id: 'style-1', name: '无底无侧普通袋', sku: 'SKU-001', code: '1', price: 10, stock: 100, category: '袋', description: '' },
]

function makeQuote(overrides: Record<string, unknown>) {
  return {
    id: 'q-001',
    quote_number: '2026091012345678',
    customerName: '对账测试客户',
    productStyle: '1',
    productSpec: '38x40',
    fabricMaterial: '10安涤棉新本色',
    process: '数码UV印刷',
    handleMaterial: '帆布手提',
    handleSpec: '2.5cm',
    quantity: '1000',
    boxSpec: '50个/箱',
    costPrice: 3.5,
    priceWithTax: 3.85,
    sellPriceNoTax: 5.0,
    sellPriceWithTax: 5.5,
    status: 5,
    paymentTime: '2026-09-01',
    reconciledTime: '',
    remark: '测试备注',
    tableData: [
      [null, '数量 (个)', '宽(CM)'],
      ['成品', 7200, 38],
    ],
    allFormulas: { C2: '=B2' },
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

/** 已保存的成本明细（服务端返回格式） */
const savedCosts = [
  { id: 'rc-1', quoteId: 'q-001', name: '数码UV印刷', unitPrice: 0.5, quantity: 1000, cost: 500, remark: '双面', sortOrder: 1 },
  { id: 'rc-2', quoteId: 'q-001', name: '车缝', unitPrice: 1, quantity: 1000, cost: 1000, remark: '', sortOrder: 2 },
]

// ============================ 渲染辅助 ============================

function renderPage(quoteId = 'q-001') {
  return render(
    <MemoryRouter initialEntries={[`/reconciliation-alerts/${quoteId}`]}>
      <Routes>
        <Route path="/reconciliation-alerts" element={<div data-testid="recon-list">对账列表页</div>} />
        <Route path="/reconciliation-alerts/:id" element={<ReconciliationDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionMock.hasPermission = () => true
  apiMock.quotes.getById.mockResolvedValue(makeQuote({}))
  apiMock.quotes.getReconciliationCosts.mockResolvedValue([])
  apiMock.products.getAll.mockResolvedValue(mockProducts)
})

afterEach(() => {
  cleanup()
})

// ============================ 测试 ============================

describe('对账详情页 - 只读信息展示', () => {
  it('展示订单基本信息字段（客户/数量/成本价等）', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('订单基本信息')).toBeTruthy())
    expect(screen.getByText('对账测试客户')).toBeTruthy()
    expect(screen.getByText('1000')).toBeTruthy()
    expect(screen.getByText('¥3.50')).toBeTruthy() // 成本价（不含税）
    expect(screen.getByText('¥3.85')).toBeTruthy() // 成本价（含税）
  })

  it('在线表格信息只读渲染：标题行蓝底 + 公式单元格橙底 + 数值保留2位小数', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('在线表格信息')).toBeTruthy())
    expect(screen.getByText('数量 (个)')).toBeTruthy()
    // 数值保留2位小数（与订单管理页在线表格 fieldFormat 默认一致）
    expect(screen.getByText('7200.00')).toBeTruthy()
    expect(screen.getByText('38.00')).toBeTruthy()

    // 标题行（第一列空、其他列有值）：蓝底 #4472C4
    const titleCell = screen.getByText('数量 (个)').closest('td')!
    expect(titleCell.style.backgroundColor).toBe('rgb(68, 114, 196)')

    // 公式单元格（C2 有公式）：橙底 #F8CBAD
    const formulaCell = screen.getByText('38.00').closest('td')!
    expect(formulaCell.style.backgroundColor).toBe('rgb(248, 203, 173)')
  })

  it('工艺成本明细区域位于在线表格信息上方', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('工艺成本明细')).toBeTruthy())
    const costHeading = screen.getByText('工艺成本明细')
    const tableHeading = screen.getByText('在线表格信息')
    // 在线表格信息在 DOM 中应位于工艺成本明细之后（页面更下方）
    expect(
      costHeading.compareDocumentPosition(tableHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('状态8时基本信息区域展示对账时间', async () => {
    apiMock.quotes.getById.mockResolvedValue(makeQuote({ status: 8, reconciledTime: '2026-09-05' }))
    renderPage()
    await waitFor(() => expect(screen.getByText('2026-09-05')).toBeTruthy())
  })
})

describe('对账详情页 - 状态门槛', () => {
  it('非 5/8 状态显示「该订单当前不支持对账」', async () => {
    apiMock.quotes.getById.mockResolvedValue(makeQuote({ status: 3 }))
    renderPage()
    await waitFor(() => expect(screen.getByText('该订单当前不支持对账')).toBeTruthy())
    expect(screen.getByText(/当前状态为「做货中」/)).toBeTruthy()
  })

  it('订单加载失败显示错误页', async () => {
    apiMock.quotes.getById.mockRejectedValue(new Error('订单不存在'))
    renderPage()
    await waitFor(() => expect(screen.getByText('无法加载订单')).toBeTruthy())
    expect(screen.getByText('订单不存在')).toBeTruthy()
  })
})

describe('对账详情页 - 工艺成本录入（状态5）', () => {
  it('初始渲染一行空明细，可添加/删除行', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('工艺成本明细')).toBeTruthy())
    // 初始 1 行
    expect(screen.getAllByPlaceholderText('如：印刷费')).toHaveLength(1)

    fireEvent.click(screen.getByText('添加工艺'))
    expect(screen.getAllByPlaceholderText('如：印刷费')).toHaveLength(2)

    // 删除第一行（每行有一个删除按钮）
    const deleteBtns = screen.getAllByTitle('删除该行')
    fireEvent.click(deleteBtns[0])
    expect(screen.getAllByPlaceholderText('如：印刷费')).toHaveLength(1)
  })

  it('工艺成本公式联动：单价×数量自动重算，也可手动输入', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByPlaceholderText('如：印刷费')).toBeTruthy())

    const nameInput = screen.getByPlaceholderText('如：印刷费') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '烫金' } })

    // 每行三个数字输入（placeholder 均为 0.00）：单价 / 数量 / 成本（可手动输入）
    const nums = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    expect(nums).toHaveLength(3)
    expect(nums[2].readOnly).toBe(false) // 成本框可编辑

    // 公式联动：单价 0.5 × 数量 1000 → 成本自动填入 500
    fireEvent.change(nums[0], { target: { value: '0.5' } })
    fireEvent.change(nums[1], { target: { value: '1000' } })
    expect(nums[2].value).toBe('500')

    // 修改单价后成本实时重算（覆盖旧值）
    fireEvent.change(nums[0], { target: { value: '0.6' } })
    expect(nums[2].value).toBe('600')

    // 手动输入：直接修改成本框，值保留
    fireEvent.change(nums[2], { target: { value: '888' } })
    expect(nums[2].value).toBe('888')

    // 单价/数量任一缺失时不改动成本（保留手动值）
    fireEvent.change(nums[1], { target: { value: '' } })
    expect(nums[2].value).toBe('888')

    // 恢复有效输入后公式联动覆盖手动值：0.6 × 2000 = 1200
    fireEvent.change(nums[1], { target: { value: '2000' } })
    expect(nums[2].value).toBe('1200')
  })

  it('校验：工艺名称为空时保存报错且不调用接口', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('保存成本明细')).toBeTruthy())

    // 只手动填成本，名称留空
    const nums = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    fireEvent.change(nums[2], { target: { value: '100' } })

    fireEvent.click(screen.getByText('保存成本明细'))
    expect(await screen.findByText('第 1 行：工艺名称不能为空')).toBeTruthy()
    expect(apiMock.quotes.saveReconciliationCosts).not.toHaveBeenCalled()
  })

  it('校验：工艺成本为空时保存报错', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('保存成本明细')).toBeTruthy())

    const nameInput = screen.getByPlaceholderText('如：印刷费') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '烫金' } })

    fireEvent.click(screen.getByText('保存成本明细'))
    expect(await screen.findByText('第 1 行：工艺成本不能为空且必须为数字')).toBeTruthy()
    expect(apiMock.quotes.saveReconciliationCosts).not.toHaveBeenCalled()
  })

  it('保存成功调用接口并回填服务端数据', async () => {
    apiMock.quotes.saveReconciliationCosts.mockResolvedValueOnce(savedCosts)
    renderPage()
    await waitFor(() => expect(screen.getByText('保存成本明细')).toBeTruthy())

    const nameInput = screen.getByPlaceholderText('如：印刷费') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '烫金' } })
    const nums = screen.getAllByPlaceholderText('0.00') as HTMLInputElement[]
    // 手动输入成本（不填单价/数量）
    fireEvent.change(nums[2], { target: { value: '100' } })

    fireEvent.click(screen.getByText('保存成本明细'))
    await waitFor(() => expect(apiMock.quotes.saveReconciliationCosts).toHaveBeenCalledWith('q-001', [
      { name: '烫金', unitPrice: 0, quantity: 0, cost: 100, remark: '' },
    ]))

    // 回填为服务端返回的两行
    await waitFor(() => expect(screen.getAllByPlaceholderText('如：印刷费')).toHaveLength(2))
  })
})

describe('对账详情页 - 确认/退回对账', () => {
  it('确认对账：先保存明细再流转 5→8，成功后返回列表', async () => {
    apiMock.quotes.saveReconciliationCosts.mockResolvedValueOnce(savedCosts)
    apiMock.quotes.reconcileQuote.mockResolvedValueOnce(makeQuote({ status: 8 }))
    renderPage()
    await waitFor(() => expect(screen.getByText('确认对账')).toBeTruthy())

    fireEvent.click(screen.getByText('确认对账'))
    await waitFor(() => expect(apiMock.quotes.reconcileQuote).toHaveBeenCalledWith('q-001'))
    // 成功后跳转回对账列表
    await waitFor(() => expect(screen.getByTestId('recon-list')).toBeTruthy())
  })

  it('确认对账失败（保存校验不过）不流转', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('确认对账')).toBeTruthy())

    // 填了名称但没填成本 → 保存校验失败
    const nameInput = screen.getByPlaceholderText('如：印刷费') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: '烫金' } })
    fireEvent.click(screen.getByText('确认对账'))

    expect(await screen.findByText('第 1 行：工艺成本不能为空且必须为数字')).toBeTruthy()
    expect(apiMock.quotes.reconcileQuote).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recon-list')).toBeNull()
  })

  it('状态8：明细只读 + 退回按钮调用 unreconcile 并刷新', async () => {
    // 首次加载为状态8；退回后 loadData 重新加载返回状态5
    apiMock.quotes.getById.mockResolvedValueOnce(makeQuote({ status: 8, reconciledTime: '2026-09-05' }))
    apiMock.quotes.getReconciliationCosts.mockResolvedValueOnce(savedCosts)
    apiMock.quotes.unreconcileQuote.mockResolvedValueOnce(makeQuote({ status: 5 }))
    // 退回后重新加载（loadData 再次调用）
    apiMock.quotes.getReconciliationCosts.mockResolvedValue([])

    renderPage()
    await waitFor(() => expect(screen.getByText('退回已发货已收款')).toBeTruthy())

    // 已有编辑权限但状态8 → 只读（加载了 2 行明细）
    const nameInputs = screen.getAllByPlaceholderText('如：印刷费') as HTMLInputElement[]
    expect(nameInputs).toHaveLength(2)
    expect(nameInputs[0].readOnly).toBe(true)
    expect(screen.queryByText('添加工艺')).toBeNull()

    fireEvent.click(screen.getByText('退回已发货已收款'))
    await waitFor(() => expect(apiMock.quotes.unreconcileQuote).toHaveBeenCalledWith('q-001'))
    // 刷新后（状态5）出现确认对账按钮
    await waitFor(() => expect(screen.getByText('确认对账')).toBeTruthy())
  })
})

describe('对账详情页 - 成本对比', () => {
  it('展示累计工艺成本总额、订单不含税成本与差额（低于订单成本）', async () => {
    apiMock.quotes.getReconciliationCosts.mockResolvedValueOnce(savedCosts) // 500 + 1000 = 1500
    renderPage()
    await waitFor(() => expect(screen.getByText('成本对比')).toBeTruthy())

    // 累计 1500；订单不含税成本 = 3.5 × 1000 = 3500；差额 = 1500-3500 = -2000
    expect(screen.getByText('¥1,500.00')).toBeTruthy()
    expect(screen.getByText('¥3,500.00')).toBeTruthy()
    expect(screen.getByText('¥-2,000.00')).toBeTruthy()
    expect(screen.getByText('实际工艺成本低于订单成本')).toBeTruthy()
  })

  it('工艺成本超出订单成本时差额为正并提示超出', async () => {
    apiMock.quotes.getReconciliationCosts.mockResolvedValueOnce([
      { ...savedCosts[0], cost: 2000 },
      { ...savedCosts[1], cost: 2000 },
    ]) // 合计 4000 > 3500
    renderPage()
    await waitFor(() => expect(screen.getByText('成本对比')).toBeTruthy())

    expect(screen.getByText('+¥500.00')).toBeTruthy()
    expect(screen.getByText('实际工艺成本超出订单成本')).toBeTruthy()
  })

  it('两者一致时提示一致', async () => {
    apiMock.quotes.getReconciliationCosts.mockResolvedValueOnce([
      { ...savedCosts[0], cost: 3500 },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('成本对比')).toBeTruthy())

    // 累计 3500 与订单不含税成本 3500 均显示该金额
    expect(screen.getAllByText('¥3,500.00')).toHaveLength(2)
    expect(screen.getByText('两者一致')).toBeTruthy()
  })
})

describe('对账详情页 - 权限控制', () => {
  it('无编辑权限（状态5）：无保存/添加按钮，明细只读', async () => {
    permissionMock.hasPermission = (p: string) => p !== 'quotes:edit'
    renderPage()
    await waitFor(() => expect(screen.getByText('工艺成本明细')).toBeTruthy())

    expect(screen.queryByText('保存成本明细')).toBeNull()
    expect(screen.queryByText('添加工艺')).toBeNull()
    const nameInput = screen.getByPlaceholderText('如：印刷费') as HTMLInputElement
    expect(nameInput.readOnly).toBe(true)
    // 有流转权限时确认对账仍可用
    expect(screen.getByText('确认对账')).toBeTruthy()
  })

  it('无流转权限（状态5）：无确认对账按钮', async () => {
    permissionMock.hasPermission = (p: string) => p !== 'quotes:status-transition'
    renderPage()
    await waitFor(() => expect(screen.getByText('保存成本明细')).toBeTruthy())
    expect(screen.queryByText('确认对账')).toBeNull()
  })

  it('无流转权限（状态8）：无退回按钮', async () => {
    permissionMock.hasPermission = (p: string) => p !== 'quotes:status-transition'
    apiMock.quotes.getById.mockResolvedValue(makeQuote({ status: 8 }))
    renderPage()
    await waitFor(() => expect(screen.getByText('工艺成本明细')).toBeTruthy())
    expect(screen.queryByText('退回已发货已收款')).toBeNull()
  })
})
