import { useState } from 'react'
import { Image as ImageIcon, Upload, X, DollarSign } from 'lucide-react'
import VTableWrapper, { VTableColumnDef } from '../components/VTableWrapper'
import { calculateBagQuote, defaultBagQuoteInput } from '../services/bagQuoteCalculator'

interface OrderInfo {
  customerName: string
  startDate: string
  endDate: string
  address: string
  quantity: string
  style: string
  width: string
  height: string
  bottom: string
  fabricMaterial: string
  craft: string
  handleMaterial: string
  handleWidth: string
  handleHeight: string
  sampleFee: string
  sampleDays: string
  productionDays: string
  boxSpec: string
  remark: string
}

const defaultOrderInfo: OrderInfo = {
  customerName: '',
  startDate: new Date().toISOString().split('T')[0],
  endDate: '',
  address: '',
  quantity: '7200',
  style: '无底无侧普通款',
  width: '56',
  height: '40',
  bottom: '0',
  fabricMaterial: '10安涤棉新本色',
  craft: '单面数码uv印刷',
  handleMaterial: '帆布手提',
  handleWidth: '2.5',
  handleHeight: '70',
  sampleFee: '0',
  sampleDays: '0',
  productionDays: '0',
  boxSpec: '',
  remark: '',
}

const specFields: VTableColumnDef[] = [
  { key: 'quantity', label: '数量(个)', type: 'number', digits: 0 },
  { key: 'width', label: '宽(CM)', type: 'number' },
  { key: 'height', label: '高(CM)', type: 'number' },
  { key: 'bottom', label: '底(CM)', type: 'number' },
  { key: 'widthBleed', label: '宽出血', type: 'number' },
  { key: 'heightBleed', label: '高出血', type: 'number' },
  { key: 'cutWidth', label: '切片宽', type: 'formula' },
  { key: 'cutHeight', label: '切片高', type: 'formula' },
  { key: 'fabricWidth', label: '布料门幅', type: 'number', digits: 0 },
  { key: 'gramWeight', label: '克重', type: 'number', digits: 0 },
  { key: 'fabricWaste', label: '门幅最大废料', type: 'formula' },
  { key: 'fabricMeters', label: '布料米数', type: 'formula' },
  { key: 'maxPanels', label: '门幅最大面数', type: 'formula', digits: 4 },
  { key: 'totalWeight', label: '总重量', type: 'formula' },
  { key: 'unitGramWeight', label: '单个克重', type: 'formula' },
]

const costFields: VTableColumnDef[] = [
  { key: 'processingFee', label: '加工费(元/个)', type: 'number' },
  { key: 'printDoubleSide', label: '印刷双面(元/个)', type: 'formula' },
  { key: 'fabricPrice', label: '布料价格', type: 'number' },
  { key: 'fabricCost', label: '布料成本(元)', type: 'formula' },
  { key: 'extraCraftCost', label: '额外工艺成本-中包价打包', type: 'number' },
  { key: 'packagingFee', label: '包装费', type: 'number' },
  { key: 'freightUnit', label: '运费单价', type: 'formula' },
  { key: 'lossRate', label: '损耗系数', type: 'number' },
  { key: 'unitTotalPrice', label: '单个布袋总价(元)', type: 'formula' },
]

const combinedFields = [...specFields, ...costFields]

