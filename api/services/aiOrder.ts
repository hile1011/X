/**
 * AI 智能下单服务层（v35：ai-order 模块）
 *
 * 职责：
 *  - 基于产品成本项配置（材质/印刷工艺等标准选项）+ 款式列表，构建 AI 系统提示词
 *  - 调用阿里云 DashScope（OpenAI 兼容接口，通义千问 Qwen-VL 视觉模型），
 *    综合分析用户文字描述与参考图片，提取帆布袋定制订单关键信息
 *  - 解析 AI 返回的结构化 JSON 草稿，并做标准配置匹配（非标准需求明确标识）
 *
 * 纯函数（buildSystemPrompt / buildAnalyzeMessages / parseOrderDraft /
 * matchStandardOptions）导出供单元测试覆盖（tests/aiOrder.test.ts），
 * 网络调用集中在 callDashScope。
 */
import type { ProductCostItem } from '../types/index.js'

/** AI 提取的订单草稿（字段与前端 BagQuote OrderInfo 对齐，均为字符串） */
export interface AiOrderDraft {
  customerName: string
  productStyle: string
  productSpec: string
  fabricMaterial: string
  process: string
  handleMaterial: string
  handleSpec: string
  quantity: string
  boxSpec: string
  unitPrice: string
  sampleFee: string
  remark: string
  /** 在线表格单元格填充（行标签+列名定位，AI 直接生成细粒度表格输入值） */
  tableCells: AiTableCell[]
}

/** AI 输出的表格单元格：row=行标签（成品/正反面/手提…），col=列名关键字（数量/宽/克重/布料价格…） */
export interface AiTableCell {
  row: string
  col: string
  value: string | number
}

export const EMPTY_AI_ORDER_DRAFT: AiOrderDraft = {
  customerName: '',
  productStyle: '',
  productSpec: '',
  fabricMaterial: '',
  process: '',
  handleMaterial: '',
  handleSpec: '',
  quantity: '',
  boxSpec: '',
  unitPrice: '',
  sampleFee: '',
  remark: '',
  tableCells: [],
}

/** 款式选项（与前端 productStyles 服务一致：value=产品code/产品id，label=产品名） */
export interface AiStyleOption {
  value: string
  label: string
}

/** 标准配置匹配结果（后端二次校验，不完全信任 AI 的自评） */
export interface StandardMatchResult {
  /** 草稿中命中标准配置的字段名列表 */
  matchedFields: string[]
  /** 非标准字段明细（含原因），供前端黄色警示标识与人工干预 */
  nonStandard: Array<{ field: string; value: string; reason: string }>
  /** 尚未提取到的关键字段（前端提示用户补充） */
  missingFields: string[]
  /** 标准选项池（供前端下拉建议） */
  standardOptions: {
    /** 产品成本项配置全量结构（成本项→可选工艺），用于前端按成本项分组展示 */
    costItems: Array<{ name: string; processes: string[] }>
    /** 款式选项（value=code，label=名称） */
    styles: Array<{ value: string; label: string }>
  }
}

/** 草稿关键业务字段中文名（缺失提示与非标准标识共用；tableCells 为结构化数组不参与） */
export const DRAFT_FIELD_LABELS: Record<Exclude<keyof AiOrderDraft, 'tableCells'>, string> = {
  customerName: '客户名称',
  productStyle: '产品款式',
  productSpec: '规格尺寸',
  fabricMaterial: '布料材质',
  process: '印刷工艺',
  handleMaterial: '提手材质',
  handleSpec: '提带规格',
  quantity: '数量',
  boxSpec: '装箱规格',
  unitPrice: '单价',
  sampleFee: '打样费',
  remark: '备注',
}

/** 视为「关键」的字段：缺失时提示用户补充（unitPrice/sampleFee/boxSpec/remark 不强制） */
const CRITICAL_FIELDS: Array<Exclude<keyof AiOrderDraft, 'tableCells'>> = [
  'customerName', 'productStyle', 'productSpec', 'fabricMaterial', 'process', 'quantity',
]

/**
 * 构建系统提示词：注入产品成本项配置（标准材质/工艺选项）+ 款式列表，
 * 要求 AI 仅输出 JSON（reply + draft + confidence），并优先匹配标准配置。
 */
