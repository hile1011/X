/**
 * 产品成本项配置 - 列表查询页（/product-cost-items）
 *
 * 树形结构展示「成本项（父级）→ 可选工艺（子级）」，默认完全展开：
 *   - 父级表头（成本项名称/工艺数量/字段数量/更新时间/创建时间，深蓝底）置顶 sticky
 *   - 子级表头（工艺名称/成本金额/计算公式/特点描述/备注 + 该成本项的自定义字段名，浅蓝底）
 *     不统一置顶，而是内嵌在每个子列表之前随子列表独立展示——表头与其子列表数据
 *     （含自定义字段值）逐组对应，保证视觉归属与数据关联
 *   - 视觉层级：父行 Folder 图标 + 折叠箭头；子表头「子」徽标 + Tag 自定义字段图标；
 *             子行缩进 + CornerDownRight 连接线 + Wrench 图标
 *   - 模糊查询：成本项名称 + 工艺名称双输入框，输入即过滤（useMemo 实时响应），
 *     大小写不敏感 substring 匹配，命中文本黄色高亮；查询期间强制展开全部结果节点
 *   - 多条件组合（AND）：父项可见 ⇔（成本项名匹配）∧（无工艺查询 ∨ 存在匹配工艺）；
 *             工艺可见 ⇔ 无工艺查询 ∨ 工艺名匹配
 *   - 虚拟滚动：固定行高 + 可视窗口渲染（大数据量下仅渲染可见行 ± 缓冲），表头 sticky
 *
 * 纯函数（filterCostTree / buildTreeRows / computeVisibleRange / formatDateTime）导出供单元测试。
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Trash2, X, Search, ChevronDown, ChevronRight,
  FolderOpen, Folder, CornerDownRight, Wrench, ChevronsUpDown, ChevronsDownUp, Loader2, Tag,
} from 'lucide-react'
import { api } from '../api'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { usePermission } from '../hooks/usePermission'
import { FIELD_TYPE_LABELS } from './ProductCostItems'
import type { ProductCostItem, ProductCostProcess } from '../types'

// ─── 常量 ────────────────────────────────────────────────────

/** 树表格统一行高（父/子行一致，虚拟滚动按此计算窗口） */
const ROW_HEIGHT = 52
/** 虚拟滚动可视窗口外的上下缓冲行数 */
const OVERSCAN = 6
/** 虚拟滚动容器默认视口高度（ResizeObserver 未生效/测试环境下的兜底） */
const FALLBACK_VIEWPORT = 640

// ─── 纯函数（导出供单元测试） ─────────────────────────────────

/**
 * 模糊查询过滤（多条件 AND 组合，大小写不敏感 substring）：
 *   - itemQuery：成本项名称关键字（空 = 不过滤）
 *   - processQuery：工艺名称关键字（空 = 不过滤）
 *   - 父项可见 ⇔（无 itemQuery ∨ 名称命中）∧（无 processQuery ∨ 其下存在工艺命中）
 *   - 工艺可见 ⇔ 无 processQuery ∨ 工艺名命中（父项因自身名称命中而可见时，仍只展示命中工艺，
 *     组合查询语义为「该成本项下匹配的工艺」；仅 itemQuery 命中时展示全部工艺）
 */
export function filterCostTree(
  items: ProductCostItem[],
  itemQuery: string,
  processQuery: string,
): ProductCostItem[] {
  const iq = itemQuery.trim().toLowerCase()
  const pq = processQuery.trim().toLowerCase()
  if (!iq && !pq) return items
  return items
    .map((item) => {
      const processes = pq
        ? item.processes.filter((p) => p.name.toLowerCase().includes(pq))
        : item.processes
      return { ...item, processes }
    })
    .filter((item) => {
      const itemMatched = !iq || item.name.toLowerCase().includes(iq)
      const hasProcess = !pq || item.processes.length > 0
      return itemMatched && hasProcess
    })
}

