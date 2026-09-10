/**
 * 做货流程跟踪表（做货跟踪页）
 *
 * 三个区块：
 *   1. 顶部筛选栏：客户名称（下拉多选 + 输入检索）/ 订单号 / 订单状态（多选）/ 日期区间 —— 对下方两个区块即时生效
 *   2. 做货流程甘特图（VTable-Gantt，双维度展示）：
 *      - 订单优先：任务行按订单聚合，订单按开始日期排序（回退链：做货开始时间 → 做货时间 → 打样开始时间；
 *        方向可切换，默认从新到旧；无开始日期的订单最后），同日期按订单号升序
 *      - 日期优先：按各步骤自身的开始日期分组插入分组头行（同一订单的步骤可散布到多个
 *        日期组；左列表蓝底分组标题，甘特区无任务条；组序方向可切换，无开始日期组最后），
 *        组内按订单号升序
 *      任务条可整体拖拽 / 拉伸调整排期，拖拽后按订单维度 debounce 自动同步（PUT 整体替换）；
 *      点击任务条或左侧列表行选中步骤 → 下方详情编辑区可修改步骤内容 / 新增 / 上移下移 / 删除 /
 *      一键排期（与订单做货流程功能一致，可撤销：恢复排期前计划时间），编辑同样走 debounce 自动同步
 *   3. 订单状态跟踪（自仪表盘迁移）：订单维度进度条甘特图，按状态流转排序
 *
 * 性能：全量拉取 + 前端筛选；甘特图为 canvas 渲染（仅绘制可视区行，天然虚拟滚动），
 *       维度切换为纯前端重排（setRecords），无网络请求
 * 今日标记：时间轴今日列浅红背景 + 红色「今天」竖线（区别于其他日期）
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select as AntSelect } from 'antd'
import { Gantt, TYPES } from '@visactor/vtable-gantt'
import type { GanttConstructorOptions } from '@visactor/vtable-gantt'
import { Search, ChevronDown, ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Loader2, AlertCircle, CheckCircle2, CloudUpload, Play, Plus, Trash2, ChevronUp, Package, Zap, Undo2, List, CalendarDays } from 'lucide-react'
import { api } from '../api'
import { usePermission } from '../hooks/usePermission'
import { OrderStatus } from '../constants/OrderStatus'
import { getOrderStatusStyle } from '../constants/OrderStatusStyles'
import { getStyleLabelFromProducts } from '../services/productStyles'
import type { Product } from '../types'
import { parseLocalDate, toLocalDateStr, formatQuoteDate, getGanttBarGeometry } from '../utils/dates'
import { computeTimelineRange, computeInitialFocusDate, normalizeGanttDateArg, toDateStr, autoSchedule } from '../services/productionTasks'
import type { ProductionTask, ProductionTaskMaterial } from '../services/productionTasks'
import {
  type ProductionTaskOverviewRow, type OverviewTaskPatch, type DateGroupHeaderRow,
  type TrackingDimension, type DateSortDirection,
  filterOverviewRows, sortOverviewRows, toTaskPayload, summarizeOverview,
  buildBarLabel, buildPlaceholderImage, buildDateBadgeImage, normalizeQuantity,
  sortOverviewRowsByOrderDim, groupOverviewRowsByDate,
  patchOverviewTask, appendOverviewTask, removeOverviewTask, moveOverviewTask, restoreOverviewTasks,
} from '../services/productionTracking'

/** VTable-Gantt 任务 record（含左列表显示字段与拖拽定位字段） */
interface TaskGanttRecord {
  id: string
  quoteId: string
  taskId: string
  name: string
  customerName: string
  quantityLabel: string
  imageUrl: string
  barLabel: string
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  progress: number
  status: number
  /** 日期优先模式的分组头行：左列表整行蓝底加粗，甘特区不渲染任务条（计划日期为 null） */
  isDateHeader?: boolean
  /** 分组头行专用：组内第一个任务行的定位（点击分组头 → 选中该步骤，使「添加步骤」/详情编辑可用） */
  firstQuoteId?: string
  firstTaskId?: string
}

/** 计划条颜色（按任务状态渐进，与订单做货流程甘特图一致） */
const PLAN_BAR_COLORS = ['#60a5fa', '#2563eb', '#16a34a']

/** 同步状态徽标（聚合展示） */
const SYNC_BADGE = {
  saving: { text: '同步中…', cls: 'bg-blue-100 text-blue-700' },
  dirty: { text: '待同步…', cls: 'bg-amber-100 text-amber-700' },
  error: { text: '部分订单同步失败，点击重试', cls: 'bg-red-100 text-red-700' },
  saved: { text: '已同步', cls: 'bg-green-100 text-green-700' },
} as const

// 订单状态筛选（沿用仪表盘原 localStorage key，用户已保存的选择无缝迁移）
const STORAGE_KEY_STATUSES = 'dashboard_selected_statuses'
const STORAGE_KEY_SORT = 'dashboard_sort_mode'
const STORAGE_KEY_FILTERS = 'production_tracking_filters'
// 双维度展示（做货流程甘特图）：维度 + 日期排序方向
const STORAGE_KEY_DIMENSION = 'production_tracking_dimension'
const STORAGE_KEY_DATE_SORT = 'production_tracking_date_sort'
const DEFAULT_SELECTED_STATUSES = [2, 3, 4]

const STATUS_OPTIONS = OrderStatus.getAll()

/** 步骤状态选项（与订单做货流程一致：0 未开始 / 1 进行中 / 2 已完成） */
const TASK_STATUS_OPTIONS = [
  { value: 0, label: '未开始' },
  { value: 1, label: '进行中' },
  { value: 2, label: '已完成' },
]

/** 订单状态跟踪排序模式（自仪表盘迁移） */
type SortMode = 'statusAsc' | 'statusDesc'

interface Quote {
  id: string
  quote_number: string
  customerName: string
  productStyle: string
  quantity: string
  productionTimeStart: string
  productionTimeEnd: string
  status: number
  sampleTime: string
  productionStartTime: string
  updated_at: string
}

const getInitialStatuses = (): number[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_STATUSES)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* localStorage 不可用，使用默认值 */ }
  return DEFAULT_SELECTED_STATUSES
}

const getInitialSortMode = (): SortMode => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SORT)
    if (saved === 'statusAsc' || saved === 'statusDesc') return saved
  } catch { /* ignore */ }
  return 'statusAsc'
}

/** 双维度展示：初始维度（默认订单优先），持久化到 localStorage */
const getInitialDimension = (): TrackingDimension => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DIMENSION)
    if (saved === 'order' || saved === 'date') return saved
  } catch { /* localStorage 不可用，使用默认值 */ }
  return 'order'
}

/** 双维度展示：初始日期排序方向（规范要求默认从新到旧即降序），持久化到 localStorage */
const getInitialDateSort = (): DateSortDirection => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DATE_SORT)
    if (saved === 'asc' || saved === 'desc') return saved
  } catch { /* localStorage 不可用，使用默认值 */ }
  return 'desc'
}

interface SavedFilters {
  customerNames: string[]
  quoteNumber: string
  dateStart: string
  dateEnd: string
}

const getInitialFilters = (): SavedFilters => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_FILTERS)
    if (saved) {
      const parsed = JSON.parse(saved)
      return {
        // 兼容旧版单值字符串（多选改造前 customerName 为 string，直接丢弃按空处理）
        customerNames: Array.isArray(parsed.customerNames)
          ? parsed.customerNames.filter((n: unknown): n is string => typeof n === 'string')
          : [],
        quoteNumber: typeof parsed.quoteNumber === 'string' ? parsed.quoteNumber : '',
        dateStart: typeof parsed.dateStart === 'string' ? parsed.dateStart : '',
        dateEnd: typeof parsed.dateEnd === 'string' ? parsed.dateEnd : '',
      }
    }
  } catch { /* localStorage 不可用，使用默认值 */ }
  return { customerNames: [], quoteNumber: '', dateStart: '', dateEnd: '' }
}

