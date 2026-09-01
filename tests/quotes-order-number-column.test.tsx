/**
 * 订单列表页（Quotes.tsx）订单号列 前端组件测试
 *
 * 测试目标（对应需求）：
 *   1. 订单号列位于第一数据列（产品图之后、"款式"列之前）
 *   2. 数据行正确渲染 16 位随机订单号
 *   3. 旧格式订单号（客户-款式-时间戳）兼容显示
 *   4. 复制按钮触发 api.quotes.copy（复制=新增订单逻辑，由后端生成新订单号）
 *   5. 搜索框支持按订单号过滤
 *
 * Mock 说明：
 *   - api：隔离网络（quotes/products/export），getThumbnailUrl 返回占位 URL
 *   - fetchStyleOptions / getStyleLabelFromProducts：返回固定款式映射
 *   - usePermission：默认放开全部权限
 *   - 路由：MemoryRouter 包裹（页面使用 useNavigate/useSearchParams）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Quotes from '../src/pages/Quotes'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  quotes: {
    getAll: vi.fn(),
    getImageFlags: vi.fn(),
    getThumbnailUrl: vi.fn(() => '/thumb.png'),
    getById: vi.fn(),
    copy: vi.fn(),
    delete: vi.fn(),
    deleteCheck: vi.fn(),
  },
  products: {
    getAll: vi.fn(),
  },
  export: {
    orders: vi.fn(),
    paymentReceipts: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({ api: apiMock, downloadBlob: vi.fn() }))
vi.mock('../src/services/productStyles', () => ({
  fetchStyleOptions: vi.fn(async () => [
    { value: '1', label: '无底无侧普通袋' },
    { value: '3', label: '有底有侧普通袋' },
  ]),
  getStyleLabelFromProducts: vi.fn((_products: unknown, style: string) =>
    style === '3' ? '有底有侧普通袋' : '无底无侧普通袋'
  ),
}))
vi.mock('../src/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: () => true }),
  useHasPermission: () => true,
}))
vi.mock('../src/utils/clipboard', () => ({ copyText: vi.fn() }))

// ============================ 测试数据 ============================

const baseQuote = {
  id: 'quote-1',
  user_id: 'u1',
  customer_id: 'c1',
  quote_number: '1234567890123456',
  customerName: '测试客户',
  shippingAddress: '',
  productStyle: '3',
  productSpec: '30*40*10',
  fabricMaterial: '无纺布',
  process: '丝印',
  handleMaterial: '',
  handleSpec: '',
  quantity: '1000',
  boxSpec: '',
  remark: '',
  sampleFee: '0',
  sampleDays: '7',
  massDays: '15',
  unitPrice: '3.5',
  productionTimeStart: '2026-08-01',
  productionTimeEnd: '2026-08-15',
  costPrice: 2.5,
  priceWithTax: 4,
  sellPriceNoTax: 3.5,
  sellPriceWithTax: 3.9,
  status: 1 as const,
  quoteTime: '2026-08-01 10:00:00',
  sampleTime: '',
  sampleCompletedTime: '',
  productionStartTime: '',
  shippingTime: '',
  paymentTime: '',
  endTime: '',
  images: [] as string[],
  created_at: '2026-08-01 10:00:00',
  updated_at: '2026-08-01 10:00:00',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quotes']}>
      <Quotes />
    </MemoryRouter>
  )
}

// ============================ 测试用例 ============================

describe('订单列表页 - 订单号列', () => {
  beforeEach(() => {
    cleanup()
    // 清除列表页持久化的查询条件（sessionStorage），避免用例间状态污染
    sessionStorage.clear()
    vi.clearAllMocks()
    apiMock.quotes.getAll.mockResolvedValue([baseQuote])
    apiMock.quotes.getImageFlags.mockResolvedValue({})
    apiMock.products.getAll.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
  })

  it('表头包含"订单号"列', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('订单号')).toBeTruthy()
    })
  })

  it('订单号列位于"款式"列之前（第一数据列）', async () => {
    const { container } = renderPage()
    await waitFor(() => {
      expect(screen.getByText('1234567890123456')).toBeTruthy()
    })

    // 表头顺序：产品图(空) → 订单号 → 款式
    const headerCells = Array.from(container.querySelectorAll('.sticky > div > div'))
    const headers = headerCells.map((el) => el.textContent?.trim() || '')
    const orderNoIdx = headers.indexOf('订单号')
    const styleIdx = headers.indexOf('款式')
    expect(orderNoIdx).toBeGreaterThan(-1)
    expect(styleIdx).toBeGreaterThan(-1)
    expect(orderNoIdx).toBeLessThan(styleIdx)
  })

  it('数据行渲染 16 位随机订单号', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('1234567890123456')).toBeTruthy()
    })
  })

  it('旧格式订单号（客户-款式-时间戳）兼容显示', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      { ...baseQuote, id: 'quote-legacy', quote_number: '老客户-无底无侧普通袋-20260101120000' },
    ])
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('老客户-无底无侧普通袋-20260101120000')).toBeTruthy()
    })
  })

  it('多个订单的订单号分别渲染，互不混淆', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      baseQuote,
      { ...baseQuote, id: 'quote-2', quote_number: '9876543210987654' },
    ])
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('1234567890123456')).toBeTruthy()
    })
    expect(screen.getByText('9876543210987654')).toBeTruthy()
  })

  it('搜索框按订单号过滤订单', async () => {
    apiMock.quotes.getAll.mockResolvedValue([
      baseQuote,
      { ...baseQuote, id: 'quote-2', quote_number: '9876543210987654', customerName: '客户乙' },
    ])
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('1234567890123456')).toBeTruthy()
    })

    // 输入订单号后，仅匹配的订单保留
    const searchInput = screen.getByPlaceholderText(/搜索/)
    fireEvent.change(searchInput, { target: { value: '9876543210987654' } })
    await waitFor(() => {
      expect(screen.queryByText('1234567890123456')).toBeNull()
    })
    expect(screen.getByText('9876543210987654')).toBeTruthy()
  })

  it('点击复制按钮触发 api.quotes.copy（后端生成全新订单号）', async () => {
    apiMock.quotes.copy.mockResolvedValue({ ...baseQuote, id: 'quote-copied', quote_number: '5555555555555555' })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('1234567890123456')).toBeTruthy()
    })

    const copyBtn = screen.getAllByTitle('复制订单')[0]
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(apiMock.quotes.copy).toHaveBeenCalledWith('quote-1')
    })
  })
})
