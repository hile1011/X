import type { Customer, Product, Order, OrderItem, Task, Quote, ProcessCost } from './types'
import {
  mockCustomers,
  mockProducts,
  mockOrders,
  mockOrderItems,
  mockTasks,
  mockQuotes,
  mockProcessCosts,
} from './mockData'

let customers: Customer[] = [...mockCustomers]
let products: Product[] = [...mockProducts]
let orders: Order[] = [...mockOrders]
let orderItems: OrderItem[] = [...mockOrderItems]
let tasks: Task[] = [...mockTasks]
let quotes: Quote[] = [...mockQuotes]
let processCosts: ProcessCost[] = [...mockProcessCosts]

const PRODUCT_STYLE_OPTIONS = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

const getStyleLabel = (value: string): string => {
  const option = PRODUCT_STYLE_OPTIONS.find((opt) => opt.value === value)
  return option ? option.label : value
}

export const db = {
  customers: {
    getAll: () => Promise.resolve(customers),
    getById: (id: string) => Promise.resolve(customers.find((c) => c.id === id) || null),
    getByName: (name: string) => Promise.resolve(customers.find((c) => c.name === name) || null),
    create: (data: Partial<Customer>) => {
      const newCustomer: Customer = {
        id: `cust-${Date.now()}`,
        name: data.name || '',
        contact_person: data.contact_person || '',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        industry: data.industry || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      customers.push(newCustomer)
      return Promise.resolve(newCustomer)
    },
    update: (id: string, data: Partial<Customer>) => {
      const index = customers.findIndex((c) => c.id === id)
      if (index !== -1) {
        customers[index] = { ...customers[index], ...data, updated_at: new Date().toISOString() }
        return Promise.resolve(customers[index])
      }
      return Promise.resolve(null)
    },
    delete: (id: string) => {
      const initialLength = customers.length
      customers = customers.filter((c) => c.id !== id)
      return Promise.resolve(initialLength !== customers.length)
    },
  },
  products: {
    getAll: () => Promise.resolve(products),
    getById: (id: string) => Promise.resolve(products.find((p) => p.id === id) || null),
    create: (data: Partial<Product>) => {
      const newProduct: Product = {
        id: `prod-${Date.now()}`,
        name: data.name || '',
        sku: data.sku || '',
        description: data.description || '',
        price: data.price || 0,
        category: data.category || '',
        stock: data.stock || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      products.push(newProduct)
      return Promise.resolve(newProduct)
    },
    update: (id: string, data: Partial<Product>) => {
      const index = products.findIndex((p) => p.id === id)
      if (index !== -1) {
        products[index] = { ...products[index], ...data, updated_at: new Date().toISOString() }
        return Promise.resolve(products[index])
      }
      return Promise.resolve(null)
    },
    delete: (id: string) => {
      const initialLength = products.length
      products = products.filter((p) => p.id !== id)
      return Promise.resolve(initialLength !== products.length)
    },
  },
  orders: {
    getAll: () => Promise.resolve(orders),
    getById: (id: string) => {
      const order = orders.find((o) => o.id === id)
      const items = orderItems.filter((oi) => oi.order_id === id)
      const customer = customers.find((c) => c.id === order?.customer_id)
      return Promise.resolve(order ? { ...order, items, customer } : null)
    },
    update: (id: string, data: Partial<Order>) => {
      const index = orders.findIndex((o) => o.id === id)
      if (index !== -1) {
        orders[index] = { ...orders[index], ...data, updated_at: new Date().toISOString() }
        return Promise.resolve(orders[index])
      }
      return Promise.resolve(null)
    },
    delete: (id: string) => {
      const initialLength = orders.length
      orders = orders.filter((o) => o.id !== id)
      orderItems = orderItems.filter((oi) => oi.order_id !== id)
      return Promise.resolve(initialLength !== orders.length)
    },
  },
  tasks: {
    getAll: () => Promise.resolve(tasks),
    getById: (id: string) => Promise.resolve(tasks.find((t) => t.id === id) || null),
    create: (data: Partial<Task>) => {
      const newTask: Task = {
        id: `task-${Date.now()}`,
        user_id: data.user_id || '',
        order_id: data.order_id || '',
        title: data.title || '',
        description: data.description || '',
        status: 'pending',
        due_date: data.due_date || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      tasks.push(newTask)
      return Promise.resolve(newTask)
    },
    update: (id: string, data: Partial<Task>) => {
      const index = tasks.findIndex((t) => t.id === id)
      if (index !== -1) {
        tasks[index] = { ...tasks[index], ...data, updated_at: new Date().toISOString() }
        return Promise.resolve(tasks[index])
      }
      return Promise.resolve(null)
    },
    delete: (id: string) => {
      const initialLength = tasks.length
      tasks = tasks.filter((t) => t.id !== id)
      return Promise.resolve(initialLength !== tasks.length)
    },
  },
  quotes: {
    getAll: () => Promise.resolve(quotes),
    getById: (id: string) => Promise.resolve(quotes.find((q) => q.id === id) || null),
    create: (data: Partial<Quote>) => {
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const timestamp = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      const customerName = data.customerName || ''
      const productStyle = data.productStyle || ''
      const quoteNumber = `${customerName}-${timestamp}-${getStyleLabel(productStyle)}`
      const newQuote: Quote = {
        id: `quote-${Date.now()}`,
        user_id: data.user_id || '',
        customer_id: data.customer_id || '',
        quote_number: quoteNumber,
        customerName: customerName,
        shippingAddress: data.shippingAddress || '',
        productStyle: productStyle || '1',
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
        unitPrice: data.unitPrice || '',
        productionTimeStart: data.productionTimeStart || today,
        productionTimeEnd: data.productionTimeEnd || '',
        sellPriceNoTax: data.sellPriceNoTax || 0,
        sellPriceWithTax: data.sellPriceWithTax || 0,
        status: (data.status as Quote['status']) || 1,
        quoteTime: today,
        sampleTime: '',
        productionStartTime: '',
        shippingTime: '',
        paymentTime: '',
        endTime: '',
        images: data.images || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      quotes.push(newQuote)
      return Promise.resolve(newQuote)
    },
    update: (id: string, data: Partial<Quote>) => {
      const index = quotes.findIndex((q) => q.id === id)
      if (index !== -1) {
        const currentQuote = quotes[index]
        let updatedQuote: Quote = {
          ...currentQuote,
          ...data,
          updated_at: new Date().toISOString(),
        }
        
        // 如果客户名称或款式被修改，重新生成订单号
        if (data.customerName !== undefined || data.productStyle !== undefined) {
          const customerName = data.customerName !== undefined ? data.customerName : currentQuote.customerName
          const productStyle = data.productStyle !== undefined ? data.productStyle : currentQuote.productStyle
          
          // 从原订单号中提取14位时间戳（格式：YYYYMMDDHHMMSS）
          const timestampMatch = currentQuote.quote_number.match(/\d{14}/)
          const timestamp = timestampMatch ? timestampMatch[0] : ''
          
          updatedQuote.quote_number = `${customerName}-${timestamp}-${getStyleLabel(productStyle)}`
        }
        
        if (data.images !== undefined) {
          updatedQuote.images = data.images
        }
        quotes[index] = updatedQuote
        return Promise.resolve(quotes[index])
      }
      return Promise.resolve(null)
    },
    nextStatus: (id: string) => {
      const index = quotes.findIndex((q) => q.id === id)
      if (index === -1) return Promise.resolve(null)
      const quote = quotes[index]
      const today = new Date().toISOString().split('T')[0]
      let newStatus = quote.status
      const timeUpdates: Partial<Quote> = {}
      
      switch (quote.status) {
        case 1: // 报价中 -> 打样中
          newStatus = 2
          timeUpdates.sampleTime = today
          break
        case 2: // 打样中 -> 做货中
          newStatus = 3
          timeUpdates.productionStartTime = today
          break
        case 3: // 做货中 -> 已发货未收款
          newStatus = 4
          timeUpdates.shippingTime = today
          break
        case 4: // 已发货未收款 -> 已发货已收款
          newStatus = 5
          timeUpdates.paymentTime = today
          break
        case 5: // 已发货已收款 -> 结束
          newStatus = 6
          timeUpdates.endTime = today
          break
        case 6: // 结束状态不能继续流转
          return Promise.resolve(quote)
      }
      
      quotes[index] = {
        ...quote,
        status: newStatus,
        ...timeUpdates,
        updated_at: new Date().toISOString(),
      }
      return Promise.resolve(quotes[index])
    },
    prevStatus: (id: string) => {
      const index = quotes.findIndex((q) => q.id === id)
      if (index === -1) return Promise.resolve(null)
      const quote = quotes[index]
      let newStatus = quote.status
      
      switch (quote.status) {
        case 2: // 打样中 -> 报价中
          newStatus = 1
          break
        case 3: // 做货中 -> 打样中
          newStatus = 2
          break
        case 4: // 已发货未收款 -> 做货中
          newStatus = 3
          break
        case 5: // 已发货已收款 -> 已发货未收款
          newStatus = 4
          break
        case 6: // 结束 -> 已发货已收款（支持从结束状态退回）
          newStatus = 5
          break
        case 1: // 报价中不能退回
          return Promise.resolve(quote)
        default:
          return Promise.resolve(quote)
      }
      
      quotes[index] = {
        ...quote,
        status: newStatus,
        updated_at: new Date().toISOString(),
      }
      return Promise.resolve(quotes[index])
    },
    endQuote: (id: string) => {
      const index = quotes.findIndex((q) => q.id === id)
      if (index === -1) return Promise.resolve(null)
      const quote = quotes[index]
      // 只有报价中和打样中可以直接结束
      if (quote.status !== 1 && quote.status !== 2) {
        return Promise.resolve(quote)
      }
      const today = new Date().toISOString().split('T')[0]
      quotes[index] = {
        ...quote,
        status: 6,
        endTime: today,
        updated_at: new Date().toISOString(),
      }
      return Promise.resolve(quotes[index])
    },
    delete: (id: string) => {
      const initialLength = quotes.length
      quotes = quotes.filter((q) => q.id !== id)
      return Promise.resolve(initialLength !== quotes.length)
    },
  },
  processCosts: {
    getAll: () => Promise.resolve(processCosts),
    getById: (id: string) => Promise.resolve(processCosts.find((p) => p.id === id) || null),
    create: (data: Partial<ProcessCost>) => {
      const newProcessCost: ProcessCost = {
        id: `pc-${Date.now()}`,
        name: data.name || '',
        cost: data.cost || 0,
        formula: data.formula || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      processCosts.push(newProcessCost)
      return Promise.resolve(newProcessCost)
    },
    update: (id: string, data: Partial<ProcessCost>) => {
      const index = processCosts.findIndex((p) => p.id === id)
      if (index !== -1) {
        processCosts[index] = { ...processCosts[index], ...data, updated_at: new Date().toISOString() }
        return Promise.resolve(processCosts[index])
      }
      return Promise.resolve(null)
    },
    delete: (id: string) => {
      const initialLength = processCosts.length
      processCosts = processCosts.filter((p) => p.id !== id)
      return Promise.resolve(initialLength !== processCosts.length)
    },
  },
}
