import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { TreeSelect } from 'antd'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { RotateCcw, TrendingUp, DollarSign, ShoppingBag, Image as ImageIcon, Upload, X, ClipboardList, Table2, Save, ArrowLeft, CheckCircle, ChevronRight, ChevronLeft, Square, Circle, CircleDot, Play, Flag, Download, Loader2, Printer, Edit, Copy, Info } from 'lucide-react'
import { copyText } from '../utils/clipboard'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { api, downloadBlob } from '../api'
import { useHasPermission } from '../hooks/usePermission'
import CustomerSelect from '../components/CustomerSelect'
import SelectionSummaryBar from '../components/SelectionSummaryBar'
import { PrintPreviewModal } from '../components/PrintPreviewModal'
import ProductionTasksTab from '../components/ProductionTasksTab'
import type { Quote } from './Quotes'
import { findTablePositions, extractFabricPrepRows, type FabricPrepRow } from '../services/tableLocator'
import { parseAiTableFill, applyAiFillToTableData, applyAiTableCellsToTableData, type AiTableFill } from '../services/aiTableFill'
import type { AiTableCell } from '../types'
import { findFabricMetersCol, ceilFabricMeters, normalizeFabricMeters, FABRIC_METERS_DEFAULT_COL } from '../services/fabricMeters'
import { fetchStyleOptions, type StyleOption } from '../services/productStyles'
import { AI_ORDER_DRAFT_STORAGE_KEY } from './AiOrderChat'
import { OrderStatus } from '../constants/OrderStatus'
import { StyleConstants } from '../constants/StyleConstants'
import { TableConstants } from '../constants/TableConstants'
import { ExcelUtils } from '../utils/ExcelUtils'
import { DateUtils } from '../utils/DateUtils'
import { SheetTemplateManager } from '../templates/SheetTemplateManager'
import { computeSelectionSummary, type SelectionSummary, type CellRangeLike } from '../utils/SelectionSummary'
import { setupCopyFormulaEnhancement } from '../utils/clipboardCopyEnhancer'
import { collectSheetLayout, applySheetLayout, filterRowHeightConfigForSave, resolveActualSizes } from '../utils/sheetLayout'
import { extractImageFilesFromDataTransfer } from '../utils/dropImageExtract'

interface OrderInfo {
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  customerName: string
  shippingAddress: string
  productStyle: string
  /** 使用的表格模板 id（v23 一对多；'' = 内置默认模板） */
  templateId: string
  productSpec: string
  fabricMaterial: string
  process: string
  handleMaterial: string
  handleSpec: string
  quantity: string
  boxSpec: string
  remark: string
  sampleFee: string
  sampleDays: string
  massDays: string
}

// 订单状态选项统一使用枚举类，消除重复定义
const STATUS_OPTIONS = OrderStatus.getAll()

/**
 * 公式收集竞态兜底（保存防篡改链路一环）：
 * 表格刚被模板重新初始化/公式引擎未就绪时，实时收集会得到空对象——
 * 直接保存会把数据库公式清空（2026-09-13 生产事故根因之一）。
 * 回退顺序：实时收集结果 → 数据库已保存的 allFormulas → 当前款式模板公式。
 * 导出为纯函数供单元测试覆盖（tests/quoteSaveFallback.test.ts）。
 */
export function resolveFormulasFallback(
  collected: Record<string, string>,
  saved: Record<string, string>,
  templateFormulas: Record<string, string>,
): Record<string, string> {
  if (Object.keys(collected).length > 0) return collected
  if (Object.keys(saved).length > 0) return { ...saved }
  return { ...templateFormulas }
}

/**
 * 裁剪表格数据的尾部空区：VTable-Sheet 会把加载的数据自动补齐到默认 100 行×100 列
 * （类似 Excel 打开时的空白区域），保存/导出若按 rowCount 全量收集，会把删除行后
 * 缩减的数据重新膨胀为空行空列写库——表现为"删除行无效"（2026-09-14 生产反馈）。
 * 本函数从尾部裁掉全 null 的行与列（中间的空行/空列保留，公式与行结构不受影响）。
 * 导出为纯函数供单元测试覆盖（tests/tableDataTrim.test.ts）。
 */
export function trimTrailingEmptyRowsAndCols(
  tableData: (string | number | null)[][],
): (string | number | null)[][] {
  const isEmptyCell = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === ''
  const rowIsEmpty = (row: (string | number | null)[]) => row.every(isEmptyCell)

  // 1) 裁剪尾部全空行
  let lastNonEmptyRow = -1
  for (let r = 0; r < tableData.length; r++) {
    if (!rowIsEmpty(tableData[r])) lastNonEmptyRow = r
  }
  const rows = tableData.slice(0, lastNonEmptyRow + 1)

  // 2) 计算所有行中最后一个非空列的最大值，裁掉其后全部空列
  let lastNonEmptyCol = -1
  for (const row of rows) {
    for (let c = row.length - 1; c > lastNonEmptyCol; c--) {
      if (!isEmptyCell(row[c])) {
        lastNonEmptyCol = c
        break
      }
    }
  }
  return rows.map((row) => row.slice(0, lastNonEmptyCol + 1))
}

/**
 * 保存前的表格数据裁剪策略（2026-09-14 需求：空白行的去留完全由用户操作决定）：
 * - 仅当表格初始化时发生过补齐（配置行数 > 数据行数，即新建订单/切换模板补到 20 行）
 *   且用户未主动增加行（收集行数 ≤ 初始化行数）时，才裁剪尾部补齐的空行/空列；
 * - 编辑已保存订单（初始化无补齐）或用户增加过行时原样返回——
 *   用户手动增加的空白行必须原样保存（VTable 删除行为物理删除，收集行数即用户所见行数）。
 * 导出为纯函数供单元测试覆盖（tests/tableDataTrim.test.ts）。
 */
export function trimTableDataForSave(
  tableData: (string | number | null)[][],
  initRowCount: number,
  paddedInit: boolean,
): (string | number | null)[][] {
  const userAddedRows = tableData.length > initRowCount
  if (paddedInit && !userAddedRows) {
    return trimTrailingEmptyRowsAndCols(tableData)
  }
  return tableData
}


const DEFAULT_ORDER_INFO: OrderInfo = {
  unitPrice: '',
  productionTimeStart: DateUtils.today(),
  productionTimeEnd: '',
  customerName: '',
  shippingAddress: '',
  productStyle: '1',
  templateId: '',
  productSpec: '',
  fabricMaterial: '10安涤棉新本色',
  process: '单面数码uv印刷+口头2.5cm',
  handleMaterial: '帆布手提',
  handleSpec: '',
  quantity: '',
  boxSpec: '',
  remark: '',
  sampleFee: '',
  sampleDays: '',
  massDays: '',
}

// 单元格样式覆盖（右键菜单设置）：key = "col,row"，value = 样式属性
const cellStyleOverrides = new Map<string, Record<string, unknown>>()
// 单元格数字格式覆盖：key = "col,row"，value = 小数位数（-1=常规, 0=整数, 2=2位, 4=4位）
const cellFormatOverrides = new Map<string, number>()

// 公式引擎引用（模块级，供 getCellStyle 实时检测单元格是否含公式）
// 在 useEffect 创建 VTableSheet 后赋值，组件卸载或重建表格时清空
let activeFormulaManager: any = null

// 辅助：构建单元格样式（字体统一加大4号、加粗）— 委托给 StyleConstants
const cs = (
  bg?: string, color: string = StyleConstants.COLORS.black, size: number = 10, bold: boolean = true, border: boolean = true,
): Record<string, unknown> => StyleConstants.buildCellStyle(bg, color, size, bold, border)

// 按行+列返回单元格样式（VTable 行列均为 0-based）
// 规则：
//   1. 第一列无值但其他列有值的行 → 标题颜色（蓝底白字）
//   2. 含公式的单元格 → 浅橙背景（实时标识公式单元格，便于区分公式与输入值）
//   3. 其余单元格无背景色
// 优先级：标题样式 < 公式绿色背景 < 用户右键菜单覆盖
const getCellStyle = (args: { row: number; col: number; table?: any }): Record<string, unknown> => {
  const { row, col, table } = args
  // 判断是否为标题行（第一列无值但其他列有值）
  let isTitleRow = false
  if (table?.getCellOriginValue) {
    const firstColValue = table.getCellOriginValue(0, row)
    if (firstColValue == null || firstColValue === '') {
      for (let c = 1; c < 16; c++) {
        const val = table.getCellOriginValue(c, row)
        if (val != null && val !== '') { isTitleRow = true; break }
      }
    }
  }
  const style = isTitleRow ? cs(StyleConstants.COLORS.headerBg, StyleConstants.COLORS.headerColor) : cs(undefined)

  // 实时检测公式单元格：通过公式引擎查询该单元格是否有公式
  // 公式引擎在 VTableSheet 构造时已载入，getCellFormula 返回公式字符串（如 "=B2"）或 undefined
  let hasFormula = false
  if (activeFormulaManager?.getCellFormula) {
    const formula = activeFormulaManager.getCellFormula({ sheet: TableConstants.SHEET_KEY, row, col })
    hasFormula = !!formula
  }
  // 公式单元格应用浅橙背景（不覆盖标题行的白字，仅改背景色）
  if (hasFormula) {
    style.bgColor = StyleConstants.COLORS.formulaBg
  }

  // 合并用户通过右键菜单设置的样式覆盖（最高优先级）
  const override = cellStyleOverrides.get(`${col},${row}`)
  return override ? { ...style, ...override } : style
}

// 当前表格的布料米数列索引（创建表格时按表头「布料米数」动态定位，失败回退默认列）
let sheetMetersCol = FABRIC_METERS_DEFAULT_COL

// 单元格显示格式化：数值默认保留2位小数（右键菜单可覆盖小数位）；
// 布料米数列先向上取整再显示（业务规则，优先于小数位覆盖；不影响公式计算，引擎读取 data 原始值）
const formatFieldValue = (value: unknown, col?: number, row?: number) => {
  if (typeof value === 'number' && !isNaN(value)) {
    let v = value
    if (col === sheetMetersCol) {
      const ceiled = ceilFabricMeters(v)
      if (typeof ceiled === 'number') v = ceiled
    }
    const fmt = (col != null && row != null) ? cellFormatOverrides.get(`${col},${row}`) : undefined
    if (fmt === -1) return v              // 常规
    if (fmt === 0) return Math.round(v)   // 整数
    if (fmt === 4) return v.toFixed(4)    // 4位小数
    return v.toFixed(2)                    // 默认2位小数
  }
  return value
}

const SHEET_COLUMNS = TableConstants.COL_WIDTHS.map((width, field) => ({
  field,
  width,
  style: getCellStyle,
  fieldFormat: (record: any, col?: number, row?: number) =>
    formatFieldValue(record?.[field], col ?? field, row),
}))

interface BagQuoteProps {
  /** 只读模式：查看订单详情时禁用所有编辑控件 */
  readOnly?: boolean
}

/**
 * 金额输入框：支持直接输入小数
 * 聚焦时显示草稿字符串（可输入 "3."、"3.5" 等中间态），失焦后格式化为两位小数。
 * 直接绑定 number + toFixed 会导致输入小数点时被立即格式化吞掉。
 */
function PriceInput({ value, onChange, className }: {
  value: number | null
  onChange: (v: number | null) => void
  className?: string
}) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const display = focused ? draft : (value !== null ? value.toFixed(2) : '')
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={() => { setFocused(true); setDraft(value !== null ? value.toFixed(2) : '') }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value
        // 只允许数字和小数点（单个）
        if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
        setDraft(raw)
        if (raw === '' || raw === '.') {
          onChange(null)
        } else {
          onChange(Number(raw))
        }
      }}
      placeholder="0.00"
      className={className}
    />
  )
}

