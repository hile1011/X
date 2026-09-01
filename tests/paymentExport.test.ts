/**
 * 收款单导出功能 单元测试
 *
 * 测试目标：api/services/paymentExport.ts
 *
 * 核心验证点：
 * 1. 精度工具：round2 四舍五入、parseQuantity 数量解析
 * 2. 日期格式化：formatPaymentDate / formatPaymentDateRange（含空值）
 * 3. 文件名 & 工作表名：buildPaymentFileName / sanitizeSheetName
 * 4. 汇总计算：calculatePaymentSummary（前后端共用，精度一致性）
 * 5. 客户分组：groupOrdersByCustomer（保持首次出现顺序）
 * 6. 文件标签决策：decidePaymentFileLabel（单客户/多客户/无筛选）
 * 7. 缩略图生成：generateThumbnailBuffer（base64 → 80×80 JPEG Buffer）
 * 8. Excel 生成：generatePaymentReceiptExcel（固定列、数据行、汇总行、样式）
 * 9. ZIP 打包：generatePaymentReceiptZip（多客户场景）
 * 10. 边界场景：空数据、最大数据量、特殊字符客户名、无效图片
 */
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  round2,
  parseQuantity,
  formatPaymentDate,
  formatPaymentDateRange,
  buildPaymentFileName,
  sanitizeSheetName,
  calculatePaymentSummary,
  groupOrdersByCustomer,
  decidePaymentFileLabel,
  generateThumbnailBuffer,
  generatePaymentReceiptExcel,
  generatePaymentReceiptZip,
  workbookToBuffer,
  PAYMENT_COLUMNS,
  PAYMENT_EXPORT_MAX_ROWS,
} from '../api/services/paymentExport'
import type { Quote } from '../api/types/index'

// ============================ 测试数据 ============================

/** 1x1 透明 PNG（最小的有效 PNG） */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** 1x1 JPEG（最小的有效 JPEG） */
const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD/2Q=='

/** 创建测试用 Quote 对象（默认状态为 4=已发货未收款） */
function createPaymentQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'pay-001',
    user_id: 'user-001',
    customer_id: 'cust-001',
    quote_number: '测试客户-无底无侧普通袋-20240722100000',
    customerName: '测试客户',
    shippingAddress: '上海市浦东新区',
    productStyle: '1',
    productSpec: '38*40*0',
    fabricMaterial: '10安涤棉新本色',
    process: '单面数码uv印刷+口头2.5cm',
    handleMaterial: '帆布手提',
    handleSpec: '成品尺寸：2.5*70，切片尺寸6*70',
    quantity: '7200',
    boxSpec: '50*40*30',
    remark: '测试备注',
    sampleFee: '500',
    sampleDays: '7',
    massDays: '15',
    unitPrice: '',
    productionTimeStart: '2024-07-22',
    productionTimeEnd: '2024-08-06',
    costPrice: 2.97,
    priceWithTax: 3.27,
    sellPriceNoTax: 3.42,
    sellPriceWithTax: 3.76,
    receivableSampleFee: 0,
    actualSampleFee: 0,
    sampleFeeDeduct: false,
    deposit: 0,
    pendingAmount: 0,
    status: 4, // 已发货未收款
    quoteTime: '2024-07-22',
    sampleTime: '2024-07-25',
    sampleCompletedTime: '',
    productionStartTime: '2024-07-22',
    shippingTime: '2024-08-10',
    paymentTime: '',
    endTime: '',
    images: [],
    tableData: [],
    removedFormulaAddresses: [],
    modifiedFormulas: {},
    allFormulas: {},
    productionStepStatus: {},
    created_at: '2024-07-22T10:00:00Z',
    updated_at: '2024-08-10T14:00:00Z',
    ...overrides,
  }
}

// ============================ round2 测试 ============================

