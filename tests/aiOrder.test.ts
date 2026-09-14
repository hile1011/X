/**
 * AI 智能下单服务层（api/services/aiOrder.ts）纯函数单元测试
 *
 * 覆盖：
 *  - buildSystemPrompt：标准配置（产品成本项+工艺）与款式列表注入、空配置兜底
 *  - buildAnalyzeMessages：历史裁剪、图片校验（数量/大小/格式）、空输入拒绝
 *  - parseOrderDraft：标准 JSON / markdown 围栏 / 前后缀杂文 / 非法 JSON /
 *    字段类型归一（number→string、非法类型归空串）
 *  - matchStandardOptions：标准材质/工艺包含匹配（含组合工艺）、款式 code/名称映射、
 *    非标准标识、关键字段缺失清单、无配置时不误报
 *  - 前端 AiOrderChat.mergeDraft：多轮草稿合并（非空覆盖、空值保留）
 */
import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  buildAnalyzeMessages,
  parseOrderDraft,
  matchStandardOptions,
  extractCustomerName,
  EMPTY_AI_ORDER_DRAFT,
  MAX_IMAGES_PER_REQUEST,
  type AiStyleOption,
  type ChatMessage,
} from '../api/services/aiOrder'
import type { ProductCostItem } from '../api/types/index'
import { mergeDraft } from '../src/pages/AiOrderChat'

// ─── 测试数据 ───────────────────────────────────────────────

const costItems: ProductCostItem[] = [
  {
    id: 'pci-1',
    name: '布料',
    sortOrder: 1,
    createdAt: '',
    updatedAt: '',
    processes: [
      { id: 'pcp-1', costItemId: 'pci-1', name: '10安涤棉', cost: 5, formula: '', features: '常规面料', remark: '', customValues: {}, sortOrder: 1, createdAt: '', updatedAt: '' },
      { id: 'pcp-2', costItemId: 'pci-1', name: '12安帆布', cost: 8, formula: '', features: '加厚面料', remark: '', customValues: {}, sortOrder: 2, createdAt: '', updatedAt: '' },
    ],
    fields: [],
  },
  {
    id: 'pci-2',
    name: '印刷',
    sortOrder: 2,
    createdAt: '',
    updatedAt: '',
    processes: [
      { id: 'pcp-3', costItemId: 'pci-2', name: '数码uv印刷', cost: 1, formula: '', features: '', remark: '', customValues: {}, sortOrder: 1, createdAt: '', updatedAt: '' },
      { id: 'pcp-4', costItemId: 'pci-2', name: '烫画', cost: 0.8, formula: '', features: '', remark: '', customValues: {}, sortOrder: 2, createdAt: '', updatedAt: '' },
    ],
    fields: [],
  },
]

const styles: AiStyleOption[] = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '5', label: '手提连底高级拼接袋' },
]

// ============================================================
// buildSystemPrompt
// ============================================================
describe('buildSystemPrompt', () => {
  it('注入成本项配置（成本项名 + 工艺名 + 标准价格 + 工艺特点）', () => {
    const prompt = buildSystemPrompt(costItems, styles)
    expect(prompt).toContain('布料')
    expect(prompt).toContain('10安涤棉（5元，常规面料）')
    expect(prompt).toContain('12安帆布（8元，加厚面料）')
    expect(prompt).toContain('印刷')
    expect(prompt).toContain('数码uv印刷（1元）')
    expect(prompt).toContain('烫画')
  })

  it('注入在线表格结构与 tableCells 填充规则', () => {
    const prompt = buildSystemPrompt(costItems, styles)
    expect(prompt).toContain('在线表格结构')
    expect(prompt).toContain('规格试算区')
    expect(prompt).toContain('成本计算区')
    expect(prompt).toContain('tableCells')
    expect(prompt).toContain('禁止填写公式列')
  })

  it('注入款式列表（名称 + code）', () => {
    const prompt = buildSystemPrompt(costItems, styles)
    expect(prompt).toContain('无底无侧普通袋（code: 1）')
    expect(prompt).toContain('手提连底高级拼接袋（code: 5）')
  })

  it('空成本项配置时输出兜底文案（不崩溃）', () => {
    const prompt = buildSystemPrompt([], styles)
    expect(prompt).toContain('暂无配置')
  })

  it('包含输出 JSON 格式要求与优先匹配标准配置规则', () => {
    const prompt = buildSystemPrompt(costItems, styles)
    expect(prompt).toContain('优先匹配标准配置')
    expect(prompt).toContain('"reply"')
    expect(prompt).toContain('"draft"')
  })
})

