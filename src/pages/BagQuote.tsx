import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { RotateCcw, TrendingUp, DollarSign, ShoppingBag, Image as ImageIcon, Upload, X, ClipboardList, Table2, Save, ArrowLeft, CheckCircle, ChevronRight, ChevronLeft, Square, Circle, CircleDot, Play, Flag } from 'lucide-react'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { api } from '../api'

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

const today = new Date().toISOString().split('T')[0]

const DEFAULT_ORDER_INFO: OrderInfo = {
  unitPrice: '',
  productionTimeStart: today,
  productionTimeEnd: '',
  customerName: '',
  shippingAddress: '',
  productStyle: '无底无侧普通袋',
  productSpec: '',
  fabricMaterial: '10安涤棉新本色',
  process: '单面数码uv印刷',
  handleMaterial: '帆布手提',
  handleSpec: '',
  quantity: '',
  boxSpec: '',
  remark: '',
  sampleFee: '',
  sampleDays: '',
  massDays: '',
}

const STATUS_OPTIONS = [
  { value: 1, label: '报价中' },
  { value: 2, label: '打样中' },
  { value: 3, label: '做货中' },
  { value: 4, label: '已发货未收款' },
  { value: 5, label: '已发货已收款' },
  { value: 6, label: '结束' },
]

const PRODUCT_STYLE_OPTIONS = [
  { value: '无底无侧普通袋', label: '无底无侧普通袋' },
  { value: '有底无侧普通袋', label: '有底无侧普通袋' },
  { value: '有底有侧普通袋', label: '有底有侧普通袋' },
  { value: '手提连底普通拼接袋', label: '手提连底普通拼接袋' },
  { value: '手提连底高级拼接袋', label: '手提连底高级拼接袋' },
  { value: '手提无连底普拼接袋', label: '手提无连底普拼接袋' },
]

const PRODUCTION_STEPS = [
  { id: 1, name: '面料采购', description: '采购所需面料' },
  { id: 2, name: '裁剪', description: '根据规格裁剪面料' },
  { id: 3, name: '印刷', description: '进行图案印刷' },
  { id: 4, name: '缝纫', description: '缝制袋子' },
  { id: 5, name: '质检', description: '质量检查' },
  { id: 6, name: '包装', description: '包装入库' },
]

// 在线表格初始数据（来源：帆布袋价格试算表-规格试算.xlsx sheet1）
const SHEET_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
  ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 2.97, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 3240, null, null, null, null, null, null],
]

// 在线表格样式（来源：帆布袋价格试算表-规格试算.xlsx sheet1）
const SC = {
  yellow: '#FFFF00', blue: '#91AADF', orange: '#F4B382',
  darkOrange: '#EE822F', lightOrange: '#F8CBAD', red: '#FF0000', black: '#000000',
}
const BORDER = { borderColor: SC.black, borderLineWidth: 1 }

// 单元格样式覆盖（右键菜单设置）：key = "col,row"，value = 样式属性
const cellStyleOverrides = new Map<string, Record<string, unknown>>()
// 单元格数字格式覆盖：key = "col,row"，value = 小数位数（-1=常规, 0=整数, 2=2位, 4=4位）
const cellFormatOverrides = new Map<string, number>()

// 辅助：构建单元格样式（字体默认加大4号）
const cs = (
  bg?: string, color = SC.black, size = 10, bold = false, border = true,
): Record<string, unknown> => ({
  bgColor: bg, color, fontSize: size + 4,
  fontWeight: bold ? 'bold' : 'normal',
  ...(border ? BORDER : {}),
})

