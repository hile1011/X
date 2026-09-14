/**
 * 做货流程任务（v24 甘特图）服务层
 *
 * 职责（纯逻辑，无 React 依赖，便于单元测试）：
 *   - 类型定义：ProductionTask / ProductionMaterial / 同步状态
 *   - 默认步骤初始化（复用 ProductionSteps 常量：面料采购→裁剪→手提→印刷→缝纫→包装）
 *   - 状态联动规则：实际时间 → 任务状态
 *   - 一键排期：按做货起止日期自动均分各步骤
 *   - 甘特图 record 转换（DATE 字符串 ↔ VTable-Gantt record）与时间轴范围计算
 */
import { ProductionSteps } from '../constants/ProductionSteps'
import type { FabricPrepRow } from './tableLocator'

// 备料提取行类型再导出（组件从本模块统一导入做货流程相关类型）
export type { FabricPrepRow }

/** 材料准备项（与后端 ProductionTaskMaterial 结构一致，前端独立定义避免依赖服务端模块） */
export interface ProductionTaskMaterial {
  name: string
  /** 数量（个；表格联动时手提自动×2） */
  quantity: number
  /** 切片尺寸（如 41×90cm；来自在线表格切片宽×切片高联动，也可手动填写） */
  cutSize?: string
  /** 布料总米数（M，向上取整；来自在线表格布料米数联动，也可手动填写） */
  meters?: number
  ready: boolean
  /** 来源标记：'sheet' = 在线表格备料自动同步（手动添加的材料无此字段） */
  source?: 'sheet'
}

/** 做货流程任务（前端形态；与后端 ProductionTaskRecord 对应，id/时间戳由服务端维护） */
export interface ProductionTask {
  id: string
  stepOrder: number
  name: string
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  /** 0 未开始 / 1 进行中 / 2 已完成 */
  status: 0 | 1 | 2
  remark: string
  materials: ProductionTaskMaterial[]
}

/** 同步状态徽标 */
export type ProductionTaskSyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'dirty'

// ────────────────────────────────────────────────────────────
// 日期工具（本地时区安全，YYYY-MM-DD）
// ────────────────────────────────────────────────────────────

/** Date → 'YYYY-MM-DD'（本地时区） */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' → Date（本地时区午夜，避免 UTC 偏移导致日期偏移） */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 加 n 天 */
export function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

/**
 * 甘特图事件日期参数归一化：
 * VTable-Gantt 事件回调（change_date_range 等）中的 startDate/endDate 为库内部
 * formatDate 后的 'yyyy-mm-dd' 字符串（非 Date 对象），直接当 Date 用会抛错导致
 * 拖拽后计划时间不更新。此函数统一 Date / 字符串两种入参为合法日期串。
 */
export function normalizeGanttDateArg(v: Date | string | null | undefined): string | null {
  if (v instanceof Date) return toDateStr(v)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return null
}

/** 两日期相差天数（b - a） */
export function diffDays(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / 86400000)
}

// ────────────────────────────────────────────────────────────
// 默认步骤与状态联动
// ────────────────────────────────────────────────────────────

/**
 * 初始化默认流程步骤（内存态，id 为临时序号，保存时由服务端重新生成）：
 * 面料采购 → 裁剪 → 手提 → 印刷 → 缝纫 → 包装（无质检）
 * 首步骤计划开始时间默认为当天（当天单日排期），其余步骤待排期
 */
export function createDefaultTasks(): ProductionTask[] {
  const today = toDateStr(new Date())
  return ProductionSteps.getAll().map((step, i) => ({
    id: `tmp-${i + 1}`,
    stepOrder: i + 1,
    name: step.name,
    planStart: i === 0 ? today : null,
    planEnd: i === 0 ? today : null,
    actualStart: null,
    actualEnd: null,
    status: 0,
    remark: '',
    materials: [],
  }))
}

/**
 * 状态联动规则（设计文档 §3.3）：
 *   填实际开始 → 进行中；填实际结束 → 已完成
 *   清空实际时间 → 未开始（由调用方弹确认后调用）
 * 手动改状态时优先尊重手动值（仅当状态与时间矛盾时纠正）
 */
