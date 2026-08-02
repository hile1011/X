import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'

export const quotesRouter = express.Router()

quotesRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.quotes.getAll()
  res.json(data)
}))

quotesRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.getById(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

quotesRouter.post('/', asyncHandler(async (req, res) => {
  const data = await db.quotes.create(req.body)
  res.json(data)
}))

quotesRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.update(id, req.body)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

quotesRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const success = await db.quotes.delete(id)
  if (!success) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json({ message: '报价已删除' })
}))

// 状态流转接口：进入下一节点
quotesRouter.post('/:id/next-status', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.nextStatus(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

// 状态流转接口：退回上一节点
quotesRouter.post('/:id/prev-status', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.prevStatus(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

// 状态流转接口：直接结束（报价中和打样中可用）
quotesRouter.post('/:id/end', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.endQuote(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))
