import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'

export const quotesRouter = express.Router()

quotesRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.quotes.getAll()
  res.json(data)
}))

quotesRouter.get('/:id/delete-check', asyncHandler(createDeleteCheckHandler('quote')))

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

quotesRouter.delete('/:id', asyncHandler(createProtectedDeleteHandler('quote', db.quotes.delete)))

// 复制订单接口（在服务器端直接复制，避免传输大字段）
quotesRouter.post('/:id/copy', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.copy(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
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
