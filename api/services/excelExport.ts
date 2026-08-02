/**
 * 订单 Excel 导出服务
 *
 * 基于 ExcelJS 生成格式化的 Excel 文件，支持：
 * 1. 订单列表导出（全部字段、状态标签、价格信息、汇总统计）
 * 2. 单订单导出（含在线表格数据 + 公式保留）
 *
 * 格式化特性：
 * - 列宽自适应（基于内容长度）
 * - 表头加粗 + 背景色 + 冻结窗格
 * - 交替行颜色
 * - 货币/日期/状态格式化
 * - 文本左对齐、数字右对齐
 * - 汇总统计区域
 */
import ExcelJS from 'exceljs'
import type { Quote } from '../types/index.js'

// ============================ 常量定义 ============================

const STATUS_OPTIONS = [
  { value: 1, label: '报价中' },
  { value: 2, label: '打样中' },
  { value: 3, label: '做货中' },
  { value: 4, label: '已发货未收款' },
  { value: 5, label: '已发货已收款' },
  { value: 6, label: '结束' },
]

const PRODUCT_STYLE_OPTIONS = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

/** 订单列表导出的列定义 */
interface ExportColumn {
  header: string
  key: string
  width: number
  type: 'text' | 'number' | 'currency' | 'date' | 'status' | 'style' | 'images' | 'profit_no_tax' | 'profit_with_tax' | 'profit_total_no_tax' | 'profit_total_with_tax' | 'sell_total_no_tax' | 'sell_total_with_tax'
  group: string
  groupColor: string
}

// 分组颜色（浅色背景用于分组标题行）
const GROUP_COLORS: Record<string, string> = {
  '基本信息': 'FF4472C4',
  '产品信息': 'FF70AD47',
  '价格信息': 'FFFFC000',
  '生产周期': 'FFED7D31',
  '时间节点': 'FF7030A0',
  '其他': 'FF808080',
}