export function buildSystemPrompt(costItems: ProductCostItem[], styles: AiStyleOption[]): string {
  // 成本项配置摘要：成本项名 → 可选工艺列表（含标准价格与工艺特点，价格供 tableCells 成本区填充参考）
  const costLines = costItems.map((item) => {
    const processes = item.processes
      .map((p) => {
        const parts = [p.name]
        if (typeof p.cost === 'number' && Number.isFinite(p.cost) && p.cost > 0) parts.push(`${p.cost}元`)
        if (p.features) parts.push(p.features)
        return parts.length > 1 ? `${parts[0]}（${parts.slice(1).join('，')}）` : parts[0]
      })
      .join('、')
    return `- ${item.name}：${processes || '（未配置可选工艺）'}`
  })
  const costSection = costLines.length > 0
    ? costLines.join('\n')
    : '-（暂无配置）'

  const styleSection = styles.map((s) => `- ${s.label}（code: ${s.value}）`).join('\n')

  return `你是帆布袋定制订单系统的智能下单助手。用户会用文字描述和/或参考图片表达帆布袋定制需求，你需要提取订单关键信息并生成订单草稿。

# 系统标准配置（产品成本项配置页面维护，含标准价格）

${costSection}

# 系统产品款式列表

${styleSection}

# 在线表格结构（订单试算表，分两个区域）

规格试算区（上半部）：
- 列：数量、宽(CM)、高(CM)、底(CM)、宽出血、高出血、切片宽、切片高、布料门幅、克重、门幅剩余废料、布料米数(M)、门幅最大面数(个)、总重量
- 行：成品（整袋数量与尺寸）+ 部件行（正反面/手提/侧底/底部/阴阳手提等，按款式不同）

成本计算区（下半部）：
- 列：加工费(元/个)、印刷双面（元/个）、布料价格、布料成本（元）、额外工艺成本、包装费、运费单价(元)、损耗系数、参考卖价
- 行：各部件成本行（与规格区部件同名）+ 汇总 + 参考卖价 + 利润

# 提取规则

1. **优先匹配标准配置**：布料材质、印刷工艺等必须优先从上方「系统标准配置」中选择最接近的选项，使用标准名称原文；标准价格（如布料价格、印刷费）优先采用配置中的价格填入 tableCells。
2. **组合工艺**：如用户需求多个工艺（如"正面数码uv印刷+背面烫画"），按标准名称用"+"拼接填入 process。
3. **款式匹配**：productStyle 必须从上方款式列表中选择最匹配的一项，输出对应的 code 值（纯数字或 id）。
4. **图片分析**：参考图片可识别袋型结构（有底/无底、有侧/无侧、提手样式）、印刷位置、颜色等，结合文字描述综合判断。
5. **非标准需求**：用户需求无法匹配标准配置时，如实填写用户原话，并在 reply 中明确说明该项为非标准需求，建议用户确认后人工调整。
6. **不臆造**：用户未提及的字段填空字符串，不要编造。数量、尺寸等单位尽量规范化（数量纯数字，尺寸如 40*35*10cm）。
7. **客户名称必须提取**：消息中出现「客户是XX」「客户：XX」「给XX做」「XX订购/定制」等表述时，必须将 XX 提取到 customerName（去除"是/："等连接词，保留公司名原文）。禁止漏提取已明确给出的客户名称。
8. **多轮对话**：结合历史对话持续完善草稿，用户补充的信息覆盖旧值；历史草稿中已提取的字段（如客户名称）在新一轮输出中必须原样保留，不得丢弃。
9. **tableCells 表格填充**：将能确定的输入值按「行标签+列名」写入 tableCells，生成更细致的订单：
   - **强制输出**：只要消息中含数量或规格尺寸，tableCells 必须包含成品行的数量/宽/高/底，不得省略
   - 成品行：数量、宽、高、底
   - 规格区各部件行（正反面/手提/侧底/底部等，按款式结构逐行输出）：克重、布料门幅、宽出血、高出血（同材质部件行克重/门幅相同；常见参考：10安布料克重约340g门幅154cm、12安约450g门幅154cm）
   - 手提行：宽、高（提带宽度与长度，如 2.5cm 宽提手）
   - 成本区各部件行：布料价格（标准配置价格）、印刷双面（印刷工艺价格）、加工费、包装费、运费单价、损耗系数（用户提及或标准配置有价才填）
   - **禁止填写公式列**（切片宽、切片高、布料米数、门幅剩余废料、门幅最大面数、总重量、带刀手提条数、布料成本、参考卖价、含税价等）——系统公式自动计算
   - 不确定的单元格不要填，宁缺毋滥
10. **tableCells 定位格式**：row 用行标签原文（成品/正反面/手提/侧底/底部），col 用列名关键字（数量/宽/高/底/克重/布料门幅/宽出血/高出血/布料价格/印刷双面/加工费/包装费/运费单价/损耗系数）。value 用数字类型（不带引号）。
11. **输出完整性自查**：输出 JSON 前逐项自查——customerName 是否漏提取？tableCells 是否包含成品行数量/宽/高/底？规格是否与消息一致？自查不通过必须修正后再输出。

# 输出格式（严格 JSON，不要 markdown 代码块外的任何文字）

{
  "reply": "给用户的中文回复：说明已提取的信息、匹配到的标准配置、非标准项和缺失的关键信息，引导用户补充",
  "draft": {
    "customerName": "客户名称，未提及填空串",
    "productStyle": "款式 code，未识别填空串",
    "productSpec": "规格尺寸，如 40*35*10cm",
    "fabricMaterial": "布料材质（优先标准配置名称）",
    "process": "印刷工艺（标准名称，多个用+拼接）",
    "handleMaterial": "提手材质/方式",
    "handleSpec": "提带规格，如 2.5cm宽",
    "quantity": "数量，纯数字字符串",
    "boxSpec": "装箱规格，如 50pcs/箱",
    "unitPrice": "单价，未提及填空串",
    "sampleFee": "打样费，未提及填空串",
    "remark": "其他需要备注的重要信息",
    "tableCells": [
      { "row": "成品", "col": "数量", "value": 5000 },
      { "row": "成品", "col": "宽", "value": 40 },
      { "row": "正反面", "col": "克重", "value": 340 },
      { "row": "正反面", "col": "布料门幅", "value": 154 },
      { "row": "手提", "col": "宽", "value": 2.5 },
      { "row": "正反面", "col": "布料价格", "value": 5.2 },
      { "row": "正反面", "col": "印刷双面", "value": 0.45 }
    ]
  },
  "confidence": 0.85
}`
}