function generateDefaultTableData(): any[] {
  const result = calculateBagQuote(defaultBagQuoteInput)
  console.log('Calculation result:', JSON.stringify(result, null, 2))
  
  return [
    {
      label: '成品',
      quantity: result.specTable[0].quantity,
      width: result.specTable[0].width,
      height: result.specTable[0].height,
      bottom: result.specTable[0].bottom,
      widthBleed: result.specTable[0].widthBleed,
      heightBleed: result.specTable[0].heightBleed,
      cutWidth: result.specTable[1].cutWidth,
      cutHeight: result.specTable[1].cutHeight,
      fabricWidth: result.specTable[1].fabricWidth,
      gramWeight: result.specTable[1].gramWeight,
      fabricWaste: result.specTable[1].fabricWaste,
      fabricMeters: result.specTable[1].fabricMeters,
      maxPanels: result.specTable[1].maxPanels,
      totalWeight: result.specTable[1].totalWeight,
      unitGramWeight: result.specTable[1].unitGramWeight,
      processingFee: null,
      printDoubleSide: null,
      fabricPrice: null,
      fabricCost: null,
      extraCraftCost: null,
      packagingFee: null,
      freightUnit: null,
      lossRate: null,
      unitTotalPrice: null,
    },
    {
      label: '印刷手提',
      quantity: result.specTable[2].quantity,
      width: result.specTable[2].width,
      height: result.specTable[2].height,
      bottom: result.specTable[2].bottom,
      widthBleed: result.specTable[2].widthBleed,
      heightBleed: result.specTable[2].heightBleed,
      cutWidth: result.specTable[2].cutWidth,
      cutHeight: result.specTable[2].cutHeight,
      fabricWidth: result.specTable[2].fabricWidth,
      gramWeight: result.specTable[2].gramWeight,
      fabricWaste: result.specTable[2].fabricWaste,
      fabricMeters: result.specTable[2].fabricMeters,
      maxPanels: result.specTable[2].maxPanels,
      totalWeight: result.specTable[2].totalWeight,
      unitGramWeight: result.specTable[2].unitGramWeight,
      processingFee: result.costTable[1].processingFee,
      printDoubleSide: result.costTable[1].printDoubleSide,
      fabricPrice: result.costTable[1].fabricPrice,
      fabricCost: result.costTable[1].fabricCost,
      extraCraftCost: result.costTable[1].extraCraftCost,
      packagingFee: result.costTable[1].packagingFee,
      freightUnit: result.costTable[1].freightUnit,
      lossRate: result.costTable[1].lossRate,
      unitTotalPrice: result.costTable[1].unitTotalPrice,
    },
    {
      label: '正反面',
      quantity: result.specTable[1].quantity,
      width: result.specTable[1].width,
      height: result.specTable[1].height,
      bottom: result.specTable[1].bottom,
      widthBleed: result.specTable[1].widthBleed,
      heightBleed: result.specTable[1].heightBleed,
      cutWidth: result.specTable[1].cutWidth,
      cutHeight: result.specTable[1].cutHeight,
      fabricWidth: result.specTable[1].fabricWidth,
      gramWeight: result.specTable[1].gramWeight,
      fabricWaste: result.specTable[1].fabricWaste,
      fabricMeters: result.specTable[1].fabricMeters,
      maxPanels: result.specTable[1].maxPanels,
      totalWeight: result.specTable[1].totalWeight,
      unitGramWeight: result.specTable[1].unitGramWeight,
      processingFee: result.costTable[0].processingFee,
      printDoubleSide: result.costTable[0].printDoubleSide,
      fabricPrice: result.costTable[0].fabricPrice,
      fabricCost: result.costTable[0].fabricCost,
      extraCraftCost: result.costTable[0].extraCraftCost,
      packagingFee: result.costTable[0].packagingFee,
      freightUnit: result.costTable[0].freightUnit,
      lossRate: result.costTable[0].lossRate,
      unitTotalPrice: result.costTable[0].unitTotalPrice,
    },
    {
      label: '汇总',
      quantity: result.specTable[3].quantity,
      width: result.specTable[3].width,
      height: result.specTable[3].height,
      bottom: result.specTable[3].bottom,
      widthBleed: result.specTable[3].widthBleed,
      heightBleed: result.specTable[3].heightBleed,
      cutWidth: result.specTable[3].cutWidth,
      cutHeight: result.specTable[3].cutHeight,
      fabricWidth: result.specTable[3].fabricWidth,
      gramWeight: result.specTable[3].gramWeight,
      fabricWaste: result.specTable[3].fabricWaste,
      fabricMeters: result.specTable[3].fabricMeters,
      maxPanels: result.specTable[3].maxPanels,
      totalWeight: result.specTable[3].totalWeight,
      unitGramWeight: result.specTable[3].unitGramWeight,
      processingFee: null,
      printDoubleSide: null,
      fabricPrice: null,
      fabricCost: null,
      extraCraftCost: null,
      packagingFee: null,
      freightUnit: null,
      lossRate: null,
      unitTotalPrice: result.costTable[2].unitTotalPrice,
    },
  ]
}

const defaultTableData = generateDefaultTableData()

