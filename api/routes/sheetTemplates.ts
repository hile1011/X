import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { requirePermission } from '../middleware/auth.js'
import { normalizeFabricMeters, logFabricMetersCeil } from '../services/fabricMeters.js'
import { sanitizeSheetLayoutConfig } from '../services/sheetLayout.js'

export const sheetTemplatesRouter = express.Router()

/**
 * 校验款式编码：产品管理中存在对应产品即合法（按 products.code 或 products.id 匹配）
 * 订单页无 code 产品的款式值为产品 id；内置款式 1-6 对应默认款式产品 style-1~6
 */
async function isValidStyleCode(styleCode: string): Promise<boolean> {
  const products = await db.products.getAll()
  return products.some((p) => p.code === styleCode || p.id === styleCode)
}

/** 校验模板保存请求体：data 为二维数组、formulas 为字符串映射 */
function validateTemplateBody(body: any): { ok: true; data: (string | number | null)[][]; formulas: Record<string, string> } | { ok: false; error: string } {
  const { data, formulas } = body || {}
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: 'data 必须为非空二维数组' }
  }
  if (!Array.isArray(data[0])) {
    return { ok: false, error: 'data 必须为二维数组' }
  }
  if (formulas !== undefined && (typeof formulas !== 'object' || formulas === null || Array.isArray(formulas))) {
    return { ok: false, error: 'formulas 必须为对象' }
  }
  return {
    ok: true,
    data: data as (string | number | null)[][],
    formulas: (formulas ?? {}) as Record<string, string>,
  }
}

// 模板列表（全部款式；可选 ?styleCode= 过滤）
// 读取接口仅需认证：订单编辑页创建表格时需加载模板数据，使用者不一定有模板管理权限
sheetTemplatesRouter.get('/', asyncHandler(async (req, res) => {
  const { styleCode } = req.query
  if (styleCode !== undefined) {
    // 过滤查询仅做基本格式校验（历史款式即使产品已删除仍可查询其模板）
    if (typeof styleCode !== 'string' || styleCode.trim() === '') {
      return res.status(400).json({ error: '无效的款式 code' })
    }
    res.json(await db.sheetTemplates.getByStyleCode(styleCode))
    return
  }
  res.json(await db.sheetTemplates.getAll())
}))

// 按 id 获取单个模板
sheetTemplatesRouter.get('/:id', asyncHandler(async (req, res) => {
  const data = await db.sheetTemplates.getById(req.params.id)
  if (!data) {
    return res.status(404).json({ error: '模板不存在' })
  }
  res.json(data)
}))

// 新增模板（一对多：同款式可有多个，名称款式内唯一）
// data/formulas 可选：为空时创建空白模板（前端新增时通常传入内置模板作为初始内容）
// 款式编码动态校验：新增产品即成为可选款式（自定义编码或产品 id 均可绑定模板）
sheetTemplatesRouter.post('/', requirePermission('sheet-templates:edit'), asyncHandler(async (req, res) => {
  const { styleCode, name } = req.body || {}
  if (typeof styleCode !== 'string' || !(await isValidStyleCode(styleCode))) {
    return res.status(400).json({ error: '无效的款式编码：请先在产品管理中新增对应产品' })
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '模板名称不能为空' })
  }
  const data = Array.isArray(req.body?.data) && req.body.data.length > 0 ? req.body.data : [[null]]
  const formulas = (req.body?.formulas && typeof req.body.formulas === 'object' && !Array.isArray(req.body.formulas)) ? req.body.formulas : {}
  // 布局配置校验（v34）：正有限数、key 界内，脏条目丢弃（前端已收集合法值，此为 API 直调兜底）
  const layout = {
    columnWidthConfig: sanitizeSheetLayoutConfig(req.body?.columnWidthConfig, 'width'),
    rowHeightConfig: sanitizeSheetLayoutConfig(req.body?.rowHeightConfig, 'height'),
  }
  // 布料米数向上取整规范化（前端已处理，后端兜底；审计日志记录原值与取整值）
  const norm = normalizeFabricMeters(data, formulas)
  try {
    const created = await db.sheetTemplates.create(styleCode, name, norm.data, norm.formulas ?? formulas, req.user?.name || '', layout)
    await logFabricMetersCeil({
      entityType: 'sheet-template',
      entityId: created.id,
      entityName: `${created.styleCode}/${created.name}`,
      operator: req.user?.name || '',
      ceilChanges: norm.ceilChanges,
      formulaChanges: norm.formulaChanges,
    })
    res.status(201).json(created)
  } catch (error: any) {
    // 同款式重名（uk_style_name）等业务校验错误返回 409
    res.status(409).json({ error: error?.message || '创建模板失败' })
  }
}))

// 更新模板（内容必传，名称可选改名）
sheetTemplatesRouter.put('/:id', requirePermission('sheet-templates:edit'), asyncHandler(async (req, res) => {
  const { id } = req.params
  const validated = validateTemplateBody(req.body)
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error })
  }
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined
  // 布局配置校验（v34）：未传时保持已存值（局部更新），传入（含空数组）则覆盖
  const layout = {
    columnWidthConfig: sanitizeSheetLayoutConfig(req.body?.columnWidthConfig, 'width'),
    rowHeightConfig: sanitizeSheetLayoutConfig(req.body?.rowHeightConfig, 'height'),
  }
  // 布料米数向上取整规范化（前端已处理，后端兜底；审计日志记录原值与取整值）
  const norm = normalizeFabricMeters(validated.data, validated.formulas)
  try {
    const saved = await db.sheetTemplates.update(id, name, norm.data, norm.formulas ?? validated.formulas, req.user?.name || '', layout)
    if (!saved) {
      return res.status(404).json({ error: '模板不存在' })
    }
    await logFabricMetersCeil({
      entityType: 'sheet-template',
      entityId: id,
      entityName: `${saved.styleCode}/${saved.name}`,
      operator: req.user?.name || '',
      ceilChanges: norm.ceilChanges,
      formulaChanges: norm.formulaChanges,
    })
    res.json(saved)
  } catch (error: any) {
    res.status(409).json({ error: error?.message || '保存模板失败' })
  }
}))

// 删除模板（订单保存的 tableData 不受影响）
sheetTemplatesRouter.delete('/:id', requirePermission('sheet-templates:edit'), asyncHandler(async (req, res) => {
  const deleted = await db.sheetTemplates.remove(req.params.id)
  if (!deleted) {
    return res.status(404).json({ error: '模板不存在' })
  }
  res.json({ success: true })
}))
