/**
 * 做货流程跟踪表服务层（做货跟踪页）
 *
 * 职责（纯逻辑，无 React 依赖，便于单元测试）：
 *   - 类型定义：ProductionTaskOverviewRow（任务 + 订单摘要，来自 /quotes/production-tasks/overview）
 *   - 多条件筛选：客户名称（多选精确匹配）/ 订单号 / 订单状态 / 日期区间（任务与区间有交集）
 *   - 双重排序：订单按最早任务日期升序（无日期最后）→ 同日期按订单号升序；订单内按 stepOrder
 *   - 双维度展示（甘特图兼容适配）：
 *       · 订单优先（sortOverviewRowsByOrderDim）：订单组按开始日期排序（方向可控，无日期最后），
 *         同日期按订单号升序，订单内按 stepOrder 升序
 *       · 日期优先（groupOverviewRowsByDate）：按各步骤自身的开始日期分组插入分组头行
 *         （同一订单的步骤可散布到多个日期组；组序方向可控，无日期组最后），
 *         组内按订单号升序，订单内按 stepOrder 升序
 *   - 甘特图名称排版：客户智能截断保持简洁、无图占位缩略图、日期分组头徽标
 *   - 拖拽保存 payload 组装（PUT 整体替换需要订单的全量任务）
 *   - 步骤编辑操作（与订单做货流程一致）：修改字段（状态联动）/ 新增 / 删除 / 上移下移
 */
import { parseDate, toDateStr, resolveStatusByActualTimes } from './productionTasks'
import type { ProductionTask, ProductionTaskMaterial } from './productionTasks'

/** 跟踪表总览行（后端 ProductionTaskOverviewRow 的前端形态） */
export interface ProductionTaskOverviewRow extends ProductionTask {
  quoteId: string
  quoteNumber: string
  customerName: string
  quantity: string
  orderStatus: number
  quoteUpdatedAt: string
}

/** 页面筛选条件（客户名称多选 / 订单号 / 订单状态 / 日期区间） */
export interface TrackingFilters {
  customerNames: string[]
  quoteNumber: string
  statuses: number[]
  dateStart: string
  dateEnd: string
}

// ────────────────────────────────────────────────────────────
// 筛选
// ────────────────────────────────────────────────────────────

/** 任务行的代表日期区间：计划优先，缺失回退实际 */
function rowDateRange(row: ProductionTaskOverviewRow): { start: string | null; end: string | null } {
  return {
    start: row.planStart ?? row.actualStart,
    end: row.planEnd ?? row.actualEnd ?? row.planStart ?? row.actualStart,
  }
}

/** 日期区间是否相交（端点相等视为相交；空值视为无界） */
export function rangesOverlap(
  s1: string | null, e1: string | null, s2: string | null, e2: string | null,
): boolean {
  const a = s2 ? parseDate(s2)!.getTime() : -Infinity
  const b = e2 ? parseDate(e2)!.getTime() : Infinity
  const s = s1 ? parseDate(s1)!.getTime() : -Infinity
  const e = e1 ? parseDate(e1)!.getTime() : Infinity
  return !(e < a || s > b)
}

/**
 * 多条件组合筛选（即时生效）：
 *   - 客户名称（多选）：任一选中客户名精确匹配（不区分大小写）；空数组 = 不限
 *   - 订单号：包含匹配（不区分大小写）
 *   - 订单状态：白名单（空数组 = 不限）
 *   - 日期区间：任务代表日期（计划优先，缺失回退实际）与区间有交集；
 *     设置了区间时，完全无日期的任务被排除
 */
export function filterOverviewRows(rows: ProductionTaskOverviewRow[], filters: TrackingFilters): ProductionTaskOverviewRow[] {
  const names = filters.customerNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
  const qn = filters.quoteNumber.trim().toLowerCase()
  const hasDate = Boolean(filters.dateStart || filters.dateEnd)
  return rows.filter((row) => {
    if (names.length > 0 && !names.includes(row.customerName.toLowerCase())) return false
    if (qn && !row.quoteNumber.toLowerCase().includes(qn)) return false
    if (filters.statuses.length > 0 && !filters.statuses.includes(row.orderStatus)) return false
    if (hasDate) {
      const { start, end } = rowDateRange(row)
      if (!start && !end) return false
      if (!rangesOverlap(start, end, filters.dateStart || null, filters.dateEnd || null)) return false
    }
    return true
  })
}

