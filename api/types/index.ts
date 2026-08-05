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
  customer_id: string
  quote_number: string
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
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  costPrice: number
  priceWithTax: number
  sellPriceNoTax: number
  sellPriceWithTax: number
  status: 1 | 2 | 3 | 4 | 5 | 6
  // 状态流转时间节点
  quoteTime: string
  sampleTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
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

export interface ProcessCost {
  id: string
  name: string
  cost: number
  formula: string
  created_at: string
  updated_at: string
}