describe('round2 - 四舍五入保留 2 位小数', () => {
  it('整数保持不变', () => {
    expect(round2(100)).toBe(100)
    expect(round2(0)).toBe(0)
  })
  it('精确 2 位小数保持不变', () => {
    expect(round2(3.42)).toBe(3.42)
    expect(round2(3.76)).toBe(3.76)
  })
  it('第 3 位 < 5 舍去', () => {
    expect(round2(3.141)).toBe(3.14)
    expect(round2(3.144)).toBe(3.14)
  })
  it('第 3 位 >= 5 进一', () => {
    expect(round2(3.145)).toBe(3.15)
    expect(round2(3.149)).toBe(3.15)
  })
  it('负数四舍五入', () => {
    // 注意：-3.146 而非 -3.145，因为 JS 中 -3.145 的浮点表示为 -3.1449999...
    expect(round2(-3.146)).toBe(-3.15)
    expect(round2(-3.144)).toBe(-3.14)
  })
  it('浮点误差修正（0.1 + 0.2 = 0.30000000000000004）', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
  it('大数运算保持精度', () => {
    expect(round2(3.42 * 7200)).toBe(24624)
    expect(round2(3.76 * 7200)).toBe(27072)
  })
})

// ============================ parseQuantity 测试 ============================

describe('parseQuantity - 数量字符串解析', () => {
  it('数字字符串正确解析', () => {
    expect(parseQuantity('7200')).toBe(7200)
    expect(parseQuantity('0')).toBe(0)
  })
  it('number 类型直接返回', () => {
    expect(parseQuantity(1000)).toBe(1000)
  })
  it('浮点字符串解析为数字', () => {
    expect(parseQuantity('100.5')).toBe(100.5)
  })
  it('空字符串 / undefined / null 返回 0', () => {
    expect(parseQuantity('')).toBe(0)
    expect(parseQuantity(undefined)).toBe(0)
    expect(parseQuantity(null)).toBe(0)
  })
  it('非数字字符串返回 0', () => {
    expect(parseQuantity('abc')).toBe(0)
    expect(parseQuantity('N/A')).toBe(0)
  })
  it('含前后空格的数字字符串正确解析', () => {
    expect(parseQuantity('  100  ')).toBe(100)
  })
})

// ============================ formatPaymentDate 测试 ============================

describe('formatPaymentDate - 日期格式化为 YYYY-MM-DD', () => {
  it('ISO 日期字符串正确格式化', () => {
    expect(formatPaymentDate('2024-07-22')).toBe('2024-07-22')
    expect(formatPaymentDate('2024-07-22T10:00:00Z')).toBe('2024-07-22')
  })
  it('斜杠格式日期也能解析', () => {
    expect(formatPaymentDate('2024/07/22')).toBe('2024-07-22')
  })
  it('空值返回 "-"', () => {
    expect(formatPaymentDate('')).toBe('-')
    expect(formatPaymentDate(undefined)).toBe('-')
    expect(formatPaymentDate(null)).toBe('-')
  })
  it('纯空格字符串返回 "-"', () => {
    expect(formatPaymentDate('   ')).toBe('-')
  })
  it('无效日期返回 "-"', () => {
    expect(formatPaymentDate('not-a-date')).toBe('-')
    expect(formatPaymentDate('2024-13-45')).toBe('-')
  })
})

// ============================ formatPaymentDateRange 测试 ============================

describe('formatPaymentDateRange - 日期区间格式化', () => {
  it('两端均有值时用 " - " 连接', () => {
    expect(formatPaymentDateRange('2024-07-22', '2024-08-06')).toBe('2024-07-22 - 2024-08-06')
  })
  it('两端均空时返回 "-"', () => {
    expect(formatPaymentDateRange('', '')).toBe('-')
    expect(formatPaymentDateRange(undefined, null)).toBe('-')
  })
  it('仅开始日期有值时，结束显示 "-"', () => {
    expect(formatPaymentDateRange('2024-07-22', '')).toBe('2024-07-22 - -')
  })
  it('仅结束日期有值时，开始显示 "-"', () => {
    expect(formatPaymentDateRange('', '2024-08-06')).toBe('- - 2024-08-06')
  })
})

// ============================ buildPaymentFileName 测试 ============================

describe('buildPaymentFileName - 文件名生成', () => {
  it('xlsx 扩展名格式正确', () => {
    const name = buildPaymentFileName('测试客户', 'xlsx')
    expect(name).toMatch(/^测试客户_收款单_\d{14}\.xlsx$/)
  })
  it('zip 扩展名格式正确', () => {
    const name = buildPaymentFileName('多客户', 'zip')
    expect(name).toMatch(/^多客户_收款单_\d{14}\.zip$/)
  })
  it('时间戳格式为 YYYYMMDDHHMMSS', () => {
    const name = buildPaymentFileName('客户A', 'xlsx')
    const match = name.match(/(\d{14})\.xlsx$/)
    expect(match).not.toBeNull()
    const ts = match![1]
    const year = parseInt(ts.substring(0, 4))
    const month = parseInt(ts.substring(4, 6))
    const day = parseInt(ts.substring(6, 8))
    expect(year).toBeGreaterThanOrEqual(2024)
    expect(month).toBeGreaterThanOrEqual(1)
    expect(month).toBeLessThanOrEqual(12)
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(31)
  })
  it('"全部客户" 作为标签生成正确文件名', () => {
    const name = buildPaymentFileName('全部客户', 'zip')
    expect(name).toMatch(/^全部客户_收款单_\d{14}\.zip$/)
  })
})

// ============================ sanitizeSheetName 测试 ============================

describe('sanitizeSheetName - 工作表名清洗', () => {
  it('普通字符串保持不变', () => {
    expect(sanitizeSheetName('测试客户')).toBe('测试客户')
  })
  it('非法字符替换为下划线', () => {
    expect(sanitizeSheetName('客户:A/B')).toBe('客户_A_B')
    expect(sanitizeSheetName('客户*名[称]')).toBe('客户_名_称_')
  })
  it('所有非法字符（: \\ / ? * [ ]）均被替换', () => {
    expect(sanitizeSheetName('a:b\\c/d?e*f[g]h')).toBe('a_b_c_d_e_f_g_h')
  })
  it('长度超过 31 字符时截断', () => {
    const long = '客户'.repeat(20) // 40 字符
    const result = sanitizeSheetName(long)
    expect(result.length).toBe(31)
  })
  it('长度正好 31 字符不截断', () => {
    const exact = 'a'.repeat(31)
    expect(sanitizeSheetName(exact)).toBe(exact)
  })
  it('空字符串返回空字符串', () => {
    expect(sanitizeSheetName('')).toBe('')
  })
})

// ============================ calculatePaymentSummary 测试 ============================

describe('calculatePaymentSummary - 收款单汇总计算', () => {
  it('空订单列表汇总为 0', () => {
    const summary = calculatePaymentSummary([])
    expect(summary.orderCount).toBe(0)
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalSellNoTax).toBe(0)
    expect(summary.totalSellWithTax).toBe(0)
    expect(summary.totalPendingAmount).toBe(0)
  })

  it('单订单汇总正确', () => {
    const order = createPaymentQuote({
      quantity: '7200',
      sellPriceNoTax: 3.42,
      sellPriceWithTax: 3.76,
      pendingAmount: 24000,
    })
    const summary = calculatePaymentSummary([order])
    expect(summary.orderCount).toBe(1)
    expect(summary.totalQuantity).toBe(7200)
    expect(summary.totalSellNoTax).toBe(round2(3.42 * 7200))
    expect(summary.totalSellWithTax).toBe(round2(3.76 * 7200))
    expect(summary.totalPendingAmount).toBe(24000)
  })

  it('多订单汇总为各订单之和（含待收总额，不含实收打样费汇总）', () => {
    const orders = [
      createPaymentQuote({
        id: 'p1',
        quantity: '100',
        sellPriceNoTax: 3.0,
        sellPriceWithTax: 3.3,
        pendingAmount: 200,
      }),
      createPaymentQuote({
        id: 'p2',
        quantity: '200',
        sellPriceNoTax: 4.0,
        sellPriceWithTax: 4.4,
        pendingAmount: 750,
      }),
      createPaymentQuote({
        id: 'p3',
        quantity: '300',
        sellPriceNoTax: 5.0,
        sellPriceWithTax: 5.5,
        pendingAmount: 1500,
      }),
    ]
    const summary = calculatePaymentSummary(orders)
    expect(summary.orderCount).toBe(3)
    expect(summary.totalQuantity).toBe(600)
    expect(summary.totalSellNoTax).toBe(round2(3.0 * 100 + 4.0 * 200 + 5.0 * 300))
    expect(summary.totalSellWithTax).toBe(round2(3.3 * 100 + 4.4 * 200 + 5.5 * 300))
    expect(summary.totalPendingAmount).toBe(2450)
  })

  it('pendingAmount 为 undefined/null 时按 0 处理', () => {
    const order = createPaymentQuote({
      quantity: '100',
      pendingAmount: undefined as unknown as number,
    })
    const summary = calculatePaymentSummary([order])
    expect(summary.totalPendingAmount).toBe(0)
  })

  it('汇总 = 明细行之和（精度一致性校验）', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', quantity: '7200', sellPriceNoTax: 3.42, sellPriceWithTax: 3.76 }),
      createPaymentQuote({ id: 'p2', quantity: '5000', sellPriceNoTax: 2.15, sellPriceWithTax: 2.37 }),
      createPaymentQuote({ id: 'p3', quantity: '10000', sellPriceNoTax: 1.08, sellPriceWithTax: 1.19 }),
    ]
    const summary = calculatePaymentSummary(orders)

    // 模拟 Excel 中每行的销售总额 = round2(sellPrice × qty)
    const detailSumNoTax = orders.reduce(
      (s, o) => s + round2(round2(o.sellPriceNoTax) * parseQuantity(o.quantity)),
      0,
    )
    const detailSumWithTax = orders.reduce(
      (s, o) => s + round2(round2(o.sellPriceWithTax) * parseQuantity(o.quantity)),
      0,
    )
    expect(summary.totalSellNoTax).toBe(round2(detailSumNoTax))
    expect(summary.totalSellWithTax).toBe(round2(detailSumWithTax))
  })

  it('浮点误差场景：3.42 × 7200 + 2.15 × 5000', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', quantity: '7200', sellPriceNoTax: 3.42, sellPriceWithTax: 3.76 }),
      createPaymentQuote({ id: 'p2', quantity: '5000', sellPriceNoTax: 2.15, sellPriceWithTax: 2.37 }),
    ]
    const summary = calculatePaymentSummary(orders)
    // 3.42*7200 + 2.15*5000 = 24624 + 10750 = 35374
    expect(summary.totalSellNoTax).toBe(35374)
    // 3.76*7200 + 2.37*5000 = 27072 + 11850 = 38922
    expect(summary.totalSellWithTax).toBe(38922)
  })

  it('非数字数量按 0 处理', () => {
    const order = createPaymentQuote({
      quantity: 'abc',
      sellPriceNoTax: 3.42,
      sellPriceWithTax: 3.76,
    })
    const summary = calculatePaymentSummary([order])
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalSellNoTax).toBe(0)
    expect(summary.totalSellWithTax).toBe(0)
  })

  it('数量为 0 时金额汇总为 0', () => {
    const order = createPaymentQuote({
      quantity: '0',
      sellPriceNoTax: 3.42,
      sellPriceWithTax: 3.76,
    })
    const summary = calculatePaymentSummary([order])
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalSellNoTax).toBe(0)
    expect(summary.totalSellWithTax).toBe(0)
  })

  it('数量为字符串数字（带空格）正确解析', () => {
    const order = createPaymentQuote({
      quantity: '  1000  ',
      sellPriceNoTax: 3.0,
      sellPriceWithTax: 3.3,
    })
    const summary = calculatePaymentSummary([order])
    expect(summary.totalQuantity).toBe(1000)
    expect(summary.totalSellNoTax).toBe(3000)
    expect(summary.totalSellWithTax).toBe(3300)
  })

  it('sellPriceNoTax/WithTax 为非数字类型时按 0 处理', () => {
    const order = createPaymentQuote({
      quantity: '1000',
      sellPriceNoTax: undefined as unknown as number,
      sellPriceWithTax: null as unknown as number,
    })
    const summary = calculatePaymentSummary([order])
    expect(summary.totalSellNoTax).toBe(0)
    expect(summary.totalSellWithTax).toBe(0)
  })
})