export function resolveStatusByActualTimes(
  task: Pick<ProductionTask, 'actualStart' | 'actualEnd' | 'status'>,
): 0 | 1 | 2 {
  if (task.actualEnd) return 2
  if (task.actualStart) return 1
  return 0
}

/** 时间与状态是否矛盾（需纠正） */
export function isStatusConflicted(task: Pick<ProductionTask, 'actualStart' | 'actualEnd' | 'status'>): boolean {
  return task.status !== resolveStatusByActualTimes(task)
}

// ────────────────────────────────────────────────────────────
// 在线表格备料联动（规格试算区 → 面料采购材料清单）
// ────────────────────────────────────────────────────────────

/** 备料材料条目字段长度上限（与后端校验一致） */
const FABRIC_PREP_LIMITS = { name: 64, cutSize: 32 }

/**
 * 将在线表格提取的备料数据合并进「面料采购」任务的材料准备清单：
 *
 * 合并规则：
 * - 手动材料（无 source:'sheet' 标记）原样保留、顺序不变
 * - 旧 source:'sheet' 条目整体替换为新提取行；ready 备齐状态按名称从旧条目继承
 * - 字段映射：名称→name；数量→quantity（「手提」每袋两条，自动×2）；
 *   切片宽×切片高→cutSize（如「41×90cm」）；布料米数→meters（向上取整，单位 M）
 *
 * 不联动情形（返回 null，调用方据此跳过，避免误标 dirty）：
 * - rows 为 null（表格结构不完整，如第二个标题行被删除）
 * - 找不到「面料采购」任务（被改名/删除）
 * - 合并后材料无实际变化（幂等）
 *
 * @param tasks 当前任务数组
 * @param rows extractFabricPrepRows 的提取结果
 * @returns 合并后的新数组；无变化返回 null
 */
export function applySheetFabricPrep(
  tasks: ProductionTask[],
  rows: FabricPrepRow[] | null,
): ProductionTask[] | null {
  if (!rows) return null
  const idx = tasks.findIndex((t) => t.name === '面料采购')
  if (idx < 0) return null
  const task = tasks[idx]

  // 手动材料保留；同名旧条目的备齐状态供继承（含手动同名列）
  const manual = task.materials.filter((m) => m.source !== 'sheet')
  const readyByName = new Map<string, boolean>()
  for (const m of task.materials) {
    if (m.name) readyByName.set(m.name, m.ready)
  }

  const synced: ProductionTaskMaterial[] = rows.map((r) => ({
    name: r.name.slice(0, FABRIC_PREP_LIMITS.name),
    // 「手提」每袋两条：数量自动×2
    quantity: r.quantity != null ? (r.name === '手提' ? r.quantity * 2 : r.quantity) : 0,
    cutSize: r.cutWidth != null && r.cutHeight != null
      ? `${r.cutWidth}×${r.cutHeight}cm`.slice(0, FABRIC_PREP_LIMITS.cutSize)
      : '',
    // 布料总米数向上取整（备料需足量），单位 M
    meters: r.meters != null ? Math.ceil(r.meters) : 0,
    ready: readyByName.get(r.name) ?? false,
    source: 'sheet' as const,
  }))
  const materials = [...manual, ...synced]
  if (JSON.stringify(materials) === JSON.stringify(task.materials)) return null

  const next = tasks.slice()
  next[idx] = { ...task, materials }
  return next
}

// ────────────────────────────────────────────────────────────
// 一键排期
// ────────────────────────────────────────────────────────────

/**
 * 一键排期：将 [start, end] 区间按任务数均分（首任务从 start 开始，末任务到 end 结束）
 * 区间天数 < 任务数时退化为每任务 1 天（允许重叠）
 * 返回带 planStart/planEnd 的任务副本数组；入参非法返回 null
 */
export function autoSchedule(
  tasks: ProductionTask[],
  start: string | null | undefined,
  end: string | null | undefined,
): ProductionTask[] | null {
  const startDate = parseDate(start)
  const endDate = parseDate(end)
  if (!startDate || !endDate || tasks.length === 0) return null
  const totalDays = Math.max(diffDays(startDate, endDate) + 1, tasks.length)
  const per = Math.max(1, Math.floor(totalDays / tasks.length))
  return tasks.map((t, i) => {
    const s = addDays(startDate, i * per)
    const isLast = i === tasks.length - 1
    const e = isLast ? endDate : addDays(s, per - 1)
    return { ...t, planStart: toDateStr(s), planEnd: toDateStr(e) }
  })
}

