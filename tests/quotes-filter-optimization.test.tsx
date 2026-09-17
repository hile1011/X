/**
 * 订单列表页查询功能优化 前端组件测试
 *
 * 测试目标：
 *   1. 日期筛选字段已移除（无 type=date 输入框）
 *   2. 工艺/面料筛选支持部分关键词模糊匹配（忽略大小写）
 *   3. 「更多」按钮：默认收起，点击展开扩展查询条件面板（产品规格/手提材质/手提规格/箱规/收货地址/备注）
 *   4. 扩展条件与主栏条件 AND 组合；收起面板后条件仍生效（按钮显示计数徽标）
 *   5. 一键清空扩展条件
 *
 * Mock 说明：
 *   - api：隔离网络（quotes/products），getThumbnailUrl 返回占位 URL
 *   - fetchStyleOptions / getStyleLabelFromProducts：返回固定款式映射
 *   - usePermission：默认放开全部权限
 *   - 路由：MemoryRouter 包裹
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
  quote_number: '1111111111111111',
  customerName: '测试客户',
  shippingAddress: '杭州市余杭区',
  productStyle: '1',
  productSpec: '30*40*10',
  fabricMaterial: '10安涤棉新本色',
  process: '单面数码uv印刷',
  handleMaterial: '帆布手提',
  handleSpec: '2.5cm',
  quantity: '1000',
  boxSpec: '50*40*30',
  remark: '加急订单',
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
  batchNumber: null as string | null,
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

// 三条差异化的订单数据：工艺/面料/备注各不相同
const orderA = { ...baseQuote }
const orderB = {
  ...baseQuote,
  id: 'quote-2',
  quote_number: '2222222222222222',
  process: '丝印',
  fabricMaterial: '帆布',
  remark: '常规订单',
}
const orderC = {
  ...baseQuote,
  id: 'quote-3',
  quote_number: '3333333333333333',
  fabricMaterial: 'Canvas Fabric',
  remark: '',
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/quotes']}>
      <Quotes />
    </MemoryRouter>
  )
}

/** 等待订单数据加载完成 */
async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByText('1111111111111111')).toBeTruthy()
  })
}

// ============================ 测试用例 ============================

