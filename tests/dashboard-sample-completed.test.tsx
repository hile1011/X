/**
 * Dashboard 打样完成提醒模块单元测试
 *
 * 测试目标：
 *   1. 空状态：无 status=7 订单时整个模块隐藏（不渲染）
 *   2. 列表渲染：有 status=7 订单时显示客户名-款式-数量、打样完成时间
 *   3. 智能排序：1) 订单金额降序 2) 打样完成时间降序
 *   4. 快捷操作：做货（调用 nextStatus API）、查看详情（导航）、查看全部（导航）
 *   5. 订单数量徽章：显示正确数量
 *
 * 环境要求：jsdom（tests/setup.ts）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Dashboard from '../src/pages/Dashboard'

// ============================================================
// 类型定义（与 Dashboard 内部 Quote 接口对齐）
// ============================================================
interface MockQuote {
  id: string
  quote_number: string
  customerName: string
  customer_id: string
  productStyle: string
  productSpec: string
  quantity: string
  productionTimeStart: string
  productionTimeEnd: string
  status: number
  costPrice: number
  priceWithTax: number
  sellPriceNoTax: number
  sellPriceWithTax: number
  quoteTime: string
  sampleTime: string
  sampleCompletedTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
  endTime: string
  images?: string[]
  updated_at: string
}

// ============================================================
// Mock API
// ============================================================
const apiMock = vi.hoisted(() => ({
  quotes: {
    getAll: vi.fn(),
    getImageFlags: vi.fn(),
    nextStatus: vi.fn(),
  },
  products: {
    getAll: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({
  api: apiMock,
}))

// ============================================================
// 测试数据
// ============================================================
const mockProducts = [
  { id: 'style-1', name: '无底无侧普通袋', sku: 'SKU-001', code: '1', price: 10, stock: 100, category: '袋', description: '' },
  { id: 'style-2', name: '有底无侧普通袋', sku: 'SKU-002', code: '2', price: 20, stock: 200, category: '袋', description: '' },
]

function makeQuote(overrides: Partial<MockQuote>): MockQuote {
  return {
    id: 'q-001',
    quote_number: 'Q20260812001',
    customerName: '测试客户A',
    customer_id: 'cust-001',
    productStyle: '1',
    productSpec: '30x40',
    quantity: '1000',
    productionTimeStart: '',
    productionTimeEnd: '',
    status: 7,
    costPrice: 3.5,
    priceWithTax: 4.5,
    sellPriceNoTax: 5.0,
    sellPriceWithTax: 5.5,
    quoteTime: '2026-08-10',
    sampleTime: '2026-08-11',
    sampleCompletedTime: '2026-08-12',
    productionStartTime: '',
    shippingTime: '',
    paymentTime: '',
    endTime: '',
    updated_at: '2026-08-12T10:00:00Z',
    ...overrides,
  }
}

const sampleCompletedQuotes: MockQuote[] = [
  // 金额：1000 × 5.5 = 5500，打样完成时间较晚
  makeQuote({
    id: 'q-100',
    customerName: '客户C-高金额晚完成',
    quantity: '1000',
    sellPriceWithTax: 5.5,
    sampleCompletedTime: '2026-08-12',
  }),
  // 金额：2000 × 3.0 = 6000，打样完成时间较早（金额更高，应排前面）
  makeQuote({
    id: 'q-200',
    customerName: '客户B-最高金额早完成',
    quantity: '2000',
    sellPriceWithTax: 3.0,
    sampleCompletedTime: '2026-08-10',
  }),
  // 金额：500 × 5.5 = 2750，打样完成时间最晚（金额最低，应排最后）
  makeQuote({
    id: 'q-300',
    customerName: '客户A-低金额最晚完成',
    quantity: '500',
    sellPriceWithTax: 5.5,
    sampleCompletedTime: '2026-08-13',
  }),
  // 金额：1000 × 5.5 = 5500，打样完成时间更晚（与 q-100 金额相同，时间更晚应排前面）
  makeQuote({
    id: 'q-400',
    customerName: '客户D-同金额最晚完成',
    quantity: '1000',
    sellPriceWithTax: 5.5,
    sampleCompletedTime: '2026-08-14',
  }),
]

// 非打样完成状态的订单（不应出现在提醒模块中）
const otherQuotes: MockQuote[] = [
  makeQuote({ id: 'q-500', status: 1, customerName: '报价中客户' }),
  makeQuote({ id: 'q-600', status: 2, customerName: '打样中客户' }),
  makeQuote({ id: 'q-700', status: 3, customerName: '做货中客户' }),
  makeQuote({ id: 'q-800', status: 6, customerName: '已结束客户' }),
]

// ============================================================
// 渲染辅助
// ============================================================
function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/quotes" element={<div data-testid="quotes-page">报价列表页</div>} />
        <Route path="/quotes/:id" element={<div data-testid="quote-detail">报价详情页</div>} />
        <Route path="/customers" element={<div data-testid="customers-page">客户列表页</div>} />
        <Route path="/customers/:id" element={<div data-testid="customer-detail">客户详情页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 从"打样完成提醒"标题找到模块卡片容器 */