// ────────────────────────────────────────────────────────────
// 甘特图 record 转换与时间轴范围
// ────────────────────────────────────────────────────────────

/** VTable-Gantt 的任务 record（startDateField=planStart 等） */
export interface GanttRecord {
  id: string
  name: string
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  /** 进度内芯：状态映射 0/50/100 */
  progress: number
  status: number
  remark: string
  materialsCount: number
}

/** ProductionTask → 甘特 record */
export function toGanttRecords(tasks: ProductionTask[]): GanttRecord[] {
  return tasks.map((t) => ({
    id: t.id,
    name: t.name,
    planStart: t.planStart,
    planEnd: t.planEnd,
    actualStart: t.actualStart,
    actualEnd: t.actualEnd,
    progress: t.status === 2 ? 100 : t.status === 1 ? 50 : 0,
    status: t.status,
    remark: t.remark,
    materialsCount: t.materials.length,
  }))
}

/**
 * 时间轴范围（minDate/maxDate）：
 * 任务计划/实际时间的 min/max ± 7 天 buffer；无任何日期时今天前后各 14 天
 */
export function computeTimelineRange(tasks: ProductionTask[]): { minDate: string; maxDate: string } {
  const dates: Date[] = []
  for (const t of tasks) {
    for (const s of [t.planStart, t.planEnd, t.actualStart, t.actualEnd]) {
      const d = parseDate(s)
      if (d) dates.push(d)
    }
  }
  if (dates.length === 0) {
    const today = new Date()
    return { minDate: toDateStr(addDays(today, -14)), maxDate: toDateStr(addDays(today, 14)) }
  }
  const min = dates.reduce((a, b) => (a < b ? a : b))
  const max = dates.reduce((a, b) => (a > b ? a : b))
  return { minDate: toDateStr(addDays(min, -7)), maxDate: toDateStr(addDays(max, 7)) }
}

/**
 * 甘特图初始视口定位日期（避免打开时任务条在可视区外，只看到左侧空白）：
 *   - 最早计划/实际开始晚于今天 → 定位到今天（markLine 与即将开始的排期同屏）
 *   - 排期已开始/全部在过去 → 定位到最早开始（直接看到任务条）
 *   - 无任何日期 → 今天
 */
export function computeInitialFocusDate(tasks: ProductionTask[]): Date {
  const today = new Date()
  let earliest: Date | null = null
  for (const t of tasks) {
    const d = parseDate(t.planStart) ?? parseDate(t.actualStart)
    if (d && (!earliest || d < earliest)) earliest = d
  }
  if (!earliest) return today
  return earliest < today ? earliest : today
}

// ────────────────────────────────────────────────────────────
// 汇总信息
// ────────────────────────────────────────────────────────────

/** Tab2 顶部汇总：完成数/总任务数、备齐材料数/材料总数、计划区间 */
export function summarizeTasks(tasks: ProductionTask[]): {
  total: number
  completed: number
  materialsTotal: number
  materialsReady: number
  planRange: string
} {
  let completed = 0
  let materialsTotal = 0
  let materialsReady = 0
  const starts: Date[] = []
  const ends: Date[] = []
  for (const t of tasks) {
    if (t.status === 2) completed++
    for (const m of t.materials) {
      materialsTotal++
      if (m.ready) materialsReady++
    }
    const s = parseDate(t.planStart)
    const e = parseDate(t.planEnd)
    if (s) starts.push(s)
    if (e) ends.push(e)
  }
  const min = starts.length ? toDateStr(starts.reduce((a, b) => (a < b ? a : b))) : ''
  const max = ends.length ? toDateStr(ends.reduce((a, b) => (a > b ? a : b))) : ''
  return {
    total: tasks.length,
    completed,
    materialsTotal,
    materialsReady,
    planRange: min && max ? `${min} ~ ${max}` : '未排期',
  }
}
