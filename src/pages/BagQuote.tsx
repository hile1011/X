import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { RotateCcw, TrendingUp, DollarSign, ShoppingBag, Image as ImageIcon, Upload, X, ClipboardList, Table2, Save, ArrowLeft, CheckCircle, ChevronRight, ChevronLeft, Square, Circle, CircleDot, Play, Flag, Download, Loader2, Printer } from 'lucide-react'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { api, downloadBlob } from '../api'
import CustomerSelect from '../components/CustomerSelect'
import SelectionSummaryBar from '../components/SelectionSummaryBar'
import { PrintPreviewModal } from '../components/PrintPreviewModal'
import type { Quote } from './Quotes'
import { findTablePositions } from '../services/tableLocator'
import { fetchStyleOptions, type StyleOption } from '../services/productStyles'
import { OrderStatus } from '../constants/OrderStatus'
import { ProductionSteps } from '../constants/ProductionSteps'
import { StyleConstants } from '../constants/StyleConstants'
import { TableConstants } from '../constants/TableConstants'
import { ExcelUtils } from '../utils/ExcelUtils'
import { DateUtils } from '../utils/DateUtils'
import { SheetTemplateManager } from '../templates/SheetTemplateManager'
import { computeSelectionSummary, type SelectionSummary, type CellRangeLike } from '../utils/SelectionSummary'

