import { pool, initDatabase, withTransaction, closePool, execMultiStatement } from './dbClient.js'
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from './migrations/index.js'
import type { Customer, Product, Order, OrderItem, Task, Quote, ProcessCost } from './types/index.js'

/**
 * 异步数据库包装器
 *
 * 使用 mysql2 连接池实现，提供 exec/prepare/transaction/close 接口。
 * 所有方法返回 Promise。事务通过 withTransaction 实现，使用独占连接保证原子性。
 */
interface WrappedDatabase {
  exec(sql: string): Promise<void>
  prepare(sql: string): {
    run(...params: any[]): Promise<{ changes: number }>
    get(...params: any[]): Promise<Record<string, any> | null>
    all(...params: any[]): Promise<Record<string, any>[]>
  }
  transaction<T>(fn: () => Promise<T>): () => Promise<T>
  close(): Promise<void>
}

function createWrapper(): WrappedDatabase {
  const wrapper: WrappedDatabase = {
    async exec(sql: string) {
      await execMultiStatement(sql)
    },
    prepare(sql: string) {
      const sanitize = (params: any[]) => params.map(p => (p === undefined ? null : p))
      return {
        async run(...params: any[]) {
          const [result] = await pool.execute(sql, sanitize(params))
          return { changes: (result as any).affectedRows || 0 }
        },
        async get(...params: any[]) {
          const [rows] = await pool.execute(sql, sanitize(params))
          return (rows as any[])[0] || null
        },
        async all(...params: any[]) {
          const [rows] = await pool.execute(sql, sanitize(params))
          return rows as Record<string, any>[]
        },
      }
    },
    transaction<T>(fn: () => Promise<T>): () => Promise<T> {
      return () => withTransaction(async () => fn())
    },
    async close() {
      await closePool()
    },
  }
  return wrapper
}

// 启动时初始化数据库并运行迁移
await initDatabase()

const dbConn = createWrapper()
const runner = new MigrationRunner(dbConn)
const currentVersion = await runner.getCurrentVersion()

if (currentVersion < CURRENT_SCHEMA_VERSION) {
  console.log(`[DB] Schema version ${currentVersion} -> ${CURRENT_SCHEMA_VERSION}, running migrations...`)
  const result = await runner.migrate()
  result.applied.forEach((m) => console.log(`[DB]   Applied: ${m}`))
  if (result.skipped.length > 0) {
    result.skipped.forEach((m) => console.log(`[DB]   Skipped: ${m}`))
  }
  console.log(`[DB] Schema migrated to v${await runner.getCurrentVersion()}`)
} else {
  console.log(`[DB] Schema at latest version v${currentVersion}`)
}

const PRODUCT_STYLE_OPTIONS = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

// 6 个默认款式产品的 id（迁移脚本 v7 插入，不可删除）
export const DEFAULT_STYLE_PRODUCT_IDS = ['style-1', 'style-2', 'style-3', 'style-4', 'style-5', 'style-6']

/** 判断产品是否为默认款式（默认款式不可删除） */
export function isDefaultStyleProduct(id: string): boolean {
  return DEFAULT_STYLE_PRODUCT_IDS.includes(id)
}

const getStyleLabel = async (value: string): Promise<string> => {
  const row = await dbConn.prepare('SELECT name FROM products WHERE code = ? OR id = ?').get(value, value) as { name?: string } | undefined
  if (row?.name) return row.name
  const option = PRODUCT_STYLE_OPTIONS.find((opt) => opt.value === value)
  return option ? option.label : value
}

const timeNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

function toCamelRow(row: Record<string, any>): any {
  const result: Record<string, any> = {}
  for (const key of Object.keys(row)) {
    result[key] = row[key]
  }
  return result
}

/** 解析大字段的 JSON */
function parseLargeFields(row: any) {
  const c = toCamelRow(row)
  const parse = (val: string, defaultVal: any) => typeof val === 'string' ? JSON.parse(val || (defaultVal === '[]' ? '[]' : '{}')) : (val || defaultVal === '[]' ? [] : {})
  ;(c as any).images = parse(c.images, '[]')
  ;(c as any).tableData = parse(c.tableData, '[]')
  ;(c as any).removedFormulaAddresses = parse((c as any).removedFormulaAddresses, '[]')
  ;(c as any).modifiedFormulas = parse((c as any).modifiedFormulas, '{}')
  ;(c as any).allFormulas = parse((c as any).allFormulas, '{}')
  ;(c as any).productionStepStatus = parse((c as any).productionStepStatus, '{}')
  return c
}

