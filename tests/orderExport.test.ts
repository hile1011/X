/**
 * 订单 Excel 导出功能 单元测试
 *
 * 测试目标：api/services/excelExport.ts
 *
 * 核心验证点：
 * 1. 订单字段映射：所有字段正确导出
 * 2. 格式化：货币、日期、状态标签、款式标签
 * 3. 汇总统计：总数、总金额、状态分布
 * 4. 文件名生成：带时间戳
 * 5. 大数据量：1000+ 订单导出无性能问题
 * 6. 公式保留：单订单导出时在线表格公式正确写入 Excel
 * 7. 错误处理：空数据、无效输入
 */
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import {
  generateOrdersExcel,
  generateOrderWithTableExcel,
  calculateSummary,
  getStatusLabel,
  getStyleLabel,
  generateFileName,
  workbookToBuffer,
  getImageDimensions,
  scaleProportionally,
  type TableExportData,
} from '../api/services/excelExport'
import type { Quote } from '../api/types/index'
import { mockQuotes } from '../api/mockData'

// ============================ 测试数据 ============================

/** 创建测试用 Quote 对象 */
function createTestQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'test-quote-001',
    user_id: 'user-001',
    customer_id: 'cust-001',
    quote_number: '测试客户-20240722100000-无底无侧普通袋',
    customerName: '测试客户',
    shippingAddress: '上海市浦东新区',
    productStyle: '1',
    productSpec: '38*40*0',
    fabricMaterial: '10安涤棉新本色',
    process: '单面数码uv印刷',
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
    status: 3,
    quoteTime: '2024-07-22',
    sampleTime: '2024-07-25',
    productionStartTime: '2024-07-22',
    shippingTime: '',
    paymentTime: '',
    endTime: '',
    images: [],
    created_at: '2024-07-22T10:00:00Z',
    updated_at: '2024-07-22T14:00:00Z',
    ...overrides,
  }
}

/** 生成大量测试订单 */
function generateLargeDataset(count: number): Quote[] {
  return Array.from({ length: count }, (_, i) =>
    createTestQuote({
      id: `test-quote-${String(i).padStart(4, '0')}`,
      quote_number: `客户${i}-20240722100000-无底无侧普通袋`,
      customerName: `客户${Math.floor(i / 10)}`,
      quantity: String(1000 + i),
      costPrice: 2.5 + (i % 100) / 100,
      sellPriceNoTax: 3.0 + (i % 100) / 100,
      sellPriceWithTax: 3.3 + (i % 100) / 100,
      status: ((i % 6) + 1) as Quote['status'],
    }),
  )
}

// 在线表格测试数据（款式1模板，来自 BagQuote.tsx）
const TABLE_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
  ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 2.97, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 3240, null, null, null, null, null, null],
]

const TABLE_FORMULAS: Record<string, string> = {
  B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
  H3: '=F3+C3',
  I3: '=(D3*2+E3+G3)',
  J8: '=SUM(J6:J7)',
  J9: '=J8+I9',
  K9: '=J9*1.1',
  J10: '=(J9-J8)*B2',
}

// ============================ 标签函数测试 ============================

describe('getStatusLabel - 状态标签', () => {
  it('状态 1 → 报价中', () => expect(getStatusLabel(1)).toBe('报价中'))
  it('状态 2 → 打样中', () => expect(getStatusLabel(2)).toBe('打样中'))
  it('状态 3 → 做货中', () => expect(getStatusLabel(3)).toBe('做货中'))
  it('状态 4 → 已发货未收款', () => expect(getStatusLabel(4)).toBe('已发货未收款'))
  it('状态 5 → 已发货已收款', () => expect(getStatusLabel(5)).toBe('已发货已收款'))
  it('状态 6 → 结束', () => expect(getStatusLabel(6)).toBe('结束'))
  it('未知状态 → 未知', () => expect(getStatusLabel(99)).toBe('未知'))
  it('状态 0 → 未知', () => expect(getStatusLabel(0)).toBe('未知'))
})

describe('getStyleLabel - 款式标签', () => {
  it('款式 1 → 无底无侧普通袋', () => expect(getStyleLabel('1')).toBe('无底无侧普通袋'))
  it('款式 2 → 有底无侧普通袋', () => expect(getStyleLabel('2')).toBe('有底无侧普通袋'))
  it('款式 3 → 有底有侧普通袋', () => expect(getStyleLabel('3')).toBe('有底有侧普通袋'))
  it('款式 4 → 手提连底普通拼接袋', () => expect(getStyleLabel('4')).toBe('手提连底普通拼接袋'))
  it('款式 5 → 手提连底高级拼接袋', () => expect(getStyleLabel('5')).toBe('手提连底高级拼接袋'))
  it('款式 6 → 手提无连底拼接袋', () => expect(getStyleLabel('6')).toBe('手提无连底拼接袋'))
  it('未知款式 → 返回原值', () => expect(getStyleLabel('99')).toBe('99'))
})

// ============================ 文件名生成测试 ============================

describe('generateFileName - 文件名生成', () => {
  it('默认前缀生成 OrderExport_时间戳.xlsx', () => {
    const name = generateFileName()
    expect(name).toMatch(/^OrderExport_\d{14}\.xlsx$/)
  })
  it('自定义前缀生成对应文件名', () => {
    const name = generateFileName('Order_测试客户')
    expect(name).toMatch(/^Order_测试客户_\d{14}\.xlsx$/)
  })
  it('文件名包含时间戳格式 YYYYMMDDHHMMSS', () => {
    const name = generateFileName()
    const match = name.match(/(\d{14})\.xlsx$/)
    expect(match).not.toBeNull()
    const ts = match![1]
    // 验证时间戳各部分合理
    const year = parseInt(ts.substring(0, 4))
    const month = parseInt(ts.substring(4, 6))
    const day = parseInt(ts.substring(6, 8))
    expect(year).toBeGreaterThanOrEqual(2024)
    expect(month).toBeGreaterThanOrEqual(1)
    expect(month).toBeLessThanOrEqual(12)
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(31)
  })
})