const ORDER_COLUMNS: ExportColumn[] = [
  // 基本信息
  { header: '订单号', key: 'quote_number', width: 28, type: 'text', group: '基本信息', groupColor: GROUP_COLORS['基本信息'] },
  { header: '客户名称', key: 'customerName', width: 16, type: 'text', group: '基本信息', groupColor: GROUP_COLORS['基本信息'] },
  { header: '订单状态', key: 'status', width: 10, type: 'status', group: '基本信息', groupColor: GROUP_COLORS['基本信息'] },
  // 产品信息
  { header: '款式', key: 'productStyle', width: 12, type: 'style', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '产品规格', key: 'productSpec', width: 12, type: 'text', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '面料材质', key: 'fabricMaterial', width: 12, type: 'text', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '工艺', key: 'process', width: 12, type: 'text', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '手提材质', key: 'handleMaterial', width: 10, type: 'text', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '手提规格', key: 'handleSpec', width: 14, type: 'text', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '数量', key: 'quantity', width: 8, type: 'number', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  { header: '箱规', key: 'boxSpec', width: 8, type: 'text', group: '产品信息', groupColor: GROUP_COLORS['产品信息'] },
  // 价格信息
  { header: '成本价', key: 'costPrice', width: 10, type: 'currency', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '含税价', key: 'priceWithTax', width: 10, type: 'currency', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '单个卖价(不含税)', key: 'sellPriceNoTax', width: 18, type: 'currency', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '单个卖价(含税)', key: 'sellPriceWithTax', width: 16, type: 'currency', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '单个利润(不含税)', key: 'profitNoTax', width: 18, type: 'profit_no_tax', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '单个利润(含税)', key: 'profitWithTax', width: 16, type: 'profit_with_tax', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '销售总额(不含税)', key: 'sellTotalNoTax', width: 18, type: 'sell_total_no_tax', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '销售总额(含税)', key: 'sellTotalWithTax', width: 16, type: 'sell_total_with_tax', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '利润总额(不含税)', key: 'profitTotalNoTax', width: 18, type: 'profit_total_no_tax', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '利润总额(含税)', key: 'profitTotalWithTax', width: 16, type: 'profit_total_with_tax', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '单价', key: 'unitPrice', width: 10, type: 'text', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  { header: '打样费', key: 'sampleFee', width: 10, type: 'text', group: '价格信息', groupColor: GROUP_COLORS['价格信息'] },
  // 生产周期
  { header: '打样天数', key: 'sampleDays', width: 8, type: 'text', group: '生产周期', groupColor: GROUP_COLORS['生产周期'] },
  { header: '大货天数', key: 'massDays', width: 8, type: 'text', group: '生产周期', groupColor: GROUP_COLORS['生产周期'] },
  { header: '做货开始日期', key: 'productionTimeStart', width: 10, type: 'date', group: '生产周期', groupColor: GROUP_COLORS['生产周期'] },
  { header: '做货结束日期', key: 'productionTimeEnd', width: 10, type: 'date', group: '生产周期', groupColor: GROUP_COLORS['生产周期'] },
  // 时间节点
  { header: '报价时间', key: 'quoteTime', width: 10, type: 'date', group: '时间节点', groupColor: GROUP_COLORS['时间节点'] },
  { header: '打样时间', key: 'sampleTime', width: 10, type: 'date', group: '时间节点', groupColor: GROUP_COLORS['时间节点'] },
  { header: '做货开始时间', key: 'productionStartTime', width: 10, type: 'date', group: '时间节点', groupColor: GROUP_COLORS['时间节点'] },
  { header: '发货时间', key: 'shippingTime', width: 10, type: 'date', group: '时间节点', groupColor: GROUP_COLORS['时间节点'] },
  { header: '收款时间', key: 'paymentTime', width: 10, type: 'date', group: '时间节点', groupColor: GROUP_COLORS['时间节点'] },
  { header: '结束时间', key: 'endTime', width: 10, type: 'date', group: '时间节点', groupColor: GROUP_COLORS['时间节点'] },
  // 其他
  { header: '收货地址', key: 'shippingAddress', width: 16, type: 'text', group: '其他', groupColor: GROUP_COLORS['其他'] },
  { header: '备注', key: 'remark', width: 16, type: 'text', group: '其他', groupColor: GROUP_COLORS['其他'] },
  { header: '产品图片', key: 'images', width: 8, type: 'images', group: '其他', groupColor: GROUP_COLORS['其他'] },
  { header: '创建时间', key: 'created_at', width: 14, type: 'date', group: '其他', groupColor: GROUP_COLORS['其他'] },
  { header: '更新时间', key: 'updated_at', width: 14, type: 'date', group: '其他', groupColor: GROUP_COLORS['其他'] },
]

// ============================ 辅助函数 ============================

/** 获取状态标签 */
export function getStatusLabel(status: number): string {
  const option = STATUS_OPTIONS.find((o) => o.value === status)
  return option ? option.label : '未知'
}

/** 获取款式标签 */
export function getStyleLabel(value: string): string {
  const option = PRODUCT_STYLE_OPTIONS.find((opt) => opt.value === value)
  return option ? option.label : value
}

/** 生成带时间戳的文件名 */
export function generateFileName(prefix: string = 'OrderExport'): string {
  const now = new Date()
  const ts = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
  return `${prefix}_${ts}.xlsx`
}

/** 解析数量字符串为数字 */
function parseQuantity(qty: string | number): number {
  const n = typeof qty === 'number' ? qty : parseFloat(qty)
  return isNaN(n) ? 0 : n
}

/** 保留2位小数（四舍五入）：总额计算以保留2位小数的价格为基础 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 将 ISO 日期字符串转为 Date 对象（仅日期部分） */
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

/** 自动调整列宽（基于内容长度，限制在 min-max 范围内，紧凑模式） */
function autoFitColumnWidths(sheet: ExcelJS.Worksheet, columns: ExportColumn[], headerRowCount: number = 2): void {
  // 预设基础宽度
  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width
  })
  // 遍历数据行，按内容长度动态扩展（不缩小，上限 30）
  const colCount = columns.length
  sheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRowCount) return // 跳过表头行
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (colNumber > colCount) return
      const val = cell.value
      const text = val == null ? '' : typeof val === 'object' ? String(val.toString()) : String(val)
      const needed = Math.min(Math.max(text.length * 1.1 + 2, 8), 30)
      const current = sheet.getColumn(colNumber).width ?? columns[colNumber - 1]?.width ?? 12
      if (needed > current) {
        sheet.getColumn(colNumber).width = needed
      }
    })
  })
}

// ============================ 格式化样式 ============================

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4472C4' },
}

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
}

const ALT_ROW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF2F6FC' },
}

const CURRENCY_FMT = '¥#,##0.00'
const DATE_FMT = 'yyyy-mm-dd'

/** 应用单元格格式化（货币、日期、对齐） */
function applyCellFormat(cell: ExcelJS.Cell, col: ExportColumn, value: any): void {
  switch (col.type) {
    case 'currency':
    case 'profit_no_tax':
    case 'profit_with_tax':
    case 'profit_total_no_tax':
    case 'profit_total_with_tax':
    case 'sell_total_no_tax':
    case 'sell_total_with_tax':
      cell.numFmt = CURRENCY_FMT
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      break
    case 'number':
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
      break
    case 'date':
      if (value instanceof Date) {
        cell.numFmt = DATE_FMT
      }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      break
    case 'status':
    case 'style':
    case 'images':
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      break
    default:
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
  }
}