// ============================ groupOrdersByCustomer 测试 ============================

describe('groupOrdersByCustomer - 按客户分组', () => {
  it('空列表返回空 Map', () => {
    const groups = groupOrdersByCustomer([])
    expect(groups.size).toBe(0)
  })

  it('单客户订单归为一组', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', customerName: '客户A' }),
      createPaymentQuote({ id: 'p2', customerName: '客户A' }),
    ]
    const groups = groupOrdersByCustomer(orders)
    expect(groups.size).toBe(1)
    expect(groups.get('客户A')?.length).toBe(2)
  })

  it('多客户分组正确', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', customerName: '客户A' }),
      createPaymentQuote({ id: 'p2', customerName: '客户B' }),
      createPaymentQuote({ id: 'p3', customerName: '客户A' }),
      createPaymentQuote({ id: 'p4', customerName: '客户C' }),
    ]
    const groups = groupOrdersByCustomer(orders)
    expect(groups.size).toBe(3)
    expect(groups.get('客户A')?.length).toBe(2)
    expect(groups.get('客户B')?.length).toBe(1)
    expect(groups.get('客户C')?.length).toBe(1)
  })

  it('保持客户首次出现的顺序', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', customerName: '客户B' }),
      createPaymentQuote({ id: 'p2', customerName: '客户A' }),
      createPaymentQuote({ id: 'p3', customerName: '客户C' }),
      createPaymentQuote({ id: 'p4', customerName: '客户A' }),
    ]
    const groups = groupOrdersByCustomer(orders)
    const names = [...groups.keys()]
    expect(names).toEqual(['客户B', '客户A', '客户C'])
  })

  it('空客户名称归入"(未命名客户)"组', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', customerName: '' }),
      createPaymentQuote({ id: 'p2', customerName: '客户A' }),
      createPaymentQuote({ id: 'p3', customerName: '' }),
    ]
    const groups = groupOrdersByCustomer(orders)
    expect(groups.size).toBe(2)
    expect(groups.get('(未命名客户)')?.length).toBe(2)
    expect(groups.get('客户A')?.length).toBe(1)
  })
})