/** 单条对话消息（前端传入的多轮历史） */
export interface ChatMessage {
  role: 'user' | 'assistant'
  /** 用户消息为纯文本；历史 assistant 消息为纯文本（reply 字段内容） */
  content: string
  /** 仅用户消息可携带参考图片（base64 dataURL，如 data:image/jpeg;base64,...） */
  images?: string[]
}

/** DashScope 消息格式（OpenAI 兼容）：本轮用户消息支持 text+image_url 混合内容，历史消息为纯文本 */
type DashScopeMessage =
  | { role: 'system' | 'assistant' | 'user'; content: string }
  | { role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }

/** 单张参考图片大小上限（base64 dataURL 字符长度，约对应 1.5MB 原图） */
export const MAX_IMAGE_DATAURL_LENGTH = 2 * 1024 * 1024
/** 单次请求最多参考图片数 */
export const MAX_IMAGES_PER_REQUEST = 4
/** 携带的历史消息最大轮数（防止 token 超限） */
export const MAX_HISTORY_ROUNDS = 6

/**
 * 组装 DashScope 消息数组：系统提示词 + 最近 N 轮历史 + 本轮用户消息（文字 + 图片）。
 * 图片超限（数量/大小）时直接抛错，由路由层转为 400 返回。
 */
export function buildAnalyzeMessages(
  systemPrompt: string,
  history: ChatMessage[],
  message: string,
  images: string[],
): DashScopeMessage[] {
  if (images.length > MAX_IMAGES_PER_REQUEST) {
    throw new Error(`参考图片最多 ${MAX_IMAGES_PER_REQUEST} 张`)
  }
  for (const img of images) {
    if (typeof img !== 'string' || !img.startsWith('data:image/')) {
      throw new Error('图片格式无效（仅支持 base64 dataURL）')
    }
    if (img.length > MAX_IMAGE_DATAURL_LENGTH) {
      throw new Error('单张参考图片过大（超过约 1.5MB），请压缩后重试')
    }
  }

  const trimmedHistory = history.slice(-MAX_HISTORY_ROUNDS * 2)
  const messages: DashScopeMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const msg of trimmedHistory) {
    // 历史消息不重复携带图片（token 考量，图片仅本轮生效）
    messages.push({ role: msg.role, content: msg.content })
  }

  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
  if (message.trim() !== '') {
    parts.push({ type: 'text', text: message })
  }
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img } })
  }
  if (parts.length === 0) {
    throw new Error('请输入文字描述或上传参考图片')
  }
  messages.push({ role: 'user', content: parts })
  return messages
}

