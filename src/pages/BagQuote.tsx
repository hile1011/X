import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, TrendingUp, DollarSign, ShoppingBag, Image as ImageIcon, Upload, X, ClipboardList, Calculator, Info } from 'lucide-react'

interface FrontBackRowInput {
  label: string
  widthBleed: number
  heightBleed: number
  width: number
  height: number
  bottom: number
  fabricWidth: number
  gramWeight: number
  processingFee: number
  frontBackPrintCost: number
  fabricPrice: number
  extraCraftCost: number
  packagingFee: number
  lossRate: number
}

interface BagQuoteInput {
  quantity: number
  width: number
  height: number
  bottom: number
  frontBackRows: FrontBackRowInput[]
  handleWidth: number
  handleHeight: number
  handleCutWidth: number
  handleWidthBleed: number
  handleHeightBleed: number
  handleProcessingFee: number
  handlePrintCost: number
  handleFabricPrice: number
  handleFabricCost: number
  handleExtraCraftCost: number
  handlePackagingFee: number
  profitRate: number
  taxRate: number
}

interface SpecRow {
  label: string
  quantity: number | null
  width: number | null
  height: number | null
  bottom: number | null
  widthBleed: number | null
  heightBleed: number | null
  cutWidth: number | null
  cutHeight: number | null
  fabricWidth: number | null
  gramWeight: number | null
  fabricWaste: number | null
  fabricMeters: number | null
  maxPanels: number | null
  totalWeight: number | null
  unitGramWeight: number | null
}

interface CostRow {
  label: string
  processingFee: number | null
  printDoubleSide: number | null
  fabricPrice: number | null
  fabricCost: number | null
  extraCraftCost: number | null
  packagingFee: number | null
  freightUnit: number | null
  lossRate: number | null
  unitTotalPrice: number | null
}

interface QuoteResult {
  input: BagQuoteInput
  specTable: SpecRow[]
  costTable: CostRow[]
  summary: {
    unitCost: number
    refPriceNoTax: number
    refPriceWithTax: number
    totalProfit: number
    unitProfit: number
    totalUnitGramWeight: number
  }
}

interface OrderInfo {
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  customerName: string
  shippingAddress: string
  productStyle: string
  fabricMaterial: string
  process: string
  handleMaterial: string
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
  productStyle: '无底无侧普通款',
  fabricMaterial: '10安涤棉新本色',
  process: '单面数码uv印刷',
  handleMaterial: '帆布手提',
  boxSpec: '',
  remark: '',
  sampleFee: '',
  sampleDays: '',
  massDays: '',
}

const DEFAULT_INPUT: BagQuoteInput = {
  quantity: 1000,
  width: 38,
  height: 40,
  bottom: 0,
  frontBackRows: [{
    label: '正反面',
    widthBleed: 3,
    heightBleed: 10,
    width: 38,
    height: 40,
    bottom: 0,
    fabricWidth: 154,
    gramWeight: 280,
    processingFee: 0.51,
    frontBackPrintCost: 0,
    fabricPrice: 4.4,
    extraCraftCost: 0.05,
    packagingFee: 0.1,
    lossRate: 1.03,
  }],
  handleWidth: 2.5,
  handleHeight: 70,
  handleCutWidth: 6,
  handleWidthBleed: 3,
  handleHeightBleed: 10,
  handleProcessingFee: 0,
  handlePrintCost: 0,
  handleFabricPrice: 4.4,
  handleFabricCost: 0.05,
  handleExtraCraftCost: 0,
  handlePackagingFee: 0,
  profitRate: 0.45,
  taxRate: 1.1,
}

function fmt(v: number | null, digits = 2): string {
  if (v === null || v === undefined) return '-'
  return v.toFixed(digits)
}

function money(v: number): string {
  return `¥${v.toFixed(2)}`
}

interface TextFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  multiline?: boolean
  fullWidth?: boolean
}