export default function BagQuote({ readOnly = false }: BagQuoteProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEditMode = !!id && !readOnly   // readOnly 时强制非编辑模式
  const hasQuoteId = !!id                 // 有 ID 时需加载数据（无论是否只读）
  const canEdit = useHasPermission('quotes:edit')
  const customerId = searchParams.get('customerId')
  const [orderInfo, setOrderInfo] = useState<OrderInfo>(DEFAULT_ORDER_INFO)
  const [productImages, setProductImages] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  // 图片拖拽排序状态：draggedIndex = 被拖拽的图片索引，dragOverIndex = 悬停目标索引
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showSaveSuccess, setShowSaveSuccess] = useState(false)
  // AI 智能下单草稿载入提示（非空时显示绿色横幅，点击关闭）
  const [aiImportNotice, setAiImportNotice] = useState('')
  const [saveError, setSaveError] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string>('')
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [copyingImage, setCopyingImage] = useState(false)
  const [showCopyImageSuccess, setShowCopyImageSuccess] = useState(false)
  const quoteCardRef = useRef<HTMLDivElement>(null)
  const sellPriceRowRef = useRef<HTMLDivElement>(null)
  const imagesEndRef = useRef<HTMLDivElement>(null)
  const [quoteNumber, setQuoteNumber] = useState<string>('')
  const [createdAt, setCreatedAt] = useState<string>('')
  const [printQuote, setPrintQuote] = useState<Quote | null>(null)
  // 打印布局（v34）：打开打印预览时从表格实例读取的实际列宽/行高，随 printQuote 一起更新
  const [printSizes, setPrintSizes] = useState<{ columnWidths: number[]; rowHeights: number[] }>({ columnWidths: [], rowHeights: [] })
  const [status, setStatus] = useState<number>(1)
  const [statusTimeNodes, setStatusTimeNodes] = useState<{
    quoteTime: string
    sampleTime: string
    sampleCompletedTime: string
    productionStartTime: string
    shippingTime: string
    paymentTime: string
    reconciledTime: string
    endTime: string
  }>({
    quoteTime: '',
    sampleTime: '',
    sampleCompletedTime: '',
    productionStartTime: '',
    shippingTime: '',
    paymentTime: '',
    reconciledTime: '',
    endTime: '',
  })
  const [productionStepStatus, setProductionStepStatus] = useState<Record<number, 'pending' | 'in_progress' | 'completed'>>({})
  // v24 标签页：'info' = 订单信息+在线表格；'production' = 订单做货流程（甘特图）
  // Tab1 常驻仅做 CSS 显隐（保持 VTable 实例与 undo 栈）；Tab2 首次激活时挂载（避免甘特图 0 宽度初始化）
  const [activeTab, setActiveTab] = useState<'info' | 'production'>('info')
  const [productionTabMounted, setProductionTabMounted] = useState(false)
  const switchTab = (tab: 'info' | 'production') => {
    setActiveTab(tab)
    if (tab === 'production') setProductionTabMounted(true)
  }

  const sheetContainerRef = useRef<HTMLDivElement>(null)
  const sheetInstanceRef = useRef<VTableSheet | null>(null)
  // 新增保存后切换到编辑模式时，跳过 loadQuote（数据刚保存，无需重新加载）
  const skipNextLoadRef = useRef(false)
  // 从数据库加载的在线表格二维数据（编辑已有订单时使用，覆盖模板默认值）。
  // 新增订单时为 null，使用模板数据初始化。
  const loadedTableDataRef = useRef<(string | number | null)[][] | null>(null)
  // AI 智能下单草稿解析出的表格填充值（v35）：数量/宽/高/底，在线表格初始化时
  // 写入成品行（模板公式自动级联重算全部计算列），一次性消费后置 null
  const aiTableFillRef = useRef<AiTableFill | null>(null)
  // AI 草稿的 tableCells（单元格级填充：克重/门幅/出血/成本价格等），初始化时
  // 按行标签+列名双区动态定位写入，一次性消费后置 null
  const aiTableCellsRef = useRef<AiTableCell[] | null>(null)
  // 当前表格初始化状态：配置行数（新建/切模板=25，编辑=数据行数）与是否发生补齐
  //（配置行数 > 数据行数）。保存时据此判断是否裁剪补齐空行（见 trimTableDataForSave）
  const sheetInitRowCountRef = useRef(0)
  const sheetPaddedRef = useRef(false)
  // 从数据库加载的布局配置（v34：用户拖拽调整过的列宽/行高），编辑已有订单时恢复；
  // 新增订单为 null（使用所选模板布局初始化），切换款式/模板时清空
  const loadedLayoutRef = useRef<{ columnWidthConfig: Array<{ key: number; width: number }>; rowHeightConfig: Array<{ key: number; height: number }> } | null>(null)
  // 表格中所有单元格的公式（地址→公式字符串），加载时直接使用，不依赖模板比对。
  // v9 迁移脚本已将老数据（removedFormulaAddresses + modifiedFormulas + 模板公式）计算初始化为 allFormulas。
  const allFormulasRef = useRef<Record<string, string>>({})
  // 加载完成的版本号：loadQuote 返回后自增，触发表格 useEffect 重新初始化以使用数据库数据
  const [tableDataVersion, setTableDataVersion] = useState(0)
  // 表格是否有未保存编辑（用于款式切换时提示"保存或丢弃"）
  const [isTableDirty, setIsTableDirty] = useState(false)
  // 表格对订单信息的联动：成本价、含税价、单个卖价(不含税)/单个卖价(含税)
  const [costPrice, setCostPrice] = useState<number | null>(null)
  const [priceWithTax, setPriceWithTax] = useState<number | null>(null)
  // 收款相关：应收打样费、实际收取打样费、打样费是否抵扣大货、收取定金、待收总金额（手动覆盖标记）
  const [receivableSampleFee, setReceivableSampleFee] = useState<number | null>(null)
  const [actualSampleFee, setActualSampleFee] = useState<number | null>(null)
  const [sampleFeeDeduct, setSampleFeeDeduct] = useState(false)
  const [deposit, setDeposit] = useState<number | null>(null)
  const [pendingAmount, setPendingAmount] = useState<number | null>(null)
  // 用户是否手动修改过待收总金额：true 时不再自动重算，直到重新加载订单
  const pendingAmountManualRef = useRef(false)
  const [sellPrices, setSellPrices] = useState<{ noTax: number | null; withTax: number | null }>({ noTax: null, withTax: null })
  // 款式选项：从产品管理模块动态获取（code 1-6 对应在线表格模板）
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  // 选中单元格汇总结果：null 表示当前无选区
  const [selectionSummary, setSelectionSummary] = useState<SelectionSummary | null>(null)
  // 备料提取行（在线表格第二个标题行前的规格区）：联动「做货流程-面料采购」材料清单；null = 结构不完整不联动
  const [fabricPrepRows, setFabricPrepRows] = useState<FabricPrepRow[] | null>(null)
  // 数据库模板覆盖是否已加载（sheet_templates 表，v19）：新建订单需等覆盖加载后再初始化表格
  const [templatesReady, setTemplatesReady] = useState(false)

  useEffect(() => {
    fetchStyleOptions().then(setStyleOptions)
  }, [])

  // AI 智能下单草稿填充（v35）：从 AI 对话页确认跳转而来（/quotes/new?from=ai）时，
  // 读取 sessionStorage 草稿合并进表单，参考图片作为产品图初始数据；用后即清。
  // 仅新建订单（无 id）时生效；非空字段覆盖默认值，空字段保留默认。
  useEffect(() => {
    if (id) return
    const raw = sessionStorage.getItem(AI_ORDER_DRAFT_STORAGE_KEY)
    if (!raw) return
    sessionStorage.removeItem(AI_ORDER_DRAFT_STORAGE_KEY)
    try {
      const parsed = JSON.parse(raw) as { draft: Partial<OrderInfo> & { tableCells?: AiTableCell[] }; images?: string[] }
      if (parsed && typeof parsed === 'object' && parsed.draft) {
        setOrderInfo((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(next) as Array<keyof OrderInfo>) {
            const v = (parsed.draft as Record<string, unknown>)[key]
            if (typeof v === 'string' && v !== '') next[key] = v
          }
          return next
        })
        // 解析规格/数量供在线表格初始化：写入成品行后模板公式（B3='=B2' 等）
        // 自动级联重算切片尺寸/布料米数/总重量/成本报价等全部计算列
        aiTableFillRef.current = parseAiTableFill(parsed.draft.productSpec, parsed.draft.quantity)
        // AI 单元格级填充（克重/门幅/出血/成本区价格等，AI 对话页已预览并允许用户剔除）
        aiTableCellsRef.current = Array.isArray((parsed.draft as Record<string, unknown>).tableCells)
          ? ((parsed.draft as Record<string, unknown>).tableCells as AiTableCell[])
          : null
        if (Array.isArray(parsed.images)) {
          setProductImages(parsed.images.filter((i) => typeof i === 'string'))
        }
        setAiImportNotice('已载入 AI 生成的订单信息，在线表格已按数量/规格/克重/工艺价格自动填充并重算，请核对后保存')
      }
    } catch {
      // 草稿解析失败静默忽略，按普通新建订单处理
    }
  }, [id])

  // 加载数据库模板覆盖（幂等，进程内一次）：加载失败时静默使用内置模板
  useEffect(() => {
    SheetTemplateManager.loadOverrides().finally(() => setTemplatesReady(true))
  }, [])

  // 款式/表格模板树形下拉数据（antd TreeSelect）：
  // 一级 = 款式（仅分组节点不可选，点击标题展开/收起）；二级 = 该款式下的模板叶子（可选）
  // 叶子 value 编码 `${styleCode}|${templateId}`（templateId 空 = 内置默认模板），
  // 展开时 title 显示完整"款式 / 模板名"便于区分；选中后通过 displayRender 仅显示款式名
  const styleTemplateTreeData = useMemo(() => {
    return styleOptions.map((style) => {
      // 二级：该款式下的数据库模板（templatesReady 后渲染，未加载完成时仅显示默认项）
      const entries = templatesReady ? SheetTemplateManager.listByStyle(style.value) : []
      // 订单记录的模板已删除或不在该款式下：保留占位叶子避免选中值显示空白（表格回退内置默认）
      const missing = templatesReady
        && style.value === orderInfo.productStyle
        && orderInfo.templateId !== ''
        && !entries.some((e) => e.id === orderInfo.templateId)
      return {
        title: style.label,
        // 款式节点唯一 value（selectable: false 仅作分组；onChange 再按 "|" 防御兜底）
        value: `style:${style.value}`,
        selectable: false,
        children: [
          // 内置款式（1-6）有专属内置模板；自定义款式（新增产品编码）无内置模板，
          // 未选模板时回退「无底无侧」内置模板
          { title: SheetTemplateManager.hasTemplate(style.value) ? '默认模板（内置）' : '默认模板（无底无侧）', label: style.label, value: `${style.value}|` },
          ...entries.map((entry) => ({
            title: entry.name,
            label: style.label,
            value: `${style.value}|${entry.id}`,
          })),
          ...(missing ? [{
            title: '模板已删除（回退默认）',
            label: style.label,
            value: `${style.value}|${orderInfo.templateId}`,
          }] : []),
        ],
      }
    })
  }, [styleOptions, templatesReady, orderInfo.productStyle, orderInfo.templateId])

  // 进入页面时停留在最上方：SPA 的 pushState 导航不会重置窗口滚动位置，
  // 会沿用前一页（如订单列表）的滚动位置，导致进入编辑页时下滑到在线表格。
  // 用 useLayoutEffect 在浏览器绘制前同步滚回顶部，避免视觉闪烁。
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (hasQuoteId) {
      // 新增保存后切换到编辑模式时跳过重新加载（数据刚保存，无需再次请求）
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false
        return
      }
      loadQuote()
    } else if (customerId) {
      // 从客户详情跳转过来，预填充客户信息
      loadCustomerInfo()
    }
  }, [hasQuoteId, customerId])

  const loadCustomerInfo = async () => {
    try {
      const customer = await api.customers.getById(customerId!)
      if (customer) {
        setOrderInfo(prev => ({
          ...prev,
          customerName: customer.name || '',
          shippingAddress: customer.address || '',
        }))
      }
    } catch (error) {
      console.error('加载客户信息失败:', error)
    }
  }

  const loadQuote = async () => {
    setLoading(true)
    try {
      const data = await api.quotes.getById(id!)
      if (data) {
        setQuoteNumber(data.quote_number || '')
        setCreatedAt(data.created_at || '')
        setOrderInfo({
          unitPrice: data.unitPrice || '',
          productionTimeStart: data.productionTimeStart || DateUtils.today(),
          productionTimeEnd: data.productionTimeEnd || '',
          customerName: data.customerName || '',
          shippingAddress: data.shippingAddress || '',
          productStyle: data.productStyle || '1',
          templateId: data.templateId || '',
          productSpec: data.productSpec || '',
          fabricMaterial: data.fabricMaterial || '10安涤棉新本色',
          process: data.process || '单面数码uv印刷+口头2.5cm',
          handleMaterial: data.handleMaterial || '帆布手提',
          handleSpec: data.handleSpec || '',
          quantity: data.quantity || '',
          boxSpec: data.boxSpec || '',
          remark: data.remark || '',
          sampleFee: (data.sampleFee || '').replace(/元$/, ''),
          sampleDays: data.sampleDays || '',
          massDays: data.massDays || '',
        })
        setSellPrices({
          noTax: data.sellPriceNoTax || null,
          withTax: data.sellPriceWithTax || null,
        })
        setCostPrice(data.costPrice || null)
        setPriceWithTax(data.priceWithTax || null)
        // 收款相关字段（V17/V18 新增）
        setReceivableSampleFee(data.receivableSampleFee ?? null)
        setActualSampleFee(data.actualSampleFee ?? null)
        setSampleFeeDeduct(!!data.sampleFeeDeduct)
        setDeposit(data.deposit ?? null)
        setPendingAmount(data.pendingAmount ?? null)
        pendingAmountManualRef.current = false
        setStatus(data.status || 1)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          sampleCompletedTime: data.sampleCompletedTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          reconciledTime: data.reconciledTime || '',
          endTime: data.endTime || '',
        })
        setProductionStepStatus(data.productionStepStatus || {})
        setProductImages(data.images || [])
        // 加载已保存的在线表格数据（覆盖模板默认值，后续以数据库为准）
        loadedTableDataRef.current = (data.tableData && data.tableData.length > 0) ? data.tableData : null
        // 加载布局配置（v34）：重新打开订单时恢复用户调整过的列宽/行高
        loadedLayoutRef.current = {
          columnWidthConfig: Array.isArray(data.columnWidthConfig) ? data.columnWidthConfig : [],
          rowHeightConfig: Array.isArray(data.rowHeightConfig) ? data.rowHeightConfig : [],
        }
        // 加载所有公式（v9 迁移已将老数据初始化为 allFormulas，直接使用，不依赖模板比对）
        allFormulasRef.current = data.allFormulas || {}
        // 重置 dirty 状态：加载完成时无未保存编辑
        setIsTableDirty(false)
        // 自增版本号，触发表格 useEffect 重新初始化。
        // 无论 tableData 是否为空（老数据无 tableData 时用模板），都需要自增以解除
        // useEffect 中 "isEditMode && tableDataVersion===0" 的阻塞，让表格能创建。
        setTableDataVersion(v => v + 1)
      }
    } catch (error) {
      console.error('加载报价失败:', error)
    }
    setLoading(false)
  }

  // 打印：从当前编辑状态和表格实例构造 Quote 对象，打开打印预览
  const handleOpenPrint = () => {
    // 从表格实例提取当前二维数据
    let tableData: (string | number | null)[][] = []
    const sheet = sheetInstanceRef.current
    let printSizes: { columnWidths: number[]; rowHeights: number[] } = { columnWidths: [], rowHeights: [] }
    if (sheet) {
      const ws = sheet.getActiveSheet()
      const activeTable = ws?.tableInstance as any
      const rowCount = activeTable?.rowCount ?? 0
      const colCount = activeTable?.colCount ?? 16
      for (let r = 0; r < rowCount; r++) {
        const rowData: (string | number | null)[] = []
        for (let c = 0; c < colCount; c++) {
          rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
        }
        tableData.push(rowData)
      }
      // 布局适配（v34）：打印按页面所见输出列宽行高（含默认尺寸的完整数组）
      printSizes = resolveActualSizes(activeTable, rowCount, colCount)
    }
    // 打印口径与保存一致：布料米数列向上取整（详情见 services/fabricMeters）
    tableData = normalizeFabricMeters(tableData).data

    const quote: Quote = {
      id: id || '',
      user_id: '',
      customer_id: '',
      quote_number: quoteNumber || id || '',
      ...orderInfo,
      costPrice: costPrice || 0,
      priceWithTax: priceWithTax || 0,
      sellPriceNoTax: sellPrices.noTax || 0,
      sellPriceWithTax: sellPrices.withTax || 0,
      status: status as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      quoteTime: statusTimeNodes.quoteTime,
      sampleTime: statusTimeNodes.sampleTime,
      sampleCompletedTime: statusTimeNodes.sampleCompletedTime,
      productionStartTime: statusTimeNodes.productionStartTime,
      shippingTime: statusTimeNodes.shippingTime,
      paymentTime: statusTimeNodes.paymentTime,
      endTime: statusTimeNodes.endTime,
      images: productImages,
      tableData,
      created_at: createdAt,
      updated_at: '',
    }
    setPrintQuote(quote)
    setPrintSizes(printSizes)
  }

  // opts.confirmDataReset：服务端防篡改守卫拦截（公式清空/表格大幅缩水）后，
  // 用户在确认框中明确同意时携带，绕过守卫完成保存（如确需切换模板替换数据）
  const handleSave = async (opts: { confirmDataReset?: boolean } = {}): Promise<boolean> => {
    setLoading(true)
    setSaveError('')
    let saved = false
    try {
      // 同步客户名称和地址到客户管理
      const customerName = orderInfo.customerName.trim()
      if (customerName) {
        const existingCustomer = await api.customers.getByName(customerName)
        if (existingCustomer) {
          // 更新现有客户的地址
          await api.customers.update(existingCustomer.id, {
            address: orderInfo.shippingAddress || existingCustomer.address,
          })
        } else {
          // 创建新客户
          await api.customers.create({
            name: customerName,
            address: orderInfo.shippingAddress || '',
          })
        }
      }

      // 提取当前在线表格的二维数据（用户编辑后的值），持久化到数据库
      let tableData: (string | number | null)[][] = []
      // allFormulas：遍历表格所有单元格，收集所有公式（无论来自模板、用户修改还是用户新增到无公式单元格）
      // 加载时直接使用此字段作为 activeFormulas，不再依赖模板比对
      let allFormulas: Record<string, string> = {}
      const sheet = sheetInstanceRef.current
      if (sheet) {
        const ws = sheet.getActiveSheet()
        const activeTable = ws?.tableInstance as any
        const fm = (sheet as any).formulaManager
        const rowCount = activeTable?.rowCount ?? 0
        const colCount = activeTable?.colCount ?? 16
        for (let r = 0; r < rowCount; r++) {
          const rowData: (string | number | null)[] = []
          for (let c = 0; c < colCount; c++) {
            rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
            // 收集所有单元格的公式（覆盖模板地址范围之外的用户新增公式）
            const formula = fm?.getCellFormula?.({ sheet: TableConstants.SHEET_KEY, row: r, col: c })
            if (formula) {
              allFormulas[ExcelUtils.toAddress(r, c)] = formula
            }
          }
          tableData.push(rowData)
        }
      }

      // 表格实例未就绪（收集到 0 行）时阻止保存，防止把数据库已保存的表格清空
      if (tableData.length === 0 && isEditMode) {
        setLoading(false)
        setSaveError('表格数据未就绪，请稍候重试')
        setTimeout(() => setSaveError(''), 5000)
        return false
      }

      // 保存前裁剪策略（2026-09-14 需求：空白行的去留完全由用户操作决定）：
      // 仅新建/切换模板场景（初始化补齐到 20 行）且用户未增加行时，裁掉补齐的空行/空列；
      // 编辑已保存订单（初始化无补齐）或用户手动增加过行时原样保存——
      // VTable 删除行为物理删除（rowCount 真实减少），收集行数即用户所见行数
      tableData = trimTableDataForSave(tableData, sheetInitRowCountRef.current, sheetPaddedRef.current)

      // 公式收集竞态兜底（与导出口径一致）：表格刚被模板重新初始化/公式引擎尚未就绪时，
      // 实时收集会得到空对象 —— 直接保存会把数据库公式清空（生产事故根因之一）。
      // 回退顺序：数据库已保存的 allFormulas → 当前款式模板公式
      allFormulas = resolveFormulasFallback(
        allFormulas,
        allFormulasRef.current,
        SheetTemplateManager.getTemplate(orderInfo.productStyle, orderInfo.templateId).formulas,
      )

      // 布料米数向上取整规范化（与后端口径一致）：数值取整 + 公式整体包裹 CEILING
      const metersNorm = normalizeFabricMeters(tableData, allFormulas)
      // 保存前二次确认：存在将被取整的米数时提示用户（公式包裹为透明规范化，不提示）
      if (metersNorm.ceilChanges.length > 0) {
        const preview = metersNorm.ceilChanges.slice(0, 5)
          .map((c) => `${c.address}：${c.from} → ${c.to}`)
          .join('\n')
        const more = metersNorm.ceilChanges.length > 5
          ? `\n… 等共 ${metersNorm.ceilChanges.length} 处` : ''
        const ok = window.confirm(
          `布料米数采用向上取整规则，所有输入值将被自动进位至整数位。\n` +
          `以下布料米数将被取整：\n${preview}${more}\n\n` +
          `点击“确定”按取整后的值保存，点击“取消”放弃本次保存。`,
        )
        if (!ok) {
          setLoading(false)
          return false
        }
      }
      tableData = metersNorm.data
      allFormulas = metersNorm.formulas ?? allFormulas

      // 布局收集（v34）：仅记录用户拖拽调整过的列宽/行高；行高与裁剪联动——
      // 超出最终保存行数的行高配置一并丢弃（该行已不存在），列宽配置不受裁剪影响
      const layout = collectSheetLayout(sheetInstanceRef.current, TableConstants.SHEET_KEY)
      const rowHeightConfig = filterRowHeightConfigForSave(layout.rowHeightConfig, tableData.length)

      const quoteData = {
        ...orderInfo,
        costPrice: Math.round((costPrice || 0) * 100) / 100,
        priceWithTax: priceWithTax || 0,
        sellPriceNoTax: Math.round((sellPrices.noTax || 0) * 100) / 100,
        sellPriceWithTax: Math.round((sellPrices.withTax || 0) * 100) / 100,
        // 收款相关字段（V17/V18 新增）
        receivableSampleFee: receivableSampleFee !== null ? Math.round(receivableSampleFee * 100) / 100 : 0,
        actualSampleFee: actualSampleFee !== null ? Math.round(actualSampleFee * 100) / 100 : 0,
        sampleFeeDeduct,
        deposit: deposit !== null ? Math.round(deposit * 100) / 100 : 0,
        // 仅做货中(3)/已发货未收款(4)保存待收总额，其他状态强制为 0
        pendingAmount: (status === 3 || status === 4) ? (pendingAmount !== null ? Math.round(pendingAmount * 100) / 100 : 0) : 0,
        status,
        images: productImages,
        tableData,
        allFormulas,
        productionStepStatus,
        // 布局配置（v34）：随订单保存，重新打开时恢复
        columnWidthConfig: layout.columnWidthConfig,
        rowHeightConfig,
      }
      // 守卫确认标记：仅在用户于确认框中同意后携带（服务端防篡改守卫要求）
      const payload: any = { ...quoteData }
      if (opts.confirmDataReset) payload.confirmDataReset = true
      if (isEditMode) {
        await api.quotes.update(id!, payload)
      } else {
        const created = await api.quotes.create(payload)
        // 新增保存后切换到编辑模式（替换 URL，不返回列表页），避免重复保存创建多个订单
        if (created?.id) {
          skipNextLoadRef.current = true
          // 回填后端生成的16位随机订单号（切换编辑模式后不重新加载）
          if (created.quote_number) setQuoteNumber(created.quote_number)
          navigate(`/quotes/${created.id}/edit`, { replace: true })
        }
      }
      setShowSaveSuccess(true)
      setTimeout(() => setShowSaveSuccess(false), 3000)
      // 保存成功后重置 dirty 状态（表格已与数据库一致）
      setIsTableDirty(false)
      // 同步 allFormulasRef 为最新保存的内容，避免后续款式切换误判为有未保存编辑
      allFormulasRef.current = Object.keys(allFormulas).length > 0 ? allFormulas : allFormulasRef.current
      saved = true
    } catch (error: any) {
      // 服务端防篡改守卫拦截（公式清空/表格大幅缩水）：弹确认框，用户同意后携带标记重试
      if (error?.code === 'QUOTE_DATA_RESET_CONFIRM_REQUIRED') {
        const ok = window.confirm(error.message + '\n\n是否确认继续保存？')
        if (ok) return handleSave({ confirmDataReset: true })
        setLoading(false)
        return false
      }
      console.error('保存报价失败:', error)
      setSaveError(error?.message || '保存失败，请重试')
      setTimeout(() => setSaveError(''), 5000)
    }
    setLoading(false)
    return saved
  }

  // 导出当前订单 + 在线表格（含公式）到 Excel
  const handleExportWithTable = async () => {
    if (!id) {
      setExportError('请先保存订单后再导出')
      setTimeout(() => setExportError(''), 5000)
      return
    }
    const sheet = sheetInstanceRef.current
    if (!sheet) {
      setExportError('表格未初始化')
      setTimeout(() => setExportError(''), 5000)
      return
    }
    setExporting(true)
    setExportError('')
    try {
      // 从表格实例提取当前二维数据（包含用户编辑后的值）
      const ws = sheet.getActiveSheet()
      const activeTable = ws?.tableInstance as any
      const rowCount = activeTable?.rowCount ?? 0
      const colCount = activeTable?.colCount ?? 16
      const tableData: (string | number | null)[][] = []
      for (let r = 0; r < rowCount; r++) {
        const rowData: (string | number | null)[] = []
        for (let c = 0; c < colCount; c++) {
          rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
        }
        tableData.push(rowData)
      }
      // 裁剪 VTable 自动补齐的尾部空区（与保存口径一致），避免导出的 Excel 带大量空行
      const trimmedData = trimTrailingEmptyRowsAndCols(tableData)
      // 公式来源优先级：当前表格实时收集的公式 > 数据库 allFormulas > 所选模板（含内置兜底）
      // 实时收集确保导出与页面显示完全一致（含用户未保存的修改）
      const template = SheetTemplateManager.getTemplate(orderInfo.productStyle, orderInfo.templateId)
      const fm = (sheet as any).formulaManager
      const exportFormulas: Record<string, string> = {}
      const expRowCount = activeTable?.rowCount ?? 0
      const expColCount = activeTable?.colCount ?? 16
      for (let r = 0; r < expRowCount; r++) {
        for (let c = 0; c < expColCount; c++) {
          const formula = fm?.getCellFormula?.({ sheet: TableConstants.SHEET_KEY, row: r, col: c })
          if (formula) exportFormulas[ExcelUtils.toAddress(r, c)] = formula
        }
      }
      // 若实时收集为空（公式引擎未就绪），回退到 allFormulas 或模板
      const formulas = Object.keys(exportFormulas).length > 0
        ? exportFormulas
        : (allFormulasRef.current || template.formulas)
      // 导出口径与保存一致：布料米数列向上取整 + 公式整体包裹 CEILING
      const metersNorm = normalizeFabricMeters(trimmedData, formulas)
      // 布局适配（v34）：按页面所见导出列宽行高——读取当前实际尺寸（含默认值），
      // 裁剪仅去尾部空区、保留行列的前缀索引不变，故按裁剪后行列数取前缀即可
      const { columnWidths, rowHeights } = resolveActualSizes(activeTable, activeTable?.rowCount ?? 0, activeTable?.colCount ?? 16)
      const trimmedWidths = columnWidths.slice(0, metersNorm.data[0]?.length ?? 0)
      const trimmedHeights = rowHeights.slice(0, metersNorm.data.length)
      const blob = await api.export.orderWithTable(id, {
        data: metersNorm.data,
        formulas: metersNorm.formulas ?? formulas,
        columnWidths: trimmedWidths.some((w) => w > 0) ? trimmedWidths : undefined,
        rowHeights: trimmedHeights.some((h) => h > 0) ? trimmedHeights : undefined,
      })
      const now = new Date()
      const ts = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      downloadBlob(blob, `Order_${orderInfo.customerName || 'Export'}_${ts}.xlsx`)
    } catch (error) {
      console.error('导出失败:', error)
      setExportError(error instanceof Error ? error.message : '导出失败，请重试')
      setTimeout(() => setExportError(''), 5000)
    }
    setExporting(false)
  }

  useEffect(() => {
    if (!sheetContainerRef.current) return

    // 编辑已有订单时：必须等数据库 tableData 加载完成后再创建表格，避免首次用模板初始化后
    // 被 recalculateFormulas 用公式结果覆盖用户编辑值（tableDataVersion=0 表示尚未加载）
    if (hasQuoteId && tableDataVersion === 0) return

    // 等数据库模板加载完成（v23）：新建订单/切换款式或模板时使用所选模板，内置模板兜底
    if (!templatesReady) return

    const template = SheetTemplateManager.getTemplate(orderInfo.productStyle, orderInfo.templateId)
    // 编辑已有订单时优先使用数据库保存的表格数据；新增订单时用模板数据
    const savedTable = loadedTableDataRef.current
    const useSavedTable = savedTable != null && savedTable.length > 0
    let initialData = savedTable && savedTable.length > 0 ? savedTable : template.data
    // AI 智能下单草稿（v35）：新建订单时按草稿填充表格（克隆模板数据，禁止原地修改缓存模板）。
    // 先应用 tableCells 单元格级填充（克重/门幅/出血/成本价格等），再写入成品行数量/规格。
    // 模板公式（B3='=B2'、H3='=F3+C3'、M 列 CEILING 等）从输入列级联推导全部计算列，
    // 初始化后 recalculateFormulas 自动重算。
    const aiFill = aiTableFillRef.current
    const aiCells = aiTableCellsRef.current
    if ((aiFill || (aiCells && aiCells.length > 0)) && !useSavedTable) {
      aiTableFillRef.current = null
      aiTableCellsRef.current = null
      if (aiCells && aiCells.length > 0) {
        initialData = applyAiTableCellsToTableData(initialData, aiCells)
      }
      if (aiFill) {
        initialData = applyAiFillToTableData(initialData, aiFill)
      }
      // 填充的规格/数量为有效业务数据，标记 dirty 防止切换款式/模板时无提示丢失
      setIsTableDirty(true)
    }
    // 定位布料米数列（表头关键字查找），供显示取整与汇总取整使用
    sheetMetersCol = findFabricMetersCol(initialData)
    // activeFormulas 构建策略：
    // - 编辑已有订单：直接使用数据库保存的 allFormulas（v9 迁移已将老数据初始化），不依赖模板比对
    // - 新增订单：使用模板公式初始化
    // - 切换款式后：allFormulasRef 已被清空为 {}，使用新款式模板公式
    const loadedFormulas = allFormulasRef.current
    const activeFormulas: Record<string, string> = Object.keys(loadedFormulas).length > 0
      ? { ...loadedFormulas }
      : { ...template.formulas }

    // VTable 初始化时会对其内部元素（如 sheet tab）调用 element.scrollIntoView，
    // 导致窗口平滑滚动到表格区域，覆盖进入页面时的顶部位置。
    // 临时将 scrollIntoView 置为空操作以阻止该行为，初始化完成后恢复原方法。
    const origScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function () { /* no-op during VTable init */ }
    let sivRestored = false
    const restoreSIV = () => {
      if (sivRestored) return
      sivRestored = true
      Element.prototype.scrollIntoView = origScrollIntoView
    }
    const sivTimer = setTimeout(restoreSIV, 1000)

    // 新建/切换模板：初始默认 20 行（数据不足补空行，更多按实际行数展示）；
    // 编辑已保存订单：按实际数据行数展示，不自动补齐——尊重用户手动删除空白行后的状态
    const configRowCount = useSavedTable ? initialData.length : TableConstants.DEFAULT_ROW_COUNT
    // 记录初始化状态：保存时仅裁剪补齐产生的空行，用户增加的空白行原样保留（见 trimTableDataForSave）
    sheetInitRowCountRef.current = configRowCount
    sheetPaddedRef.current = configRowCount > initialData.length

    // 布局恢复（v34）：编辑已保存订单优先用订单自身保存的布局（仅调整过的行列）；
    // 新建订单/切换款式模板用所选模板的布局初始化；两者皆空 = 默认尺寸，不传配置
    const savedLayout = loadedLayoutRef.current
    const hasSavedLayout = useSavedTable
      && ((savedLayout?.columnWidthConfig?.length ?? 0) > 0 || (savedLayout?.rowHeightConfig?.length ?? 0) > 0)
    const initLayout = hasSavedLayout
      ? savedLayout!
      : { columnWidthConfig: template.columnWidthConfig ?? [], rowHeightConfig: template.rowHeightConfig ?? [] }

    const sheet = new VTableSheet(sheetContainerRef.current, {
      showFormulaBar: true,
      undoRedo: { show: !readOnly },
      VTablePluginModules: readOnly ? [] : [
        { module: TableExportPlugin },
        { module: ExcelImportPlugin },
      ],
      sheets: [
        {
          sheetKey: 'sheet1',
          sheetTitle: 'sheet1',
          columns: SHEET_COLUMNS,
          data: initialData,
          formulas: activeFormulas,
          showHeader: false,
          rowCount: configRowCount,
          // v34 布局持久化：不通过 sheets 配置传 columnWidthConfig/rowHeightConfig——
          // ListTable.isAutoRowHeight 对 rowHeightConfig 做 truthy 判断（空数组也成立），
          // 会强制全表逐行内容自适应行高导致错位；改由下方 applySheetLayout 公开 API 恢复
        },
      ],
    })
    sheetInstanceRef.current = sheet
    // v34 布局恢复：编辑已保存订单优先用订单自身布局；新建订单/切换模板继承所选模板布局
    applySheetLayout(sheet, initLayout, TableConstants.SHEET_KEY)
    // 将公式引擎引用赋值给模块级变量，供 getCellStyle 实时检测公式单元格
    activeFormulaManager = (sheet as any).formulaManager

    // 只读模式：禁用表格编辑（覆盖 getEditor 使所有单元格不可编辑）
    if (readOnly) {
      const roWs = sheet.getActiveSheet()
      const roTable = roWs?.tableInstance as any
      if (roTable) {
        roTable.getEditor = () => undefined
      }
    }

    // 表格对订单信息的联动（动态定位行和列）：
    // 成本价       = 汇总行 × 参考卖价列（以"汇总"文字定位行，以"参考卖价"列标题定位列）
    // 单个卖价：已改为手动输入，不再与表格联动（数据库加载时恢复，保存时随订单持久化）
    // 产品规格 = 成品行 宽(CM) "*" 高(CM) "*" 底(CM)
    // 数量     = 成品行 数量(个)
    // 直接通过 formulaManager 读取公式计算结果（构造时已载入引擎，编辑后由 WorkSheet 级联重算）
    const activeWs = sheet.getActiveSheet()
    const activeTable = activeWs?.tableInstance as any
    // 复制功能增强：让纯文本模式也带公式 + HTTP 环境下接管剪贴板写入
    const cleanupCopyEnhancer = setupCopyFormulaEnhancement(sheet, activeTable, TableConstants.SHEET_KEY)
    const syncFromTable = () => {
      const fm = (sheet as any).formulaManager
      if (!fm) return
      try {
        // 从表格实例构建二维数组（用于动态定位行和列）
        const rowCount = activeTable?.rowCount ?? 0
        const colCount = activeTable?.colCount ?? 16
        const tableData: any[][] = []
        for (let r = 0; r < rowCount; r++) {
          const rowData: any[] = []
          for (let c = 0; c < colCount; c++) {
            rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
          }
          tableData.push(rowData)
        }

        // 动态定位：汇总行、参考卖价行、成品行、参考卖价列、含税价列
        const pos = findTablePositions(tableData)

        // 备料数据提取：第二个标题行前的规格区（名称/数量/切片宽/切片高/布料米数），
        // 联动「做货流程-面料采购」材料清单；比对去重避免无变化重渲染
        const prepRows = extractFabricPrepRows(tableData)
        setFabricPrepRows((prev) => (JSON.stringify(prev) === JSON.stringify(prepRows) ? prev : prepRows))

        // 成本价 = 汇总行 × 参考卖价列（公式单元格，读取引擎计算结果）
        const rCost = pos.summaryRow >= 0
          ? fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.summaryRow, col: pos.refSellCol })
          : null
        const costVal = rCost && typeof rCost.value === 'number' && !isNaN(rCost.value) ? rCost.value : null
        setCostPrice(costVal)
        // 含税价 = 成本价 × 1.1（自动计算）
        setPriceWithTax(costVal !== null ? Number((costVal * 1.1).toFixed(2)) : null)

        // 单个卖价不与表格联动：保留用户手动输入的值（loadQuote 时从数据库恢复）

        // 产品规格 / 数量（成品行数据单元格）
        const fmtVal = (v: any): string => (v == null || v === '') ? '' : String(v)
        const width = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.finishedRow, col: 2 })
        const height = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.finishedRow, col: 3 })
        const base = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.finishedRow, col: 4 })
        const qty = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.finishedRow, col: 1 })
        const newSpec = [fmtVal(width?.value), fmtVal(height?.value), fmtVal(base?.value)].join('*')
        const newQty = fmtVal(qty?.value)

        // 手提规格联动：找到第一个叫"手提"的行，拼接成品尺寸和切片尺寸
        let handleSpec = ''
        for (let r = 0; r < rowCount; r++) {
          const rowLabel = activeTable.getCellOriginValue?.(0, r) ?? activeTable.getCellValue?.(0, r)
          if (rowLabel === '手提') {
            const hw = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: r, col: 2 })
            const hh = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: r, col: 3 })
            const sw = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: r, col: 7 })
            const sh = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: r, col: 8 })
            const w = fmtVal(hw?.value), h = fmtVal(hh?.value)
            const sW = fmtVal(sw?.value), sH = fmtVal(sh?.value)
            const parts: string[] = []
            if (w && h) parts.push(`成品尺寸：${w}*${h}`)
            if (sW && sH) parts.push(`切片尺寸${sW}*${sH}`)
            handleSpec = parts.join('，')
            break
          }
        }

        setOrderInfo((prev) => {
          if (prev.productSpec === newSpec && prev.quantity === newQty && prev.handleSpec === handleSpec) return prev
          return { ...prev, productSpec: newSpec, quantity: newQty, handleSpec }
        })
      } catch {
        // 公式引擎未就绪时忽略，后续 change_cell_value 事件会重新读取
      }
    }
    // === 公式单元格重算：覆盖模板中的静态默认值 ===
    // 模板 data 中公式单元格带有预设默认值（可能是旧的/不精确的），
    // 此函数从公式引擎读取计算结果，覆盖表格 record 中的静态默认值，确保显示准确。
    // 非公式单元格不受影响，保留其默认值。
    //
    // 注意：不能调用 fm.setCellContent 重新注册公式 —— 实测会导致公式引擎清空所有
    // 公式单元格的计算值（变为 undefined），级联依赖（如 J8=SUM(J6:J7)）全部失效。
    // 公式引擎在 VTableSheet 构造时已注册公式，getCellValue 会按需重算，直接读取即可。
    const formulaEntries = Object.entries(activeFormulas)
      .map(([addr, formula]) => ({ ...ExcelUtils.parseAddress(addr), formula }))
      .filter((e) => e.row >= 0 && e.col >= 0)
    const isRecalculating = { current: false }
    const recalculateFormulas = () => {
      if (isRecalculating.current) return
      const fm = (sheet as any).formulaManager
      const ws = sheet.getActiveSheet()
      if (!fm || !ws) return
      isRecalculating.current = true
      try {
        // 读取公式引擎计算结果，覆盖表格 record 中的静态默认值
        // ws.setCellValue 更新 record（触发 change_cell_value，但 isRecalculating 标志阻止递归）
        for (const { row, col } of formulaEntries) {
          const result = fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row, col })
          if (result && typeof result.value === 'number' && !isNaN(result.value)) {
            ;(ws as any).setCellValue(col, row, result.value)
          }
        }
      } catch {
        // 公式引擎未就绪时忽略，后续事件会重新触发
      } finally {
        isRecalculating.current = false
      }
    }

    // 初始重算：覆盖模板中公式单元格的静态默认值，然后同步订单信息
    recalculateFormulas()
    syncFromTable()
    // 公式引擎可能在构造后异步完成计算，延迟再次重算+读取以确保公式值正确初始化
    const initTimer1 = setTimeout(() => { recalculateFormulas(); syncFromTable() }, 100)
    const initTimer2 = setTimeout(() => { recalculateFormulas(); syncFromTable() }, 500)
    // 监听单元格变更：先重算公式单元格（覆盖静态值），再同步订单信息，最后刷新样式
    const onCellChange = () => {
      // 仅用户编辑（非程序重算）触发的变更标记为 dirty，用于款式切换提示
      if (!isRecalculating.current) setIsTableDirty(true)
      recalculateFormulas()
      syncFromTable()
      // 实时刷新单元格样式：用户可能新增/删除/修改公式，需重新检测公式单元格并应用浅橙背景
      // invalidate 使 VTable 丢弃渲染缓存并重新调用 getCellStyle，确保公式高亮实时更新
      try { activeTable?.invalidate?.() } catch { /* VTable 未就绪时忽略 */ }
      // 选中单元格的值发生变化时，实时更新汇总状态栏
      computeCurrentSummary()
    }
    if (activeTable?.on) {
      activeTable.on('change_cell_value', onCellChange)
    }

    // === 选中单元格汇总计算 ===
    // 读取当前选区范围并计算 求和/平均值/计数/数值计数/最小值/最大值。
    // getSelectedCellRanges 支持非连续多选区；getCellOriginValue 读取原始值（含公式结果）。
    // 无选区时返回 null，状态栏显示提示文本。
    const computeCurrentSummary = () => {
      try {
        const ranges = activeTable?.getSelectedCellRanges?.() as CellRangeLike[] | undefined
        if (!ranges || ranges.length === 0) {
          setSelectionSummary(null)
          return
        }
        const summary = computeSelectionSummary(ranges, (col, row) => {
          // 布料米数列参与汇总时先向上取整（与其他显示/计算口径一致）
          const v = activeTable?.getCellOriginValue?.(col, row)
          return col === sheetMetersCol ? ceilFabricMeters(v) : v
        })
        setSelectionSummary(summary)
      } catch {
        // VTable 未就绪时忽略，后续事件会重新触发
      }
    }
    // 选区变化（鼠标框选、键盘 Shift+方向键、Ctrl 多选等）时重新计算
    const onSelectionChanged = () => computeCurrentSummary()
    // 选区清除时清空汇总
    const onSelectionClear = () => setSelectionSummary(null)
    if (activeTable?.on) {
      activeTable.on('selected_changed', onSelectionChanged)
      activeTable.on('selected_clear', onSelectionClear)
      activeTable.on('drag_select_end', onSelectionChanged)
    }

    // 监听新增列事件，确保新增列也有样式和字段格式化函数
    const onAddColumn = () => {
      try {
        const currentCols = activeTable?.columns || []
        const newCols = currentCols.map((_col: any, index: number) => ({
          field: index,
          key: index,
          width: TableConstants.COL_WIDTHS[index] || 100, // 使用默认宽度
          style: getCellStyle,
          fieldFormat: (record: any, col?: number, row?: number) =>
            formatFieldValue(record?.[index], col ?? index, row),
        }))
        activeTable?.updateColumns(newCols)
      } catch (error) {
        console.error('更新列定义失败:', error)
      }
    }
    if (activeTable?.on) {
      activeTable.on('add_column', onAddColumn)
    }

    // 监听容器尺寸变化（如收缩/展开左侧菜单栏），触发 VTable 重新布局
    const resizeObserver = new ResizeObserver(() => {
      sheet.resize()
    })
    resizeObserver.observe(sheetContainerRef.current)

    // 修复子菜单位置：VTable 子菜单 position 为 absolute，但 left/top 使用视口坐标，
    // 页面滚动时会错位。在子菜单添加到 DOM 后（VTable 已设置好 left/top 像素值），
    // 将 position 改为 fixed，使 left/top 基于视口（MutationObserver 在微任务中执行，无闪烁）
    const menuObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('vtable-context-submenu-container')) {
            node.style.position = 'fixed'
          }
        }
      }
    })
    menuObserver.observe(document.body, { childList: true })

    return () => {
      if (activeTable?.off) {
        activeTable.off('change_cell_value', onCellChange)
        activeTable.off('selected_changed', onSelectionChanged)
        activeTable.off('selected_clear', onSelectionClear)
        activeTable.off('drag_select_end', onSelectionChanged)
        activeTable.off('add_column', onAddColumn)
      }
      cleanupCopyEnhancer()
      clearTimeout(initTimer1)
      clearTimeout(initTimer2)
      clearTimeout(sivTimer)
      restoreSIV()
      resizeObserver.disconnect()
      menuObserver.disconnect()
      sheet.release()
      sheetInstanceRef.current = null
      activeFormulaManager = null
      cellStyleOverrides.clear()
      cellFormatOverrides.clear()
      // 重置汇总状态栏，避免重建表格后残留旧选区数据
      setSelectionSummary(null)
    }
  }, [orderInfo.productStyle, orderInfo.templateId, tableDataVersion, templatesReady])

  // 图片压缩：所有图片统一通过 canvas 压缩为 JPEG，限制尺寸和大小
  // 目标：单张图片 base64 不超过 200KB，避免多张图片叠加后数据量过大导致存储/传输异常
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              reject(new Error('无法获取 canvas 上下文'))
              return
            }
            // 限制长边最大 1280px，避免超大图导致 canvas 内存过大
            let { width, height } = img
            const MAX_DIM = 1280
            if (width > MAX_DIM || height > MAX_DIM) {
              if (width > height) {
                height = Math.round(height * MAX_DIM / width)
                width = MAX_DIM
              } else {
                width = Math.round(width * MAX_DIM / height)
                height = MAX_DIM
              }
            }
            canvas.width = width
            canvas.height = height
            // PNG 等带透明通道的图片，先填充白底再绘制，避免透明区域变黑
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, width, height)
            ctx.drawImage(img, 0, 0, width, height)
            // 目标大小：200KB（base64 字符串长度）
            const MAX_SIZE = 200 * 1024
            let quality = 0.8
            let result = canvas.toDataURL('image/jpeg', quality)
            // 逐步降低质量
            while (result.length > MAX_SIZE && quality > 0.3) {
              quality -= 0.1
              result = canvas.toDataURL('image/jpeg', quality)
            }
            // 如果仍超过目标，缩小尺寸后重试
            while (result.length > MAX_SIZE && width > 400) {
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

  // 串行处理多张图片，避免并发压缩导致内存飙升和主线程阻塞
  const processFiles = async (files: File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    for (const file of imageFiles) {
      try {
        const base64 = await compressImage(file)
        setProductImages((prev) => [...prev, base64])
      } catch (error) {
        console.error('图片处理失败:', error)
      }
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    processFiles(Array.from(files))
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    // 多平台拖拽：files（微信/本地文件/截图）优先；网页图片（1688 等）从 html/uri-list
    // 提取 URL 后下载（浏览器直连 → 后端代理兜底绕过 CORS/防盗链）
    void extractImageFilesFromDataTransfer(e.dataTransfer).then((files) => {
      if (files.length > 0) processFiles(files)
    })
  }

  const handleImageRemove = (index: number) => {
    setProductImages((prev) => prev.filter((_, i) => i !== index))
  }

  // === 图片拖拽排序（原生 HTML5 Drag & Drop） ===
  const handleImageDragStart = (index: number) => {
    setDraggedIndex(index)
  }
  const handleImageDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index)
    }
  }
  const handleImageDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }
  const handleImageDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null)
      setDragOverIndex(null)
      return
    }
    setProductImages((prev) => {
      const next = [...prev]
      const [moved] = next.splice(draggedIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const updateOrderField = (field: keyof OrderInfo, value: string) => {
    setOrderInfo((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  // 款式/表格模板树形二级下拉：一次选择同时更新款式（一级）与该款式下的模板（二级）
  // 选项值编码为 `${styleCode}|${templateId}`，templateId 为空 = 内置默认模板
  // 切换时若有未保存的表格编辑则提示确认；确认后清除表格状态，触发表格按新款式/模板重新初始化
  const handleStyleTemplateChange = (combined: string) => {
    const sep = combined.indexOf('|')
    const style = combined.slice(0, sep)
    const templateId = combined.slice(sep + 1)
    if (style === orderInfo.productStyle && templateId === orderInfo.templateId) return
    // 警告：切换后表格用新模板重新初始化，不仅是"未保存的修改丢失"——
    // 订单已保存到数据库的表格数据也会在下次保存时被模板默认数据替换（生产事故场景），
    // 必须明确告知用户影响范围
    const savedRows = isEditMode ? (loadedTableDataRef.current?.length ?? 0) : 0
    const warnings: string[] = []
    if (isTableDirty) warnings.push('当前在线表格有未保存的修改，切换后将丢失。')
    if (savedRows > 0) warnings.push(`注意：订单已保存的 ${savedRows} 行表格数据也将被新模板默认数据替换！`)
    if (warnings.length > 0) {
      const ok = window.confirm(warnings.join('\n') + '\n\n点击"确认"切换款式/模板，点击"取消"保持现状。')
      if (!ok) return // 取消：保持现状
    }
    // 清除所有表格相关状态，加载新模板（allFormulasRef 清空为 {}，表格初始化时回退到模板公式）
    loadedTableDataRef.current = null
    allFormulasRef.current = {}
    // 布局配置（v34）：切换后用新模板布局重新初始化，原订单布局不保留
    loadedLayoutRef.current = null
    setIsTableDirty(false)
    setOrderInfo((prev) => ({ ...prev, productStyle: style, templateId }))
  }

  const handleReset = () => {
    setOrderInfo(DEFAULT_ORDER_INFO)
    setProductImages([])
  }

  // 复制报价：将订单信息格式化为文本，方便粘贴到聊天工具中报价
  // 即使部分数据为空也保留标签前缀，保持格式一致
  const handleCopyQuote = () => {
    const styleLabel = styleOptions.find((s) => s.value === orderInfo.productStyle)?.label || ''

    const productParts = [
      orderInfo.productSpec,
      styleLabel,
      orderInfo.handleSpec ? `手提宽度${orderInfo.handleSpec}` : '',
    ].filter(Boolean)

    const sampleParts = [
      orderInfo.sampleFee ? `${orderInfo.sampleFee}元` : '',
      orderInfo.sampleDays ? `${orderInfo.sampleDays}个` : '',
      '大货可退',
    ].filter(Boolean)

    const lines: string[] = [
      `订单号：${quoteNumber}`,
      `数量：${orderInfo.quantity}`,
      `成品：${productParts.join('-')}`,
      `材质：${orderInfo.fabricMaterial}`,
      `工艺：${orderInfo.process}`,
      `价格：${sellPrices.noTax !== null ? sellPrices.noTax.toFixed(2) : ''}元/个  含运不含税`,
      `箱规：${orderInfo.boxSpec}`,
      `打样：${sampleParts.join(' ')}`,
      `交期：${orderInfo.massDays}天`,
    ]
    if (orderInfo.remark) lines.push(`备注：${orderInfo.remark}`)

    const text = lines.join('\n')
    copyText(text).then((ok) => {
      if (ok) {
        setShowCopySuccess(true)
        setTimeout(() => setShowCopySuccess(false), 2000)
      } else {
        setSaveError('复制失败，请手动选择文本复制')
        setTimeout(() => setSaveError(''), 3000)
      }
    })
  }

  // 复制报价图片：从"单个卖价行"到"图片最底部"截图复制到剪贴板
  const handleCopyQuoteImage = async () => {
    const card = quoteCardRef.current
    const startEl = sellPriceRowRef.current
    const endEl = imagesEndRef.current
    if (!card || !startEl || !endEl) return

    setCopyingImage(true)
    try {
      // modern-screenshot 基于浏览器原生渲染，支持 flex/grid/gap/aspect-ratio/object-fit 等现代 CSS
      const { domToPng } = await import('modern-screenshot')
      const dataUrl = await domToPng(card, {
        scale: 2,
        backgroundColor: '#ffffff',
      })

      // 将 dataURL 转为 canvas 并裁剪
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = dataUrl
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('图片加载失败'))
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 不可用')
      ctx.drawImage(img, 0, 0)

      // 计算裁剪范围（相对画布坐标）
      const cardRect = card.getBoundingClientRect()
      const startRect = startEl.getBoundingClientRect()
      const endRect = endEl.getBoundingClientRect()
      const scaleY = canvas.height / cardRect.height
      const startY = (startRect.top - cardRect.top) * scaleY
      const endY = (endRect.bottom - cardRect.top) * scaleY
      const cropH = Math.max(1, endY - startY)

      const cropped = document.createElement('canvas')
      cropped.width = canvas.width
      cropped.height = cropH
      const cctx = cropped.getContext('2d')
      if (!cctx) throw new Error('canvas 不可用')
      cctx.drawImage(canvas, 0, startY, canvas.width, cropH, 0, 0, canvas.width, cropH)

      // 复制到剪贴板（安全上下文）；否则降级下载图片
      const blob: Blob | null = await new Promise((resolve) => cropped.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('生成图片失败')

      const fileName = `报价_${orderInfo.customerName || ''}_${orderInfo.productSpec || ''}.png`
      if (navigator.clipboard && window.isSecureContext && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          setShowCopyImageSuccess(true)
          setTimeout(() => setShowCopyImageSuccess(false), 2000)
        } catch {
          // 剪贴板写入失败（如浏览器不支持图片），降级下载
          downloadBlob(blob, fileName)
          setShowCopyImageSuccess(true)
          setTimeout(() => setShowCopyImageSuccess(false), 2000)
        }
      } else {
        // HTTP 环境降级下载
        downloadBlob(blob, fileName)
        setShowCopyImageSuccess(true)
        setTimeout(() => setShowCopyImageSuccess(false), 2000)
      }
    } catch (err) {
      console.error('复制报价图片失败:', err)
      setSaveError('复制图片失败，请重试')
      setTimeout(() => setSaveError(''), 3000)
    } finally {
      setCopyingImage(false)
    }
  }

  const handleNextStatus = async () => {
    if (!isEditMode || status === 6) return
    setLoading(true)
    try {
      const data = await api.quotes.nextStatus(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          sampleCompletedTime: data.sampleCompletedTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          reconciledTime: data.reconciledTime || '',
          endTime: data.endTime || '',
        })
        setShowSaveSuccess(true)
        setTimeout(() => setShowSaveSuccess(false), 3000)
      }
    } catch (error) {
      console.error('状态流转失败:', error)
    }
    setLoading(false)
  }

  const handlePrevStatus = async () => {
    if (!isEditMode || status === 1) return
    setLoading(true)
    try {
      const data = await api.quotes.prevStatus(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          sampleCompletedTime: data.sampleCompletedTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          reconciledTime: data.reconciledTime || '',
          endTime: data.endTime || '',
        })
        setShowSaveSuccess(true)
        setTimeout(() => setShowSaveSuccess(false), 3000)
      }
    } catch (error) {
      console.error('状态退回失败:', error)
    }
    setLoading(false)
  }

  const handleEndQuote = async () => {
    if (!isEditMode || !OrderStatus.canEnterFinished(status)) return
    setLoading(true)
    try {
      const data = await api.quotes.endQuote(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          sampleCompletedTime: data.sampleCompletedTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          reconciledTime: data.reconciledTime || '',
          endTime: data.endTime || '',
        })
        setShowSaveSuccess(true)
        setTimeout(() => setShowSaveSuccess(false), 3000)
      }
    } catch (error) {
      console.error('结束报价失败:', error)
    }
    setLoading(false)
  }

  // 订单管理不允许手动流转到已对账(8)：5→8 仅可经订单对账管理「确认对账」，8→5 仅可经其「退回对账」
  const canGoNext = OrderStatus.getNext(status) !== null && status !== OrderStatus.SHIPPED_PAID
  const canGoPrev = OrderStatus.getPrev(status) !== null && status !== OrderStatus.RECONCILED
  const canEnd = OrderStatus.canEnterFinished(status)

  // === 价格联动计算（实时联动：依赖 成本价/含税价/单个卖价/数量） ===
  // 保留2位小数辅助函数：总额计算以保留2位小数的价格为基础
  const round2 = (n: number) => Math.round(n * 100) / 100
  const qty = parseFloat(orderInfo.quantity) || 0
  // 基础价格统一保留2位小数后参与计算
  const costVal = round2(costPrice ?? 0)
  const priceWithTaxVal = round2(priceWithTax ?? 0)
  const sellNoTaxVal = round2(sellPrices.noTax ?? 0)
  const sellWithTaxVal = round2(sellPrices.withTax ?? 0)
  // 单个利润 = 单个卖价 - 成本价（不含税/含税 分别对应），结果保留2位小数
  const profitPerNoTax = round2(sellNoTaxVal - costVal)
  const profitPerWithTax = round2(sellWithTaxVal - priceWithTaxVal)
  // 利润总额 = (单个卖价 - 成本价) × 数量，以保留2位小数的单个利润为计算基础
  const profitTotalNoTax = round2(profitPerNoTax * qty)
  const profitTotalWithTax = round2(profitPerWithTax * qty)
  // 销售总额 = 数量 × 单个卖价，以保留2位小数的单个卖价为计算基础
  const sellTotalNoTax = round2(sellNoTaxVal * qty)
  const sellTotalWithTax = round2(sellWithTaxVal * qty)

  // 待收总金额自动重算（v18 公式）：
  //   抵扣大货=是：销售总额(不含税) - 已收打样费 - 定金
  //   抵扣大货=否：销售总额(不含税) + 应收打样费 - 已收打样费 - 定金
  // 仅"做货中(3)"状态触发自动计算；"已发货已收款(5)"状态待收总额归零；其他状态不自动重算
  // 用户手动修改过待收总金额后不再自动重算（pendingAmountManualRef 标记）
  const receivableFeeVal = round2(receivableSampleFee ?? 0)
  const sampleFeeVal = round2(actualSampleFee ?? 0)
  const depositVal = round2(deposit ?? 0)
  const autoPendingAmount = round2(
    sellTotalNoTax + (sampleFeeDeduct ? -sampleFeeVal : round2(receivableFeeVal - sampleFeeVal)) - depositVal
  )
  useEffect(() => {
    if (status === 3 || status === 4) {
      // 做货中 / 已发货未收款：自动计算待收总额（手动修改过则保留手动值）
      if (!pendingAmountManualRef.current) {
        setPendingAmount(autoPendingAmount)
      }
    } else {
      // 其他状态（已发货已收款、退回打样等）：待收总额清零
      setPendingAmount(0)
      pendingAmountManualRef.current = false
    }
  }, [autoPendingAmount, status])

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶部悬浮栏（sticky 使其限定在 main 内容区内，不覆盖左侧菜单栏） */}
      <div className="shrink-0 sticky top-14 md:top-0 z-30 md:z-50 bg-white/95 backdrop-blur-sm shadow-sm border-b border-gray-100">
        <div className="px-4 sm:px-6 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                <ShoppingBag className="text-blue-600" size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2 leading-tight">
                  <h1 className="text-lg font-bold text-gray-800">订单管理</h1>
                  {/* 当前模式状态标识：编辑/查看 */}
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${readOnly ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                    {readOnly ? '查看模式' : '编辑模式'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 leading-tight">订单信息管理</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-end">
              <button onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/quotes')} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[40px] sm:min-h-0">
                <ArrowLeft size={16} />
                返回
              </button>
              {/* readOnly 模式：显示编辑按钮（仅有编辑权限时） */}
              {readOnly && canEdit && (
                <button onClick={() => navigate(`/quotes/${id}/edit`, { replace: true })} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors min-h-[40px] sm:min-h-0">
                  <Edit size={16} />
                  编辑
                </button>
              )}
              <button onClick={handleCopyQuote} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[40px] sm:min-h-0" title="复制订单信息为文本格式，方便报价">
                <ClipboardList size={16} />
                {showCopySuccess ? '已复制' : '复制报价'}
              </button>
              <button onClick={handleCopyQuoteImage} disabled={copyingImage} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 min-h-[40px] sm:min-h-0" title="复制卖价到图片的报价截图">
                {copyingImage ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                {copyingImage ? '截图中' : showCopyImageSuccess ? '已复制' : '复制图片'}
              </button>
              {/* readOnly 模式：隐藏保存和重置按钮 */}
              {!readOnly && (
                <>
                  <button onClick={() => handleSave()} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 min-h-[40px] sm:min-h-0">
                    <Save size={16} />
                    {showSaveSuccess ? '保存成功' : '保存'}
                  </button>
                  <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[40px] sm:min-h-0">
                    <RotateCcw size={16} />
                    重置
                  </button>
                </>
              )}
              <button onClick={handleExportWithTable} disabled={exporting || !hasQuoteId} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-primary-700 border border-primary-200 bg-white rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px] sm:min-h-0" title={!hasQuoteId ? '请先保存订单' : '导出订单及在线表格到 Excel（保留公式）'}>
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting ? '导出中...' : '导出 Excel'}
              </button>
              <button onClick={handleOpenPrint} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-primary-700 border border-primary-200 bg-white rounded-lg hover:bg-primary-50 transition-colors min-h-[40px] sm:min-h-0" title="打印订单">
                <Printer size={16} />
                打印
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域（shrink-0：订单信息区按内容高度，不压缩）
          min-w-0 + overflow-hidden：允许 flex 子元素收缩，使状态流转的 overflow-x-auto 生效，
          避免 480px 最小宽度撑破 375px 移动端视口 */}
      <div className="shrink-0 px-4 sm:px-6 pt-4 pb-0 w-full min-w-0 overflow-hidden">
        {/* v24 标签页切换行：Tab1 订单信息 / Tab2 订单做货流程（独立切换固定行，位于订单状态流转上方） */}
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => switchTab('info')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeTab === 'info'
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            <ClipboardList size={13} />
            订单信息
          </button>
          <button
            onClick={() => switchTab('production')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              activeTab === 'production'
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            <Play size={13} />
            订单做货流程
          </button>
        </div>

        {/* 状态流转（位于卖价上方） */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-2">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <Flag className="text-gray-400" size={15} />
              <h3 className="text-xs font-semibold text-gray-700">订单状态流转</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {isEditMode && canGoPrev && (
                <button
                  onClick={handlePrevStatus}
                  disabled={loading}
                  className="flex items-center gap-0.5 px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <ChevronLeft size={13} />
                  退回
                </button>
              )}
              {isEditMode && canGoNext && (
                <button
                  onClick={handleNextStatus}
                  disabled={loading}
                  className="flex items-center gap-0.5 px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  下一节点
                  <ChevronRight size={13} />
                </button>
              )}
              {isEditMode && canEnd && (
                <button
                  onClick={handleEndQuote}
                  disabled={loading}
                  className="flex items-center gap-0.5 px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Square size={11} />
                  结束
                </button>
              )}
            </div>
          </div>

          <div className={`overflow-x-auto ${activeTab === 'info' ? '' : 'hidden'}`}>
            <div className="flex items-center px-1 min-w-[480px] sm:min-w-0">
            {STATUS_OPTIONS.map((option, index) => {
              const isCurrent = option.value === status
              const isPast = OrderStatus.getFlowPosition(option.value) < OrderStatus.getFlowPosition(status)
              const nodeTime = statusTimeNodes[
                option.value === 1 ? 'quoteTime' :
                option.value === 2 ? 'sampleTime' :
                option.value === 7 ? 'sampleCompletedTime' :
                option.value === 3 ? 'productionStartTime' :
                option.value === 4 ? 'shippingTime' :
                option.value === 5 ? 'paymentTime' :
                option.value === 8 ? 'reconciledTime' : 'endTime'
              ] as string

              return (
                <div key={option.value} className="flex items-center">
                  <div className="flex flex-col items-center text-center" title={`${option.label}：${nodeTime || '-'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      isCurrent ? 'bg-primary-500 text-white ring-2 ring-primary-100' :
                      isPast ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'
                    }`}>
                      {isCurrent ? (
                        <CircleDot size={13} />
                      ) : isPast ? (
                        <CheckCircle size={12} />
                      ) : (
                        <Circle size={12} />
                      )}
                    </div>
                    <p className={`text-[10px] font-medium mt-1 ${
                      isCurrent ? 'text-primary-600' : 'text-gray-600'
                    }`}>{option.label}</p>
                  </div>
                  {index < STATUS_OPTIONS.length - 1 && (
                    <div className="flex items-center px-1 flex-1">
                      <div className={`flex-1 h-0.5 ${isPast ? 'bg-primary-500' : 'bg-gray-200'}`}></div>
                      <ChevronRight size={14} className={isPast ? 'text-primary-500' : 'text-gray-300'} />
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </div>
        </div>

        {/* 主体：订单信息 + 在线表格 （合并标题节省一行空间；v24 做货流程已移至第二个标签页） */}
        <div className={`mb-0 ${activeTab === 'info' ? '' : 'hidden'}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <ClipboardList size={15} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-700">订单信息</h3>
            <span className="text-gray-300">·</span>
            <Table2 size={14} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-700">在线表格</h3>
            {/* 布料米数取整规则提示（悬停显示说明） */}
            <span className="flex items-center gap-0.5 text-gray-400 cursor-help" title="布料米数(M)列采用向上取整规则：该字段所有输入值将被自动进位至整数位（如 1.1 → 2），保存、打印与导出均按取整后的值处理。">
              <Info size={12} />
              <span className="text-[10px]">布料米数向上取整</span>
            </span>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div ref={quoteCardRef} className="p-3 pb-1 space-y-2">
              {/* 成本价行：成本价(不含税) + 含税价 + 单个利润(不含税/含税) + 利润总额(不含税/含税) */}
              <div className={`flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-gray-50 to-transparent rounded-lg flex-wrap ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
                {/* 成本价输入组 */}
                <div className="flex items-center gap-1.5">
                  <DollarSign className="text-gray-400" size={15} />
                  <span className="text-xs text-gray-500">成本价</span>
                  <span className="text-[11px] text-gray-400">不含税</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">¥</span>
                  <PriceInput
                    value={costPrice}
                    onChange={(val) => {
                      setCostPrice(val)
                      setPriceWithTax(val !== null ? Number((val * 1.1).toFixed(2)) : null)
                    }}
                    className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-gray-600 bg-gray-50/40 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">含税</span>
                  <span className="text-[11px] text-gray-400">¥</span>
                  <PriceInput
                    value={priceWithTax}
                    onChange={setPriceWithTax}
                    className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-gray-600 bg-gray-50/40 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                  />
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 单个利润组 = 单个卖价 - 成本价 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">单个利润</span>
                  <span className="text-[10px] text-red-400">不含税</span>
                  <span className="text-[11px] text-red-400">¥</span>
                  <div className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-red-600 bg-red-50/40 border border-red-200 rounded text-right">
                    {profitPerNoTax.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-green-500">含税</span>
                  <span className="text-[11px] text-green-500">¥</span>
                  <div className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-green-700 bg-green-50/40 border border-green-200 rounded text-right">
                    {profitPerWithTax.toFixed(2)}
                  </div>
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 利润总额组 = (单个卖价 - 成本价) × 数量 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-500">利润总额</span>
                  <span className="text-[10px] text-red-400">不含税</span>
                  <span className="text-[11px] text-red-400">¥</span>
                  <div className="w-28 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-red-700 bg-red-100/50 border border-red-300 rounded text-right">
                    {profitTotalNoTax.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-green-600">含税</span>
                  <span className="text-[11px] text-green-600">¥</span>
                  <div className="w-28 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-green-800 bg-green-100/50 border border-green-300 rounded text-right">
                    {profitTotalWithTax.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 单个卖价行：单个卖价(不含税) + 单个卖价(含税) + 销售总额(不含税/含税) */}
              <div ref={sellPriceRowRef} className="flex items-center gap-4 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-transparent rounded-lg flex-wrap">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="text-gray-400" size={15} />
                  <span className="text-xs text-gray-500">单个卖价</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-red-400">不含税</span>
                  <span className="text-xs text-red-400">¥</span>
                  <PriceInput
                    value={sellPrices.noTax}
                    onChange={(val) => {
                      // 含税 = 不含税 × 1.1（自动联动，与成本价→含税价模式一致）
                      setSellPrices({ noTax: val, withTax: val !== null ? Number((val * 1.1).toFixed(2)) : null })
                    }}
                    className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-red-600 bg-red-50/40 border border-red-200 rounded focus:outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <TrendingUp className="text-blue-400" size={14} />
                  <span className="text-[11px] text-blue-400">含税</span>
                  <span className="text-xs text-blue-400">¥</span>
                  <PriceInput
                    value={sellPrices.withTax}
                    onChange={(val) => setSellPrices(prev => ({ ...prev, withTax: val }))}
                    className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-blue-600 bg-blue-50/40 border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  />
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 销售总额组 = 数量 × 单个卖价 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-500">销售总额</span>
                  <span className="text-[10px] text-red-400">不含税</span>
                  <span className="text-[11px] text-red-400">¥</span>
                  <div className="w-28 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-red-700 bg-red-100/50 border border-red-300 rounded text-right">
                    {sellTotalNoTax.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-blue-500">含税</span>
                  <span className="text-[11px] text-blue-500">¥</span>
                  <div className="w-28 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-blue-700 bg-blue-100/50 border border-blue-300 rounded text-right">
                    {sellTotalWithTax.toFixed(2)}
                  </div>
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 收款信息组：应收打样费 + 实收打样费 + 抵扣开关 + 定金 + 待收总额（紧凑排版，内层 gap-2） */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1" title="应收打样费：客户应付的打样费用">
                    <span className="text-[11px] text-gray-500">应收打样费</span>
                    <span className="text-[11px] text-orange-500">¥</span>
                    <PriceInput
                      value={receivableSampleFee}
                      onChange={setReceivableSampleFee}
                      className="w-20 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-orange-600 bg-orange-50/40 border border-orange-200 rounded focus:outline-none focus:ring-1 focus:ring-orange-400 focus:border-orange-400"
                    />
                  </div>
                  <div className="flex items-center gap-1" title="实际收取打样费">
                    <span className="text-[11px] text-gray-500">实收打样费</span>
                    <span className="text-[11px] text-amber-500">¥</span>
                    <PriceInput
                      value={actualSampleFee}
                      onChange={setActualSampleFee}
                      className="w-20 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-amber-600 bg-amber-50/40 border border-amber-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                    />
                  </div>
                  <label className="flex items-center gap-1 cursor-pointer select-none shrink-0" title="打样费是否抵扣大货">
                    <input
                      type="checkbox"
                      checked={sampleFeeDeduct}
                      onChange={(e) => setSampleFeeDeduct(e.target.checked)}
                      className="w-3 h-3 accent-amber-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-gray-400">抵扣大货</span>
                  </label>
                  <div className="flex items-center gap-1" title="收取定金">
                    <span className="text-[11px] text-gray-500">定金</span>
                    <span className="text-[11px] text-purple-400">¥</span>
                    <PriceInput
                      value={deposit}
                      onChange={setDeposit}
                      className="w-20 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-purple-600 bg-purple-50/40 border border-purple-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-400 focus:border-purple-400"
                    />
                  </div>
                  <div className="flex items-center gap-1" title="待收总金额 = 销售总额(不含税) - 已收打样费 - 定金（抵扣大货=是）；销售总额(不含税) + 应收打样费 - 已收打样费 - 定金（抵扣大货=否）">
                    <span className="text-[11px] text-gray-500">待收总额</span>
                    <span className="text-[11px] text-emerald-500">¥</span>
                    <PriceInput
                      value={pendingAmount}
                      onChange={(val) => {
                        // 手动修改后停止自动重算
                        pendingAmountManualRef.current = true
                        setPendingAmount(val)
                      }}
                      className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-emerald-700 bg-emerald-50/40 border border-emerald-200 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                    />
                  </div>
                </div>
              </div>

              {/* 表单字段 - 密集网格。LG:6列 MD:4列 SM:2列
              同行规则：客户+打样费+箱规 / 大货日期+天数 / 面料+工艺+手提 / 收货地址+备注 */}
              <div className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-1.5 ${readOnly ? 'pointer-events-none opacity-60' : ''}`}>
                {/* 行1：订单号(只读) + 客户名称 + 订单状态(只读) + 打样费/天 + 箱规 */}
                {/* 订单号：16位随机数字（系统生成，全局唯一，只读），置于客户名称之前 */}
                <div className="col-span-1 md:col-span-1 lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">订单号</label>
                  <input
                    type="text"
                    value={quoteNumber}
                    readOnly
                    placeholder="保存后自动生成"
                    title="订单号由系统自动生成，创建后不可修改"
                    className="w-full px-2 py-1 text-sm font-mono text-gray-600 bg-gray-50 border border-gray-200 rounded cursor-default truncate"
                  />
                </div>
                <div className="col-span-1 md:col-span-1 lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">客户名称</label>
                  <CustomerSelect
                    value={orderInfo.customerName}
                    onChange={(v) => updateOrderField('customerName', v)}
                    address={orderInfo.shippingAddress}
                    onAddressChange={(v) => updateOrderField('shippingAddress', v)}
                    placeholder="请选择或输入客户名称"
                  />
                </div>
                {/* 订单状态（只读，不可修改） */}
                <div className="col-span-1 md:col-span-1 lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">订单状态</label>
                  <div className={`px-2 py-1 text-sm font-semibold rounded text-center ${
                    status === 1 ? 'bg-blue-100 text-blue-700' :
                    status === 2 ? 'bg-yellow-100 text-yellow-700' :
                    status === 7 ? 'bg-cyan-100 text-cyan-700' :
                    status === 3 ? 'bg-purple-100 text-purple-700' :
                    status === 4 ? 'bg-orange-100 text-orange-700' :
                    status === 5 ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {OrderStatus.getLabel(status)}
                  </div>
                </div>
                {/* 打样费与打样天数合并为文本输入框，格式：费用/天数 */}
                <div className="col-span-1 md:col-span-1 lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">打样费/天</label>
                  <input
                    type="text"
                    value={[orderInfo.sampleFee, orderInfo.sampleDays].filter(Boolean).join('/')}
                    onChange={(e) => {
                      const v = e.target.value
                      const idx = v.indexOf('/')
                      if (idx >= 0) {
                        updateOrderField('sampleFee', v.slice(0, idx))
                        updateOrderField('sampleDays', v.slice(idx + 1))
                      } else {
                        updateOrderField('sampleFee', v)
                        updateOrderField('sampleDays', '')
                      }
                    }}
                    placeholder="费用/天数"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="col-span-1 md:col-span-1 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">箱规</label>
                  <input type="text" value={orderInfo.boxSpec} onChange={(e) => updateOrderField('boxSpec', e.target.value)}
                    placeholder="箱规"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>

                {/* 行2：款式/表格模板（antd TreeSelect 树形二级联动下拉）+ 数量 + 产品规格 + 大货日期 + 天数 */}
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">款式 / 模板</label>
                  <TreeSelect
                    value={`${orderInfo.productStyle}|${orderInfo.templateId}`}
                    onChange={(value: unknown) => {
                      // 仅处理叶子节点（`${styleCode}|${templateId}` 编码）；款式分组节点被意外选中时忽略
                      if (typeof value === 'string' && value.includes('|')) {
                        handleStyleTemplateChange(value)
                      }
                    }}
                    treeData={styleTemplateTreeData}
                    treeNodeLabelProp="label"
                    treeDefaultExpandAll
                    treeExpandAction="click"
                    style={{ width: '100%' }}
                    className="style-template-select"
                    classNames={{ popup: { root: 'style-template-select-dropdown' } }}
                  />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">数量(个)</label>
                  <input type="text" value={orderInfo.quantity} onChange={(e) => updateOrderField('quantity', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">产品规格 宽*高*长(CM)</label>
                  <input type="text" value={orderInfo.productSpec} onChange={(e) => updateOrderField('productSpec', e.target.value)}
                    placeholder="产品规格"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="col-span-2 md:col-span-2 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">大货日期</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={orderInfo.productionTimeStart}
                      onChange={(e) => {
                        const newStart = e.target.value
                        updateOrderField('productionTimeStart', newStart)
                        // 联动：大货天数有值时，自动计算结束日期 = 开始日期 + 大货天数
                        const days = Number(orderInfo.massDays)
                        if (newStart && days) {
                          updateOrderField('productionTimeEnd', DateUtils.addDays(newStart, days))
                        }
                      }}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors cursor-pointer"
                    />
                    <span className="text-xs text-gray-500 shrink-0">到</span>
                    <input
                      type="date"
                      value={orderInfo.productionTimeEnd}
                      onChange={(e) => updateOrderField('productionTimeEnd', e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors cursor-pointer"
                    />
                  </div>
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">天数</label>
                  <input type="text" value={orderInfo.massDays} onChange={(e) => {
                      const newDays = e.target.value
                      updateOrderField('massDays', newDays)
                      // 联动：开始日期有值时，自动计算结束日期 = 开始日期 + 大货天数
                      const days = Number(newDays)
                      if (orderInfo.productionTimeStart && days) {
                        updateOrderField('productionTimeEnd', DateUtils.addDays(orderInfo.productionTimeStart, days))
                      }
                    }}
                    placeholder="天数"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>

                {/* 行3：面料材质 + 工艺 + 手提 — flex 精确控制比例（2:4:3）
                    面料材质缩短原长的1/3，工艺相应加长 */}
                <div className="col-span-2 md:col-span-4 lg:col-span-6 flex gap-x-3 gap-y-1.5">
                  <div style={{ flex: '2 1 0%' }}>
                    <label className="block text-xs text-gray-400 mb-0.5">面料材质</label>
                    <input type="text" value={orderInfo.fabricMaterial} onChange={(e) => updateOrderField('fabricMaterial', e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div style={{ flex: '4 1 0%' }}>
                    <label className="block text-xs text-gray-400 mb-0.5">工艺</label>
                    <input type="text" value={orderInfo.process} onChange={(e) => updateOrderField('process', e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  {/* 手提材质与手提规格合并为单字段，格式：手提材质：手提规格 */}
                  <div style={{ flex: '3 1 0%' }}>
                    <label className="block text-xs text-gray-400 mb-0.5">手提</label>
                    <input
                      type="text"
                      value={[orderInfo.handleMaterial, orderInfo.handleSpec].filter(Boolean).join('：')}
                      onChange={(e) => {
                        const v = e.target.value
                        const idx = v.indexOf('：')
                        if (idx >= 0) {
                          updateOrderField('handleMaterial', v.slice(0, idx))
                          updateOrderField('handleSpec', v.slice(idx + 1))
                        } else {
                          updateOrderField('handleMaterial', v)
                          updateOrderField('handleSpec', '')
                        }
                      }}
                      placeholder="材质：规格"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                </div>

                {/* 行4：收货地址 + 备注 */}
                <div className="col-span-2 md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-gray-400 mb-0.5">收货地址</label>
                  <textarea
                    value={orderInfo.shippingAddress}
                    onChange={(e) => updateOrderField('shippingAddress', e.target.value)}
                    placeholder="请输入收货地址"
                    rows={3}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors resize-none"
                  />
                </div>
                <div className="col-span-2 md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-gray-400 mb-0.5">备注</label>
                  <textarea
                    value={orderInfo.remark}
                    onChange={(e) => updateOrderField('remark', e.target.value)}
                    placeholder="请输入备注信息"
                    rows={3}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors resize-none"
                  />
                </div>
              </div>

                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <ImageIcon size={14} className="text-gray-400" />
                    <span className="text-xs font-medium text-gray-700">产品图片</span>
                  </div>
                  {/* readOnly 模式下隐藏上传按钮 */}
                  {!readOnly && (
                    <label className="cursor-pointer flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
                      <Upload size={12} />
                      上传图片
                      <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                    </label>
                  )}
                </div>
                {productImages.length === 0 ? (
                  readOnly ? (
                    <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-lg py-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center mb-1 bg-gray-100">
                        <ImageIcon size={15} className="text-gray-400" />
                      </div>
                      <p className="text-[11px] text-gray-400">暂无图片</p>
                    </div>
                  ) : (
                  <label
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg py-3 transition-colors cursor-pointer ${
                      isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${isDragging ? 'bg-blue-200' : 'bg-gray-100'}`}>
                      <Upload size={15} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <p className={`text-[11px] mb-0.5 ${isDragging ? 'text-blue-600' : 'text-gray-600'}`}>
                      {isDragging ? '释放鼠标上传图片' : '点击或拖拽上传产品图片'}
                    </p>
                    <p className="text-[11px] text-gray-400">支持多选 · JPG / PNG / GIF / WebP</p>
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                  )
                ) : productImages.length === 1 ? (
                  // 单图：突出展示，水平垂直居中（与多图相同的边距和缩放规则）
                  <div
                    className="w-full px-2"
                    onDragOver={readOnly ? undefined : handleDragOver}
                    onDragLeave={readOnly ? undefined : handleDragLeave}
                    onDrop={readOnly ? undefined : handleDrop}
                  >
                    <div className={`flex flex-wrap items-start justify-center gap-2 rounded-lg transition-colors ${
                      isDragging ? 'bg-blue-100/30 p-1' : ''
                    }`}>
                      <div
                        className={`relative w-40 sm:w-48 md:w-56 aspect-square ${readOnly ? 'cursor-zoom-in' : 'cursor-grab'} ${
                          draggedIndex === 0 ? 'opacity-40 ring-2 ring-primary-400 ring-dashed' : ''
                        } ${
                          dragOverIndex === 0 && draggedIndex !== null
                            ? 'ring-2 ring-primary-500 ring-offset-1'
                            : ''
                        }`}
                        draggable={!readOnly}
                        onDragStart={readOnly ? undefined : () => handleImageDragStart(0)}
                        onDragOver={readOnly ? undefined : (e) => handleImageDragOver(e, 0)}
                        onDragEnd={readOnly ? undefined : handleImageDragEnd}
                        onDrop={readOnly ? undefined : (e) => handleImageDrop(e, 0)}
                      >
                        <div
                          className="w-full h-full cursor-zoom-in flex items-center justify-center p-1 bg-white border border-gray-200 rounded-lg"
                          onClick={() => { setPreviewImageSrc(productImages[0]); setIsPreviewOpen(true); }}
                        >
                          <img
                            src={productImages[0]}
                            alt="产品图片 1"
                            className="max-w-full max-h-full object-contain rounded transition-all duration-200"
                          />
                        </div>
                        {!readOnly && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleImageRemove(0); }}
                            className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm z-10"
                          >
                            <X size={12} />
                          </button>
                        )}
                        <span className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1 py-0.5 rounded">
                          1
                        </span>
                      </div>
                      {!readOnly && (
                        <label className={`w-24 sm:w-28 md:w-32 aspect-square flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                          isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                        }`}>
                          <Upload size={16} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                          <span className={`text-xs ${isDragging ? 'text-blue-600' : 'text-gray-500'}`}>添加</span>
                          <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-full px-2"
                    onDragOver={readOnly ? undefined : handleDragOver}
                    onDragLeave={readOnly ? undefined : handleDragLeave}
                    onDrop={readOnly ? undefined : handleDrop}
                  >
                    <div className={`flex flex-wrap items-start justify-center gap-2 rounded-lg transition-colors ${
                      isDragging ? 'bg-blue-100/30 p-1' : ''
                    }`}>
                      {productImages.map((img, index) => (
                        <div
                          key={index}
                          className={`relative aspect-square w-[calc(33.3333%_-_0.3333rem)] sm:w-[calc(25%_-_0.375rem)] md:w-[calc(16.6667%_-_0.4167rem)] ${readOnly ? 'cursor-zoom-in' : 'cursor-grab'} ${
                            draggedIndex === index ? 'opacity-40 ring-2 ring-primary-400 ring-dashed' : ''
                          } ${
                            dragOverIndex === index && draggedIndex !== null && draggedIndex !== index
                              ? 'ring-2 ring-primary-500 ring-offset-1'
                              : ''
                          }`}
                          draggable={!readOnly}
                          onDragStart={readOnly ? undefined : () => handleImageDragStart(index)}
                          onDragOver={readOnly ? undefined : (e) => handleImageDragOver(e, index)}
                          onDragEnd={readOnly ? undefined : handleImageDragEnd}
                          onDrop={readOnly ? undefined : (e) => handleImageDrop(e, index)}
                        >
                          <div
                            className="w-full h-full cursor-zoom-in flex items-center justify-center p-1 bg-white border border-gray-200 rounded-lg"
                            onClick={() => { setPreviewImageSrc(img); setIsPreviewOpen(true); }}
                          >
                            <img
                              src={img}
                              alt={`产品图片 ${index + 1}`}
                              className="max-w-full max-h-full object-contain rounded transition-all duration-200"
                            />
                          </div>
                          {!readOnly && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleImageRemove(index); }}
                              className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm z-10"
                            >
                              <X size={12} />
                            </button>
                          )}
                          <span className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1 py-0.5 rounded">
                            {index + 1}
                          </span>
                        </div>
                      ))}
                      {!readOnly && (
                        <label className={`aspect-square w-[calc(33.3333%_-_0.3333rem)] sm:w-[calc(25%_-_0.375rem)] md:w-[calc(16.6667%_-_0.4167rem)] flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                          isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                        }`}>
                          <Upload size={16} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                          <span className={`text-xs ${isDragging ? 'text-blue-600' : 'text-gray-500'}`}>添加</span>
                          <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* 图片区域底部标记（用于截图裁剪） */}
              <div ref={imagesEndRef} />
            </div>
        </div>

        {/* 在线表格 — 全宽，填满 Layout main 容器（Tab1 专属，CSS 隐藏保持 VTable 实例） */}
      </div>
      <div className={`flex-1 min-h-0 px-4 sm:px-6 pt-1 pb-4 w-full flex flex-col min-w-0 ${activeTab === 'info' ? '' : 'hidden'}`}>
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex-1 min-h-0 flex flex-col ${readOnly ? 'opacity-70' : ''}`}>
          <div ref={sheetContainerRef} className="flex-1 min-h-0 w-full" style={{ minHeight: 400 }} />
          <SelectionSummaryBar summary={selectionSummary} />
        </div>
      </div>

      {/* Tab2 订单做货流程（甘特图）：首次激活时挂载，之后 CSS 显隐 */}
      {productionTabMounted && (
        <div className={`px-4 sm:px-6 pt-2 pb-4 w-full min-w-0 ${activeTab === 'production' ? '' : 'hidden'}`}>
          {id ? (
            <ProductionTasksTab
              quoteId={id}
              readOnly={readOnly}
              orderStatus={status}
              productionTimeStart={orderInfo.productionTimeStart}
              productionTimeEnd={orderInfo.productionTimeEnd}
              sheetFabricPrep={fabricPrepRows}
            />
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-sm text-gray-400">
              保存订单后即可编排做货流程
            </div>
          )}
        </div>
      )}

      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
          <button
            onClick={() => setIsPreviewOpen(false)}
            className="absolute top-4 right-4 w-8 h-8 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <X size={20} />
          </button>
          <div 
            className="max-w-full max-h-[90vh] cursor-zoom-out"
            onClick={() => setIsPreviewOpen(false)}
          >
            <img 
              src={previewImageSrc} 
              alt="预览" 
              className="max-w-full max-h-[90vh] object-contain" 
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 flex flex-col items-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
            <p className="text-gray-600">保存中...</p>
          </div>
        </div>
      )}

      {showSaveSuccess && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg shadow-lg">
          <CheckCircle size={20} />
          <span className="font-medium">保存成功</span>
        </div>
      )}

      {aiImportNotice && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg shadow-lg">
          <CheckCircle size={20} />
          <span className="font-medium">{aiImportNotice}</span>
          <button onClick={() => setAiImportNotice('')} className="ml-1 hover:text-gray-200" title="关闭">
            <X size={18} />
          </button>
        </div>
      )}

      {saveError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg shadow-lg">
          <X size={20} />
          <span className="font-medium">{saveError}</span>
        </div>
      )}

      {exportError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg shadow-lg">
          <X size={20} />
          <span className="font-medium">{exportError}</span>
        </div>
      )}

      {printQuote && (
        <PrintPreviewModal
          quote={printQuote}
          styleLabel={styleOptions.find((s) => s.value === orderInfo.productStyle)?.label || orderInfo.productStyle}
          columnWidths={printSizes.columnWidths}
          rowHeights={printSizes.rowHeights}
          onClose={() => setPrintQuote(null)}
        />
      )}
    </div>
  )
}