// ============================ 汇总统计测试 ============================

describe('calculateSummary - 汇总统计', () => {
  it('空订单列表汇总为 0', () => {
    const summary = calculateSummary([])
    expect(summary.totalOrders).toBe(0)
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalCost).toBe(0)
    expect(summary.totalPriceWithTax).toBe(0)
    expect(summary.totalSellNoTax).toBe(0)
    expect(summary.totalSellWithTax).toBe(0)
    expect(summary.totalProfitNoTax).toBe(0)
    expect(summary.totalProfitWithTax).toBe(0)
    expect(summary.totalProfit).toBe(0)
  })

  it('单订单汇总正确', () => {
    const order = createTestQuote({ quantity: '7200', costPrice: 2.97, priceWithTax: 3.27, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76 })
    const summary = calculateSummary([order])
    expect(summary.totalOrders).toBe(1)
    expect(summary.totalQuantity).toBe(7200)
    expect(summary.totalCost).toBeCloseTo(2.97 * 7200, 2)
    expect(summary.totalPriceWithTax).toBeCloseTo(3.27 * 7200, 2)
    expect(summary.totalSellNoTax).toBeCloseTo(3.42 * 7200, 2)
    expect(summary.totalSellWithTax).toBeCloseTo(3.76 * 7200, 2)
    // 利润(不含税) = 卖价不含税 - 成本价
    expect(summary.totalProfitNoTax).toBeCloseTo((3.42 - 2.97) * 7200, 2)
    // 利润(含税) = 卖价含税 - 含税价
    expect(summary.totalProfitWithTax).toBeCloseTo((3.76 - 3.27) * 7200, 2)
    // 兼容旧字段 totalProfit = totalProfitNoTax
    expect(summary.totalProfit).toBe(summary.totalProfitNoTax)
  })

  it('多订单汇总正确', () => {
    const orders = [
      createTestQuote({ id: 'q1', quantity: '100', costPrice: 2.0, priceWithTax: 2.2, sellPriceNoTax: 3.0, sellPriceWithTax: 3.3, status: 1 }),
      createTestQuote({ id: 'q2', quantity: '200', costPrice: 3.0, priceWithTax: 3.3, sellPriceNoTax: 4.0, sellPriceWithTax: 4.4, status: 2 }),
      createTestQuote({ id: 'q3', quantity: '300', costPrice: 4.0, priceWithTax: 4.4, sellPriceNoTax: 5.0, sellPriceWithTax: 5.5, status: 3 }),
    ]
    const summary = calculateSummary(orders)
    expect(summary.totalOrders).toBe(3)
    expect(summary.totalQuantity).toBe(600)
    expect(summary.totalCost).toBeCloseTo(2.0 * 100 + 3.0 * 200 + 4.0 * 300, 2)
    expect(summary.totalPriceWithTax).toBeCloseTo(2.2 * 100 + 3.3 * 200 + 4.4 * 300, 2)
    expect(summary.totalSellNoTax).toBeCloseTo(3.0 * 100 + 4.0 * 200 + 5.0 * 300, 2)
    expect(summary.totalSellWithTax).toBeCloseTo(3.3 * 100 + 4.4 * 200 + 5.5 * 300, 2)
    // 利润(不含税) = Σ 数量 × (卖价不含税 - 成本价)
    expect(summary.totalProfitNoTax).toBeCloseTo(
      (3.0 - 2.0) * 100 + (4.0 - 3.0) * 200 + (5.0 - 4.0) * 300, 2)
    // 利润(含税) = Σ 数量 × (卖价含税 - 含税价)
    expect(summary.totalProfitWithTax).toBeCloseTo(
      (3.3 - 2.2) * 100 + (4.4 - 3.3) * 200 + (5.5 - 4.4) * 300, 2)
  })

  it('利润(不含税) = 总卖价(不含税) - 总成本', () => {
    const orders = [createTestQuote({ quantity: '1000', costPrice: 2.5, priceWithTax: 2.75, sellPriceNoTax: 3.5, sellPriceWithTax: 3.85 })]
    const summary = calculateSummary(orders)
    expect(summary.totalProfitNoTax).toBeCloseTo((3.5 - 2.5) * 1000, 2)
  })

  it('利润(含税) = 总卖价(含税) - 总含税价', () => {
    const orders = [createTestQuote({ quantity: '1000', costPrice: 2.5, priceWithTax: 2.75, sellPriceNoTax: 3.5, sellPriceWithTax: 3.85 })]
    const summary = calculateSummary(orders)
    expect(summary.totalProfitWithTax).toBeCloseTo((3.85 - 2.75) * 1000, 2)
  })

  it('状态分布统计正确', () => {
    const orders = [
      createTestQuote({ id: 'q1', status: 1 }),
      createTestQuote({ id: 'q2', status: 1 }),
      createTestQuote({ id: 'q3', status: 3 }),
      createTestQuote({ id: 'q4', status: 6 }),
    ]
    const summary = calculateSummary(orders)
    expect(summary.statusBreakdown[1]?.count).toBe(2)
    expect(summary.statusBreakdown[1]?.label).toBe('报价中')
    expect(summary.statusBreakdown[3]?.count).toBe(1)
    expect(summary.statusBreakdown[3]?.label).toBe('做货中')
    expect(summary.statusBreakdown[6]?.count).toBe(1)
    expect(summary.statusBreakdown[6]?.label).toBe('结束')
    expect(summary.statusBreakdown[2]).toBeUndefined()
  })

  it('非数字数量字符串被正确解析', () => {
    const order = createTestQuote({ quantity: 'abc', costPrice: 2.0, sellPriceNoTax: 3.0, sellPriceWithTax: 3.3 })
    const summary = calculateSummary([order])
    expect(summary.totalQuantity).toBe(0)
    expect(summary.totalCost).toBe(0)
  })
})

