import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ArrowLeft, Save, Trash2, Table2, Edit2, Loader2, Plus, X, Search, ChevronRight, ChevronDown } from 'lucide-react'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { api } from '../api'
import { useHasPermission } from '../hooks/usePermission'
import { fetchStyleOptions, type StyleOption } from '../services/productStyles'
import { SheetTemplateManager } from '../templates/SheetTemplateManager'
import type { SheetTemplate } from '../templates/types'
import { TableConstants } from '../constants/TableConstants'
import { StyleConstants } from '../constants/StyleConstants'
import { ExcelUtils } from '../utils/ExcelUtils'
import { setupCopyFormulaEnhancement } from '../utils/clipboardCopyEnhancer'

/** 数据库模板记录（后端 SheetTemplateRecord 的前端形态，一对多） */
interface SheetTemplateRecordFE {
  id: string
  styleCode: string
  name: string
  data: (string | number | null)[][]
  formulas: Record<string, string>
  sortOrder: number
  updatedBy: string
  createdAt: string
  updatedAt: string
}

// 内置款式兜底名称（与迁移脚本默认款式一致）
const BUILTIN_STYLE_NAMES: Record<string, string> = {
  '1': '无底无侧普通袋',
  '2': '有底无侧普通袋',
  '3': '有底有侧普通袋',
  '4': '手提连底普通拼接袋',
  '5': '手提连底高级拼接袋',
  '6': '手提无连底拼接袋',
}

// 辅助：构建单元格样式（与 BagQuote 一致：字体加大加粗 + 边框）
const cs = (
  bg?: string, color: string = StyleConstants.COLORS.black, size: number = 10, bold: boolean = true, border: boolean = true,
): Record<string, unknown> => StyleConstants.buildCellStyle(bg, color, size, bold, border)

/**
 * 模板编辑器的单元格样式（独立于 BagQuote，不依赖模块级覆盖 Map）
 * 规则：标题行（第一列无值其他列有值）蓝底白字；公式单元格浅橙背景
 */
function makeGetCellStyle(formulaManagerRef: React.MutableRefObject<any>) {
  return (args: { row: number; col: number; table?: any }): Record<string, unknown> => {
    const { row, col, table } = args
    let isTitleRow = false
    if (table?.getCellOriginValue) {
      const firstColValue = table.getCellOriginValue(0, row)
      if (firstColValue == null || firstColValue === '') {
        for (let c = 1; c < TableConstants.getColumnCount(); c++) {
          const val = table.getCellOriginValue(c, row)
          if (val != null && val !== '') { isTitleRow = true; break }
        }
      }
    }
    const style = isTitleRow ? cs(StyleConstants.COLORS.headerBg, StyleConstants.COLORS.headerColor) : cs(undefined)
    const fm = formulaManagerRef.current
    if (fm?.getCellFormula) {
      const formula = fm.getCellFormula({ sheet: TableConstants.SHEET_KEY, row, col })
      if (formula) style.bgColor = StyleConstants.COLORS.formulaBg
    }
    return style
  }
}