interface OrderInfo {
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  customerName: string
  shippingAddress: string
  productStyle: string
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

// 订单状态选项和生产步骤统一使用枚举类，消除重复定义
const STATUS_OPTIONS = OrderStatus.getAll()
const PRODUCTION_STEPS = ProductionSteps.getAll()

const DEFAULT_ORDER_INFO: OrderInfo = {
  unitPrice: '',
  productionTimeStart: DateUtils.today(),
  productionTimeEnd: '',
  customerName: '',
  shippingAddress: '',
  productStyle: '1',
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

const SHEET_COLUMNS = TableConstants.COL_WIDTHS.map((width, field) => ({
  field,
  width,
  style: getCellStyle,
  // 数值类型单元格保留2位小数（可通过右键菜单覆盖；不影响公式计算，公式引擎直接读取 data 原始值）
  fieldFormat: (record: any, col?: number, row?: number) => {
    const value = record?.[field]
    if (typeof value === 'number' && !isNaN(value)) {
      const fmt = (col != null && row != null) ? cellFormatOverrides.get(`${col},${row}`) : undefined
      if (fmt === -1) return value              // 常规
      if (fmt === 0) return Math.round(value)   // 整数
      if (fmt === 4) return value.toFixed(4)    // 4位小数
      return value.toFixed(2)                    // 默认2位小数
    }
    return value
  },
}))

export default function BagQuote() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEditMode = !!id
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
  const [saveError, setSaveError] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string>('')
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [quoteNumber, setQuoteNumber] = useState<string>('')
  const [createdAt, setCreatedAt] = useState<string>('')
  const [printQuote, setPrintQuote] = useState<Quote | null>(null)
  const [status, setStatus] = useState<number>(1)
  const [statusTimeNodes, setStatusTimeNodes] = useState<{
    quoteTime: string
    sampleTime: string
    productionStartTime: string
    shippingTime: string
    paymentTime: string
    endTime: string
  }>({
    quoteTime: '',
    sampleTime: '',
    productionStartTime: '',
    shippingTime: '',
    paymentTime: '',
    endTime: '',
  })
  const [productionStepStatus, setProductionStepStatus] = useState<Record<number, 'pending' | 'in_progress' | 'completed'>>({})

  const sheetContainerRef = useRef<HTMLDivElement>(null)
  const sheetInstanceRef = useRef<VTableSheet | null>(null)
  // 新增保存后切换到编辑模式时，跳过 loadQuote（数据刚保存，无需重新加载）
  const skipNextLoadRef = useRef(false)
  // 从数据库加载的在线表格二维数据（编辑已有订单时使用，覆盖模板默认值）。
  // 新增订单时为 null，使用模板数据初始化。
  const loadedTableDataRef = useRef<(string | number | null)[][] | null>(null)
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
  const [sellPrices, setSellPrices] = useState<{ noTax: number | null; withTax: number | null }>({ noTax: null, withTax: null })
  // 款式选项：从产品管理模块动态获取（code 1-6 对应在线表格模板）
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  // 选中单元格汇总结果：null 表示当前无选区
  const [selectionSummary, setSelectionSummary] = useState<SelectionSummary | null>(null)

  useEffect(() => {
    fetchStyleOptions().then(setStyleOptions)
  }, [])

  // 进入页面时停留在最上方：SPA 的 pushState 导航不会重置窗口滚动位置，
  // 会沿用前一页（如订单列表）的滚动位置，导致进入编辑页时下滑到在线表格。
  // 用 useLayoutEffect 在浏览器绘制前同步滚回顶部，避免视觉闪烁。
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    if (isEditMode) {
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
  }, [isEditMode, customerId])

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
        setStatus(data.status || 1)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          endTime: data.endTime || '',
        })
        setProductionStepStatus(data.productionStepStatus || {})
        setProductImages(data.images || [])
        // 加载已保存的在线表格数据（覆盖模板默认值，后续以数据库为准）
        loadedTableDataRef.current = (data.tableData && data.tableData.length > 0) ? data.tableData : null
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
    }

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
      status: status as 1 | 2 | 3 | 4 | 5 | 6,
      quoteTime: statusTimeNodes.quoteTime,
      sampleTime: statusTimeNodes.sampleTime,
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
  }

  const handleSave = async (): Promise<boolean> => {
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

      const quoteData = {
        ...orderInfo,
        costPrice: costPrice || 0,
        priceWithTax: priceWithTax || 0,
        sellPriceNoTax: sellPrices.noTax || 0,
        sellPriceWithTax: sellPrices.withTax || 0,
        status,
        images: productImages,
        tableData,
        allFormulas,
        productionStepStatus,
      }
      if (isEditMode) {
        await api.quotes.update(id!, quoteData)
      } else {
        const created = await api.quotes.create(quoteData)
        // 新增保存后切换到编辑模式（替换 URL，不返回列表页），避免重复保存创建多个订单
        if (created?.id) {
          skipNextLoadRef.current = true
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
      // 公式来源优先级：当前表格实时收集的公式 > 数据库 allFormulas > 款式模板
      // 实时收集确保导出与页面显示完全一致（含用户未保存的修改）
      const template = SheetTemplateManager.getTemplate(orderInfo.productStyle)
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
      const blob = await api.export.orderWithTable(id, { data: tableData, formulas })
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
    if (isEditMode && tableDataVersion === 0) return

    const template = SheetTemplateManager.getTemplate(orderInfo.productStyle)
    // 编辑已有订单时优先使用数据库保存的表格数据；新增订单时用模板数据
    const initialData = loadedTableDataRef.current && loadedTableDataRef.current.length > 0
      ? loadedTableDataRef.current
      : template.data
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

    const sheet = new VTableSheet(sheetContainerRef.current, {
      undoRedo: { show: true },
      VTablePluginModules: [
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
        },
      ],
    })
    sheetInstanceRef.current = sheet
    // 将公式引擎引用赋值给模块级变量，供 getCellStyle 实时检测公式单元格
    activeFormulaManager = (sheet as any).formulaManager

    // 表格对订单信息的联动（动态定位行和列）：
    // 成本价       = 汇总行 × 参考卖价列（以"汇总"文字定位行，以"参考卖价"列标题定位列）
    // 单个卖价(不含税) = 参考卖价行 × 参考卖价列（以"参考卖价"文字定位行）
    // 单个卖价(含税)   = 参考卖价行 × 含税价列
    // 产品规格 = 成品行 宽(CM) "*" 高(CM) "*" 底(CM)
    // 数量     = 成品行 数量(个)
    // 直接通过 formulaManager 读取公式计算结果（构造时已载入引擎，编辑后由 WorkSheet 级联重算）
    const activeWs = sheet.getActiveSheet()
    const activeTable = activeWs?.tableInstance as any
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

        // 成本价 = 汇总行 × 参考卖价列（公式单元格，读取引擎计算结果）
        const rCost = pos.summaryRow >= 0
          ? fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.summaryRow, col: pos.refSellCol })
          : null
        const costVal = rCost && typeof rCost.value === 'number' && !isNaN(rCost.value) ? rCost.value : null
        setCostPrice(costVal)
        // 含税价 = 成本价 × 1.1（自动计算）
        setPriceWithTax(costVal !== null ? Number((costVal * 1.1).toFixed(2)) : null)

        // 卖价（公式单元格，读取引擎计算结果）
        const rNoTax = pos.refSellRow >= 0
          ? fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.refSellRow, col: pos.refSellCol })
          : null
        const rWithTax = pos.refSellRow >= 0
          ? fm.getCellValue({ sheet: TableConstants.SHEET_KEY, row: pos.refSellRow, col: pos.withTaxCol })
          : null
        setSellPrices({
          noTax: rNoTax && typeof rNoTax.value === 'number' && !isNaN(rNoTax.value) ? rNoTax.value : null,
          withTax: rWithTax && typeof rWithTax.value === 'number' && !isNaN(rWithTax.value) ? rWithTax.value : null,
        })

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
        const summary = computeSelectionSummary(ranges, (col, row) =>
          activeTable?.getCellOriginValue?.(col, row),
        )
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
          fieldFormat: (record: any, col?: number, row?: number) => {
            const value = record?.[index]
            if (typeof value === 'number' && !isNaN(value)) {
              const fmt = (col != null && row != null) ? cellFormatOverrides.get(`${col},${row}`) : undefined
              if (fmt === -1) return value              // 常规
              if (fmt === 0) return Math.round(value)   // 整数
              if (fmt === 4) return value.toFixed(4)    // 4位小数
              return value.toFixed(2)                    // 默认2位小数
            }
            return value
          },
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
  }, [orderInfo.productStyle, tableDataVersion])

  const processFiles = (files: File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    imageFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        setProductImages((prev) => [...prev, reader.result as string])
      }
      reader.readAsDataURL(file)
    })
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
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    processFiles(Array.from(files))
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
    // 切换款式时：若有未保存编辑则提示确认，确认=切换款式，取消=不切换
    if (field === 'productStyle' && value !== orderInfo.productStyle) {
      if (isTableDirty) {
        const ok = window.confirm('当前在线表格有未保存的修改。\n点击"确认"切换款式（未保存的修改将丢失），点击"取消"保持当前款式。')
        if (!ok) return // 取消：不切换款式
      }
      // 清除所有表格相关状态，加载新款式模板（allFormulasRef 清空为 {}，表格初始化时回退到模板公式）
      loadedTableDataRef.current = null
      allFormulasRef.current = {}
      setIsTableDirty(false)
    }
    setOrderInfo((prev) => ({ ...prev, [field]: value }))
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
    navigator.clipboard.writeText(text).then(() => {
      setShowCopySuccess(true)
      setTimeout(() => setShowCopySuccess(false), 2000)
    }).catch(() => {
      setSaveError('复制失败，请手动选择文本复制')
      setTimeout(() => setSaveError(''), 3000)
    })
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
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
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
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
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
    if (!isEditMode || (status !== 1 && status !== 2)) return
    setLoading(true)
    try {
      const data = await api.quotes.endQuote(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
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

  const handleProductionStepChange = (stepId: number, newStatus: 'pending' | 'in_progress' | 'completed') => {
    setProductionStepStatus(prev => ({ ...prev, [stepId]: newStatus }))
  }

  const canGoNext = status >= 1 && status <= 5
  const canGoPrev = status >= 2 && status <= 6
  const canEnd = status >= 1 && status <= 5

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
                <h1 className="text-lg font-bold text-gray-800 leading-tight">订单管理</h1>
                <p className="text-[11px] text-gray-500 leading-tight">订单信息管理</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:gap-2 justify-end">
              <button onClick={() => navigate('/quotes')} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[40px] sm:min-h-0">
                <ArrowLeft size={16} />
                返回列表
              </button>
              <button onClick={handleCopyQuote} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[40px] sm:min-h-0" title="复制订单信息为文本格式，方便报价">
                <ClipboardList size={16} />
                {showCopySuccess ? '已复制' : '复制报价'}
              </button>
              <button onClick={handleSave} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 min-h-[40px] sm:min-h-0">
                <Save size={16} />
                {showSaveSuccess ? '保存成功' : '保存'}
              </button>
              <button onClick={handleExportWithTable} disabled={exporting || !isEditMode} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-primary-700 border border-primary-200 bg-white rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px] sm:min-h-0" title={!isEditMode ? '请先保存订单' : '导出订单及在线表格到 Excel（保留公式）'}>
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting ? '导出中...' : '导出 Excel'}
              </button>
              <button onClick={handleOpenPrint} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-primary-700 border border-primary-200 bg-white rounded-lg hover:bg-primary-50 transition-colors min-h-[40px] sm:min-h-0" title="打印订单">
                <Printer size={16} />
                打印
              </button>
              <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors min-h-[40px] sm:min-h-0">
                <RotateCcw size={16} />
                重置
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域（shrink-0：订单信息区按内容高度，不压缩）
          min-w-0 + overflow-hidden：允许 flex 子元素收缩，使状态流转的 overflow-x-auto 生效，
          避免 480px 最小宽度撑破 375px 移动端视口 */}
      <div className="shrink-0 px-4 sm:px-6 pt-4 pb-0 w-full min-w-0 overflow-hidden">
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

          <div className="overflow-x-auto">
            <div className="flex items-center px-1 min-w-[480px] sm:min-w-0">
            {STATUS_OPTIONS.map((option, index) => {
              const isCurrent = option.value === status
              const isPast = option.value < status
              const nodeTime = statusTimeNodes[
                option.value === 1 ? 'quoteTime' :
                option.value === 2 ? 'sampleTime' :
                option.value === 3 ? 'productionStartTime' :
                option.value === 4 ? 'shippingTime' :
                option.value === 5 ? 'paymentTime' : 'endTime'
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

        {/* 做货流程（状态为做货中时显示） */}
        {status === 3 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Play className="text-gray-400" size={15} />
              <h3 className="text-xs font-semibold text-gray-700">订单做货流程</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PRODUCTION_STEPS.map((step, index) => {
                const stepStatus = productionStepStatus[step.id] || 'pending'
                return (
                  <div key={step.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      stepStatus === 'completed' ? 'bg-green-500 text-white' :
                      stepStatus === 'in_progress' ? 'bg-primary-500 text-white' : 'bg-gray-300 text-gray-500'
                    }`}>
                      {stepStatus === 'completed' ? (
                        <CheckCircle size={13} />
                      ) : stepStatus === 'in_progress' ? (
                        <Play size={11} />
                      ) : (
                        <span className="text-[11px] font-medium">{index + 1}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${
                        stepStatus === 'completed' ? 'text-green-700' :
                        stepStatus === 'in_progress' ? 'text-primary-700' : 'text-gray-700'
                      }`}>{step.name}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'pending')}
                        className={`px-1.5 py-0.5 text-[11px] rounded ${
                          stepStatus === 'pending' ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        待处理
                      </button>
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'in_progress')}
                        className={`px-1.5 py-0.5 text-[11px] rounded ${
                          stepStatus === 'in_progress' ? 'bg-primary-200 text-primary-700' : 'bg-white text-gray-500 hover:bg-primary-50'
                        }`}
                      >
                        进行中
                      </button>
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'completed')}
                        className={`px-1.5 py-0.5 text-[11px] rounded ${
                          stepStatus === 'completed' ? 'bg-green-200 text-green-700' : 'bg-white text-gray-500 hover:bg-green-50'
                        }`}
                      >
                        已完成
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 主体：订单信息 + 在线表格 （合并标题节省一行空间） */}
        <div className="mb-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ClipboardList size={15} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-700">订单信息</h3>
            <span className="text-gray-300">·</span>
            <Table2 size={14} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-700">在线表格</h3>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="p-3 pb-1 space-y-2">
              {/* 成本价行：成本价(不含税) + 含税价 + 单个利润(不含税/含税) + 利润总额(不含税/含税) */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-gray-50 to-transparent rounded-lg flex-wrap">
                {/* 成本价输入组 */}
                <div className="flex items-center gap-1.5">
                  <DollarSign className="text-gray-400" size={15} />
                  <span className="text-xs text-gray-500">成本价</span>
                  <span className="text-[11px] text-gray-400">不含税</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={costPrice !== null ? costPrice.toFixed(2) : ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value)
                      setCostPrice(val)
                      setPriceWithTax(val !== null ? Number((val * 1.1).toFixed(2)) : null)
                    }}
                    placeholder="0.00"
                    className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-gray-600 bg-gray-50/40 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">含税</span>
                  <span className="text-[11px] text-gray-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={priceWithTax !== null ? priceWithTax.toFixed(2) : ''}
                    onChange={(e) => setPriceWithTax(e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="0.00"
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
              <div className="flex items-center gap-4 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-transparent rounded-lg flex-wrap">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="text-gray-400" size={15} />
                  <span className="text-xs text-gray-500">单个卖价</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-red-400">不含税</span>
                  <span className="text-xs text-red-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sellPrices.noTax !== null ? sellPrices.noTax.toFixed(2) : ''}
                    onChange={(e) => setSellPrices(prev => ({ ...prev, noTax: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="0.00"
                    className="w-24 px-1.5 py-1.5 sm:py-0.5 text-sm font-bold text-red-600 bg-red-50/40 border border-red-200 rounded focus:outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <TrendingUp className="text-blue-400" size={14} />
                  <span className="text-[11px] text-blue-400">含税</span>
                  <span className="text-xs text-blue-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sellPrices.withTax !== null ? sellPrices.withTax.toFixed(2) : ''}
                    onChange={(e) => setSellPrices(prev => ({ ...prev, withTax: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="0.00"
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
              </div>

              {/* 表单字段 - 密集网格。LG:6列 MD:4列 SM:2列
              同行规则：客户+打样费+箱规 / 大货日期+天数 / 面料+工艺+手提 / 收货地址+备注 */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-1.5">
                {/* 行1：客户名称 + 订单状态(只读) + 打样费/天 + 箱规 */}
                <div className="col-span-2 md:col-span-2 lg:col-span-2">
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

                {/* 行2：大货日期/天数 + 款式 + 数量 + 产品规格 */}
                <div className="col-span-2 md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-gray-400 mb-0.5">大货日期/天数</label>
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
                      className="w-16 px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors shrink-0" />
                  </div>
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">款式</label>
                  <select
                    value={orderInfo.productStyle}
                    onChange={(e) => updateOrderField('productStyle', e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors"
                  >
                    {styleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">数量(个)</label>
                  <input type="text" value={orderInfo.quantity} onChange={(e) => updateOrderField('quantity', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">产品规格(CM)</label>
                  <input type="text" value={orderInfo.productSpec} onChange={(e) => updateOrderField('productSpec', e.target.value)}
                    placeholder="产品规格"
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
                  <label className="cursor-pointer flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
                    <Upload size={12} />
                    上传图片
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>
                {productImages.length === 0 ? (
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
                ) : (
                  <div 
                    className="w-full px-2"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 rounded-lg transition-colors ${
                      isDragging ? 'bg-blue-100/30 p-1' : ''
                    }`}>
                      {productImages.map((img, index) => (
                        <div
                          key={index}
                          className={`relative aspect-square cursor-grab ${
                            draggedIndex === index ? 'opacity-40 ring-2 ring-primary-400 ring-dashed' : ''
                          } ${
                            dragOverIndex === index && draggedIndex !== null && draggedIndex !== index
                              ? 'ring-2 ring-primary-500 ring-offset-1'
                              : ''
                          }`}
                          draggable
                          onDragStart={() => handleImageDragStart(index)}
                          onDragOver={(e) => handleImageDragOver(e, index)}
                          onDragEnd={handleImageDragEnd}
                          onDrop={(e) => handleImageDrop(e, index)}
                        >
                          <div
                            className="w-full h-full cursor-zoom-in"
                            onClick={() => { setPreviewImageSrc(img); setIsPreviewOpen(true); }}
                          >
                            <img
                              src={img}
                              alt={`产品图片 ${index + 1}`}
                              className="w-full h-full object-cover rounded-lg border border-gray-200"
                            />
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleImageRemove(index); }}
                            className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm z-10"
                          >
                            <X size={12} />
                          </button>
                          <span className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1 py-0.5 rounded">
                            {index + 1}
                          </span>
                        </div>
                      ))}
                      <label className={`aspect-square flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                        isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                      }`}>
                        <Upload size={16} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                        <span className={`text-xs ${isDragging ? 'text-blue-600' : 'text-gray-500'}`}>添加</span>
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
        </div>

        {/* 在线表格 — 全宽，填满 Layout main 容器 */}
      </div>
      <div className="flex-1 min-h-0 px-4 sm:px-6 pt-1 pb-4 w-full flex flex-col min-w-0">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex-1 min-h-0 flex flex-col">
          <div ref={sheetContainerRef} className="flex-1 min-h-0 w-full" style={{ minHeight: 400 }} />
          <SelectionSummaryBar summary={selectionSummary} />
        </div>
      </div>

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
          onClose={() => setPrintQuote(null)}
        />
      )}
    </div>
  )
}
