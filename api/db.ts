import initSqlJs from 'sql.js'
import path from 'path'
import fs from 'fs'
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from './migrations/index.js'
import type { Customer, Product, Order, OrderItem, Task, Quote, ProcessCost } from './types/index.js'

const SQL = await initSqlJs()

interface WrappedDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: any[]): { changes: number }
    get(...params: any[]): Record<string, any> | null
    all(...params: any[]): Record<string, any>[]
  }
  transaction<T>(fn: () => T): () => T
  export(): Uint8Array
  close(): void
  pragma(pragma: string): void
}

function createWrapper(db: any): WrappedDatabase {
  const wrapper: WrappedDatabase = {
    exec(sql: string) {
      db.run(sql)
    },
    prepare(sql: string) {
      // 将 undefined 参数转为 null，防止 sql.js 绑定时报错
      const sanitize = (params: any[]) => params.map(p => (p === undefined ? null : p))
      return {
        run(...params: any[]) {
          const stmt = db.prepare(sql)
          stmt.bind(sanitize(params))
          stmt.step()
          const changes = db.getRowsModified()
          stmt.free()
          return { changes }
        },
        get(...params: any[]) {
          const stmt = db.prepare(sql)
          stmt.bind(sanitize(params))
          const hasRow = stmt.step()
          const row = hasRow ? stmt.getAsObject() : null
          stmt.free()
          return row
        },
        all(...params: any[]) {
          const stmt = db.prepare(sql)
          stmt.bind(sanitize(params))
          const rows: Record<string, any>[] = []
          while (stmt.step()) {
            rows.push(stmt.getAsObject())
          }
          stmt.free()
          return rows
        },
      }
    },
    transaction<T>(fn: () => T): () => T {
      return () => {
        db.run('BEGIN')
        try {
          const result = fn()
          db.run('COMMIT')
          return result
        } catch (e) {
          db.run('ROLLBACK')
          throw e
        }
      }
    },
    export(): Uint8Array {
      return db.export()
    },
    close(): void {
      db.close()
    },
    pragma(pragmaStr: string): void {
      db.run(`PRAGMA ${pragmaStr}`)
    },
  }
  return wrapper
}

const dbPath = process.env.DB_PATH || './data/quote-system.db'
const dbDir = path.dirname(path.resolve(dbPath))
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

let rawDb: any
const resolvedPath = path.resolve(dbPath)

if (dbPath === ':memory:') {
  rawDb = new SQL.Database()
} else if (fs.existsSync(resolvedPath)) {
  const fileBuffer = fs.readFileSync(resolvedPath)
  rawDb = new SQL.Database(fileBuffer)
} else {
  rawDb = new SQL.Database()
}

rawDb.run('PRAGMA foreign_keys = ON')

const dbConn = createWrapper(rawDb)

const persist = () => {
  if (dbPath !== ':memory:') {
    const data = rawDb.export()
    fs.writeFileSync(resolvedPath, Buffer.from(data))
  }
}

const runner = new MigrationRunner(dbConn)
const currentVersion = runner.getCurrentVersion()

if (currentVersion < CURRENT_SCHEMA_VERSION) {
  console.log(`[DB] Schema version ${currentVersion} -> ${CURRENT_SCHEMA_VERSION}, running migrations...`)
  const result = runner.migrate()
  result.applied.forEach((m) => console.log(`[DB]   Applied: ${m}`))
  if (result.skipped.length > 0) {
    result.skipped.forEach((m) => console.log(`[DB]   Skipped: ${m}`))
  }
  console.log(`[DB] Schema migrated to v${runner.getCurrentVersion()}`)
} else {
  console.log(`[DB] Schema at latest version v${currentVersion}`)
}

persist()

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

const getStyleLabel = (value: string): string => {
  // 优先从 products 表查询（动态数据源：款式标签由产品管理模块维护）
  // value 可能是款式 code（1-6）或产品 id（无 code 的产品），按 code 或 id 匹配
  const row = dbConn.prepare('SELECT name FROM products WHERE code = ? OR id = ?').get(value, value) as { name?: string } | undefined
  if (row?.name) return row.name
  // 兜底：硬编码默认款式（保证迁移前/异常场景/测试仍可用）
  const option = PRODUCT_STYLE_OPTIONS.find((opt) => opt.value === value)
  return option ? option.label : value
}

