import type { Customer, Product, Order, OrderItem, Task } from './types'
import {
  mockCustomers,
  mockProducts,
  mockOrders,
  mockOrderItems,
  mockTasks,
} from './mockData'

let customers: Customer[] = [...mockCustomers]
let products: Product[] = [...mockProducts]
let orders: Order[] = [...mockOrders]
let orderItems: OrderItem[] = [...mockOrderItems]
let tasks: Task[] = [...mockTasks]

export const db = {
  customers: {
    getAll: () => Promise.resolve(customers),
    getById: (id: string) => Promise.resolve(customers.find((c) => c.id === id) || null),
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
}