/** 将 Quote 字段值转换为导出值 */
function convertFieldValue(quote: Quote, col: ExportColumn): any {
  const raw = (quote as any)[col.key]
  switch (col.type) {
    case 'status':
      return getStatusLabel(typeof raw === 'number' ? raw : parseInt(raw) || 0)
    case 'style':
      return getStyleLabel(String(raw || ''))
    case 'images': {
      const imgs = Array.isArray(raw) ? raw : []
      return imgs.length > 0 ? `${imgs.length}张图片` : '无'
    }
    case 'number':
      return parseQuantity(raw)
    case 'currency':
      return typeof raw === 'number' ? raw : 0
    case 'profit_no_tax': {
      // 单个利润(不含税) = 单个卖价(不含税) - 成本价（以保留2位小数的价格计算）
      const sellNoTax = round2(typeof quote.sellPriceNoTax === 'number' ? quote.sellPriceNoTax : 0)
      const cost = round2(typeof quote.costPrice === 'number' ? quote.costPrice : 0)
      return round2(sellNoTax - cost)
    }
    case 'profit_with_tax': {
      // 单个利润(含税) = 单个卖价(含税) - 含税价（以保留2位小数的价格计算）
      const sellWithTax = round2(typeof quote.sellPriceWithTax === 'number' ? quote.sellPriceWithTax : 0)
      const priceWithTax = round2(typeof quote.priceWithTax === 'number' ? quote.priceWithTax : 0)
      return round2(sellWithTax - priceWithTax)
    }
    case 'sell_total_no_tax': {
      // 销售总额(不含税) = 数量 × 单个卖价(不含税)（以保留2位小数的价格计算）
      const sellNoTax = round2(typeof quote.sellPriceNoTax === 'number' ? quote.sellPriceNoTax : 0)
      return round2(sellNoTax * parseQuantity(quote.quantity))
    }
    case 'sell_total_with_tax': {
      // 销售总额(含税) = 数量 × 单个卖价(含税)（以保留2位小数的价格计算）
      const sellWithTax = round2(typeof quote.sellPriceWithTax === 'number' ? quote.sellPriceWithTax : 0)
      return round2(sellWithTax * parseQuantity(quote.quantity))
    }
    case 'profit_total_no_tax': {
      // 利润总额(不含税) = (单个卖价(不含税) - 成本价) × 数量（以保留2位小数的单个利润为基础）
      const sellNoTax = round2(typeof quote.sellPriceNoTax === 'number' ? quote.sellPriceNoTax : 0)
      const cost = round2(typeof quote.costPrice === 'number' ? quote.costPrice : 0)
      return round2(round2(sellNoTax - cost) * parseQuantity(quote.quantity))
    }
    case 'profit_total_with_tax': {
      // 利润总额(含税) = (单个卖价(含税) - 含税价) × 数量（以保留2位小数的单个利润为基础）
      const sellWithTax = round2(typeof quote.sellPriceWithTax === 'number' ? quote.sellPriceWithTax : 0)
      const priceWithTax = round2(typeof quote.priceWithTax === 'number' ? quote.priceWithTax : 0)
      return round2(round2(sellWithTax - priceWithTax) * parseQuantity(quote.quantity))
    }
    case 'date': {
      if (!raw) return ''
      const d = parseDate(String(raw))
      return d ?? ''
    }
    default:
      return raw ?? ''
  }
}

// ============================ 汇总统计 ============================

export interface ExportSummary {
  totalOrders: number
  totalQuantity: number
  totalCost: number
  totalPriceWithTax: number
  totalSellNoTax: number
  totalSellWithTax: number
  totalProfitNoTax: number
  totalProfitWithTax: number
  /** 旧字段（= totalProfitNoTax），保留以兼容 */
  totalProfit: number
  statusBreakdown: Record<number, { label: string; count: number }>
}