// ============================ 订单列表 Excel 生成测试 ============================

describe('generateOrdersExcel - 订单列表导出', () => {
  it('生成 Workbook 不为空', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    expect(workbook).toBeDefined()
    expect(workbook.worksheets.length).toBeGreaterThanOrEqual(1)
  })

  it('包含"订单明细"和"汇总统计"两个工作表', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheetNames = workbook.worksheets.map((s) => s.name)
    expect(sheetNames).toContain('订单明细')
    expect(sheetNames).toContain('汇总统计')
  })

  it('表头行包含所有字段', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheet = workbook.getWorksheet('订单明细')!
    // 第1行为分组标题行，第2行为列标题行
    const headerRow = sheet.getRow(2)
    const headerValues: string[] = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = headerRow.getCell(c).value
      if (v) headerValues.push(String(v))
    }
    expect(headerValues).toContain('订单号')
    expect(headerValues).toContain('客户名称')
    expect(headerValues).toContain('订单状态')
    expect(headerValues).toContain('成本价')
    expect(headerValues).toContain('单个卖价(不含税)')
    expect(headerValues).toContain('单个卖价(含税)')
    expect(headerValues).toContain('单个利润(不含税)')
    expect(headerValues).toContain('单个利润(含税)')
    expect(headerValues).toContain('销售总额(不含税)')
    expect(headerValues).toContain('销售总额(含税)')
    expect(headerValues).toContain('利润总额(不含税)')
    expect(headerValues).toContain('利润总额(含税)')
    expect(headerValues).toContain('款式')
    expect(headerValues).toContain('数量')
  })

  it('第1行分组标题行包含分组名称', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheet = workbook.getWorksheet('订单明细')!
    const groupRow = sheet.getRow(1)
    const groupValues: string[] = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = groupRow.getCell(c).value
      if (v) groupValues.push(String(v))
    }
    expect(groupValues).toContain('基本信息')
    expect(groupValues).toContain('产品信息')
    expect(groupValues).toContain('价格信息')
    expect(groupValues).toContain('生产周期')
    expect(groupValues).toContain('时间节点')
    expect(groupValues).toContain('其他')
  })

  it('数据行正确映射订单字段', async () => {
    const order = createTestQuote({
      quote_number: '导出测试-001',
      customerName: '导出测试客户',
      costPrice: 2.97,
      priceWithTax: 3.27,
      sellPriceNoTax: 3.42,
      sellPriceWithTax: 3.76,
      status: 3,
      productStyle: '1',
      quantity: '7200',
    })
    const workbook = await generateOrdersExcel([order])
    const sheet = workbook.getWorksheet('订单明细')!
    // 数据从第3行开始（第1行分组标题，第2行列标题）
    const dataRow = sheet.getRow(3)

    // 订单号（第1列）
    expect(dataRow.getCell(1).value).toBe('导出测试-001')
    // 客户名称（第2列）
    expect(dataRow.getCell(2).value).toBe('导出测试客户')
    // 订单状态（第3列）→ 标签
    expect(dataRow.getCell(3).value).toBe('做货中')
    // 款式（第4列）→ 标签
    expect(dataRow.getCell(4).value).toBe('无底无侧普通袋')
    // 数量（第10列）→ 数字
    expect(dataRow.getCell(10).value).toBe(7200)
    // 成本价（第12列）→ 数字
    expect(dataRow.getCell(12).value).toBe(2.97)
    // 含税价（第13列）→ 数字
    expect(dataRow.getCell(13).value).toBe(3.27)
    // 单个卖价不含税（第14列）
    expect(dataRow.getCell(14).value).toBe(3.42)
    // 单个卖价含税（第15列）
    expect(dataRow.getCell(15).value).toBe(3.76)
    // 单个利润(不含税)（第16列）= 单个卖价不含税 - 成本价 = 3.42 - 2.97 = 0.45
    expect(dataRow.getCell(16).value).toBe(0.45)
    // 单个利润(含税)（第17列）= 单个卖价含税 - 含税价 = 3.76 - 3.27 = 0.49
    expect(dataRow.getCell(17).value).toBe(0.49)
    // 销售总额(不含税)（第18列）= 数量 × 单个卖价不含税 = 7200 × 3.42 = 24624
    expect(dataRow.getCell(18).value).toBe(24624)
    // 销售总额(含税)（第19列）= 数量 × 单个卖价含税 = 7200 × 3.76 = 27072
    expect(dataRow.getCell(19).value).toBe(27072)
    // 利润总额(不含税)（第20列）= 单个利润(不含税) × 数量 = 0.45 × 7200 = 3240
    expect(dataRow.getCell(20).value).toBe(3240)
    // 利润总额(含税)（第21列）= 单个利润(含税) × 数量 = 0.49 × 7200 = 3528
    expect(dataRow.getCell(21).value).toBe(3528)
  })

  it('货币格式应用于价格列', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheet = workbook.getWorksheet('订单明细')!
    // 数据从第3行开始；成本价=12，含税价=13，单个卖价(不含税)=14，利润总额(含税)=21
    const costCell = sheet.getRow(3).getCell(12) // 成本价列
    expect(costCell.numFmt).toBe('¥#,##0.00')
    const priceWithTaxCell = sheet.getRow(3).getCell(13) // 含税价列
    expect(priceWithTaxCell.numFmt).toBe('¥#,##0.00')
    const sellNoTaxCell = sheet.getRow(3).getCell(14) // 单个卖价(不含税)列
    expect(sellNoTaxCell.numFmt).toBe('¥#,##0.00')
    const profitTotalWithTaxCell = sheet.getRow(3).getCell(21) // 利润总额(含税)列
    expect(profitTotalWithTaxCell.numFmt).toBe('¥#,##0.00')
  })

  it('表头行有加粗和背景色', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheet = workbook.getWorksheet('订单明细')!
    // 第1行分组标题行和第2行列标题行都应有加粗和背景色
    const groupCell = sheet.getRow(1).getCell(1)
    expect(groupCell.font?.bold).toBe(true)
    expect(groupCell.fill?.type).toBe('pattern')
    const headerCell = sheet.getRow(2).getCell(1)
    expect(headerCell.font?.bold).toBe(true)
    expect(headerCell.fill?.type).toBe('pattern')
  })

  it('冻结窗格设置在前两行和前两列', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheet = workbook.getWorksheet('订单明细')!
    expect(sheet.views?.[0]?.state).toBe('frozen')
    expect((sheet.views?.[0] as any)?.ySplit).toBe(2) // 冻结前2行表头
    expect((sheet.views?.[0] as any)?.xSplit).toBe(2) // 冻结前2列
  })

  it('交替行颜色应用于偶数行', async () => {
    const orders = [createTestQuote({ id: 'q1' }), createTestQuote({ id: 'q2' }), createTestQuote({ id: 'q3' })]
    const workbook = await generateOrdersExcel(orders)
    const sheet = workbook.getWorksheet('订单明细')!
    // 数据从第3行开始：row3 (rowIdx 0, 非交替色)，row4 (rowIdx 1, 交替色)
    const row3Fill = sheet.getRow(3).getCell(1).fill as any
    const row4Fill = sheet.getRow(4).getCell(1).fill as any
    // row4 应有交替行填充色（浅蓝 FFF2F6FC）
    expect(row4Fill?.type).toBe('pattern')
    expect(row4Fill?.fgColor?.argb).toBe('FFF2F6FC')
    // row3 非交替行，不应有交替色
    expect(row3Fill?.fgColor?.argb).not.toBe('FFF2F6FC')
  })

  it('汇总统计工作表包含关键指标', async () => {
    const orders = [
      createTestQuote({ id: 'q1', quantity: '100', costPrice: 2.0, priceWithTax: 2.2, sellPriceNoTax: 3.0, sellPriceWithTax: 3.3, status: 1 }),
      createTestQuote({ id: 'q2', quantity: '200', costPrice: 3.0, priceWithTax: 3.3, sellPriceNoTax: 4.0, sellPriceWithTax: 4.4, status: 3 }),
    ]
    const workbook = await generateOrdersExcel(orders)
    const summarySheet = workbook.getWorksheet('汇总统计')!
    // 读取所有单元格值
    const allValues: string[] = []
    summarySheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value) allValues.push(String(cell.value))
      })
    })
    expect(allValues.some((v) => v.includes('总订单数'))).toBe(true)
    expect(allValues.some((v) => v.includes('总数量'))).toBe(true)
    expect(allValues.some((v) => v.includes('总成本价'))).toBe(true)
    expect(allValues.some((v) => v.includes('总含税价'))).toBe(true)
    expect(allValues.some((v) => v.includes('销售总额(不含税)'))).toBe(true)
    expect(allValues.some((v) => v.includes('销售总额(含税)'))).toBe(true)
    expect(allValues.some((v) => v.includes('利润总额(不含税)'))).toBe(true)
    expect(allValues.some((v) => v.includes('利润总额(含税)'))).toBe(true)
    expect(allValues.some((v) => v.includes('订单状态分布'))).toBe(true)
  })

  it('空订单列表仍能生成 Workbook', async () => {
    const workbook = await generateOrdersExcel([])
    expect(workbook).toBeDefined()
    expect(workbook.worksheets.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================ 大数据量测试 ============================

describe('generateOrdersExcel - 大数据量导出', () => {
  it('1000 个订单导出成功且行数正确', async () => {
    const orders = generateLargeDataset(1000)
    const startTime = Date.now()
    const workbook = await generateOrdersExcel(orders)
    const elapsed = Date.now() - startTime

    const sheet = workbook.getWorksheet('订单明细')!
    // 行数 = 分组表头(1) + 列表头(1) + 数据行(1000) = 1002
    expect(sheet.rowCount).toBe(1002)
    // 性能：1000 条应在 5 秒内完成
    expect(elapsed).toBeLessThan(5000)
  })

  it('2000 个订单导出成功', async () => {
    const orders = generateLargeDataset(2000)
    const workbook = await generateOrdersExcel(orders)
    const sheet = workbook.getWorksheet('订单明细')!
    expect(sheet.rowCount).toBe(2002)
  })

  it('大数据量汇总统计正确', async () => {
    const orders = generateLargeDataset(100)
    const summary = calculateSummary(orders)
    expect(summary.totalOrders).toBe(100)
    // 每个订单数量为 1000+i
    const expectedQty = Array.from({ length: 100 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0)
    expect(summary.totalQuantity).toBe(expectedQty)
  })

  it('大数据量导出为 Buffer 成功', async () => {
    const orders = generateLargeDataset(500)
    const workbook = await generateOrdersExcel(orders)
    const buffer = await workbookToBuffer(workbook)
    expect(buffer).toBeDefined()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})

// ============================ 单订单 + 在线表格导出测试 ============================

describe('generateOrderWithTableExcel - 单订单含表格导出', () => {
  const tableExportData: TableExportData = {
    data: TABLE_DATA,
    formulas: TABLE_FORMULAS,
  }

  it('生成 Workbook 包含"订单信息"和"在线表格"工作表', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const sheetNames = workbook.worksheets.map((s) => s.name)
    expect(sheetNames).toContain('订单信息')
    expect(sheetNames).toContain('在线表格')
  })

  it('订单信息工作表包含分组标题', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const allValues: string[] = []
    infoSheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value) allValues.push(String(cell.value))
      })
    })
    expect(allValues.some((v) => v.includes('基本信息'))).toBe(true)
    expect(allValues.some((v) => v.includes('材料工艺'))).toBe(true)
    expect(allValues.some((v) => v.includes('价格信息'))).toBe(true)
    expect(allValues.some((v) => v.includes('时间节点'))).toBe(true)
  })

  it('订单信息工作表包含状态标签和款式标签', async () => {
    const order = createTestQuote({ status: 3, productStyle: '2' })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const allValues: string[] = []
    infoSheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value) allValues.push(String(cell.value))
      })
    })
    expect(allValues).toContain('做货中')
    expect(allValues).toContain('有底无侧普通袋')
  })

  it('订单信息工作表价格信息组包含含税价和利润字段', async () => {
    const order = createTestQuote({ costPrice: 2.97, priceWithTax: 3.27, sellPriceNoTax: 3.42, sellPriceWithTax: 3.76 })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    // 收集所有标签（每行的第1列和第3列是标签）
    const labels: string[] = []
    infoSheet.eachRow((row) => {
      const c1 = row.getCell(1).value
      const c3 = row.getCell(3).value
      if (c1) labels.push(String(c1))
      if (c3) labels.push(String(c3))
    })
    expect(labels).toContain('含税价')
    expect(labels).toContain('单个利润(不含税)')
    expect(labels).toContain('单个利润(含税)')
    expect(labels).toContain('销售总额(不含税)')
    expect(labels).toContain('销售总额(含税)')
    expect(labels).toContain('利润总额(不含税)')
    expect(labels).toContain('利润总额(含税)')
    // 读取所有值（默认数量 7200）
    const allValues: string[] = []
    infoSheet.eachRow((row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value) allValues.push(String(cell.value))
      })
    })
    // 单个利润(不含税) = 3.42 - 2.97 = 0.45
    expect(allValues).toContain('0.45')
    // 单个利润(含税) = 3.76 - 3.27 = 0.49
    expect(allValues).toContain('0.49')
    // 销售总额(不含税) = 7200 × 3.42 = 24624
    expect(allValues).toContain('24624')
    // 销售总额(含税) = 7200 × 3.76 = 27072
    expect(allValues).toContain('27072')
    // 利润总额(不含税) = 0.45 × 7200 = 3240
    expect(allValues).toContain('3240')
    // 利润总额(含税) = 0.49 × 7200 = 3528
    expect(allValues).toContain('3528')
  })

  it('在线表格工作表包含表格数据', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const tableSheet = workbook.getWorksheet('在线表格')!
    // 检查第一行第二列（数量标题）
    expect(tableSheet.getCell(1, 2).value).toBe('数量 (个)')
    // 检查第二行第一列（成品标签）
    expect(tableSheet.getCell(2, 1).value).toBe('成品')
    // 检查第二行第二列（数量 7200）
    expect(tableSheet.getCell(2, 2).value).toBe(7200)
  })

  it('公式正确写入 Excel 单元格', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const tableSheet = workbook.getWorksheet('在线表格')!

    // B3 = =B2 → ExcelJS formula 对象
    const b3 = tableSheet.getCell(3, 2) // row 3, col 2
    expect(b3.value).toBeDefined()
    expect(typeof b3.value).toBe('object')
    const formulaVal = b3.value as ExcelJS.CellFormulaValue
    expect(formulaVal.formula).toBe('B2')

    // H3 = =F3+C3
    const h3 = tableSheet.getCell(3, 8) // row 3, col 8
    const h3Val = h3.value as ExcelJS.CellFormulaValue
    expect(h3Val.formula).toBe('F3+C3')

    // J8 = =SUM(J6:J7)
    const j8 = tableSheet.getCell(8, 10) // row 8, col 10
    const j8Val = j8.value as ExcelJS.CellFormulaValue
    expect(j8Val.formula).toBe('SUM(J6:J7)')
  })

  it('含税价公式 K9 = J9*1.1 正确保留', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const tableSheet = workbook.getWorksheet('在线表格')!
    const k9 = tableSheet.getCell(9, 11) // row 9, col 11
    const k9Val = k9.value as ExcelJS.CellFormulaValue
    expect(k9Val.formula).toBe('J9*1.1')
  })

  it('利润公式 J10 = (J9-J8)*B2 正确保留', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const tableSheet = workbook.getWorksheet('在线表格')!
    const j10 = tableSheet.getCell(10, 10) // row 10, col 10
    const j10Val = j10.value as ExcelJS.CellFormulaValue
    expect(j10Val.formula).toBe('(J9-J8)*B2')
  })

  it('无公式时仅写入静态数据', async () => {
    const order = createTestQuote()
    const emptyFormulas: TableExportData = { data: TABLE_DATA, formulas: {} }
    const workbook = await generateOrderWithTableExcel(order, emptyFormulas)
    const tableSheet = workbook.getWorksheet('在线表格')!
    // B3 应该是静态值 7200（来自 data），而非公式对象
    const b3 = tableSheet.getCell(3, 2)
    expect(b3.value).toBe(7200)
  })

  it('空表格数据不报错', async () => {
    const order = createTestQuote()
    const emptyData: TableExportData = { data: [], formulas: {} }
    const workbook = await generateOrderWithTableExcel(order, emptyData)
    expect(workbook).toBeDefined()
    const tableSheet = workbook.getWorksheet('在线表格')!
    expect(tableSheet.rowCount).toBe(0) // 空表无数据行
  })

  it('导出为 Buffer 成功', async () => {
    const order = createTestQuote()
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const buffer = await workbookToBuffer(workbook)
    expect(buffer).toBeDefined()
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})