const FORMULA_EXPRS: Record<string, string> = {
  '0_cutWidth': '=H3',
  '0_cutHeight': '=I3',
  '0_fabricWidth': '=J3',
  '0_gramWeight': '=K3',
  '0_fabricWaste': '=L3',
  '0_fabricMeters': '=M3',
  '0_maxPanels': '=N3',
  '0_totalWeight': '=O3',
  '0_unitGramWeight': '=P3',
  '1_cutWidth': '=F2+C2',
  '1_cutHeight': '=D2',
  '1_maxPanels': '=J2/MIN(H2,I2)',
  '1_fabricWaste': '=J2-MIN(H2,I2)*INT(J2/MIN(H2,I2))',
  '1_fabricMeters': '=I2/100*2*B2/INT(J2/H2)',
  '1_totalWeight': '=M2*K2*1.5/1000',
  '1_unitGramWeight': '=IF(B2>0,O2/B2*1000,0)',
  '1_printDoubleSide': '=H2*I2*1.1/10000',
  '1_fabricCost': '=S2*M2/B2+CEILING(M2/100,1)*15/B2+0.04',
  '1_freightUnit': '=O2*0.8',
  '1_unitTotalPrice': '=(Q2+R2+U2+T2+W2/B2)*X2+V2',
  '2_cutWidth': '=F3+C3',
  '2_cutHeight': '=D3*2+G3+E3',
  '2_maxPanels': '=J3/MIN(H3,I3)',
  '2_fabricWaste': '=J3-MIN(H3,I3)*INT(J3/MIN(H3,I3))',
  '2_fabricMeters': '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
  '2_totalWeight': '=M3*K3*1.5/1000',
  '2_unitGramWeight': '=IF(B3>0,O3/B3*1000,0)',
  '2_printDoubleSide': '=H3*I3*1.1/10000',
  '2_fabricCost': '=S3*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
  '2_freightUnit': '=O3*0.8',
  '2_unitTotalPrice': '=(Q3+R3+U3+T3+W3/B3)*X3+V3',
}

