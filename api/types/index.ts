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
