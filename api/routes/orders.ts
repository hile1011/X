import express from 'express'
import { db } from '../db.js'
import type { Order } from '../types/index.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'

export const ordersRouter = express.Router()

ordersRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.orders.getAll()
  res.json(data)
}))

ordersRouter.get('/:id/delete-check', asyncHandler(createDeleteCheckHandler('order')))

ordersRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.orders.getById(id)
  if (!data) {
    return res.status(404).json({ error: '订单不存在' })
  }
  res.json(data)
}))

ordersRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { status, remarks } = req.body as { status?: Order['status']; remarks?: string }
  // 过滤 undefined 值
  const updateData: Record<string, any> = {}
  if (status !== undefined) updateData.status = status
  if (remarks !== undefined) updateData.remarks = remarks

  const data = await db.orders.update(id, updateData)
  if (!data) {
    return res.status(404).json({ error: '订单不存在' })
  }
  res.json(data)
}))

ordersRouter.delete('/:id', asyncHandler(createProtectedDeleteHandler('order', db.orders.delete)))