export default function BagQuoteOnline() {
  const [orderInfo, setOrderInfo] = useState<OrderInfo>(defaultOrderInfo)
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [cellValueOverrides, setCellValueOverrides] = useState<Record<string, number>>({})
  const [tableData, setTableData] = useState(defaultTableData)

  const updateField = (field: keyof OrderInfo, value: string) => {
    setOrderInfo((prev) => ({ ...prev, [field]: value }))
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const newImages = Array.from(files).map(file => URL.createObjectURL(file))
    setUploadedImages((prev) => [...prev, ...newImages])
  }

  const removeImage = (index: number) => {
    setUploadedImages((prev) => {
      const newImages = [...prev]
      URL.revokeObjectURL(newImages[index])
      newImages.splice(index, 1)
      return newImages
    })
  }

  const getCellValue = (rowIndex: number, field: VTableColumnDef): number | null => {
    const cellKey = `${rowIndex}_${field.key}`
    if (cellValueOverrides[cellKey] !== undefined) {
      return cellValueOverrides[cellKey]
    }
    const value = tableData[rowIndex]?.[field.key as keyof typeof tableData[0]]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && !isNaN(parseFloat(value))) return parseFloat(value)
    return null
  }

  const getCellType = (rowIndex: number, field: VTableColumnDef): 'input' | 'formula' | 'readonly' => {
    const cellKey = `${rowIndex}_${field.key}`
    if (cellValueOverrides[cellKey] !== undefined) return 'input'
    
    const row = tableData[rowIndex]
    if (!row) return 'readonly'
    
    if (row.label === '汇总') return 'readonly'
    
    if (row.label === '成品') {
      return 'readonly'
    }
    
    if (field.type === 'formula') return 'formula'
    
    return 'input'
  }

  const getFormulaExpr = (rowIndex: number, field: VTableColumnDef): string | null => {
    const cellKey = `${rowIndex}_${field.key}`
    return FORMULA_EXPRS[cellKey] || null
  }

  const isFormulaOverridden = (_rowIndex: number, _field: VTableColumnDef): boolean => {
    return false
  }

  const onCellChange = (rowIndex: number, field: VTableColumnDef, value: number) => {
    const cellKey = `${rowIndex}_${field.key}`
    setCellValueOverrides((prev) => ({ ...prev, [cellKey]: value }))

    setTableData((prev) => {
      const newData = [...prev]
      if (newData[rowIndex]) {
        newData[rowIndex] = { ...newData[rowIndex], [field.key]: value }
      }
      return newData
    })
  }

  const isHighlightRow = (rowIndex: number): boolean => {
    return tableData[rowIndex]?.label === '成品'
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">报价管理-在线表格</h1>
        <p className="text-sm text-gray-500">订单信息与在线电子表格，字段之间无联动</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <DollarSign size={16} className="text-blue-500" />
          订单信息
        </h3>

        <div className="mb-5">
          <h4 className="text-xs font-medium text-gray-500 mb-3">客户信息</h4>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">客户名称</label>
              <input
                type="text"
                value={orderInfo.customerName}
                onChange={(e) => updateField('customerName', e.target.value)}
                placeholder="请输入客户名称"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">做货日期</label>
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={orderInfo.startDate}
                  onChange={(e) => updateField('startDate', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-400 text-xs">到</span>
                <input
                  type="date"
                  value={orderInfo.endDate}
                  onChange={(e) => updateField('endDate', e.target.value)}
                  placeholder="年/月/日"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="col-span-7">
              <label className="block text-xs font-medium text-gray-500 mb-1">收货地址</label>
              <input
                type="text"
                value={orderInfo.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder="请输入收货地址"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <div className="mb-5">
          <h4 className="text-xs font-medium text-gray-500 mb-3">订单信息</h4>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">数量</label>
              <input
                type="text"
                value={orderInfo.quantity}
                onChange={(e) => updateField('quantity', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">款式</label>
              <input
                type="text"
                value={orderInfo.style}
                onChange={(e) => updateField('style', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50"
              />
            </div>
            <div className="col-span-6">
              <label className="block text-xs font-medium text-gray-500 mb-1">规格(cm)：宽×高×底</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={orderInfo.width}
                  onChange={(e) => updateField('width', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50"
                />
                <span className="text-gray-400">×</span>
                <input
                  type="text"
                  value={orderInfo.height}
                  onChange={(e) => updateField('height', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50"
                />
                <span className="text-gray-400">×</span>
                <input
                  type="text"
                  value={orderInfo.bottom}
                  onChange={(e) => updateField('bottom', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">面料材质</label>
              <input
                type="text"
                value={orderInfo.fabricMaterial}
                onChange={(e) => updateField('fabricMaterial', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50"
              />
            </div>
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">工艺</label>
              <input
                type="text"
                value={orderInfo.craft}
                onChange={(e) => updateField('craft', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50"
              />
            </div>
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">手提材质 / 宽×高 (cm)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={orderInfo.handleMaterial}
                  onChange={(e) => updateField('handleMaterial', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-blue-50"
                />
                <span className="text-gray-400">/</span>
                <input
                  type="text"
                  value={orderInfo.handleWidth}
                  onChange={(e) => updateField('handleWidth', e.target.value)}
                  className="w-16 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="text-gray-400">×</span>
                <input
                  type="text"
                  value={orderInfo.handleHeight}
                  onChange={(e) => updateField('handleHeight', e.target.value)}
                  className="w-16 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">打样费（元）</label>
              <input
                type="number"
                value={orderInfo.sampleFee}
                onChange={(e) => updateField('sampleFee', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">打样天数</label>
              <input
                type="number"
                value={orderInfo.sampleDays}
                onChange={(e) => updateField('sampleDays', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">大货天数</label>
              <input
                type="number"
                value={orderInfo.productionDays}
                onChange={(e) => updateField('productionDays', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="col-span-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">箱规</label>
              <input
                type="text"
                value={orderInfo.boxSpec}
                onChange={(e) => updateField('boxSpec', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="col-span-8">
              <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
              <textarea
                value={orderInfo.remark}
                onChange={(e) => updateField('remark', e.target.value)}
                placeholder="请输入备注信息"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-medium text-gray-500 flex items-center gap-2">
              <ImageIcon size={14} />
              产品图片
            </h4>
            <button
              onClick={() => document.getElementById('image-upload')?.click()}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Upload size={14} />
              上传图片
            </button>
          </div>
          <input
            type="file"
            id="image-upload"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            onChange={handleImageUpload}
            className="hidden"
          />
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 min-h-[120px] flex flex-col items-center justify-center">
            {uploadedImages.length > 0 ? (
              <div className="grid grid-cols-4 gap-3 w-full">
                {uploadedImages.map((src, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={src}
                      alt={`产品图片${index + 1}`}
                      className="w-full aspect-square object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                  <Upload size={20} className="text-gray-400" />
                </div>
                <p className="text-sm text-gray-500">点击或拖拽上传产品图片</p>
                <p className="text-xs text-gray-400 mt-1">支持多选 · JPG / PNG / GIF / WebP</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <VTableWrapper
          title="价格试算表"
          fields={combinedFields}
          rowCount={tableData.length}
          getRowLabel={(i) => tableData[i]?.label || ''}
          isHighlightRow={isHighlightRow}
          getCellValue={getCellValue}
          getCellType={getCellType}
          getFormulaExpr={getFormulaExpr}
          isFormulaOverridden={isFormulaOverridden}
          onCellChange={onCellChange}
          showContextMenu={true}
        />
      </div>
    </div>
  )
}
