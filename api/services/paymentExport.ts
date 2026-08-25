/**
 * 收款单 Excel 导出服务
 *
 * 用于导出"已发货未收款"(status=4) 订单的收款单：
 * 1. 单客户 → 单个 Excel 文件
 * 2. 多客户 → 每个客户一个 Excel，打包成 ZIP（archiver）
 *
 * 固定列结构：客户名称、数量、产品图片缩略图(80×80)、大货日期(从-到)、工艺、
 *             单个卖价(不含税)、单个卖价(含税)、销售总额(不含税)、销售总额(含税)、
 *             应收打样费、实收打样费、抵扣大货(是/否)、待收总额
 * 汇总行：数量、销售总额(不含税)、销售总额(含税)、待收总额
 *
 * 设计要点：
 * - 金额以 round2（Math.round(n×100)/100）为基础，2 位小数，确保汇总 = 明细之和
 * - 产品图片复用 sharp 生成 80×80 JPEG 缩略图，以 Buffer 嵌入单元格（不依赖网络链接）
 * - 日期统一 YYYY-MM-DD，区间用 " - " 连接，空值显示 "-"
 * - 汇总行：加粗 + #f5f5f5 背景 + 行高 +10% + 顶部粗分隔线 + 首列"合计"
 */
import ExcelJS from 'exceljs'
import sharp from 'sharp'
import { ZipArchive } from 'archiver'
import type { Quote } from '../types/index.js'

// ============================ 常量 ============================

/** 收款单导出固定列定义（顺序即列顺序） */
export interface PaymentColumn {
  header: string
  key: string
  width: number
  type: 'text' | 'number' | 'currency' | 'image' | 'dateRange'
}

export const PAYMENT_COLUMNS: PaymentColumn[] = [
  { header: '客户名称', key: 'customerName', width: 18, type: 'text' },
  { header: '数量', key: 'quantity', width: 10, type: 'number' },
  { header: '产品图片', key: 'thumbnail', width: 12, type: 'image' },
  { header: '大货日期(从-到)', key: 'productionDateRange', width: 26, type: 'dateRange' },
  { header: '工艺', key: 'process', width: 24, type: 'text' },
  { header: '单个卖价(不含税)', key: 'sellPriceNoTax', width: 16, type: 'currency' },
  { header: '单个卖价(含税)', key: 'sellPriceWithTax', width: 16, type: 'currency' },
  { header: '销售总额(不含税)', key: 'sellTotalNoTax', width: 18, type: 'currency' },
  { header: '销售总额(含税)', key: 'sellTotalWithTax', width: 18, type: 'currency' },
  { header: '应收打样费', key: 'receivableSampleFee', width: 14, type: 'currency' },
  { header: '实收打样费', key: 'actualSampleFee', width: 14, type: 'currency' },
  { header: '抵扣大货', key: 'sampleFeeDeduct', width: 10, type: 'text' },
  { header: '待收总额', key: 'pendingAmount', width: 14, type: 'currency' },
]

/** 单次导出数据量上限（超过需缩小筛选范围或分批） */
export const PAYMENT_EXPORT_MAX_ROWS = 1000

const CURRENCY_FMT = '¥#,##0.00'
const SUMMARY_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF5F5F5' },
}
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
const THUMBNAIL_SIZE = 80
const DATA_ROW_HEIGHT_PT = 60 // 80px ≈ 60pt

// ============================ 辅助函数 ============================

/** 保留 2 位小数（四舍五入） */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 解析数量字符串为数字 */
export function parseQuantity(qty: string | number | undefined | null): number {
  const n = typeof qty === 'number' ? qty : parseFloat(String(qty ?? ''))
  return isNaN(n) ? 0 : n
}