function getModuleCard(): HTMLElement {
  const title = screen.getByText('打样完成提醒')
  return title.closest('div.bg-white.rounded-xl')!
}

/** 获取模块内所有订单行的客户信息文本（按渲染顺序） */
function getModuleCustomerTexts(): string[] {
  const card = getModuleCard()
  const rows = card.querySelectorAll('.border-l-4')
  return Array.from(rows).map((row) => {
    const info = row.querySelector('.text-sm.text-gray-700')
    return info?.textContent || ''
  })
}

// ============================================================
// 测试
// ============================================================
beforeEach(() => {
  vi.clearAllMocks()
  apiMock.quotes.getAll.mockResolvedValue([])
  apiMock.quotes.getImageFlags.mockResolvedValue({})
  apiMock.products.getAll.mockResolvedValue(mockProducts)
})

afterEach(() => {
  cleanup()
})

describe('Dashboard 打样完成提醒模块', () => {
  describe('空状态', () => {
    it('无 status=7 订单时整个模块不渲染', async () => {
      apiMock.quotes.getAll.mockResolvedValue(otherQuotes)
      renderDashboard()

      // 等待数据加载完成
      await waitFor(() => {
        expect(apiMock.quotes.getAll).toHaveBeenCalled()
      })
      // 模块标题不应存在
      expect(screen.queryByText('打样完成提醒')).toBeNull()
    })

    it('空数组时整个模块不渲染', async () => {
      apiMock.quotes.getAll.mockResolvedValue([])
      renderDashboard()

      await waitFor(() => {
        expect(apiMock.quotes.getAll).toHaveBeenCalled()
      })
      expect(screen.queryByText('打样完成提醒')).toBeNull()
    })
  })

  describe('列表渲染', () => {
    it('显示模块标题"打样完成提醒"', async () => {
      apiMock.quotes.getAll.mockResolvedValue(sampleCompletedQuotes)
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('打样完成提醒')).toBeTruthy()
      })
    })

    it('显示订单数量徽章', async () => {
      apiMock.quotes.getAll.mockResolvedValue(sampleCompletedQuotes)
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('4 笔')).toBeTruthy()
      })
    })

    it('渲染所有打样完成订单的客户名称', async () => {
      apiMock.quotes.getAll.mockResolvedValue(sampleCompletedQuotes)
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText(/客户B-最高金额早完成/)).toBeTruthy()
      })
      expect(screen.getByText(/客户D-同金额最晚完成/)).toBeTruthy()
      expect(screen.getByText(/客户C-高金额晚完成/)).toBeTruthy()
      expect(screen.getByText(/客户A-低金额最晚完成/)).toBeTruthy()
    })

    it('客户信息包含款式和数量', async () => {
      apiMock.quotes.getAll.mockResolvedValue([sampleCompletedQuotes[0]])
      renderDashboard()

      // 客户C-高金额晚完成-无底无侧普通袋-1000个
      await waitFor(() => {
        expect(screen.getByText(/客户C-高金额晚完成.*无底无侧普通袋.*1000个/)).toBeTruthy()
      })
    })

    it('不渲染非打样完成状态的订单', async () => {
      apiMock.quotes.getAll.mockResolvedValue([...sampleCompletedQuotes, ...otherQuotes])
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('打样完成提醒')).toBeTruthy()
      })
      // 非打样完成的客户名不应出现在打样完成模块中
      const card = getModuleCard()
      const cardText = card.textContent || ''
      expect(cardText).not.toContain('报价中客户')
      expect(cardText).not.toContain('做货中客户')
    })

    it('显示打样完成时间', async () => {
      apiMock.quotes.getAll.mockResolvedValue([sampleCompletedQuotes[0]])
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText('打样完成提醒')).toBeTruthy()
      })
      // 时间用 formatDate（toLocaleDateString('zh-CN')）格式化
      const expectedDate = new Date('2026-08-12').toLocaleDateString('zh-CN')
      const card = getModuleCard()
      expect(card.textContent).toContain(expectedDate)
    })
  })

  describe('智能排序', () => {
    it('按订单金额降序排列（金额高的在前）', async () => {
      apiMock.quotes.getAll.mockResolvedValue(sampleCompletedQuotes)
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText(/客户B-最高金额早完成/)).toBeTruthy()
      })

      const customerTexts = getModuleCustomerTexts()

      // 排序预期：金额 6000 → 5500(晚) → 5500(早) → 2750
      expect(customerTexts[0]).toMatch(/客户B-最高金额早完成/)
      expect(customerTexts[1]).toMatch(/客户D-同金额最晚完成/)
      expect(customerTexts[2]).toMatch(/客户C-高金额晚完成/)
      expect(customerTexts[3]).toMatch(/客户A-低金额最晚完成/)
    })

    it('金额相同时按打样完成时间降序（最新优先）', async () => {
      // 两个金额相同的订单
      const sameAmount = [
        makeQuote({ id: 'q-1', customerName: '早完成客户', quantity: '1000', sellPriceWithTax: 5.5, sampleCompletedTime: '2026-08-10' }),
        makeQuote({ id: 'q-2', customerName: '晚完成客户', quantity: '1000', sellPriceWithTax: 5.5, sampleCompletedTime: '2026-08-15' }),
      ]
      apiMock.quotes.getAll.mockResolvedValue(sameAmount)
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText(/早完成客户/)).toBeTruthy()
      })

      const customerTexts = getModuleCustomerTexts()

      // 晚完成（8/15）应排前面
      expect(customerTexts[0]).toMatch(/晚完成客户/)
      expect(customerTexts[1]).toMatch(/早完成客户/)
    })

    it('无 sampleCompletedTime 的订单排在有时间的之后', async () => {
      const mixedTime = [
        makeQuote({ id: 'q-1', customerName: '有时间客户', quantity: '1000', sellPriceWithTax: 5.5, sampleCompletedTime: '2026-08-10' }),
        makeQuote({ id: 'q-2', customerName: '无时间客户', quantity: '1000', sellPriceWithTax: 5.5, sampleCompletedTime: '' }),
      ]
      apiMock.quotes.getAll.mockResolvedValue(mixedTime)
      renderDashboard()

      await waitFor(() => {
        expect(screen.getByText(/有时间客户/)).toBeTruthy()
      })

      const customerTexts = getModuleCustomerTexts()

      // 有时间的（time > 0）应排在无时间的（time = 0）前面
      expect(customerTexts[0]).toMatch(/有时间客户/)
      expect(customerTexts[1]).toMatch(/无时间客户/)
    })
  })

  describe('快捷操作', () => {
    it('"做货"按钮调用 api.quotes.nextStatus', async () => {
      apiMock.quotes.getAll.mockResolvedValue([sampleCompletedQuotes[0]])
      renderDashboard()

      const confirmButton = await screen.findByText('做货')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(apiMock.quotes.nextStatus).toHaveBeenCalledWith('q-100')
      })
    })

    it('"做货"后跳转到订单编辑页', async () => {
      apiMock.quotes.getAll.mockResolvedValue([sampleCompletedQuotes[0]])
      apiMock.quotes.nextStatus.mockResolvedValue({ status: 3 })
      renderDashboard()

      const confirmButton = await screen.findByText('做货')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        // 做货后应跳转到 /quotes/:id 编辑页
        expect(screen.getByTestId('quote-detail')).toBeTruthy()
      })
    })

    it('"查看全部"按钮导航到 /quotes', async () => {
      apiMock.quotes.getAll.mockResolvedValue([sampleCompletedQuotes[0]])
      renderDashboard()

      // 等待打样完成提醒模块渲染
      await screen.findByText('打样完成提醒')
      // 在模块内查找"查看全部"按钮（页面中有多个"查看全部"）
      const card = getModuleCard()
      const viewAllButton = within(card).getByText('查看全部')
      fireEvent.click(viewAllButton)

      await waitFor(() => {
        expect(screen.getByTestId('quotes-page')).toBeTruthy()
      })
    })

    it('"详情"按钮（Eye 图标）导航到 /quotes/:id', async () => {
      apiMock.quotes.getAll.mockResolvedValue([sampleCompletedQuotes[0]])
      renderDashboard()

      await screen.findByText('打样完成提醒')
      // Eye 图标按钮通过 title 属性查找
      const card = getModuleCard()
      const detailButton = within(card).getByTitle('查看订单详情')
      fireEvent.click(detailButton)

      await waitFor(() => {
        expect(screen.getByTestId('quote-detail')).toBeTruthy()
      })
    })
  })

  describe('数据过滤', () => {
    it('仅显示 status=7 的订单，排除其他状态', async () => {
      const mixed = [
        ...sampleCompletedQuotes.slice(0, 2),
        ...otherQuotes,
      ]
      apiMock.quotes.getAll.mockResolvedValue(mixed)
      renderDashboard()

      await waitFor(() => {
        // 只有 2 笔打样完成
        expect(screen.getByText('2 笔')).toBeTruthy()
      })
    })
  })
})
