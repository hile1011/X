export interface User {
  id: string
  email: string
  name: string
  role: string
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  name: string
  contact_person: string
  phone: string
  email: string
  address: string
  industry: string
  tags: string
  remark: string
  created_at: string
  updated_at: string
}

export interface Product {
  id: string
  name: string
  sku: string
  code: string
  description: string
  price: number
  category: string
  stock: number
  created_at: string
  updated_at: string
  /** 图册第一张图片（列表接口附带，无图片时为 null） */
  firstImage?: {
    id: string
    media_type: string
    file_name: string
  } | null
}

/** 产品图册媒体记录（v32：图片/视频，原图存储不压缩） */
export interface ProductMedia {
  id: string
  product_id: string
  /** 媒体类型：image / video */
  media_type: 'image' | 'video'
  /** 原始文件名（上传时的名称） */
  file_name: string
  /** 存储相对路径（相对 api/uploads/） */
  file_path: string
  /** 文件大小（字节） */
  file_size: number
  /** MIME 类型 */
  mime_type: string
  /** 排序（小在前：上传顺序或自定义重排后的顺序） */
  sort_order: number
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity: number
  unit_price: number
  amount: number
}

export interface Order {
  id: string
  user_id: string
  customer_id: string
  quote_id: string
  order_number: string
  status: 'pending' | 'processing' | 'shipped' | 'completed' | 'cancelled'
  total_amount: number
  remarks: string
  created_at: string
  updated_at: string
}

export interface OrderWithDetails extends Order {
  customer?: Customer
  items?: OrderItem[]
}

export interface Quote {
  id: string
  user_id: string
  created_by: string
  updated_by: string
  customer_id: string
  quote_number: string
  customerName: string
  shippingAddress: string
  productStyle: string
  /** 使用的款式模板 id（v23 一对多；空 = 内置默认模板） */
  templateId?: string
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
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  costPrice: number
  priceWithTax: number
  sellPriceNoTax: number
  sellPriceWithTax: number
  // 收款相关（V17 新增）
  /** 应收打样费（V18 新增） */
  receivableSampleFee: number
  /** 实际收取打样费 */
  actualSampleFee: number
  /** 打样费是否抵扣大货 */
  sampleFeeDeduct: boolean
  /** 收取定金 */
  deposit: number
  /** 待收总金额 = 销售总额(不含税) - (抵扣时的打样费) - 定金 */
  pendingAmount: number
  status: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  /** 批次号（v36，PN-YYYYMMDDHHmmss 秒级时间戳；同批次订单共享，列表多选统一设置，创建/复制不携带） */
  batchNumber?: string | null
  quoteTime: string
  sampleTime: string
  sampleCompletedTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
  /** 对账时间（V28 新增，状态8已对账） */
  reconciledTime?: string
  endTime: string
  images: string[]
  // 在线表格二维数据（用户编辑后的值）。仅新增订单时从模板加载，后续以数据库为准
  tableData?: (string | number | null)[][]
  // 用户已删除的公式地址列表（如 ["J8"]），加载时排除这些公式使 tableData 值生效
  removedFormulaAddresses?: string[]
  // 在线表格列宽配置（v34：[{key:列号,width:px}]，仅用户拖拽调整过的列；重新打开时恢复布局）
  columnWidthConfig?: Array<{ key: number; width: number }>
  // 在线表格行高配置（v34：[{key:行号,height:px}]，仅用户拖拽调整过的行；重新打开时恢复布局）
  rowHeightConfig?: Array<{ key: number; height: number }>
  created_at: string
  updated_at: string
}

/** 自定义字段类型（产品成本项配置） */
export type ProductCostFieldType = 'text' | 'number' | 'date' | 'select'

/** 产品成本项-自定义字段定义（挂成本项，对其下所有可选工艺生效） */
export interface ProductCostCustomField {
  id: string
  costItemId: string
  /** 字段显示名 */
  name: string
  fieldType: ProductCostFieldType
  /** select 类型的下拉选项 */
  options: string[]
  /** 是否显示（false=隐藏：列表与编辑均不渲染，已录值保留在 customValues 中） */
  visible: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 产品成本项-可选工艺（多对一关联成本项） */
export interface ProductCostProcess {
  id: string
  costItemId: string
  /** 工艺名称 */
  name: string
  /** 工艺成本金额 */
  cost: number
  /** 成本计算公式 */
  formula: string
  /** 工艺特点描述 */
  features: string
  /** 工艺备注 */
  remark: string
  /** 自定义字段值（字段id→值） */
  customValues: Record<string, string>
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 产品成本项（父级，含其下可选工艺与自定义字段配置） */
export interface ProductCostItem {
  id: string
  name: string
  sortOrder: number
  processes: ProductCostProcess[]
  fields: ProductCostCustomField[]
  createdAt: string
  updatedAt: string
}

// ============================================================
// AI 智能下单（v35：ai-order 模块）
// ============================================================

/** AI 提取的订单草稿（字段与 BagQuote OrderInfo 对齐，均为字符串） */
export interface AiOrderDraft {
  customerName: string
  /** 产品款式 code（后端已将 AI 输出的款式名称映射为 code） */
  productStyle: string
  /** 规格尺寸，如 40*35*10cm */
  productSpec: string
  /** 布料材质（优先产品成本项配置标准名称） */
  fabricMaterial: string
  /** 印刷工艺（标准名称，多个用 + 拼接） */
  process: string
  /** 提手材质/方式 */
  handleMaterial: string
  /** 提带规格 */
  handleSpec: string
  /** 数量（纯数字字符串） */
  quantity: string
  /** 装箱规格 */
  boxSpec: string
  /** 单价 */
  unitPrice: string
  /** 打样费 */
  sampleFee: string
  /** 备注 */
  remark: string
  /** 在线表格单元格填充（行标签+列名定位，AI 直接生成细粒度表格输入值） */
  tableCells: AiTableCell[]
}

/** AI 输出的表格单元格：row=行标签（成品/正反面/手提…），col=列名关键字（数量/宽/克重/布料价格…） */
export interface AiTableCell {
  row: string
  col: string
  value: string | number
}

/** AI 分析的标准配置匹配结果（后端基于产品成本项配置二次校验） */
export interface AiOrderDraftMeta {
  /** 草稿中命中标准配置的字段名列表 */
  matchedFields: string[]
  /** 非标准字段明细（黄色警示标识，允许人工干预调整） */
  nonStandard: Array<{ field: string; value: string; reason: string }>
  /** 尚未提取到的关键字段中文名 */
  missingFields: string[]
  /** 标准选项池（供前端下拉建议） */
  standardOptions: {
    /** 产品成本项配置（成本项→可选工艺），按成本项分组 */
    costItems: Array<{ name: string; processes: string[] }>
    /** 款式选项（value=code，label=名称） */
    styles: Array<{ value: string; label: string }>
  }
}

/** POST /api/ai-order/analyze 请求 */
export interface AiOrderAnalyzeRequest {
  /** 本轮文字描述 */
  message: string
  /** 参考图片（base64 dataURL，最多 4 张） */
  images: string[]
  /** 对话历史（最近若干轮，服务端裁剪） */
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** POST /api/ai-order/analyze 响应 */
export interface AiOrderAnalyzeResponse {
  /** AI 的自然语言回复 */
  reply: string
  /** 订单草稿（本轮无有效草稿时为 null） */
  draft: AiOrderDraft | null
  /** AI 置信度 0-1 */
  confidence: number
  /** 标准匹配结果 */
  draftMeta: AiOrderDraftMeta
}

