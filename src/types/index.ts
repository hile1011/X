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
  status: 1 | 2 | 3 | 4 | 5 | 6 | 7
  quoteTime: string
  sampleTime: string
  sampleCompletedTime: string
  productionStartTime: string
  shippingTime: string
  paymentTime: string
  endTime: string
  images: string[]
  // 在线表格二维数据（用户编辑后的值）。仅新增订单时从模板加载，后续以数据库为准
  tableData?: (string | number | null)[][]
  // 用户已删除的公式地址列表（如 ["J8"]），加载时排除这些公式使 tableData 值生效
  removedFormulaAddresses?: string[]
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