/** 时间轴范围：任务日期范围（含 ±7 天 buffer）并确保今天可见（今日标记需要） */
function computeRowsRange(rows: ProductionTaskOverviewRow[]): { minDate: string; maxDate: string } {
  const base = computeTimelineRange(rows)
  const today = toDateStr(new Date())
  return {
    minDate: base.minDate < today ? base.minDate : today,
    maxDate: base.maxDate > today ? base.maxDate : today,
  }
}

/** 视图行中的任务行（过滤日期分组头行；分组头无任何日期，仅用于左列表显示） */
function taskRowsOf(view: Array<ProductionTaskOverviewRow | DateGroupHeaderRow>): ProductionTaskOverviewRow[] {
  return view.filter((r): r is ProductionTaskOverviewRow => !('isDateHeader' in r))
}

// 日期优先模式：分组头行的左列表样式（整行浅蓝底 + 标题加粗深蓝，与任务行明显区分）
const DATE_HEADER_BG = '#eff6ff'
const DATE_HEADER_TEXT = '#1d4ed8'

/** 左列表单元格样式参数（VTable StylePropertyFunctionArg 子集） */
interface CellStyleArgs {
  col: number
  row: number
  table?: { getRecordByCell?: (col: number, row: number) => unknown }
}

/** 左列表单元格是否属于日期分组头行（经 record 的 isDateHeader 标记判断） */
function isDateHeaderCell(args: CellStyleArgs): boolean {
  try {
    const record = args.table?.getRecordByCell?.(args.col, args.row) as { isDateHeader?: boolean } | undefined
    return Boolean(record?.isDateHeader)
  } catch {
    return false
  }
}

/** 总览行 → 甘特图 record（左列表显示字段 + 拖拽定位字段 + 任务条标签） */
function toGanttRecord(row: ProductionTaskOverviewRow, imageFlags: Record<string, boolean>): TaskGanttRecord {
  return {
    id: `${row.quoteId}:${row.id}`,
    quoteId: row.quoteId,
    taskId: row.id,
    name: row.name,
    customerName: row.customerName,
    quantityLabel: `${normalizeQuantity(row.quantity)}个`,
    // 名称组成：[第一张产品图缩略图]-[客户名称]-[步骤]-[数量]（无图订单灰底占位 + 客户首字）
    imageUrl: imageFlags[row.quoteId]
      ? api.quotes.getThumbnailUrl(row.quoteId, row.quoteUpdatedAt)
      : buildPlaceholderImage(row.customerName),
    barLabel: buildBarLabel(row.customerName, row.name, row.quantity),
    planStart: row.planStart,
    planEnd: row.planEnd,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    progress: row.status === 2 ? 100 : row.status === 1 ? 50 : 0,
    status: row.status,
  }
}

/**
 * 日期分组头 → 甘特图 record：左列表显示日期徽标 + 标题 + 统计；计划日期全 null → 甘特区无任务条。
 * firstTask 为组内第一个任务行（组内按订单号/stepOrder 排序后的首行）：
 * 点击分组头行时以其为选中目标（分组头本身不属于任何订单，选中组内首步使「添加步骤」与详情编辑可用）
 */
function toDateHeaderRecord(header: DateGroupHeaderRow, firstTask?: ProductionTaskOverviewRow): TaskGanttRecord {
  return {
    id: `date:${header.dateKey ?? 'none'}`,
    quoteId: '',
    taskId: '',
    firstQuoteId: firstTask?.quoteId,
    firstTaskId: firstTask?.id,
    name: header.groupSummary,
    customerName: header.dateTitle,
    quantityLabel: '',
    imageUrl: buildDateBadgeImage(header.dateKey),
    barLabel: '',
    planStart: null,
    planEnd: null,
    actualStart: null,
    actualEnd: null,
    progress: 0,
    status: 0,
    isDateHeader: true,
  }
}

