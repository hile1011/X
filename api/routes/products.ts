import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'
import { requirePermission } from '../middleware/auth.js'

export const productsRouter = express.Router()

// ============================================================
// 产品图册媒体（v32）：图片/视频，原图存储不压缩
// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 媒体文件根目录（api/uploads/），磁盘路径由此拼接 */
const MEDIA_ROOT = path.join(__dirname, '../uploads')
/** 产品媒体子目录名（file_path 存储相对 MEDIA_ROOT 的路径，如 products/xxx.jpg） */
const MEDIA_SUBDIR = 'products'
/** 单文件大小上限 500MB（视频原文件较大，不做压缩故允许大文件） */
const MEDIA_MAX_FILE_SIZE = 500 * 1024 * 1024

/** 允许的图片/视频 MIME 类型（其他类型拒绝上传） */
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml', 'image/avif', 'image/tiff',
])
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/mpeg', 'video/ogg',
])

/** 由 MIME 推断媒体类型；不在白名单返回 null */
function resolveMediaType(mimeType: string): 'image' | 'video' | null {
  if (ALLOWED_IMAGE_MIMES.has(mimeType)) return 'image'
  if (ALLOWED_VIDEO_MIMES.has(mimeType)) return 'video'
  return null
}

/** 生成安全存储文件名：时间戳 + 随机数 + 白名单扩展名（防路径穿越/特殊字符） */
function buildStoredFileName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  const safeExt = /^\.?[a-z0-9]{1,8}$/.test(ext) ? ext.replace(/^\./, '') : 'bin'
  return `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}.${safeExt}`
}

/** 确保产品媒体目录存在 */
function ensureMediaDir(): void {
  const dir = path.join(MEDIA_ROOT, MEDIA_SUBDIR)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * 相对路径 → 绝对路径（校验不越出媒体根目录，防路径穿越）
 */
function resolveMediaPath(filePath: string): string | null {
  const abs = path.resolve(MEDIA_ROOT, filePath)
  const root = path.resolve(MEDIA_ROOT)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

/** 尽力删除媒体文件（文件不存在/删除失败均忽略，不阻断业务） */
function removeMediaFileQuietly(filePath: string): void {
  try {
    const abs = resolveMediaPath(filePath)
    if (abs && fs.existsSync(abs)) {
      fs.unlinkSync(abs)
    }
  } catch (err) {
    console.warn('[ProductMedia] 删除媒体文件失败（忽略）:', filePath, (err as Error).message)
  }
}

// multer 磁盘存储：原文件字节直接落盘，不做任何压缩/转码（完整保留原始质量与分辨率）
const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureMediaDir()
      cb(null, path.join(MEDIA_ROOT, MEDIA_SUBDIR))
    } catch (err) {
      cb(err as Error, '')
    }
  },
  filename: (_req, file, cb) => {
    cb(null, buildStoredFileName(file.originalname))
  },
})

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: MEDIA_MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (!resolveMediaType(file.mimetype)) {
      // 传给 multer 的错误会在错误处理中间件中统一返回
      return cb(new Error(`不支持的文件类型：${file.mimetype || '未知'}（仅支持图片/视频）`))
    }
    cb(null, true)
  },
})

// 产品图册列表（查看权限）
productsRouter.get('/:id/media', requirePermission('products:view'), asyncHandler(async (req, res) => {
  const media = await db.productMedia.getByProduct(req.params.id)
  res.json(media)
}))

