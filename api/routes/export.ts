/**
 * 订单导出路由
 *
 * 提供两个导出端点：
 * 1. POST /api/export/orders        — 导出订单列表（Excel，含汇总统计）
 * 2. POST /api/export/order-with-table — 导出单订单 + 在线表格（含公式）
 *
 * 请求体均为 JSON，响应为 Excel 文件流（application/vnd.openxmlformats-officedocument.spreadsheetml.sheet）。
 */
import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { requirePermission } from '../middleware/auth.js'
import { createRateLimiter } from '../middleware/rateLimit.js'
import {
  generateOrdersExcel,
  generateOrderWithTableExcel,
  generateFileName,
  workbookToBuffer,
  type TableExportData,
} from '../services/excelExport.js'
import {
  generatePaymentReceiptExcel,
  generatePaymentReceiptZip,
  generateThumbnailBuffer,
  groupOrdersByCustomer,
  decidePaymentFileLabel,
  buildPaymentFileName,
  workbookToBuffer as paymentWorkbookToBuffer,
  PAYMENT_EXPORT_MAX_ROWS,
} from '../services/paymentExport.js'

export const exportRouter = express.Router()

// 收款单导出限流器：同一用户 5 分钟内最多 3 次
const paymentExportRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 3,
})

/** 有界并发执行（避免一次性发起过多 DB 查询） */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * 构建支持中文的 Content-Disposition 头
 * 同时提供 ASCII fallback（filename）和 UTF-8 编码（filename*）
 */
function buildContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename)
  // ASCII fallback：用时间戳避免乱码
  const fallback = `payment_receipt_${Date.now()}`
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

/**
 * 构建款式标签解析器：从产品管理模块获取所有产品的 code→name 和 id→name 映射，
 * 用于 Excel 导出时动态解析款式标签（产品改名后导出使用新名称）。
 * value 可能是款式 code（1-6）或产品 id（无 code 的产品），故同时按 code 和 id 建映射。
 * 返回 null 时由 excelExport 内部硬编码 getStyleLabel 兜底。
 */
async function buildStyleLabelResolver(): Promise<((code: string) => string) | null> {
  try {
    const products = await db.products.getAll()
    if (products.length === 0) return null
    const styleMap = new Map<string, string>()
    for (const p of products) {
      if (p.code && p.code.trim() !== '') styleMap.set(p.code, p.name)
      styleMap.set(p.id, p.name)
    }
    return (code: string) => styleMap.get(code) || ''
  } catch {
    return null
  }
}

/**
 * POST /api/export/orders
 * Body: { orderIds: string[] }  — 要导出的订单 ID 列表
 *  - 传空数组时导出全部订单
 * Response: Excel 文件下载
 */
exportRouter.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const { orderIds }: { orderIds?: string[] } = req.body || {}

    let orders
    if (orderIds && orderIds.length > 0) {
      // 按指定 ID 获取，保持传入顺序
      const all = await db.quotes.getAll()
      const idSet = new Set(orderIds)
      orders = all.filter((q) => idSet.has(q.id))
    } else {
      // 导出全部
      orders = await db.quotes.getAll()
    }

    if (orders.length === 0) {
      return res.status(400).json({ error: '没有可导出的订单' })
    }

    try {
      const styleLabelResolver = (await buildStyleLabelResolver()) || undefined
      const workbook = await generateOrdersExcel(orders, styleLabelResolver)
      const buffer = await workbookToBuffer(workbook)
      const filename = generateFileName('OrderExport')

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.setHeader('Content-Length', buffer.byteLength)
      res.send(Buffer.from(buffer))
    } catch (error) {
      console.error('[Export] 订单列表导出失败:', error)
      res.status(500).json({ error: '导出失败', details: (error as Error).message })
    }
  }),
)

/**
 * POST /api/export/order-with-table
 * Body: {
 *   orderId: string,
 *   tableData: { data: (string|number|null)[][], formulas: Record<string, string>,
 *                columnWidths?: number[], rowHeights?: number[] }
 * }
 * Response: Excel 文件下载（含在线表格 + 公式；columnWidths/rowHeights 为 px，按页面所见导出布局）
 */