// ────────────────────────────────────────────────────────────
// 排序
// ────────────────────────────────────────────────────────────

/** 订单的最早任务日期（计划/实际开始优先，缺失取结束；无任何日期返回 null） */
export function quoteEarliestDate(rows: ProductionTaskOverviewRow[]): string | null {
  let earliest: string | null = null
  for (const r of rows) {
    const d = r.planStart ?? r.actualStart ?? r.planEnd ?? r.actualEnd
    if (d && (earliest === null || d < earliest)) earliest = d
  }
  return earliest
}

/**
 * 双重排序（默认展示顺序）：
 *   订单按最早任务日期升序（无日期的排最后），同日期按订单号升序；订单内按 stepOrder 升序
 */
export function sortOverviewRows(rows: ProductionTaskOverviewRow[]): ProductionTaskOverviewRow[] {
  const byQuote = new Map<string, ProductionTaskOverviewRow[]>()
  const quoteOrder: string[] = []
  for (const row of rows) {
    if (!byQuote.has(row.quoteId)) {
      byQuote.set(row.quoteId, [])
      quoteOrder.push(row.quoteId)
    }
    byQuote.get(row.quoteId)!.push(row)
  }
  const quoteKeys = quoteOrder.map((quoteId) => {
    const group = byQuote.get(quoteId)!
    return {
      quoteId,
      rows: group,
      earliest: quoteEarliestDate(group),
      // 防御性回退：分组仅在存在任务行时创建，group[0] 恒有值（不可达分支）
      /* v8 ignore next */
      quoteNumber: group[0]?.quoteNumber ?? '',
    }
  })
  quoteKeys.sort((a, b) => {
    // 无最早日期的订单排在最后
    if (a.earliest === null && b.earliest === null) return a.quoteNumber.localeCompare(b.quoteNumber)
    if (a.earliest === null) return 1
    if (b.earliest === null) return -1
    if (a.earliest !== b.earliest) return a.earliest < b.earliest ? -1 : 1
    return a.quoteNumber.localeCompare(b.quoteNumber)
  })
  const sorted: ProductionTaskOverviewRow[] = []
  for (const q of quoteKeys) {
    sorted.push(...q.rows.slice().sort((a, b) => a.stepOrder - b.stepOrder))
  }
  return sorted
}

// ────────────────────────────────────────────────────────────
// 双维度展示（订单优先 / 日期优先，甘特图兼容适配）
// ────────────────────────────────────────────────────────────

/** 展示维度：订单优先（订单为主展示单元）/ 日期优先（按开始日期聚合分组） */
export type TrackingDimension = 'order' | 'date'

/** 日期排序方向：desc = 从新到旧（默认）；asc = 从旧到新 */
export type DateSortDirection = 'asc' | 'desc'

/** 订单开始日期解析器（页面注入回退链：productionStartTime → productionTimeStart → sampleTime） */
export type QuoteStartDateResolver = (quoteId: string) => string | null

/**
 * 日期优先模式的分组头行（甘特图左列表的分组标题行）
 * 转为甘特 record 后计划日期均为 null → 甘特区不渲染任务条，仅左列表显示分组信息
 */