function TextField({ label, value, onChange, placeholder, multiline, fullWidth }: TextFieldProps) {
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

function InfoItem({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  const isEmpty = value === '' || (value === 0 && label !== '底')
  return (
    <div>
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm font-medium text-gray-800 break-words">
        {isEmpty ? '-' : value}
        {unit && !isEmpty && <span className="ml-0.5 text-xs text-gray-400">{unit}</span>}
      </div>
    </div>
  )
}

function EditableCell({ value, onChange, step = '1' }: { value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="w-full px-2 py-1 text-sm text-right text-blue-600 bg-blue-50/40 border border-blue-200 hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none rounded transition-colors min-w-[64px]"
    />
  )
}

const FRONT_BACK_SPEC_EDITS: Record<string, { field: keyof FrontBackRowInput; step?: string }> = {
  width: { field: 'width', step: '0.1' },
  height: { field: 'height', step: '0.1' },
  bottom: { field: 'bottom', step: '0.1' },
  widthBleed: { field: 'widthBleed', step: '0.1' },
  heightBleed: { field: 'heightBleed', step: '0.1' },
  fabricWidth: { field: 'fabricWidth', step: '1' },
  gramWeight: { field: 'gramWeight', step: '1' },
}

const FRONT_BACK_COST_EDITS: Record<string, { field: keyof FrontBackRowInput; step?: string }> = {
  processingFee: { field: 'processingFee', step: '0.01' },
  printDoubleSide: { field: 'frontBackPrintCost', step: '0.01' },
  fabricPrice: { field: 'fabricPrice', step: '0.01' },
  extraCraftCost: { field: 'extraCraftCost', step: '0.01' },
  packagingFee: { field: 'packagingFee', step: '0.01' },
  lossRate: { field: 'lossRate', step: '0.01' },
}

export default function BagQuote() {
  const [input, setInput] = useState<BagQuoteInput>(DEFAULT_INPUT)
  const [result, setResult] = useState<QuoteResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [orderInfo, setOrderInfo] = useState<OrderInfo>(DEFAULT_ORDER_INFO)
  const [productImages, setProductImages] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string>('')

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

  const calculate = useCallback(async (data: BagQuoteInput) => {
    setLoading(true)
    try {
      const resp = await fetch('/api/bag-quote/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await resp.json()
      if (json.success) {
        setResult(json.result)
        if (json.result?.summary?.totalUnitGramWeight) {
          setOrderInfo((prev) => ({
            ...prev,
            boxSpec: json.result.summary.totalUnitGramWeight.toFixed(2) + 'g/个'
          }))
        }
      }
    } catch (err) {
      console.error('计算失败:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      calculate(input)
    }, 300)
    return () => clearTimeout(timer)
  }, [input, calculate])

  const updateField = (field: keyof BagQuoteInput | keyof FrontBackRowInput, value: number, rowIndex?: number) => {
    if (rowIndex !== undefined) {
      setInput((prev) => ({
        ...prev,
        frontBackRows: prev.frontBackRows.map((row, i) =>
          i === rowIndex ? { ...row, [field]: value } : row
        ),
      }))
    } else {
      setInput((prev) => ({ ...prev, [field as keyof BagQuoteInput]: value }))
    }
  }

  const handleReset = () => {
    setInput(DEFAULT_INPUT)
  }

  const updateOrderField = (field: keyof OrderInfo, value: string) => {
    setOrderInfo((prev) => ({ ...prev, [field]: value }))
  }

  const addFrontBackRow = () => {
    const lastRow = input.frontBackRows[input.frontBackRows.length - 1] || {
      label: '正反面',
      widthBleed: 3,
      heightBleed: 10,
      width: 38,
      height: 40,
      bottom: 0,
      fabricWidth: 154,
      gramWeight: 280,
      processingFee: 0.51,
      frontBackPrintCost: 0,
      fabricPrice: 4.4,
      extraCraftCost: 0.05,
      packagingFee: 0.1,
      lossRate: 1.03,
    }
    const newIndex = input.frontBackRows.length + 1
    setInput((prev) => ({
      ...prev,
      frontBackRows: [...prev.frontBackRows, { ...lastRow, label: `正反面${newIndex}` }],
    }))
  }

  const specCell = (row: SpecRow, col: keyof SpecRow, digits = 2) => {
    if (row.label === '成品') {
      const edits: Record<string, { field: 'quantity' | 'width' | 'height' | 'bottom'; step?: string }> = {
        quantity: { field: 'quantity', step: '1' },
        width: { field: 'width', step: '0.1' },
        height: { field: 'height', step: '0.1' },
        bottom: { field: 'bottom', step: '0.1' },
      }
      const edit = edits[col as string]
      if (edit) {
        return <EditableCell value={input[edit.field]} onChange={(v) => updateField(edit.field, v)} step={edit.step} />
      }
    } else if (row.label === '印刷手提') {
      const edits: Record<string, { field: 'quantity' | 'handleWidth' | 'handleHeight' | 'bottom' | 'handleWidthBleed' | 'handleHeightBleed' | 'handleCutWidth'; step?: string }> = {
        quantity: { field: 'quantity', step: '1' },
        width: { field: 'handleWidth', step: '0.1' },
        height: { field: 'handleHeight', step: '0.1' },
        bottom: { field: 'bottom', step: '0.1' },
        widthBleed: { field: 'handleWidthBleed', step: '0.1' },
        heightBleed: { field: 'handleHeightBleed', step: '0.1' },
        cutWidth: { field: 'handleCutWidth', step: '0.1' },
      }
      const edit = edits[col as string]
      if (edit) {
        return <EditableCell value={input[edit.field]} onChange={(v) => updateField(edit.field, v)} step={edit.step} />
      }
    } else {
      const rowIndex = input.frontBackRows.findIndex((r) => r.label === row.label)
      if (rowIndex !== -1) {
        const edit = FRONT_BACK_SPEC_EDITS[col as string]
        if (edit) {
          return <EditableCell value={input.frontBackRows[rowIndex][edit.field] as number} onChange={(v) => updateField(edit.field, v, rowIndex)} step={edit.step} />
        }
      }
    }
    return <span className="px-2 text-gray-700">{fmt(row[col] as number | null, digits)}</span>
  }

  const costCell = (row: CostRow, col: keyof CostRow, digits = 4) => {
    if (row.label === '印刷手提') {
      const edits: Record<string, { field: 'handleProcessingFee' | 'handlePrintCost' | 'handleFabricPrice' | 'handleFabricCost' | 'handleExtraCraftCost' | 'handlePackagingFee'; step?: string }> = {
        processingFee: { field: 'handleProcessingFee', step: '0.01' },
        printDoubleSide: { field: 'handlePrintCost', step: '0.01' },
        fabricPrice: { field: 'handleFabricPrice', step: '0.01' },
        fabricCost: { field: 'handleFabricCost', step: '0.01' },
        extraCraftCost: { field: 'handleExtraCraftCost', step: '0.01' },
        packagingFee: { field: 'handlePackagingFee', step: '0.01' },
      }
      const edit = edits[col as string]
      if (edit) {
        return <EditableCell value={input[edit.field]} onChange={(v) => updateField(edit.field, v)} step={edit.step} />
      }
    } else {
      const rowIndex = input.frontBackRows.findIndex((r) => r.label === row.label)
      if (rowIndex !== -1) {
        const edit = FRONT_BACK_COST_EDITS[col as string]
        if (edit) {
          return <EditableCell value={input.frontBackRows[rowIndex][edit.field] as number} onChange={(v) => updateField(edit.field, v, rowIndex)} step={edit.step} />
        }
      }
    }
    return <span className="px-2 text-gray-700">{fmt(row[col] as number | null, digits)}</span>
  }

  const s = result?.summary

  return (
    <div className="min-h-screen">
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <ShoppingBag className="text-blue-600" size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">报价管理</h1>
              <p className="text-sm text-gray-500">基于帆布袋价格试算表的报价规则，参数修改实时计算</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
              <RotateCcw size={18} />
              重置
            </button>
            {loading && (
              <span className="flex items-center gap-2 px-4 py-2 text-blue-600">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                计算中...
              </span>
            )}
          </div>
        </div>

        {/* 汇总卡片 */}
        {s && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="text-gray-400" size={18} />
                <span className="text-xs text-gray-400">单个卖价(不含税)</span>
              </div>
              <p className="text-2xl font-bold text-gray-800">{money(s.refPriceNoTax)}</p>
            </div>
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-sm p-5 text-white">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={18} className="text-blue-100" />
                <span className="text-xs text-blue-100">单个卖价(含税)</span>
              </div>
              <p className="text-2xl font-bold">{money(s.refPriceWithTax)}</p>
            </div>
          </div>
        )}

        {/* 编辑提示 */}
        <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
          <Calculator size={14} className="text-gray-400" />
          <span>下方计算表中蓝色标记的单元格可直接修改参数，修改后实时重新计算并同步更新上方订单信息展示</span>
        </div>

        {/* 主体：订单信息 - 紧凑2列布局，一屏展示 */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardList size={18} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-700">订单信息</h3>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
            {/* 客户信息 - 全宽，做货时间为日期区间 */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">客户信息</h4>
              </div>
              <div className="p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
                <TextField label="客户名称" value={orderInfo.customerName} onChange={(v) => updateOrderField('customerName', v)} placeholder="请输入客户名称" />
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

            {/* 订单信息 - 独占整行，含图片上传 */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                <h4 className="text-sm font-semibold text-gray-700">订单信息</h4>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2">
                  <InfoItem label="数量" value={input.quantity} unit="个" />
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">款式</label>
                    <input type="text" value={orderInfo.productStyle} onChange={(e) => updateOrderField('productStyle', e.target.value)}
                      placeholder="款式"
                      className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">规格(cm)：宽×高×底</label>
                    <div className="flex items-center gap-1">
                      <input type="number" value={input.width} step="0.1" onChange={(e) => updateField('width', parseFloat(e.target.value) || 0)}
                        className="w-14 px-1.5 py-0.5 text-xs font-medium text-center text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                      <span className="text-gray-400 text-xs">×</span>
                      <input type="number" value={input.height} step="0.1" onChange={(e) => updateField('height', parseFloat(e.target.value) || 0)}
                        className="w-14 px-1.5 py-0.5 text-xs font-medium text-center text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                      <span className="text-gray-400 text-xs">×</span>
                      <input type="number" value={input.bottom} step="0.1" onChange={(e) => updateField('bottom', parseFloat(e.target.value) || 0)}
                        className="w-14 px-1.5 py-0.5 text-xs font-medium text-center text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                    </div>
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
                    <label className="block text-xs text-gray-400 mb-0.5">手提材质 / 宽×高 (cm)</label>
                    <div className="flex items-center gap-1">
                      <input type="text" value={orderInfo.handleMaterial} onChange={(e) => updateOrderField('handleMaterial', e.target.value)}
                        placeholder="材质"
                        className="flex-1 px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                      <span className="text-gray-400 text-xs">/</span>
                      <input type="number" value={input.handleWidth} step="0.1" onChange={(e) => updateField('handleWidth', parseFloat(e.target.value) || 0)}
                        className="w-12 px-1 py-1 text-sm font-medium text-center text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                      <span className="text-gray-400 text-xs">×</span>
                      <input type="number" value={input.handleHeight} step="0.1" onChange={(e) => updateField('handleHeight', parseFloat(e.target.value) || 0)}
                        className="w-12 px-1 py-1 text-sm font-medium text-center text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-0.5">打样费（元）</label>
                    <input type="number" value={orderInfo.sampleFee} onChange={(e) => updateOrderField('sampleFee', e.target.value)}
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
                      }`}
                        onDragOver={(e) => { e.stopPropagation(); handleDragOver(e); }}
                        onDragLeave={(e) => { e.stopPropagation(); handleDragLeave(e); }}
                        onDrop={(e) => { e.stopPropagation(); handleDrop(e); }}
                      >
                        <Upload size={18} className={isDragging ? 'text-blue-600 mb-1' : 'text-gray-400 mb-1'} />
                        <span className={isDragging ? 'text-xs text-blue-600' : 'text-xs text-gray-400'}>添加</span>
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 黄色分割线标识 - 与Excel一致 */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex-1 h-0.5 bg-yellow-400"></div>
          <span className="px-4 text-sm font-medium text-yellow-600 bg-yellow-100 rounded-full py-1">
            黄色分割线 · 以上为订单信息，以下为计算表（可直接在表格中修改参数）
          </span>
          <div className="flex-1 h-0.5 bg-yellow-400"></div>
        </div>

        {/* 计算结果 */}
        <div className="grid grid-cols-1 gap-6">
          {result && (
            <>
              {/* 规格计算表 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-blue-50">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 text-sm">规格计算表</h3>
                    <div className="flex items-center gap-3">
                      <button onClick={addFrontBackRow} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors">
                        <span className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">+</span>
                        增加行
                      </button>
                      <div className="relative group">
                        <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors">
                          <Info size={14} />
                          计算公式
                        </button>
                        <div className="absolute right-0 mt-2 w-80 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                          <div className="space-y-2">
                            <div><span className="text-blue-300">切片宽(正反面)</span> = 宽出血 + 宽</div>
                            <div><span className="text-blue-300">切片高(正反面)</span> = 高×2 + 高出血 + 底</div>
                            <div><span className="text-blue-300">切片高(手提)</span> = 手提高</div>
                            <div><span className="text-blue-300">门幅最大面数</span> = 门幅 ÷ min(切片宽, 切片高)</div>
                            <div><span className="text-blue-300">布料米数</span> = ceiling(数量/面数) × max(宽,高) ÷ 100</div>
                            <div><span className="text-blue-300">总重量</span> = 布料米数 × 克重 × 1.5 ÷ 1000</div>
                            <div><span className="text-blue-300">单个克重</span> = 总重量 ÷ 数量 × 1000</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50">项目</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">数量</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">宽</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">高</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">底</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">宽出血</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">高出血</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">切片宽</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">切片高</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">门幅</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">克重</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">废料</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">布料米数</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">最大面数</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">总重量</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">单个克重</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.specTable.map((row, i) => (
                        <tr key={i} className={row.label === '成品' ? 'bg-gray-50' : ''}>
                          <td className="px-3 py-2 font-medium text-gray-900 sticky left-0 bg-inherit whitespace-nowrap">{row.label}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'quantity', 0)}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'width')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'height')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'bottom')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'widthBleed')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'heightBleed')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'cutWidth')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'cutHeight')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'fabricWidth', 0)}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'gramWeight', 0)}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'fabricWaste')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'fabricMeters')}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'maxPanels', 4)}</td>
                          <td className="px-1 py-1 text-right">{specCell(row, 'totalWeight')}</td>
                          <td className="px-1 py-1 text-right font-semibold text-blue-600">{row.label === '成品' && s ? s.totalUnitGramWeight.toFixed(2) : specCell(row, 'unitGramWeight')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 成本计算表 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-blue-50">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-800 text-sm">成本计算表</h3>
                    <div className="relative group">
                      <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors">
                        <Info size={14} />
                        计算公式
                      </button>
                      <div className="absolute right-0 mt-2 w-80 bg-gray-900 text-white text-xs rounded-lg shadow-lg p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                        <div className="space-y-2">
                          <div><span className="text-blue-300">印刷双面(正反面)</span> = 切片宽 × 切片高 × 1.1 ÷ 10000</div>
                          <div><span className="text-blue-300">布料成本</span> = 布料价×米数/数量 + 运费分摊 + 0.04</div>
                          <div><span className="text-blue-300">运费</span> = 总重量 × 0.8</div>
                          <div><span className="text-blue-300">单个总价</span> = (加工费+印刷+工艺+布料+运费)×损耗系数 + 包装费</div>
                          <div><span className="text-blue-300">参考卖价(不含税)</span> = 单个总成本 + 利润率</div>
                          <div><span className="text-blue-300">参考卖价(含税)</span> = 不含税卖价 × 含税系数</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50">项目</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">加工费</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">印刷双面</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">布料价格</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">布料成本</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">额外工艺</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">包装费</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">运费</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">损耗系数</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">单个总价</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.costTable.map((row, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-medium text-gray-900 sticky left-0 bg-inherit whitespace-nowrap">{row.label}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'processingFee')}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'printDoubleSide')}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'fabricPrice')}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'fabricCost')}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'extraCraftCost')}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'packagingFee')}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'freightUnit', 2)}</td>
                          <td className="px-1 py-1 text-right">{costCell(row, 'lossRate', 2)}</td>
                          <td className="px-1 py-1 text-right font-semibold text-blue-600">{fmt(row.unitTotalPrice, 2)}</td>
                        </tr>
                      ))}
                      <tr className="bg-amber-50 font-semibold">
                        <td className="px-3 py-2 text-gray-900 sticky left-0 bg-amber-50">汇总</td>
                        <td colSpan={8} className="px-3 py-2 text-right text-gray-500">单个总成本</td>
                        <td className="px-3 py-2 text-right text-gray-900">{fmt(s!.unitCost, 2)}</td>
                      </tr>
                      <tr className="bg-green-50 font-semibold">
                        <td className="px-3 py-2 text-gray-900 sticky left-0 bg-green-50">参考卖价</td>
                        <td colSpan={7} className="px-3 py-2 text-right text-gray-500">
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            <span>利润率</span>
                            <input type="number" value={input.profitRate} step="0.01" onChange={(e) => updateField('profitRate', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-0.5 text-sm text-right text-blue-600 bg-blue-50/40 border border-blue-200 hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none rounded" />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">不含税</td>
                        <td className="px-3 py-2 text-right text-green-700">{fmt(s!.refPriceNoTax, 2)}</td>
                      </tr>
                      <tr className="bg-blue-50 font-semibold">
                        <td className="px-3 py-2 text-gray-900 sticky left-0 bg-blue-50">含税卖价</td>
                        <td colSpan={7} className="px-3 py-2 text-right text-gray-500">
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            <span>含税系数</span>
                            <input type="number" value={input.taxRate} step="0.01" onChange={(e) => updateField('taxRate', parseFloat(e.target.value) || 0)}
                              className="w-20 px-2 py-0.5 text-sm text-right text-blue-600 bg-blue-50/40 border border-blue-200 hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none rounded" />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">含税</td>
                        <td className="px-3 py-2 text-right text-blue-700">{fmt(s!.refPriceWithTax, 2)}</td>
                      </tr>
                      <tr className="bg-purple-50 font-semibold">
                        <td className="px-3 py-2 text-gray-900 sticky left-0 bg-purple-50">利润</td>
                        <td colSpan={8} className="px-3 py-2 text-right text-gray-500">总利润</td>
                        <td className="px-3 py-2 text-right text-purple-700">¥{s!.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
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
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  )
}
