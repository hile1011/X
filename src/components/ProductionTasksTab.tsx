/**
 * 订单做货流程标签页（v24）
 *
 * 结构（设计文档 §2.3）：
 *   - 顶部工具栏：汇总信息 + 同步状态徽标 + 一键排期 / 撤销排期 / 添加步骤 / 保存
 *   - VTable-Gantt 甘特图：左侧任务列表 + 右侧时间轴
 *       主条（可拖拽移动/拉伸调整时长）= 计划排期 planStart/planEnd
 *       baseline 条（只读）= 实际执行 actualStart/actualEnd
 *       进度内芯 = 状态映射（0/50/100）
 *   - 任务详情编辑区：名称/状态/计划与实际起止/备注 + 材料准备清单
 *
 * 双向同步（设计文档 §3.2）：编辑 → debounce 600ms → PUT 整体替换；
 * 拖拽/拉伸结束（change_date_range）→ 更新 planStart/planEnd → 同一保存通道。
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Gantt, TYPES } from '@visactor/vtable-gantt'
import type { GanttConstructorOptions } from '@visactor/vtable-gantt'
import { Play, Plus, Save, Loader2, Zap, Trash2, ChevronUp, ChevronDown, Package, AlertCircle, CheckCircle2, CloudUpload, Undo2 } from 'lucide-react'
import { api } from '../api'
import {
  type ProductionTask, type ProductionTaskMaterial, type ProductionTaskSyncStatus,
  createDefaultTasks, resolveStatusByActualTimes, autoSchedule, toGanttRecords,
  computeTimelineRange, computeInitialFocusDate, summarizeTasks, normalizeGanttDateArg,
} from '../services/productionTasks'

interface ProductionTasksTabProps {
  quoteId: string
  readOnly: boolean
  /** 订单当前状态（<3 时顶部提示"预排期"） */
  orderStatus: number
  /** 订单做货起止日期（一键排期区间；格式 YYYY-MM-DD 或空） */
  productionTimeStart: string
  productionTimeEnd: string
}

/** 状态徽标配置 */
const SYNC_BADGE: Record<ProductionTaskSyncStatus, { text: string; cls: string }> = {
  idle: { text: '未修改', cls: 'bg-gray-100 text-gray-500' },
  dirty: { text: '待保存…', cls: 'bg-amber-100 text-amber-700' },
  saving: { text: '保存中…', cls: 'bg-blue-100 text-blue-700' },
  saved: { text: '已保存', cls: 'bg-green-100 text-green-700' },
  error: { text: '保存失败，点击保存重试', cls: 'bg-red-100 text-red-700' },
}

const STATUS_OPTIONS = [
  { value: 0, label: '未开始' },
  { value: 1, label: '进行中' },
  { value: 2, label: '已完成' },
]

/** 计划条颜色（按状态渐进；深色保证白底上可见、白字可读） */
const PLAN_BAR_COLORS = ['#60a5fa', '#2563eb', '#16a34a']

