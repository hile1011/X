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

export interface Task {
  id: string
  user_id: string
  order_id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  due_date: string
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
  /** 打样费是否抵扣大货（数据库存 TINYINT 0/1） */
  sampleFeeDeduct: boolean
  /** 收取定金 */
  deposit: number
  /** 待收总金额 = 销售总额(不含税) - (抵扣时的打样费) - 定金 */
  pendingAmount: number
  status: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  // 状态流转时间节点
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
  // 在线表格二维数据（用户编辑后的值），JSON 字符串存储。仅新增时从模板加载，后续以数据库为准
  tableData: (string | number | null)[][]
  // 用户已删除的公式地址列表 JSON 字符串，如 ["J8"]
  removedFormulaAddresses: string[]
  // 用户修改过的公式内容 JSON 字符串，如 {"J8":"=SUM(J6:J7)*1.1"}，加载时覆盖模板原公式
  modifiedFormulas: Record<string, string>
  // 表格中所有单元格的公式（地址→公式字符串），加载时直接使用，不依赖模板比对
  // 新数据优先使用此字段；老数据（v9 前）为空 {} 时回退到 removedFormulaAddresses + modifiedFormulas 合并逻辑
  allFormulas: Record<string, string>
  // 做货流程各步骤的状态（步骤id→状态），状态值：pending | in_progress | completed
  // 仅在做货中(status=3)状态下使用，记录用户对生产流程步骤的勾选进度
  productionStepStatus: Record<number, 'pending' | 'in_progress' | 'completed'>
  created_at: string
  updated_at: string
}

/** 自定义字段类型（v31：产品成本项配置） */
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
  /** 自定义字段值（字段id→值），仅保留仍存在字段的键 */
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

/** 产品图册媒体记录（v32：图片/视频，原图存储不压缩） */
export interface ProductMedia {
  id: string
  product_id: string
  /** 媒体类型：image / video */
  media_type: 'image' | 'video'
  /** 原始文件名（上传时的名称） */
  file_name: string
  /** 存储相对路径（相对 api/uploads/，如 products/xxx.jpg） */
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
