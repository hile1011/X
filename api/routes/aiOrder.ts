/**
 * AI 智能下单路由（v35：ai-order 模块）
 *
 * POST /api/ai-order/analyze
 *  - 接收用户文字描述 + 参考图片（base64 dataURL）+ 对话历史
 *  - 注入产品成本项配置（标准材质/工艺）与款式列表构建系统提示词
 *  - 调用 DashScope（通义千问 Qwen-VL）综合分析，返回订单草稿 + 标准匹配结果
 */
import express from 'express'
import { db } from '../db.js'
import { asyncHandler } from '../asyncHandler.js'
import { requirePermission } from '../middleware/auth.js'
import {
  buildSystemPrompt,
  buildAnalyzeMessages,
  parseOrderDraft,
  matchStandardOptions,
  extractCustomerName,
  callDashScope,
  type ChatMessage,
  type AiStyleOption,
} from '../services/aiOrder.js'

export const aiOrderRouter = express.Router()

/** 历史消息条数上限（防请求体过大，与服务的轮数裁剪双保险） */
const MAX_HISTORY_ITEMS = 20
/** 单条消息文字长度上限 */
const MAX_MESSAGE_LENGTH = 4000

/** 加载款式选项：products 表全部产品（有 code 用 code，无 code 用 id，与前端 productStyles 服务一致） */
async function loadStyleOptions(): Promise<AiStyleOption[]> {
  const products = await db.products.getAll() as Array<{ id: string; name: string; code?: string | null }>
  return products.map((p) => ({
    value: p.code && p.code.trim() !== '' ? p.code : p.id,
    label: p.name,
  }))
}

aiOrderRouter.post('/analyze', requirePermission('ai-order:analyze'), asyncHandler(async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const images: string[] = Array.isArray(req.body?.images)
    ? req.body.images.filter((i: unknown) => typeof i === 'string')
    : []
  const history: ChatMessage[] = Array.isArray(req.body?.history)
    ? req.body.history
        .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-MAX_HISTORY_ITEMS)
        .map((m: any) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }))
    : []

  if (message === '' && images.length === 0) {
    return res.status(400).json({ error: '请输入文字描述或上传参考图片' })
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `文字描述过长（超过 ${MAX_MESSAGE_LENGTH} 字），请精简后重试` })
  }

  // 并行加载标准配置（产品成本项）与款式选项
  const [costItems, styles] = await Promise.all([
    db.productCostItems.getAll(),
    loadStyleOptions(),
  ])

  const systemPrompt = buildSystemPrompt(costItems, styles)
  let messages
  try {
    messages = buildAnalyzeMessages(systemPrompt, history, message, images)
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || '输入参数无效' })
  }

  const raw = await callDashScope(messages)
  const parsed = parseOrderDraft(raw)
  if (!parsed) {
    // JSON 解析失败：草稿置空，reply 降级为 AI 原文（不阻断对话）
    const match = matchStandardOptions(null, costItems, styles)
    return res.json({ reply: raw, draft: null, confidence: 0, draftMeta: match })
  }

  // 客户名称兜底：AI 偶发漏提取（消息明确含「客户是XX」仍输出空串），
  // 正则从用户消息直接提取，保障关键业务字段稳定
  if (parsed.draft && parsed.draft.customerName === '' && message !== '') {
    parsed.draft.customerName = extractCustomerName(message)
  }

  const draftMeta = matchStandardOptions(parsed.draft, costItems, styles)
  res.json({
    reply: parsed.reply,
    draft: parsed.draft,
    confidence: parsed.confidence,
    draftMeta,
  })
}))
