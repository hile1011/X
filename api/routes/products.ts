import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'

export const productsRouter = express.Router()

productsRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.products.getAll()
  res.json(data)
}))

productsRouter.get('/:id/delete-check', asyncHandler(createDeleteCheckHandler('product')))

productsRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.products.getById(id)
  if (!data) {
    return res.status(404).json({ error: '产品不存在' })
  }
  res.json(data)
}))

productsRouter.post('/', asyncHandler(async (req, res) => {
  const { name, sku, code, description, price, category, stock } = req.body as {
    name: string
    sku: string
    code?: string
    description?: string
    price: number
    category?: string
    stock?: number
  }

  const data = await db.products.create({
    name,
    sku,
    code,
    description,
    price,
    category,
    stock: stock || 0,
  })

  res.status(201).json(data)
}))

productsRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const { name, sku, code, description, price, category, stock } = req.body as {
    name?: string
    sku?: string
    code?: string
    description?: string
    price?: number
    category?: string
    stock?: number
  }
  // 过滤 undefined 值
  const updateData: Record<string, any> = {}
  if (name !== undefined) updateData.name = name
  if (sku !== undefined) updateData.sku = sku
  if (code !== undefined) updateData.code = code
  if (description !== undefined) updateData.description = description
  if (price !== undefined) updateData.price = price
  if (category !== undefined) updateData.category = category
  if (stock !== undefined) updateData.stock = stock

  const data = await db.products.update(id, updateData)

  if (!data) {
    return res.status(404).json({ error: '产品不存在' })
  }
  res.json(data)
}))

productsRouter.delete('/:id', asyncHandler(createProtectedDeleteHandler('product', db.products.delete)))