/** 计算汇总统计 */
export function calculateSummary(orders: Quote[]): ExportSummary {
  let totalQuantity = 0
  let totalCost = 0
  let totalPriceWithTax = 0
  let totalSellNoTax = 0
  let totalSellWithTax = 0
  let totalProfitNoTax = 0
  let totalProfitWithTax = 0
  const statusBreakdown: Record<number, { label: string; count: number }> = {}

  for (const order of orders) {
    const qty = parseQuantity(order.quantity)
    // 以保留2位小数的价格为计算基础（与行级计算保持一致，确保列汇总 = 单元格之和）
    const cost = round2(order.costPrice || 0)
    const priceWithTax = round2(order.priceWithTax || 0)
    const sellNoTax = round2(order.sellPriceNoTax || 0)
    const sellWithTax = round2(order.sellPriceWithTax || 0)
    totalQuantity += qty
    totalCost += cost * qty
    totalPriceWithTax += priceWithTax * qty
    totalSellNoTax += sellNoTax * qty
    totalSellWithTax += sellWithTax * qty
    // 利润总额 = 单个利润(保留2位) × 数量
    totalProfitNoTax += round2(sellNoTax - cost) * qty
    totalProfitWithTax += round2(sellWithTax - priceWithTax) * qty
    const st = typeof order.status === 'number' ? order.status : parseInt(String(order.status)) || 0
    if (!statusBreakdown[st]) {
      statusBreakdown[st] = { label: getStatusLabel(st), count: 0 }
    }
    statusBreakdown[st].count++
  }

  const profitNoTax = Math.round(totalProfitNoTax * 100) / 100
  const profitWithTax = Math.round(totalProfitWithTax * 100) / 100

  return {
    totalOrders: orders.length,
    totalQuantity,
    totalCost: Math.round(totalCost * 100) / 100,
    totalPriceWithTax: Math.round(totalPriceWithTax * 100) / 100,
    totalSellNoTax: Math.round(totalSellNoTax * 100) / 100,
    totalSellWithTax: Math.round(totalSellWithTax * 100) / 100,
    totalProfitNoTax: profitNoTax,
    totalProfitWithTax: profitWithTax,
    totalProfit: profitNoTax,
    statusBreakdown,
  }
}

// ============================ 订单列表导出 ============================

/**
 * 生成订单列表 Excel（含汇总统计区域 + 格式化）
 *
 * @param orders 订单列表
 * @returns ExcelJS Workbook（调用方负责写入流）
 */
export async function generateOrdersExcel(orders: Quote[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '订单管理系统'
  workbook.created = new Date()

  // ---- Sheet 1: 订单明细 ----（两行表头：分组标题 + 列标题）
  const sheet = workbook.addWorksheet('订单明细', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
    pageSetup: {
      orientation: 'landscape',
      fitToWidth: 1,
      fitToHeight: 0,
    },
    properties: {
      defaultRowHeight: 18,
    },
  })

  // === 第1行：分组标题行（合并同组列，颜色区分） ===
  const groupHeaderRow = sheet.getRow(1)
  groupHeaderRow.height = 22
  let groupStart = 1
  for (let i = 0; i < ORDER_COLUMNS.length; i++) {
    const col = ORDER_COLUMNS[i]
    const isLastInGroup = i === ORDER_COLUMNS.length - 1 || ORDER_COLUMNS[i + 1].group !== col.group
    if (isLastInGroup) {
      const groupEnd = i + 1
      // 合并分组单元格
      if (groupEnd > groupStart) {
        sheet.mergeCells(1, groupStart, 1, groupEnd)
      }
      const gCell = groupHeaderRow.getCell(groupStart)
      gCell.value = col.group
      gCell.font = HEADER_FONT
      gCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.groupColor } }
      gCell.alignment = { horizontal: 'center', vertical: 'middle' }
      gCell.border = thinBorder()
      // 填充合并区域内所有单元格的边框和背景
      for (let c = groupStart; c <= groupEnd; c++) {
        const cell = groupHeaderRow.getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.groupColor } }
        cell.border = thinBorder()
      }
      groupStart = groupEnd + 1
    }
  }

  // === 第2行：列标题行 ===
  const headerRow = sheet.getRow(2)
  headerRow.height = 22
  ORDER_COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = col.header
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = thinBorder()
  })

  // === 数据行（交替颜色，从第3行开始） ===
  orders.forEach((order, rowIdx) => {
    const row = sheet.getRow(rowIdx + 3)
    const isAlt = rowIdx % 2 === 1
    ORDER_COLUMNS.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1)
      const value = convertFieldValue(order, col)
      cell.value = value
      applyCellFormat(cell, col, value)
      if (isAlt) cell.fill = ALT_ROW_FILL
      cell.border = thinBorder()
    })
  })

  // 列宽自适应（紧凑模式，跳过前2行表头）
  autoFitColumnWidths(sheet, ORDER_COLUMNS, 2)

  // ---- Sheet 2: 汇总统计 ----
  const summary = calculateSummary(orders)
  const summarySheet = workbook.addWorksheet('汇总统计', {
    views: [{ state: 'frozen', ySplit: 0 }],
  })

  summarySheet.getColumn(1).width = 20
  summarySheet.getColumn(2).width = 18
  summarySheet.getColumn(3).width = 16

  // 标题
  const titleCell = summarySheet.getCell('A1')
  titleCell.value = '订单导出汇总统计'
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF4472C4' } }
  summarySheet.mergeCells('A1:C1')

  // 导出时间
  const timeCell = summarySheet.getCell('A2')
  timeCell.value = `导出时间：${new Date().toLocaleString('zh-CN')}`
  summarySheet.mergeCells('A2:C2')

  // 关键指标
  const metrics: [string, any, string?][] = [
    ['总订单数', summary.totalOrders, 'count'],
    ['总数量', summary.totalQuantity, 'count'],
    ['总成本价', summary.totalCost, 'currency'],
    ['总含税价', summary.totalPriceWithTax, 'currency'],
    ['销售总额(不含税)', summary.totalSellNoTax, 'currency'],
    ['销售总额(含税)', summary.totalSellWithTax, 'currency'],
    ['利润总额(不含税)', summary.totalProfitNoTax, 'currency'],
    ['利润总额(含税)', summary.totalProfitWithTax, 'currency'],
  ]

  let r = 4
  for (const [label, value, fmt] of metrics) {
    const labelCell = summarySheet.getCell(`A${r}`)
    labelCell.value = label
    labelCell.font = { bold: true }
    const valCell = summarySheet.getCell(`B${r}`)
    valCell.value = value
    if (fmt === 'currency') {
      valCell.numFmt = CURRENCY_FMT
      valCell.alignment = { horizontal: 'right' }
    } else {
      valCell.alignment = { horizontal: 'right' }
    }
    r++
  }

  // 状态分布
  r += 1
  const statusTitle = summarySheet.getCell(`A${r}`)
  statusTitle.value = '订单状态分布'
  statusTitle.font = { bold: true, size: 12, color: { argb: 'FF4472C4' } }
  r++
  const sHeader = summarySheet.getRow(r)
  sHeader.getCell(1).value = '状态'
  sHeader.getCell(2).value = '订单数'
  sHeader.getCell(1).font = HEADER_FONT
  sHeader.getCell(2).font = HEADER_FONT
  sHeader.getCell(1).fill = HEADER_FILL
  sHeader.getCell(2).fill = HEADER_FILL
  r++
  for (const st of [1, 2, 3, 4, 5, 6]) {
    const info = summary.statusBreakdown[st]
    if (!info) continue
    const row = summarySheet.getRow(r)
    row.getCell(1).value = info.label
    row.getCell(2).value = info.count
    row.getCell(2).alignment = { horizontal: 'right' }
    r++
  }

  return workbook
}