/**
 * 从 AI 返回文本中解析订单草稿 JSON。
 * 容错处理：剥离 markdown 代码块围栏、截取首个 { 到最后一个 } 的片段再 parse。
 * 解析失败返回 null（draft 视为本轮无有效草稿，reply 降级为原文）。
 */
export function parseOrderDraft(raw: string): { reply: string; draft: AiOrderDraft | null; confidence: number } | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let text = raw.trim()
  // 剥离 markdown 代码块围栏（```json ... ```）
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  // 截取最外层大括号片段（防 AI 在 JSON 前后输出说明文字）
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  let parsed: any
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const reply = typeof parsed.reply === 'string' ? parsed.reply : raw
  const confidence = typeof parsed.confidence === 'number'
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0

  // 草稿字段逐一校验：仅接受字符串/数字，其余归为空串
  const d = parsed.draft
  if (typeof d !== 'object' || d === null) {
    return { reply, draft: null, confidence }
  }
  const draft: AiOrderDraft = { ...EMPTY_AI_ORDER_DRAFT }
  for (const key of Object.keys(EMPTY_AI_ORDER_DRAFT) as Array<keyof AiOrderDraft>) {
    if (key === 'tableCells') continue
    const v = d[key]
    if (typeof v === 'string') draft[key] = v.trim()
    else if (typeof v === 'number' && Number.isFinite(v)) draft[key] = String(v)
  }
  // tableCells 数组逐一校验：row/col 非空字符串 + value 为有限 string/number，非法项丢弃
  if (Array.isArray(d.tableCells)) {
    const cells: AiTableCell[] = []
    const seen = new Set<string>()
    for (const c of d.tableCells) {
      if (!c || typeof c !== 'object') continue
      const row = typeof c.row === 'string' ? c.row.trim() : ''
      const col = typeof c.col === 'string' ? c.col.trim() : ''
      if (row === '' || col === '') continue
      let value: string | number | null = null
      if (typeof c.value === 'number' && Number.isFinite(c.value)) value = c.value
      else if (typeof c.value === 'string' && c.value.trim() !== '') value = c.value.trim()
      if (value === null) continue
      const key = `${row}|${col}`
      if (seen.has(key)) continue // 同一单元格重复输出取首个
      seen.add(key)
      cells.push({ row, col, value })
    }
    draft.tableCells = cells
  }
  return { reply, draft, confidence }
}

/**
 * 客户名称正则兜底：AI 偶发漏提取（实测消息含「客户是XX」仍输出空串），
 * 从用户消息中「客户(名称)?(是|:|：)XX」明确表述直接提取，提取失败返回空串。
 */
const CUSTOMER_NAME_RE = /客户(?:名称)?(?:是|：|:)\s*([^\s,，。;；!！?？]+)/

export function extractCustomerName(message: string): string {
  if (typeof message !== 'string' || message === '') return ''
  const m = message.match(CUSTOMER_NAME_RE)
  if (!m) return ''
  return m[1].replace(/[，。,.!！?？;；]+$/, '').trim()
}

/**
 * 标准配置匹配（后端二次校验）：
 *  - fabricMaterial / process 在产品成本项配置的工艺池中做「包含匹配」
 *    （AI 可能输出组合工艺或标准名扩展，如「10安涤棉新本色」包含标准名「10安涤棉」）
 *  - productStyle 在款式列表中校验（AI 输出 code；名称也兼容，映射回 code）
 *  - 关键字段缺失清单
 */
