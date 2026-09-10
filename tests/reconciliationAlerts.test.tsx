/**
 * 订单对账管理页（ReconciliationAlerts，v28）单元测试
 *
 * 页面使用订单管理列表的表格格式（同列结构、客户分组、金额口径）：
 *   1. 双列表分组：状态5（已发货已收款）进上表、状态8（已对账）进下表，其余状态不出现
 *   2. 表格列与订单管理列表一致（订单号/款式/产品规格/数量/面料/工艺/订单状态/卖价/成本价/利润/销售总额/利润总额等）
 *   3. 客户分组：父行显示客户名与订单数，默认展开
 *   4. 上表「发起对账」按钮跳转对账页 /reconciliation-alerts/:id
 *   5. 下表展示对账时间、「查看」/「退回」按钮
 *   6. 退回流程：确认弹窗 → 调用 unreconcileQuote → 刷新数据
 *   7. 权限控制：无 quotes:status-transition 权限时隐藏退回按钮
 *   8. 同状态内排序：修改时间 DESC（最新在前）
 *   9. 金额口径与订单管理列表一致：销售总额(含税)=round2(卖价含税×数量) 等
 *
 * Mock 策略：api / usePermission；MemoryRouter 包裹（页面使用 useNavigate）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ReconciliationAlerts from '../src/pages/ReconciliationAlerts'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  quotes: {
    getAll: vi.fn(),
    getImageFlags: vi.fn(),
    unreconcileQuote: vi.fn(),
    getThumbnailUrl: vi.fn(() => ''),
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
  { id: 'style-2', name: '有底无侧普通袋', sku: 'SKU-002', code: '2', price: 12, stock: 100, category: '袋', description: '' },
]

function makeQuote(overrides: Record<string, unknown>) {
  return {
    id: 'q-001',
    quote_number: '2026091012345678',
    customerName: '测试客户A',
    productStyle: '1',
    productSpec: '38x40',
    fabricMaterial: '10安涤棉新本色',
    process: '数码UV印刷',
    quantity: '1000',
    costPrice: 3.5,
    priceWithTax: 4.5,
    sellPriceNoTax: 5.0,
    sellPriceWithTax: 5.5,
    status: 5,
    paymentTime: '2026-09-01',
    reconciledTime: '',
    productionTimeEnd: '2026-09-20',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

// ============================ 渲染辅助 ============================

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reconciliation-alerts']}>
      <Routes>
        <Route path="/reconciliation-alerts" element={<ReconciliationAlerts />} />
        <Route path="/reconciliation-alerts/:id" element={<div data-testid="recon-detail">对账详情页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 获取上下两个列表卡片（按标题定位） */
function getSection(title: string): HTMLElement {
  return screen.getByText(title).closest('section')!
}

beforeEach(() => {
  vi.clearAllMocks()
  permissionMock.hasPermission = () => true
  apiMock.quotes.getAll.mockResolvedValue([])
  apiMock.quotes.getImageFlags.mockResolvedValue({})
  apiMock.quotes.unreconcileQuote.mockResolvedValue({})
  apiMock.products.getAll.mockResolvedValue(mockProducts)
})

afterEach(() => {
  cleanup()
})

// ============================ 测试 ============================

describe('订单对账管理页 - 双列表分组', () => {
  it('渲染页面标题「订单对账管理」', async () => {
    renderPage()
    await waitFor(() => expect(apiMock.quotes.getAll).toHaveBeenCalled())
    expect(screen.getByText('订单对账管理')).toBeTruthy()
  })

  it('状态5订单进入上表（已发货已收款订单），状态8进入下表（已对账订单）', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-5', customerName: '收款客户', status: 5 }),
      makeQuote({ id: 'q-8', customerName: '对账客户', status: 8, reconciledTime: '2026-09-05' }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('收款客户')).toBeTruthy())

    const upper = getSection('已发货已收款订单')
    const lower = getSection('已对账订单')
    expect(upper.textContent).toContain('收款客户')
    expect(upper.textContent).not.toContain('对账客户')
    expect(lower.textContent).toContain('对账客户')
    expect(lower.textContent).not.toContain('收款客户')
  })

  it('其余状态（1/2/3/4/6/7）订单不出现在任何列表', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-1', customerName: '报价中客户', status: 1 }),
      makeQuote({ id: 'q-3', customerName: '做货中客户', status: 3 }),
      makeQuote({ id: 'q-6', customerName: '已结束客户', status: 6 }),
      makeQuote({ id: 'q-7', customerName: '打样完成客户', status: 7 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('暂无待对账订单')).toBeTruthy())

    expect(screen.queryByText(/报价中客户/)).toBeNull()
    expect(screen.queryByText(/做货中客户/)).toBeNull()
    expect(screen.queryByText(/已结束客户/)).toBeNull()
    expect(screen.queryByText(/打样完成客户/)).toBeNull()
    expect(screen.getByText('暂无已对账订单')).toBeTruthy()
  })

  it('列表计数徽章显示正确数量', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-5a', status: 5 }),
      makeQuote({ id: 'q-5b', status: 5 }),
      makeQuote({ id: 'q-8', status: 8 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('待对账 2 单')).toBeTruthy())
    expect(screen.getByText('已对账 1 单')).toBeTruthy()
  })
})

