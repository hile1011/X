import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { requirePermission } from '../middleware/auth.js'
import { createDeleteCheckHandler, createProtectedDeleteHandler } from '../services/deleteHandler.js'
import type { ProductCostFieldType } from '../types/index.js'

export const productCostItemsRouter = express.Router()

const FIELD_TYPES: ProductCostFieldType[] = ['text', 'number', 'date', 'select']

/** 校验字段类型 */
function isValidFieldType(type: unknown): type is ProductCostFieldType {
  return typeof type === 'string' && FIELD_TYPES.includes(type as ProductCostFieldType)
}

// ─── 成本项 ──────────────────────────────────────────────────

// 成本项列表（含其下可选工艺与自定义字段，组装树）
productCostItemsRouter.get('/', requirePermission('process-costs:view'), asyncHandler(async (_req, res) => {
  res.json(await db.productCostItems.getAll())
}))

// 单个成本项（含工艺与字段）
productCostItemsRouter.get('/:id', requirePermission('process-costs:view'), asyncHandler(async (req, res) => {
  const data = await db.productCostItems.getById(req.params.id)
  if (!data) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  res.json(data)
}))

// 删除前检查（返回级联删除影响明细）
productCostItemsRouter.get('/:id/delete-check', asyncHandler(createDeleteCheckHandler('product_cost_item')))

// 新增成本项
productCostItemsRouter.post('/', requirePermission('process-costs:create'), asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ error: '成本项名称不能为空' })
  }
  res.status(201).json(await db.productCostItems.createItem(name))
}))

// 更新成本项名称
productCostItemsRouter.put('/:id', requirePermission('process-costs:edit'), asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ error: '成本项名称不能为空' })
  }
  const data = await db.productCostItems.updateItem(req.params.id, name)
  if (!data) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  res.json(data)
}))

// 删除成本项（级联删除其下工艺与字段）
productCostItemsRouter.delete('/:id', requirePermission('process-costs:delete'), asyncHandler(
  createProtectedDeleteHandler('product_cost_item', db.productCostItems.deleteItem)
))

// ─── 可选工艺 ─────────────────────────────────────────────────

// 校验工艺请求体：名称必填；customValues 为「字段id→值」映射
function validateProcessBody(body: any): { ok: true; data: {
  name: string
  cost?: number
  formula?: string
  features?: string
  remark?: string
  customValues?: Record<string, string>
} } | { ok: false; error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return { ok: false, error: '工艺名称不能为空' }
  }
  const data: any = { name }
  if (body.cost !== undefined) {
    const cost = Number(body.cost)
    if (!Number.isFinite(cost) || cost < 0) {
      return { ok: false, error: '工艺成本金额必须为非负数字' }
    }
    data.cost = cost
  }
  for (const key of ['formula', 'features', 'remark'] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string') {
        return { ok: false, error: `${key} 必须为字符串` }
      }
      data[key] = body[key]
    }
  }
  if (body.customValues !== undefined) {
    if (typeof body.customValues !== 'object' || body.customValues === null || Array.isArray(body.customValues)) {
      return { ok: false, error: 'customValues 必须为对象（字段id→值）' }
    }
    const customValues: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.customValues)) {
      customValues[k] = String(v ?? '')
    }
    data.customValues = customValues
  }
  return { ok: true, data }
}

// 新增可选工艺（挂在指定成本项下）
productCostItemsRouter.post('/:id/processes', requirePermission('process-costs:create'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const validated = validateProcessBody(req.body)
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error })
  }
  const created = await db.productCostItems.createProcess(req.params.id, validated.data)
  res.status(201).json(created)
}))

// 手动排序可选工艺（body: { processIds }，为该成本项下全部工艺 id 的新顺序）。
// 注意：必须注册在 PUT /:id/processes/:processId 之前，否则 "reorder" 会被当作 processId 匹配。
productCostItemsRouter.put('/:id/processes/reorder', requirePermission('process-costs:edit'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const processIds = req.body?.processIds
  if (!Array.isArray(processIds) || processIds.length === 0
    || !processIds.every((p: unknown) => typeof p === 'string' && p.length > 0)) {
    return res.status(400).json({ error: 'processIds 必须为非空字符串数组' })
  }
  try {
    res.json(await db.productCostItems.reorderProcesses(req.params.id, processIds))
  } catch (err: any) {
    // 列表与当前配置不一致（并发增删/漏传/混入其他成本项工艺）
    res.status(400).json({ error: err.message || '调整工艺顺序失败' })
  }
}))