// ============================ 单订单 + 在线表格导出 ============================

/** 在线表格数据接口（前端传入） */
export interface TableExportData {
  /** 表格二维数据（行 × 列） */
  data: (string | number | null)[][]
  /** 公式映射（单元格地址 -> 公式字符串，如 { "B3": "=B2" }） */
  formulas: Record<string, string>
}

/** 将单元格地址（如 "B3"）转换为列号+行号（1-based） */
function parseCellAddress(addr: string): { col: number; row: number } {
  const m = addr.match(/^([A-Z]+)(\d+)$/)
  if (!m) return { col: -1, row: -1 }
  let col = 0
  for (let i = 0; i < m[1].length; i++) {
    col = col * 26 + (m[1].charCodeAt(i) - 64)
  }
  return { col, row: parseInt(m[2]) }
}

/** 从公式字符串中去掉前导 = */
function stripFormulaPrefix(formula: string): string {
  return formula.startsWith('=') ? formula.substring(1) : formula
}

/** base64 data URI 解析结果 */
interface ParsedImageData {
  buffer: Buffer
  extension: 'jpeg' | 'png' | 'gif'
}

/** 将 base64 data URI 解析为 Buffer 和扩展名 */
function parseBase64Image(dataUri: string): ParsedImageData | null {
  // 匹配 data:image/jpeg;base64,... 或 data:image/png;base64,... 格式
  const m = dataUri.match(/^data:image\/(jpeg|jpg|png|gif);base64,(.+)$/i)
  if (!m) return null
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : (m[1].toLowerCase() as 'jpeg' | 'png' | 'gif')
  const buffer = Buffer.from(m[2], 'base64')
  return { buffer, extension: ext }
}

/**
 * 从图片 Buffer 中读取原始尺寸（宽 × 高，像素）
 * 支持 PNG / JPEG / GIF，解析失败时返回 null
 */