export interface DateGroupHeaderRow {
  isDateHeader: true
  /** 分组日期键 'YYYY-MM-DD'；null = 无开始日期组 */
  dateKey: string | null
  /** 分组标题（日期 + 星期；无日期组为「无开始日期」） */
  dateTitle: string
  /** 分组统计（N 单 · M 步） */
  groupSummary: string
  quoteCount: number
  taskCount: number
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 开始日期归一化为 'YYYY-MM-DD'（兼容日期时间字符串）；空 / 非法返回 null */
function normalizeDateKey(s: string | null | undefined): string | null {
  if (!s) return null
  const d = parseDate(s.split('T')[0])
  return d ? toDateStr(d) : null
}

/** 订单组（同一订单的全部任务行，已按 stepOrder 升序） */
interface OrderGroup {
  quoteId: string
  quoteNumber: string
  startDate: string | null
  rows: ProductionTaskOverviewRow[]
}

/** 按订单聚合任务行（保持首次出现顺序），订单内按 stepOrder 升序 */
function buildOrderGroups(rows: ProductionTaskOverviewRow[], startDateOf: QuoteStartDateResolver): OrderGroup[] {
  const byQuote = new Map<string, ProductionTaskOverviewRow[]>()
  for (const row of rows) {
    let group = byQuote.get(row.quoteId)
    if (!group) {
      group = []
      byQuote.set(row.quoteId, group)
    }
    group.push(row)
  }
  return [...byQuote.entries()].map(([quoteId, groupRows]) => ({
    quoteId,
    // 防御性回退：分组仅在存在任务行时创建，groupRows[0] 恒有值（不可达分支）
    /* v8 ignore next */
    quoteNumber: groupRows[0]?.quoteNumber ?? '',
    startDate: normalizeDateKey(startDateOf(quoteId)),
    rows: groupRows.slice().sort((a, b) => a.stepOrder - b.stepOrder),
  }))
}

/**
 * 比较两个日期键（方向可控）；无日期固定排最后
 * @returns null 表示日期相同（含同为无日期），需按后续规则区分
 */
function compareByDateKey(a: string | null, b: string | null, direction: DateSortDirection): number | null {
  if (a === null && b === null) return null
  if (a === null) return 1
  if (b === null) return -1
  if (a === b) return null
  const cmp = a < b ? -1 : 1
  return direction === 'asc' ? cmp : -cmp
}

/**
 * 订单优先模式：订单组按开始日期排序（方向可控，无日期订单最后），
 * 同日期（或同为无日期）按订单号升序；订单内按 stepOrder 升序（纯函数，不改原数组）
 */
export function sortOverviewRowsByOrderDim(
  rows: ProductionTaskOverviewRow[],
  startDateOf: QuoteStartDateResolver,
  direction: DateSortDirection = 'desc',
): ProductionTaskOverviewRow[] {
  const groups = buildOrderGroups(rows, startDateOf)
  groups.sort((a, b) => compareByDateKey(a.startDate, b.startDate, direction) ?? a.quoteNumber.localeCompare(b.quoteNumber))
  return groups.flatMap((g) => g.rows)
}

/** 构造日期分组头行（标题含星期与统计；订单数按 quoteId 去重） */
function buildDateGroupHeader(dateKey: string | null, groupRows: ProductionTaskOverviewRow[]): DateGroupHeaderRow {
  const d = dateKey ? parseDate(dateKey) : null
  const quoteCount = new Set(groupRows.map((r) => r.quoteId)).size
  return {
    isDateHeader: true,
    dateKey,
    dateTitle: d
      ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_LABELS[d.getDay()]}`
      : '无开始日期',
    groupSummary: `${quoteCount} 单 · ${groupRows.length} 步`,
    quoteCount,
    taskCount: groupRows.length,
  }
}

/** 行级步骤开始日期（计划开始优先，缺失回退实际开始）；归一化为 'YYYY-MM-DD'，空 / 非法返回 null */
function rowStartDateKey(r: ProductionTaskOverviewRow): string | null {
  return normalizeDateKey(r.planStart || r.actualStart || null)
}

/**
 * 日期优先模式：按各步骤自身的开始日期聚合分组（同一订单的步骤可散布到多个日期组；
 * 组序方向可控，无开始日期组固定最后），组内按订单号升序、订单内按 stepOrder 升序；
 * 每个日期组前插入分组头行（纯函数，不改原数组）
 */
export function groupOverviewRowsByDate(
  rows: ProductionTaskOverviewRow[],
  direction: DateSortDirection = 'desc',
): Array<DateGroupHeaderRow | ProductionTaskOverviewRow> {
  // 按步骤开始日期分桶（订单不再整体落入同一日期组）
  const byDate = new Map<string | null, ProductionTaskOverviewRow[]>()
  for (const r of rows) {
    const key = rowStartDateKey(r)
    let bucket = byDate.get(key)
    if (!bucket) {
      bucket = []
      byDate.set(key, bucket)
    }
    bucket.push(r)
  }
  const dateKeys = [...byDate.keys()].sort((a, b) => {
    const cmp = compareByDateKey(a, b, direction)
    // 防御性回退：Map 键唯一，两个日期键不会相等（cmp 恒非 null，不可达分支）
    /* v8 ignore next */
    return cmp ?? 0
  })
  const result: Array<DateGroupHeaderRow | ProductionTaskOverviewRow> = []
  for (const key of dateKeys) {
    const groupRows = byDate.get(key)!.slice()
      .sort((a, b) => a.quoteNumber.localeCompare(b.quoteNumber) || a.stepOrder - b.stepOrder)
    result.push(buildDateGroupHeader(key, groupRows))
    result.push(...groupRows)
  }
  return result
}

// ────────────────────────────────────────────────────────────
// 甘特图名称排版
// ────────────────────────────────────────────────────────────

/** 文本智能截断：超长时保留前 maxChars-1 字符并追加省略号 */
export function truncateText(s: string, maxChars: number): string {
  if (!s) return ''
  if (s.length <= maxChars) return s
  return s.slice(0, Math.max(1, maxChars - 1)) + '…'
}

/** 数量展示归一：去除尾随 .00，非法值回退 0 */
export function normalizeQuantity(quantity: string): string {
  const n = parseFloat(quantity)
  if (isNaN(n)) return '0'
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

/**
 * 甘特图任务条名称：客户-步骤-数量（名称自动排版优化）：
 *   - 客户名超过 6 字截断为 5 字 + 省略号，保证条内文字简洁不占横向空间
 *   - 数量归一后统一「N个」后缀
 */
export function buildBarLabel(customerName: string, stepName: string, quantity: string): string {
  return `${truncateText(customerName, 6)}-${truncateText(stepName, 8)}-${normalizeQuantity(quantity)}个`
}

/** XML 转义（占位缩略图 SVG 内嵌文本用） */
function escapeXml(s: string): string {
  // 防御性回退：正则只匹配映射表中的 5 个字符，查表恒有值（不可达分支）
  /* v8 ignore next */
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] || c))
}

/** 无图订单的占位缩略图：灰底 + 客户名首字（SVG data URI，与列表占位样式一致） */
export function buildPlaceholderImage(letter: string): string {
  const ch = escapeXml((letter || '?').charAt(0).toUpperCase())
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="8" fill="#f3f4f6"/><text x="40" y="52" font-size="34" fill="#9ca3af" text-anchor="middle" font-family="sans-serif">${ch}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 日期分组头徽标：蓝底白字「日号」（无开始日期组显示「无」），SVG data URI */
export function buildDateBadgeImage(dateKey: string | null): string {
  const d = dateKey ? parseDate(dateKey) : null
  const label = escapeXml(d ? String(d.getDate()) : '无')
  const fontSize = label.length > 1 ? 28 : 34
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="12" fill="#2563eb"/><text x="40" y="52" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" font-family="sans-serif" font-weight="bold">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

// ────────────────────────────────────────────────────────────
// 拖拽保存 payload
// ────────────────────────────────────────────────────────────

/** 总览行 → PUT 整体替换 payload（订单全量任务；id/stepOrder 由服务端重排） */
export function toTaskPayload(rows: ProductionTaskOverviewRow[]): Array<{
  name: string
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  status: number
  remark: string
  materials: ProductionTaskMaterial[]
}> {
  return rows.map((r) => ({
    name: r.name,
    planStart: r.planStart,
    planEnd: r.planEnd,
    actualStart: r.actualStart,
    actualEnd: r.actualEnd,
    status: r.status,
    remark: r.remark,
    materials: r.materials,
  }))
}

/** 汇总信息：订单数 / 步骤数 / 已完成步骤数 */
export function summarizeOverview(rows: ProductionTaskOverviewRow[]): {
  quotes: number
  tasks: number
  completed: number
} {
  const quoteIds = new Set(rows.map((r) => r.quoteId))
  return {
    quotes: quoteIds.size,
    tasks: rows.length,
    completed: rows.filter((r) => r.status === 2).length,
  }
}

// ────────────────────────────────────────────────────────────
// 步骤编辑操作（与订单做货流程 ProductionTasksTab 一致）
// 全部为纯函数：返回新数组，未命中 / 越界时返回原数组引用
// ────────────────────────────────────────────────────────────

/** 步骤可编辑字段（详情编辑区 patch 范围） */
export type OverviewTaskPatch = Partial<Pick<ProductionTaskOverviewRow,
  'name' | 'planStart' | 'planEnd' | 'actualStart' | 'actualEnd' | 'status' | 'remark' | 'materials'
>>

/** 订单在总览数组中的行下标列表（保持数组顺序 = stepOrder 顺序） */
function quoteRowIndices(rows: ProductionTaskOverviewRow[], quoteId: string): number[] {
  const indices: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].quoteId === quoteId) indices.push(i)
  }
  return indices
}

/** 重排订单内 stepOrder（按数组顺序 1..n），返回新数组 */
function renumberStepOrder(rows: ProductionTaskOverviewRow[], quoteId: string): ProductionTaskOverviewRow[] {
  let order = 0
  return rows.map((r) => {
    if (r.quoteId !== quoteId) return r
    order++
    return r.stepOrder === order ? r : { ...r, stepOrder: order }
  })
}

/**
 * 修改步骤字段：应用 patch 到订单内第 idx（0 起）个步骤；
 * 实际时间变化时按联动规则纠正状态（填实际开始→进行中，填实际结束→已完成）
 */
export function patchOverviewTask(
  rows: ProductionTaskOverviewRow[],
  quoteId: string,
  idx: number,
  patch: OverviewTaskPatch,
): ProductionTaskOverviewRow[] {
  const target = quoteRowIndices(rows, quoteId)[idx]
  if (target === undefined) return rows
  const merged = { ...rows[target], ...patch }
  if (patch.actualStart !== undefined || patch.actualEnd !== undefined) {
    const resolved = resolveStatusByActualTimes(merged)
    if (merged.status !== resolved) merged.status = resolved
  }
  const next = [...rows]
  next[target] = merged
  return next
}

/**
 * 新增步骤：在指定订单末尾追加「新步骤」（未开始、无材料，复制订单摘要字段）；
 * 可传 defaultDate 为新步骤设置默认计划日期（单日排期，日期优先模式下用于继承所选步骤的开始日期，
 * 使新步骤出现在同一日期组）；订单不存在或已达 50 步上限时返回原数组
 */
export function appendOverviewTask(
  rows: ProductionTaskOverviewRow[],
  quoteId: string,
  /** 新步骤默认计划日期（单日排期）；日期优先模式下继承所选步骤的开始日期，确保新步骤出现在同一日期组 */
  defaultDate?: string | null,
): ProductionTaskOverviewRow[] {
  const indices = quoteRowIndices(rows, quoteId)
  if (indices.length === 0 || indices.length >= 50) return rows
  const ref = rows[indices[indices.length - 1]]
  const newRow: ProductionTaskOverviewRow = {
    id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    stepOrder: indices.length + 1,
    name: '新步骤',
    planStart: defaultDate ?? null,
    planEnd: defaultDate ?? null,
    actualStart: null,
    actualEnd: null,
    status: 0,
    remark: '',
    materials: [],
    quoteId: ref.quoteId,
    quoteNumber: ref.quoteNumber,
    customerName: ref.customerName,
    quantity: ref.quantity,
    orderStatus: ref.orderStatus,
    quoteUpdatedAt: ref.quoteUpdatedAt,
  }
  const next = [...rows]
  next.splice(indices[indices.length - 1] + 1, 0, newRow)
  return next
}

/** 删除订单内第 idx（0 起）个步骤，其余步骤 stepOrder 自动重排 */
export function removeOverviewTask(
  rows: ProductionTaskOverviewRow[],
  quoteId: string,
  idx: number,
): ProductionTaskOverviewRow[] {
  const target = quoteRowIndices(rows, quoteId)[idx]
  if (target === undefined) return rows
  return renumberStepOrder(rows.filter((_, i) => i !== target), quoteId)
}

/** 上移（dir=-1）/ 下移（dir=1）：订单内与相邻步骤交换位置并重排 stepOrder；越界返回原数组 */
export function moveOverviewTask(
  rows: ProductionTaskOverviewRow[],
  quoteId: string,
  idx: number,
  dir: -1 | 1,
): ProductionTaskOverviewRow[] {
  const indices = quoteRowIndices(rows, quoteId)
  const target = idx + dir
  const a = indices[idx]
  const b = indices[target]
  if (a === undefined || b === undefined) return rows
  const next = [...rows]
  const tmp = next[a]
  next[a] = next[b]
  next[b] = tmp
  return renumberStepOrder(next, quoteId)
}

/**
 * 撤销一键排期：将快照中的步骤行按原顺序替换回总览中该订单的行
 * （快照为排期前的订单全量步骤；正常情况下行数一致——其他编辑会使快照失效，
 * 行数不匹配时按较少数截断替换，防御性处理）
 */
export function restoreOverviewTasks(
  rows: ProductionTaskOverviewRow[],
  quoteId: string,
  snapshot: ProductionTaskOverviewRow[],
): ProductionTaskOverviewRow[] {
  const indices = quoteRowIndices(rows, quoteId)
  if (indices.length === 0 || snapshot.length === 0) return rows
  const next = [...rows]
  const n = Math.min(indices.length, snapshot.length)
  for (let i = 0; i < n; i++) {
    next[indices[i]] = snapshot[i]
  }
  return next
}