/** 树形表格扁平化行（父行 + 子表头行 + 可见子行按展示顺序交错） */
export interface TreeRow {
  kind: 'item' | 'subheader' | 'process'
  item: ProductCostItem
  process?: ProductCostProcess
}

/**
 * 将成本项树扁平化为表格行序列：
 *   - 父行后跟一个「子级表头」行——该成本项子列表的专属表头（含其自定义字段名），
 *     随子列表内嵌展示而非统一置顶
 *   - collapsedIds 中的成本项折叠（其子表头与工艺行均不渲染）
 *   - 无工艺的成本项不渲染子表头（无数据可标注）
 *   - forceExpand（查询激活时）忽略折叠状态强制展开，保证查询结果完整展示
 */
export function buildTreeRows(
  items: ProductCostItem[],
  collapsedIds: ReadonlySet<string>,
  forceExpand = false,
): TreeRow[] {
  const rows: TreeRow[] = []
  for (const item of items) {
    rows.push({ kind: 'item', item })
    if ((forceExpand || !collapsedIds.has(item.id)) && item.processes.length > 0) {
      rows.push({ kind: 'subheader', item })
      for (const process of item.processes) {
        rows.push({ kind: 'process', item, process })
      }
    }
  }
  return rows
}

/**
 * 虚拟滚动可见窗口计算：
 *   返回 [start, end) 行索引区间及上下占位高度（spacer 行撑出完整滚动高度）
 */
export function computeVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  totalRows: number,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN,
): { start: number; end: number; padTop: number; padBottom: number } {
  const viewport = Math.max(viewportHeight, FALLBACK_VIEWPORT * 0) || FALLBACK_VIEWPORT
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(totalRows, Math.ceil((scrollTop + viewport) / rowHeight) + overscan)
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (totalRows - end) * rowHeight,
  }
}

