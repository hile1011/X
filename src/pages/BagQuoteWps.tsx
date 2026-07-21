import { useState, useEffect, useCallback } from 'react'
import { RotateCcw, TrendingUp, DollarSign, ShoppingBag, Image as ImageIcon, Upload, X, ClipboardList, Calculator, FileSpreadsheet, AlertCircle } from 'lucide-react'
import { calculateBagQuote as calcBagQuote } from '../services/bagQuoteCalculator'

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
  quantity: 7200,
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

export default function BagQuoteWps() {
  const [input, setInput] = useState<BagQuoteInput>(DEFAULT_INPUT)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [orderInfo, setOrderInfo] = useState<OrderInfo>(DEFAULT_ORDER_INFO)
  const [productImages, setProductImages] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string>('')
  const [iframeLoading, setIframeLoading] = useState(true)
  const [wpsDocumentUrl, setWpsDocumentUrl] = useState(import.meta.env.VITE_WPS_DOC_URL || '')
  const [refreshKey, setRefreshKey] = useState(0)

  const hasWpsUrl = !!wpsDocumentUrl

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

  const calculate = useCallback((data: BagQuoteInput) => {
    setLoading(true)
    try {
      const calcResult = calcBagQuote(data)
      const resultData = calcResult as unknown as any
      setResult(resultData)
      if (resultData?.summary?.totalUnitGramWeight) {
        setOrderInfo((prev) => ({
          ...prev,
          boxSpec: resultData.summary.totalUnitGramWeight.toFixed(2) + 'g/个'
        }))
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
      setInput((prev) => {
        const next = { ...prev, [field as keyof BagQuoteInput]: value }
        if (field === 'bottom') {
          next.frontBackRows = prev.frontBackRows.map((row) => ({ ...row, bottom: value }))
        }
        return next
      })
    }
  }

  const handleReset = () => {
    setInput(DEFAULT_INPUT)
  }

  const updateOrderField = (field: keyof OrderInfo, value: string) => {
    setOrderInfo((prev) => ({ ...prev, [field]: value }))
  }

  const s = result?.summary

  return (
    <div className="min-h-screen">
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileSpreadsheet className="text-blue-600" size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">报价管理-WPS版</h1>
              <p className="text-sm text-gray-500">基于WPS在线表格的报价规则，支持完整Excel功能</p>
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

        <div className="flex items-center gap-2 mb-4 text-xs text-gray-400">
          <Calculator size={14} className="text-gray-400" />
          <span>WPS在线表格支持完整Excel功能：公式编辑、复制粘贴、格式设置、图表等</span>
        </div>

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

        <div className="flex items-center justify-center mb-6">
          <div className="flex-1 h-0.5 bg-yellow-400"></div>
          <span className="px-4 text-sm font-medium text-yellow-600 bg-yellow-100 rounded-full py-1">
            黄色分割线 · 以上为订单信息，以下为WPS在线计算表
          </span>
          <div className="flex-1 h-0.5 bg-yellow-400"></div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet size={16} className="text-gray-400" />
            <span className="text-sm font-semibold text-gray-700">在线表格链接</span>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={wpsDocumentUrl}
              onChange={(e) => setWpsDocumentUrl(e.target.value)}
              placeholder="请输入WPS在线表格链接..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {wpsDocumentUrl && (
              <button
                onClick={() => { setIframeLoading(true); setRefreshKey(prev => prev + 1) }}
                className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
              >
                刷新
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">提示：修改链接后，下方表格将自动刷新为新的在线表格</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-blue-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="text-blue-600" size={18} />
              <span className="font-semibold text-gray-700 text-sm">价格试算表（WPS在线表格）</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>支持完整Excel功能</span>
              <span className="text-blue-500">·</span>
              <span>公式编辑</span>
              <span className="text-blue-500">·</span>
              <span>图表制作</span>
              <span className="text-blue-500">·</span>
              <span>格式设置</span>
            </div>
          </div>
          <div className="p-4">
            <div className="relative" style={{ height: '800px' }}>
              {!hasWpsUrl && (
                <div className="absolute inset-0 bg-gray-50 flex items-center justify-center z-20">
                  <div className="text-center max-w-md">
                    <AlertCircle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">WPS 文档链接未配置</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      请在项目根目录的 <code className="px-1 py-0.5 bg-gray-200 rounded text-xs">.env</code> 文件中设置 WPS 文档链接：
                    </p>
                    <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-left text-xs mb-4 font-mono">
                      VITE_WPS_DOC_URL=https://your-wps-document-url
                    </pre>
                    <p className="text-xs text-gray-400">
                      提示：您可以在 WPS 在线文档中创建价格试算表，然后复制分享链接填入上述配置
                    </p>
                  </div>
                </div>
              )}
              {iframeLoading && hasWpsUrl && (
                <div className="absolute inset-0 bg-white/90 flex items-center justify-center z-10">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm text-gray-500">加载 WPS 文档...</span>
                  </div>
                </div>
              )}
              <iframe
                key={refreshKey}
                id="wps-iframe"
                src={hasWpsUrl ? wpsDocumentUrl : ''}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="帆布袋价格试算表"
                onLoad={() => setIframeLoading(false)}
                allowFullScreen
              />
            </div>
          </div>
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