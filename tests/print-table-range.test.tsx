/**
 * 打印表格范围截断 + 打印预览布局单元测试
 *
 * 测试目标：
 *   1. isTableTitleRow：标题行识别（第一列无值且其他列有值，与在线表格蓝底标题行规则一致）
 *   2. getPrintTableRows：截断到第二个标题行之前（不含该标题行及其之后内容）
 *   3. PrintPreviewModal 布局：时间信息移至产品信息前、订单号+状态移入产品信息框第一行
 *   4. 打印表格渲染：仅渲染第二个标题行之前内容，标题行保留蓝底白字样式
 *
 * 环境要求：jsdom（tests/setup.ts）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { PrintPreviewModal } from '../src/components/PrintPreviewModal'
import { isTableTitleRow, getPrintTableRows } from '../src/utils/printTableRange'
import type { Quote } from '../src/pages/Quotes'

// ============================================================
// 测试数据
// ============================================================

// 与款式1内置模板同构的表格数据：标题行（第一列无值且其他列有值）位于第0、4行
const STYLE1_TABLE: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 2160, 3.7561, 90.7, 12342.86],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.67, 169.34, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.41, 4.4, 1.41, 0.05, 0.1, 725.76, 1.03, 2.65, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 2.97, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 3240, null, null, null, null, null, null],
]

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'q-001',
    user_id: 'user-001',
    customer_id: 'cust-001',
    quote_number: '上海科技-20260901100000-无底无侧普通袋',
    customerName: '上海科技有限公司',
    shippingAddress: '上海市浦东新区',
    productStyle: '1',
    productSpec: '38*40*0',
    fabricMaterial: '10安涤棉新本色',
    process: '单面数码uv印刷',
    handleMaterial: '帆布手提',
    handleSpec: '',
    quantity: '7200',
    boxSpec: '',
    remark: '测试备注',
    sampleFee: '500',
    sampleDays: '7',
    massDays: '15',
    unitPrice: '',
    productionTimeStart: '2026-09-01',
    productionTimeEnd: '2026-09-16',
    costPrice: 2.97,
    priceWithTax: 3.27,
    sellPriceNoTax: 3.42,
    sellPriceWithTax: 3.76,
    status: 1,
    quoteTime: '2026-09-01T10:00:00Z',
    sampleTime: '',
    sampleCompletedTime: '',
    productionStartTime: '',
    shippingTime: '',
    paymentTime: '',
    endTime: '',
    images: [],
    tableData: STYLE1_TABLE,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

// jsdom 未实现 window.open/alert，mock 后走「弹窗被拦截」分支，仅验证隐藏渲染的 DOM 内容
const openMock = vi.fn(() => null)
const alertMock = vi.fn()

beforeEach(() => {
  openMock.mockClear()
  alertMock.mockClear()
  vi.stubGlobal('open', openMock)
  vi.stubGlobal('alert', alertMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ============================================================
// 纯函数：isTableTitleRow
// ============================================================
describe('isTableTitleRow 标题行识别', () => {
  it('第一列无值且其他列有值 → 标题行', () => {
    expect(isTableTitleRow([null, '数量', '宽'])).toBe(true)
    expect(isTableTitleRow(['', '加工费', null, '布料价格'])).toBe(true)
    expect(isTableTitleRow([null, 7200, '数量'])).toBe(true)
  })

  it('第一列有值 → 非标题行', () => {
    expect(isTableTitleRow(['成品', 7200, 38])).toBe(false)
    expect(isTableTitleRow(['汇总', null, null])).toBe(false)
  })

  it('整行无值 → 非标题行（空行）', () => {
    expect(isTableTitleRow([null, null, ''])).toBe(false)
    expect(isTableTitleRow(['', ' ', null])).toBe(false)
    expect(isTableTitleRow([])).toBe(false)
  })

  it('null/undefined 安全', () => {
    expect(isTableTitleRow(null)).toBe(false)
    expect(isTableTitleRow(undefined)).toBe(false)
  })

  it('第一列纯空格视为无值', () => {
    expect(isTableTitleRow([' ', '数量'])).toBe(true)
  })
})

// ============================================================
// 纯函数：getPrintTableRows
// ============================================================
describe('getPrintTableRows 打印范围截断', () => {
  it('截断到第二个标题行之前：保留第0-3行，排除加工费标题行及其后内容', () => {
    const rows = getPrintTableRows(STYLE1_TABLE)
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r[0])).toEqual([null, '成品', '正反面', '手提'])
    expect(rows[0][1]).toBe('数量 (个)') // 第一个标题行保留
  })

  it('第二个标题行及其后内容不包含：加工费/汇总/参考卖价/利润', () => {
    const rows = getPrintTableRows(STYLE1_TABLE)
    const flat = rows.flat().map((c) => String(c))
    expect(flat).not.toContain('加工费(元/个)')
    expect(flat).not.toContain('参考卖价')
    expect(flat).not.toContain('利润')
    expect(flat).not.toContain('汇总')
  })

  it('仅1个标题行 → 返回全部非空行（不截断）', () => {
    const data = [
      [null, '列1', '列2'],
      ['成品', 1, 2],
    ]
    expect(getPrintTableRows(data)).toHaveLength(2)
  })

  it('无标题行 → 返回全部非空行（不截断）', () => {
    const data = [
      ['成品', 1],
      ['正反面', 2],
    ]
    expect(getPrintTableRows(data)).toHaveLength(2)
  })

  it('第一个标题行不在首行时仍正确定位第二个标题行', () => {
    const data = [
      ['成品', 1, 2],      // 非标题行
      [null, 'A', 'B'],    // 第一个标题行
      ['行', 3, 4],
      [null, 'C', 'D'],    // 第二个标题行 → 截断
      ['汇总', 5, 6],
    ]
    const rows = getPrintTableRows(data)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r[0])).toEqual(['成品', null, '行'])
  })

  it('过滤全空行后再定位截断', () => {
    const data = [
      [null, '数量', '宽'],
      ['成品', 1, 2],
      [null, null, null],      // 空行被过滤
      [null, '加工费', '布料'], // 第二个标题行
      ['汇总', null, 3],
    ]
    const rows = getPrintTableRows(data)
    expect(rows).toHaveLength(2)
  })

  it('连续两个标题行：仅保留第一个标题行', () => {
    const data = [
      [null, 'A', 'B'],
      [null, 'C', 'D'],
      ['行', 1, 2],
    ]
    expect(getPrintTableRows(data)).toHaveLength(1)
  })

  it('null/undefined/空数组 → 空数组', () => {
    expect(getPrintTableRows(null)).toEqual([])
    expect(getPrintTableRows(undefined)).toEqual([])
    expect(getPrintTableRows([])).toEqual([])
  })
})

// ============================================================
// 组件：打印预览布局
// ============================================================
describe('PrintPreviewModal 打印预览布局', () => {
  it('区块顺序：客户信息 → 时间信息 → 产品信息', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    // 打印内容根节点为 aria-hidden（隐藏渲染），需 hidden: true 才能查询角色
    const headings = screen.getAllByRole('heading', { hidden: true }).map((h) => (h.textContent ?? '').trim())
    const customerIdx = headings.indexOf('客户信息')
    const timeIdx = headings.indexOf('时间信息')
    const productIdx = headings.indexOf('产品信息')
    expect(customerIdx).toBeGreaterThanOrEqual(0)
    expect(timeIdx).toBeGreaterThan(customerIdx)
    expect(productIdx).toBeGreaterThan(timeIdx)
  })

  it('订单号 + 状态位于产品信息框第一行', () => {
    const quote = makeQuote()
    render(<PrintPreviewModal quote={quote} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    const productSection = screen.getByText('产品信息').closest('div')
    expect(productSection).toBeTruthy()
    const section = productSection as HTMLElement
    // 订单号在产品信息框内
    const orderNo = within(section).getByText(quote.quote_number)
    expect(orderNo).toBeTruthy()
    // 状态徽章（status=1 → 报价中）也在产品信息框内
    expect(within(section).getByText('报价中')).toBeTruthy()
    // 订单号是产品信息框第一行：位于款式值之前
    const styleText = within(section).getByText('无底无侧普通袋')
    expect(orderNo.compareDocumentPosition(styleText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('订单号仅出现一次（原顶部订单号区块已移除）', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    expect(screen.getAllByText('订单号：')).toHaveLength(1)
  })

  it('产品信息框内显示备注，单价字段不再展示', () => {
    const quote = makeQuote({ remark: '测试备注' })
    render(<PrintPreviewModal quote={quote} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    // 备注在产品信息框内
    const productSection = screen.getByText('产品信息').closest('div') as HTMLElement
    expect(within(productSection).getByText('测试备注')).toBeTruthy()
    expect(within(productSection).getByText('备注：')).toBeTruthy()
    // 单价字段已移除
    expect(screen.queryByText('单价：')).toBeNull()
    // 底部原独立备注区块已移除（备注内容不重复出现）
    expect(screen.getAllByText('测试备注')).toHaveLength(1)
  })
})

// ============================================================
// 组件：打印表格截断渲染
// ============================================================
describe('PrintPreviewModal 打印表格截断渲染', () => {
  it('仅渲染第二个标题行之前的内容', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    // 第一个标题行及参数区内容保留
    expect(screen.getByText('数量 (个)')).toBeTruthy()
    expect(screen.getByText('成品')).toBeTruthy()
    expect(screen.getAllByText('正反面')).toHaveLength(1) // 截断后仅1处（原表格出现2次）
    // 第二个标题行及其后内容不渲染
    expect(screen.queryByText('加工费(元/个)')).toBeNull()
    expect(screen.queryByText('汇总')).toBeNull()
    expect(screen.queryByText('利润')).toBeNull()
  })

  it('数值保留2位小数（保留原有格式化规则）', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    // 成品/正反面/手提三行的数量列均为 7200 → '7200.00' 恰好出现 3 次（也验证截断：第二个分区行未渲染）
    expect(screen.getAllByText('7200.00')).toHaveLength(3)
  })

  it('标题行保留蓝底白字样式（与在线表格一致）', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    const td = screen.getByText('数量 (个)').closest('td')
    expect(td).toBeTruthy()
    expect((td as HTMLElement).style.backgroundColor).toBe('rgb(68, 114, 196)')
    expect((td as HTMLElement).style.color).toBe('rgb(255, 255, 255)')
  })

  it('标题行长文本允许换行完整展示（不省略截断）', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    // 窄列中的长标题（"门幅最大面数(个)"）应允许换行而非 ellipsis 截断
    const td = screen.getByText('门幅最大面数(个)').closest('td')
    expect(td).toBeTruthy()
    const s = (td as HTMLElement).style
    expect(s.whiteSpace).toBe('normal')
    expect(s.overflowWrap).toBe('break-word')
    expect(s.textAlign).toBe('center')
  })

  it('非标题行数值也允许换行完整展示（不省略截断）', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    const td = screen.getByText('成品').closest('td')
    expect(td).toBeTruthy()
    const s = (td as HTMLElement).style
    expect(s.whiteSpace).toBe('normal')
    expect(s.overflowWrap).toBe('break-word')
    expect(s.wordBreak).toBe('break-all')
    // 非标题行不应用蓝底覆盖
    expect(s.backgroundColor).toBe('')
  })

  it('非标题行无背景色覆盖', () => {
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    const td = screen.getByText('成品').closest('td')
    expect(td).toBeTruthy()
    expect((td as HTMLElement).style.backgroundColor).toBe('')
  })

  it('仅1个标题行时不截断，渲染全部行', () => {
    const data = [
      [null, '列1', '列2'],
      ['成品', 1, 2],
    ]
    render(<PrintPreviewModal quote={makeQuote({ tableData: data })} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    expect(screen.getByText('数量', { exact: false })).toBeTruthy()
    expect(screen.getByText('成品')).toBeTruthy()
  })

  it('无表格数据时不渲染在线表格区块', () => {
    render(<PrintPreviewModal quote={makeQuote({ tableData: [] })} styleLabel="无底无侧普通袋" onClose={vi.fn()} />)
    expect(screen.queryByText('在线表格')).toBeNull()
  })
})

// ============================================================
// 组件：弹窗拦截降级
// ============================================================
describe('PrintPreviewModal 弹窗被拦截', () => {
  it('提示用户并回调 onClose（不抛错）', () => {
    const onClose = vi.fn()
    render(<PrintPreviewModal quote={makeQuote()} styleLabel="无底无侧普通袋" onClose={onClose} />)
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    // 隐藏渲染的 DOM 依然存在（供测试断言）
    expect(screen.getByText('客户信息')).toBeTruthy()
  })
})