/** 数据库时间（ISO / Date 字符串）→ 本地可读格式 YYYY-MM-DD HH:mm（异常时原样返回） */
export function formatDateTime(value: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    return value.length > 16 ? value.slice(0, 16) : value
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── 查询命中高亮 ────────────────────────────────────────────

/** 大小写不敏感命中片段黄色高亮（正则特殊字符转义，全部出现处高亮） */
function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  const kw = keyword.trim()
  if (!kw) return <>{text}</>
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === kw.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">{part}</mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

// ─── 删除目标（父/子行共用一个确认对话框） ────────────────────

interface DeleteTarget {
  kind: 'item' | 'process'
  itemId: string
  processId?: string
}

// ─── 页面组件 ────────────────────────────────────────────────

export default function ProductCostItemList() {
  const navigate = useNavigate()
  const { hasPermission } = usePermission()
  const canCreate = hasPermission('process-costs:create')
  const canDelete = hasPermission('process-costs:delete')

  const [items, setItems] = useState<ProductCostItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 模糊查询（输入即过滤）
  const [itemQuery, setItemQuery] = useState('')
  const [processQuery, setProcessQuery] = useState('')
  // 折叠的成本项 id 集合（默认空 = 完全展开）
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())

  // 新增成本项内联表单
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createFormName, setCreateFormName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  // ─── 数据加载 ──────────────────────────────────────────────

  const loadItems = async (silent = false) => {
    if (!silent) setIsLoading(true)
    try {
      const data = await api.productCostItems.getAll()
      setItems(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || '加载产品成本项失败')
    } finally {
      if (!silent) setIsLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  // ─── 查询过滤（useMemo 实时响应，无防抖延迟） ──────────────

  const hasQuery = itemQuery.trim() !== '' || processQuery.trim() !== ''

  const filteredItems = useMemo(
    () => filterCostTree(items, itemQuery, processQuery),
    [items, itemQuery, processQuery],
  )

  /** 查询激活时强制展开（折叠状态保留，清空查询后恢复） */
  const rows = useMemo(
    () => buildTreeRows(filteredItems, collapsedIds, hasQuery),
    [filteredItems, collapsedIds, hasQuery],
  )

  const stats = useMemo(() => ({
    items: filteredItems.length,
    processes: filteredItems.reduce((sum, item) => sum + item.processes.length, 0),
    totalItems: items.length,
    totalProcesses: items.reduce((sum, item) => sum + item.processes.length, 0),
  }), [filteredItems, items])

  /**
   * 全表自定义字段最大列数（按可见字段计，取过滤结果的最大值）：
   * 各子列表自定义字段数不同，列数不足的子列表以跨列空单元格对齐，
   * 表格总列数随之确定（父级行与占位行按此跨列）。
   */
  const maxCustomFields = useMemo(
    () => filteredItems.reduce((max, it) => Math.max(max, it.fields.filter((f) => f.visible).length), 0),
    [filteredItems],
  )
  /** 表格总列数：子级 5 个基础列 + 自定义字段列 + 操作列 */
  const columnCount = 6 + maxCustomFields

  // ─── 展开/折叠 ────────────────────────────────────────────

  const toggleCollapse = (itemId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const expandAll = () => setCollapsedIds(new Set())
  const collapseAll = () => setCollapsedIds(new Set(filteredItems.map((i) => i.id)))

  // ─── 虚拟滚动 ──────────────────────────────────────────────

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewportHeight(Math.max(240, entry.contentRect.height))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { start, end, padTop, padBottom } = useMemo(
    () => computeVisibleRange(scrollTop, viewportHeight, rows.length),
    [scrollTop, viewportHeight, rows.length],
  )
  const visibleRows = useMemo(() => rows.slice(start, end), [rows, start, end])

  // ─── 新增成本项 ────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = createFormName.trim()
    if (!name) {
      setError('成本项名称不能为空')
      return
    }
    setIsSubmitting(true)
    try {
      const created = await api.productCostItems.createItem({ name })
      // 创建成功后跳转详情页继续配置工艺与自定义字段
      navigate(`/product-cost-items/${created.id}`)
    } catch (err: any) {
      setError(err.message || '新增成本项失败')
      setIsSubmitting(false)
    }
  }

  // ─── 删除 ──────────────────────────────────────────────────

  const getDeleteHandlers = (target: DeleteTarget) => {
    if (target.kind === 'item') {
      return {
        label: '产品成本项',
        deleteFn: (id: string) => api.productCostItems.deleteItem(id),
        deleteCheckFn: (id: string) => api.productCostItems.deleteItemCheck(id),
      }
    }
    return {
      label: '可选工艺',
      deleteFn: (id: string) => api.productCostItems.deleteProcess(target.itemId, id),
      deleteCheckFn: (id: string) => api.productCostItems.deleteProcessCheck(target.itemId, id),
    }
  }

  // ─── 渲染 ──────────────────────────────────────────────────

  const clearQuery = () => {
    setItemQuery('')
    setProcessQuery('')
  }

  return (
    <div className="p-4 sm:p-6">
      {/* ─── 页头 ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">产品成本项配置</h1>
          <p className="text-gray-500 mt-1 text-sm">
            树形查看成本项与可选工艺；点击行内「详情」或双击行进入编辑详情页
          </p>
        </div>
        {canCreate && !showCreateForm && (
          <button
            onClick={() => { setShowCreateForm(true); setCreateFormName('') }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors min-h-[44px] justify-center shrink-0"
          >
            <Plus size={20} />
            新增成本项
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600" aria-label="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ─── 新增成本项内联表单 ────────────────────────────── */}
      {showCreateForm && (
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">新增成本项</h2>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-gray-400 hover:text-gray-600 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100"
              aria-label="关闭"
            >
              <X size={24} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                成本项名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={createFormName}
                onChange={(e) => setCreateFormName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                placeholder="如：印刷成本、布料成本、包装成本"
                required
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 min-h-[44px]"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 justify-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60 min-h-[44px]"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                创建并配置
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── 模糊查询栏 ────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex flex-1 flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] text-sm"
                placeholder="按成本项名称模糊查询，输入即过滤"
                aria-label="按成本项名称模糊查询"
              />
              {itemQuery && (
                <button
                  onClick={() => setItemQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  aria-label="清空成本项查询"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={processQuery}
                onChange={(e) => setProcessQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] text-sm"
                placeholder="按工艺名称模糊查询，输入即过滤"
                aria-label="按工艺名称模糊查询"
              />
              {processQuery && (
                <button
                  onClick={() => setProcessQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                  aria-label="清空工艺查询"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0">
            {/* 查询结果反馈 */}
            <span className="text-xs sm:text-sm text-gray-500 whitespace-nowrap" data-testid="query-stats">
              {hasQuery ? (
                <>命中 <span className="font-medium text-blue-600">{stats.items}</span> 个成本项 /{' '}
                  <span className="font-medium text-blue-600">{stats.processes}</span> 条工艺
                  （共 {stats.totalItems} / {stats.totalProcesses}）</>
              ) : (
                <>共 {stats.totalItems} 个成本项 · {stats.totalProcesses} 条工艺</>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 min-h-[36px]"
                title="展开全部成本项"
              >
                <ChevronsUpDown size={14} />
                全部展开
              </button>
              <button
                onClick={collapseAll}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 min-h-[36px]"
                title="收起全部成本项"
              >
                <ChevronsDownUp size={14} />
                全部收起
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 树形列表（双表头 + 虚拟滚动） ─────────────────── */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div
          ref={scrollRef}
          className="overflow-auto max-h-[calc(100vh-320px)] min-h-[240px]"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              {/* 父级表头（深蓝底）：成本项字段。
                  子级表头不统一置顶——随各子列表内嵌展示（见 tbody 的 subheader 行），
                  以承载各成本项独立配置的自定义字段名。 */}
              <tr>
                <th className="bg-blue-600 text-white px-4 py-2.5 text-left text-xs font-semibold whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-4 h-4 rounded bg-white/20 text-[10px] leading-4 text-center shrink-0">父</span>
                    成本项名称
                  </span>
                </th>
                <th className="bg-blue-600 text-white px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">工艺数量</th>
                <th className="bg-blue-600 text-white px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">字段数量</th>
                <th className="bg-blue-600 text-white px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">更新时间</th>
                <th className="bg-blue-600 text-white px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">创建时间</th>
                {maxCustomFields > 0 && (
                  <th
                    colSpan={maxCustomFields}
                    title="各子列表独立配置的自定义字段，字段名见各子列表的子级表头"
                    className="bg-blue-600 text-white/70 px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap"
                  >
                    自定义字段
                  </th>
                )}
                <th className="bg-blue-600 text-white px-3 py-2.5 text-center text-xs font-semibold whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {/* 顶部占位（虚拟滚动） */}
              {padTop > 0 && (
                <tr aria-hidden="true" style={{ height: padTop }}>
                  <td colSpan={columnCount} />
                </tr>
              )}

              {isLoading ? (
                <tr>
                  <td colSpan={columnCount} className="px-6 py-12 text-center text-gray-500">
                    <Loader2 size={20} className="inline-block animate-spin mr-2 -mt-1" />
                    加载中...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-6 py-12 text-center text-gray-500">
                    暂无成本项配置
                    {canCreate && '，点击右上角「新增成本项」开始配置'}
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-6 py-12 text-center">
                    <p className="text-gray-500 mb-3">
                      未找到匹配
                      {itemQuery.trim() && <>「<span className="text-gray-700 font-medium">{itemQuery.trim()}</span>」</>}
                      {itemQuery.trim() && processQuery.trim() && ' 且 '}
                      {processQuery.trim() && <>「<span className="text-gray-700 font-medium">{processQuery.trim()}</span>」</>}
                      的记录
                    </p>
                    <button
                      onClick={clearQuery}
                      className="px-3 py-1.5 text-sm text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 min-h-[36px]"
                    >
                      清空查询条件
                    </button>
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  if (row.kind === 'item') {
                    const item = row.item
                    const collapsed = collapsedIds.has(item.id)
                    const visibleFieldCount = item.fields.filter((f) => f.visible).length
                    return (
                      <tr
                        key={item.id}
                        className="bg-blue-50/60 hover:bg-blue-100/70 font-medium transition-colors cursor-pointer"
                        style={{ height: ROW_HEIGHT }}
                        onDoubleClick={() => navigate(`/product-cost-items/${item.id}`)}
                      >
                        <td className="px-4 max-w-[280px]">
                          <div className="flex items-center gap-1.5 h-[36px]">
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleCollapse(item.id) }}
                              className="text-blue-600 hover:text-blue-800 p-0.5 rounded shrink-0"
                              aria-label={collapsed ? `展开 ${item.name}` : `折叠 ${item.name}`}
                              aria-expanded={!collapsed}
                            >
                              {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </button>
                            {collapsed
                              ? <Folder size={15} className="text-amber-500 shrink-0" />
                              : <FolderOpen size={15} className="text-amber-500 shrink-0" />}
                            <span className="truncate text-sm text-gray-900" data-name={item.name}>
                              <HighlightText text={item.name} keyword={itemQuery} />
                            </span>
                          </div>
                        </td>
                        <td className="px-3 whitespace-nowrap text-sm text-gray-600">{item.processes.length} 个</td>
                        <td className="px-3 whitespace-nowrap text-sm text-gray-600">
                          {item.fields.length} 个
                          {item.fields.length > visibleFieldCount && (
                            <span className="ml-1 text-xs text-gray-400">（{visibleFieldCount} 显示）</span>
                          )}
                        </td>
                        <td className="px-3 whitespace-nowrap text-sm text-gray-500">{formatDateTime(item.updatedAt)}</td>
                        <td className="px-3 whitespace-nowrap text-sm text-gray-500">{formatDateTime(item.createdAt)}</td>
                        {/* 自定义字段列占位（父行数据不含子级自定义字段，跨列对齐表头） */}
                        {maxCustomFields > 0 && <td colSpan={maxCustomFields} />}
                        <td className="px-3 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => navigate(`/product-cost-items/${item.id}`)}
                            className="text-blue-600 hover:text-blue-900 p-1.5 inline-flex items-center justify-center rounded-lg hover:bg-blue-100"
                            title="查看 / 编辑详情"
                          >
                            <ChevronRight size={18} />
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => setDeleteTarget({ kind: 'item', itemId: item.id })}
                              className="text-red-600 hover:text-red-900 p-1.5 inline-flex items-center justify-center rounded-lg hover:bg-red-50 ml-1"
                              title="删除成本项"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  }

                  // 子级表头：随子列表内嵌展示（不置顶），承载该成本项的子级字段 + 自定义字段名
                  if (row.kind === 'subheader') {
                    const subItem = row.item
                    const subFields = subItem.fields.filter((f) => f.visible)
                    const subFiller = maxCustomFields - subFields.length
                    return (
                      <tr
                        key={`sub-${subItem.id}`}
                        className="bg-blue-100 text-blue-800"
                        style={{ height: ROW_HEIGHT }}
                      >
                        <td className="px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 pl-7 h-[36px] text-xs font-semibold">
                            <span className="inline-block w-4 h-4 rounded bg-blue-600/20 text-[10px] leading-4 text-center shrink-0">子</span>
                            工艺名称
                          </div>
                        </td>
                        <td className="px-3 whitespace-nowrap text-xs font-semibold">成本金额（元）</td>
                        <td className="px-3 whitespace-nowrap text-xs font-semibold">计算公式</td>
                        <td className="px-3 whitespace-nowrap text-xs font-semibold">特点描述</td>
                        <td className="px-3 whitespace-nowrap text-xs font-semibold">备注</td>
                        {subFields.map((field) => (
                          <td
                            key={field.id}
                            className="px-3 whitespace-nowrap text-xs font-semibold"
                            title={`自定义字段 · ${FIELD_TYPE_LABELS[field.fieldType]}`}
                          >
                            <span className="inline-flex items-center gap-1">
                              <Tag size={11} className="shrink-0 opacity-70" />
                              {field.name}
                            </span>
                          </td>
                        ))}
                        {subFiller > 0 && <td colSpan={subFiller} />}
                        <td className="px-3 text-center text-xs font-semibold whitespace-nowrap">操作</td>
                      </tr>
                    )
                  }

                  const item = row.item
                  const process = row.process!
                  const procFields = item.fields.filter((f) => f.visible)
                  const procFiller = maxCustomFields - procFields.length
                  return (
                    <tr
                      key={process.id}
                      className="hover:bg-gray-50 transition-colors"
                      style={{ height: ROW_HEIGHT }}
                      onDoubleClick={() => navigate(`/product-cost-items/${item.id}`)}
                    >
                      <td className="px-4 max-w-[280px]">
                        <div className="flex items-center pl-9 h-[36px]">
                          <CornerDownRight size={14} className="text-gray-300 mr-2 shrink-0" />
                          <Wrench size={14} className="text-gray-400 mr-1.5 shrink-0" />
                          <span className="truncate text-sm text-gray-700" data-name={process.name}>
                            <HighlightText text={process.name} keyword={processQuery} />
                          </span>
                        </div>
                      </td>
                      <td className="px-3 whitespace-nowrap text-sm text-gray-600 tabular-nums">
                        ¥{process.cost.toFixed(2)}
                      </td>
                      <td className="px-3 max-w-[160px]">
                        <div className="truncate text-sm text-gray-500" title={process.formula || undefined}>
                          {process.formula || '—'}
                        </div>
                      </td>
                      <td className="px-3 max-w-[200px]">
                        <div className="truncate text-sm text-gray-500" title={process.features || undefined}>
                          {process.features || '—'}
                        </div>
                      </td>
                      <td className="px-3 max-w-[180px]">
                        <div className="truncate text-sm text-gray-500" title={process.remark || undefined}>
                          {process.remark || '—'}
                        </div>
                      </td>
                      {/* 自定义字段值：与子级表头的字段名逐列对应 */}
                      {procFields.map((field) => (
                        <td
                          key={field.id}
                          className="px-3 whitespace-nowrap text-sm text-gray-600"
                          title={`${field.name}：${process.customValues[field.id] || '—'}`}
                        >
                          {process.customValues[field.id] || '—'}
                        </td>
                      ))}
                      {procFiller > 0 && <td colSpan={procFiller} />}
                      <td className="px-3 whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/product-cost-items/${item.id}`)}
                          className="text-blue-600 hover:text-blue-900 p-1.5 inline-flex items-center justify-center rounded-lg hover:bg-blue-50"
                          title="查看 / 编辑所属成本项详情"
                        >
                          <ChevronRight size={18} />
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setDeleteTarget({ kind: 'process', itemId: item.id, processId: process.id })}
                            className="text-red-600 hover:text-red-900 p-1.5 inline-flex items-center justify-center rounded-lg hover:bg-red-50 ml-1"
                            title="删除可选工艺"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}

              {/* 底部占位（虚拟滚动） */}
              {padBottom > 0 && (
                <tr aria-hidden="true" style={{ height: padBottom }}>
                  <td colSpan={columnCount} />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 底部行数说明 */}
        {!isLoading && items.length > 0 && filteredItems.length > 0 && (
          <div className="px-4 py-2.5 text-xs text-gray-400 border-t border-gray-100 bg-gray-50/50">
            展示 {rows.length} 行 · {stats.items} 个成本项 · {stats.processes} 条工艺
            {rows.length >= 100 && ' · 已启用虚拟滚动，仅渲染可视区域行'}
          </div>
        )}
      </div>

      {/* ─── 删除确认 ────────────────────────────────────────── */}
      {deleteTarget && (
        <DeleteConfirmDialog
          entityId={deleteTarget.processId ?? deleteTarget.itemId}
          entityLabel={getDeleteHandlers(deleteTarget).label}
          deleteFn={getDeleteHandlers(deleteTarget).deleteFn}
          deleteCheckFn={getDeleteHandlers(deleteTarget).deleteCheckFn}
          onDeleted={() => loadItems(true)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