// 按行+列返回 Excel 对应单元格样式（VTable 行列均为 0-based）
const getCellStyle = (args: { row: number; col: number }): Record<string, unknown> => {
  const { row, col } = args
  let style: Record<string, unknown>
  
  // 列类型判定（用于新增列的样式适配）
  const isParamCol = col >= 1 && col <= 6    // 参数输入列（数量、宽、高、底、出血）
  const isCalcCol = col >= 7 && col <= 10   // 中间计算列（切片、门幅、克重）
  
  // 行0: 表头1（黄色填充）— 新增列继承表头样式
  if (row === 0) style = cs(SC.yellow, SC.black, 11, true)
  // 行4: 表头2（深橙色填充）— 新增列继承表头样式
  else if (row === 4) style = cs(SC.darkOrange, SC.black, 11, true)
  // 行1: 成品
  else if (row === 1) {
    if (col === 0) style = cs(undefined, SC.black, 10, false)
    else if (col === 1) style = cs(SC.blue)
    else if (col >= 2 && col <= 5) style = cs(SC.orange)
    else if (col >= 6 && col <= 7) style = cs(SC.orange, SC.red)
    else if (col >= 8 && col <= 9) style = cs(SC.orange)
    else style = cs(SC.blue, SC.red)
  }
  // 行2: 正反面（规格试算）
  else if (row === 2) {
    if (col === 0) style = cs(undefined, SC.black, 10, false)
    else if (col === 1) style = cs(SC.orange)
    else if (col >= 2 && col <= 4) style = cs(SC.blue, SC.black, 12, true)
    else if (col >= 5 && col <= 6) style = cs(SC.orange)
    else if (col >= 7 && col <= 8) style = cs(SC.blue, SC.black, 12, true)
    else if (col >= 9 && col <= 10) style = cs(SC.orange)
    else style = cs(SC.blue, SC.black, 12, true)
  }
  // 行3: 手提（规格试算）
  else if (row === 3) {
    if (col === 0) style = cs(undefined, SC.black, 10, false)
    else if (col >= 1 && col <= 3) style = cs(SC.orange)
    else if (col === 4) style = cs(SC.blue, SC.black, 12, true)
    else if (col >= 5 && col <= 6) style = cs(SC.orange)
    else if (col >= 7 && col <= 8) style = cs(SC.blue, SC.black, 12, true)
    else if (col >= 9 && col <= 10) style = cs(SC.orange)
    else style = cs(SC.blue, SC.black, 12, true)
  }
  // 行5-6: 成本核算
  else if (row === 5 || row === 6) {
    if (col === 0) style = cs(undefined, SC.black, 10, false)
    else if (col === 1) style = cs(SC.orange)
    else if (col === 2) style = cs(SC.blue)
    else if (col === 3) style = cs(SC.orange)
    else if (col === 4) style = cs(SC.blue)
    else if (col >= 5 && col <= 6) style = cs(SC.orange)
    else if (col === 7) style = cs(SC.orange)
    else if (col === 8) style = cs(SC.orange)
    else if (col >= 9 && col <= 11) style = cs(SC.blue)
    else style = cs(SC.lightOrange)
  }
  // 行7-9: 汇总 / 参考卖价 / 利润
  else if (row >= 7 && row <= 9) {
    if (col === 0) style = cs(undefined, SC.red, 10, false)
    else if (col === 1) style = cs(SC.orange)
    else if (col === 2) style = cs(SC.blue)
    else if (col === 3) style = cs(SC.orange, SC.black, 11, false, false)
    else if (col === 4) style = cs(SC.blue)
    else if (col >= 5 && col <= 6) style = cs(SC.orange)
    else if (col === 7) style = cs(SC.orange, row === 8 ? SC.black : SC.red)
    else if (col >= 8 && col <= 9) style = cs(SC.blue, SC.red)
    else if (col >= 10 && col <= 12) style = cs(SC.lightOrange, SC.red)
    else style = cs(SC.lightOrange)
  }
  // ===== 新增行的自适应样式 =====
  // 新增行在规格试算区域（行1-3之后，行4表头之前）
  else if (row > 3 && row < 4) {
    if (col === 0) style = cs(undefined, SC.black, 10, false)
    else if (isParamCol) style = cs(SC.orange)
    else if (isCalcCol) style = cs(SC.blue, SC.black, 12, true)
    else style = cs(SC.blue, SC.black, 12, true)
  }
  // 新增行在成本核算区域（行4表头之后，行5-6之后）
  else if (row > 4 && row < 7) {
    if (col === 0) style = cs(undefined, SC.black, 10, false)
    else if (col >= 1 && col <= 8) style = cs(SC.orange)
    else if (col >= 9 && col <= 11) style = cs(SC.blue)
    else style = cs(SC.lightOrange)
  }
  // 新增行在汇总区域之后（行9之后）
  else if (row > 9) {
    if (col === 0) style = cs(undefined, SC.red, 10, false)
    else if (isParamCol) style = cs(SC.orange)
    else if (isCalcCol) style = cs(SC.blue, SC.red)
    else style = cs(SC.lightOrange, SC.red)
  }
  // 默认样式
  else style = cs()

  // 合并用户通过右键菜单设置的样式覆盖
  const override = cellStyleOverrides.get(`${col},${row}`)
  return override ? { ...style, ...override } : style
}

const COL_WIDTHS = [100, 90, 80, 80, 80, 90, 90, 90, 90, 90, 80, 120, 110, 130, 100, 120]