/** 将 ISO/字符串日期格式化为 YYYY-MM-DD；空值返回 '-' */
export function formatPaymentDate(dateStr: string | undefined | null): string {
  if (!dateStr || String(dateStr).trim() === '') return '-'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '-'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 大货日期区间："YYYY-MM-DD - YYYY-MM-DD"，两端均空时返回 "-" */
export function formatPaymentDateRange(start: string, end: string): string {
  const s = formatPaymentDate(start)
  const e = formatPaymentDate(end)
  if (s === '-' && e === '-') return '-'
  return `${s} - ${e}`
}

/** 生成带时间戳的文件名（不含扩展名部分由 ext 指定） */
export function buildPaymentFileName(label: string, ext: 'xlsx' | 'zip'): string {
  const ts = new Date().toISOString().replace(/[-T:]/g, '').substring(0, 14)
  return `${label}_收款单_${ts}.${ext}`
}

/** Excel 工作表名称清洗：最长 31 字符，去除非法字符 : \ / ? * [ ] */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, '_').trim()
  return cleaned.length > 31 ? cleaned.substring(0, 31) : cleaned
}

/**
 * base64 data URI → { buffer, extension }
 * 仅支持 jpeg/png/gif；非 data URI 但为纯 base64 时按 jpeg 解析（由调用方保证）
 */
function parseBase64Image(dataUri: string): { buffer: Buffer; extension: 'jpeg' | 'png' | 'gif' } | null {
  const m = dataUri.match(/^data:image\/(jpeg|jpg|png|gif);base64,(.+)$/i)
  if (!m) return null
  const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : (m[1].toLowerCase() as 'jpeg' | 'png' | 'gif')
  return { buffer: Buffer.from(m[2], 'base64'), extension: ext }
}

/**
 * 将订单首图（base64 data URI）生成 80×80 JPEG 缩略图 Buffer
 * 与 /api/quotes/:id/thumbnail 端点口径一致（sharp resize cover）
 * @returns 80×80 JPEG Buffer；无图或解析失败返回 null
 */
export async function generateThumbnailBuffer(firstImage: string): Promise<Buffer | null> {
  const parsed = parseBase64Image(firstImage)
  if (!parsed) return null
  try {
    return await sharp(parsed.buffer)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer()
  } catch {
    return null
  }
}

// ============================ 汇总计算 ============================

export interface PaymentSummary {
  orderCount: number
  totalQuantity: number
  /** 销售总额(不含税) = Σ round2(sellPriceNoTax) × 数量 */
  totalSellNoTax: number
  /** 销售总额(含税) = Σ round2(sellPriceWithTax) × 数量 */
  totalSellWithTax: number
  /** 待收总额 = Σ pendingAmount */
  totalPendingAmount: number
}

/**
 * 计算收款单汇总（前后端通用，后端为权威校验）
 * 以 round2 的单价为计算基础，确保汇总 = 各明细行之和
 */
export function calculatePaymentSummary(orders: Quote[]): PaymentSummary {
  let totalQuantity = 0
  let totalSellNoTax = 0
  let totalSellWithTax = 0
  let totalPendingAmount = 0
  for (const o of orders) {
    const qty = parseQuantity(o.quantity)
    const sellNoTax = round2(typeof o.sellPriceNoTax === 'number' ? o.sellPriceNoTax : 0)
    const sellWithTax = round2(typeof o.sellPriceWithTax === 'number' ? o.sellPriceWithTax : 0)
    totalQuantity += qty
    totalSellNoTax += sellNoTax * qty
    totalSellWithTax += sellWithTax * qty
    totalPendingAmount += typeof (o as any).pendingAmount === 'number' ? (o as any).pendingAmount : 0
  }
  return {
    orderCount: orders.length,
    totalQuantity,
    totalSellNoTax: round2(totalSellNoTax),
    totalSellWithTax: round2(totalSellWithTax),
    totalPendingAmount: round2(totalPendingAmount),
  }
}

/** 按客户名称分组（保持首次出现顺序） */
export function groupOrdersByCustomer(orders: Quote[]): Map<string, Quote[]> {
  const groups = new Map<string, Quote[]>()
  for (const o of orders) {
    const name = o.customerName || '(未命名客户)'
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push(o)
  }
  return groups
}

// ============================ 样式工具 ============================

function thinBorder(): Partial<ExcelJS.Borders> {
  const b: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD0D0D0' } }
  return { top: b, left: b, bottom: b, right: b }
}

/** 汇总行顶部粗分隔线 */
function summaryTopBorder(): Partial<ExcelJS.Borders> {
  const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFD0D0D0' } }
  const medium: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: 'FF4472C4' } }
  return { top: medium, left: thin, bottom: thin, right: thin }
}

// ============================ Excel 生成 ============================