// ============================ 公式与数据混合测试 ============================

describe('公式与数据一致性', () => {
  it('公式单元格的 result 值与静态数据一致（当数据为数字时）', async () => {
    const order = createTestQuote()
    const tableExportData: TableExportData = {
      data: TABLE_DATA,
      formulas: { B3: '=B2' }, // B3 的静态数据是 7200
    }
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const tableSheet = workbook.getWorksheet('在线表格')!
    const b3 = tableSheet.getCell(3, 2)
    const formulaVal = b3.value as ExcelJS.CellFormulaValue
    // result 应该是静态数据中的值 7200
    expect(formulaVal.result).toBe(7200)
  })

  it('公式单元格的 result 为 undefined（当数据为非数字时）', async () => {
    const order = createTestQuote()
    const tableExportData: TableExportData = {
      data: TABLE_DATA,
      formulas: { A6: '=A3' }, // A6 没有静态数据（null）
    }
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const tableSheet = workbook.getWorksheet('在线表格')!
    const a6 = tableSheet.getCell(6, 1)
    const formulaVal = a6.value as ExcelJS.CellFormulaValue
    expect(formulaVal.result).toBeUndefined()
  })

  it('所有 6 种款式状态都能正确导出', async () => {
    const orders = [1, 2, 3, 4, 5, 6].map((st) =>
      createTestQuote({ id: `q-${st}`, status: st as Quote['status'] }),
    )
    const workbook = await generateOrdersExcel(orders)
    const sheet = workbook.getWorksheet('订单明细')!
    for (let i = 0; i < 6; i++) {
      // 数据从第3行开始；订单状态=第3列
      const statusCell = sheet.getRow(i + 3).getCell(3)
      expect(statusCell.value).toBe(getStatusLabel(i + 1))
    }
  })
})

