import express from 'express'
import sharp from 'sharp'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'
import { requirePermission } from '../middleware/auth.js'

export const quotesRouter = express.Router()

// 缩略图内存缓存（id -> base64 缩略图），避免重复生成
const thumbnailCache = new Map<string, string>()

// 查看类接口：需要 quotes:view 权限（thumbnail 仅需认证即可，供前端 img 标签加载）
quotesRouter.get('/', requirePermission('quotes:view'), asyncHandler(async (_req, res) => {
  const data = await db.quotes.getAll()
  res.json(data)
}))

// 获取所有订单的图片标识（哪些订单有图片），轻量级查询
quotesRouter.get('/image-flags', requirePermission('quotes:view'), asyncHandler(async (_req, res) => {
  const flags = await db.quotes.getAllImageFlags()
  res.json(flags)
}))

// 获取单个订单的缩略图（80x80 JPEG，内存缓存）
quotesRouter.get('/:id/thumbnail', asyncHandler(async (req, res) => {
  const { id } = req.params

  // 检查缓存
  const cached = thumbnailCache.get(id)
  if (cached) {
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    return res.send(Buffer.from(cached, 'base64'))
  }

  // 获取第一张图片
  const firstImage = await db.quotes.getFirstImage(id)
  if (!firstImage) {
    return res.status(404).json({ error: '无图片' })
  }

  try {
    // 从 data URI 中提取 base64 数据
    const base64Match = firstImage.match(/^data:image\/\w+;base64,(.+)$/)
    let imgBuffer: Buffer
    if (base64Match) {
      imgBuffer = Buffer.from(base64Match[1], 'base64')
    } else {
      imgBuffer = Buffer.from(firstImage, 'base64')
    }

    // 用 sharp 生成 80x80 缩略图
    const thumbnailBuffer = await sharp(imgBuffer)
      .resize(80, 80, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer()

    // 缓存
    thumbnailCache.set(id, thumbnailBuffer.toString('base64'))

    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'public, max-age=86400')
    return res.send(thumbnailBuffer)
  } catch (err) {
    console.error('[Thumbnail] 生成缩略图失败:', err)
    return res.status(500).json({ error: '缩略图生成失败' })
  }
}))

quotesRouter.get('/:id/delete-check', requirePermission('quotes:delete'), asyncHandler(createDeleteCheckHandler('quote')))

quotesRouter.get('/:id', requirePermission('quotes:view'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.getById(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

// 新增订单：需要 quotes:create 权限
quotesRouter.post('/', requirePermission('quotes:create'), asyncHandler(async (req, res) => {
  const operator = req.user?.name || ''
  const data = await db.quotes.create({ ...req.body, created_by: operator, updated_by: operator })
  res.json(data)
}))

// 编辑订单：需要 quotes:edit 权限
quotesRouter.put('/:id', requirePermission('quotes:edit'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const operator = req.user?.name || ''
  const data = await db.quotes.update(id, { ...req.body, updated_by: operator })
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  // 清除缩略图缓存，使更新后的图片能反映到列表缩略图
  thumbnailCache.delete(id)
  res.json(data)
}))

// 删除订单：需要 quotes:delete 权限
quotesRouter.delete('/:id', requirePermission('quotes:delete'), asyncHandler(createProtectedDeleteHandler('quote', db.quotes.delete)))

// 复制订单：需要 quotes:copy 权限
quotesRouter.post('/:id/copy', requirePermission('quotes:copy'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.copy(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

// 状态流转接口：需要 quotes:status-transition 权限
quotesRouter.post('/:id/next-status', requirePermission('quotes:status-transition'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.nextStatus(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

quotesRouter.post('/:id/prev-status', requirePermission('quotes:status-transition'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.prevStatus(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

quotesRouter.post('/:id/end', requirePermission('quotes:status-transition'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.quotes.endQuote(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))