/**
 * 生成单个客户的收款单 Excel（单工作表）
 *
 * @param orders 同一客户的订单列表
 * @param thumbnails 订单 id → 80×80 JPEG Buffer（无图为 null 或缺省）
 * @param customerName 客户名称（用于标题）
 * @returns ExcelJS Workbook
 */
export async function generatePaymentReceiptExcel(
  orders: Quote[],
  thumbnails: Map<string, Buffer | null>,
  customerName: string,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '订单管理系统'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(sanitizeSheetName(customerName), {
    views: [{ state: 'frozen', ySplit: 3 }], // 冻结标题+表头（前 3 行）
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 18 },
  })

  // 列宽
  PAYMENT_COLUMNS.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width
  })

  // === 第 1 行：标题（合并所有列） ===
  const colCount = PAYMENT_COLUMNS.length
  const titleRow = sheet.getRow(1)
  titleRow.height = 26
  sheet.mergeCells(1, 1, 1, colCount)
  const titleCell = titleRow.getCell(1)
  const exportTs = new Date().toLocaleString('zh-CN', { hour12: false })
  titleCell.value = `${customerName} - 收款单（已发货未收款）    导出时间：${exportTs}`
  titleCell.font = { bold: true, size: 13, color: { argb: 'FF4472C4' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }

  // === 第 2 行：表头 ===
  const headerRow = sheet.getRow(2)
  headerRow.height = 22
  PAYMENT_COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1)
    cell.value = col.header
    cell.font = HEADER_FONT
    cell.fill = HEADER_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = thinBorder()
  })

  // === 第 3 行起：数据行 ===
  const summary = calculatePaymentSummary(orders)
  orders.forEach((order, rowIdx) => {
    const excelRowNum = rowIdx + 3
    const row = sheet.getRow(excelRowNum)
    row.height = DATA_ROW_HEIGHT_PT // 为图片预留高度

    const qty = parseQuantity(order.quantity)
    const sellNoTax = round2(typeof order.sellPriceNoTax === 'number' ? order.sellPriceNoTax : 0)
    const sellWithTax = round2(typeof order.sellPriceWithTax === 'number' ? order.sellPriceWithTax : 0)
    const sellTotalNoTax = round2(sellNoTax * qty)
    const sellTotalWithTax = round2(sellWithTax * qty)

    PAYMENT_COLUMNS.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1)
      switch (col.key) {
        case 'customerName':
          cell.value = order.customerName || ''
          cell.alignment = { horizontal: 'left', vertical: 'middle' }
          break
        case 'quantity':
          cell.value = qty
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'thumbnail':
          // 图片占位文字（图片浮于单元格之上）；无图显示"-"
          cell.value = thumbnails.get(order.id) ? '' : '-'
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
          break
        case 'productionDateRange':
          cell.value = formatPaymentDateRange(order.productionTimeStart, order.productionTimeEnd)
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
          break
        case 'process':
          cell.value = order.process || ''
          cell.alignment = { horizontal: 'left', vertical: 'middle' }
          break
        case 'sellPriceNoTax':
          cell.value = sellNoTax
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'sellPriceWithTax':
          cell.value = sellWithTax
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'sellTotalNoTax':
          cell.value = sellTotalNoTax
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'sellTotalWithTax':
          cell.value = sellTotalWithTax
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'receivableSampleFee':
          cell.value = typeof (order as any).receivableSampleFee === 'number' ? (order as any).receivableSampleFee : 0
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'actualSampleFee':
          cell.value = typeof (order as any).actualSampleFee === 'number' ? (order as any).actualSampleFee : 0
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
        case 'sampleFeeDeduct':
          cell.value = (order as any).sampleFeeDeduct ? '是' : '否'
          cell.alignment = { horizontal: 'center', vertical: 'middle' }
          break
        case 'pendingAmount':
          cell.value = typeof (order as any).pendingAmount === 'number' ? (order as any).pendingAmount : 0
          cell.numFmt = CURRENCY_FMT
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          break
      }
      cell.border = thinBorder()
    })

    // 嵌入 80×80 缩略图（水平居中于图片列）
    const thumb = thumbnails.get(order.id)
    if (thumb) {
      try {
        const imageId = workbook.addImage({
          buffer: thumb as unknown as ExcelJS.Buffer,
          extension: 'jpeg',
        })
        const imageColIdx = PAYMENT_COLUMNS.findIndex((c) => c.key === 'thumbnail') // 0-based
        const colWidth = PAYMENT_COLUMNS[imageColIdx].width
        const colPx = Math.round(colWidth * 7 + 5)
        const offsetPx = Math.max(0, (colPx - THUMBNAIL_SIZE) / 2)
        const fractionalCol = imageColIdx + offsetPx / colPx
        sheet.addImage(imageId, {
          tl: { col: fractionalCol, row: excelRowNum - 1 },
          ext: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE },
        })
      } catch {
        // 图片嵌入失败不阻断导出，占位符保持 '-'
      }
    }
  })

  // === 汇总行（数据行下方，顶部粗分隔线） ===
  const summaryRowNum = orders.length + 3
  const summaryRow = sheet.getRow(summaryRowNum)
  summaryRow.height = Math.round(DATA_ROW_HEIGHT_PT * 1.1) // 行高 +10%
  PAYMENT_COLUMNS.forEach((col, colIdx) => {
    const cell = summaryRow.getCell(colIdx + 1)
    cell.fill = SUMMARY_FILL
    cell.font = { bold: true }
    cell.border = summaryTopBorder()
    switch (col.key) {
      case 'customerName':
        cell.value = '合计'
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        break
      case 'quantity':
        cell.value = summary.totalQuantity
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        break
      case 'sellTotalNoTax':
        cell.value = summary.totalSellNoTax
        cell.numFmt = CURRENCY_FMT
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        break
      case 'sellTotalWithTax':
        cell.value = summary.totalSellWithTax
        cell.numFmt = CURRENCY_FMT
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        break
      case 'pendingAmount':
        cell.value = summary.totalPendingAmount
        cell.numFmt = CURRENCY_FMT
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        break
      default:
        cell.value = ''
    }
  })

  return workbook
}