export default function ProductionTasksTab({
  quoteId, readOnly, orderStatus, productionTimeStart, productionTimeEnd,
}: ProductionTasksTabProps) {
  const [tasks, setTasks] = useState<ProductionTask[]>([])
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<ProductionTaskSyncStatus>('idle')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  // 一键排期撤回快照：排期前的任务数组；排期后发生其他编辑（改字段/增删移/拖拽）即失效清空
  const [undoSnapshot, setUndoSnapshot] = useState<ProductionTask[] | null>(null)

  const ganttRef = useRef<HTMLDivElement>(null)
  const ganttInstanceRef = useRef<any>(null)
  const tasksRef = useRef<ProductionTask[]>([])
  const rangeRef = useRef<{ minDate: string; maxDate: string } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSeqRef = useRef(0)

  tasksRef.current = tasks

  // ─── 数据加载 ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setUndoSnapshot(null)
    api.quotes.getProductionTasks(quoteId)
      .then((data: unknown) => {
        if (cancelled) return
        const list = Array.isArray(data) ? (data as ProductionTask[]) : []
        // 空数据：初始化默认 6 步（内存态，首次编辑时保存）
        setTasks(list.length > 0 ? list : createDefaultTasks())
        setSyncStatus('idle')
      })
      .catch(() => {
        if (!cancelled) setErrorMsg('做货流程加载失败，请刷新重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [quoteId])

  // ─── 保存（整体替换） ─────────────────────────────────────
  /** 本地预校验：任务名/材料名非空（与后端 validateTasks 一致），返回首个错误信息，通过返回 null */
  const validateLocal = (list: ProductionTask[]): string | null => {
    for (const t of list) {
      if (!t.name?.trim()) return '任务名称不能为空'
      for (const m of t.materials) {
        if (!m.name?.trim()) return '材料名称不能为空：请填写或删除未命名的材料行'
      }
    }
    return null
  }

  const saveTasks = useCallback(async (manual = false) => {
    const current = tasksRef.current
    // 预校验：新增材料行默认名称为空、任务名可被清空，此时跳过保存（保持"待保存"状态），
    // 避免自动保存被后端 400 拒绝后进入"保存失败"状态
    const localError = validateLocal(current)
    if (localError) {
      setSyncStatus('dirty')
      if (manual) setErrorMsg(localError)
      return
    }
    const seq = ++saveSeqRef.current
    setSyncStatus('saving')
    try {
      const saved = await api.quotes.saveProductionTasks(quoteId, current) as ProductionTask[]
      if (seq !== saveSeqRef.current) return // 已有更新的保存请求，丢弃过期响应
      setTasks(saved)
      setSyncStatus('saved')
      setErrorMsg('')
    } catch {
      if (seq !== saveSeqRef.current) return
      setSyncStatus('error')
    }
  }, [quoteId])

  /** 编辑入口统一走这里：更新任务并调度自动保存 */
  const updateTasks = useCallback((next: ProductionTask[]) => {
    setTasks(next)
    if (readOnly) return
    setSyncStatus('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      saveTasks()
    }, 600)
  }, [readOnly, saveTasks])

  // 卸载时清理定时器与实例
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      ganttInstanceRef.current?.release?.()
      ganttInstanceRef.current = null
    }
  }, [])

  // ─── 甘特图实例 ───────────────────────────────────────────
  const buildOptions = useCallback((): GanttConstructorOptions => {
    const records = toGanttRecords(tasksRef.current).map((r) => ({
      ...r,
      statusLabel: STATUS_OPTIONS[r.status]?.label || '未开始',
      materialsLabel: r.materialsCount > 0 ? `${r.materialsCount} 项` : '-',
    }))
    const range = computeTimelineRange(tasksRef.current)
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
            const w = dt.getMonth() + 1
            const day = dt.getDate()
            return `${w}/${String(day).padStart(2, '0')} 周`
          } },
          { unit: 'day', step: 1, rowHeight: 24, format: (d) => String(d.startDate.getDate()) },
        ],
      },
      taskListTable: {
        tableWidth: 240,
        columns: [
          {
            field: 'name', title: '步骤', width: 112,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 8, 6, 8] },
            style: { fontSize: 12, padding: [4, 8, 4, 8], color: '#334155' },
          },
          {
            field: 'statusLabel', title: '状态', width: 72,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 4, 6, 4], textAlign: 'center' },
            style: { fontSize: 12, padding: [4, 4, 4, 4], textAlign: 'center', color: '#334155' },
          },
          {
            field: 'materialsLabel', title: '材料', width: 56,
            headerStyle: { fontSize: 12, color: '#475569', padding: [6, 4, 6, 4], textAlign: 'center' },
            style: { fontSize: 12, padding: [4, 4, 4, 4], textAlign: 'center', color: '#334155' },
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
        labelText: '{name}',
        labelTextStyle: { color: '#fff', fontSize: 11, textAlign: 'center' },
        moveable: !readOnly,
        resizable: !readOnly,
        moveToExtendDateRange: true,
        barStyle: (args) => ({
          barColor: PLAN_BAR_COLORS[Number(args.taskRecord?.status ?? 0)] || PLAN_BAR_COLORS[0],
          completedBarColor: 'rgba(255,255,255,0.55)',
          cornerRadius: 4,
          // 注意：barStyle 为函数时返回值不与默认样式合并（gantt-helper 直接使用返回值），
          // 缺少 width（条高 px）会导致 y=NaN/height=undefined，任务条整体不可见。
          // 默认条高公式 = 3 * rowHeight / 4（rowHeight=40 → 30）
          width: 30,
        }),
        baselineStyle: { barColor: '#fb923c', cornerRadius: 4 },
      },
      markLine: true,
      frame: {
        outerFrameStyle: { borderLineWidth: 1, borderColor: '#e2e8f0' },
        verticalSplitLine: { lineDash: [], lineWidth: 1, lineColor: '#e2e8f0' },
      },
    }
  }, [readOnly])

  useEffect(() => {
    if (!ganttRef.current || loading) return
    // VTable 初始化时会调用 scrollIntoView 导致页面滚动，临时屏蔽（与 BagQuote/SheetTemplates 一致）
    const origScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { /* no-op during init */ }

    const gantt = new Gantt(ganttRef.current, buildOptions())
    ganttInstanceRef.current = gantt

    // 初始视口定位：滚动到「今天 vs 最早计划开始」中较早者。
    // 延迟到首帧后执行——构造期 scenegraph 尚未完成首帧渲染，立即调用会被内部
    // _scrollToMarkLine()（滚到今天线）或后续渲染覆盖
    const focusDate = computeInitialFocusDate(tasksRef.current)
    requestAnimationFrame(() => {
      try { ganttInstanceRef.current?.scrollToMarkLine(focusDate) } catch { /* 定位失败不影响主流程 */ }
    })

    // 拖拽移动 / 拉伸调整时长结束（change_date_range：移动与拉伸均触发此事件；
    // startDate/endDate 为库 formatDate 后的字符串，需归一化，直接当 Date 用会抛错）
    gantt.on(TYPES.GANTT_EVENT_TYPE.CHANGE_DATE_RANGE, (args) => {
      if (readOnly) return
      const id = args.record?.id
      const idx = tasksRef.current.findIndex((t) => t.id === id)
      if (idx < 0) return
      const planStart = normalizeGanttDateArg(args.startDate)
      const planEnd = normalizeGanttDateArg(args.endDate)
      if (!planStart || !planEnd || planStart > planEnd) return
      const next = [...tasksRef.current]
      next[idx] = { ...next[idx], planStart, planEnd }
      setUndoSnapshot(null) // 排期后拖拽调整 → 排期快照失效
      updateTasks(next)
    })
    // 点击任务条：选中对应任务，滚动到详情编辑区
    gantt.on(TYPES.GANTT_EVENT_TYPE.CLICK_TASK_BAR, (args) => {
      const idx = tasksRef.current.findIndex((t) => t.id === args.record?.id)
      if (idx >= 0) setSelectedIdx(idx)
    })

    // 左侧任务列表行点击：同样联动选中（点击"步骤"名称等单元格）
    const listTable = (gantt as any).taskListTableInstance
    listTable?.on?.('click_cell', (args: { originData?: { id?: string } }) => {
      const idx = tasksRef.current.findIndex((t) => t.id === args?.originData?.id)
      if (idx >= 0) setSelectedIdx(idx)
    })

    // 容器尺寸自适应：VTable-Gantt 不监听容器 resize（Tab 显隐 / 窗口缩放 / 侧栏折叠），
    // 尺寸实际变化时调用内部 _resize() 重算画布与布局，避免甘特图显示不全或宽度异常
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
  }, [loading, readOnly])

  // tasks 变化：同步甘特图（range 变化需 updateOption，否则 setRecords）
  useEffect(() => {
    const gantt = ganttInstanceRef.current
    if (!gantt || loading) return
    const records = toGanttRecords(tasks).map((r) => ({
      ...r,
      statusLabel: STATUS_OPTIONS[r.status]?.label || '未开始',
      materialsLabel: r.materialsCount > 0 ? `${r.materialsCount} 项` : '-',
    }))
    const range = computeTimelineRange(tasks)
    if (rangeRef.current && (rangeRef.current.minDate !== range.minDate || rangeRef.current.maxDate !== range.maxDate)) {
      rangeRef.current = range
      gantt.updateOption({ ...buildOptions(), records })
      // updateOption 重建后视口重置到 minDate，重新定位到当前排期
      try { gantt.scrollToMarkLine(computeInitialFocusDate(tasks)) } catch { /* 忽略 */ }
    } else {
      gantt.setRecords(records)
    }
  }, [tasks, loading, buildOptions])

  // ─── 编辑操作 ─────────────────────────────────────────────
  const patchTask = (idx: number, patch: Partial<ProductionTask>) => {
    const next = [...tasks]
    next[idx] = { ...next[idx], ...patch }
    // 状态联动：实际时间变化时纠正状态（设计文档 §3.3）
    if (patch.actualStart !== undefined || patch.actualEnd !== undefined) {
      const resolved = resolveStatusByActualTimes(next[idx])
      if (next[idx].status !== resolved) next[idx] = { ...next[idx], status: resolved }
    }
    setUndoSnapshot(null)
    updateTasks(next)
  }

  const handleAddTask = () => {
    const next = [...tasks, {
      id: `tmp-${Date.now()}`,
      stepOrder: tasks.length + 1,
      name: '新步骤',
      planStart: null, planEnd: null, actualStart: null, actualEnd: null,
      status: 0 as const, remark: '', materials: [],
    }]
    setSelectedIdx(next.length - 1)
    setUndoSnapshot(null)
    updateTasks(next)
  }

  const handleRemoveTask = (idx: number) => {
    const next = tasks.filter((_, i) => i !== idx)
    setSelectedIdx((prev) => (prev === null ? null : prev === idx ? null : prev > idx ? prev - 1 : prev))
    setUndoSnapshot(null)
    updateTasks(next)
  }

  const handleMoveTask = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= tasks.length) return
    const next = [...tasks]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setSelectedIdx(target)
    setUndoSnapshot(null)
    updateTasks(next)
  }

  const handleAutoSchedule = () => {
    const scheduled = autoSchedule(tasks, productionTimeStart, productionTimeEnd)
    if (!scheduled) {
      setErrorMsg('一键排期需要先填写订单的做货开始与结束日期')
      return
    }
    setErrorMsg('')
    setUndoSnapshot(tasks) // 排期前快照（内容不可变，引用安全）
    updateTasks(scheduled)
  }

  /** 撤销最近一次一键排期：恢复排期前的任务（含计划时间）并走同一保存通道 */
  const handleUndoSchedule = () => {
    if (!undoSnapshot) return
    setErrorMsg('')
    setUndoSnapshot(null)
    updateTasks(undoSnapshot)
  }

  const handleManualSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveTasks(true)
  }

  // ─── 材料清单操作 ─────────────────────────────────────────
  const patchMaterials = (idx: number, materials: ProductionTaskMaterial[]) => {
    patchTask(idx, { materials })
  }

  const addMaterial = (idx: number) => {
    patchMaterials(idx, [...tasks[idx].materials, { name: '', spec: '', quantity: 1, unit: '', ready: false }])
  }

  const patchMaterial = (idx: number, mIdx: number, patch: Partial<ProductionTaskMaterial>) => {
    const next = tasks[idx].materials.map((m, i) => (i === mIdx ? { ...m, ...patch } : m))
    patchMaterials(idx, next)
  }

  const removeMaterial = (idx: number, mIdx: number) => {
    patchMaterials(idx, tasks[idx].materials.filter((_, i) => i !== mIdx))
  }

  // ─── 渲染 ─────────────────────────────────────────────────
  const summary = summarizeTasks(tasks)
  const badge = SYNC_BADGE[syncStatus]
  const selected = selectedIdx != null && selectedIdx < tasks.length ? tasks[selectedIdx] : null
  const allDone = tasks.length > 0 && tasks.every((t) => t.status === 2)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Play className="text-gray-400" size={15} />
        <h3 className="text-xs font-semibold text-gray-700">订单做货流程</h3>
        <span className="text-[11px] text-gray-400">
          {summary.completed}/{summary.total} 步完成 · 材料 {summary.materialsReady}/{summary.materialsTotal} 备齐 · 计划 {summary.planRange}
        </span>
        <div className="flex-1" />
        {!readOnly && (
          <>
            <button
              onClick={handleAutoSchedule}
              disabled={loading}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              <Zap size={13} /> 一键排期
            </button>
            <button
              onClick={handleUndoSchedule}
              disabled={loading || !undoSnapshot}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              title={undoSnapshot ? '撤销最近一次一键排期，恢复排期前的计划时间' : '暂无可撤销的排期（排期后发生其他修改则不可撤销）'}
            >
              <Undo2 size={13} /> 撤销排期
            </button>
            <button
              onClick={handleAddTask}
              disabled={loading || tasks.length >= 50}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Plus size={13} /> 添加步骤
            </button>
            <button
              onClick={handleManualSave}
              disabled={syncStatus === 'saving' || loading}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {syncStatus === 'saving' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 保存
            </button>
          </>
        )}
        {!readOnly && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>
            {syncStatus === 'saving' && <CloudUpload size={11} className="inline mr-0.5 -mt-0.5" />}
            {syncStatus === 'error' && <AlertCircle size={11} className="inline mr-0.5 -mt-0.5" />}
            {syncStatus === 'saved' && <CheckCircle2 size={11} className="inline mr-0.5 -mt-0.5" />}
            {badge.text}
          </span>
        )}
      </div>

      {/* 预排期 / 全部完成提示 */}
      {orderStatus < 3 && !loading && (
        <div className="mb-2 px-3 py-1.5 text-[11px] text-amber-700 bg-amber-50 rounded-lg">
          做货尚未开始，当前为预排期（进入「做货中」状态后按此排期执行）
        </div>
      )}
      {allDone && !loading && (
        <div className="mb-2 px-3 py-1.5 text-[11px] text-green-700 bg-green-50 rounded-lg">
          做货流程已全部完成，可流转至「已发货」状态
        </div>
      )}
      {errorMsg && (
        <div className="mb-2 px-3 py-1.5 text-[11px] text-red-700 bg-red-50 rounded-lg">{errorMsg}</div>
      )}

      {/* 甘特图 / 加载中 */}
      {loading ? (
        <div className="flex items-center justify-center h-[320px] text-gray-400">
          <Loader2 className="animate-spin mr-2" size={18} /> 加载中...
        </div>
      ) : (
        <div className="border border-gray-100 rounded-lg overflow-hidden">
          {/* relative 必须保留：.vtable-gantt 为 absolute 定位（vtable 注入样式），
              缺少 positioned 祖先时甘特图与分割线会相对页面定位，导致与左侧列表重叠错位 */}
          <div ref={ganttRef} className="relative w-full" style={{ height: Math.max(220, tasks.length * 40 + 88) }} />
        </div>
      )}

      {/* 图例 */}
      {!loading && (
        <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block" style={{ background: '#60a5fa' }} />计划（可拖拽移动、拉伸两端调整时长）</span>
          <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block" style={{ background: '#fb923c' }} />实际执行</span>
          <span className="flex items-center gap-1"><i className="w-3 h-2 rounded-sm inline-block" style={{ background: '#16a34a' }} />已完成计划</span>
          <span>点击任务条或左侧列表可编辑详情</span>
        </div>
      )}

      {/* 任务详情编辑区 */}
      {!loading && selected && (
        <div className="mt-3 border border-gray-100 rounded-lg p-3 bg-gray-50/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-gray-700">步骤详情</span>
            <span className="text-[11px] text-gray-400">{selected.name}</span>
            {!readOnly && (
              <div className="flex-1" />
            )}
            {!readOnly && (
              <div className="flex gap-1">
                <button onClick={() => handleMoveTask(selectedIdx!, -1)} disabled={selectedIdx === 0}
                  className="p-1 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-30" title="上移">
                  <ChevronUp size={14} />
                </button>
                <button onClick={() => handleMoveTask(selectedIdx!, 1)} disabled={selectedIdx === tasks.length - 1}
                  className="p-1 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-30" title="下移">
                  <ChevronDown size={14} />
                </button>
                <button onClick={() => handleRemoveTask(selectedIdx!)}
                  className="p-1 rounded text-red-500 hover:bg-red-50" title="删除步骤">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">步骤名称</label>
              <input type="text" value={selected.name} maxLength={64} readOnly={readOnly}
                onChange={(e) => patchTask(selectedIdx!, { name: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">状态</label>
              <select value={selected.status} disabled={readOnly}
                onChange={(e) => patchTask(selectedIdx!, { status: Number(e.target.value) as 0 | 1 | 2 })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none disabled:bg-gray-100">
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">计划开始</label>
              <input type="date" value={selected.planStart || ''} readOnly={readOnly}
                onChange={(e) => patchTask(selectedIdx!, { planStart: e.target.value || null })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">计划结束</label>
              <input type="date" value={selected.planEnd || ''} readOnly={readOnly}
                onChange={(e) => patchTask(selectedIdx!, { planEnd: e.target.value || null })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">实际开始</label>
              <input type="date" value={selected.actualStart || ''} readOnly={readOnly}
                onChange={(e) => patchTask(selectedIdx!, { actualStart: e.target.value || null })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-0.5">实际结束</label>
              <input type="date" value={selected.actualEnd || ''} readOnly={readOnly}
                onChange={(e) => patchTask(selectedIdx!, { actualEnd: e.target.value || null })}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
            </div>
          </div>

          <div className="mt-2">
            <label className="block text-[11px] text-gray-400 mb-0.5">备注</label>
            <input type="text" value={selected.remark} maxLength={255} readOnly={readOnly}
              onChange={(e) => patchTask(selectedIdx!, { remark: e.target.value })}
              placeholder="生产注意事项、外协安排等"
              className="w-full px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
          </div>

          {/* 材料准备清单 */}
          <div className="mt-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Package size={13} className="text-gray-400" />
              <span className="text-[11px] font-semibold text-gray-600">材料准备</span>
              {!readOnly && (
                <button onClick={() => addMaterial(selectedIdx!)} disabled={selected.materials.length >= 50}
                  className="ml-1 text-[11px] text-blue-600 hover:underline disabled:opacity-40">+ 材料</button>
              )}
            </div>
            {selected.materials.length === 0 ? (
              <p className="text-[11px] text-gray-400">暂无材料清单，点击「+ 材料」添加</p>
            ) : (
              <div className="space-y-1">
                {selected.materials.map((m, mIdx) => (
                  <div key={mIdx} className="flex items-center gap-1.5 flex-wrap">
                    <input type="checkbox" checked={m.ready} disabled={readOnly}
                      onChange={(e) => patchMaterial(selectedIdx!, mIdx, { ready: e.target.checked })}
                      className="accent-green-600 w-3.5 h-3.5" title="是否备齐" />
                    <input type="text" value={m.name} placeholder="名称" maxLength={64} readOnly={readOnly}
                      onChange={(e) => patchMaterial(selectedIdx!, mIdx, { name: e.target.value })}
                      className="w-28 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                    <input type="text" value={m.spec} placeholder="规格" maxLength={64} readOnly={readOnly}
                      onChange={(e) => patchMaterial(selectedIdx!, mIdx, { spec: e.target.value })}
                      className="w-24 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                    <input type="number" value={m.quantity} min={0} step="0.01" readOnly={readOnly}
                      onChange={(e) => patchMaterial(selectedIdx!, mIdx, { quantity: Math.round(Number(e.target.value || 0) * 100) / 100 })}
                      className="w-20 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                    <input type="text" value={m.unit} placeholder="单位" maxLength={8} readOnly={readOnly}
                      onChange={(e) => patchMaterial(selectedIdx!, mIdx, { unit: e.target.value })}
                      className="w-14 px-2 py-1 text-xs border border-gray-200 rounded bg-white focus:border-blue-400 focus:outline-none read-only:bg-gray-100" />
                    {!readOnly && (
                      <button onClick={() => removeMaterial(selectedIdx!, mIdx)}
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

      {/* 未选中任务时的提示 */}
      {!loading && !selected && !readOnly && (
        <p className="mt-3 text-[11px] text-gray-400 text-center py-2">点击甘特图任务条或从上方列表选择步骤，可编辑计划、实际时间与材料清单</p>
      )}
    </div>
  )
}