export function matchStandardOptions(
  draft: AiOrderDraft | null,
  costItems: ProductCostItem[],
  styles: AiStyleOption[],
): StandardMatchResult {
  const allProcesses = costItems.flatMap((item) => item.processes.map((p) => p.name))
  const result: StandardMatchResult = {
    matchedFields: [],
    nonStandard: [],
    missingFields: [],
    standardOptions: {
      costItems: costItems.map((item) => ({
        name: item.name,
        processes: item.processes.map((p) => p.name),
      })),
      styles: styles.map((s) => ({ value: s.value, label: s.label })),
    },
  }
  if (!draft) return result

  // 任一标准工艺名出现在字段值中即视为标准（支持「数码uv印刷+烫画」组合）
  const isStandard = (value: string): boolean =>
    allProcesses.some((std) => std !== '' && value.includes(std))

  // 布料材质：仅在成本项配置存在工艺池且字段非空时校验（无配置时不误报）
  if (draft.fabricMaterial) {
    if (allProcesses.length > 0 && !isStandard(draft.fabricMaterial)) {
      result.nonStandard.push({
        field: 'fabricMaterial',
        value: draft.fabricMaterial,
        reason: '未匹配产品成本项配置中的标准布料选项，请人工确认',
      })
    } else {
      result.matchedFields.push('fabricMaterial')
    }
  }
  if (draft.process) {
    if (allProcesses.length > 0 && !isStandard(draft.process)) {
      result.nonStandard.push({
        field: 'process',
        value: draft.process,
        reason: '未匹配产品成本项配置中的标准印刷工艺，请人工确认',
      })
    } else {
      result.matchedFields.push('process')
    }
  }

  // 款式：AI 输出 code 或名称均可，统一映射为 code；无法映射时非标准提示
  if (draft.productStyle) {
    const byCode = styles.find((s) => s.value === draft.productStyle)
    const byLabel = styles.find((s) => s.label === draft.productStyle)
    if (byCode) {
      draft.productStyle = byCode.value
      result.matchedFields.push('productStyle')
    } else if (byLabel) {
      draft.productStyle = byLabel.value
      result.matchedFields.push('productStyle')
    } else {
      result.nonStandard.push({
        field: 'productStyle',
        value: draft.productStyle,
        reason: '未匹配系统款式列表，请人工选择款式',
      })
    }
  }

  // 关键字段缺失清单
  for (const field of CRITICAL_FIELDS) {
    if (!draft[field]) result.missingFields.push(DRAFT_FIELD_LABELS[field])
  }
  return result
}

/** DashScope 响应中提取的首个 choice 消息 */
interface DashScopeResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string; code?: string }
}

/**
 * 调用 DashScope OpenAI 兼容接口（通义千问 Qwen-VL）。
 * 网络层唯一出口；API Key 未配置/调用失败抛出带中文信息的 Error。
 */
export async function callDashScope(messages: DashScopeMessage[]): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY
  if (!apiKey) {
    throw new Error('AI 服务未配置：请在 api/.env 中设置 DASHSCOPE_API_KEY（阿里云百炼/DashScope API Key）')
  }
  const model = process.env.DASHSCOPE_MODEL || 'qwen-vl-max'
  const base = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'

  let resp: Response
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, temperature: 0.3 }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new Error('AI 服务响应超时（90s），请稍后重试')
    throw new Error(`AI 服务网络异常：${err?.message || '无法连接 DashScope'}`)
  }

  let data: DashScopeResponse
  try {
    data = await resp.json() as DashScopeResponse
  } catch {
    throw new Error(`AI 服务响应解析失败（HTTP ${resp.status}）`)
  }
  if (!resp.ok) {
    const msg = data?.error?.message || data?.error?.code || `HTTP ${resp.status}`
    if (resp.status === 401) throw new Error('AI 服务认证失败：DASHSCOPE_API_KEY 无效或已过期')
    if (resp.status === 429) throw new Error('AI 服务限流：请求过于频繁，请稍后重试')
    throw new Error(`AI 服务调用失败：${msg}`)
  }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('AI 服务返回内容为空，请重试')
  }
  return content
}
