import express from 'express'
import { db } from '../db'
import type { Task } from '../types'

export const tasksRouter = express.Router()

tasksRouter.get('/', async (req, res) => {
  const data = await db.tasks.getAll()
  res.json(data)
})

tasksRouter.get('/:id', async (req, res) => {
  const { id } = req.params
  const data = await db.tasks.getById(id)
  if (!data) {
    return res.status(404).json({ error: '任务不存在' })
  }
  res.json(data)
})

tasksRouter.post('/', async (req, res) => {
  const { user_id, order_id, title, description, due_date } = req.body as {
    user_id?: string
    order_id?: string
    title: string
    description?: string
    due_date?: string
  }

  const data = await db.tasks.create({
    user_id,
    order_id,
    title,
    description,
    due_date,
  })

  res.status(201).json(data)
})

tasksRouter.put('/:id', async (req, res) => {
  const { id } = req.params
  const { status, title, description, due_date } = req.body as {
    status?: Task['status']
    title?: string
    description?: string
    due_date?: string
  }

  const data = await db.tasks.update(id, {
    status,
    title,
    description,
    due_date,
  })

  if (!data) {
    return res.status(404).json({ error: '任务不存在' })
  }
  res.json(data)
})

tasksRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  const success = await db.tasks.delete(id)
  if (!success) {
    return res.status(404).json({ error: '任务不存在' })
  }
  res.json({ message: '任务已删除' })
})