const SHEET_COLUMNS = COL_WIDTHS.map((width, field) => ({
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

// 在线表格公式（来源：帆布袋价格试算表-规格试算.xlsx sheet1）
// 内容从第0行开始；公式采用 A1 记法，行号(1-based)映射到 VTable 0-based 行需 -1
const SHEET_FORMULAS: Record<string, string> = {
  // 行2 正反面（规格试算）
  B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
  H3: '=F3+C3',
  I3: '=(D3*2+E3+G3)',
  L3: '=MOD(J3,MIN(H3,I3))',
  M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
  N3: '=J3/(MIN(H3,I3))',
  O3: '=M3*K3*1.5/1000',
  P3: '=M3*4/(I4/100)',
  // 行3 手提（规格试算）
  B4: '=B2', I4: '=D4',
  L4: '=MOD(J4,MIN(H4,I4))',
  M4: '=I4/100*2*B4/INT(J4/H4)',
  N4: '=J4/(MIN(H4,I4))',
  O4: '=M4*K4*1.5/1000',
  // 行5 正反面（成本核算）
  A6: '=A3',
  C6: '=H3*I3*1.1/10000',
  E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
  H6: '=O3*0.8',
  J6: '=(B6+C6+F6+E6+H6/B3)*I6+G6',
  // 行6 手提（成本核算）
  A7: '=A4',
  E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
  H7: '=O4*0.8',
  J7: '=(B7+C7+E7+F7+H7/B4)*I7+G7',
  // 行7 汇总
  J8: '=SUM(J6:J7)',
  // 行8 参考卖价
  J9: '=J8+I9',
  K9: '=J9*1.1',
  // 行9 利润
  J10: '=(J9-J8)*B2',
}

function TextField({ label, value, onChange, placeholder, multiline, fullWidth }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  fullWidth?: boolean
}) {
  return (
    <div className={fullWidth || multiline ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}
    </div>
  )
}

export default function BagQuote() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isEditMode = !!id
  const [orderInfo, setOrderInfo] = useState<OrderInfo>(DEFAULT_ORDER_INFO)
  const [productImages, setProductImages] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showSaveSuccess, setShowSaveSuccess] = useState(false)
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
  // 表格对订单信息的联动：单个卖价(不含税)/单个卖价(含税)
  const [sellPrices, setSellPrices] = useState<{ noTax: number | null; withTax: number | null }>({ noTax: null, withTax: null })

  useEffect(() => {
    if (isEditMode) {
      loadQuote()
    }
  }, [isEditMode])

  const loadQuote = async () => {
    setLoading(true)
    try {
      const data = await api.quotes.getById(id!)
      if (data) {
        setOrderInfo({
          unitPrice: data.unitPrice || '',
          productionTimeStart: data.productionTimeStart || today,
          productionTimeEnd: data.productionTimeEnd || '',
          customerName: data.customerName || '',
          shippingAddress: data.shippingAddress || '',
          productStyle: data.productStyle || '无底无侧普通袋',
          productSpec: data.productSpec || '',
          fabricMaterial: data.fabricMaterial || '10安涤棉新本色',
          process: data.process || '单面数码uv印刷',
          handleMaterial: data.handleMaterial || '帆布手提',
          handleSpec: data.handleSpec || '',
          quantity: data.quantity || '',
          boxSpec: data.boxSpec || '',
          remark: data.remark || '',
          sampleFee: data.sampleFee || '',
          sampleDays: data.sampleDays || '',
          massDays: data.massDays || '',
        })
        setSellPrices({
          noTax: data.sellPriceNoTax || null,
          withTax: data.sellPriceWithTax || null,
        })
        setStatus(data.status || 1)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          endTime: data.endTime || '',
        })
        setProductImages(data.images || [])
      }
    } catch (error) {
      console.error('加载报价失败:', error)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const quoteData = {
        ...orderInfo,
        sellPriceNoTax: sellPrices.noTax || 0,
        sellPriceWithTax: sellPrices.withTax || 0,
        status,
        images: productImages,
      }
      if (isEditMode) {
        await api.quotes.update(id!, quoteData)
      } else {
        await api.quotes.create(quoteData)
      }
      setShowSaveSuccess(true)
      setTimeout(() => setShowSaveSuccess(false), 3000)
      if (!isEditMode) {
        navigate('/quotes')
      }
    } catch (error) {
      console.error('保存报价失败:', error)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!sheetContainerRef.current) return

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
          data: SHEET_DATA,
          formulas: SHEET_FORMULAS,
          showHeader: false,
        },
      ],
    })
    sheetInstanceRef.current = sheet

    // 表格对订单信息的联动：
    // 单个卖价(不含税) = 参考卖价行(row 8) 参考卖价列(col 9)
    // 单个卖价(含税)   = 参考卖价行(row 8) 含税价列(col 10)
    // 产品规格 = 成品行(row 1) 宽(CM, col 2) "*" 高(CM, col 3) "*" 底(CM, col 4)
    // 数量     = 成品行(row 1) 数量(个, col 1)
    // 直接通过 formulaManager 读取公式计算结果（构造时已载入引擎，编辑后由 WorkSheet 级联重算）
    const SHEET_KEY = 'sheet1'
    const FINISHED_ROW = 1          // 成品行
    const REF_SELL_ROW = 8          // 参考卖价行
    const syncFromTable = () => {
      const fm = (sheet as any).formulaManager
      if (!fm) return
      try {
        // 卖价（公式单元格，读取引擎计算结果）
        const rNoTax = fm.getCellValue({ sheet: SHEET_KEY, row: REF_SELL_ROW, col: 9 })
        const rWithTax = fm.getCellValue({ sheet: SHEET_KEY, row: REF_SELL_ROW, col: 10 })
        setSellPrices({
          noTax: rNoTax && typeof rNoTax.value === 'number' && !isNaN(rNoTax.value) ? rNoTax.value : null,
          withTax: rWithTax && typeof rWithTax.value === 'number' && !isNaN(rWithTax.value) ? rWithTax.value : null,
        })
        // 产品规格 / 数量（成品行数据单元格）
        const fmtVal = (v: any): string => (v == null || v === '') ? '' : String(v)
        const width = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 2 })
        const height = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 3 })
        const base = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 4 })
        const qty = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 1 })
        const newSpec = [fmtVal(width?.value), fmtVal(height?.value), fmtVal(base?.value)].join('*')
        const newQty = fmtVal(qty?.value)
        setOrderInfo((prev) => {
          if (prev.productSpec === newSpec && prev.quantity === newQty) return prev
          return { ...prev, productSpec: newSpec, quantity: newQty }
        })
      } catch {
        // 公式引擎未就绪时忽略，后续 change_cell_value 事件会重新读取
      } 
    }
    // 初始读取（公式在构造时已载入引擎并完成计算）
    syncFromTable()
    // 监听单元格变更：WorkSheet 的 change_cell_value 监听器先于本监听器注册，
    // 会同步完成依赖公式的级联重算，因此此处可直接读取最新结果
    const activeWs = sheet.getActiveSheet()
    const activeTable = activeWs?.tableInstance as any
    const onCellChange = () => syncFromTable()
    if (activeTable?.on) {
      activeTable.on('change_cell_value', onCellChange)
    }

    // 监听新增列事件，确保新增列也有样式和字段格式化函数
    const onAddColumn = () => {
      try {
        const currentCols = activeTable?.columns || []
        const newCols = currentCols.map((_col: any, index: number) => ({
          field: index,
          key: index,
          width: COL_WIDTHS[index] || 100, // 使用默认宽度
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
        activeTable.off('add_column', onAddColumn)
      }
      resizeObserver.disconnect()
      menuObserver.disconnect()
      sheet.release()
      sheetInstanceRef.current = null
      cellStyleOverrides.clear()
      cellFormatOverrides.clear()
    }
  }, [])

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

  const updateOrderField = (field: keyof OrderInfo, value: string) => {
    setOrderInfo((prev) => ({ ...prev, [field]: value }))
  }

  const handleReset = () => {
    setOrderInfo(DEFAULT_ORDER_INFO)
    setProductImages([])
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
    if (!isEditMode || status === 1 || status === 6) return
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
  const canGoPrev = status >= 2 && status <= 5
  const canEnd = status === 1 || status === 2

  return (
    <div className="min-h-screen">
      {/* 顶部悬浮栏 */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm shadow-sm border-b border-gray-100">
        <div className="p-4 max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <ShoppingBag className="text-blue-600" size={22} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">订单管理</h1>
                <p className="text-xs text-gray-500">订单信息管理</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => navigate('/quotes')} className="flex items-center gap-2 px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                <ArrowLeft size={18} />
                返回列表
              </button>
              <button onClick={handleSave} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
                <Save size={18} />
                {showSaveSuccess ? '保存成功' : '保存'}
              </button>
              <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                <RotateCcw size={18} />
                重置
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="p-6 max-w-7xl mx-auto pt-24">
        {/* 汇总卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="text-gray-400" size={18} />
              <span className="text-xs text-gray-400">单个卖价(不含税)</span>
            </div>
            <p className="text-2xl font-bold text-gray-800">{sellPrices.noTax !== null ? `¥${sellPrices.noTax.toFixed(2)}` : '-'}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-sm p-5 text-white">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={18} className="text-blue-100" />
              <span className="text-xs text-blue-100">单个卖价(含税)</span>
            </div>
            <p className="text-2xl font-bold">{sellPrices.withTax !== null ? `¥${sellPrices.withTax.toFixed(2)}` : '-'}</p>
          </div>
        </div>

        {/* 状态流转 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flag className="text-gray-400" size={18} />
              <h3 className="text-sm font-semibold text-gray-700">订单状态流转</h3>
            </div>
            <div className="flex gap-2">
              {isEditMode && canGoPrev && (
                <button
                  onClick={handlePrevStatus}
                  disabled={loading}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <ChevronLeft size={16} />
                  退回上一节点
                </button>
              )}
              {isEditMode && canGoNext && (
                <button
                  onClick={handleNextStatus}
                  disabled={loading}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  进入下一节点
                  <ChevronRight size={16} />
                </button>
              )}
              {isEditMode && canEnd && (
                <button
                  onClick={handleEndQuote}
                  disabled={loading}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Square size={16} />
                  结束订单
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between relative">
            {/* 连接线 */}
            <div className="absolute top-6 left-0 right-0 h-1 bg-gray-200 -z-10"></div>
            <div 
              className="absolute top-6 left-0 h-1 bg-primary-500 -z-10 transition-all duration-500"
              style={{ width: `${((status - 1) / 5) * 100}%` }}
            ></div>

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
                <div key={option.value} className="flex flex-col items-center text-center">
                  <div className={`relative w-10 h-10 rounded-full flex items-center justify-center ${
                    isCurrent ? 'bg-primary-500 text-white ring-4 ring-primary-100' :
                    isPast ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    {isCurrent ? (
                      <CircleDot size={20} />
                    ) : isPast ? (
                      <CheckCircle size={18} />
                    ) : (
                      <Circle size={18} />
                    )}
                  </div>
                  <p className={`text-xs font-medium mt-2 ${
                    isCurrent ? 'text-primary-600' : 'text-gray-600'
                  }`}>{option.label}</p>
                  <p className="text-xs text-gray-400 mt-1">{nodeTime || '-'}</p>
                  {index < STATUS_OPTIONS.length - 1 && (
                    <div className="absolute top-6 w-full h-0.5 bg-gray-200"></div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 做货流程（状态为做货中时显示） */}
        {status === 3 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Play className="text-gray-400" size={18} />
              <h3 className="text-sm font-semibold text-gray-700">订单做货流程</h3>
            </div>
            <div className="space-y-3">
              {PRODUCTION_STEPS.map((step, index) => {
                const stepStatus = productionStepStatus[step.id] || 'pending'
                return (
                  <div key={step.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      stepStatus === 'completed' ? 'bg-green-500 text-white' :
                      stepStatus === 'in_progress' ? 'bg-primary-500 text-white' : 'bg-gray-300 text-gray-500'
                    }`}>
                      {stepStatus === 'completed' ? (
                        <CheckCircle size={16} />
                      ) : stepStatus === 'in_progress' ? (
                        <Play size={14} />
                      ) : (
                        <span className="text-sm font-medium">{index + 1}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-medium ${
                        stepStatus === 'completed' ? 'text-green-700' :
                        stepStatus === 'in_progress' ? 'text-primary-700' : 'text-gray-700'
                      }`}>{step.name}</p>
                      <p className="text-xs text-gray-500">{step.description}</p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'pending')}
                        className={`px-2 py-1 text-xs rounded ${
                          stepStatus === 'pending' ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        待处理
                      </button>
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'in_progress')}
                        className={`px-2 py-1 text-xs rounded ${
                          stepStatus === 'in_progress' ? 'bg-primary-200 text-primary-700' : 'bg-white text-gray-500 hover:bg-primary-50'
                        }`}
                      >
                        进行中
                      </button>
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'completed')}
                        className={`px-2 py-1 text-xs rounded ${
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

        {/* 主体：订单信息 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList size={18} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-700">订单信息</h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">客户信息</h4>
              </div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                <TextField label="客户名称" value={orderInfo.customerName} onChange={(v) => updateOrderField('customerName', v)} placeholder="请输入客户名称" />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">订单状态</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(parseInt(e.target.value))}
                    className="w-full px-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">做货日期</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={orderInfo.productionTimeStart}
                      onChange={(e) => updateOrderField('productionTimeStart', e.target.value)}
                      className="w-full px-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                    />
                    <span className="text-sm text-gray-500 shrink-0">到</span>
                    <input
                      type="date"
                      value={orderInfo.productionTimeEnd}
                      onChange={(e) => updateOrderField('productionTimeEnd', e.target.value)}
                      className="w-full px-2 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                    />
                  </div>
                </div>
                <TextField label="收货地址" value={orderInfo.shippingAddress} onChange={(v) => updateOrderField('shippingAddress', v)} placeholder="请输入收货地址" multiline />
              </div>
            </div>

            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">订单信息</h4>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">款式</label>
                    <select
                      value={orderInfo.productStyle}
                      onChange={(e) => updateOrderField('productStyle', e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors"
                    >
                      {PRODUCT_STYLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">产品规格</label>
                    <input type="text" value={orderInfo.productSpec ? `${orderInfo.productSpec}CM` : ''} onChange={(e) => updateOrderField('productSpec', e.target.value.replace(/CM$/, ''))}
                      placeholder="产品规格"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">面料材质</label>
                    <input type="text" value={orderInfo.fabricMaterial} onChange={(e) => updateOrderField('fabricMaterial', e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">工艺</label>
                    <input type="text" value={orderInfo.process} onChange={(e) => updateOrderField('process', e.target.value)}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs text-gray-400 mb-0.5">手提材质</label>
                    <input type="text" value={orderInfo.handleMaterial} onChange={(e) => updateOrderField('handleMaterial', e.target.value)}
                      placeholder="材质"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs text-gray-400 mb-0.5">手提规格</label>
                    <input type="text" value={orderInfo.handleSpec} onChange={(e) => updateOrderField('handleSpec', e.target.value)}
                      placeholder="手提规格"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">打样费</label>
                    <input type="text" value={orderInfo.sampleFee ? `${orderInfo.sampleFee}元` : ''} onChange={(e) => updateOrderField('sampleFee', e.target.value.replace(/元$/, ''))}
                      placeholder="0"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">打样天数</label>
                    <input type="number" value={orderInfo.sampleDays} onChange={(e) => updateOrderField('sampleDays', e.target.value)}
                      placeholder="0"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">大货天数</label>
                    <input type="number" value={orderInfo.massDays} onChange={(e) => updateOrderField('massDays', e.target.value)}
                      placeholder="0"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">数量</label>
                    <input type="text" value={orderInfo.quantity ? `${orderInfo.quantity}个` : ''} onChange={(e) => updateOrderField('quantity', e.target.value.replace(/个$/, ''))}
                      placeholder="0"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">箱规</label>
                    <input type="text" value={orderInfo.boxSpec} onChange={(e) => updateOrderField('boxSpec', e.target.value)}
                      placeholder="箱规"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <label className="block text-xs text-gray-400 mb-0.5">备注</label>
                    <textarea
                      value={orderInfo.remark}
                      onChange={(e) => updateOrderField('remark', e.target.value)}
                      placeholder="请输入备注信息"
                      rows={2}
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors resize-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={16} className="text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">产品图片</span>
                  </div>
                  <label className="cursor-pointer flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
                    <Upload size={14} />
                    上传图片
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>
                {productImages.length === 0 ? (
                  <label
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg py-6 transition-colors cursor-pointer ${
                      isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${isDragging ? 'bg-blue-200' : 'bg-gray-100'}`}>
                      <Upload size={18} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <p className={`text-xs mb-0.5 ${isDragging ? 'text-blue-600' : 'text-gray-600'}`}>
                      {isDragging ? '释放鼠标上传图片' : '点击或拖拽上传产品图片'}
                    </p>
                    <p className="text-xs text-gray-400">支持多选 · JPG / PNG / GIF / WebP</p>
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
                        <div key={index} className="relative aspect-square">
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
        </div>

        {/* 在线表格 — 全宽，不受订单信息的 max-w-7xl 限制 */}
      </div>
      <div className="px-6 pb-6">
        <div className="flex items-center gap-2 mb-3">
          <Table2 size={18} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-700">在线表格</h3>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div ref={sheetContainerRef} style={{ height: 'calc(100vh - 260px)', minHeight: 400 }} />
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
    </div>
  )
}