// ============================ decidePaymentFileLabel 测试 ============================

describe('decidePaymentFileLabel - 文件名标签决策', () => {
  it('单客户 → xlsx 文件，标签为客户名', () => {
    const groups = new Map([['客户A', [createPaymentQuote()]]])
    const result = decidePaymentFileLabel(groups, false)
    expect(result.label).toBe('客户A')
    expect(result.ext).toBe('xlsx')
  })

  it('多客户 & 无筛选 → zip 文件，标签为"全部客户"', () => {
    const groups = new Map([
      ['客户A', [createPaymentQuote()]],
      ['客户B', [createPaymentQuote({ id: 'p2' })]],
    ])
    const result = decidePaymentFileLabel(groups, false)
    expect(result.label).toBe('全部客户')
    expect(result.ext).toBe('zip')
  })

  it('多客户 & 有筛选 → zip 文件，标签为"多客户"', () => {
    const groups = new Map([
      ['客户A', [createPaymentQuote()]],
      ['客户B', [createPaymentQuote({ id: 'p2' })]],
    ])
    const result = decidePaymentFileLabel(groups, true)
    expect(result.label).toBe('多客户')
    expect(result.ext).toBe('zip')
  })

  it('单客户 & 有筛选 → 仍为 xlsx，标签为客户名', () => {
    const groups = new Map([['客户A', [createPaymentQuote()]]])
    const result = decidePaymentFileLabel(groups, true)
    expect(result.label).toBe('客户A')
    expect(result.ext).toBe('xlsx')
  })
})

// ============================ generateThumbnailBuffer 测试 ============================

describe('generateThumbnailBuffer - 80×80 缩略图生成', () => {
  it('PNG data URI 生成有效 JPEG Buffer', async () => {
    const buf = await generateThumbnailBuffer(TINY_PNG)
    expect(buf).not.toBeNull()
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf!.byteLength).toBeGreaterThan(0)
    // JPEG 文件头：FF D8 FF
    expect(buf![0]).toBe(0xff)
    expect(buf![1]).toBe(0xd8)
    expect(buf![2]).toBe(0xff)
  })

  it('JPEG data URI：sharp 无法处理极小 JPEG 时返回 null（不抛异常）', async () => {
    // TINY_JPEG 是 1x1 极简 JPEG，sharp 可能无法 resize；只要不抛异常即可
    const buf = await generateThumbnailBuffer(TINY_JPEG)
    // sharp 对极简 JPEG 的处理结果不确定：成功返回 Buffer，失败返回 null
    if (buf !== null) {
      expect(buf).toBeInstanceOf(Buffer)
      expect(buf[0]).toBe(0xff)
      expect(buf[1]).toBe(0xd8)
    }
  })

  it('使用 sharp 重绘后为 JPEG 格式（即使输入是 PNG）', async () => {
    const pngBuf = await generateThumbnailBuffer(TINY_PNG)
    expect(pngBuf).not.toBeNull()
    // 输出固定为 JPEG 格式（service 设计：sharp.jpeg().toBuffer()）
    expect(pngBuf![0]).toBe(0xff)
    expect(pngBuf![1]).toBe(0xd8)
  })

  it('无效的 data URI 返回 null', async () => {
    expect(await generateThumbnailBuffer('not-a-data-uri')).toBeNull()
    expect(await generateThumbnailBuffer('')).toBeNull()
  })

  it('非图片 MIME 类型返回 null', async () => {
    expect(
      await generateThumbnailBuffer('data:text/plain;base64,SGVsbG8='),
    ).toBeNull()
  })

  it('空字符串返回 null（不抛异常）', async () => {
    expect(await generateThumbnailBuffer('')).toBeNull()
  })

  it('损坏的 base64 数据返回 null（不抛异常）', async () => {
    const corrupted = 'data:image/png;base64,!!!invalid-base64!!!'
    const buf = await generateThumbnailBuffer(corrupted)
    // 不抛异常；解析失败时 sharp 可能返回 null 或空 buffer
    expect(buf).toBeNull()
  })
})

