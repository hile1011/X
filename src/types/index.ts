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