describe('订单列表页 - 查询功能优化', () => {
  beforeEach(() => {
    cleanup()
    // 清除列表页持久化的查询条件（sessionStorage），避免用例间状态污染
    sessionStorage.clear()
    vi.clearAllMocks()
    apiMock.quotes.getAll.mockResolvedValue([orderA, orderB, orderC])
    apiMock.quotes.getImageFlags.mockResolvedValue({})
    apiMock.products.getAll.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
  })

  it('日期筛选字段已移除（筛选栏无 type=date 输入框）', async () => {
    const { container } = renderPage()
    await waitForLoaded()
    expect(container.querySelectorAll('input[type="date"]').length).toBe(0)
  })

  it('工艺筛选支持部分关键词模糊匹配', async () => {
    renderPage()
    await waitForLoaded()
    expect(screen.getByText('2222222222222222')).toBeTruthy()

    // 输入部分关键词 'uv'：命中"单面数码uv印刷"的订单A，丝印的订单B被过滤
    fireEvent.change(screen.getByPlaceholderText('工艺（模糊匹配）'), { target: { value: 'uv' } })
    await waitFor(() => {
      expect(screen.queryByText('2222222222222222')).toBeNull()
    })
    expect(screen.getByText('1111111111111111')).toBeTruthy()
    expect(screen.getByText('3333333333333333')).toBeTruthy()

    // 换关键词 '丝'：只命中订单B
    fireEvent.change(screen.getByPlaceholderText('工艺（模糊匹配）'), { target: { value: '丝' } })
    await waitFor(() => {
      expect(screen.queryByText('1111111111111111')).toBeNull()
    })
    expect(screen.getByText('2222222222222222')).toBeTruthy()
  })

  it('面料筛选模糊匹配忽略大小写', async () => {
    renderPage()
    await waitForLoaded()

    // 输入小写 'canvas' 命中大写 'Canvas Fabric' 的订单C
    fireEvent.change(screen.getByPlaceholderText('面料（模糊匹配）'), { target: { value: 'canvas' } })
    await waitFor(() => {
      expect(screen.queryByText('1111111111111111')).toBeNull()
      expect(screen.queryByText('2222222222222222')).toBeNull()
    })
    expect(screen.getByText('3333333333333333')).toBeTruthy()
  })

  it('「更多」面板默认收起，点击按钮展开扩展查询条件', async () => {
    renderPage()
    await waitForLoaded()

    // 默认收起：扩展条件输入框不存在
    expect(screen.queryByPlaceholderText('备注（模糊匹配）')).toBeNull()
    expect(screen.queryByPlaceholderText('产品规格（模糊匹配）')).toBeNull()

    // 点击「更多」展开
    fireEvent.click(screen.getByText('更多'))
    expect(screen.getByPlaceholderText('备注（模糊匹配）')).toBeTruthy()
    expect(screen.getByPlaceholderText('产品规格（模糊匹配）')).toBeTruthy()
    expect(screen.getByPlaceholderText('手提材质（模糊匹配）')).toBeTruthy()
    expect(screen.getByPlaceholderText('手提规格（模糊匹配）')).toBeTruthy()
    expect(screen.getByPlaceholderText('箱规（模糊匹配）')).toBeTruthy()
    expect(screen.getByPlaceholderText('收货地址（模糊匹配）')).toBeTruthy()
  })

  it('扩展条件（备注）模糊过滤订单', async () => {
    renderPage()
    await waitForLoaded()
    fireEvent.click(screen.getByText('更多'))

    // 备注输入 '加急'：只命中订单A（订单C 备注为空）
    fireEvent.change(screen.getByPlaceholderText('备注（模糊匹配）'), { target: { value: '加急' } })
    await waitFor(() => {
      expect(screen.queryByText('2222222222222222')).toBeNull()
      expect(screen.queryByText('3333333333333333')).toBeNull()
    })
    expect(screen.getByText('1111111111111111')).toBeTruthy()
  })

  it('主栏条件与扩展条件 AND 组合查询', async () => {
    renderPage()
    await waitForLoaded()
    fireEvent.click(screen.getByText('更多'))

    // 工艺 'uv'（命中A/C）+ 备注 '加急'（命中A）→ 交集仅A
    fireEvent.change(screen.getByPlaceholderText('工艺（模糊匹配）'), { target: { value: 'uv' } })
    fireEvent.change(screen.getByPlaceholderText('备注（模糊匹配）'), { target: { value: '加急' } })
    await waitFor(() => {
      expect(screen.queryByText('2222222222222222')).toBeNull()
      expect(screen.queryByText('3333333333333333')).toBeNull()
    })
    expect(screen.getByText('1111111111111111')).toBeTruthy()

    // 工艺 '丝'（命中B）+ 备注 '加急'（命中A）→ 交集为空
    fireEvent.change(screen.getByPlaceholderText('工艺（模糊匹配）'), { target: { value: '丝' } })
    await waitFor(() => {
      expect(screen.queryByText('1111111111111111')).toBeNull()
      expect(screen.queryByText('2222222222222222')).toBeNull()
    })
  })

  it('收起面板后扩展条件仍生效，按钮显示启用计数', async () => {
    const { container } = renderPage()
    await waitForLoaded()
    fireEvent.click(screen.getByText('更多'))
    fireEvent.change(screen.getByPlaceholderText('备注（模糊匹配）'), { target: { value: '加急' } })
    await waitFor(() => {
      expect(screen.queryByText('2222222222222222')).toBeNull()
    })

    // 收起面板：输入框隐藏但过滤仍生效，「更多」按钮显示计数徽标（amber 圆点）
    fireEvent.click(screen.getByText('更多'))
    expect(screen.queryByPlaceholderText('备注（模糊匹配）')).toBeNull()
    expect(screen.queryByText('2222222222222222')).toBeNull()
    const badge = container.querySelector('button [class*="bg-amber-500"]')
    expect(badge?.textContent).toBe('1')
    expect(screen.getByText('1111111111111111')).toBeTruthy()
  })

  it('一键清空扩展条件后恢复完整列表', async () => {
    renderPage()
    await waitForLoaded()
    fireEvent.click(screen.getByText('更多'))
    fireEvent.change(screen.getByPlaceholderText('备注（模糊匹配）'), { target: { value: '加急' } })
    fireEvent.change(screen.getByPlaceholderText('箱规（模糊匹配）'), { target: { value: '50' } })
    await waitFor(() => {
      expect(screen.queryByText('2222222222222222')).toBeNull()
    })

    // 清空两个扩展条件
    fireEvent.click(screen.getByText('清空扩展条件（2）'))
    await waitFor(() => {
      expect(screen.getByText('1111111111111111')).toBeTruthy()
      expect(screen.getByText('2222222222222222')).toBeTruthy()
      expect(screen.getByText('3333333333333333')).toBeTruthy()
    })
  })
})