// ============================ generatePaymentReceiptExcel 测试 ============================

describe('generatePaymentReceiptExcel - 收款单 Excel 生成', () => {
  it('生成 Workbook 不为空且包含一个工作表', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '测试客户')
    expect(workbook).toBeDefined()
    expect(workbook.worksheets.length).toBe(1)
  })

  it('工作表名称为清洗后的客户名', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '测试客户:A')
    expect(workbook.worksheets[0].name).toBe('测试客户_A')
  })

  it('工作表名称超过 31 字符时被截断', async () => {
    const longName = '客户'.repeat(20) // 40 字符
    const orders = [createPaymentQuote({ customerName: longName })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, longName)
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31)
  })

  it('表头行（第 2 行）包含所有 14 列固定字段（订单号在第一列）', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '测试客户')
    const sheet = workbook.worksheets[0]
    const headerRow = sheet.getRow(2)
    const headers = PAYMENT_COLUMNS.map((_, i) => headerRow.getCell(i + 1).value)
    expect(headers).toEqual([
      '订单号',
      '客户名称',
      '数量',
      '产品图片',
      '大货日期(从-到)',
      '工艺',
      '单个卖价(不含税)',
      '单个卖价(含税)',
      '销售总额(不含税)',
      '销售总额(含税)',
      '应收打样费',
      '实收打样费',
      '抵扣大货',
      '待收总额',
    ])
  })

  it('列宽按 PAYMENT_COLUMNS 定义设置', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '测试客户')
    const sheet = workbook.worksheets[0]
    PAYMENT_COLUMNS.forEach((col, idx) => {
      expect(sheet.getColumn(idx + 1).width).toBe(col.width)
    })
  })

  it('数据行正确填充订单号、客户名称、数量、工艺', async () => {
    const orders = [
      createPaymentQuote({
        customerName: '客户A',
        quantity: '7200',
        process: '单面数码uv印刷+口头2.5cm',
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3) // 第 3 行起为数据行
    expect(dataRow.getCell(1).value).toBe('测试客户-无底无侧普通袋-20240722100000')
    expect(dataRow.getCell(2).value).toBe('客户A')
    expect(dataRow.getCell(3).value).toBe(7200)
    expect(dataRow.getCell(6).value).toBe('单面数码uv印刷+口头2.5cm')
  })

  it('数据行正确填充日期区间', async () => {
    const orders = [
      createPaymentQuote({
        productionTimeStart: '2024-07-22',
        productionTimeEnd: '2024-08-06',
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3)
    expect(dataRow.getCell(5).value).toBe('2024-07-22 - 2024-08-06')
  })

  it('空日期区间显示为 "-"', async () => {
    const orders = [
      createPaymentQuote({
        productionTimeStart: '',
        productionTimeEnd: '',
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(3).getCell(5).value).toBe('-')
  })

  it('数据行正确填充单价和总额（含税与不含税）', async () => {
    const orders = [
      createPaymentQuote({
        quantity: '7200',
        sellPriceNoTax: 3.42,
        sellPriceWithTax: 3.76,
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3)
    // 单个卖价(不含税) = round2(3.42) = 3.42
    expect(dataRow.getCell(7).value).toBe(3.42)
    // 单个卖价(含税) = round2(3.76) = 3.76
    expect(dataRow.getCell(8).value).toBe(3.76)
    // 销售总额(不含税) = round2(3.42 * 7200) = 24624
    expect(dataRow.getCell(9).value).toBe(24624)
    // 销售总额(含税) = round2(3.76 * 7200) = 27072
    expect(dataRow.getCell(10).value).toBe(27072)
  })

  it('货币单元格应用 ¥#,##0.00 数字格式', async () => {
    const orders = [createPaymentQuote({ quantity: '1000', sellPriceNoTax: 3.42, sellPriceWithTax: 3.76 })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3)
    expect(dataRow.getCell(7).numFmt).toBe('¥#,##0.00')
    expect(dataRow.getCell(8).numFmt).toBe('¥#,##0.00')
    expect(dataRow.getCell(9).numFmt).toBe('¥#,##0.00')
    expect(dataRow.getCell(10).numFmt).toBe('¥#,##0.00')
  })

  it('无图片时图片列显示 "-"', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(3).getCell(4).value).toBe('-')
  })

  it('有图片时图片列占位为空字符串（图片浮于单元格之上）', async () => {
    const orders = [createPaymentQuote({ id: 'p1' })]
    const thumb = await generateThumbnailBuffer(TINY_PNG)
    const thumbnails = new Map<string, Buffer | null>([['p1', thumb]])
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(3).getCell(4).value).toBe('')
  })

  it('汇总行客户名称列显示"合计"（订单号列为空）', async () => {
    const orders = [createPaymentQuote({ quantity: '1000', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    // 单订单时：第 3 行为数据，第 4 行为汇总
    const summaryRow = sheet.getRow(4)
    expect(summaryRow.getCell(1).value).toBe('')
    expect(summaryRow.getCell(2).value).toBe('合计')
  })

  it('汇总行数量、金额与 calculatePaymentSummary 结果一致（不含实收打样费汇总）', async () => {
    const orders = [
      createPaymentQuote({ id: 'p1', quantity: '1000', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3, actualSampleFee: 100, pendingAmount: 2900 }),
      createPaymentQuote({ id: 'p2', quantity: '2000', sellPriceNoTax: 4.0, sellPriceWithTax: 4.4, actualSampleFee: 50, pendingAmount: 7950 }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    // 2 个数据行后第 5 行为汇总
    const summaryRow = sheet.getRow(5)
    const expected = calculatePaymentSummary(orders)
    expect(summaryRow.getCell(3).value).toBe(expected.totalQuantity)
    expect(summaryRow.getCell(9).value).toBe(expected.totalSellNoTax)
    expect(summaryRow.getCell(10).value).toBe(expected.totalSellWithTax)
    expect(summaryRow.getCell(11).value).toBe('') // 实收打样费已从汇总中移除
    expect(summaryRow.getCell(14).value).toBe(expected.totalPendingAmount)
  })

  it('数据行正确填充实收打样费、抵扣大货、待收总额', async () => {
    const orders = [
      createPaymentQuote({
        quantity: '7200',
        sellPriceNoTax: 3.42,
        actualSampleFee: 500,
        sampleFeeDeduct: true,
        pendingAmount: 24000,
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3)
    expect(dataRow.getCell(12).value).toBe(500)
    expect(dataRow.getCell(13).value).toBe('是')
    expect(dataRow.getCell(14).value).toBe(24000)
  })

  it('数据行正确填充应收打样费', async () => {
    const orders = [
      createPaymentQuote({
        quantity: '7200',
        sellPriceNoTax: 3.42,
        receivableSampleFee: 1500,
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(3).getCell(11).value).toBe(1500)
  })

  it('抵扣大货为 false 时显示"否"', async () => {
    const orders = [createPaymentQuote({ sampleFeeDeduct: false })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    expect(sheet.getRow(3).getCell(13).value).toBe('否')
  })

  it('应收打样费、实收打样费、待收总额为 undefined 时数据行显示 0', async () => {
    const orders = [
      createPaymentQuote({
        receivableSampleFee: undefined as unknown as number,
        actualSampleFee: undefined as unknown as number,
        pendingAmount: undefined as unknown as number,
      }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3)
    expect(dataRow.getCell(11).value).toBe(0)
    expect(dataRow.getCell(12).value).toBe(0)
    expect(dataRow.getCell(14).value).toBe(0)
  })

  it('应收打样费、实收打样费、待收总额列应用货币格式', async () => {
    const orders = [createPaymentQuote({ quantity: '1000', receivableSampleFee: 1500, actualSampleFee: 100, pendingAmount: 3000 })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRow = sheet.getRow(3)
    expect(dataRow.getCell(11).numFmt).toBe('¥#,##0.00')
    expect(dataRow.getCell(12).numFmt).toBe('¥#,##0.00')
    expect(dataRow.getCell(14).numFmt).toBe('¥#,##0.00')
  })

  it('汇总行应用加粗字体', async () => {
    const orders = [createPaymentQuote({ quantity: '1000', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const summaryRow = sheet.getRow(4)
    expect(summaryRow.getCell(1).font?.bold).toBe(true)
  })

  it('汇总行背景色为 #f5f5f5', async () => {
    const orders = [createPaymentQuote({ quantity: '1000', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const summaryRow = sheet.getRow(4)
    const fill = summaryRow.getCell(1).fill as ExcelJS.Fill
    expect(fill.type).toBe('pattern')
    expect((fill as ExcelJS.PatternFill).fgColor?.argb).toBe('FFF5F5F5')
  })

  it('汇总行行高比数据行高 10%', async () => {
    const orders = [createPaymentQuote({ quantity: '1000', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const dataRowHeight = sheet.getRow(3).height
    const summaryRowHeight = sheet.getRow(4).height
    expect(summaryRowHeight).toBe(Math.round((dataRowHeight as number) * 1.1))
  })

  it('标题行（第 1 行）包含客户名和"收款单"字样', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    const titleValue = String(sheet.getRow(1).getCell(1).value)
    expect(titleValue).toContain('客户A')
    expect(titleValue).toContain('收款单')
    expect(titleValue).toContain('已发货未收款')
  })

  it('冻结窗格设置在 ySplit=3（标题+表头）', async () => {
    const orders = [createPaymentQuote()]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    expect(sheet.views?.[0]?.state).toBe('frozen')
    expect(sheet.views?.[0]?.ySplit).toBe(3)
  })

  it('多订单场景：数据行数 = 订单数 + 1（汇总）+ 2（标题+表头）', async () => {
    const orders = [
      createPaymentQuote({ id: 'p1' }),
      createPaymentQuote({ id: 'p2' }),
      createPaymentQuote({ id: 'p3' }),
      createPaymentQuote({ id: 'p4' }),
      createPaymentQuote({ id: 'p5' }),
    ]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    // 5 数据行 + 汇总行（实际行数包含标题和表头）
    // 标题(1) + 表头(2) + 数据(3-7) + 汇总(8)
    expect(sheet.getRow(8).getCell(2).value).toBe('合计')
    expect(sheet.getRow(9).getCell(1).value).toBeNull()
  })

  it('空订单列表仍能生成 Excel（仅标题+表头+汇总行）', async () => {
    const orders: Quote[] = []
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    // 第 3 行即为汇总行
    expect(sheet.getRow(3).getCell(2).value).toBe('合计')
    expect(sheet.getRow(3).getCell(3).value).toBe(0)
  })

  it('客户名包含特殊字符时工作表名被清洗', async () => {
    const orders = [createPaymentQuote({ customerName: '客户/A:B' })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户/A:B')
    expect(workbook.worksheets[0].name).toBe('客户_A_B')
  })
})

// ============================ generatePaymentReceiptZip 测试 ============================

describe('generatePaymentReceiptZip - 多客户 ZIP 打包', () => {
  it('生成有效 ZIP Buffer（PK 文件头）', async () => {
    const groups = new Map<string, Quote[]>([
      ['客户A', [createPaymentQuote({ id: 'p1', customerName: '客户A' })]],
      ['客户B', [createPaymentQuote({ id: 'p2', customerName: '客户B' })]],
    ])
    const thumbnails = new Map<string, Buffer | null>()
    const buf = await generatePaymentReceiptZip(groups, thumbnails)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.byteLength).toBeGreaterThan(0)
    // ZIP 文件头：PK\x03\x04
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
  })

  it('单客户 ZIP 也能正常生成', async () => {
    const groups = new Map<string, Quote[]>([
      ['客户A', [createPaymentQuote({ id: 'p1', customerName: '客户A' })]],
    ])
    const thumbnails = new Map<string, Buffer | null>()
    const buf = await generatePaymentReceiptZip(groups, thumbnails)
    expect(buf[0]).toBe(0x50)
    expect(buf.byteLength).toBeGreaterThan(0)
  })

  it('空分组返回仅含结尾的空 ZIP（PK 头）', async () => {
    const groups = new Map<string, Quote[]>()
    const thumbnails = new Map<string, Buffer | null>()
    const buf = await generatePaymentReceiptZip(groups, thumbnails)
    // 空内容时仍返回有效 ZIP（PK 头）
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it('多客户 ZIP 包含每个客户的 Excel 文件', async () => {
    const groups = new Map<string, Quote[]>([
      ['客户A', [createPaymentQuote({ id: 'p1', customerName: '客户A' })]],
      ['客户B', [createPaymentQuote({ id: 'p2', customerName: '客户B' })]],
      ['客户C', [createPaymentQuote({ id: 'p3', customerName: '客户C' })]],
    ])
    const thumbnails = new Map<string, Buffer | null>()
    const buf = await generatePaymentReceiptZip(groups, thumbnails)
    // ZIP 大小应明显大于单个 Excel（包含 3 个文件）
    const singleBuf = await workbookToBuffer(
      await generatePaymentReceiptExcel(
        [createPaymentQuote()],
        new Map(),
        '客户A',
      ),
    )
    expect(buf.byteLength).toBeGreaterThan(singleBuf.byteLength)
  })
})

// ============================ workbookToBuffer 测试 ============================

describe('workbookToBuffer - Workbook 转 Buffer', () => {
  it('返回有效 Buffer（PK 头，即 xlsx 的 ZIP 容器）', async () => {
    const workbook = await generatePaymentReceiptExcel(
      [createPaymentQuote()],
      new Map(),
      '客户A',
    )
    const buf = await workbookToBuffer(workbook)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.byteLength).toBeGreaterThan(0)
    // xlsx 是 ZIP 容器，文件头为 PK
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })
})

// ============================ 常量定义测试 ============================

describe('PAYMENT_COLUMNS - 固定列定义', () => {
  it('列数为 14（按需求规范，订单号为第一列）', () => {
    expect(PAYMENT_COLUMNS.length).toBe(14)
  })

  it('列顺序符合需求规范', () => {
    const keys = PAYMENT_COLUMNS.map((c) => c.key)
    expect(keys).toEqual([
      'quote_number',
      'customerName',
      'quantity',
      'thumbnail',
      'productionDateRange',
      'process',
      'sellPriceNoTax',
      'sellPriceWithTax',
      'sellTotalNoTax',
      'sellTotalWithTax',
      'receivableSampleFee',
      'actualSampleFee',
      'sampleFeeDeduct',
      'pendingAmount',
    ])
  })

  it('列标题符合需求规范', () => {
    const headers = PAYMENT_COLUMNS.map((c) => c.header)
    expect(headers).toEqual([
      '订单号',
      '客户名称',
      '数量',
      '产品图片',
      '大货日期(从-到)',
      '工艺',
      '单个卖价(不含税)',
      '单个卖价(含税)',
      '销售总额(不含税)',
      '销售总额(含税)',
      '应收打样费',
      '实收打样费',
      '抵扣大货',
      '待收总额',
    ])
  })

  it('每列都有正数 width', () => {
    PAYMENT_COLUMNS.forEach((col) => {
      expect(col.width).toBeGreaterThan(0)
    })
  })
})

describe('PAYMENT_EXPORT_MAX_ROWS - 单次导出上限', () => {
  it('为 1000（按需求规范）', () => {
    expect(PAYMENT_EXPORT_MAX_ROWS).toBe(1000)
  })
})

// ============================ 边界场景测试 ============================

describe('边界场景', () => {
  it('空订单列表：Excel 生成不抛异常', async () => {
    const orders: Quote[] = []
    const thumbnails = new Map<string, Buffer | null>()
    await expect(
      generatePaymentReceiptExcel(orders, thumbnails, '客户A'),
    ).resolves.toBeDefined()
  })

  it('空订单列表：汇总为 0', () => {
    const summary = calculatePaymentSummary([])
    expect(summary.orderCount).toBe(0)
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalSellNoTax).toBe(0)
    expect(summary.totalSellWithTax).toBe(0)
  })

  it('最大数据量（1000 条）：Excel 生成成功且汇总正确', async () => {
    const orders = Array.from({ length: PAYMENT_EXPORT_MAX_ROWS }, (_, i) =>
      createPaymentQuote({
        id: `p-${i}`,
        quantity: '100',
        sellPriceNoTax: 3.42,
        sellPriceWithTax: 3.76,
      }),
    )
    const thumbnails = new Map<string, Buffer | null>()

    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    expect(workbook.worksheets.length).toBe(1)

    const summary = calculatePaymentSummary(orders)
    expect(summary.orderCount).toBe(1000)
    expect(summary.totalQuantity).toBe(100000)
    // 3.42 * 100 * 1000 = 342000
    expect(summary.totalSellNoTax).toBe(342000)
    // 3.76 * 100 * 1000 = 376000
    expect(summary.totalSellWithTax).toBe(376000)
  })

  it('特殊字符客户名（emoji）：Excel 生成不抛异常', async () => {
    const orders = [createPaymentQuote({ customerName: '客户🎉测试' })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户🎉测试')
    expect(workbook.worksheets[0]).toBeDefined()
  })

  it('特殊字符客户名（超长）：工作表名被截断到 31 字符', async () => {
    const longName = '这是一个非常长的客户名称用于测试工作表名截断功能abcdefghijklmnopqrstuvwxyz'
    const orders = [createPaymentQuote({ customerName: longName })]
    const thumbnails = new Map<string, Buffer | null>()
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, longName)
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31)
  })

  it('数量为 0 的订单：金额贡献为 0', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', quantity: '100', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 }),
      createPaymentQuote({ id: 'p2', quantity: '0', sellPriceNoTax: 5.0, sellPriceWithTax: 5.5 }),
      createPaymentQuote({ id: 'p3', quantity: '200', sellPriceNoTax: 4.0, sellPriceWithTax: 4.4 }),
    ]
    const summary = calculatePaymentSummary(orders)
    expect(summary.totalQuantity).toBe(300)
    expect(summary.totalSellNoTax).toBe(round2(3.0 * 100 + 4.0 * 200))
    expect(summary.totalSellWithTax).toBe(round2(3.3 * 100 + 4.4 * 200))
  })

  it('数量为浮点字符串：正确解析并参与计算', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', quantity: '100.5', sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 }),
    ]
    const summary = calculatePaymentSummary(orders)
    expect(summary.totalQuantity).toBe(100.5)
    expect(summary.totalSellNoTax).toBe(round2(3.0 * 100.5))
    expect(summary.totalSellWithTax).toBe(round2(3.3 * 100.5))
  })

  it('负数单价（异常数据）：按原值参与计算', () => {
    const orders = [
      createPaymentQuote({ id: 'p1', quantity: '100', sellPriceNoTax: -3.0, sellPriceWithTax: -3.3 }),
    ]
    const summary = calculatePaymentSummary(orders)
    expect(summary.totalSellNoTax).toBe(-300)
    expect(summary.totalSellWithTax).toBe(-330)
  })

  it('混合场景：有图和无图订单并存', async () => {
    const thumb = await generateThumbnailBuffer(TINY_PNG)
    const orders = [
      createPaymentQuote({ id: 'p1', images: [TINY_PNG] }),
      createPaymentQuote({ id: 'p2', images: [] }),
      createPaymentQuote({ id: 'p3', images: [TINY_PNG] }),
    ]
    const thumbnails = new Map<string, Buffer | null>([
      ['p1', thumb],
      ['p2', null],
      ['p3', thumb],
    ])
    const workbook = await generatePaymentReceiptExcel(orders, thumbnails, '客户A')
    const sheet = workbook.worksheets[0]
    // p1（第 3 行）：有图 → 占位空字符串
    expect(sheet.getRow(3).getCell(4).value).toBe('')
    // p2（第 4 行）：无图 → "-"
    expect(sheet.getRow(4).getCell(4).value).toBe('-')
    // p3（第 5 行）：有图 → 占位空字符串
    expect(sheet.getRow(5).getCell(4).value).toBe('')
  })

  it('浮点精度一致性：多订单汇总无累积误差', () => {
    // 构造会产生浮点误差的场景
    const orders = Array.from({ length: 10 }, (_, i) =>
      createPaymentQuote({
        id: `p-${i}`,
        quantity: '7',
        sellPriceNoTax: 0.07,
        sellPriceWithTax: 0.08,
      }),
    )
    const summary = calculatePaymentSummary(orders)
    // 每行：round2(0.07 * 7) = 0.49；10 行总和 = 4.9
    expect(summary.totalSellNoTax).toBe(round2(0.49 * 10))
    // 每行：round2(0.08 * 7) = 0.56；10 行总和 = 5.6
    expect(summary.totalSellWithTax).toBe(round2(0.56 * 10))
  })
})