export default function SheetTemplates() {
  const canEdit = useHasPermission('sheet-templates:edit')
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  const [templates, setTemplates] = useState<SheetTemplateRecordFE[]>([])
  const [loading, setLoading] = useState(true)
  // 编辑状态：null = 列表视图；非 null = 编辑对应模板
  const [editingId, setEditingId] = useState<string | null>(null)
  // 新增弹窗
  const [showCreateModal, setShowCreateModal] = useState(false)
  // 搜索与筛选（与订单列表一致的字段查询）
  const [searchTerm, setSearchTerm] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  // 树形展开状态：款式 code → 是否展开（默认全部展开）
  const [expandedStyles, setExpandedStyles] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const c of Object.keys(BUILTIN_STYLE_NAMES)) init[c] = true
    return init
  })

  const toggleStyle = (code: string) => {
    setExpandedStyles((prev) => ({ ...prev, [code]: !prev[code] }))
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [options, records] = await Promise.all([
      fetchStyleOptions(),
      api.sheetTemplates.getAll().catch(() => []),
      // 强制刷新内存缓存：其他用户可能修改过模板
      SheetTemplateManager.loadOverrides(true),
    ])
    // 款式来源：产品管理全部产品（与订单页款式下拉同源），
    // 新增产品（自定义编码或无编码产品）的款式同步出现在模板管理中
    setStyleOptions(options)
    setTemplates((records as SheetTemplateRecordFE[]).filter((r) => r?.id))
    // 默认展开全部款式分组（含新增产品款式），便于直接查看
    setExpandedStyles((prev) => {
      const next = { ...prev }
      for (const o of options) next[o.value] = true
      return next
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const getStyleName = (code: string): string =>
    styleOptions.find((s) => s.value === code)?.label || BUILTIN_STYLE_NAMES[code] || `款式${code}`

  // 全部款式分组：产品款式（与订单页同源）+ 模板中存在但产品已删除的编码（防御展示）
  const allStyleCodes = useMemo(() => {
    const codes = styleOptions.map((o) => o.value)
    for (const t of templates) {
      if (t.styleCode && !codes.includes(t.styleCode)) codes.push(t.styleCode)
    }
    return codes
  }, [styleOptions, templates])

  // 树形列表过滤：搜索词匹配模板名/款式名/更新人；款式筛选仅显示选中款式
  // 款式名命中时展示该款式全部模板；否则仅展示模板名/更新人命中的模板
  const visibleGroups = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return allStyleCodes
      .filter((code) => !styleFilter || styleFilter === code)
      .map((code) => {
        const styleName = getStyleName(code)
        const styleHit = !term || styleName.toLowerCase().includes(term) || code.includes(term)
        const matched = templates
          .filter((t) => t.styleCode === code)
          .filter((t) => styleHit || t.name.toLowerCase().includes(term) || (t.updatedBy || '').toLowerCase().includes(term))
        return { code, styleName, styleHit, templates: matched }
      })
      .filter((g) => g.styleHit || g.templates.length > 0)
  }, [allStyleCodes, templates, searchTerm, styleFilter, styleOptions])

  // 有搜索词或款式筛选时自动展开全部组，便于浏览命中结果
  const hasFilter = !!searchTerm.trim() || !!styleFilter

  const editingRecord = editingId ? templates.find((t) => t.id === editingId) || null : null

  // ─── 编辑视图 ─────────────────────────────────────────────
  if (editingRecord) {
    return (
      <TemplateEditor
        record={editingRecord}
        styleName={getStyleName(editingRecord.styleCode)}
        onBack={() => setEditingId(null)}
        onSaved={(saved) => {
          setTemplates((prev) => prev.map((t) => (t.id === saved.id ? saved : t)))
          setEditingId(null)
        }}
        onDeleted={(id) => {
          setTemplates((prev) => prev.filter((t) => t.id !== id))
          setEditingId(null)
        }}
      />
    )
  }

  // ─── 列表视图 ─────────────────────────────────────────────
  const styleCodes = Object.keys(BUILTIN_STYLE_NAMES)

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 sm:mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">款式模板管理</h1>
          <p className="text-gray-500 mt-1">
            每个款式可配置多个差异化试算表模板；订单选择款式后再选择具体模板，未选择时使用内置默认模板
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap min-h-[40px]"
          >
            <Plus size={16} /> 新增模板
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* 搜索栏（样式与订单列表一致） */}
        <div className="p-4 border-b border-gray-100 flex-shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索模板名称/款式/更新人..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="relative">
              <Table2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none appearance-none cursor-pointer"
              >
                <option value="">全部款式</option>
                {styleOptions.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 树形列表：一级款式（可展开/收起），二级模板 */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={20} /> 加载中...
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-gray-400">未找到匹配的模板</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visibleGroups.map((group) => {
              const expanded = hasFilter || !!expandedStyles[group.code]
              return (
                <div key={group.code}>
                  {/* 一级：款式父节点（点击整行展开/收起） */}
                  <button
                    onClick={() => toggleStyle(group.code)}
                    className="w-full flex items-center gap-2.5 px-5 py-3 bg-gray-50/70 hover:bg-gray-100/70 transition-colors text-left"
                  >
                    {expanded
                      ? <ChevronDown size={16} className="text-gray-400 shrink-0" />
                      : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                      <Table2 size={15} />
                    </div>
                    <span className="font-semibold text-gray-800">{group.styleName}</span>
                    <span className="text-xs text-gray-400">款式 code: {group.code}</span>
                    <span className="ml-auto text-xs text-gray-400">{group.templates.length} 个模板</span>
                  </button>
                  {/* 二级：模板子节点（左侧竖线树形缩进） */}
                  {expanded && (
                    group.templates.length === 0 ? (
                      <div className="ml-[26px] border-l border-gray-200 pl-4 px-4 py-3 text-sm text-gray-400">
                        暂无自定义模板，订单将使用内置默认模板
                        {canEdit && (
                          <button onClick={() => setShowCreateModal(true)} className="ml-2 text-blue-600 hover:underline">
                            立即创建
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="ml-[26px] border-l border-gray-200 divide-y divide-gray-50">
                        {group.templates.map((t) => (
                          <div key={t.id} className="flex items-center gap-4 pl-4 pr-5 py-3 hover:bg-blue-50/40 transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 truncate">{t.name}</div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                最后修改：{t.updatedBy || '-'} · {t.updatedAt?.replace('T', ' ').slice(0, 19) || '-'}
                              </div>
                            </div>
                            <button
                              onClick={() => canEdit && setEditingId(t.id)}
                              disabled={!canEdit}
                              className="flex items-center gap-1.5 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                            >
                              <Edit2 size={15} /> 编辑
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 新增模板弹窗 */}
      {showCreateModal && (
        <CreateTemplateModal
          styleOptions={styleOptions.length > 0 ? styleOptions : styleCodes.map((c) => ({ value: c, label: BUILTIN_STYLE_NAMES[c] } as StyleOption))}
          existingNames={templates}
          onClose={() => setShowCreateModal(false)}
          onCreated={(created) => {
            setTemplates((prev) => [...prev, created])
            // 关闭新增弹窗再进入编辑器：否则从编辑器返回列表时弹窗会再次弹出
            setShowCreateModal(false)
            // 确保返回列表时所属款式处于展开状态，新模板立即可见
            setExpandedStyles((prev) => ({ ...prev, [created.styleCode]: true }))
            setEditingId(created.id)
          }}
        />
      )}
    </div>
  )
}

/** 新增模板弹窗：选择款式 + 输入模板名称 + 初始化方式（内置模板副本/空白） */
function CreateTemplateModal({ styleOptions, existingNames, onClose, onCreated }: {
  styleOptions: StyleOption[]
  existingNames: SheetTemplateRecordFE[]
  onClose: () => void
  onCreated: (record: SheetTemplateRecordFE) => void
}) {
  const [styleCode, setStyleCode] = useState(styleOptions[0]?.value || '1')
  const [name, setName] = useState('')
  const [fromBuiltin, setFromBuiltin] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const trimmed = name.trim()
  const nameConflict = !!trimmed && existingNames.some((t) => t.styleCode === styleCode && t.name === trimmed)

  const handleSubmit = async () => {
    if (!trimmed) {
      setError('请输入模板名称')
      return
    }
    if (nameConflict) {
      setError(`该款式下已存在同名模板「${trimmed}」`)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const template = fromBuiltin ? SheetTemplateManager.getBuiltinTemplate(styleCode) : { data: [[null]], formulas: {} }
      const created = await api.sheetTemplates.create({
        styleCode,
        name: trimmed,
        data: template.data,
        formulas: template.formulas,
      }) as SheetTemplateRecordFE
      // 同步内存缓存：订单页立即可选
      SheetTemplateManager.setOverride(created.id, created.styleCode, created.name, {
        data: created.data, formulas: created.formulas,
      })
      onCreated(created)
    } catch (e: any) {
      setError(e?.message || '创建失败，请重试')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">新增模板</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">所属款式</label>
            <select
              value={styleCode}
              onChange={(e) => setStyleCode(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            >
              {styleOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">模板名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="如：常规报价、加厚款、含手提款"
              maxLength={64}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 focus:outline-none"
            />
            {nameConflict && (
              <div className="text-xs text-red-500 mt-1">该款式下已存在同名模板</div>
            )}
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-2">初始内容</label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="radio" checked={fromBuiltin} onChange={() => setFromBuiltin(true)} className="accent-blue-600" />
              复制内置默认模板（推荐，可直接修改）
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-1.5">
              <input type="radio" checked={!fromBuiltin} onChange={() => setFromBuiltin(false)} className="accent-blue-600" />
              空白模板（从零搭建）
            </label>
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !trimmed || nameConflict}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            创建并编辑
          </button>
        </div>
      </div>
    </div>
  )
}

/** 模板编辑器：VTableSheet 可视化编辑单个模板（含改名/删除） */
function TemplateEditor({ record, styleName, onBack, onSaved, onDeleted }: {
  record: SheetTemplateRecordFE
  styleName: string
  onBack: () => void
  onSaved: (record: SheetTemplateRecordFE) => void
  onDeleted: (id: string) => void
}) {
  const sheetContainerRef = useRef<HTMLDivElement>(null)
  const sheetInstanceRef = useRef<any>(null)
  const formulaManagerRef = useRef<any>(null)
  const [name, setName] = useState(record.name)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  useEffect(() => {
    if (!sheetContainerRef.current) return

    // 编辑当前模板内容（数据库记录为准）
    const template: SheetTemplate = { data: record.data, formulas: record.formulas || {} }

    // VTable 初始化时会调用 scrollIntoView 导致页面滚动，临时屏蔽（与 BagQuote 一致）
    const origScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { /* no-op during VTable init */ }
    let sivRestored = false
    const restoreSIV = () => {
      if (sivRestored) return
      sivRestored = true
      Element.prototype.scrollIntoView = origScrollIntoView
    }
    const sivTimer = setTimeout(restoreSIV, 1000)

    const getCellStyle = makeGetCellStyle(formulaManagerRef)

    const sheet = new VTableSheet(sheetContainerRef.current, {
      showFormulaBar: true,
      undoRedo: { show: true },
      VTablePluginModules: [
        { module: TableExportPlugin },
        { module: ExcelImportPlugin },
      ],
      sheets: [{
        sheetKey: TableConstants.SHEET_KEY,
        sheetTitle: 'sheet1',
        columns: TableConstants.COL_WIDTHS.map((width, field) => ({
          field,
          width,
          style: getCellStyle,
          fieldFormat: (record: any) => {
            const value = record?.[field]
            if (typeof value === 'number' && !isNaN(value)) {
              return value.toFixed(2)
            }
            return value
          },
        })),
        data: template.data,
        formulas: { ...template.formulas },
        showHeader: false,
      }],
    })
    sheetInstanceRef.current = sheet
    formulaManagerRef.current = (sheet as any).formulaManager

    const activeWs = sheet.getActiveSheet()
    const activeTable = activeWs?.tableInstance as any
    // 复制功能增强：让纯文本模式也带公式 + HTTP 环境下接管剪贴板写入（与 BagQuote 一致）
    const cleanupCopyEnhancer = setupCopyFormulaEnhancement(sheet, activeTable, TableConstants.SHEET_KEY)

    // 公式重算：覆盖模板 data 中公式单元格的静态默认值（与 BagQuote 一致）
    const recalculateFormulas = () => {
      const fm = (sheet as any).formulaManager
      if (!fm || !activeWs) return
      try {
        for (const [addr, formula] of Object.entries(template.formulas)) {
          const { row, col } = ExcelUtils.parseAddress(addr)
          if (row < 0 || col < 0 || !formula) continue
          const result = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row, col })
          if (result && typeof result.value === 'number' && !isNaN(result.value)) {
            ;(activeWs as any).setCellValue(col, row, result.value)
          }
        }
      } catch { /* 公式引擎未就绪时忽略 */ }
    }
    recalculateFormulas()
    const initTimer1 = setTimeout(recalculateFormulas, 100)
    const initTimer2 = setTimeout(recalculateFormulas, 500)

    const onCellChange = () => {
      recalculateFormulas()
      try { activeTable?.invalidate?.() } catch { /* ignore */ }
    }
    if (activeTable?.on) activeTable.on('change_cell_value', onCellChange)

    // 监听容器尺寸变化触发重新布局
    const resizeObserver = new ResizeObserver(() => {
      try { sheet.resize() } catch { /* ignore */ }
    })
    resizeObserver.observe(sheetContainerRef.current)

    return () => {
      if (activeTable?.off) activeTable.off('change_cell_value', onCellChange)
      cleanupCopyEnhancer()
      clearTimeout(initTimer1)
      clearTimeout(initTimer2)
      clearTimeout(sivTimer)
      restoreSIV()
      resizeObserver.disconnect()
      sheet.release()
      sheetInstanceRef.current = null
      formulaManagerRef.current = null
    }
    // 编辑目标变化时重建表格
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id])

  // 保存模板：遍历表格收集二维数据 + 全部公式，PUT 到后端（名称可同时改名）
  const handleSave = async () => {
    const sheet = sheetInstanceRef.current
    if (!sheet) {
      showMessage('error', '表格未初始化')
      return
    }
    const trimmed = name.trim()
    if (!trimmed) {
      showMessage('error', '模板名称不能为空')
      return
    }
    setSaving(true)
    try {
      const ws = sheet.getActiveSheet()
      const activeTable = ws?.tableInstance as any
      const fm = (sheet as any).formulaManager
      const rowCount = activeTable?.rowCount ?? 0
      const colCount = activeTable?.colCount ?? TableConstants.getColumnCount()
      const data: (string | number | null)[][] = []
      const formulas: Record<string, string> = {}
      for (let r = 0; r < rowCount; r++) {
        const rowData: (string | number | null)[] = []
        for (let c = 0; c < colCount; c++) {
          rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
          const formula = fm?.getCellFormula?.({ sheet: TableConstants.SHEET_KEY, row: r, col: c })
          if (formula) {
            formulas[ExcelUtils.toAddress(r, c)] = formula
          }
        }
        data.push(rowData)
      }
      const nameChanged = trimmed !== record.name
      const saved = await api.sheetTemplates.update(record.id, { name: nameChanged ? trimmed : undefined, data, formulas }) as SheetTemplateRecordFE
      // 同步内存缓存：订单页立即使用最新模板
      SheetTemplateManager.setOverride(saved.id, saved.styleCode, saved.name, { data, formulas })
      showMessage('success', nameChanged ? '模板已保存并重命名' : '模板已保存')
      setTimeout(() => onSaved(saved), 600)
    } catch (error: any) {
      console.error('保存模板失败:', error)
      showMessage('error', error?.message || '保存失败，请重试')
    }
    setSaving(false)
  }

  // 删除模板（订单已保存的 tableData 不受影响）
  const handleDelete = async () => {
    const ok = window.confirm(
      `确定要删除模板「${record.name}」吗？\n使用此模板新建的订单不受影响（已保存数据完整），仅后续无法再选择此模板。`
    )
    if (!ok) return
    setDeleting(true)
    try {
      await api.sheetTemplates.delete(record.id)
      SheetTemplateManager.removeOverride(record.id)
      onDeleted(record.id)
    } catch (error: any) {
      console.error('删除模板失败:', error)
      showMessage('error', error?.message || '删除失败，请重试')
    }
    setDeleting(false)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white border-b border-gray-200">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={18} /> 返回列表
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-400">{styleName} · 款式 code {record.styleCode}</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            placeholder="模板名称"
            className="w-full max-w-xs mt-0.5 px-2 py-1 text-sm font-semibold text-gray-800 border border-transparent hover:border-gray-200 focus:border-blue-500 rounded focus:outline-none bg-transparent"
          />
        </div>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 text-red-600 border border-red-200 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          <Trash2 size={16} />
          {deleting ? '删除中...' : '删除模板'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? '保存中...' : '保存模板'}
        </button>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`mx-4 mt-3 px-4 py-2.5 rounded-lg text-sm ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* 在线表格编辑器 */}
      <div className="flex-1 min-h-0 w-full p-4">
        <div ref={sheetContainerRef} className="w-full h-full min-h-[500px] border border-gray-200 rounded-lg" />
      </div>
    </div>
  )
}
