/**
 * AI 智能下单 → 在线表格 填充服务（v35）
 *
 * AI 草稿只含表单字段（productSpec 文本如 "40*35*10cm"、quantity 文本如 "5000"），
 * 在线表格的部件行（正反面/侧底/手提…）由模板公式从成品行级联推导
 * （B3='=B2'、C3='=C2'、H3='=F3+C3'、M 列布料米数=CEILING(...) 等），
 * 故只需将 数量/宽/高/底 写入成品行，切片尺寸/布料米数/门幅面数/总重量
 * 及下方成本/报价区全部自动重算。
 *
 * 纯函数（无副作用、不改入参），便于单元测试：
 *   - parseAiTableFill：宽松解析规格文本与数量文本（支持 * × x X 分隔、小数、带单位）
 *   - applyAiFillToTableData：克隆表格数据并写入成品行（动态定位行/列，未解析的字段不覆盖）
 */
import { findRowByLabel, findColByHeader, findHeaderRow } from './tableLocator'
import type { AiTableCell } from '../types'

/** AI 草稿解析结果：null = 未识别，写入时跳过（保留模板默认值） */
export interface AiTableFill {
  quantity: number | null
  width: number | null
  height: number | null
  bottom: number | null
}

/** 规格分隔符：* × x X ＊（全角星号），允许两侧空白 */
const SPEC_SEPARATOR = '\\s*[*\\u00d7\\u00d7xX\\uff0a]\\s*'
/** 数字（整数或小数） */
const NUMBER = '\\d+(?:\\.\\d+)?'
/** 规格文本：宽[分隔]高([分隔]底)?，如 "40*35*10cm"、"40×35"、"38 x 40 x 8CM" */
const SPEC_RE = new RegExp(`(${NUMBER})${SPEC_SEPARATOR}(${NUMBER})(?:${SPEC_SEPARATOR}(${NUMBER}))?`)

/**
 * 宽松解析数量文本："5000"、"5000个"、"约 3,000 个" → 5000 / 3000。
 * 取第一个有效数字（去千分位逗号，含负号识别），非正数/无数字返回 null。
 */
function parseQuantity(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw !== 'string') return null
  const m = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 解析 AI 草稿的规格/数量为表格填充值。
 * 规格支持 2 段（宽*高，底=null 不覆盖）或 3 段（宽*高*底）；
 * 无法解析的字段返回 null，调用方跳过写入。
 */
export function parseAiTableFill(spec: unknown, quantity: unknown): AiTableFill {
  let width: number | null = null
  let height: number | null = null
  let bottom: number | null = null
  if (typeof spec === 'string') {
    const m = spec.match(SPEC_RE)
    if (m) {
      width = Number(m[1])
      height = Number(m[2])
      if (m[3] !== undefined) bottom = Number(m[3])
    }
  }
  return { quantity: parseQuantity(quantity), width, height, bottom }
}

/** 全部字段未识别时无需填充 */
export function isAiTableFillEmpty(fill: AiTableFill): boolean {
  return fill.quantity == null && fill.width == null && fill.height == null && fill.bottom == null
}

/** 默认列索引（表头关键字定位失败时的回退）：数量=1 宽=2 高=3 底=4 */
const DEFAULT_COLS = { quantity: 1, width: 2, height: 3, bottom: 4 }

/**
 * 将解析结果写入表格数据的成品行（返回新数组，不改入参——模板数据为缓存对象禁止原地修改）。
 *
 * 写入规则：
 *   - 行定位：A 列文字 === "成品"；列表头关键字（数量/宽/高/底）动态定位，回退默认列
 *   - 仅覆盖已解析字段（null 保留模板默认值，如 2 段规格不覆盖底）
 *   - 未找到成品行或全部字段为空时原样返回（克隆副本，保持引用语义一致）
 */