// 上传产品媒体（编辑权限；multipart/form-data，字段名 files，支持多文件）
productsRouter.post('/:id/media', requirePermission('products:edit'), (req, res, next) => {
  mediaUpload.array('files', 50)(req, res, (err) => {
    if (err) {
      const message = (err as any).code === 'LIMIT_FILE_SIZE'
        ? '文件过大（单个文件上限 500MB）'
        : err.message || '上传失败'
      return res.status(400).json({ error: message })
    }
    next()
  })
}, asyncHandler(async (req, res) => {
  const { id } = req.params
  const product = await db.products.getById(id)
  if (!product) {
    // 产品不存在：清理已落盘的文件
    for (const f of req.files as Express.Multer.File[] || []) {
      removeMediaFileQuietly(`${MEDIA_SUBDIR}/${f.filename}`)
    }
    return res.status(404).json({ error: '产品不存在' })
  }

  const files = (req.files as Express.Multer.File[]) || []
  if (files.length === 0) {
    return res.status(400).json({ error: '请选择要上传的图片或视频文件' })
  }

  // 依次追加到图册末尾（保持上传顺序）
  let sortOrder = await db.productMedia.nextSortOrder(id)
  const created = []
  for (const f of files) {
    const mediaType = resolveMediaType(f.mimetype)
    if (!mediaType) {
      // fileFilter 已拦截，此处兜底清理
      removeMediaFileQuietly(`${MEDIA_SUBDIR}/${f.filename}`)
      continue
    }
    created.push(await db.productMedia.create({
      productId: id,
      mediaType,
      fileName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      filePath: `${MEDIA_SUBDIR}/${f.filename}`,
      fileSize: f.size,
      mimeType: f.mimetype,
      sortOrder: sortOrder++,
    }))
  }

  if (created.length === 0) {
    return res.status(400).json({ error: '没有可上传的图片/视频文件' })
  }
  res.status(201).json(created)
}))

// 自定义重排图册顺序（编辑权限）：{ mediaIds } 为该产品全部媒体 id 的新顺序
productsRouter.put('/:id/media/reorder', requirePermission('products:edit'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const { mediaIds } = req.body as { mediaIds: string[] }
  if (!Array.isArray(mediaIds) || mediaIds.some((mid) => typeof mid !== 'string')) {
    return res.status(400).json({ error: 'mediaIds 必须为字符串数组' })
  }
  try {
    await db.productMedia.reorder(id, mediaIds)
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message })
  }
  const media = await db.productMedia.getByProduct(id)
  res.json(media)
}))

// 删除单个媒体（编辑权限）：删除记录并清理磁盘文件（原图文件一并删除）
productsRouter.delete('/:id/media/:mediaId', requirePermission('products:edit'), asyncHandler(async (req, res) => {
  const { mediaId } = req.params
  const removed = await db.productMedia.deleteById(mediaId)
  if (!removed) {
    return res.status(404).json({ error: '媒体文件不存在' })
  }
  removeMediaFileQuietly(removed.file_path)
  res.json({ message: '删除成功' })
}))

// 获取媒体文件内容（仅需认证，供前端 img/video 标签加载；支持 token 查询参数）
// res.sendFile 原样输出磁盘字节（无压缩），并自动支持 Range 请求（视频拖动进度条）
productsRouter.get('/:id/media/:mediaId/file', asyncHandler(async (req, res) => {
  const { mediaId } = req.params
  const media = await db.productMedia.getById(mediaId)
  if (!media) {
    return res.status(404).json({ error: '媒体文件不存在' })
  }
  const abs = resolveMediaPath(media.file_path)
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).json({ error: '媒体文件已丢失' })
  }
  res.set('Content-Type', media.mime_type || 'application/octet-stream')
  // 缓存失效控制：updated_at 变化（如重排不改变内容，删除后 id 即失效）时 URL 不变，
  // 用较短的私有缓存策略，避免删除/替换后浏览器继续使用旧缓存
  res.set('Cache-Control', 'private, max-age=3600')
  res.sendFile(abs)
}))

// ============================================================
// 产品基础信息 CRUD
// 注意：列表/详情等查询端点被订单、工作台、报表等多模块跨模块调用
// （这些模块用户可能未持有 products:view），沿用历史仅认证的口径；
// 权限拦截由前端路由 ProtectedRoute 控制
// ============================================================

productsRouter.get('/', asyncHandler(async (_req, res) => {
  const data = await db.products.getAll()
  // 附带每个产品的第一张图片（图册排序最前的 image），供列表页缩略图展示
  const firstImages = await db.productMedia.getFirstImages()
  const byProduct = new Map(firstImages.map((m) => [m.product_id, m]))
  res.json(data.map((p) => ({ ...p, firstImage: byProduct.get(p.id) ?? null })))
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

productsRouter.put('/:id', requirePermission('products:edit'), asyncHandler(async (req, res) => {
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

// 删除产品：连带清理图册记录与磁盘文件（文件删除失败不阻断）
productsRouter.delete('/:id', requirePermission('products:delete'), asyncHandler(createProtectedDeleteHandler('product', async (id: string) => {
  const ok = await db.products.delete(id)
  if (ok) {
    const removed = await db.productMedia.deleteByProduct(id)
    removed.forEach((m) => removeMediaFileQuietly(m.file_path))
  }
  return ok
})))
