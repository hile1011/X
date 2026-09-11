import express from 'express'
import sharp from 'sharp'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'
import { requirePermission, requireAnyPermission } from '../middleware/auth.js'

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
  const operator = req.user?.name || ''
  const data = await db.quotes.copy(id, operator)
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

// ─── 订单对账管理（v28） ─────────────────────────────────────

/** 校验对账工艺成本明细 payload；通过返回 null，否则返回错误信息 */
function validateReconciliationCosts(body: any): string | null {
  const costs = body?.costs
  if (!Array.isArray(costs)) return 'costs 必须为数组'
  if (costs.length > 100) return '工艺成本明细不能超过 100 条'
  for (const c of costs) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) return '工艺名称不能为空'
    if (c.name.trim().length > 128) return '工艺名称不能超过 128 字符'
    if (c.unitPrice != null && isNaN(Number(c.unitPrice))) return '工艺单价必须为数字'
    if (c.quantity != null && isNaN(Number(c.quantity))) return '工艺数量必须为数字'
    if (c.cost == null || isNaN(Number(c.cost))) return '工艺成本必须为数字'
    if (Number(c.cost) < 0) return '工艺成本不能为负数'
    if (c.remark && String(c.remark).length > 500) return '工艺备注不能超过 500 字符'
  }
  return null
}

// 获取订单的对账工艺成本明细（订单对账模块权限，v30）
quotesRouter.get('/:id/reconciliation-costs', requirePermission('reconciliation:view'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const quote = await db.quotes.getById(id)
  if (!quote) {
    return res.status(404).json({ error: '报价不存在' })
  }
  const costs = await db.reconciliation.getCosts(id)
  res.json(costs)
}))

// 保存订单的对账工艺成本明细（全量替换，事务；订单对账模块权限，v30）
quotesRouter.put('/:id/reconciliation-costs', requirePermission('reconciliation:edit'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const quote = await db.quotes.getById(id)
  if (!quote) {
    return res.status(404).json({ error: '报价不存在' })
  }
  const error = validateReconciliationCosts(req.body)
  if (error) {
    return res.status(400).json({ error })
  }
  const costs = await db.reconciliation.replaceCosts(id, req.body.costs)
  res.json(costs)
}))

// 确认对账：已发货已收款(5) → 已对账(8)（订单对账模块权限，v30）
quotesRouter.post('/:id/reconcile', requirePermission('reconciliation:execute'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.reconciliation.reconcileQuote(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

// 退回对账：已对账(8) → 已发货已收款(5)（订单对账模块权限，v30）
quotesRouter.post('/:id/unreconcile', requirePermission('reconciliation:execute'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const data = await db.reconciliation.unreconcileQuote(id)
  if (!data) {
    return res.status(404).json({ error: '报价不存在' })
  }
  res.json(data)
}))

// ─── 做货流程任务（v24 甘特图数据） ─────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 校验任务列表 payload；通过返回 null，否则返回错误信息 */
function validateTasks(body: any): string | null {
  const tasks = body?.tasks
  if (!Array.isArray(tasks)) return 'tasks 必须为数组'
  if (tasks.length > 50) return '任务数量不能超过 50'
  for (const t of tasks) {
    if (!t || typeof t.name !== 'string' || !t.name.trim()) return '任务名称不能为空'
    if (t.name.trim().length > 64) return '任务名称不能超过 64 字符'
    for (const key of ['planStart', 'planEnd', 'actualStart', 'actualEnd'] as const) {
      const v = t[key]
      if (v != null && v !== '' && !DATE_RE.test(String(v))) return `日期字段 ${key} 格式必须为 YYYY-MM-DD`
    }
    if (t.remark && String(t.remark).length > 255) return '备注不能超过 255 字符'
    if (t.materials != null) {
      if (!Array.isArray(t.materials)) return 'materials 必须为数组'
      if (t.materials.length > 50) return '材料数量不能超过 50'
      for (const m of t.materials) {
        if (!m || typeof m.name !== 'string' || !m.name.trim()) return '材料名称不能为空'
      }
    }
  }
  return null
}

// 做货流程跟踪表：全部订单的任务总览（JOIN 订单摘要；两段式路径不与 /:id/:sub 冲突；做货跟踪模块权限，v30）
quotesRouter.get('/production-tasks/overview', requirePermission('production-tracking:view'), asyncHandler(async (_req, res) => {
  const rows = await db.productionTasks.getAllWithQuoteInfo()
  res.json(rows)
}))

// 获取订单的做货流程任务列表（做货跟踪模块或订单查看权限任一即可：甘特图页与订单详情页做货流程 Tab 均使用，v30）
quotesRouter.get('/:id/production-tasks', requireAnyPermission('production-tracking:view', 'quotes:view'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const quote = await db.quotes.getById(id)
  if (!quote) {
    return res.status(404).json({ error: '报价不存在' })
  }
  const tasks = await db.productionTasks.getByQuoteId(id)
  res.json(tasks)
}))

// 整体同步订单的做货流程任务（全量替换，事务；做货跟踪模块或订单编辑权限任一即可，v30）
quotesRouter.put('/:id/production-tasks', requireAnyPermission('production-tracking:edit', 'quotes:edit'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const quote = await db.quotes.getById(id)
  if (!quote) {
    return res.status(404).json({ error: '报价不存在' })
  }
  const error = validateTasks(req.body)
  if (error) {
    return res.status(400).json({ error })
  }
  const tasks = await db.productionTasks.replaceForQuote(id, req.body.tasks)
  res.json(tasks)
}))