describe('订单对账管理页 - 订单管理列表格式', () => {
  it('表头列与订单管理列表一致', async () => {
    apiMock.quotes.getAll.mockResolvedValue([makeQuote({ status: 5 })])
    renderPage()
    await waitFor(() => expect(screen.getByText('发起对账')).toBeTruthy())

    const upper = getSection('已发货已收款订单')
    for (const col of ['订单号', '款式', '产品规格', '数量', '面料', '工艺', '订单状态',
      '卖价(不含税)', '卖价(含税)', '成本价', '含税价', '利润(不含税)', '利润(含税)',
      '销售总额(含税)', '利润总额', '做货到期时间', '创建日期', '操作']) {
      expect(upper.textContent).toContain(col)
    }
  })

  it('按客户分组：父行显示客户名与订单数，同客户订单归为一组', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-a', customerName: '同组客户', quote_number: '1111111111111111', status: 5 }),
      makeQuote({ id: 'q-b', customerName: '同组客户', quote_number: '2222222222222222', status: 5 }),
      makeQuote({ id: 'q-c', customerName: '另一客户', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())
    expect(screen.getByText('(1个订单)')).toBeTruthy()
  })

  it('金额口径与订单管理列表一致：卖价/成本价/利润/销售总额/利润总额', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-amt', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('发起对账')).toBeTruthy())

    const upper = getSection('已发货已收款订单')
    expect(upper.textContent).toContain('¥5.00')   // 卖价(不含税)
    expect(upper.textContent).toContain('¥5.50')   // 卖价(含税)
    expect(upper.textContent).toContain('¥3.50')   // 成本价
    expect(upper.textContent).toContain('¥4.50')   // 含税价
    expect(upper.textContent).toContain('¥1.50')   // 利润(不含税) = 5.00 - 3.50
    expect(upper.textContent).toContain('¥1.00')   // 利润(含税) = 5.50 - 4.50
    expect(upper.textContent).toContain('¥5500.00') // 销售总额(含税) = 5.5 × 1000（toFixed(2)，无千分位，与订单管理一致）
    expect(upper.textContent).toContain('¥1500.00') // 利润总额 = 1.50 × 1000
  })
})

describe('订单对账管理页 - 上表待对账操作', () => {
  it('点击「发起对账」跳转对账详情页', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-jump', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('发起对账')).toBeTruthy())

    fireEvent.click(screen.getByText('发起对账'))
    await waitFor(() => expect(screen.getByTestId('recon-detail')).toBeTruthy())
  })
})

describe('订单对账管理页 - 下表已对账操作', () => {
  it('已对账订单显示状态徽标与对账时间', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-8', status: 8, reconciledTime: '2026-09-05' }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('已对账')).toBeTruthy())
    expect(screen.getByText(/对账于 2026-09-05/)).toBeTruthy()
  })

  it('点击「查看」跳转对账详情页', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-view', status: 8 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy())

    fireEvent.click(screen.getByText('查看'))
    await waitFor(() => expect(screen.getByTestId('recon-detail')).toBeTruthy())
  })

  it('退回流程：弹窗确认后调用 unreconcileQuote 并刷新', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-back', status: 8, reconciledTime: '2026-09-05' }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('退回')).toBeTruthy())

    fireEvent.click(screen.getByText('退回'))
    // 确认弹窗出现
    expect(screen.getByText('退回对账确认')).toBeTruthy()
    // 尚未调用接口
    expect(apiMock.quotes.unreconcileQuote).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('确认退回'))
    await waitFor(() => expect(apiMock.quotes.unreconcileQuote).toHaveBeenCalledWith('q-back'))
    // 刷新数据
    await waitFor(() => expect(apiMock.quotes.getAll.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('取消弹窗不调用退回接口', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-cancel', status: 8 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('退回')).toBeTruthy())

    fireEvent.click(screen.getByText('退回'))
    fireEvent.click(screen.getByText('取消'))
    expect(screen.queryByText('退回对账确认')).toBeNull()
    expect(apiMock.quotes.unreconcileQuote).not.toHaveBeenCalled()
  })

  it('无 quotes:status-transition 权限时隐藏退回按钮', async () => {
    permissionMock.hasPermission = () => false
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-noperm', status: 8 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('查看')).toBeTruthy())
    expect(screen.queryByText('退回')).toBeNull()
  })
})