export default function ProductionTracking() {
  const navigate = useNavigate()
  const { hasPermission } = usePermission()
  const canEdit = hasPermission('quotes:edit')

  // ─── 数据 ─────────────────────────────────────────────
  const [overview, setOverview] = useState<ProductionTaskOverviewRow[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [imageFlags, setImageFlags] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // ─── 筛选条件（对两个区块即时生效） ─────────────────────
  const initialFilters = getInitialFilters()
  const [customerNames, setCustomerNames] = useState<string[]>(initialFilters.customerNames)
  const [quoteNumber, setQuoteNumber] = useState(initialFilters.quoteNumber)
  const [statuses, setStatuses] = useState<number[]>(getInitialStatuses)
  const [dateStart, setDateStart] = useState(initialFilters.dateStart)
  const [dateEnd, setDateEnd] = useState(initialFilters.dateEnd)
  const [statusFilterOpen, setStatusFilterOpen] = useState(false)

  // 选中的步骤（订单 + 订单内序号；保存回填按序替换行，序号在编辑过程中保持稳定）
  const [selected, setSelected] = useState<{ quoteId: string; idx: number } | null>(null)

  // 订单状态跟踪（自仪表盘迁移）
  const [sortMode, setSortMode] = useState<SortMode>(getInitialSortMode)

  // 做货流程甘特图双维度展示：维度（订单优先 / 日期优先）+ 日期排序方向（默认从新到旧）
  const [dimension, setDimension] = useState<TrackingDimension>(getInitialDimension)
  const [dateSort, setDateSort] = useState<DateSortDirection>(getInitialDateSort)

  // 拖拽保存同步状态（按订单维度）
  const [syncStates, setSyncStates] = useState<Record<string, 'dirty' | 'saving' | 'saved' | 'error'>>({})

  // 一键排期撤回快照：排期前该订单的全部步骤行；排期后发生其他编辑（改字段/增删移/拖拽）即失效清空
  const [undoSnapshot, setUndoSnapshot] = useState<{ quoteId: string; rows: ProductionTaskOverviewRow[] } | null>(null)

  const filterRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<HTMLDivElement>(null)
  const ganttInstanceRef = useRef<any>(null)
  const overviewRef = useRef<ProductionTaskOverviewRow[]>([])
  const rowsRef = useRef<Array<ProductionTaskOverviewRow | DateGroupHeaderRow>>([])
  const imageFlagsRef = useRef<Record<string, boolean>>({})
  const rangeRef = useRef<{ minDate: string; maxDate: string } | null>(null)
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const saveSeqMapRef = useRef<Map<string, number>>(new Map())

  overviewRef.current = overview

  // ─── 数据加载 ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setErrorMsg('')
    try {
      const [overviewData, quotesData, flags, productsData] = await Promise.all([
        api.quotes.getProductionTasksOverview() as Promise<ProductionTaskOverviewRow[]>,
        api.quotes.getAll() as Promise<Quote[]>,
        api.quotes.getImageFlags() as Promise<Record<string, boolean>>,
        api.products.getAll() as Promise<Product[]>,
      ])
      // 双重排序：订单按最早任务日期升序（无日期最后）→ 订单号升序；订单内按步骤序
      setOverview(sortOverviewRows(overviewData))
      setQuotes(quotesData)
      setImageFlags(flags || {})
      setProducts(productsData)
      setSyncStates({})
      setSelected(null) // 刷新后行序可能变化，清除选中避免序号错位
      setUndoSnapshot(null) // 刷新后行序/内容可能变化，排期快照失效
    } catch {
      setErrorMsg('做货流程跟踪数据加载失败，请刷新重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 筛选条件持久化（客户多选/订单号/日期）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_FILTERS, JSON.stringify({ customerNames, quoteNumber, dateStart, dateEnd }))
    } catch { /* localStorage 不可用，忽略 */ }
  }, [customerNames, quoteNumber, dateStart, dateEnd])

  // 点击状态筛选器外部时关闭下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setStatusFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 卸载清理
  useEffect(() => {
    return () => {
      saveTimersRef.current.forEach((t) => clearTimeout(t))
      saveTimersRef.current.clear()
      ganttInstanceRef.current?.release?.()
      ganttInstanceRef.current = null
    }
  }, [])

  // ─── 拖拽保存（按订单维度 debounce → PUT 整体替换） ────────
  const saveQuoteTasks = useCallback(async (quoteId: string) => {
    // payload 必须是该订单的全量任务（未过筛选的行也要带上）
    const rows = overviewRef.current.filter((r) => r.quoteId === quoteId)
    if (rows.length === 0) return
    // 本地预校验：任务名/材料名非空（与订单做货流程一致），
    // 不合法时跳过提交并保持"待同步"，避免自动保存被后端 400 拒绝进入"失败"状态
    if (rows.some((t) => !t.name?.trim() || t.materials.some((m) => !m.name?.trim()))) {
      setSyncStates((prev) => ({ ...prev, [quoteId]: 'dirty' }))
      return
    }
    const seq = (saveSeqMapRef.current.get(quoteId) || 0) + 1
    saveSeqMapRef.current.set(quoteId, seq)
    setSyncStates((prev) => ({ ...prev, [quoteId]: 'saving' }))
    try {
      const saved = await api.quotes.saveProductionTasks(quoteId, toTaskPayload(rows)) as ProductionTask[]
      if (saveSeqMapRef.current.get(quoteId) !== seq) return // 已有更新的保存请求，丢弃过期响应
      // 按提交顺序回填（服务端按提交顺序重排 stepOrder 并生成新 id）
      let i = 0
      setOverview((prev) => prev.map((r) => {
        if (r.quoteId !== quoteId) return r
        // 防御保存响应异常（非数组/长度不足）：保留本地行，仅同步状态为 error
        const s = saved?.[i++]
        if (!s) return r
        return { ...r, id: s.id, name: s.name, planStart: s.planStart, planEnd: s.planEnd, actualStart: s.actualStart, actualEnd: s.actualEnd, status: s.status, remark: s.remark, materials: s.materials }
      }))
      setSyncStates((prev) => ({ ...prev, [quoteId]: 'saved' }))
    } catch {
      if (saveSeqMapRef.current.get(quoteId) !== seq) return
      setSyncStates((prev) => ({ ...prev, [quoteId]: 'error' }))
    }
  }, [])

  const scheduleSave = useCallback((quoteId: string) => {
    setSyncStates((prev) => ({ ...prev, [quoteId]: 'dirty' }))
    const existed = saveTimersRef.current.get(quoteId)
    if (existed) clearTimeout(existed)
    saveTimersRef.current.set(quoteId, setTimeout(() => {
      saveTimersRef.current.delete(quoteId)
      saveQuoteTasks(quoteId)
    }, 600))
  }, [saveQuoteTasks])

  /** 拖拽/拉伸结束：更新计划时间并调度自动保存 */
  const updateTaskDates = useCallback((quoteId: string, taskId: string, planStart: string, planEnd: string) => {
    setOverview((prev) => prev.map((r) =>
      (r.quoteId === quoteId && r.id === taskId ? { ...r, planStart, planEnd } : r),
    ))
    setUndoSnapshot(null) // 排期后拖拽调整 → 排期快照失效
    scheduleSave(quoteId)
  }, [scheduleSave])

  // ─── 步骤编辑（与订单做货流程功能一致：新增/修改/上移下移/删除/一键排期） ────
  /** 修改所选订单内第 idx 个步骤的字段（实际时间变化时联动状态） */
  const patchTask = useCallback((idx: number, patch: OverviewTaskPatch) => {
    if (!selected) return
    const quoteId = selected.quoteId
    setOverview((prev) => patchOverviewTask(prev, quoteId, idx, patch))
    setUndoSnapshot(null) // 排期后编辑字段 → 排期快照失效
    scheduleSave(quoteId)
  }, [selected, scheduleSave])

  /** 新增步骤：追加到所选步骤所属订单末尾并选中新步骤 */
  const handleAddTask = useCallback(() => {
    if (!selected) return
    const quoteId = selected.quoteId
    const quoteRows = overviewRef.current.filter((r) => r.quoteId === quoteId)
    if (quoteRows.length >= 50) return
    // 日期优先模式：新步骤继承所选步骤的开始日期（单日排期），确保新步骤出现在同一日期组而非落入「无开始日期」组
    const sel = quoteRows[selected.idx]
    const baseDate = dimension === 'date' ? (sel?.planStart || sel?.actualStart || null) : null
    setOverview((prev) => appendOverviewTask(prev, quoteId, baseDate))
    setSelected({ quoteId, idx: quoteRows.length }) // 新步骤在订单末尾
    setUndoSnapshot(null) // 排期后增删步骤 → 排期快照失效
    scheduleSave(quoteId)
  }, [selected, dimension, scheduleSave])

  /** 删除所选步骤 */
  const handleRemoveTask = useCallback(() => {
    if (!selected) return
    const quoteId = selected.quoteId
    const idx = selected.idx
    setOverview((prev) => removeOverviewTask(prev, quoteId, idx))
    setSelected(null)
    setUndoSnapshot(null) // 排期后增删步骤 → 排期快照失效
    scheduleSave(quoteId)
  }, [selected, scheduleSave])

  /** 上移（dir=-1）/ 下移（dir=1）所选步骤 */
  const handleMoveTask = useCallback((dir: -1 | 1) => {
    if (!selected) return
    const count = overviewRef.current.filter((r) => r.quoteId === selected.quoteId).length
    const target = selected.idx + dir
    if (target < 0 || target >= count) return
    const quoteId = selected.quoteId
    const idx = selected.idx
    setOverview((prev) => moveOverviewTask(prev, quoteId, idx, dir))
    setSelected({ quoteId, idx: target })
    setUndoSnapshot(null) // 排期后移动步骤 → 排期快照失效
    scheduleSave(quoteId)
  }, [selected, scheduleSave])

  /** 一键排期：按所选订单的做货起止日期自动均分该订单全部步骤（排期前保存快照供撤回） */
  const handleAutoSchedule = useCallback(() => {
    if (!selected) return
    const quoteId = selected.quoteId
    const quote = quotes.find((q) => q.id === quoteId)
    const quoteRows = overviewRef.current.filter((r) => r.quoteId === quoteId)
    if (quoteRows.length === 0) return
    const scheduled = autoSchedule(quoteRows, quote?.productionTimeStart, quote?.productionTimeEnd)
    if (!scheduled) return
    setUndoSnapshot({ quoteId, rows: quoteRows })
    setOverview((prev) => {
      let i = 0
      return prev.map((r) => {
        if (r.quoteId !== quoteId) return r
        const s = scheduled[i++]
        return s ? { ...r, planStart: s.planStart, planEnd: s.planEnd } : r
      })
    })
    scheduleSave(quoteId)
  }, [selected, quotes, scheduleSave])

  /** 撤销最近一次一键排期：恢复排期前该订单的步骤行（含计划时间）并走同一保存通道 */
  const handleUndoSchedule = useCallback(() => {
    if (!undoSnapshot) return
    const { quoteId, rows: snapshotRows } = undoSnapshot
    setOverview((prev) => restoreOverviewTasks(prev, quoteId, snapshotRows))
    setUndoSnapshot(null)
    scheduleSave(quoteId)
  }, [undoSnapshot, scheduleSave])

  /** 同步失败重试：立即重新保存所有失败订单 */
  const retryFailedSaves = useCallback(() => {
    Object.entries(syncStates)
      .filter(([, s]) => s === 'error')
      .forEach(([quoteId]) => saveQuoteTasks(quoteId))
  }, [syncStates, saveQuoteTasks])

  // ─── 派生数据 ─────────────────────────────────────────
  // 筛选（保持 overview 已排序的行序，拖拽后不跳行）
  const rows = useMemo(
    () => filterOverviewRows(overview, { customerNames, quoteNumber, statuses, dateStart, dateEnd }),
    [overview, customerNames, quoteNumber, statuses, dateStart, dateEnd],
  )
  const summary = useMemo(() => summarizeOverview(rows), [rows])

  // 订单开始日期映射（回退链：做货开始时间 → 做货时间 → 打样开始时间，与订单状态跟踪甘特图口径一致）
  const quoteStartDateMap = useMemo(() => {
    const m = new Map<string, string | null>()
    quotes.forEach((q) => m.set(q.id, q.productionStartTime || q.productionTimeStart || q.sampleTime || null))
    return m
  }, [quotes])
  const startDateOf = useCallback(
    (quoteId: string) => quoteStartDateMap.get(quoteId) ?? null,
    [quoteStartDateMap],
  )

  // 客户名称下拉多选选项（从全部订单提取去重，中文排序）
  const customerOptions = useMemo(() => {
    const names = [...new Set(quotes.map((q) => q.customerName))]
    names.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    return names.map((name) => ({ value: name, label: name }))
  }, [quotes])

  // 选中步骤详情（订单行序 = stepOrder 顺序；保存回填按序替换行，idx 稳定）
  const quoteTaskRows = useMemo(
    () => (selected ? overview.filter((r) => r.quoteId === selected.quoteId) : []),
    [overview, selected],
  )
  const selectedRow = selected ? quoteTaskRows[selected.idx] ?? null : null
  // 一键排期可用性：所选订单已填写做货起止日期
  const selectedQuote = useMemo(
    () => (selected ? quotes.find((q) => q.id === selected.quoteId) ?? null : null),
    [quotes, selected],
  )
  const selectedQuoteHasDates = Boolean(selectedQuote?.productionTimeStart && selectedQuote?.productionTimeEnd)

  // ─── 材料清单操作（与订单做货流程一致：新增/修改/删除材料行） ────
  const patchMaterials = useCallback((idx: number, materials: ProductionTaskMaterial[]) => {
    patchTask(idx, { materials })
  }, [patchTask])

  const addMaterial = useCallback((idx: number) => {
    if (!selectedRow) return
    patchMaterials(idx, [...selectedRow.materials, { name: '', spec: '', quantity: 1, unit: '', ready: false }])
  }, [selectedRow, patchMaterials])

  const patchMaterial = useCallback((idx: number, mIdx: number, patch: Partial<ProductionTaskMaterial>) => {
    if (!selectedRow) return
    patchMaterials(idx, selectedRow.materials.map((m, i) => (i === mIdx ? { ...m, ...patch } : m)))
  }, [selectedRow, patchMaterials])

  const removeMaterial = useCallback((idx: number, mIdx: number) => {
    if (!selectedRow) return
    patchMaterials(idx, selectedRow.materials.filter((_, i) => i !== mIdx))
  }, [selectedRow, patchMaterials])

  // 双维度视图行（甘特图展示顺序）：
  //   订单优先 = 订单组按开始日期排序（方向可控）的任务行；
  //   日期优先 = 按各步骤自身开始日期分组（同订单步骤可散布多组，组序方向可控，组内按订单号升序）
  const viewRows = useMemo<Array<DateGroupHeaderRow | ProductionTaskOverviewRow>>(
    () => (dimension === 'order'
      ? sortOverviewRowsByOrderDim(rows, startDateOf, dateSort)
      : groupOverviewRowsByDate(rows, dateSort)),
    [rows, dimension, dateSort, startDateOf],
  )

  const records = useMemo<TaskGanttRecord[]>(
    () => viewRows.map((r, i) => {
      if (!('isDateHeader' in r)) return toGanttRecord(r, imageFlags)
      const nextRow = viewRows[i + 1]
      return toDateHeaderRecord(r, nextRow && !('isDateHeader' in nextRow) ? nextRow : undefined)
    }),
    [viewRows, imageFlags],
  )
  rowsRef.current = viewRows
  imageFlagsRef.current = imageFlags

  // 聚合同步徽标
  const aggSync = useMemo(() => {
    const vals = Object.values(syncStates)
    if (vals.includes('saving')) return SYNC_BADGE.saving
    if (vals.includes('dirty')) return SYNC_BADGE.dirty
    if (vals.includes('error')) return SYNC_BADGE.error
    if (vals.includes('saved')) return SYNC_BADGE.saved
    return null
  }, [syncStates])

  // ─── 甘特图实例 ───────────────────────────────────────
  const buildOptions = useCallback((): GanttConstructorOptions => {
    const todayStr = toLocalDateStr(new Date())
    const viewRows = rowsRef.current
    const records = viewRows.map((r, i) => {
      if (!('isDateHeader' in r)) return toGanttRecord(r, imageFlagsRef.current)
      const nextRow = viewRows[i + 1]
      return toDateHeaderRecord(r, nextRow && !('isDateHeader' in nextRow) ? nextRow : undefined)
    })
    const range = computeRowsRange(taskRowsOf(rowsRef.current))
    rangeRef.current = range
    return {
      records,
      dateFormat: 'yyyy-mm-dd',
      minDate: range.minDate,
      maxDate: range.maxDate,
      rowHeight: 40,
      timelineHeader: {
        backgroundColor: '#f8fafc',
        colWidth: 32,
        scales: [
          { unit: 'week', step: 1, rowHeight: 24, format: (d) => {
            const dt = d.startDate
            return `${dt.getMonth() + 1}/${String(dt.getDate()).padStart(2, '0')} 周`
          } },
          { unit: 'day', step: 1, rowHeight: 24, format: (d) =>
            toLocalDateStr(d.startDate) === todayStr ? '今天' : String(d.startDate.getDate()) },
        ],
      },
      // 今日列浅红背景（与今日红竖线配合，明显区别于其他日期）
      grid: {
        verticalBackgroundColor: (args) => (args.date && toLocalDateStr(args.date) === todayStr ? '#fef2f2' : ''),
      },
      // 今日醒目标记：红色竖线 + 「今天」标签
      markLine: [{
        date: todayStr,
        content: '今天',
        style: { lineColor: '#ef4444', lineWidth: 2, lineDash: [] },
        contentStyle: { color: '#ffffff', backgroundColor: '#ef4444', fontSize: 11, fontWeight: 'bold', cornerRadius: 4 },
      }],
      taskListTable: {
        tableWidth: 300,
        columns: [
          {
            field: 'imageUrl', title: '图', width: 46, cellType: 'image', keepAspectRatio: true,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 4, 6, 4], textAlign: 'center' },
            // 日期优先模式：分组头行显示日期徽标（蓝底白字日号）并铺整行浅蓝底
            style: (args: CellStyleArgs) => (isDateHeaderCell(args)
              ? { padding: [3, 4, 3, 4], bgColor: DATE_HEADER_BG }
              : { padding: [3, 4, 3, 4] }),
          },
          {
            field: 'customerName', title: '客户', width: 120,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 6, 6, 6] },
            // 日期优先模式：分组头行此列显示「2026/9/10 周四」标题（加粗深蓝）
            style: (args: CellStyleArgs) => (isDateHeaderCell(args)
              ? { fontSize: 12, padding: [4, 6, 4, 6], fontWeight: 'bold', color: DATE_HEADER_TEXT, bgColor: DATE_HEADER_BG }
              : { fontSize: 12, padding: [4, 6, 4, 6], color: '#334155' }),
          },
          {
            field: 'name', title: '步骤', width: 82,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 6, 6, 6] },
            // 日期优先模式：分组头行此列显示「N 单 · M 步」统计
            style: (args: CellStyleArgs) => (isDateHeaderCell(args)
              ? { fontSize: 12, padding: [4, 6, 4, 6], color: DATE_HEADER_TEXT, bgColor: DATE_HEADER_BG }
              : { fontSize: 12, padding: [4, 6, 4, 6], color: '#334155' }),
          },
          {
            field: 'quantityLabel', title: '数量', width: 52,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 6, 6, 6], textAlign: 'right' },
            style: (args: CellStyleArgs) => (isDateHeaderCell(args)
              ? { fontSize: 12, padding: [4, 6, 4, 6], textAlign: 'right', bgColor: DATE_HEADER_BG }
              : { fontSize: 12, padding: [4, 6, 4, 6], textAlign: 'right', color: '#334155' }),
          },
        ],
      },
      taskBar: {
        startDateField: 'planStart',
        endDateField: 'planEnd',
        baselineStartDateField: 'actualStart',
        baselineEndDateField: 'actualEnd',
        baselinePosition: 'bottom',
        progressField: 'progress',
        labelText: '{barLabel}',
        labelTextStyle: { color: '#fff', fontSize: 11, textAlign: 'center', textOverflow: 'ellipsis' },
        // 空白行（无日期步骤）悬停显示「+」创建按钮，点击后在点击日期单日排期：
        // 仅普通步骤行允许（日期优先模式的分组头行不属于任何订单，禁止创建避免误解）
        scheduleCreatable: (args: { taskRecord?: { isDateHeader?: boolean } }) => !args?.taskRecord?.isDateHeader,
        moveable: canEdit,
        resizable: canEdit,
        moveToExtendDateRange: true,
        barStyle: (args) => ({
          barColor: PLAN_BAR_COLORS[Number(args.taskRecord?.status ?? 0)] || PLAN_BAR_COLORS[0],
          completedBarColor: 'rgba(255,255,255,0.55)',
          cornerRadius: 4,
          // barStyle 为函数时返回值不与默认样式合并，缺少 width 会导致任务条不可见
          width: 30,
        }),
        baselineStyle: { barColor: '#fb923c', cornerRadius: 4 },
      },
      frame: {
        outerFrameStyle: { borderLineWidth: 1, borderColor: '#e2e8f0' },
        verticalSplitLine: { lineDash: [], lineWidth: 1, lineColor: '#e2e8f0' },
      },
    }
  }, [canEdit])

  useEffect(() => {
    if (!ganttRef.current || loading) return
    // VTable 初始化时会调用 scrollIntoView 导致页面滚动，临时屏蔽（与 ProductionTasksTab 一致）
    const origScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { /* no-op during init */ }

    const gantt = new Gantt(ganttRef.current, buildOptions())
    ganttInstanceRef.current = gantt
    // TODO(debug): 临时调试钩子，验证甘特创建排期交互，验证后移除
    ;(window as any).__ganttDebug = gantt

    // 初始视口定位：滚动到「今天 vs 最早计划开始」中较早者（日期分组头行无日期，过滤后参与计算）
    const focusDate = computeInitialFocusDate(taskRowsOf(rowsRef.current))
    requestAnimationFrame(() => {
      try { ganttInstanceRef.current?.scrollToMarkLine(focusDate) } catch { /* 定位失败不影响主流程 */ }
    })

    // 拖拽移动 / 拉伸调整时长结束：更新计划时间 → 同步保存
    gantt.on(TYPES.GANTT_EVENT_TYPE.CHANGE_DATE_RANGE, (args) => {
      if (!canEdit) return
      const quoteId: string | undefined = args.record?.quoteId
      const taskId: string | undefined = args.record?.taskId
      const planStart = normalizeGanttDateArg(args.startDate)
      const planEnd = normalizeGanttDateArg(args.endDate)
      if (!quoteId || !taskId || !planStart || !planEnd || planStart > planEnd) return
      updateTaskDates(quoteId, taskId, planStart, planEnd)
    })

    // 空白行（无日期步骤）点击「+」创建排期：库已把日期写入 record 并更新视图，此处同步状态 → 防抖保存
    // （scheduleCreatable 已按行过滤：分组头行不会触发；仅受编辑权限控制）
    gantt.on(TYPES.GANTT_EVENT_TYPE.CREATE_TASK_SCHEDULE, (args) => {
      if (!canEdit) return
      const quoteId: string | undefined = args.record?.quoteId
      const taskId: string | undefined = args.record?.taskId
      const planStart = normalizeGanttDateArg(args.startDate)
      const planEnd = normalizeGanttDateArg(args.endDate)
      if (!quoteId || !taskId || !planStart || !planEnd || planStart > planEnd) return
      updateTaskDates(quoteId, taskId, planStart, planEnd)
    })

    // 点击任务条：选中步骤，下方详情编辑区联动
    gantt.on(TYPES.GANTT_EVENT_TYPE.CLICK_TASK_BAR, (args) => {
      const quoteId: string | undefined = args.record?.quoteId
      const taskId: string | undefined = args.record?.taskId
      if (!quoteId || !taskId) return
      const idx = overviewRef.current.filter((r) => r.quoteId === quoteId).findIndex((r) => r.id === taskId)
      if (idx >= 0) setSelected({ quoteId, idx })
    })

    // 左侧任务列表行点击：选中步骤（双击仍为打开订单）
    const listTable = (gantt as any).taskListTableInstance
    listTable?.on?.('click_cell', (args: { originData?: { quoteId?: string; taskId?: string; isDateHeader?: boolean; firstQuoteId?: string; firstTaskId?: string } }) => {
      const origin = args?.originData
      // 日期分组头行：选中组内第一个步骤（分组头不属于任何订单，以其为代理使「添加步骤」与详情编辑可用）
      if (origin?.isDateHeader) {
        const fq = origin.firstQuoteId
        const ft = origin.firstTaskId
        if (!fq || !ft) return
        const idx = overviewRef.current.filter((r) => r.quoteId === fq).findIndex((r) => r.id === ft)
        if (idx >= 0) setSelected({ quoteId: fq, idx })
        return
      }
      const quoteId = origin?.quoteId
      const taskId = origin?.taskId
      if (!quoteId || !taskId) return
      const idx = overviewRef.current.filter((r) => r.quoteId === quoteId).findIndex((r) => r.id === taskId)
      if (idx >= 0) setSelected({ quoteId, idx })
    })

    // 左侧任务列表双击：打开订单详情/编辑
    listTable?.on?.('dblclick_cell', (args: { originData?: { quoteId?: string } }) => {
      const quoteId = args?.originData?.quoteId
      if (quoteId) navigate(hasPermission('quotes:edit') ? `/quotes/${quoteId}/edit` : `/quotes/${quoteId}`)
    })

    // 容器尺寸自适应
    let lastW = ganttRef.current.clientWidth
    let lastH = ganttRef.current.clientHeight
    const observer = new ResizeObserver(() => {
      const el = ganttRef.current
      const inst = ganttInstanceRef.current
      if (!el || !inst) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === lastW && h === lastH) return
      lastW = w
      lastH = h
      if (w > 0 && h > 0) {
        try { (inst as any)._resize() } catch { /* resize 失败不影响主流程 */ }
      }
    })
    observer.observe(ganttRef.current)

    setTimeout(() => {
      Element.prototype.scrollIntoView = origScrollIntoView
    }, 1000)
    return () => {
      observer.disconnect()
      ganttInstanceRef.current?.release?.()
      ganttInstanceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canEdit])

  // records 变化：同步甘特图（range 变化需 updateOption，否则 setRecords）
  useEffect(() => {
    const gantt = ganttInstanceRef.current
    if (!gantt || loading) return
    const range = computeRowsRange(rows)
    if (rangeRef.current && (rangeRef.current.minDate !== range.minDate || rangeRef.current.maxDate !== range.maxDate)) {
      rangeRef.current = range
      gantt.updateOption({ ...buildOptions(), records })
      try { gantt.scrollToMarkLine(computeInitialFocusDate(rows)) } catch { /* 忽略 */ }
    } else {
      gantt.setRecords(records)
    }
  }, [records, rows, loading, buildOptions])

  // ─── 双维度展示：维度切换 / 日期排序方向切换（均持久化，纯前端重排无网络请求） ────
  const handleDimensionChange = useCallback((next: TrackingDimension) => {
    setDimension(next)
    try { localStorage.setItem(STORAGE_KEY_DIMENSION, next) } catch { /* localStorage 不可用，忽略 */ }
  }, [])

  const handleDateSortToggle = useCallback(() => {
    setDateSort((prev) => {
      const next = prev === 'desc' ? 'asc' : 'desc'
      try { localStorage.setItem(STORAGE_KEY_DATE_SORT, next) } catch { /* localStorage 不可用，忽略 */ }
      return next
    })
  }, [])

  // 维度说明文案（图例区排序规则提示，与当前激活状态同步）
  const dimensionHint = dimension === 'order'
    ? `订单优先：按开始日期${dateSort === 'desc' ? '从新到旧' : '从旧到新'}排序（同日期按订单号，无开始日期在最后）`
    : `日期优先：按步骤开始日期分组${dateSort === 'desc' ? '（从新到旧）' : '（从旧到新）'}，组内按订单号升序`

  // ─── 订单状态跟踪（自仪表盘迁移） ────────────────────────
  const handleSortToggle = () => {
    setSortMode((prev) => {
      const next = prev === 'statusAsc' ? 'statusDesc' : 'statusAsc'
      try { localStorage.setItem(STORAGE_KEY_SORT, next) } catch { /* ignore */ }
      return next
    })
  }

  const handleStatusToggle = (status: number) => {
    setStatuses((prev) => {
      const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
      try { localStorage.setItem(STORAGE_KEY_STATUSES, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const handleResetFilters = () => {
    setCustomerNames([])
    setQuoteNumber('')
    setDateStart('')
    setDateEnd('')
    setStatuses([])
    try { localStorage.setItem(STORAGE_KEY_STATUSES, JSON.stringify([])) } catch { /* ignore */ }
  }

  /** 订单起始日期字符串：做货开始时间 → 做货时间（老字段）→ 打样开始时间 */
  const getQuoteStartDateStr = (quote: Quote) =>
    quote.productionStartTime || quote.productionTimeStart || quote.sampleTime

  // 状态跟踪数据：应用页面筛选（客户多选/订单号/状态/日期区间，订单维度）+ 状态/交期排序
  const trackingQuotes = useMemo(() => {
    const names = customerNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
    const qn = quoteNumber.trim().toLowerCase()
    const hasDate = Boolean(dateStart || dateEnd)
    const filtered = quotes.filter((q) => {
      if (names.length > 0 && !names.includes(q.customerName.toLowerCase())) return false
      if (qn && !q.quote_number.toLowerCase().includes(qn)) return false
      if (statuses.length > 0 && !statuses.includes(q.status)) return false
      if (hasDate) {
        const startStr = getQuoteStartDateStr(q)
        if (!startStr && !q.productionTimeEnd) return false
        const a = dateStart ? parseLocalDate(dateStart).getTime() : -Infinity
        const b = dateEnd ? parseLocalDate(dateEnd).getTime() : Infinity
        const s = startStr ? parseLocalDate(startStr).getTime() : -Infinity
        const e = q.productionTimeEnd ? parseLocalDate(q.productionTimeEnd).getTime() : Infinity
        if (e < a || s > b) return false
      }
      return true
    })
    const sorted = [...filtered].sort((a, b) => {
      // 主排序：状态（基于 FLOW 指针位置）
      const aPos = OrderStatus.getFlowPosition(a.status)
      const bPos = OrderStatus.getFlowPosition(b.status)
      if (aPos !== bPos) {
        return sortMode === 'statusAsc' ? aPos - bPos : bPos - aPos
      }
      // 二级排序：交货日期升序（无交货日期的排后面）
      const aDue = a.productionTimeEnd ? new Date(a.productionTimeEnd).getTime() : Infinity
      const bDue = b.productionTimeEnd ? new Date(b.productionTimeEnd).getTime() : Infinity
      return aDue - bDue
    })
    return sorted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, customerNames, quoteNumber, statuses, dateStart, dateEnd, sortMode])

  // 状态跟踪甘特图日期范围（从最早的开始日期到最晚的结束日期）
  const { minDate, maxDate, ganttDays, todayMarkPercent } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let min = today
    let max = today
    trackingQuotes.forEach((quote) => {
      const startStr = getQuoteStartDateStr(quote)
      const startDate = startStr ? parseLocalDate(startStr) : today
      const endDate = quote.productionTimeEnd ? parseLocalDate(quote.productionTimeEnd) : today
      if (startDate < min) min = startDate
      if (endDate > max) max = endDate
    })
    if (max <= min) {
      max = new Date(min)
      max.setDate(max.getDate() + 7)
    }
    const days: Date[] = []
    const current = new Date(min)
    while (current <= max) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    // 今天线对齐"今天"列的左边缘（与日期表头列对齐）
    const rangeDayCount = (max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24)
    const markPercent = ((today.getTime() - min.getTime()) / (1000 * 60 * 60 * 24) / (rangeDayCount + 1)) * 100
    return { minDate: min, maxDate: max, ganttDays: days, todayMarkPercent: markPercent }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingQuotes])

  const todayForMark = useMemo(() => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return t
  }, [])

  /** 状态跟踪进度：做货起止区间内的时间进度（0-100） */
  const calculateProgress = (quote: Quote) => {
    const today = todayForMark
    const startStr = getQuoteStartDateStr(quote)
    const startDate = startStr ? parseLocalDate(startStr) : today
    const endDateStr = quote.productionTimeEnd || toLocalDateStr(today)
    const endDate = parseLocalDate(endDateStr)
    const totalDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const elapsedDays = Math.max(0, (today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    return Math.min(100, (elapsedDays / totalDays) * 100)
  }

  const getGanttBarStyle = (quote: Quote) => {
    const geo = getGanttBarGeometry(getQuoteStartDateStr(quote), quote.productionTimeEnd, minDate, maxDate, todayForMark)
    return { left: `${geo.left}%`, width: `${geo.width}%` }
  }

  const todayStr = toLocalDateStr(new Date())

  // ─── 渲染 ─────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">做货跟踪</h1>
        <p className="text-gray-500 mt-1">整合订单做货流程排期与状态跟踪，支持拖拽调整生产排期</p>
      </div>

      {errorMsg && (
        <div className="mb-4 px-3 py-2 text-sm text-red-700 bg-red-50 rounded-lg flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={fetchData} className="px-3 py-1 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700">重试</button>
        </div>
      )}

      {/* ─── 筛选栏：客户名称（下拉多选+检索）/ 订单号 / 订单状态 / 日期区间（多条件组合，即时生效） ─── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">客户名称（多选）</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" />
              <AntSelect
                mode="multiple"
                showSearch
                allowClear
                value={customerNames}
                onChange={(values: string[]) => setCustomerNames(values)}
                placeholder="客户名称（输入检索，可多选）"
                optionFilterProp="label"
                filterSort={(a, b) => String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'zh-Hans-CN')}
                options={customerOptions}
                maxTagCount="responsive"
                popupClassName="tracking-multi-select-dropdown"
                className="tracking-multi-select"
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">订单号</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                placeholder="输入订单号筛选"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">订单状态（多选）</label>
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setStatusFilterOpen(!statusFilterOpen)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors justify-between"
              >
                <span className="text-gray-600 truncate">
                  {statuses.length === 0 ? '全部状态' : `已选 ${statuses.length} 项`}
                </span>
                <ChevronDown size={14} className={`text-gray-400 transition-transform shrink-0 ${statusFilterOpen ? 'rotate-180' : ''}`} />
              </button>
              {statusFilterOpen && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[220px] py-1">
                  <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">选择要显示的订单状态</div>
                  {STATUS_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={statuses.includes(opt.value)}
                        onChange={() => handleStatusToggle(opt.value)}
                        className="rounded text-primary-600 focus:ring-primary-500"
                      />
                      <span className={`px-2 py-0.5 text-xs rounded-full ${getOrderStatusStyle(opt.value).color}`}>{opt.label}</span>
                    </label>
                  ))}
                  <div className="border-t border-gray-100 mt-1 pt-1 flex justify-between px-3">
                    <button
                      onClick={() => {
                        setStatuses([])
                        try { localStorage.setItem(STORAGE_KEY_STATUSES, JSON.stringify([])) } catch { /* ignore */ }
                      }}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      全部状态
                    </button>
                    <button
                      onClick={() => {
                        const all = STATUS_OPTIONS.map((o) => o.value)
                        setStatuses(all)
                        try { localStorage.setItem(STORAGE_KEY_STATUSES, JSON.stringify(all)) } catch { /* ignore */ }
                      }}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      全选
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">日期区间（与做货排期有交集）</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none"
                title="开始日期"
              />
              <span className="text-gray-400 text-sm shrink-0">—</span>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:border-blue-400 focus:outline-none"
                title="结束日期"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={handleResetFilters}
            className="px-3 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            重置筛选
          </button>
        </div>
      </div>

      {/* ─── 做货流程甘特图（全订单任务总览 + 拖拽排期） ─── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Play className="text-gray-400" size={15} />
          <h2 className="text-base font-semibold text-gray-800">做货流程甘特图</h2>
          <span className="text-xs text-gray-400">
            {loading ? '加载中…' : `${summary.quotes} 个订单 · ${summary.tasks} 个步骤 · ${summary.completed} 步完成`}
          </span>

          {/* ─── 双维度切换（订单优先 / 日期优先）：无刷新切换，数据即时重排 ─── */}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden" role="tablist" aria-label="展示维度">
            <button
              role="tab"
              aria-selected={dimension === 'order'}
              onClick={() => handleDimensionChange('order')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors ${dimension === 'order' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="以订单为展示单元：订单按开始日期排序，订单内按步骤顺序"
            >
              <List size={13} /> 订单优先
            </button>
            <button
              role="tab"
              aria-selected={dimension === 'date'}
              onClick={() => handleDimensionChange('date')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs transition-colors border-l border-gray-200 ${dimension === 'date' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              title="以日期为展示单元：按订单各步骤的开始日期分组展示，日期为时间轴横坐标"
            >
              <CalendarDays size={13} /> 日期优先
            </button>
          </div>

          {/* 日期排序方向指示器：图标与当前状态同步，点击即时切换排序方向 */}
          <button
            onClick={handleDateSortToggle}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            title={dimensionHint}
          >
            {dateSort === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
            {dateSort === 'desc' ? '日期从新到旧' : '日期从旧到新'}
          </button>

          <div className="flex-1" />
          {canEdit && (
            <>
              <button
                onClick={handleAutoSchedule}
                disabled={!selected || !selectedQuoteHasDates || loading}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!selected
                  ? '先点击任务条或左侧列表行选中步骤'
                  : !selectedQuoteHasDates
                    ? '需先填写订单的做货开始与结束日期'
                    : '按订单做货起止日期自动均分该订单全部步骤'}
              >
                <Zap size={13} /> 一键排期
              </button>
              <button
                onClick={handleUndoSchedule}
                disabled={!undoSnapshot || loading}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={undoSnapshot
                  ? '撤销最近一次一键排期，恢复排期前的计划时间'
                  : '暂无可撤销的排期（排期后发生其他修改则不可撤销）'}
              >
                <Undo2 size={13} /> 撤销排期
              </button>
              <button
                onClick={handleAddTask}
                disabled={!selected || loading || quoteTaskRows.length >= 50}
                className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={selected
                  ? (dimension === 'date'
                    ? '在所选订单末尾新增步骤（新步骤默认继承所选步骤的开始日期，出现在同一日期组，最多 50 步）'
                    : '在所选订单末尾新增步骤（最多 50 步）')
                  : '先点击任务条、左侧列表行或日期分组头行，选中步骤所在订单'}
              >
                <Plus size={13} /> 添加步骤
              </button>
            </>
          )}
          {aggSync && (
            <button
              onClick={aggSync === SYNC_BADGE.error ? retryFailedSaves : undefined}
              className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${aggSync.cls} ${aggSync === SYNC_BADGE.error ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
              title={aggSync === SYNC_BADGE.error ? '点击重试保存失败的订单' : undefined}
            >
              {aggSync === SYNC_BADGE.saving && <CloudUpload size={11} />}
              {aggSync === SYNC_BADGE.error && <AlertCircle size={11} />}
              {aggSync === SYNC_BADGE.saved && <CheckCircle2 size={11} />}
              {aggSync.text}
            </button>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            title="重新加载数据"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-[320px] text-gray-400">
            <Loader2 className="animate-spin mr-2" size={18} /> 加载中...
          </div>
        ) : (
          <>
            <div className="border border-gray-100 rounded-lg overflow-hidden relative">
              {/* relative 必须保留：.vtable-gantt 为 absolute 定位，缺少 positioned 祖先会与左侧列表重叠错位 */}
              {/* 高度按视图行数计算（日期优先模式含分组头行）；甘特图为 canvas 渲染，仅绘制可视区行（虚拟滚动） */}
              <div ref={ganttRef} className="relative w-full" style={{ height: Math.min(680, Math.max(260, viewRows.length * 40 + 88)) }} />
              {viewRows.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-gray-400 pointer-events-none">
                  暂无符合筛选条件的做货流程数据
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block" style={{ background: '#60a5fa' }} />计划（可拖拽移动、拉伸两端调整时长）</span>
              <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block" style={{ background: '#fb923c' }} />实际执行</span>
              <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block" style={{ background: '#16a34a' }} />已完成计划</span>
              <span className="flex items-center gap-1"><i className="w-0.5 h-3 rounded-sm inline-block" style={{ background: '#ef4444' }} />今天标记（时间轴红列）</span>
              <span>{dimensionHint}；双击左侧列表行可打开订单</span>
              {!canEdit && <span className="text-amber-600">只读模式（无编辑权限，不可拖拽排期）</span>}
            </div>

            {/* ─── 步骤详情编辑区（与订单做货流程一致：修改字段/上移下移/删除/材料清单） ─── */}
            {selected && selectedRow && (
              <div className="mt-3 border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-semibold text-gray-700">步骤详情</span>
                  <span className="text-[11px] text-gray-400 truncate">
                    {selectedRow.quoteNumber} · {selectedRow.customerName} · 第 {selected.idx + 1}/{quoteTaskRows.length} 步
                  </span>
                  {canEdit && (
                    <>
                      <div className="flex-1" />
                      <div className="flex gap-1">
                        <button onClick={() => handleMoveTask(-1)} disabled={selected.idx === 0}
                          className="p-1 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-30" title="上移">
                          <ChevronUp size={14} />
                        </button>
                        <button onClick={() => handleMoveTask(1)} disabled={selected.idx === quoteTaskRows.length - 1}
                          className="p-1 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-30" title="下移">
                          <ChevronDown size={14} />
                        </button>
                        <button onClick={handleRemoveTask}
                          className="p-1 rounded text-red-500 hover:bg-red-50" title="删除步骤">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-0.5">步骤名称</label>
                    <input type="text" value={selectedRow.name} maxLength={64} readOnly={!canEdit}
                      onChange={(e) => patchTask(selected.idx, { name: e.target.value })}
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-0.5">状态</label>
                    <select value={selectedRow.status} disabled={!canEdit}
                      onChange={(e) => patchTask(selected.idx, { status: Number(e.target.value) as 0 | 1 | 2 })}
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none disabled:bg-gray-100">
                      {TASK_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-0.5">计划开始</label>
                    <input type="date" value={selectedRow.planStart || ''} readOnly={!canEdit}
                      onChange={(e) => patchTask(selected.idx, { planStart: e.target.value || null })}
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-0.5">计划结束</label>
                    <input type="date" value={selectedRow.planEnd || ''} readOnly={!canEdit}
                      onChange={(e) => patchTask(selected.idx, { planEnd: e.target.value || null })}
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-0.5">实际开始</label>
                    <input type="date" value={selectedRow.actualStart || ''} readOnly={!canEdit}
                      onChange={(e) => patchTask(selected.idx, { actualStart: e.target.value || null })}
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-0.5">实际结束</label>
                    <input type="date" value={selectedRow.actualEnd || ''} readOnly={!canEdit}
                      onChange={(e) => patchTask(selected.idx, { actualEnd: e.target.value || null })}
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                  </div>
                </div>

                <div className="mt-2">
                  <label className="block text-[11px] text-gray-400 mb-0.5">备注</label>
                  <input type="text" value={selectedRow.remark} maxLength={255} readOnly={!canEdit}
                    onChange={(e) => patchTask(selected.idx, { remark: e.target.value })}
                    placeholder="生产注意事项、外协安排等"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                </div>

                {/* 材料准备清单 */}
                <div className="mt-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Package size={13} className="text-gray-400" />
                    <span className="text-[11px] font-semibold text-gray-600">材料准备</span>
                    {canEdit && (
                      <button onClick={() => addMaterial(selected.idx)} disabled={selectedRow.materials.length >= 50}
                        className="ml-1 text-[11px] text-blue-600 hover:underline disabled:opacity-40">+ 材料</button>
                    )}
                  </div>
                  {selectedRow.materials.length === 0 ? (
                    <p className="text-[11px] text-gray-400">暂无材料清单，点击「+ 材料」添加</p>
                  ) : (
                    <div className="space-y-1">
                      {selectedRow.materials.map((m, mIdx) => (
                        <div key={mIdx} className="flex items-center gap-1.5 flex-wrap">
                          <input type="checkbox" checked={m.ready} disabled={!canEdit}
                            onChange={(e) => patchMaterial(selected.idx, mIdx, { ready: e.target.checked })}
                            className="accent-green-600 w-3.5 h-3.5" title="是否备齐" />
                          <input type="text" value={m.name} placeholder="名称" maxLength={64} readOnly={!canEdit}
                            onChange={(e) => patchMaterial(selected.idx, mIdx, { name: e.target.value })}
                            className="w-28 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                          <input type="text" value={m.spec} placeholder="规格" maxLength={64} readOnly={!canEdit}
                            onChange={(e) => patchMaterial(selected.idx, mIdx, { spec: e.target.value })}
                            className="w-24 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                          <input type="number" value={m.quantity} min={0} step="0.01" readOnly={!canEdit}
                            onChange={(e) => patchMaterial(selected.idx, mIdx, { quantity: Math.round(Number(e.target.value || 0) * 100) / 100 })}
                            className="w-20 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                          <input type="text" value={m.unit} placeholder="单位" maxLength={8} readOnly={!canEdit}
                            onChange={(e) => patchMaterial(selected.idx, mIdx, { unit: e.target.value })}
                            className="w-14 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                          {canEdit && (
                            <button onClick={() => removeMaterial(selected.idx, mIdx)}
                              className="p-1 rounded text-red-500 hover:bg-red-50" title="删除材料">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 未选中步骤时的提示 */}
            {!selected && rows.length > 0 && (
              <p className="mt-3 text-[11px] text-gray-400 text-center py-2">
                点击甘特图任务条或左侧列表行选中步骤，可修改步骤内容、新增/删除/移动步骤与一键排期
              </p>
            )}
          </>
        )}
      </div>

      {/* ─── 订单状态跟踪（自仪表盘迁移） ─── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-lg font-semibold text-gray-800">订单状态跟踪</h2>
          <button
            onClick={handleSortToggle}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            title={`按订单状态${sortMode === 'statusAsc' ? '升序' : '降序'}（点击切换）`}
          >
            <ArrowUpDown size={14} className="text-gray-400" />
            <span className="text-gray-600">状态排序</span>
            {sortMode === 'statusAsc'
              ? <ArrowUp size={12} className="text-gray-500" />
              : <ArrowDown size={12} className="text-gray-500" />}
          </button>
        </div>

        {trackingQuotes.length === 0 ? (
          <p className="text-gray-500 text-center py-8">{loading ? '加载中…' : '暂无符合条件的订单'}</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              {/* 日期表头（含年/月标识：首列与每月 1 日标注年月，今天高亮）；左列复用为选中状态标签区 */}
              <div className="flex items-center gap-4 border-b border-gray-200 pb-2 mb-2">
                <div className="w-72 shrink-0 flex flex-wrap items-center content-center gap-1.5 pr-2">
                  {statuses.length === 0 ? (
                    <span className="text-xs text-gray-400">全部状态</span>
                  ) : (
                    statuses.slice().sort((a, b) => a - b).map((s) => {
                      const opt = STATUS_OPTIONS.find((o) => o.value === s)
                      if (!opt) return null
                      return (
                        <span
                          key={s}
                          className={`px-2 py-0.5 text-xs rounded-full ${getOrderStatusStyle(s).color} cursor-pointer hover:opacity-70`}
                          onClick={() => handleStatusToggle(s)}
                          title="点击移除"
                        >
                          {opt.label} ✕
                        </span>
                      )
                    })
                  )}
                </div>
                <div className="flex-1 flex">
                  {ganttDays.map((day, index) => {
                    const isToday = toLocalDateStr(day) === todayStr
                    const isMonthStart = index === 0 || day.getDate() === 1
                    return (
                      <div key={index} className="flex-1 text-center text-xs" style={{ minWidth: '35px' }}>
                        <span className={`block ${isToday ? 'text-red-600 font-bold' : 'text-gray-500'}`}>
                          {day.getMonth() + 1}/{day.getDate()}
                        </span>
                        {isToday ? (
                          <span className="block text-red-600 font-bold">今天</span>
                        ) : isMonthStart ? (
                          <span className="block text-[10px] text-gray-400 whitespace-nowrap">
                            {day.getFullYear()}年{day.getMonth() + 1}月
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                <div className="w-28 shrink-0 text-right">
                  <span className="text-xs text-gray-500">日期范围</span>
                </div>
              </div>

              {/* 订单行 */}
              {trackingQuotes.map((quote) => {
                const barStyle = getGanttBarStyle(quote)
                const progress = calculateProgress(quote)
                const startDateStr = getQuoteStartDateStr(quote)
                const endDateStr = quote.productionTimeEnd
                const statusStyle = getOrderStatusStyle(quote.status)

                return (
                  <div
                    key={quote.id}
                    onDoubleClick={() => navigate(hasPermission('quotes:edit') ? `/quotes/${quote.id}/edit` : `/quotes/${quote.id}`)}
                    title={hasPermission('quotes:edit') ? '双击进入编辑模式' : '双击查看订单详情'}
                    className="flex items-center gap-4 py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <div className="w-72 shrink-0 flex items-center gap-2">
                      {/* 产品首图 */}
                      {imageFlags[quote.id] ? (
                        <img
                          src={api.quotes.getThumbnailUrl(quote.id, quote.updated_at)}
                          alt="产品图"
                          loading="lazy"
                          className="w-8 h-8 rounded-lg object-cover border border-gray-200 flex-shrink-0"
                          onError={(e) => {
                            const target = e.currentTarget
                            target.style.display = 'none'
                            const placeholder = target.nextElementSibling as HTMLElement
                            if (placeholder) placeholder.style.display = 'flex'
                          }}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-[10px] font-bold text-gray-400">{quote.customerName.charAt(0)}</span>
                        </div>
                      )}
                      {/* onError 时的占位符（默认隐藏） */}
                      <div className="w-8 h-8 rounded-lg bg-gray-100 items-center justify-center flex-shrink-0" style={{ display: 'none' }}>
                        <span className="text-[10px] font-bold text-gray-400">{quote.customerName.charAt(0)}</span>
                      </div>
                      {/* 文字信息：状态标签 + 客户名同行，款式+数量副标题 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0 text-[10px] font-medium rounded-full ${statusStyle.color}`}>
                            {OrderStatus.getLabel(quote.status)}
                          </span>
                          <p className="text-sm font-medium text-gray-800 truncate">{quote.customerName}</p>
                        </div>
                        <p className="text-xs text-gray-500 truncate">
                          {quote.quote_number} · {getStyleLabelFromProducts(products, quote.productStyle)} · {quote.quantity}个
                        </p>
                      </div>
                    </div>
                    <div className="flex-1 relative h-8">
                      {/* 背景轨道 */}
                      <div className="absolute inset-y-2 left-0 right-0 bg-gray-100 rounded-full"></div>
                      {/* 总时间进度条（浅色） */}
                      <div className={`absolute inset-y-2 rounded-full transition-all duration-300 ${statusStyle.bgLightColor}`} style={barStyle}>
                        {/* 当前进度条（深色） */}
                        <div className={`absolute top-0 bottom-0 left-0 rounded-full transition-all duration-300 ${statusStyle.bgColor}`} style={{ width: `${progress}%` }}></div>
                      </div>
                      {/* 今天标记 */}
                      <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 rounded-full z-10" style={{ left: `${todayMarkPercent}%` }}></div>
                    </div>
                    <div className="w-28 shrink-0 text-right">
                      {startDateStr || endDateStr ? (
                        <p className="text-xs text-gray-500">
                          {startDateStr ? formatQuoteDate(startDateStr) : '—'} → {endDateStr ? formatQuoteDate(endDateStr) : '—'}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400">暂无日期</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