// ============================ 使用 mockData 测试 ============================

describe('mockData 集成测试', () => {
  it('使用 mockQuotes 导出成功', async () => {
    const workbook = await generateOrdersExcel(mockQuotes as Quote[])
    const sheet = workbook.getWorksheet('订单明细')!
    // mockQuotes 有 3 条；行数 = 分组表头(1) + 列表头(1) + 数据行
    expect(sheet.rowCount).toBe(mockQuotes.length + 2)
  })

  it('mockQuotes 汇总统计正确', async () => {
    const summary = calculateSummary(mockQuotes as Quote[])
    expect(summary.totalOrders).toBe(mockQuotes.length)
    // quote-001 数量 7200, quote-002 数量 5000, quote-003 数量 10000
    expect(summary.totalQuantity).toBe(7200 + 5000 + 10000)
  })

  it('mockQuotes 包含 costPrice 字段', async () => {
    for (const q of mockQuotes as Quote[]) {
      expect(q.costPrice).toBeDefined()
      expect(typeof q.costPrice).toBe('number')
    }
  })
})

// ============================ 产品图片导出测试 ============================

// 最小的有效 PNG 图片（1x1 像素，透明）
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// 最小的有效 JPEG 图片（1x1 像素）
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD/2Q=='

describe('订单列表导出 - 产品图片列', () => {
  it('表头包含"产品图片"列', async () => {
    const workbook = await generateOrdersExcel([createTestQuote()])
    const sheet = workbook.getWorksheet('订单明细')!
    const headerValues: string[] = []
    // 列标题在第2行（第1行为分组标题）
    const headerRow = sheet.getRow(2)
    for (let c = 1; c <= sheet.columnCount; c++) {
      const v = headerRow.getCell(c).value
      if (v) headerValues.push(String(v))
    }
    expect(headerValues).toContain('产品图片')
  })

  it('有图片的订单显示"2张图片"', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG] })
    const workbook = await generateOrdersExcel([order])
    const sheet = workbook.getWorksheet('订单明细')!
    // 找到产品图片列（倒数第3列，索引 = columnCount - 2）
    const imgColIdx = sheet.columnCount - 2
    // 数据从第3行开始
    const cellValue = sheet.getRow(3).getCell(imgColIdx).value
    expect(cellValue).toBe('2张图片')
  })

  it('无图片的订单显示"无"', async () => {
    const order = createTestQuote({ images: [] })
    const workbook = await generateOrdersExcel([order])
    const sheet = workbook.getWorksheet('订单明细')!
    const imgColIdx = sheet.columnCount - 2
    const cellValue = sheet.getRow(3).getCell(imgColIdx).value
    expect(cellValue).toBe('无')
  })

  it('images 为 undefined 时不报错', async () => {
    const order = createTestQuote({ images: undefined as any })
    const workbook = await generateOrdersExcel([order])
    const sheet = workbook.getWorksheet('订单明细')!
    const imgColIdx = sheet.columnCount - 2
    const cellValue = sheet.getRow(3).getCell(imgColIdx).value
    expect(cellValue).toBe('无')
  })
})