describe('订单对账管理页 - 排序', () => {
  it('同状态同客户内按修改时间 DESC（最新修改在最上）', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-old', quote_number: '1111111111111111', customerName: '排序客户', status: 5, updated_at: '2026-09-01T10:00:00Z' }),
      makeQuote({ id: 'q-new', quote_number: '2222222222222222', customerName: '排序客户', status: 5, updated_at: '2026-09-08T10:00:00Z' }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())

    const upper = getSection('已发货已收款订单')
    const texts = upper.textContent!
    expect(texts.indexOf('2222222222222222')).toBeLessThan(texts.indexOf('1111111111111111'))
  })
})

describe('订单对账管理页 - 查询功能', () => {
  it('渲染查询栏：搜索框 / 客户多选 / 款式多选 / 做货日期区间', async () => {
    apiMock.quotes.getAll.mockResolvedValue([makeQuote({ status: 5 })])
    renderPage()
    await waitFor(() => expect(screen.getByText('发起对账')).toBeTruthy())
    expect(screen.getByPlaceholderText('搜索客户/款式/订单号...')).toBeTruthy()
    expect(screen.getByText('客户名称（输入检索，可多选）')).toBeTruthy()
    expect(screen.getByText('款式（可多选）')).toBeTruthy()
    expect(screen.getByTitle('做货开始日期（起）')).toBeTruthy()
    expect(screen.getByTitle('做货开始日期（止）')).toBeTruthy()
  })

  it('搜索词过滤：客户名称关键字命中（上下两表同时生效）', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-hit', customerName: '上海贸易', status: 5 }),
      makeQuote({ id: 'q-miss', customerName: '北京商贸', status: 5 }),
      makeQuote({ id: 'q-hit8', customerName: '上海贸易', status: 8 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('北京商贸')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('搜索客户/款式/订单号...'), { target: { value: '上海' } })
    await waitFor(() => expect(screen.queryByText('北京商贸')).toBeNull())
    const upper = getSection('已发货已收款订单')
    const lower = getSection('已对账订单')
    expect(upper.textContent).toContain('上海贸易')
    expect(lower.textContent).toContain('上海贸易')
  })

  it('搜索词过滤：订单号关键字命中', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-a', quote_number: '1111111111111111', customerName: '客户甲', status: 5 }),
      makeQuote({ id: 'q-b', quote_number: '2222222222222222', customerName: '客户甲', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('搜索客户/款式/订单号...'), { target: { value: '2222' } })
    await waitFor(() => expect(screen.getByText('(1个订单)')).toBeTruthy())
    const upper = getSection('已发货已收款订单')
    expect(upper.textContent).toContain('2222222222222222')
    expect(upper.textContent).not.toContain('1111111111111111')
  })

  /** 打开款式多选下拉并点选指定款式（antd Select 在 jsdom 中的交互） */
  const selectStyle = async (optionLabel: string) => {
    const styleRoot = document.querySelector('.style-multi-select')!
    // 先确保关闭（multiple 模式点击选项后下拉保持打开，再次 mousedown 会切换状态）
    fireEvent.mouseDown(document.body)
    fireEvent.mouseDown(styleRoot)
    const option = await screen.findByText(optionLabel, { selector: '.ant-select-item-option-content' })
    fireEvent.click(option)
  }

  it('款式过滤：选中单个款式后仅显示该款式订单', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-1', quote_number: '1111111111111111', customerName: '客户甲', productStyle: '1', status: 5 }),
      makeQuote({ id: 'q-2', quote_number: '2222222222222222', customerName: '客户甲', productStyle: '2', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())

    await selectStyle('有底无侧普通袋')
    await waitFor(() => expect(screen.getByText('(1个订单)')).toBeTruthy())
    const upper = getSection('已发货已收款订单')
    // 仅保留款式2订单，款式1订单被过滤
    expect(upper.textContent).toContain('2222222222222222')
    expect(upper.textContent).not.toContain('1111111111111111')
  })

  it('款式多选：同时选中两个款式时两款式订单均显示', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-1', quote_number: '1111111111111111', customerName: '客户甲', productStyle: '1', status: 5 }),
      makeQuote({ id: 'q-2', quote_number: '2222222222222222', customerName: '客户甲', productStyle: '2', status: 5 }),
      makeQuote({ id: 'q-3', quote_number: '3333333333333333', customerName: '客户甲', productStyle: '3', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(3个订单)')).toBeTruthy())

    await selectStyle('无底无侧普通袋')
    await selectStyle('有底无侧普通袋')
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())
    const upper = getSection('已发货已收款订单')
    expect(upper.textContent).toContain('1111111111111111')
    expect(upper.textContent).toContain('2222222222222222')
    expect(upper.textContent).not.toContain('3333333333333333')
  })

  it('做货日期区间过滤：仅显示区间内做货开始的订单', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-in', quote_number: '1111111111111111', customerName: '客户甲', productionStartTime: '2026-09-05', status: 5 }),
      makeQuote({ id: 'q-out', quote_number: '2222222222222222', customerName: '客户甲', productionStartTime: '2026-08-01', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())

    fireEvent.change(screen.getByTitle('做货开始日期（起）'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByTitle('做货开始日期（止）'), { target: { value: '2026-09-30' } })
    await waitFor(() => expect(screen.getByText('(1个订单)')).toBeTruthy())
    const upper = getSection('已发货已收款订单')
    expect(upper.textContent).toContain('1111111111111111')
    expect(upper.textContent).not.toContain('2222222222222222')
  })

  it('无匹配结果时两表均显示空提示', async () => {
    apiMock.quotes.getAll.mockResolvedValue([makeQuote({ status: 5, customerName: '测试客户A' })])
    renderPage()
    await waitFor(() => expect(screen.getByText('发起对账')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('搜索客户/款式/订单号...'), { target: { value: '不存在的客户' } })
    await waitFor(() => expect(screen.getByText('暂无待对账订单')).toBeTruthy())
    expect(screen.getByText('暂无已对账订单')).toBeTruthy()
  })

  it('有查询条件时显示清除按钮，点击后恢复全部数据', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-a', quote_number: '1111111111111111', customerName: '客户甲', status: 5 }),
      makeQuote({ id: 'q-b', quote_number: '2222222222222222', customerName: '客户甲', status: 5 }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())

    fireEvent.change(screen.getByPlaceholderText('搜索客户/款式/订单号...'), { target: { value: '1111' } })
    await waitFor(() => expect(screen.getByText('(1个订单)')).toBeTruthy())
    expect((screen.getByPlaceholderText('搜索客户/款式/订单号...') as HTMLInputElement).value).toBe('1111')

    fireEvent.click(screen.getByTitle('清除全部查询条件'))
    await waitFor(() => expect(screen.getByText('(2个订单)')).toBeTruthy())
    expect((screen.getByPlaceholderText('搜索客户/款式/订单号...') as HTMLInputElement).value).toBe('')
  })
})

describe('订单对账管理页 - 错误处理', () => {
  it('数据加载失败时显示错误信息', async () => {
    apiMock.quotes.getAll.mockRejectedValue(new Error('网络异常'))
    renderPage()
    await waitFor(() => expect(screen.getByText('网络异常')).toBeTruthy())
  })

  it('退回失败时显示操作错误（弹窗保留）', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      makeQuote({ id: 'q-fail', status: 8 }),
    ])
    apiMock.quotes.unreconcileQuote.mockRejectedValueOnce(new Error('退回失败'))
    renderPage()
    await waitFor(() => expect(screen.getByText('退回')).toBeTruthy())

    fireEvent.click(screen.getByText('退回'))
    fireEvent.click(screen.getByText('确认退回'))
    await waitFor(() => expect(screen.getByText('退回失败')).toBeTruthy())
    // 弹窗保留（未关闭）
    expect(screen.getByText('退回对账确认')).toBeTruthy()
  })
})
