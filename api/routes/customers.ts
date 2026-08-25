import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'

export const customersRouter = express.Router()

customersRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.customers.getAll()
  res.json(data)
}))

customersRouter.get('/:id/delete-check', asyncHandler(createDeleteCheckHandler('customer')))

customersRouter.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.customers.getById(id)
  if (!data) {
    return res.status(404).json({ error: '客户不存在' })
  }
  res.json(data)
}))

customersRouter.get('/name/:name', asyncHandler(async (req, res) => {
  const { name } = req.params
  const data = await db.customers.getByName(decodeURIComponent(name))
  res.json(data)
}))

customersRouter.post('/', asyncHandler(async (req, res) => {
  const { name, contact_person, phone, email, address, industry, tags, remark } = req.body as {
    name: string
    contact_person?: string
    phone?: string
    email?: string
    address?: string
    industry?: string
    tags?: string
    remark?: string
  }

  const data = await db.customers.create({
    name,
    contact_person,
    phone,
    email,
    address,
    industry,
    tags,
    remark,
  })

  res.status(201).json(data)
}))

customersRouter.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params
  // 过滤掉 undefined 值，防止覆盖数据库中的有效值
  const { name, contact_person, phone, email, address, industry, tags, remark } = req.body as {
    name?: string
    contact_person?: string
    phone?: string
    email?: string
    address?: string
    industry?: string
    tags?: string
    remark?: string
  }
  const updateData: Record<string, string> = {}
  if (name !== undefined) updateData.name = name
  if (contact_person !== undefined) updateData.contact_person = contact_person
  if (phone !== undefined) updateData.phone = phone
  if (email !== undefined) updateData.email = email
  if (address !== undefined) updateData.address = address
  if (industry !== undefined) updateData.industry = industry
  if (tags !== undefined) updateData.tags = tags
  if (remark !== undefined) updateData.remark = remark

  const data = await db.customers.update(id, updateData)

  if (!data) {
    return res.status(404).json({ error: '客户不存在' })
  }
  res.json(data)
}))

customersRouter.delete('/:id', asyncHandler(createProtectedDeleteHandler('customer', db.customers.delete)))
