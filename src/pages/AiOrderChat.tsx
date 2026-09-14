/**
 * AI 智能下单（v35：ai-order 模块）
 *
 * 对话式生成帆布袋定制订单：
 *  - 左侧对话区：文字描述输入 + 参考图片上传（压缩为 ≤200KB dataURL，与订单页一致）
 *  - 右侧草稿预览区：AI 提取的订单字段（可编辑），标准配置命中提示 / 非标准黄色警示 / 缺失字段提醒
 *  - 确认后写入 sessionStorage（ai_order_draft），跳转 /quotes/new 自动填充订单表单
 *
 * AI 分析在后端完成（api/routes/aiOrder.ts）：注入产品成本项配置（标准材质/工艺）
 * 与款式列表构建提示词，调用通义千问 Qwen-VL 综合分析文字与图片。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AutoComplete, Select } from 'antd'
import {
  Sparkles, Send, Loader2, ImagePlus, X, AlertTriangle, CheckCircle2,
  ClipboardList, RefreshCw, Info, ArrowRight, Table2,
} from 'lucide-react'
import { api } from '../api'
import { useHasPermission } from '../hooks/usePermission'
import type { AiOrderDraft, AiOrderDraftMeta } from '../types'

/** sessionStorage 键：AI 草稿 → BagQuote 新建订单页填充后清除 */
export const AI_ORDER_DRAFT_STORAGE_KEY = 'ai_order_draft'

/** 与后端 MAX_IMAGES_PER_REQUEST 一致：单轮最多参考图片数 */
const MAX_IMAGES = 4
/** 参考图片压缩目标（base64 长度，与订单页产品图一致） */
const MAX_IMAGE_SIZE = 200 * 1024

/** 对话消息（渲染 + 传后端历史） */
interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  /** 仅用户消息：本轮携带的参考图片 dataURL */
  images?: string[]
}

const EMPTY_DRAFT: AiOrderDraft = {
  customerName: '', productStyle: '', productSpec: '', fabricMaterial: '',
  process: '', handleMaterial: '', handleSpec: '', quantity: '',
  boxSpec: '', unitPrice: '', sampleFee: '', remark: '',
  tableCells: [],
}

/**
 * 多轮草稿合并：AI 新一轮草稿的非空字段覆盖旧值，空字段保留旧值
 * （用户在对话中逐轮补充信息，草稿逐轮完善）。导出供单元测试。
 * tableCells 按「行|列」键合并（新值覆盖同位置旧值，不同位置累加）。
 */
export function mergeDraft(base: AiOrderDraft, incoming: AiOrderDraft | null): AiOrderDraft {
  if (!incoming) return base
  const merged = { ...base }
  for (const key of Object.keys(EMPTY_DRAFT) as Array<keyof AiOrderDraft>) {
    if (key === 'tableCells') continue
    if (incoming[key] !== '') merged[key] = incoming[key]
  }
  const cellMap = new Map(merged.tableCells.map((c) => [`${c.row}|${c.col}`, c]))
  for (const c of incoming.tableCells || []) {
    if (c && typeof c.row === 'string' && c.row !== '' && typeof c.col === 'string' && c.col !== '') {
      cellMap.set(`${c.row}|${c.col}`, c)
    }
  }
  merged.tableCells = Array.from(cellMap.values())
  return merged
}

/** 压缩图片为 ≤200KB 的 JPEG dataURL（与订单编辑页产品图同一算法） */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          let width = img.width
          let height = img.height
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')!
          canvas.width = width
          canvas.height = height
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)
          let quality = 0.8
          let result = canvas.toDataURL('image/jpeg', quality)
          while (result.length > MAX_IMAGE_SIZE && quality > 0.3) {
            quality -= 0.1
            result = canvas.toDataURL('image/jpeg', quality)
          }
          while (result.length > MAX_IMAGE_SIZE && width > 400) {
            width = Math.round(width * 0.8)
            height = Math.round(height * 0.8)
            canvas.width = width
            canvas.height = height
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)
            result = canvas.toDataURL('image/jpeg', quality)
          }
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/** 草稿可编辑字段配置（key → 中文名 + 占位提示；tableCells 单独展示，不在此列） */
const DRAFT_FIELDS: Array<{ key: Exclude<keyof AiOrderDraft, 'tableCells'>; label: string; placeholder: string }> = [
  { key: 'customerName', label: '客户名称', placeholder: '如：XX贸易' },
  { key: 'productSpec', label: '规格尺寸', placeholder: '如：40*35*10cm' },
  { key: 'quantity', label: '数量', placeholder: '如：5000' },
  { key: 'handleMaterial', label: '提手材质', placeholder: '如：帆布手提' },
  { key: 'handleSpec', label: '提带规格', placeholder: '如：2.5cm宽' },
  { key: 'boxSpec', label: '装箱规格', placeholder: '如：50pcs/箱' },
  { key: 'unitPrice', label: '单价', placeholder: '未提及可留空' },
  { key: 'sampleFee', label: '打样费', placeholder: '未提及可留空' },
]