export function getImageDimensions(
  buffer: Buffer,
  extension: 'jpeg' | 'png' | 'gif',
): { width: number; height: number } | null {
  try {
    if (extension === 'png') {
      // PNG: IHDR 块中，宽度在偏移 16，高度在偏移 20（大端序，各 4 字节）
      if (buffer.length < 24) return null
      const width = buffer.readUInt32BE(16)
      const height = buffer.readUInt32BE(20)
      if (width === 0 || height === 0) return null
      return { width, height }
    }
    if (extension === 'gif') {
      // GIF: 宽度在偏移 6-7，高度在偏移 8-9（小端序，各 2 字节）
      if (buffer.length < 10) return null
      const width = buffer.readUInt16LE(6)
      const height = buffer.readUInt16LE(8)
      if (width === 0 || height === 0) return null
      return { width, height }
    }
    if (extension === 'jpeg') {
      // JPEG: 遍历标记段，找到 SOF（Start of Frame）标记获取尺寸
      let offset = 2 // 跳过 SOI 标记 (0xFF 0xD8)
      while (offset < buffer.length - 1) {
        if (buffer[offset] !== 0xff) return null
        const marker = buffer[offset + 1]
        // SOF 标记范围: 0xC0-0xC3, 0xC5-0xC7, 0xC9-0xCB, 0xCD-0xCF
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          // SOF 段格式: 2字节长度 | 1字节精度 | 2字节高度 | 2字节宽度
          if (offset + 9 > buffer.length) return null
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7),
          }
        }
        // 其他标记段: 读取段长度跳过（SOS 段后为扫描数据，无需继续）
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2
          continue
        }
        if (offset + 3 > buffer.length) return null
        const segLen = buffer.readUInt16BE(offset + 2)
        offset += 2 + segLen
      }
      return null
    }
  } catch {
    return null
  }
  return null
}

/**
 * 按原始宽高比等比缩放到最大显示范围内（避免拉伸失真）
 *
 * @param dims 原始尺寸，为 null 时回退到默认最大尺寸
 * @param maxWidth 最大显示宽度（像素）
 * @param maxHeight 最大显示高度（像素）
 * @returns 等比缩放后的 { width, height }
 */
export function scaleProportionally(
  dims: { width: number; height: number } | null,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return { width: maxWidth, height: maxHeight }
  }
  const ratio = dims.width / dims.height
  // 以最大宽度和最大高度为约束，取较小的缩放比例确保完整放入
  if (maxWidth / ratio <= maxHeight) {
    return { width: maxWidth, height: Math.round(maxWidth / ratio) }
  }
  return { width: Math.round(maxHeight * ratio), height: maxHeight }
}

/**
 * 将像素 x 偏移转换为 fractional col 值（用于图片精确定位）
 *
 * Excel 列宽转像素近似公式：px ≈ width * 7 + 5（默认宽度约 8.43 → 64px）
 * 图片浮动于单元格之上，通过 fractional col 可在任意像素位置放置图片，
 * 无需修改列宽即可实现多图水平排列。
 *
 * @param sheet 工作表
 * @param pixelX 目标像素 x 偏移（从 A 列左边缘起算）
 * @returns fractional col 值（0-based，如 1.5 表示 B 列正中间）
 */
function pixelToFractionalCol(sheet: ExcelJS.Worksheet, pixelX: number): number {
  if (pixelX <= 0) return 0
  let acc = 0
  let col = 1
  while (col <= 200) {
    const w = sheet.getColumn(col).width
    const colPx = w ? Math.round(w * 7 + 5) : 64
    if (acc + colPx >= pixelX) {
      return (col - 1) + (pixelX - acc) / colPx
    }
    acc += colPx
    col++
  }
  return col - 1
}

/**
 * 生成单订单 + 在线表格 Excel（含公式保留）
 *
 * @param order 订单数据
 * @param tableData 在线表格数据和公式
 * @returns ExcelJS Workbook
 */