/** Workbook → Buffer */
export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await workbook.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}

// ============================ ZIP 打包 ============================

/**
 * 将多个客户的收款单 Excel 打包成 ZIP
 *
 * @param customerGroups 客户分组（客户名 → 订单列表）
 * @param thumbnails 订单 id → 80×80 JPEG Buffer
 * @returns ZIP Buffer
 */
export function generatePaymentReceiptZip(
  customerGroups: Map<string, Quote[]>,
  thumbnails: Map<string, Buffer | null>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // archiver v8：使用 ZipArchive 类（取代旧版 archiver() 工厂函数）
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const chunks: Buffer[] = []

    archive.on('data', (chunk: Buffer) => chunks.push(chunk))
    archive.on('error', reject)
    archive.on('finish', () => resolve(Buffer.concat(chunks)))

    ;(async () => {
      try {
        for (const [customerName, orders] of customerGroups) {
          const workbook = await generatePaymentReceiptExcel(orders, thumbnails, customerName)
          const buf = await workbookToBuffer(workbook)
          // 文件名：客户名称_收款单_时间戳.xlsx（每个文件独立时间戳，避免重名）
          const fileName = buildPaymentFileName(customerName, 'xlsx')
          // 中文文件名按 utf-8 进入 zip 条目（archiver 默认处理）
          archive.append(buf, { name: fileName })
        }
        await archive.finalize()
      } catch (err) {
        reject(err as Error)
      }
    })()
  })
}

// ============================ 文件名标签决策 ============================

/**
 * 根据客户分组与筛选状态决定下载文件名标签与扩展名
 * - 1 个客户 → 单 Excel，标签 = 该客户名
 * - 多客户 & 无筛选 → ZIP，标签 = "全部客户"
 * - 多客户 & 有筛选（理论上不会发生）→ ZIP，标签 = "多客户"
 */
export function decidePaymentFileLabel(
  customerGroups: Map<string, Quote[]>,
  customerFilterSet: boolean,
): { label: string; ext: 'xlsx' | 'zip' } {
  if (customerGroups.size === 1) {
    const name = [...customerGroups.keys()][0]
    return { label: name, ext: 'xlsx' }
  }
  return {
    label: customerFilterSet ? '多客户' : '全部客户',
    ext: 'zip',
  }
}