exportRouter.post(
  '/order-with-table',
  asyncHandler(async (req, res) => {
    const { orderId, tableData }: { orderId: string; tableData: TableExportData } = req.body || {}

    if (!orderId) {
      return res.status(400).json({ error: '缺少订单 ID' })
    }

    const order = await db.quotes.getById(orderId)
    if (!order) {
      return res.status(404).json({ error: '订单不存在' })
    }

    if (!tableData || !Array.isArray(tableData.data)) {
      return res.status(400).json({ error: '缺少表格数据' })
    }

    try {
      const styleLabelResolver = (await buildStyleLabelResolver()) || undefined
      const workbook = await generateOrderWithTableExcel(order, {
        data: tableData.data,
        formulas: tableData.formulas || {},
        // v34 布局适配：前端传入各列/行实际尺寸（px）时按页面所见导出
        columnWidths: Array.isArray(tableData.columnWidths) ? tableData.columnWidths : undefined,
        rowHeights: Array.isArray(tableData.rowHeights) ? tableData.rowHeights : undefined,
      }, styleLabelResolver)
      const buffer = await workbookToBuffer(workbook)
      const filename = generateFileName(`Order_${order.customerName}`)

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
      res.setHeader('Content-Length', buffer.byteLength)
      res.send(Buffer.from(buffer))
    } catch (error) {
      console.error('[Export] 单订单导出失败:', error)
      res.status(500).json({ error: '导出失败', details: (error as Error).message })
    }
  }),
)

/**
 * POST /api/export/payment-receipts
 * 导出收款单（仅"已发货未收款" status=4 订单）
 *
 * Body: { orderIds: string[], customerFilter?: string }
 *   - orderIds: 前端按当前筛选条件收集的订单 ID（不限分页）
 *   - customerFilter: 当前客户筛选值（空字符串表示未筛选客户）
 *
 * 服务端权威校验：
 *   - 重新从 DB 取订单，过滤 status !== 4 的记录（防止前端传错）
 *   - 单次导出上限 PAYMENT_EXPORT_MAX_ROWS（1000），超出返回 400
 *
 * 响应：
 *   - 单客户 → Excel 文件流
 *   - 多客户 → ZIP 文件流（每个客户一个 Excel）
 *
 * 权限：quotes:export-payment
 * 限流：同一用户 5 分钟内最多 3 次
 */
exportRouter.post(
  '/payment-receipts',
  requirePermission('quotes:export-payment'),
  paymentExportRateLimiter,
  asyncHandler(async (req, res) => {
    const { orderIds, customerFilter }: { orderIds?: string[]; customerFilter?: string } = req.body || {}

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: '当前筛选条件下无符合“已发货未收款”状态的订单数据' })
    }

    // 数据量上限校验（前端传入的 ID 数）
    if (orderIds.length > PAYMENT_EXPORT_MAX_ROWS) {
      return res.status(400).json({
        error: `单次导出数据量不超过 ${PAYMENT_EXPORT_MAX_ROWS} 条，当前为 ${orderIds.length} 条，请缩小筛选范围或分批导出`,
        code: 'TOO_MANY_ROWS',
        count: orderIds.length,
        max: PAYMENT_EXPORT_MAX_ROWS,
      })
    }

    // 取订单并服务端再过滤：仅保留 status === 4
    const all = await db.quotes.getAll()
    const idSet = new Set(orderIds)
    const orders = all.filter((q) => idSet.has(q.id) && q.status === 4)

    if (orders.length === 0) {
      return res.status(400).json({ error: '当前筛选条件下无符合“已发货未收款”状态的订单数据', code: 'NO_DATA' })
    }

    try {
      // 并发获取首图并生成 80×80 缩略图（有界并发，避免压垮 DB）
      const thumbnails = new Map<string, Buffer | null>()
      const firstImages = await mapWithConcurrency(orders, 10, async (o) => {
        const img = await db.quotes.getFirstImage(o.id)
        return { id: o.id, img }
      })
      for (const { id, img } of firstImages) {
        thumbnails.set(id, img ? await generateThumbnailBuffer(img) : null)
      }

      // 按客户分组
      const customerGroups = groupOrdersByCustomer(orders)
      const customerFilterSet = !!(customerFilter && customerFilter.trim() !== '')
      const { label, ext } = decidePaymentFileLabel(customerGroups, customerFilterSet)
      const filename = buildPaymentFileName(label, ext)

      let buffer: Buffer
      let contentType: string
      if (ext === 'zip') {
        buffer = await generatePaymentReceiptZip(customerGroups, thumbnails)
        contentType = 'application/zip'
      } else {
        // 单客户：直接生成 Excel
        const [customerName, groupOrders] = [...customerGroups.entries()][0]
        const workbook = await generatePaymentReceiptExcel(groupOrders, thumbnails, customerName)
        buffer = await paymentWorkbookToBuffer(workbook)
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }

      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', buildContentDisposition(filename))
      res.setHeader('Content-Length', buffer.byteLength)
      // 附加元信息供前端读取（文件名 + 类型 + 订单数）
      res.setHeader('X-Export-Filename', encodeURIComponent(filename))
      res.setHeader('X-Export-Count', String(orders.length))
      res.send(Buffer.from(buffer))
    } catch (error) {
      console.error('[Export] 收款单导出失败:', error)
      res.status(500).json({ error: '服务器处理异常，请联系系统管理员', details: (error as Error).message })
    }
  }),
)
