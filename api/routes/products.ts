import express from 'express'
import { db } from '../db'

export const productsRouter = express.Router()

productsRouter.get('/', async (req, res) => {
  const data = await db.products.getAll()
  res.json(data)
})

productsRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const data = await db.products.getById(id)
  if (!data) {
    return res.status(404).json({ error: '产品不存在' })
  }
  res.json(data)
})

productsRouter.post('/', async (req, res) => {
  const { name, sku, description, price, category, stock } = req.body as {
    name: string
    sku: string
    description?: string
    price: number
    category?: string
    stock?: number
  }

  const data = await db.products.create({
    name,
    sku,
    description,
    price,
    category,
    stock: stock || 0,
  })

  res.status(201).json(data)
})

productsRouter.put('/:id', async (req, res) => {
  const { id } = req.params
  const { name, sku, description, price, category, stock } = req.body as {
    name?: string
    sku?: string
    description?: string
    price?: number
    category?: string
    stock?: number
  }

  const data = await db.products.update(id, {
    name,
    sku,
    description,
    price,
    category,
    stock,
  })

  if (!data) {
    return res.status(404).json({ error: '产品不存在' })
  }
  res.json(data)
})

productsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  const success = await db.products.delete(id)
  if (!success) {
    return res.status(404).json({ error: '产品不存在' })
  }
  res.json({ message: '产品已删除' })
})
