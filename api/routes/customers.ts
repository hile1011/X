import express from 'express'
import { db } from '../db'

export const customersRouter = express.Router()

customersRouter.get('/', async (_req, res) => {
  const data = await db.customers.getAll()
  res.json(data)
})

customersRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const data = await db.customers.getById(id)
  if (!data) {
    return res.status(404).json({ error: '客户不存在' })
  }
  res.json(data)
})

customersRouter.get('/name/:name', async (req, res) => {
  const { name } = req.params
  const data = await db.customers.getByName(decodeURIComponent(name))
  res.json(data)
})

customersRouter.post('/', async (req, res) => {
  const { name, contact_person, phone, email, address, industry } = req.body as {
    name: string
    contact_person?: string
    phone?: string
    email?: string
    address?: string
    industry?: string
  }

  const data = await db.customers.create({
    name,
    contact_person,
    phone,
    email,
    address,
    industry,
  })

  res.status(201).json(data)
})

customersRouter.put('/:id', async (req, res) => {
  const { id } = req.params
  const { name, contact_person, phone, email, address, industry } = req.body as {
    name?: string
    contact_person?: string
    phone?: string
    email?: string
    address?: string
    industry?: string
  }

  const data = await db.customers.update(id, {
    name,
    contact_person,
    phone,
    email,
    address,
    industry,
  })

  if (!data) {
    return res.status(404).json({ error: '客户不存在' })
  }
  res.json(data)
})

customersRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  const success = await db.customers.delete(id)
  if (!success) {
    return res.status(404).json({ error: '客户不存在' })
  }
  res.json({ message: '客户已删除' })
})