// ============================================================
// buildAnalyzeMessages
// ============================================================
describe('buildAnalyzeMessages', () => {
  const system = 'system-prompt'
  const validImage = 'data:image/jpeg;base64,xxxx'

  it('组装 system + 历史 + 用户消息（文字+图片）', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '已提取' },
    ]
    const messages = buildAnalyzeMessages(system, history, '要做5000个袋子', [validImage])
    expect(messages).toHaveLength(4)
    expect((messages[0] as any).role).toBe('system')
    expect((messages[1] as any).content).toBe('第一轮')
    expect((messages[3] as any).role).toBe('user')
    const parts = (messages[3] as any).content
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'text', text: '要做5000个袋子' })
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: validImage } })
  })

  it('历史仅保留最近 6 轮（12 条）', () => {
    const history: ChatMessage[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg-${i}`,
    }))
    const messages = buildAnalyzeMessages(system, history, 'hi', [])
    // system + 12 条历史 + 1 条当前 = 14
    expect(messages).toHaveLength(14)
    expect((messages[1] as any).content).toBe('msg-18') // 30-12=18 起
  })

  it('图片数量超限（>4 张）抛错', () => {
    expect(() => buildAnalyzeMessages(system, [], 'hi', [validImage, validImage, validImage, validImage, validImage]))
      .toThrow(`参考图片最多 ${MAX_IMAGES_PER_REQUEST} 张`)
  })

  it('非法图片格式（非 data:image/ 前缀）抛错', () => {
    expect(() => buildAnalyzeMessages(system, [], 'hi', ['https://example.com/a.jpg']))
      .toThrow('图片格式无效')
  })

  it('无文字且无图片抛错', () => {
    expect(() => buildAnalyzeMessages(system, [], '  ', [])).toThrow('请输入文字描述或上传参考图片')
  })

  it('仅图片（无文字）也允许发送', () => {
    const messages = buildAnalyzeMessages(system, [], '', [validImage])
    const parts = (messages[1] as any).content
    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe('image_url')
  })
})

// ============================================================
// parseOrderDraft
// ============================================================
describe('parseOrderDraft', () => {
  it('标准 JSON：解析 reply/draft/confidence', () => {
    const raw = JSON.stringify({
      reply: '已提取订单信息',
      confidence: 0.9,
      draft: {
        customerName: 'XX公司',
        productStyle: '3',
        fabricMaterial: '10安涤棉',
        process: '数码uv印刷+烫画',
        quantity: '5000',
      },
    })
    const parsed = parseOrderDraft(raw)!
    expect(parsed.reply).toBe('已提取订单信息')
    expect(parsed.confidence).toBe(0.9)
    expect(parsed.draft!.customerName).toBe('XX公司')
    expect(parsed.draft!.productStyle).toBe('3')
    expect(parsed.draft!.process).toBe('数码uv印刷+烫画')
    // 未提供的字段归空串
    expect(parsed.draft!.boxSpec).toBe('')
    expect(parsed.draft!.remark).toBe('')
  })

  it('markdown 围栏包裹的 JSON 可解析', () => {
    const raw = '```json\n' + JSON.stringify({ reply: 'ok', draft: { quantity: 100 } }) + '\n```'
    const parsed = parseOrderDraft(raw)!
    expect(parsed.draft!.quantity).toBe('100')
  })

  it('JSON 前后有杂文时可截取大括号片段解析', () => {
    const raw = '好的，以下是分析结果：\n' + JSON.stringify({ reply: 'ok', draft: { quantity: 3000 } }) + '\n以上仅供参考。'
    const parsed = parseOrderDraft(raw)!
    expect(parsed.draft!.quantity).toBe('3000')
  })

  it('number 类型字段归一为字符串', () => {
    const raw = JSON.stringify({ reply: 'ok', draft: { quantity: 5000, unitPrice: 3.5 } })
    const parsed = parseOrderDraft(raw)!
    expect(parsed.draft!.quantity).toBe('5000')
    expect(parsed.draft!.unitPrice).toBe('3.5')
  })

  it('非法字段类型（对象/数组/布尔）归空串', () => {
    const raw = JSON.stringify({ reply: 'ok', draft: { quantity: { a: 1 }, remark: ['x'], boxSpec: true } })
    const parsed = parseOrderDraft(raw)!
    expect(parsed.draft!.quantity).toBe('')
    expect(parsed.draft!.remark).toBe('')
    expect(parsed.draft!.boxSpec).toBe('')
  })

  it('无 draft 字段时返回 null draft（reply 保留）', () => {
    const parsed = parseOrderDraft(JSON.stringify({ reply: '仅回复无草稿' }))!
    expect(parsed.reply).toBe('仅回复无草稿')
    expect(parsed.draft).toBeNull()
  })

  it('非法 JSON 返回 null', () => {
    expect(parseOrderDraft('这不是JSON')).toBeNull()
    expect(parseOrderDraft('')).toBeNull()
  })

  it('confidence 超界裁剪到 [0,1]', () => {
    const parsed = parseOrderDraft(JSON.stringify({ reply: 'ok', confidence: 5, draft: {} }))!
    expect(parsed.confidence).toBe(1)
    const parsed2 = parseOrderDraft(JSON.stringify({ reply: 'ok', confidence: -2, draft: {} }))!
    expect(parsed2.confidence).toBe(0)
  })

  it('tableCells：合法项解析（number/string 值均保留）', () => {
    const raw = JSON.stringify({
      reply: 'ok',
      draft: {
        quantity: '5000',
        tableCells: [
          { row: '成品', col: '数量', value: 5000 },
          { row: '正反面', col: '克重', value: 340 },
          { row: '正反面', col: '布料价格', value: '5.2' },
        ],
      },
    })
    const parsed = parseOrderDraft(raw)!
    expect(parsed.draft!.tableCells).toHaveLength(3)
    expect(parsed.draft!.tableCells[0]).toEqual({ row: '成品', col: '数量', value: 5000 })
    expect(parsed.draft!.tableCells[2].value).toBe('5.2')
  })

  it('tableCells：非法项丢弃（空行/空列/空值/非对象），重复单元格取首个', () => {
    const raw = JSON.stringify({
      reply: 'ok',
      draft: {
        tableCells: [
          { row: '', col: '克重', value: 340 },          // 空行标签
          { row: '正反面', col: '', value: 340 },        // 空列名
          { row: '正反面', col: '克重', value: '' },     // 空值
          { row: '正反面', col: '克重', value: NaN },    // 非有限数字 → JSON 序列化为 null
          'not-an-object',                               // 非对象
          { row: '手提', col: '宽', value: 2.5 },        // 合法
          { row: '正反面', col: '克重', value: 340 },    // 合法（首个有效克重）
          { row: '正反面', col: '克重', value: 999 },    // 重复（保留首个 340）
        ],
      },
    })
    const parsed = parseOrderDraft(raw)!
    expect(parsed.draft!.tableCells).toEqual([
      { row: '手提', col: '宽', value: 2.5 },
      { row: '正反面', col: '克重', value: 340 },
    ])
  })

  it('tableCells 缺失时默认空数组', () => {
    const parsed = parseOrderDraft(JSON.stringify({ reply: 'ok', draft: { quantity: '100' } }))!
    expect(parsed.draft!.tableCells).toEqual([])
  })
})

// ============================================================
// matchStandardOptions
// ============================================================
describe('matchStandardOptions', () => {
  it('标准材质/工艺命中 matchedFields（含组合工艺）', () => {
    const draft = {
      ...EMPTY_AI_ORDER_DRAFT,
      fabricMaterial: '10安涤棉新本色',        // 包含标准名「10安涤棉」
      process: '数码uv印刷+烫画',             // 组合工艺，两项均标准
      productStyle: '3',
      quantity: '5000',
      customerName: 'XX公司',
      productSpec: '40*35*10cm',
    }
    const result = matchStandardOptions(draft, costItems, styles)
    expect(result.matchedFields).toContain('fabricMaterial')
    expect(result.matchedFields).toContain('process')
    expect(result.matchedFields).toContain('productStyle')
    expect(result.nonStandard).toHaveLength(0)
    expect(result.missingFields).toHaveLength(0)
    // 款式 code 原样保留
    expect(draft.productStyle).toBe('3')
  })

  it('非标准材质/工艺进入 nonStandard 明细', () => {
    const draft = {
      ...EMPTY_AI_ORDER_DRAFT,
      fabricMaterial: '真皮',
      process: '刺绣',
    }
    const result = matchStandardOptions(draft, costItems, styles)
    expect(result.matchedFields).not.toContain('fabricMaterial')
    const fields = result.nonStandard.map((n) => n.field)
    expect(fields).toContain('fabricMaterial')
    expect(fields).toContain('process')
    expect(result.nonStandard[0].reason).toContain('产品成本项配置')
  })

  it('款式名称自动映射为 code', () => {
    const draft = { ...EMPTY_AI_ORDER_DRAFT, productStyle: '有底有侧普通袋' }
    const result = matchStandardOptions(draft, costItems, styles)
    expect(draft.productStyle).toBe('3')
    expect(result.matchedFields).toContain('productStyle')
  })

  it('未匹配款式进入 nonStandard', () => {
    const draft = { ...EMPTY_AI_ORDER_DRAFT, productStyle: '麻布袋' }
    const result = matchStandardOptions(draft, costItems, styles)
    expect(result.nonStandard.some((n) => n.field === 'productStyle')).toBe(true)
  })

  it('关键字段缺失进入 missingFields（中文名）', () => {
    const draft = { ...EMPTY_AI_ORDER_DRAFT, quantity: '1000' } // 仅数量
    const result = matchStandardOptions(draft, costItems, styles)
    expect(result.missingFields).toContain('客户名称')
    expect(result.missingFields).toContain('产品款式')
    expect(result.missingFields).toContain('规格尺寸')
    expect(result.missingFields).toContain('布料材质')
    expect(result.missingFields).toContain('印刷工艺')
    expect(result.missingFields).not.toContain('数量')
  })

  it('无成本项配置时不误报非标准（空配置池跳过校验）', () => {
    const draft = { ...EMPTY_AI_ORDER_DRAFT, fabricMaterial: '任意材质', process: '任意工艺' }
    const result = matchStandardOptions(draft, [], styles)
    expect(result.nonStandard.filter((n) => n.field !== 'productStyle')).toHaveLength(0)
  })

  it('draft 为 null 时仅返回标准选项池', () => {
    const result = matchStandardOptions(null, costItems, styles)
    expect(result.matchedFields).toHaveLength(0)
    expect(result.nonStandard).toHaveLength(0)
    expect(result.missingFields).toHaveLength(0)
    expect(result.standardOptions.costItems).toHaveLength(2)
    expect(result.standardOptions.styles).toEqual(styles)
  })

  it('standardOptions 汇总成本项配置（名称+工艺列表）', () => {
    const result = matchStandardOptions(null, costItems, styles)
    expect(result.standardOptions.costItems[0]).toEqual({ name: '布料', processes: ['10安涤棉', '12安帆布'] })
    expect(result.standardOptions.costItems[1]).toEqual({ name: '印刷', processes: ['数码uv印刷', '烫画'] })
  })
})

// ============================================================
// 前端 mergeDraft（多轮草稿合并）
// ============================================================
describe('AiOrderChat.mergeDraft（多轮草稿合并）', () => {
  it('非空字段覆盖旧值，空字段保留旧值', () => {
    const base = { ...EMPTY_AI_ORDER_DRAFT, customerName: '旧客户', quantity: '1000', remark: '旧备注' }
    const incoming = { ...EMPTY_AI_ORDER_DRAFT, customerName: '新客户', quantity: '' }
    const merged = mergeDraft(base, incoming)
    expect(merged.customerName).toBe('新客户')   // 非空覆盖
    expect(merged.quantity).toBe('1000')          // 空保留
    expect(merged.remark).toBe('旧备注')          // 未提供保留
  })

  it('incoming 为 null 时原样返回', () => {
    const base = { ...EMPTY_AI_ORDER_DRAFT, quantity: '1000' }
    expect(mergeDraft(base, null)).toEqual(base)
  })

  it('tableCells 按「行|列」键合并：新值覆盖同位置，不同位置累加', () => {
    const base = {
      ...EMPTY_AI_ORDER_DRAFT,
      tableCells: [
        { row: '成品', col: '数量', value: 1000 },
        { row: '正反面', col: '克重', value: 340 },
      ],
    }
    const incoming = {
      ...EMPTY_AI_ORDER_DRAFT,
      tableCells: [
        { row: '成品', col: '数量', value: 5000 },       // 覆盖旧值
        { row: '手提', col: '宽', value: 2.5 },           // 新位置累加
      ],
    }
    const merged = mergeDraft(base, incoming)
    expect(merged.tableCells).toHaveLength(3)
    const qty = merged.tableCells.find((c) => c.row === '成品' && c.col === '数量')
    expect(qty?.value).toBe(5000)
    const gram = merged.tableCells.find((c) => c.row === '正反面' && c.col === '克重')
    expect(gram?.value).toBe(340)
    expect(merged.tableCells.some((c) => c.row === '手提' && c.col === '宽')).toBe(true)
  })

  it('tableCells 含非法项（空行标签）时跳过不合并', () => {
    const base = { ...EMPTY_AI_ORDER_DRAFT, tableCells: [{ row: '成品', col: '数量', value: 1000 }] }
    const incoming = {
      ...EMPTY_AI_ORDER_DRAFT,
      tableCells: [
        { row: '', col: '克重', value: 340 },
        { row: '手提', col: '高', value: 65 },
      ],
    }
    const merged = mergeDraft(base, incoming)
    expect(merged.tableCells).toHaveLength(2)
    expect(merged.tableCells.every((c) => c.row !== '')).toBe(true)
  })
})

// ============================================================
// extractCustomerName - 客户名称正则兜底
// ============================================================
describe('extractCustomerName（客户名称兜底提取）', () => {
  it('「客户是XX」表述提取（AI 漏提取兜底场景）', () => {
    expect(extractCustomerName('5000个袋子，客户是二次测试，40*35*10cm')).toBe('二次测试')
  })

  it('「客户名称：XX」冒号表述（中英文冒号）', () => {
    expect(extractCustomerName('客户名称：杭州贸易')).toBe('杭州贸易')
    expect(extractCustomerName('客户名称:上海实业')).toBe('上海实业')
  })

  it('提取值含公司后缀时完整保留', () => {
    expect(extractCustomerName('3000个，客户是深圳XX科技有限公司，烫画')).toBe('深圳XX科技有限公司')
  })

  it('无客户表述返回空串（不误提取）', () => {
    expect(extractCustomerName('5000个袋子40*35*10cm数码uv印刷')).toBe('')
    expect(extractCustomerName('')).toBe('')
  })

  it('句尾标点裁剪', () => {
    expect(extractCustomerName('客户是测试公司。')).toBe('测试公司')
    expect(extractCustomerName('客户是A公司,数量5000')).toBe('A公司')
  })
})