// 更新可选工艺
productCostItemsRouter.put('/:id/processes/:processId', requirePermission('process-costs:edit'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const process = item.processes.find((p) => p.id === req.params.processId)
  if (!process) {
    return res.status(404).json({ error: '可选工艺不存在' })
  }
  const validated = validateProcessBody(req.body)
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error })
  }
  res.json(await db.productCostItems.updateProcess(req.params.processId, validated.data))
}))

// 删除前检查（可选工艺）
productCostItemsRouter.get('/:id/processes/:processId/delete-check', asyncHandler(
  createDeleteCheckHandler('product_cost_process')
))

// 删除可选工艺
productCostItemsRouter.delete('/:id/processes/:processId', requirePermission('process-costs:delete'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const process = item.processes.find((p) => p.id === req.params.processId)
  if (!process) {
    return res.status(404).json({ error: '可选工艺不存在' })
  }
  const run = createProtectedDeleteHandler('product_cost_process', db.productCostItems.deleteProcess)
  await run(req, res)
}))

// ─── 自定义字段 ───────────────────────────────────────────────

// 校验字段请求体：名称必填、类型合法、select 需至少一个选项
function validateFieldBody(body: any): { ok: true; data: {
  name: string
  fieldType?: ProductCostFieldType
  options?: string[]
  visible?: boolean
  sortOrder?: number
} } | { ok: false; error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return { ok: false, error: '字段名称不能为空' }
  }
  const data: any = { name }
  if (body.fieldType !== undefined) {
    if (!isValidFieldType(body.fieldType)) {
      return { ok: false, error: '字段类型必须为 text / number / date / select 之一' }
    }
    data.fieldType = body.fieldType
  }
  if (body.options !== undefined) {
    if (!Array.isArray(body.options)) {
      return { ok: false, error: 'options 必须为字符串数组' }
    }
    data.options = body.options.map((o: unknown) => String(o ?? '').trim()).filter(Boolean)
  }
  if (body.visible !== undefined) {
    data.visible = Boolean(body.visible)
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder)
    if (!Number.isFinite(sortOrder)) {
      return { ok: false, error: 'sortOrder 必须为数字' }
    }
    data.sortOrder = sortOrder
  }
  return { ok: true, data }
}

// 新增自定义字段（对该成本项下所有工艺生效）
productCostItemsRouter.post('/:id/fields', requirePermission('process-costs:create'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const validated = validateFieldBody(req.body)
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error })
  }
  // select 类型必须在创建时就带选项（后续可编辑补充）
  if (validated.data.fieldType === 'select' && (!validated.data.options || validated.data.options.length === 0)) {
    return res.status(400).json({ error: '下拉类型字段至少需要一个选项' })
  }
  res.status(201).json(await db.productCostItems.createField(req.params.id, validated.data))
}))

// 更新自定义字段（名称/类型/选项/显隐/排序）
productCostItemsRouter.put('/:id/fields/:fieldId', requirePermission('process-costs:edit'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const field = item.fields.find((f) => f.id === req.params.fieldId)
  if (!field) {
    return res.status(404).json({ error: '自定义字段不存在' })
  }
  const validated = validateFieldBody(req.body)
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error })
  }
  // 最终类型为 select 时必须保证至少一个选项（沿用现值或传入新值）
  const finalType = validated.data.fieldType ?? field.fieldType
  if (finalType === 'select') {
    const finalOptions = validated.data.options ?? field.options
    if (finalOptions.length === 0) {
      return res.status(400).json({ error: '下拉类型字段至少需要一个选项' })
    }
  }
  res.json(await db.productCostItems.updateField(req.params.fieldId, validated.data))
}))

// 删除前检查（自定义字段：返回已录入值的工艺数）
productCostItemsRouter.get('/:id/fields/:fieldId/delete-check', asyncHandler(
  createDeleteCheckHandler('product_cost_field')
))

// 删除自定义字段（同步清理全部工艺的对应字段值）
productCostItemsRouter.delete('/:id/fields/:fieldId', requirePermission('process-costs:delete'), asyncHandler(async (req, res) => {
  const item = await db.productCostItems.getById(req.params.id)
  if (!item) {
    return res.status(404).json({ error: '产品成本项不存在' })
  }
  const field = item.fields.find((f) => f.id === req.params.fieldId)
  if (!field) {
    return res.status(404).json({ error: '自定义字段不存在' })
  }
  const run = createProtectedDeleteHandler('product_cost_field', db.productCostItems.deleteField)
  await run(req, res)
}))