export default function AiOrderChat() {
  const navigate = useNavigate()
  const canCreateQuote = useHasPermission('quotes:create')
  const canAnalyze = useHasPermission('ai-order:analyze')

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  // 订单草稿（可编辑）与最近一次 AI 的元信息（标准匹配/缺失/置信度）
  const [draft, setDraft] = useState<AiOrderDraft>(EMPTY_DRAFT)
  const [draftMeta, setDraftMeta] = useState<AiOrderDraftMeta | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [hasDraft, setHasDraft] = useState(false)
  // 用户已人工干预过的字段（清除其非标准警示：人工确认优先）
  const [manualEdited, setManualEdited] = useState<Set<string>>(new Set())

  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const draftPanelRef = useRef<HTMLDivElement>(null)

  // 新消息时自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, analyzing])

  const handleFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    setUploading(true)
    try {
      for (const file of imageFiles) {
        if (pendingImages.length >= MAX_IMAGES) {
          setError(`参考图片最多 ${MAX_IMAGES} 张`)
          break
        }
        try {
          const base64 = await compressImage(file)
          setPendingImages((prev) => [...prev, base64])
          setError('')
        } catch (e) {
          setError(e instanceof Error ? e.message : '图片处理失败')
        }
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const send = async () => {
    const message = input.trim()
    if ((message === '' && pendingImages.length === 0) || analyzing) return
    setError('')

    const userMsg: ChatMsg = { role: 'user', content: message, images: pendingImages.length > 0 ? [...pendingImages] : undefined }
    // 历史不含本轮消息；assistant 历史仅传文本（后端也会裁剪轮数）
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setPendingImages([])
    setAnalyzing(true)

    try {
      const res = await api.aiOrder.analyze({
        message,
        images: userMsg.images || [],
        history,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }])
      if (res.draft) {
        setDraft((prev) => mergeDraft(prev, res.draft))
        setHasDraft(true)
      }
      setDraftMeta(res.draftMeta)
      setConfidence(res.confidence)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'AI 分析失败，请重试'
      setError(msg)
      setMessages((prev) => [...prev, { role: 'assistant', content: `（分析失败）${msg}` }])
    } finally {
      setAnalyzing(false)
    }
  }

  const resetConversation = () => {
    if (analyzing) return
    setMessages([])
    setDraft(EMPTY_DRAFT)
    setDraftMeta(null)
    setConfidence(0)
    setHasDraft(false)
    setManualEdited(new Set())
    setError('')
    setInput('')
    setPendingImages([])
  }

  /** 更新草稿字段并标记人工干预（清除该字段非标准警示） */
  const updateDraftField = (key: keyof AiOrderDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setManualEdited((prev) => new Set(prev).add(key))
  }

  /** 当前字段的有效非标准警示（人工已干预的不再提示） */
  const activeNonStandard = (draftMeta?.nonStandard || []).filter((n) => !manualEdited.has(n.field))
  const missingFields = draftMeta?.missingFields || []

  /** 标准工艺选项池（AutoComplete 建议，来自产品成本项配置） */
  const standardProcessOptions = Array.from(
    new Set((draftMeta?.standardOptions.costItems || []).flatMap((c) => c.processes)),
  ).filter(Boolean)
  const styleOptions = draftMeta?.standardOptions.styles || []

  const confirmCreateOrder = () => {
    if (!hasDraft) return
    // 收集对话中出现过的全部参考图片（去重，作为订单产品图初始数据）
    const allImages: string[] = []
    for (const m of messages) {
      for (const img of m.images || []) {
        if (!allImages.includes(img)) allImages.push(img)
      }
    }
    sessionStorage.setItem(AI_ORDER_DRAFT_STORAGE_KEY, JSON.stringify({ draft, images: allImages }))
    navigate('/quotes/new?from=ai')
  }

  return (
    <div className="p-4 sm:p-6 flex flex-col h-[calc(100vh-3.5rem)]">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Sparkles size={24} className="text-primary-600" />
            AI 智能下单
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            用文字描述 + 参考图片表达定制需求，AI 自动提取订单信息（优先匹配产品成本项配置的标准材质与工艺）
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={resetConversation}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 text-gray-600 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={15} />
            清空对话
          </button>
        )}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* 左侧：对话区 */}
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100 min-w-0">
          {/* 消息历史 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && !analyzing && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <Sparkles size={48} className="mx-auto text-primary-200 mb-4" />
                  <h3 className="text-lg font-medium text-gray-700 mb-2">描述您的帆布袋定制需求</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">
                    例如：「XX公司 要做 5000 个有底有侧的帆布袋，12安帆布，尺寸 40*35*10cm，
                    正面数码uv印刷 logo，提手加宽 3cm，装箱 50 个一箱」<br />
                    也可以上传参考图片，AI 将结合图片与文字综合分析
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-primary-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}>
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {msg.images.map((img, i) => (
                        <img key={i} src={img} alt="参考图" className="w-20 h-20 object-cover rounded-lg border border-white/30" />
                      ))}
                    </div>
                  )}
                  {msg.content || '（图片分析请求）'}
                </div>
              </div>
            ))}
            {analyzing && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-500 rounded-2xl rounded-bl-md px-4 py-2.5 flex items-center gap-2 text-sm">
                  <Loader2 size={16} className="animate-spin" />
                  AI 正在分析您的需求...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t border-gray-100 p-3">
            {error && (
              <div className="mb-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
            )}
            {/* 待发送图片缩略图 */}
            {pendingImages.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {pendingImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img} alt="待发送" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
                    <button
                      onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="移除"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(Array.from(e.target.files))
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || pendingImages.length >= MAX_IMAGES || !canAnalyze}
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                title={pendingImages.length >= MAX_IMAGES ? `最多 ${MAX_IMAGES} 张` : '上传参考图片'}
              >
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder={canAnalyze ? '描述定制需求（Enter 发送，Shift+Enter 换行）...' : '无 AI 分析权限（ai-order:analyze）'}
                disabled={!canAnalyze || analyzing}
                rows={2}
                className="flex-1 resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400 disabled:bg-gray-50 disabled:text-gray-400"
              />
              <button
                onClick={send}
                disabled={analyzing || (input.trim() === '' && pendingImages.length === 0) || !canAnalyze}
                className="flex-shrink-0 h-10 px-4 flex items-center gap-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                发送
              </button>
            </div>
          </div>
        </div>

        {/* 右侧：订单草稿预览区 */}
        <div className="w-[380px] flex-shrink-0 flex flex-col bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2">
              <ClipboardList size={18} className="text-primary-600" />
              订单信息预览
            </h2>
            {hasDraft && (
              <span className="text-xs text-gray-400" title="AI 提取置信度（0-100%）">
                置信度 {Math.round(confidence * 100)}%
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={draftPanelRef}>
            {!hasDraft && (
              <div className="text-center py-12 text-gray-400 text-sm">
                <ClipboardList size={40} className="mx-auto mb-3 text-gray-200" />
                AI 提取的订单信息将显示在这里
                <br />
                发送需求描述后自动生成
              </div>
            )}

            {hasDraft && (
              <>
                {/* 缺失关键字段提醒 */}
                {missingFields.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>尚未提取到：{missingFields.join('、')}。可在对话中补充，或直接在下方手动填写。</span>
                  </div>
                )}
                {/* 非标准需求警示 */}
                {activeNonStandard.length > 0 && (
                  <div className="space-y-1.5">
                    {activeNonStandard.map((n, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                        <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                        <span>非标准需求：<b>{n.value}</b>（{n.reason}）</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* 标准配置命中 */}
                {draftMeta && draftMeta.matchedFields.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                    <span>已匹配标准配置：材质/工艺/款式中的 {draftMeta.matchedFields.length} 项</span>
                  </div>
                )}

                {/* 款式（下拉，标准款式列表） */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    产品款式{activeNonStandard.some((n) => n.field === 'productStyle') && <span className="text-orange-500 ml-1">（非标准，请人工确认）</span>}
                  </label>
                  <Select
                    value={draft.productStyle || undefined}
                    onChange={(v) => updateDraftField('productStyle', v)}
                    placeholder="选择款式"
                    showSearch
                    optionFilterProp="label"
                    options={styleOptions.map((s) => ({ value: s.value, label: s.label }))}
                    className="w-full"
                    allowClear
                  />
                </div>

                {/* 材质 / 工艺（AutoComplete，标准选项建议 + 自由输入） */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    布料材质{activeNonStandard.some((n) => n.field === 'fabricMaterial') && <span className="text-orange-500 ml-1">（非标准，请人工确认）</span>}
                  </label>
                  <AutoComplete
                    value={draft.fabricMaterial}
                    onChange={(v) => updateDraftField('fabricMaterial', v)}
                    placeholder="标准材质名称或自定义"
                    options={standardProcessOptions.map((p) => ({ value: p }))}
                    className="w-full"
                    filterOption={(input, option) =>
                      String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    印刷工艺{activeNonStandard.some((n) => n.field === 'process') && <span className="text-orange-500 ml-1">（非标准，请人工确认）</span>}
                  </label>
                  <AutoComplete
                    value={draft.process}
                    onChange={(v) => updateDraftField('process', v)}
                    placeholder="标准工艺名称（多个用 + 拼接）"
                    options={standardProcessOptions.map((p) => ({ value: p }))}
                    className="w-full"
                    filterOption={(input, option) =>
                      String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </div>

                {/* 其余字段 */}
                {DRAFT_FIELDS.map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input
                      value={draft[key]}
                      onChange={(e) => updateDraftField(key, e.target.value)}
                      placeholder={placeholder}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
                    />
                  </div>
                ))}

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">备注</label>
                  <textarea
                    value={draft.remark}
                    onChange={(e) => updateDraftField('remark', e.target.value)}
                    placeholder="AI 提取的其他重要信息，可编辑"
                    rows={3}
                    className="w-full resize-none border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
                  />
                </div>

                {/* 在线表格填充明细（AI tableCells，可逐项移除） */}
                {draft.tableCells.length > 0 && (
                  <div className="border border-gray-100 rounded-lg">
                    <div className="px-3 py-2 text-xs font-medium text-gray-600 flex items-center gap-1.5 border-b border-gray-100">
                      <Table2 size={13} />
                      在线表格填充明细（{draft.tableCells.length} 项，确认后自动填入表格对应单元格）
                    </div>
                    <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                      {draft.tableCells.map((c, i) => (
                        <div key={`${c.row}|${c.col}`} className="flex items-center justify-between gap-2 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
                          <span><b className="text-gray-700">{c.row}</b> · {c.col} = <span className="text-primary-700 font-medium">{String(c.value)}</span></span>
                          <button
                            onClick={() => setDraft((prev) => ({ ...prev, tableCells: prev.tableCells.filter((_, j) => j !== i) }))}
                            className="text-gray-300 hover:text-red-500 flex-shrink-0"
                            title="移除该项（不填入表格）"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 标准配置参考 */}
                {draftMeta && draftMeta.standardOptions.costItems.length > 0 && (
                  <details className="text-xs border border-gray-100 rounded-lg">
                    <summary className="cursor-pointer px-3 py-2 text-gray-500 flex items-center gap-1.5 select-none">
                      <Info size={13} />
                      标准配置参考（产品成本项配置）
                    </summary>
                    <div className="px-3 pb-2 space-y-1.5">
                      {draftMeta.standardOptions.costItems.map((c, i) => (
                        <div key={i} className="text-gray-500">
                          <span className="font-medium text-gray-600">{c.name}：</span>
                          {c.processes.length > 0 ? c.processes.join('、') : '（未配置可选工艺）'}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>

          {/* 确认操作 */}
          {hasDraft && (
            <div className="border-t border-gray-100 p-3">
              <button
                onClick={confirmCreateOrder}
                disabled={!canCreateQuote}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                title={!canCreateQuote ? '缺少订单新增权限（quotes:create）' : '跳转新建订单页并自动填充以下信息'}
              >
                确认并创建订单
                <ArrowRight size={16} />
              </button>
              {!canCreateQuote && (
                <p className="text-xs text-gray-400 mt-1.5 text-center">缺少「订单-新增」权限，无法创建订单</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