export async function generateOrderWithTableExcel(
  order: Quote,
  tableData: TableExportData,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '订单管理系统'
  workbook.created = new Date()

  // ---- Sheet 1: 订单信息（4列布局：标签-值-标签-值，紧凑展示） ----
  const infoSheet = workbook.addWorksheet('订单信息', {
    pageSetup: {
      orientation: 'portrait',
      fitToWidth: 1,
      fitToHeight: 0,
    },
  })
  infoSheet.getColumn(1).width = 14
  infoSheet.getColumn(2).width = 24
  infoSheet.getColumn(3).width = 14
  infoSheet.getColumn(4).width = 24

  // 标题
  const title = infoSheet.getCell('A1')
  title.value = '订单详细信息'
  title.font = { bold: true, size: 14, color: { argb: 'FF4472C4' } }
  infoSheet.mergeCells('A1:D1')

  // 订单字段（分组展示）
  const fieldGroups: { title: string; fields: [string, string][] }[] = [
    {
      title: '基本信息',
      fields: [
        ['订单号', order.quote_number],
        ['客户名称', order.customerName],
        ['收货地址', order.shippingAddress],
        ['订单状态', getStatusLabel(order.status as number)],
        ['款式', getStyleLabel(order.productStyle)],
        ['产品规格', order.productSpec],
      ],
    },
    {
      title: '材料工艺',
      fields: [
        ['面料材质', order.fabricMaterial],
        ['工艺', order.process],
        ['手提材质', order.handleMaterial],
        ['手提规格', order.handleSpec],
        ['数量', order.quantity],
        ['箱规', order.boxSpec],
      ],
    },
    {
      title: '价格信息',
      fields: [
        ['成本价', String(order.costPrice ?? 0)],
        ['含税价', String(order.priceWithTax ?? 0)],
        ['单个卖价(不含税)', String(order.sellPriceNoTax ?? 0)],
        ['单个卖价(含税)', String(order.sellPriceWithTax ?? 0)],
        ['单个利润(不含税)', String(round2(round2(order.sellPriceNoTax ?? 0) - round2(order.costPrice ?? 0)))],
        ['单个利润(含税)', String(round2(round2(order.sellPriceWithTax ?? 0) - round2(order.priceWithTax ?? 0)))],
        ['销售总额(不含税)', String(round2(round2(order.sellPriceNoTax ?? 0) * parseQuantity(order.quantity)))],
        ['销售总额(含税)', String(round2(round2(order.sellPriceWithTax ?? 0) * parseQuantity(order.quantity)))],
        ['利润总额(不含税)', String(round2(round2(round2(order.sellPriceNoTax ?? 0) - round2(order.costPrice ?? 0)) * parseQuantity(order.quantity)))],
        ['利润总额(含税)', String(round2(round2(round2(order.sellPriceWithTax ?? 0) - round2(order.priceWithTax ?? 0)) * parseQuantity(order.quantity)))],
        ['单价', order.unitPrice],
        ['打样费', order.sampleFee],
        ['打样天数', order.sampleDays],
        ['大货天数', order.massDays],
      ],
    },
    {
      title: '时间节点',
      fields: [
        ['做货开始日期', order.productionTimeStart],
        ['做货结束日期', order.productionTimeEnd],
        ['报价时间', order.quoteTime],
        ['打样时间', order.sampleTime],
        ['做货开始时间', order.productionStartTime],
        ['发货时间', order.shippingTime],
        ['收款时间', order.paymentTime],
        ['结束时间', order.endTime],
      ],
    },
    {
      title: '其他',
      fields: [
        ['备注', order.remark],
        ['创建时间', order.created_at],
        ['更新时间', order.updated_at],
      ],
    },
  ]

  let row = 3
  for (const group of fieldGroups) {
    // 分组标题（合并 A:D）
    const gCell = infoSheet.getCell(`A${row}`)
    gCell.value = group.title
    gCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    gCell.fill = HEADER_FILL
    gCell.alignment = { horizontal: 'left', vertical: 'middle' }
    infoSheet.mergeCells(`A${row}:D${row}`)
    // 填充合并区域背景色
    for (let c = 1; c <= 4; c++) {
      infoSheet.getCell(row, c).fill = HEADER_FILL
    }
    row++
    // 字段以 2 列对布局展示（A-B 为第一对，C-D 为第二对）
    for (let i = 0; i < group.fields.length; i += 2) {
      const [label1, value1] = group.fields[i]
      const pair2 = group.fields[i + 1]

      // 左侧：标签 + 值
      const lCell1 = infoSheet.getCell(`A${row}`)
      lCell1.value = label1
      lCell1.font = { bold: true }
      lCell1.alignment = { horizontal: 'left', vertical: 'middle' }
      const vCell1 = infoSheet.getCell(`B${row}`)
      vCell1.value = value1 || ''
      vCell1.alignment = { horizontal: 'left', vertical: 'middle' }

      // 右侧：标签 + 值（若存在）
      if (pair2) {
        const [label2, value2] = pair2
        const lCell2 = infoSheet.getCell(`C${row}`)
        lCell2.value = label2
        lCell2.font = { bold: true }
        lCell2.alignment = { horizontal: 'left', vertical: 'middle' }
        const vCell2 = infoSheet.getCell(`D${row}`)
        vCell2.value = value2 || ''
        vCell2.alignment = { horizontal: 'left', vertical: 'middle' }
      }
      row++
    }
    row++ // 分组间空行
  }

  // ---- 产品图片（嵌入订单信息工作表底部） ----
  const images = Array.isArray(order.images) ? order.images : []
  const validImages = images
    .map((uri) => parseBase64Image(uri))
    .filter((img): img is ParsedImageData => img !== null)

  if (validImages.length > 0) {
    // 分组标题（合并 A:D，与其他分组样式一致）
    const imgGroupCell = infoSheet.getCell(`A${row}`)
    imgGroupCell.value = `产品图片（共 ${validImages.length} 张）`
    imgGroupCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    imgGroupCell.fill = HEADER_FILL
    imgGroupCell.alignment = { horizontal: 'left', vertical: 'middle' }
    infoSheet.mergeCells(`A${row}:D${row}`)
    for (let c = 1; c <= 4; c++) {
      infoSheet.getCell(row, c).fill = HEADER_FILL
    }
    row++

    // 所有图片放在同一行，水平排列，不显示图片名称
    // 按原始宽高比等比缩放，避免拉伸失真
    const MAX_IMG_WIDTH = 180
    const MAX_IMG_HEIGHT = 180
    const IMG_SLOT_WIDTH = 190 // 每张图片槽位宽度（含间距，像素）
    const imgRow = row

    let maxDisplayHeight = 0
    validImages.forEach((img, idx) => {
      // 读取原始尺寸并等比缩放（保持宽高比，不拉伸）
      const dims = getImageDimensions(img.buffer, img.extension)
      const { width: displayWidth, height: displayHeight } = scaleProportionally(
        dims,
        MAX_IMG_WIDTH,
        MAX_IMG_HEIGHT,
      )
      maxDisplayHeight = Math.max(maxDisplayHeight, displayHeight)

      // 计算第 idx 张图片的像素 x 偏移，转为 fractional col 精确定位
      const targetPixelX = idx * IMG_SLOT_WIDTH
      const fractionalCol = pixelToFractionalCol(infoSheet, targetPixelX)

      try {
        const imageId = workbook.addImage({
          buffer: img.buffer as unknown as ExcelJS.Buffer,
          extension: img.extension,
        })
        infoSheet.addImage(imageId, {
          tl: { col: fractionalCol, row: imgRow - 1 },
          ext: { width: displayWidth, height: displayHeight },
        })
      } catch (e) {
        const errCell = infoSheet.getCell(imgRow, idx + 1)
        errCell.value = `[图片无法嵌入: ${(e as Error).message}]`
        errCell.font = { color: { argb: 'FFFF0000' } }
      }
    })

    // 行高 = 最高图片高度(pixel) → point 转换（×0.75）+ 少量边距
    infoSheet.getRow(imgRow).height = Math.max(maxDisplayHeight * 0.75 + 5, 30)
    row++
  }

  // ---- Sheet 2: 在线表格（含公式） ----
  const tableSheet = workbook.addWorksheet('在线表格', {
    views: [{ state: 'frozen', ySplit: 0 }],
  })

  const { data, formulas } = tableData

  // 写入静态数据
  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const cell = tableSheet.getCell(r + 1, c + 1)
      const val = data[r][c]
      if (val !== null && val !== undefined && val !== '') {
        cell.value = val
      }
    }
  }

  // 覆盖写入公式（保留 Excel 公式，打开时自动重算）
  for (const [addr, formula] of Object.entries(formulas)) {
    const { col, row: r } = parseCellAddress(addr)
    if (col < 1 || r < 1) continue
    const cell = tableSheet.getCell(r, col)
    const formulaStr = stripFormulaPrefix(formula)
    // 尝试获取已有值作为 result（ExcelJS 需要公式结果）
    const existingVal = data[r - 1]?.[col - 1]
    cell.value = {
      formula: formulaStr,
      result: typeof existingVal === 'number' ? existingVal : undefined,
    }
  }

  // 表格列宽设置
  for (let c = 0; c < (data[0]?.length ?? 0); c++) {
    tableSheet.getColumn(c + 1).width = 14
  }

  // 表格样式：第一列标签加粗
  for (let r = 0; r < data.length; r++) {
    const labelCell = tableSheet.getCell(r + 1, 1)
    if (typeof labelCell.value === 'string' && labelCell.value.trim() !== '') {
      labelCell.font = { bold: true }
    }
  }

  return workbook
}

// ============================ 通用工具 ============================

/** 细边框样式 */
function thinBorder(): Partial<ExcelJS.Borders> {
  const b: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD0D0D0' } }
  return { top: b, left: b, bottom: b, right: b }
}

/** 将 Workbook 写入 Buffer */
export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer as ArrayBuffer)
}
