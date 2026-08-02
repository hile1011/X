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
import {
  generateOrdersExcel,
  generateOrderWithTableExcel,
  generateFileName,
  workbookToBuffer,
  type TableExportData,
} from '../services/excelExport.js'

export const exportRouter = express.Router()

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
      const all = db.quotes.getAll()
      const idSet = new Set(orderIds)
      orders = all.filter((q) => idSet.has(q.id))
    } else {
      // 导出全部
      orders = db.quotes.getAll()
    }

    if (orders.length === 0) {
      return res.status(400).json({ error: '没有可导出的订单' })
    }

    try {
      const workbook = await generateOrdersExcel(orders)
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
 *   tableData: { data: (string|number|null)[][], formulas: Record<string, string> }
 * }
 * Response: Excel 文件下载（含在线表格 + 公式）
 */
exportRouter.post(
  '/order-with-table',
  asyncHandler(async (req, res) => {
    const { orderId, tableData }: { orderId: string; tableData: TableExportData } = req.body || {}

    if (!orderId) {
      return res.status(400).json({ error: '缺少订单 ID' })
    }

    const order = db.quotes.getById(orderId)
    if (!order) {
      return res.status(404).json({ error: '订单不存在' })
    }

    if (!tableData || !Array.isArray(tableData.data)) {
      return res.status(400).json({ error: '缺少表格数据' })
    }

    try {
      const workbook = await generateOrderWithTableExcel(order, {
        data: tableData.data,
        formulas: tableData.formulas || {},
      })
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