export function applyAiFillToTableData(
  data: (string | number | null)[][],
  fill: AiTableFill,
): (string | number | null)[][] {
  const cloned = data.map((row) => (row ? [...row] : row))
  if (isAiTableFillEmpty(fill)) return cloned

  const finishedRow = findRowByLabel(cloned, '成品')
  if (finishedRow < 0) return cloned

  // 表头行（第 0 行）按关键字定位列，未找到（-1）回退默认列（与 tableLocator 定位策略一致）
  const colOf = (keywords: string[], fallback: number): number => {
    const c = findColByHeader(cloned, 0, keywords)
    return c >= 0 ? c : fallback
  }
  const qtyCol = colOf(['数量'], DEFAULT_COLS.quantity)
  const widthCol = colOf(['宽'], DEFAULT_COLS.width)
  const heightCol = colOf(['高'], DEFAULT_COLS.height)
  const bottomCol = colOf(['底'], DEFAULT_COLS.bottom)

  const row = cloned[finishedRow]
  if (row) {
    if (fill.quantity != null) row[qtyCol] = fill.quantity
    if (fill.width != null) row[widthCol] = fill.width
    if (fill.height != null) row[heightCol] = fill.height
    if (fill.bottom != null) row[bottomCol] = fill.bottom
  }
  return cloned
}

// ============================================================
// AI tableCells 单元格级填充（行标签 + 列名关键字 双区动态定位）
// ============================================================

/** 单元格值归一：纯数字字符串转 number（表格数值列参与公式计算），非法返回 null */
function normalizeCellValue(v: string | number): string | number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const s = v.trim()
  const n = Number(s)
  return s !== '' && Number.isFinite(n) ? n : s
}

/** 在 [from, to) 行范围内按行标签查找：先精确匹配，再「行标签包含 AI 输出」模糊匹配 */
function findRowInRange(data: (string | number | null)[][], label: string, from: number, to: number): number {
  for (let r = from; r < to && r < data.length; r++) {
    if (data[r]?.[0] === label) return r
  }
  for (let r = from; r < to && r < data.length; r++) {
    const v = data[r]?.[0]
    if (typeof v === 'string' && v.includes(label)) return r
  }
  return -1
}

/**
 * 应用 AI tableCells 到表格数据（返回新数组，不改入参）。
 *
 * 双区定位：表格分「规格试算区」（表头=第 0 行，行=成品+部件）与「成本计算区」
 * （表头=含"加工费"的行，行=部件成本行）。按列名关键字在两区表头中定位列，
 * 按行标签在对应区范围内定位行；行/列任一找不到则跳过该单元格（AI 幻觉防护）。
 */
export function applyAiTableCellsToTableData(
  data: (string | number | null)[][],
  cells: AiTableCell[],
): (string | number | null)[][] {
  const cloned = data.map((row) => (row ? [...row] : row))
  if (!Array.isArray(cells) || cells.length === 0) return cloned

  const costHeaderRow = findHeaderRow(cloned) // 成本区表头行（含"加工费"），-1 = 无成本区
  for (const cell of cells) {
    if (!cell || typeof cell.row !== 'string' || typeof cell.col !== 'string') continue
    const value = normalizeCellValue(cell.value)
    if (value === null) continue

    // 列定位：先规格区表头（第 0 行），后成本区表头；两区列名区分度高（宽/高/克重 vs 加工费/布料价格）
    let col = findColByHeader(cloned, 0, [cell.col])
    let searchFrom = 1
    let searchTo = costHeaderRow > 0 ? costHeaderRow : cloned.length
    if (col < 0 && costHeaderRow >= 0) {
      col = findColByHeader(cloned, costHeaderRow, [cell.col])
      searchFrom = costHeaderRow + 1
      searchTo = cloned.length
    }
    if (col < 0) continue // 列名无法定位：AI 幻觉或模板无此列，跳过

    const row = findRowInRange(cloned, cell.row.trim(), searchFrom, searchTo)
    if (row < 0) continue // 行标签无法定位：跳过（如款式无该部件）
    const target = cloned[row]
    if (target) target[col] = value
  }
  return cloned
}
