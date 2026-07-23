import express from 'express'
import { db } from '../db'

export const processCostsRouter = express.Router()

processCostsRouter.get('/', async (_req, res) => {
  const data = await db.processCosts.getAll()
  res.json(data)
})

processCostsRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const data = await db.processCosts.getById(id)
  if (!data) {
    return res.status(404).json({ error: '工艺成本不存在' })
  }
  res.json(data)
})

processCostsRouter.post('/', async (req, res) => {
  const data = await db.processCosts.create(req.body)
  res.json(data)
})

processCostsRouter.put('/:id', async (req, res) => {
  const { id } = req.params
  const data = await db.processCosts.update(id, req.body)
  if (!data) {
    return res.status(404).json({ error: '工艺成本不存在' })
  }
  res.json(data)
})

processCostsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  const success = await db.processCosts.delete(id)
  if (!success) {
    return res.status(404).json({ error: '工艺成本不存在' })
  }
  res.json({ message: '工艺成本已删除' })
})