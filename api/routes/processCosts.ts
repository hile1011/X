import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'

export const processCostsRouter = express.Router()

processCostsRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.processCosts.getAll()
  res.json(data)
}))

processCostsRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.processCosts.getById(id)
  if (!data) {
    return res.status(404).json({ error: '工艺成本不存在' })
  }
  res.json(data)
}))

processCostsRouter.post('/', asyncHandler(async (req, res) => {
  const data = await db.processCosts.create(req.body)
  res.json(data)
}))

processCostsRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.processCosts.update(id, req.body)
  if (!data) {
    return res.status(404).json({ error: '工艺成本不存在' })
  }
  res.json(data)
}))

processCostsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const success = await db.processCosts.delete(id)
  if (!success) {
    return res.status(404).json({ error: '工艺成本不存在' })
  }
  res.json({ message: '工艺成本已删除' })
}))