export const dbApi = {
  db: dbConn,
  runner,

  async getSchemaVersion(): Promise<number> {
    return runner.getCurrentVersion()
  },

  customers: {
    getAll: async () => {
      const rows = await dbConn.prepare('SELECT * FROM customers ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Customer[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as Customer) : null
    },
    getByName: async (name: string) => {
      const row = await dbConn.prepare('SELECT * FROM customers WHERE name = ?').get(name)
      return row ? (toCamelRow(row) as Customer) : null
    },
    create: async (data: Partial<Customer>) => {
      const id = `cust-${Date.now()}`
      await dbConn.prepare(`INSERT INTO customers (id, name, contact_person, phone, email, address, industry)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.name || '', data.contact_person || '', data.phone || '',
        data.email || '', data.address || '', data.industry || ''
      )
      const row = await dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      return row as Customer
    },
    update: async (id: string, data: Partial<Customer>) => {
      const existing = await dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      await dbConn.prepare(`UPDATE customers SET name=?, contact_person=?, phone=?, email=?, address=?, industry=?, updated_at=?
        WHERE id=?`).run(row.name, row.contact_person, row.phone, row.email, row.address, row.industry, row.updated_at, id)
      return row as Customer
    },
    delete: async (id: string) => {
      const info = await dbConn.prepare('DELETE FROM customers WHERE id = ?').run(id)
      return info.changes > 0
    },
  },

  products: {
    getAll: async () => {
      const rows = await dbConn.prepare('SELECT * FROM products ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Product[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM products WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as Product) : null
    },
    create: async (data: Partial<Product>) => {
      const id = `prod-${Date.now()}`
      await dbConn.prepare(`INSERT INTO products (id, name, sku, code, description, price, category, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.name || '', data.sku || '', data.code ?? '', data.description || '',
        data.price || 0, data.category || '', data.stock || 0
      )
      const row = await dbConn.prepare('SELECT * FROM products WHERE id = ?').get(id)
      return row as Product
    },
    update: async (id: string, data: Partial<Product>) => {
      const existing = await dbConn.prepare('SELECT * FROM products WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      await dbConn.prepare(`UPDATE products SET name=?, sku=?, code=?, description=?, price=?, category=?, stock=?, updated_at=?
        WHERE id=?`).run(row.name, row.sku, row.code ?? '', row.description, row.price, row.category, row.stock, row.updated_at, id)
      return row as Product
    },
    delete: async (id: string) => {
      const info = await dbConn.prepare('DELETE FROM products WHERE id = ?').run(id)
      return info.changes > 0
    },
  },

  orders: {
    getAll: async () => {
      const rows = await dbConn.prepare('SELECT * FROM orders ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Order[]
    },
    getById: async (id: string) => {
      const order = await dbConn.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | null
      if (!order) return null
      const items = await dbConn.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as OrderItem[]
      const customer = await dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as Customer | null
      return { ...(toCamelRow(order) as Order), items, customer }
    },
    update: async (id: string, data: Partial<Order>) => {
      const existing = await dbConn.prepare('SELECT * FROM orders WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      await dbConn.prepare(`UPDATE orders SET user_id=?, customer_id=?, quote_id=?, order_number=?, status=?, total_amount=?, remarks=?, updated_at=?
        WHERE id=?`).run(
        row.user_id, row.customer_id, row.quote_id, row.order_number, row.status,
        row.total_amount, row.remarks, row.updated_at, id
      )
      return row as Order
    },
    delete: async (id: string) => {
      const info = await dbConn.prepare('DELETE FROM orders WHERE id = ?').run(id)
      await dbConn.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)
      return info.changes > 0
    },
  },

  tasks: {
    getAll: async () => {
      const rows = await dbConn.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Task[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as Task) : null
    },
    create: async (data: Partial<Task>) => {
      const id = `task-${Date.now()}`
      await dbConn.prepare(`INSERT INTO tasks (id, user_id, order_id, title, description, status, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.user_id || '', data.order_id || '', data.title || '',
        data.description || '', data.status || 'pending', data.due_date || ''
      )
      const row = await dbConn.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
      return row as Task
    },
    update: async (id: string, data: Partial<Task>) => {
      const existing = await dbConn.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      await dbConn.prepare(`UPDATE tasks SET user_id=?, order_id=?, title=?, description=?, status=?, due_date=?, updated_at=?
        WHERE id=?`).run(row.user_id, row.order_id, row.title, row.description, row.status, row.due_date, row.updated_at, id)
      return row as Task
    },
    delete: async (id: string) => {
      const info = await dbConn.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      return info.changes > 0
    },
  },

  quotes: {
    /** 列表查询：只查基本字段，不加载 longtext 大字段（images 通过 thumbnails API 单独获取） */
    getAll: async () => {
      const rows = await dbConn.prepare(`SELECT id, user_id, customer_id, quote_number, customerName, shippingAddress,
        productStyle, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax, status, quoteTime, sampleTime,
        sampleCompletedTime, productionStartTime, shippingTime, paymentTime, endTime, created_at, updated_at
        FROM quotes ORDER BY CASE status WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 7 THEN 3 WHEN 3 THEN 4 WHEN 4 THEN 5 WHEN 5 THEN 6 WHEN 6 THEN 7 ELSE 99 END ASC, updated_at DESC, customerName ASC`).all()
      return rows.map((r) => toCamelRow(r)) as Quote[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id)
      if (!row) return null
      return parseLargeFields(row) as Quote
    },
    create: async (data: Partial<Quote>) => {
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const timestamp = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      const customerName = data.customerName || ''
      const productStyle = data.productStyle || '1'
      const styleLabel = await getStyleLabel(productStyle)
      const quoteNumber = `${customerName}-${styleLabel}-${timestamp}`
      const id = `quote-${Date.now()}`

      await dbConn.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, shippingAddress,
        productStyle, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax, status, quoteTime, sampleTime, sampleCompletedTime, productionStartTime,
        shippingTime, paymentTime, endTime, images, tableData, removedFormulaAddresses, modifiedFormulas, allFormulas, productionStepStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.user_id || '', data.customer_id || '', quoteNumber, customerName,
        data.shippingAddress || '', productStyle, data.productSpec || '',
        data.fabricMaterial || '10安涤棉新本色', data.process || '单面数码uv印刷+口头2.5cm',
        data.handleMaterial || '帆布手提', data.handleSpec || '',
        data.quantity || '', data.boxSpec || '', data.remark || '',
        data.sampleFee || '', data.sampleDays || '', data.massDays || '',
        data.unitPrice || '', data.productionTimeStart || today, data.productionTimeEnd || '',
        data.costPrice || 0, data.priceWithTax || 0, data.sellPriceNoTax || 0, data.sellPriceWithTax || 0,
        data.status || 1, today, '', '', '', '', '', '',
        JSON.stringify(data.images || []),
        JSON.stringify(data.tableData || []),
        JSON.stringify(data.removedFormulaAddresses || []),
        JSON.stringify(data.modifiedFormulas || {}),
        JSON.stringify(data.allFormulas || {}),
        JSON.stringify(data.productionStepStatus || {})
      )

      return {
        id, quote_number: quoteNumber, customerName,
        customer_id: data.customer_id || '', user_id: data.user_id || '',
        shippingAddress: data.shippingAddress || '', productStyle,
        productSpec: data.productSpec || '',
        fabricMaterial: data.fabricMaterial || '10安涤棉新本色',
        process: data.process || '单面数码uv印刷+口头2.5cm',
        handleMaterial: data.handleMaterial || '帆布手提',
        handleSpec: data.handleSpec || '',
        quantity: data.quantity || '', boxSpec: data.boxSpec || '',
        remark: data.remark || '', sampleFee: data.sampleFee || '',
        sampleDays: data.sampleDays || '', massDays: data.massDays || '',
        unitPrice: data.unitPrice || '',
        productionTimeStart: data.productionTimeStart || today,
        productionTimeEnd: data.productionTimeEnd || '',
        costPrice: data.costPrice || 0,
        priceWithTax: data.priceWithTax || 0,
        sellPriceNoTax: data.sellPriceNoTax || 0,
        sellPriceWithTax: data.sellPriceWithTax || 0,
        status: data.status || 1, quoteTime: today,
        sampleTime: '', sampleCompletedTime: '', productionStartTime: '',
        shippingTime: '', paymentTime: '', endTime: '',
        images: data.images || [],
        tableData: data.tableData || [],
        removedFormulaAddresses: data.removedFormulaAddresses || [],
        modifiedFormulas: data.modifiedFormulas || {},
        allFormulas: data.allFormulas || {},
        productionStepStatus: data.productionStepStatus || {},
        created_at: timeNow(), updated_at: timeNow(),
      }
    },
    update: async (id: string, data: Partial<Quote>) => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      const existingParsed = toCamelRow(existing) as Quote
      existingParsed.images = typeof (existingParsed as any).images === 'string' ? JSON.parse((existingParsed as any).images || '[]') : (existingParsed.images || [])
      existingParsed.tableData = typeof (existingParsed as any).tableData === 'string' ? JSON.parse((existingParsed as any).tableData || '[]') : (existingParsed.tableData || [])
      existingParsed.removedFormulaAddresses = typeof (existingParsed as any).removedFormulaAddresses === 'string' ? JSON.parse((existingParsed as any).removedFormulaAddresses || '[]') : ((existingParsed as any).removedFormulaAddresses || [])
      existingParsed.modifiedFormulas = typeof (existingParsed as any).modifiedFormulas === 'string' ? JSON.parse((existingParsed as any).modifiedFormulas || '{}') : ((existingParsed as any).modifiedFormulas || {})
      existingParsed.allFormulas = typeof (existingParsed as any).allFormulas === 'string' ? JSON.parse((existingParsed as any).allFormulas || '{}') : ((existingParsed as any).allFormulas || {})
      existingParsed.productionStepStatus = typeof (existingParsed as any).productionStepStatus === 'string' ? JSON.parse((existingParsed as any).productionStepStatus || '{}') : ((existingParsed as any).productionStepStatus || {})
      let updatedQuote: Quote = { ...existingParsed, ...data, updated_at: timeNow() }

      if (data.customerName !== undefined || data.productStyle !== undefined) {
        const customerName = data.customerName !== undefined ? data.customerName : existing.customerName
        const productStyle = data.productStyle !== undefined ? data.productStyle : existing.productStyle
        const styleLabel = await getStyleLabel(productStyle)
        const timestampMatch = existing.quote_number.match(/\d{14}/)
        const timestamp = timestampMatch ? timestampMatch[0] : ''
        updatedQuote.quote_number = `${customerName}-${styleLabel}-${timestamp}`
      }

      if (data.images !== undefined) {
        updatedQuote.images = data.images
      }
      const tableDataJson = JSON.stringify(updatedQuote.tableData || [])
      const removedFormulaAddressesJson = JSON.stringify(updatedQuote.removedFormulaAddresses || [])
      const modifiedFormulasJson = JSON.stringify(updatedQuote.modifiedFormulas || {})
      const allFormulasJson = JSON.stringify(updatedQuote.allFormulas || {})
      const productionStepStatusJson = JSON.stringify(updatedQuote.productionStepStatus || {})

      await dbConn.prepare(`UPDATE quotes SET customerName=?, quote_number=?, customer_id=?, user_id=?, shippingAddress=?,
        productStyle=?, productSpec=?, fabricMaterial=?, process=?, handleMaterial=?, handleSpec=?,
        quantity=?, boxSpec=?, remark=?, sampleFee=?, sampleDays=?, massDays=?, unitPrice=?,
        productionTimeStart=?, productionTimeEnd=?, costPrice=?, priceWithTax=?, sellPriceNoTax=?, sellPriceWithTax=?,
        status=?, sampleTime=?, sampleCompletedTime=?, productionStartTime=?, shippingTime=?, paymentTime=?, endTime=?,
        images=?, tableData=?, removedFormulaAddresses=?, modifiedFormulas=?, allFormulas=?, productionStepStatus=?, updated_at=? WHERE id=?`).run(
        updatedQuote.customerName, updatedQuote.quote_number, updatedQuote.customer_id, updatedQuote.user_id,
        updatedQuote.shippingAddress, updatedQuote.productStyle, updatedQuote.productSpec,
        updatedQuote.fabricMaterial, updatedQuote.process, updatedQuote.handleMaterial, updatedQuote.handleSpec,
        updatedQuote.quantity, updatedQuote.boxSpec, updatedQuote.remark,
        updatedQuote.sampleFee, updatedQuote.sampleDays, updatedQuote.massDays, updatedQuote.unitPrice,
        updatedQuote.productionTimeStart, updatedQuote.productionTimeEnd,
        updatedQuote.costPrice, updatedQuote.priceWithTax, updatedQuote.sellPriceNoTax, updatedQuote.sellPriceWithTax,
        updatedQuote.status, updatedQuote.sampleTime, updatedQuote.sampleCompletedTime, updatedQuote.productionStartTime,
        updatedQuote.shippingTime, updatedQuote.paymentTime, updatedQuote.endTime,
        JSON.stringify(updatedQuote.images || []), tableDataJson, removedFormulaAddressesJson, modifiedFormulasJson, allFormulasJson, productionStepStatusJson, updatedQuote.updated_at, id
      )
      return updatedQuote
    },
    nextStatus: async (id: string) => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      const today = new Date().toISOString().split('T')[0]
      let newStatus = existing.status
      const updates: Partial<Quote> = {}

      switch (existing.status) {
        case 1: newStatus = 2; updates.sampleTime = today; break
        case 2: newStatus = 7; updates.sampleCompletedTime = today; break
        case 7: newStatus = 3; updates.productionStartTime = today; break
        case 3: newStatus = 4; updates.shippingTime = today; break
        case 4: newStatus = 5; updates.paymentTime = today; break
        case 5: newStatus = 6; updates.endTime = today; break
        case 6: return toCamelRow(existing) as Quote
      }

      const updated = { ...(toCamelRow(existing) as Quote), status: newStatus, ...updates, updated_at: timeNow() }
      await dbConn.prepare(`UPDATE quotes SET status=?, sampleTime=?, sampleCompletedTime=?, productionStartTime=?, shippingTime=?, paymentTime=?, endTime=?, updated_at=? WHERE id=?`).run(
        newStatus,
        updates.sampleTime || existing.sampleTime,
        updates.sampleCompletedTime || (existing as any).sampleCompletedTime || '',
        updates.productionStartTime || existing.productionStartTime,
        updates.shippingTime || existing.shippingTime,
        updates.paymentTime || existing.paymentTime,
        updates.endTime || existing.endTime,
        updated.updated_at, id
      )
      return updated
    },
    prevStatus: async (id: string) => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      let newStatus = existing.status
      switch (existing.status) {
        case 2: newStatus = 1; break
        case 7: newStatus = 2; break
        case 3: newStatus = 7; break
        case 4: newStatus = 3; break
        case 5: newStatus = 4; break
        case 6: newStatus = 5; break
        case 1: return toCamelRow(existing) as Quote
      }
      const updated = { ...(toCamelRow(existing) as Quote), status: newStatus, updated_at: timeNow() }
      await dbConn.prepare('UPDATE quotes SET status=?, updated_at=? WHERE id=?').run(newStatus, updated.updated_at, id)
      return updated
    },
    endQuote: async (id: string) => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      if (existing.status !== 1 && existing.status !== 2 && existing.status !== 7) return toCamelRow(existing) as Quote
      const today = new Date().toISOString().split('T')[0]
      const updated = { ...(toCamelRow(existing) as Quote), status: 6, endTime: today, updated_at: timeNow() }
      await dbConn.prepare('UPDATE quotes SET status=?, endTime=?, updated_at=? WHERE id=?').run(6, today, updated.updated_at, id)
      return updated
    },
    delete: async (id: string) => {
      const info = await dbConn.prepare('DELETE FROM quotes WHERE id = ?').run(id)
      return info.changes > 0
    },
    /** 获取所有订单的图片数量（用于列表显示图片图标，不加载大字段） */
    getAllImageFlags: async () => {
      const rows = await dbConn.prepare(`SELECT id, CASE WHEN images IS NOT NULL AND images != '[]' AND images != '' THEN 1 ELSE 0 END as has_images FROM quotes`).all()
      const map: Record<string, boolean> = {}
      for (const r of rows) {
        map[r.id] = !!r.has_images
      }
      return map
    },
    /** 获取单个订单的第一张图片（base64），用于生成缩略图 */
    getFirstImage: async (id: string) => {
      const row = await dbConn.prepare('SELECT images FROM quotes WHERE id = ?').get(id)
      if (!row) return null
      try {
        const images = typeof row.images === 'string' ? JSON.parse(row.images || '[]') : (row.images || [])
        return (images as string[])[0] || null
      } catch {
        return null
      }
    },
    copy: async (id: string) => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id)
      if (!existing) return null

      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const timestamp = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      const customerName = existing.customerName || ''
      const productStyle = existing.productStyle || '1'
      const styleLabel = await getStyleLabel(productStyle)
      const quoteNumber = `${customerName}-${styleLabel}-${timestamp}`
      const newId = `quote-${Date.now()}`

      await dbConn.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, shippingAddress,
        productStyle, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax, status, quoteTime, sampleTime, sampleCompletedTime, productionStartTime,
        shippingTime, paymentTime, endTime, images, tableData, removedFormulaAddresses, modifiedFormulas, allFormulas, productionStepStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        newId, existing.user_id || '', existing.customer_id || '', quoteNumber, customerName,
        existing.shippingAddress || '', productStyle, existing.productSpec || '',
        existing.fabricMaterial || '10安涤棉新本色', existing.process || '单面数码uv印刷+口头2.5cm',
        existing.handleMaterial || '帆布手提', existing.handleSpec || '',
        existing.quantity || '', existing.boxSpec || '', existing.remark || '',
        existing.sampleFee || '', existing.sampleDays || '', existing.massDays || '',
        existing.unitPrice || '', today, '',
        existing.costPrice || 0, existing.priceWithTax || 0, existing.sellPriceNoTax || 0, existing.sellPriceWithTax || 0,
        1, today, '', '', '', '', '', '',
        existing.images || '[]',
        existing.tableData || '[]',
        existing.removedFormulaAddresses || '[]',
        existing.modifiedFormulas || '{}',
        existing.allFormulas || '{}',
        existing.productionStepStatus || '{}'
      )

      return {
        id: newId, quote_number: quoteNumber, customerName,
        customer_id: existing.customer_id || '', user_id: existing.user_id || '',
        shippingAddress: existing.shippingAddress || '', productStyle,
        productSpec: existing.productSpec || '',
        fabricMaterial: existing.fabricMaterial || '10安涤棉新本色',
        process: existing.process || '单面数码uv印刷+口头2.5cm',
        handleMaterial: existing.handleMaterial || '帆布手提',
        handleSpec: existing.handleSpec || '',
        quantity: existing.quantity || '', boxSpec: existing.boxSpec || '',
        remark: existing.remark || '', sampleFee: existing.sampleFee || '',
        sampleDays: existing.sampleDays || '', massDays: existing.massDays || '',
        unitPrice: existing.unitPrice || '',
        productionTimeStart: today,
        productionTimeEnd: existing.productionTimeEnd || '',
        costPrice: existing.costPrice || 0,
        priceWithTax: existing.priceWithTax || 0,
        sellPriceNoTax: existing.sellPriceNoTax || 0,
        sellPriceWithTax: existing.sellPriceWithTax || 0,
        status: 1, quoteTime: today,
        sampleTime: '', sampleCompletedTime: '', productionStartTime: '',
        shippingTime: '', paymentTime: '', endTime: '',
        images: typeof existing.images === 'string' ? JSON.parse(existing.images || '[]') : (existing.images || []),
        tableData: typeof existing.tableData === 'string' ? JSON.parse(existing.tableData || '[]') : (existing.tableData || []),
        removedFormulaAddresses: typeof existing.removedFormulaAddresses === 'string' ? JSON.parse(existing.removedFormulaAddresses || '[]') : (existing.removedFormulaAddresses || []),
        modifiedFormulas: typeof existing.modifiedFormulas === 'string' ? JSON.parse(existing.modifiedFormulas || '{}') : (existing.modifiedFormulas || {}),
        allFormulas: typeof existing.allFormulas === 'string' ? JSON.parse(existing.allFormulas || '{}') : (existing.allFormulas || {}),
        productionStepStatus: typeof existing.productionStepStatus === 'string' ? JSON.parse(existing.productionStepStatus || '{}') : (existing.productionStepStatus || {}),
        created_at: timeNow(), updated_at: timeNow(),
      }
    },
  },

  processCosts: {
    getAll: async () => {
      const rows = await dbConn.prepare('SELECT * FROM process_costs ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as ProcessCost[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM process_costs WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as ProcessCost) : null
    },
    create: async (data: Partial<ProcessCost>) => {
      const id = `pc-${Date.now()}`
      await dbConn.prepare('INSERT INTO process_costs (id, name, cost, formula) VALUES (?, ?, ?, ?)')
        .run(id, data.name || '', data.cost || 0, data.formula || '')
      const row = await dbConn.prepare('SELECT * FROM process_costs WHERE id = ?').get(id)
      return row as ProcessCost
    },
    update: async (id: string, data: Partial<ProcessCost>) => {
      const existing = await dbConn.prepare('SELECT * FROM process_costs WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      await dbConn.prepare('UPDATE process_costs SET name=?, cost=?, formula=?, updated_at=? WHERE id=?')
        .run(row.name, row.cost, row.formula, row.updated_at, id)
      return row as ProcessCost
    },
    delete: async (id: string) => {
      const info = await dbConn.prepare('DELETE FROM process_costs WHERE id = ?').run(id)
      return info.changes > 0
    },
  },
}

export const db = dbApi
export default dbApi
