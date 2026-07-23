import express from 'express'
import { db } from '../db'
import type { Order } from '../types'

export const ordersRouter = express.Router()

ordersRouter.get('/', async (_req, res) => {
  const data = await db.orders.getAll()
  res.json(data)
})

ordersRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const data = await db.orders.getById(id)
  if (!data) {
    return res.status(404).json({ error: '订单不存在' })
  }
  res.json(data)
})

ordersRouter.put('/:id', async (req, res) => {
  const { id } = req.params
  const { status, remarks } = req.body as { status?: Order['status']; remarks?: string }

  const data = await db.orders.update(id, { status, remarks })
  if (!data) {
    return res.status(404).json({ error: '订单不存在' })
  }
  res.json(data)
})

ordersRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  const success = await db.orders.delete(id)
  if (!success) {
    return res.status(404).json({ error: '订单不存在' })
  }
  res.json({ message: '订单已删除' })
})