const timeNow = () => new Date().toISOString()

function toCamelRow(row: Record<string, any>): any {
  const result: Record<string, any> = {}
  for (const key of Object.keys(row)) {
    result[key] = row[key]
  }
  return result
}

export const dbApi = {
  db: dbConn,
  runner,

  getSchemaVersion(): number {
    return runner.getCurrentVersion()
  },

  customers: {
    getAll: () => {
      const rows = dbConn.prepare('SELECT * FROM customers ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Customer[]
    },
    getById: (id: string) => {
      const row = dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as Customer) : null
    },
    getByName: (name: string) => {
      const row = dbConn.prepare('SELECT * FROM customers WHERE name = ?').get(name)
      return row ? (toCamelRow(row) as Customer) : null
    },
    create: (data: Partial<Customer>) => {
      const id = `cust-${Date.now()}`
      dbConn.prepare(`INSERT INTO customers (id, name, contact_person, phone, email, address, industry)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.name || '', data.contact_person || '', data.phone || '',
        data.email || '', data.address || '', data.industry || ''
      )
      persist()
      return dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer
    },
    update: (id: string, data: Partial<Customer>) => {
      const existing = dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      dbConn.prepare(`UPDATE customers SET name=?, contact_person=?, phone=?, email=?, address=?, industry=?, updated_at=?
        WHERE id=?`).run(row.name, row.contact_person, row.phone, row.email, row.address, row.industry, row.updated_at, id)
      persist()
      return row as Customer
    },
    delete: (id: string) => {
      const info = dbConn.prepare('DELETE FROM customers WHERE id = ?').run(id)
      persist()
      return info.changes > 0
    },
  },

  products: {
    getAll: () => {
      const rows = dbConn.prepare('SELECT * FROM products ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Product[]
    },
    getById: (id: string) => {
      const row = dbConn.prepare('SELECT * FROM products WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as Product) : null
    },
    create: (data: Partial<Product>) => {
      const id = `prod-${Date.now()}`
      dbConn.prepare(`INSERT INTO products (id, name, sku, code, description, price, category, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.name || '', data.sku || '', data.code ?? '', data.description || '',
        data.price || 0, data.category || '', data.stock || 0
      )
      persist()
      return dbConn.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product
    },
    update: (id: string, data: Partial<Product>) => {
      const existing = dbConn.prepare('SELECT * FROM products WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      dbConn.prepare(`UPDATE products SET name=?, sku=?, code=?, description=?, price=?, category=?, stock=?, updated_at=?
        WHERE id=?`).run(row.name, row.sku, row.code ?? '', row.description, row.price, row.category, row.stock, row.updated_at, id)
      persist()
      return row as Product
    },
    delete: (id: string) => {
      const info = dbConn.prepare('DELETE FROM products WHERE id = ?').run(id)
      persist()
      return info.changes > 0
    },
  },

  orders: {
    getAll: () => {
      const rows = dbConn.prepare('SELECT * FROM orders ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Order[]
    },
    getById: (id: string) => {
      const order = dbConn.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Order | null
      if (!order) return null
      const items = dbConn.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id) as OrderItem[]
      const customer = dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) as Customer | null
      return { ...(toCamelRow(order) as Order), items, customer }
    },
    update: (id: string, data: Partial<Order>) => {
      const existing = dbConn.prepare('SELECT * FROM orders WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      dbConn.prepare(`UPDATE orders SET user_id=?, customer_id=?, quote_id=?, order_number=?, status=?, total_amount=?, remarks=?, updated_at=?
        WHERE id=?`).run(
        row.user_id, row.customer_id, row.quote_id, row.order_number, row.status,
        row.total_amount, row.remarks, row.updated_at, id
      )
      persist()
      return row as Order
    },
    delete: (id: string) => {
      const info = dbConn.prepare('DELETE FROM orders WHERE id = ?').run(id)
      dbConn.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)
      persist()
      return info.changes > 0
    },
  },

  tasks: {
    getAll: () => {
      const rows = dbConn.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as Task[]
    },
    getById: (id: string) => {
      const row = dbConn.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as Task) : null
    },
    create: (data: Partial<Task>) => {
      const id = `task-${Date.now()}`
      dbConn.prepare(`INSERT INTO tasks (id, user_id, order_id, title, description, status, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.user_id || '', data.order_id || '', data.title || '',
        data.description || '', data.status || 'pending', data.due_date || ''
      )
      persist()
      return dbConn.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task
    },
    update: (id: string, data: Partial<Task>) => {
      const existing = dbConn.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      dbConn.prepare(`UPDATE tasks SET user_id=?, order_id=?, title=?, description=?, status=?, due_date=?, updated_at=?
        WHERE id=?`).run(row.user_id, row.order_id, row.title, row.description, row.status, row.due_date, row.updated_at, id)
      persist()
      return row as Task
    },
    delete: (id: string) => {
      const info = dbConn.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      persist()
      return info.changes > 0
    },
  },

  quotes: {
    getAll: () => {
      const rows = dbConn.prepare('SELECT * FROM quotes ORDER BY updated_at DESC').all()
      return rows.map((r) => {
        const c = toCamelRow(r)
        c.images = typeof c.images === 'string' ? JSON.parse(c.images || '[]') : c.images
        c.tableData = typeof c.tableData === 'string' ? JSON.parse(c.tableData || '[]') : (c.tableData || [])
        c.removedFormulaAddresses = typeof (c as any).removedFormulaAddresses === 'string' ? JSON.parse((c as any).removedFormulaAddresses || '[]') : ((c as any).removedFormulaAddresses || [])
        return c
      }) as Quote[]
    },
    getById: (id: string) => {
      const row = dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id)
      if (!row) return null
      const c = toCamelRow(row)
      c.images = typeof c.images === 'string' ? JSON.parse(c.images || '[]') : c.images
      c.tableData = typeof c.tableData === 'string' ? JSON.parse(c.tableData || '[]') : (c.tableData || [])
      c.removedFormulaAddresses = typeof (c as any).removedFormulaAddresses === 'string' ? JSON.parse((c as any).removedFormulaAddresses || '[]') : ((c as any).removedFormulaAddresses || [])
      return c as Quote
    },
    create: (data: Partial<Quote>) => {
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const timestamp = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      const customerName = data.customerName || ''
      const productStyle = data.productStyle || '1'
      const quoteNumber = `${customerName}-${getStyleLabel(productStyle)}-${timestamp}`
      const id = `quote-${Date.now()}`

      dbConn.prepare(`INSERT INTO quotes (id, user_id, customer_id, quote_number, customerName, shippingAddress,
        productStyle, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime,
        shippingTime, paymentTime, endTime, images, tableData, removedFormulaAddresses)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.user_id || '', data.customer_id || '', quoteNumber, customerName,
        data.shippingAddress || '', productStyle, data.productSpec || '',
        data.fabricMaterial || '10安涤棉新本色', data.process || '单面数码uv印刷',
        data.handleMaterial || '帆布手提', data.handleSpec || '',
        data.quantity || '', data.boxSpec || '', data.remark || '',
        data.sampleFee || '', data.sampleDays || '', data.massDays || '',
        data.unitPrice || '', data.productionTimeStart || today, data.productionTimeEnd || '',
        data.costPrice || 0, data.priceWithTax || 0, data.sellPriceNoTax || 0, data.sellPriceWithTax || 0,
        data.status || 1, today, '', '', '', '', '',
        JSON.stringify(data.images || []),
        JSON.stringify(data.tableData || []),
        JSON.stringify(data.removedFormulaAddresses || [])
      )
      persist()

      return {
        id, quote_number: quoteNumber, customerName,
        customer_id: data.customer_id || '', user_id: data.user_id || '',
        shippingAddress: data.shippingAddress || '', productStyle,
        productSpec: data.productSpec || '',
        fabricMaterial: data.fabricMaterial || '10安涤棉新本色',
        process: data.process || '单面数码uv印刷',
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
        sampleTime: '', productionStartTime: '',
        shippingTime: '', paymentTime: '', endTime: '',
        images: data.images || [],
        tableData: data.tableData || [],
        removedFormulaAddresses: data.removedFormulaAddresses || [],
        created_at: timeNow(), updated_at: timeNow(),
      }
    },
    update: (id: string, data: Partial<Quote>) => {
      const existing = dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      // 解析 existing 中的 JSON 字段（tableData/images/removedFormulaAddresses 存储为字符串）
      const existingParsed = toCamelRow(existing) as Quote
      existingParsed.images = typeof (existingParsed as any).images === 'string' ? JSON.parse((existingParsed as any).images || '[]') : (existingParsed.images || [])
      existingParsed.tableData = typeof (existingParsed as any).tableData === 'string' ? JSON.parse((existingParsed as any).tableData || '[]') : (existingParsed.tableData || [])
      existingParsed.removedFormulaAddresses = typeof (existingParsed as any).removedFormulaAddresses === 'string' ? JSON.parse((existingParsed as any).removedFormulaAddresses || '[]') : ((existingParsed as any).removedFormulaAddresses || [])
      let updatedQuote: Quote = { ...existingParsed, ...data, updated_at: timeNow() }

      if (data.customerName !== undefined || data.productStyle !== undefined) {
        const customerName = data.customerName !== undefined ? data.customerName : existing.customerName
        const productStyle = data.productStyle !== undefined ? data.productStyle : existing.productStyle
        const timestampMatch = existing.quote_number.match(/\d{14}/)
        const timestamp = timestampMatch ? timestampMatch[0] : ''
        updatedQuote.quote_number = `${customerName}-${getStyleLabel(productStyle)}-${timestamp}`
      }

      if (data.images !== undefined) {
        updatedQuote.images = data.images
      }
      // tableData/removedFormulaAddresses 持久化为 JSON 字符串；返回给前端时保持数组形式
      const tableDataJson = JSON.stringify(updatedQuote.tableData || [])
      const removedFormulaAddressesJson = JSON.stringify(updatedQuote.removedFormulaAddresses || [])

      dbConn.prepare(`UPDATE quotes SET customerName=?, quote_number=?, customer_id=?, user_id=?, shippingAddress=?,
        productStyle=?, productSpec=?, fabricMaterial=?, process=?, handleMaterial=?, handleSpec=?,
        quantity=?, boxSpec=?, remark=?, sampleFee=?, sampleDays=?, massDays=?, unitPrice=?,
        productionTimeStart=?, productionTimeEnd=?, costPrice=?, priceWithTax=?, sellPriceNoTax=?, sellPriceWithTax=?,
        status=?, sampleTime=?, productionStartTime=?, shippingTime=?, paymentTime=?, endTime=?,
        images=?, tableData=?, removedFormulaAddresses=?, updated_at=? WHERE id=?`).run(
        updatedQuote.customerName, updatedQuote.quote_number, updatedQuote.customer_id, updatedQuote.user_id,
        updatedQuote.shippingAddress, updatedQuote.productStyle, updatedQuote.productSpec,
        updatedQuote.fabricMaterial, updatedQuote.process, updatedQuote.handleMaterial, updatedQuote.handleSpec,
        updatedQuote.quantity, updatedQuote.boxSpec, updatedQuote.remark,
        updatedQuote.sampleFee, updatedQuote.sampleDays, updatedQuote.massDays, updatedQuote.unitPrice,
        updatedQuote.productionTimeStart, updatedQuote.productionTimeEnd,
        updatedQuote.costPrice, updatedQuote.priceWithTax, updatedQuote.sellPriceNoTax, updatedQuote.sellPriceWithTax,
        updatedQuote.status, updatedQuote.sampleTime, updatedQuote.productionStartTime,
        updatedQuote.shippingTime, updatedQuote.paymentTime, updatedQuote.endTime,
        JSON.stringify(updatedQuote.images || []), tableDataJson, removedFormulaAddressesJson, updatedQuote.updated_at, id
      )
      persist()
      return updatedQuote
    },
    nextStatus: (id: string) => {
      const existing = dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      const today = new Date().toISOString().split('T')[0]
      let newStatus = existing.status
      const updates: Partial<Quote> = {}

      switch (existing.status) {
        case 1: newStatus = 2; updates.sampleTime = today; break
        case 2: newStatus = 3; updates.productionStartTime = today; break
        case 3: newStatus = 4; updates.shippingTime = today; break
        case 4: newStatus = 5; updates.paymentTime = today; break
        case 5: newStatus = 6; updates.endTime = today; break
        case 6: return toCamelRow(existing) as Quote
      }

      const updated = { ...(toCamelRow(existing) as Quote), status: newStatus, ...updates, updated_at: timeNow() }
      dbConn.prepare(`UPDATE quotes SET status=?, sampleTime=?, productionStartTime=?, shippingTime=?, paymentTime=?, endTime=?, updated_at=? WHERE id=?`).run(
        newStatus,
        updates.sampleTime || existing.sampleTime,
        updates.productionStartTime || existing.productionStartTime,
        updates.shippingTime || existing.shippingTime,
        updates.paymentTime || existing.paymentTime,
        updates.endTime || existing.endTime,
        updated.updated_at, id
      )
      persist()
      return updated
    },
    prevStatus: (id: string) => {
      const existing = dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      let newStatus = existing.status
      switch (existing.status) {
        case 2: newStatus = 1; break
        case 3: newStatus = 2; break
        case 4: newStatus = 3; break
        case 5: newStatus = 4; break
        case 6: newStatus = 5; break
        case 1: return toCamelRow(existing) as Quote
      }
      const updated = { ...(toCamelRow(existing) as Quote), status: newStatus, updated_at: timeNow() }
      dbConn.prepare('UPDATE quotes SET status=?, updated_at=? WHERE id=?').run(newStatus, updated.updated_at, id)
      persist()
      return updated
    },
    endQuote: (id: string) => {
      const existing = dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      if (existing.status !== 1 && existing.status !== 2) return toCamelRow(existing) as Quote
      const today = new Date().toISOString().split('T')[0]
      const updated = { ...(toCamelRow(existing) as Quote), status: 6, endTime: today, updated_at: timeNow() }
      dbConn.prepare('UPDATE quotes SET status=?, endTime=?, updated_at=? WHERE id=?').run(6, today, updated.updated_at, id)
      persist()
      return updated
    },
    delete: (id: string) => {
      const info = dbConn.prepare('DELETE FROM quotes WHERE id = ?').run(id)
      persist()
      return info.changes > 0
    },
  },

  processCosts: {
    getAll: () => {
      const rows = dbConn.prepare('SELECT * FROM process_costs ORDER BY updated_at DESC').all()
      return rows.map(toCamelRow) as ProcessCost[]
    },
    getById: (id: string) => {
      const row = dbConn.prepare('SELECT * FROM process_costs WHERE id = ?').get(id)
      return row ? (toCamelRow(row) as ProcessCost) : null
    },
    create: (data: Partial<ProcessCost>) => {
      const id = `pc-${Date.now()}`
      dbConn.prepare('INSERT INTO process_costs (id, name, cost, formula) VALUES (?, ?, ?, ?)')
        .run(id, data.name || '', data.cost || 0, data.formula || '')
      persist()
      return dbConn.prepare('SELECT * FROM process_costs WHERE id = ?').get(id) as ProcessCost
    },
    update: (id: string, data: Partial<ProcessCost>) => {
      const existing = dbConn.prepare('SELECT * FROM process_costs WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      dbConn.prepare('UPDATE process_costs SET name=?, cost=?, formula=?, updated_at=? WHERE id=?')
        .run(row.name, row.cost, row.formula, row.updated_at, id)
      persist()
      return row as ProcessCost
    },
    delete: (id: string) => {
      const info = dbConn.prepare('DELETE FROM process_costs WHERE id = ?').run(id)
      persist()
      return info.changes > 0
    },
  },
}

export const db = dbApi
export default dbApi