describe('单订单导出 - 产品图片嵌入订单信息工作表', () => {
  const tableExportData: TableExportData = {
    data: TABLE_DATA,
    formulas: TABLE_FORMULAS,
  }

  /** 收集工作表 A 列所有非空值 */
  function getColumnAValues(sheet: ExcelJS.Worksheet): string[] {
    const values: string[] = []
    sheet.getColumn(1).eachCell({ includeEmpty: false }, (cell) => {
      if (cell.value) values.push(String(cell.value))
    })
    return values
  }

  it('有图片时不创建单独"产品图片"工作表，图片嵌入"订单信息"工作表', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const sheetNames = workbook.worksheets.map((s) => s.name)
    // 不应有单独的"产品图片"工作表
    expect(sheetNames).not.toContain('产品图片')
    // 图片内容应在"订单信息"工作表中
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    expect(colAValues.some((v) => v.includes('产品图片'))).toBe(true)
    // 不显示图片名称标签
    expect(colAValues).not.toContain('图片 1')
    expect(colAValues).not.toContain('图片 2')
    // 两张图片均已嵌入
    expect(infoSheet.getImages().length).toBe(2)
  })

  it('无图片时"订单信息"工作表不包含图片分组', async () => {
    const order = createTestQuote({ images: [] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const sheetNames = workbook.worksheets.map((s) => s.name)
    expect(sheetNames).not.toContain('产品图片')
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    expect(colAValues.some((v) => v.includes('产品图片'))).toBe(false)
  })

  it('images 为 undefined 时不报错且不包含图片分组', async () => {
    const order = createTestQuote({ images: undefined as any })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const sheetNames = workbook.worksheets.map((s) => s.name)
    expect(sheetNames).not.toContain('产品图片')
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    expect(colAValues.some((v) => v.includes('产品图片'))).toBe(false)
  })

  it('产品图片分组标题显示图片数量', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    const title = colAValues.find((v) => v.includes('产品图片'))
    expect(title).toBeDefined()
    expect(title!).toContain('2')
  })

  it('产品图片在同一行水平排列且无图片名称', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    // 不显示图片名称标签
    expect(colAValues).not.toContain('图片 1')
    expect(colAValues).not.toContain('图片 2')
    // 所有图片在同一行（tl.row 相同）
    const images = infoSheet.getImages()
    expect(images.length).toBe(2)
    const imgRows = images.map((img: any) => img.range?.tl?.row ?? img.range?.tl?.nativeRow)
    expect(new Set(imgRows).size).toBe(1)
  })

  it('单张图片导出成功', async () => {
    const order = createTestQuote({ images: [TINY_PNG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    expect(colAValues.some((v) => v.includes('产品图片') && v.includes('1'))).toBe(true)
    expect(infoSheet.getImages().length).toBe(1)
  })

  it('PNG 和 JPEG 格式都能嵌入', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const buffer = await workbookToBuffer(workbook)
    expect(buffer.byteLength).toBeGreaterThan(0)
  })

  it('无效图片数据 URI 被跳过不报错', async () => {
    const order = createTestQuote({ images: ['not-a-valid-data-uri', TINY_PNG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    // 只有 1 张有效图片
    const title = colAValues.find((v) => v.includes('产品图片'))
    expect(title).toBeDefined()
    expect(title!).toContain('1')
    // 无图片名称标签
    expect(colAValues).not.toContain('图片 1')
    expect(infoSheet.getImages().length).toBe(1)
  })

  it('全部无效图片时不包含图片分组', async () => {
    const order = createTestQuote({ images: ['invalid1', 'invalid2'] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const sheetNames = workbook.worksheets.map((s) => s.name)
    expect(sheetNames).not.toContain('产品图片')
    const infoSheet = workbook.getWorksheet('订单信息')!
    const colAValues = getColumnAValues(infoSheet)
    expect(colAValues.some((v) => v.includes('产品图片'))).toBe(false)
  })

  it('多张图片导出为 Buffer 成功', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG, TINY_PNG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const buffer = await workbookToBuffer(workbook)
    expect(buffer.byteLength).toBeGreaterThan(0)
    // xlsx 是 ZIP 压缩格式，验证 ZIP 文件头（PK = 0x50 0x4B）
    expect(buffer[0]).toBe(0x50) // 'P'
    expect(buffer[1]).toBe(0x4b) // 'K'
  })

  it('图片分组标题样式与其他分组一致（蓝底白字加粗）', async () => {
    const order = createTestQuote({ images: [TINY_PNG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    // 找到"产品图片"分组标题所在的行
    let titleRow = -1
    infoSheet.getColumn(1).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (String(cell.value).includes('产品图片')) titleRow = rowNumber
    })
    expect(titleRow).toBeGreaterThan(0)
    const titleCell = infoSheet.getCell(`A${titleRow}`)
    expect(titleCell.font?.bold).toBe(true)
    expect(titleCell.fill?.type).toBe('pattern')
  })

  it('图片行高度已设置以容纳图片', async () => {
    const order = createTestQuote({ images: [TINY_PNG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    // 找到"产品图片"分组标题所在行，图片在其下一行
    let titleRow = -1
    infoSheet.getColumn(1).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (String(cell.value).includes('产品图片')) titleRow = rowNumber
    })
    expect(titleRow).toBeGreaterThan(0)
    const rowHeight = infoSheet.getRow(titleRow + 1).height
    expect(rowHeight).toBeGreaterThan(100) // 图片行应高于普通行
  })
})

// ============================ 图片尺寸解析与等比缩放测试 ============================

/** 从 base64 data URI 中提取 Buffer */
function extractBuffer(dataUri: string): Buffer {
  const m = dataUri.match(/^data:image\/[\w+]+;base64,(.+)$/i)
  return Buffer.from(m ? m[1] : dataUri, 'base64')
}

/** 构造最小 PNG 头部 Buffer（仅签名 + IHDR，用于测试尺寸解析） */
function makeMinimalPngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24)
  // PNG 签名
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a
  // IHDR 长度 = 13
  buf.writeUInt32BE(13, 8)
  // "IHDR" 类型
  buf.write('IHDR', 12, 'ascii')
  // 宽度、高度（大端序）
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

/** 构造最小 GIF 头部 Buffer（签名 + 逻辑屏幕描述符） */
function makeMinimalGifHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(10)
  // GIF87a 签名
  buf.write('GIF87a', 0, 'ascii')
  // 宽度、高度（小端序）
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)
  return buf
}

describe('getImageDimensions - 图片尺寸解析', () => {
  it('正确解析 1x1 PNG', () => {
    const buf = extractBuffer(TINY_PNG)
    const dims = getImageDimensions(buf, 'png')
    expect(dims).toEqual({ width: 1, height: 1 })
  })

  it('正确解析 1x1 JPEG', () => {
    const buf = extractBuffer(TINY_JPEG)
    const dims = getImageDimensions(buf, 'jpeg')
    expect(dims).toEqual({ width: 1, height: 1 })
  })

  it('正确解析宽图 PNG（200x100）', () => {
    const buf = makeMinimalPngHeader(200, 100)
    const dims = getImageDimensions(buf, 'png')
    expect(dims).toEqual({ width: 200, height: 100 })
  })

  it('正确解析高图 PNG（100x200）', () => {
    const buf = makeMinimalPngHeader(100, 200)
    const dims = getImageDimensions(buf, 'png')
    expect(dims).toEqual({ width: 100, height: 200 })
  })

  it('正确解析大尺寸 PNG（1920x1080）', () => {
    const buf = makeMinimalPngHeader(1920, 1080)
    const dims = getImageDimensions(buf, 'png')
    expect(dims).toEqual({ width: 1920, height: 1080 })
  })

  it('正确解析 GIF 尺寸', () => {
    const buf = makeMinimalGifHeader(300, 150)
    const dims = getImageDimensions(buf, 'gif')
    expect(dims).toEqual({ width: 300, height: 150 })
  })

  it('Buffer 过短时返回 null', () => {
    expect(getImageDimensions(Buffer.alloc(5), 'png')).toBeNull()
    expect(getImageDimensions(Buffer.alloc(5), 'gif')).toBeNull()
  })

  it('无效数据返回 null', () => {
    expect(getImageDimensions(Buffer.alloc(100), 'png')).toBeNull()
  })
})

describe('scaleProportionally - 等比缩放', () => {
  const MAX_W = 400
  const MAX_H = 300

  it('dims 为 null 时回退到最大尺寸', () => {
    const result = scaleProportionally(null, MAX_W, MAX_H)
    expect(result).toEqual({ width: MAX_W, height: MAX_H })
  })

  it('宽高为零时回退到最大尺寸', () => {
    expect(scaleProportionally({ width: 0, height: 100 }, MAX_W, MAX_H)).toEqual({ width: MAX_W, height: MAX_H })
    expect(scaleProportionally({ width: 100, height: 0 }, MAX_W, MAX_H)).toEqual({ width: MAX_W, height: MAX_H })
  })

  it('2:1 宽图（200x100）→ 以宽度为约束，缩放为 400x200', () => {
    const result = scaleProportionally({ width: 200, height: 100 }, MAX_W, MAX_H)
    expect(result.width).toBe(400)
    expect(result.height).toBe(200)
    // 保持宽高比
    expect(result.width / result.height).toBeCloseTo(2, 1)
  })

  it('1:2 高图（100x200）→ 以高度为约束，缩放为 150x300', () => {
    const result = scaleProportionally({ width: 100, height: 200 }, MAX_W, MAX_H)
    expect(result.width).toBe(150)
    expect(result.height).toBe(300)
    // 保持宽高比
    expect(result.width / result.height).toBeCloseTo(0.5, 1)
  })

  it('1:1 方图（100x100）→ 以高度为约束，缩放为 300x300', () => {
    const result = scaleProportionally({ width: 100, height: 100 }, MAX_W, MAX_H)
    expect(result.width).toBe(300)
    expect(result.height).toBe(300)
  })

  it('16:9 宽屏（1920x1080）→ 以宽度为约束，缩放为 400x225', () => {
    const result = scaleProportionally({ width: 1920, height: 1080 }, MAX_W, MAX_H)
    expect(result.width).toBe(400)
    expect(result.height).toBe(225)
    expect(result.width / result.height).toBeCloseTo(16 / 9, 2)
  })

  it('4:3（800x600）→ 恰好填满 400x300', () => {
    const result = scaleProportionally({ width: 800, height: 600 }, MAX_W, MAX_H)
    expect(result.width).toBe(400)
    expect(result.height).toBe(300)
  })

  it('缩放后保持原始宽高比（不拉伸失真）', () => {
    const testCases = [
      { width: 300, height: 200 },
      { width: 640, height: 480 },
      { width: 1080, height: 1920 },
      { width: 750, height: 500 },
    ]
    for (const dims of testCases) {
      const result = scaleProportionally(dims, MAX_W, MAX_H)
      const originalRatio = dims.width / dims.height
      const scaledRatio = result.width / result.height
      // 像素取整允许 ~0.01 的误差
      expect(scaledRatio).toBeCloseTo(originalRatio, 1)
    }
  })

  it('缩放后尺寸不超过最大约束', () => {
    const testCases = [
      { width: 1, height: 1 },
      { width: 500, height: 100 },
      { width: 100, height: 500 },
      { width: 1000, height: 1000 },
    ]
    for (const dims of testCases) {
      const result = scaleProportionally(dims, MAX_W, MAX_H)
      expect(result.width).toBeLessThanOrEqual(MAX_W)
      expect(result.height).toBeLessThanOrEqual(MAX_H)
    }
  })
})

describe('产品图片等比缩放 - 导出集成测试', () => {
  const tableExportData: TableExportData = {
    data: TABLE_DATA,
    formulas: TABLE_FORMULAS,
  }

  /** 找到"产品图片"分组标题下一行（图片行）的行高 */
  function getImageRowHeight(sheet: ExcelJS.Worksheet): number | undefined {
    let titleRow = -1
    sheet.getColumn(1).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (String(cell.value).includes('产品图片')) titleRow = rowNumber
    })
    return titleRow > 0 ? sheet.getRow(titleRow + 1).height : undefined
  }

  it('1x1 方图（TINY_PNG）缩放后行高对应 180px 高度', async () => {
    const order = createTestQuote({ images: [TINY_PNG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const rowHeight = getImageRowHeight(infoSheet)
    expect(rowHeight).toBeDefined()
    // 1:1 方图 → 缩放为 180x180px → 行高 = 180 * 0.75 + 5 = 140
    expect(rowHeight).toBeCloseTo(140, 0)
  })

  it('PNG 和 JPEG 方图在同一行且行高已设置', async () => {
    const order = createTestQuote({ images: [TINY_PNG, TINY_JPEG] })
    const workbook = await generateOrderWithTableExcel(order, tableExportData)
    const infoSheet = workbook.getWorksheet('订单信息')!
    const rowHeight = getImageRowHeight(infoSheet)
    expect(rowHeight).toBeDefined()
    // 两者都是 1:1 方图，缩放为 180x180px → 行高 = 180 * 0.75 + 5 = 140
    expect(rowHeight).toBeCloseTo(140, 0)
    // 两张图片在同一行
    expect(infoSheet.getImages().length).toBe(2)
  })
})
