import { pool, initDatabase, withTransaction, closePool, execMultiStatement } from './dbClient.js'
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from './migrations/index.js'
import type { Customer, Product, Order, OrderItem, Task, Quote, ProductCostItem, ProductCostProcess, ProductCostCustomField, ProductCostFieldType, ProductMedia } from './types/index.js'

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

// 6 个默认款式产品的 id（迁移脚本 v7 插入，不可删除）
export const DEFAULT_STYLE_PRODUCT_IDS = ['style-1', 'style-2', 'style-3', 'style-4', 'style-5', 'style-6']

/** 判断产品是否为默认款式（默认款式不可删除） */
export function isDefaultStyleProduct(id: string): boolean {
  return DEFAULT_STYLE_PRODUCT_IDS.includes(id)
}

const timeNow = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - offset).toISOString().slice(0, 19).replace('T', ' ')
}

function toCamelRow(row: Record<string, any>): any {
  const result: Record<string, any> = {}
  for (const key of Object.keys(row)) {
    result[key] = row[key]
  }
  return result
}

/** 在线表格模板记录（v19：数据库覆盖版本，前端内置模板为兜底） */
export interface SheetTemplateRecord {
  id: string
  styleCode: string
  /** 模板名称（同款式内唯一，一对多） */
  name: string
  data: (string | number | null)[][]
  formulas: Record<string, string>
  sortOrder: number
  updatedBy: string
  createdAt: string
  updatedAt: string
}

/** 解析 sheet_templates 行：LONGTEXT JSON 字段反序列化 */
function parseSheetTemplateRow(row: Record<string, any>): SheetTemplateRecord {
  const parse = (val: any, defaultVal: string) => {
    if (typeof val === 'string') return JSON.parse(val || defaultVal)
    return val ?? JSON.parse(defaultVal)
  }
  return {
    id: row.id,
    styleCode: row.style_code,
    name: row.name || '',
    data: parse(row.data, '[]'),
    formulas: parse(row.formulas, '{}'),
    sortOrder: Number(row.sort_order ?? 0),
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 做货流程材料准备项（v24，存 quote_production_tasks.materials JSON） */
export interface ProductionTaskMaterial {
  name: string
  spec: string
  quantity: number
  unit: string
  ready: boolean
}

/** 做货流程任务记录（v24 甘特图数据） */
export interface ProductionTaskRecord {
  id: string
  quoteId: string
  stepOrder: number
  name: string
  planStart: string | null
  planEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  status: number
  remark: string
  materials: ProductionTaskMaterial[]
  createdAt: string
  updatedAt: string
}

/** 做货流程跟踪表总览行（任务 + 订单摘要，做货跟踪页聚合数据） */
export interface ProductionTaskOverviewRow extends ProductionTaskRecord {
  quoteNumber: string
  customerName: string
  quantity: string
  orderStatus: number
  quoteUpdatedAt: string
}

/** 订单对账工艺成本明细记录（v28） */
export interface ReconciliationCostRecord {
  id: string
  quoteId: string
  /** 工艺名称（必填） */
  name: string
  /** 工艺单价 */
  unitPrice: number
  /** 工艺数量 */
  quantity: number
  /** 工艺成本（必填） */
  cost: number
  /** 工艺备注 */
  remark: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 解析 quote_reconciliation_costs 行：DECIMAL 字符串转 number */
function parseReconciliationCostRow(row: Record<string, any>): ReconciliationCostRecord {
  return {
    id: row.id,
    quoteId: row.quote_id,
    name: row.name || '',
    unitPrice: Number(row.unit_price ?? 0),
    quantity: Number(row.quantity ?? 0),
    cost: Number(row.cost ?? 0),
    remark: row.remark || '',
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

/** 解析 product_cost_custom_fields 行：options JSON 反序列化、visible 转布尔 */
function parseCostFieldRow(row: Record<string, any>): ProductCostCustomField {
  let options: string[] = []
  try {
    const parsed = typeof row.options === 'string' ? JSON.parse(row.options || '[]') : (row.options || [])
    options = Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    options = []
  }
  return {
    id: row.id,
    costItemId: row.cost_item_id,
    name: row.name || '',
    fieldType: (row.field_type || 'text') as ProductCostFieldType,
    options,
    visible: Number(row.visible ?? 1) === 1,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

/** 解析 product_cost_processes 行：custom_values JSON 反序列化 */
function parseCostProcessRow(row: Record<string, any>): ProductCostProcess {
  let customValues: Record<string, string> = {}
  try {
    const parsed = typeof row.custom_values === 'string' ? JSON.parse(row.custom_values || '{}') : (row.custom_values || {})
    customValues = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
  } catch {
    customValues = {}
  }
  return {
    id: row.id,
    costItemId: row.cost_item_id,
    name: row.name || '',
    cost: Number(row.cost ?? 0),
    formula: row.formula || '',
    features: row.features || '',
    remark: row.remark || '',
    customValues,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

/** 解析 quote_production_tasks 行：DATE 转 YYYY-MM-DD、materials JSON 反序列化 */
function parseProductionTaskRow(row: Record<string, any>): ProductionTaskRecord {
  const toDateStr = (v: any): string | null => {
    if (v == null) return null
    if (v instanceof Date) {
      // mysql2 按 timezone('+08:00') 构造 Date：取本地日期部分，避免 toISOString 的 UTC 偏移导致日期前移一天
      const y = v.getFullYear()
      const m = String(v.getMonth() + 1).padStart(2, '0')
      const d = String(v.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    return String(v).slice(0, 10)
  }
  let materials: ProductionTaskMaterial[] = []
  try {
    materials = typeof row.materials === 'string' ? JSON.parse(row.materials || '[]') : (row.materials || [])
  } catch {
    materials = []
  }
  return {
    id: row.id,
    quoteId: row.quote_id,
    stepOrder: Number(row.step_order ?? 0),
    name: row.name || '',
    planStart: toDateStr(row.plan_start),
    planEnd: toDateStr(row.plan_end),
    actualStart: toDateStr(row.actual_start),
    actualEnd: toDateStr(row.actual_end),
    status: Number(row.status ?? 0),
    remark: row.remark || '',
    materials: Array.isArray(materials) ? materials : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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
  ;(c as any).productionStepStatus = parse(c.productionStepStatus, '{}')
  // 模板关联（v23）：数据库列为 snake_case，统一映射为业务侧 templateId（空 = 内置默认模板）
  ;(c as any).templateId = (c as any).template_id ?? ''
  // 收款字段（v17/v18）：mysql2 将 DECIMAL 返回为字符串，TINYINT 返回 0/1，统一转为业务类型
  if (typeof (c as any).receivableSampleFee === 'string') (c as any).receivableSampleFee = Number((c as any).receivableSampleFee)
  if (typeof (c as any).actualSampleFee === 'string') (c as any).actualSampleFee = Number((c as any).actualSampleFee)
  if (typeof (c as any).deposit === 'string') (c as any).deposit = Number((c as any).deposit)
  if (typeof (c as any).pendingAmount === 'string') (c as any).pendingAmount = Number((c as any).pendingAmount)
  ;(c as any).sampleFeeDeduct = !!(c as any).sampleFeeDeduct
  return c
}

/**
 * 计算待收总金额（v18 公式）：
 * - 抵扣大货=是：销售总额(不含税) - 已收打样费 - 定金
 * - 抵扣大货=否：销售总额(不含税) + 应收打样费 - 已收打样费 - 定金
 */
function calcPendingAmount(q: { quantity?: string | number | null; sellPriceNoTax?: number | string | null; sampleFeeDeduct?: number | boolean | null; receivableSampleFee?: number | string | null; actualSampleFee?: number | string | null; deposit?: number | string | null }): number {
  const qty = parseFloat(String(q.quantity ?? '')) || 0
  const total = Math.round((Number(q.sellPriceNoTax) || 0) * qty * 100) / 100
  const actualFee = Number(q.actualSampleFee) || 0
  // 抵扣=是：只减已收打样费；抵扣=否：加应收打样费再减已收打样费
  const feePart = q.sampleFeeDeduct ? -actualFee : Math.round(((Number(q.receivableSampleFee) || 0) - actualFee) * 100) / 100
  return Math.round((total + feePart - (Number(q.deposit) || 0)) * 100) / 100
}

/**
 * 生成 16 位随机数字订单号（quote_number，全局唯一）
 * 防重复校验：生成后查询 quotes 表，若已存在则重新生成（重试上限内）
 * 导出供单元测试覆盖碰撞重试与兜底路径
 */
export async function generateUniqueQuoteNumber(): Promise<string> {
  const generate = (): string => {
    let digits = ''
    for (let i = 0; i < 16; i++) digits += Math.floor(Math.random() * 10)
    return digits
  }
  // 随机重试（10^16 空间下碰撞概率极低，10 次重试已充分）
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generate()
    const existing = await dbConn.prepare('SELECT id FROM quotes WHERE quote_number = ?').get(candidate)
    if (!existing) return candidate
  }
  // 兜底：时间戳(13位) + 3位随机数，仍保持 16 位且必不相同
  return `${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`
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
      await dbConn.prepare(`INSERT INTO customers (id, name, contact_person, phone, email, address, industry, tags, remark)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.name || '', data.contact_person || '', data.phone || '',
        data.email || '', data.address || '', data.industry || '',
        data.tags ?? '', data.remark ?? ''
      )
      const row = await dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      return row as Customer
    },
    update: async (id: string, data: Partial<Customer>) => {
      const existing = await dbConn.prepare('SELECT * FROM customers WHERE id = ?').get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updated_at: timeNow() }
      await dbConn.prepare(`UPDATE customers SET name=?, contact_person=?, phone=?, email=?, address=?, industry=?, tags=?, remark=?, updated_at=?
        WHERE id=?`).run(row.name, row.contact_person, row.phone, row.email, row.address, row.industry, row.tags ?? '', row.remark ?? '', row.updated_at, id)
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

  // 产品图册媒体（v32：图片/视频，原图存储不压缩；文件系统清理由路由层负责）
  productMedia: {
    /** 产品全部媒体（按 sort_order 升序，同序按创建时间，即上传顺序/自定义排序） */
    getByProduct: async (productId: string) => {
      const rows = await dbConn.prepare(
        'SELECT * FROM product_media WHERE product_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC'
      ).all(productId)
      return rows as ProductMedia[]
    },
    /** 每个产品的第一张图片（media_type='image' 按图册排序取最前），供列表页缩略图展示 */
    getFirstImages: async () => {
      const rows = await dbConn.prepare(`
        SELECT product_id, id, media_type, file_name
        FROM (
          SELECT pm.product_id, pm.id, pm.media_type, pm.file_name,
                 ROW_NUMBER() OVER (PARTITION BY pm.product_id ORDER BY pm.sort_order ASC, pm.created_at ASC, pm.id ASC) AS rn
          FROM product_media pm
          WHERE pm.media_type = 'image'
        ) t
        WHERE rn = 1
      `).all()
      return rows as { product_id: string; id: string; media_type: string; file_name: string }[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM product_media WHERE id = ?').get(id)
      return (row as ProductMedia) || null
    },
    /** 当前最大排序号 + 1（新上传的媒体追加到末尾，保持上传顺序） */
    nextSortOrder: async (productId: string) => {
      const row = await dbConn.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM product_media WHERE product_id = ?'
      ).get(productId)
      return Number((row as any)?.next ?? 0)
    },
    /** 新增媒体记录（文件已由路由层落盘，此处只记录元数据） */
    create: async (data: {
      productId: string
      mediaType: 'image' | 'video'
      fileName: string
      filePath: string
      fileSize: number
      mimeType: string
      sortOrder?: number
    }) => {
      const id = `pmedia-${Date.now()}-${Math.floor(Math.random() * 10000)}`
      await dbConn.prepare(
        `INSERT INTO product_media (id, product_id, media_type, file_name, file_path, file_size, mime_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.productId, data.mediaType, data.fileName, data.filePath, data.fileSize, data.mimeType, data.sortOrder ?? 0)
      const row = await dbConn.prepare('SELECT * FROM product_media WHERE id = ?').get(id)
      return row as ProductMedia
    },
    /** 删除单条媒体记录，返回被删记录（供路由层清理磁盘文件） */
    deleteById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM product_media WHERE id = ?').get(id)
      if (!row) return null
      await dbConn.prepare('DELETE FROM product_media WHERE id = ?').run(id)
      return row as ProductMedia
    },
    /** 删除产品下全部媒体记录，返回被删记录列表（供路由层清理磁盘文件） */
    deleteByProduct: async (productId: string) => {
      const rows = await dbConn.prepare('SELECT * FROM product_media WHERE product_id = ?').all(productId)
      await dbConn.prepare('DELETE FROM product_media WHERE product_id = ?').run(productId)
      return rows as ProductMedia[]
    },
    /** 自定义重排：mediaIds 为该产品全部媒体 id 的新顺序，整体重写序号（0,1,2...） */
    reorder: async (productId: string, mediaIds: string[]) => {
      const existing = await dbConn.prepare(
        'SELECT id FROM product_media WHERE product_id = ?'
      ).all(productId) as { id: string }[]
      const existingIds = new Set(existing.map((r) => r.id))
      // 新顺序必须恰好覆盖该产品现有全部媒体（不增不减）
      if (mediaIds.length !== existingIds.size || !mediaIds.every((mid) => existingIds.has(mid))) {
        throw new Error('媒体排序列表必须与现有媒体完全一致')
      }
      for (let i = 0; i < mediaIds.length; i++) {
        await dbConn.prepare('UPDATE product_media SET sort_order = ? WHERE id = ?').run(i, mediaIds[i])
      }
      return true
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
      const rows = await dbConn.prepare(`SELECT id, user_id, created_by, updated_by, customer_id, quote_number, customerName, shippingAddress,
        productStyle, template_id, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax,
        receivableSampleFee, actualSampleFee, sampleFeeDeduct, deposit, pendingAmount,
        status, quoteTime, sampleTime,
        sampleCompletedTime, productionStartTime, shippingTime, paymentTime, reconciledTime, endTime, created_at, updated_at
        FROM quotes ORDER BY updated_at DESC`).all()
      return rows.map((r) => parseLargeFields(r)) as Quote[]
    },
    getById: async (id: string) => {
      const row = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id)
      if (!row) return null
      return parseLargeFields(row) as Quote
    },
    create: async (data: Partial<Quote>) => {
      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const customerName = data.customerName || ''
      const productStyle = data.productStyle || '1'
      // 订单号：16位随机数字（全局唯一，含防重复校验；客户/款式信息不再编入订单号）
      const quoteNumber = await generateUniqueQuoteNumber()
      const id = `quote-${Date.now()}`

      await dbConn.prepare(`INSERT INTO quotes (id, user_id, created_by, updated_by, customer_id, quote_number, customerName, shippingAddress,
        productStyle, template_id, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax, receivableSampleFee, actualSampleFee, sampleFeeDeduct, deposit, pendingAmount,
        status, quoteTime, sampleTime, sampleCompletedTime, productionStartTime,
        shippingTime, paymentTime, endTime, images, tableData, removedFormulaAddresses, modifiedFormulas, allFormulas, productionStepStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, data.user_id || '', data.created_by || '', data.updated_by || '', data.customer_id || '', quoteNumber, customerName,
        data.shippingAddress || '', productStyle, (data as any).templateId || '', data.productSpec || '',
        data.fabricMaterial || '10安涤棉新本色', data.process || '单面数码uv印刷+口头2.5cm',
        data.handleMaterial || '帆布手提', data.handleSpec || '',
        data.quantity || '', data.boxSpec || '', data.remark || '',
        data.sampleFee || '', data.sampleDays || '', data.massDays || '',
        data.unitPrice || '', data.productionTimeStart || today, data.productionTimeEnd || '',
        data.costPrice || 0, data.priceWithTax || 0, data.sellPriceNoTax || 0, data.sellPriceWithTax || 0,
        data.receivableSampleFee || 0, data.actualSampleFee || 0, data.sampleFeeDeduct ? 1 : 0, data.deposit || 0, data.pendingAmount || 0,
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
        created_by: data.created_by || '', updated_by: data.updated_by || '',
        shippingAddress: data.shippingAddress || '', productStyle,
        templateId: (data as any).templateId || '',
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
        receivableSampleFee: data.receivableSampleFee || 0,
        actualSampleFee: data.actualSampleFee || 0,
        sampleFeeDeduct: !!data.sampleFeeDeduct,
        deposit: data.deposit || 0,
        pendingAmount: data.pendingAmount || 0,
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
      // 模板关联（v23）：原始行为 snake_case，补映射避免局部更新（如仅改状态）时 template_id 被清空
      ;(existingParsed as any).templateId = (existing as any).template_id ?? (existingParsed as any).templateId ?? ''
      let updatedQuote: Quote = { ...existingParsed, ...data, updated_at: timeNow() }

      // 订单号为16位随机数字（全局唯一），创建后不再随客户名称/款式变化
      updatedQuote.quote_number = existing.quote_number

      if (data.images !== undefined) {
        updatedQuote.images = data.images
      }
      const tableDataJson = JSON.stringify(updatedQuote.tableData || [])
      const removedFormulaAddressesJson = JSON.stringify(updatedQuote.removedFormulaAddresses || [])
      const modifiedFormulasJson = JSON.stringify(updatedQuote.modifiedFormulas || {})
      const allFormulasJson = JSON.stringify(updatedQuote.allFormulas || {})
      const productionStepStatusJson = JSON.stringify(updatedQuote.productionStepStatus || {})

      await dbConn.prepare(`UPDATE quotes SET customerName=?, quote_number=?, customer_id=?, user_id=?, updated_by=?, shippingAddress=?,
        productStyle=?, template_id=?, productSpec=?, fabricMaterial=?, process=?, handleMaterial=?, handleSpec=?,
        quantity=?, boxSpec=?, remark=?, sampleFee=?, sampleDays=?, massDays=?, unitPrice=?,
        productionTimeStart=?, productionTimeEnd=?, costPrice=?, priceWithTax=?, sellPriceNoTax=?, sellPriceWithTax=?,
        receivableSampleFee=?, actualSampleFee=?, sampleFeeDeduct=?, deposit=?, pendingAmount=?,
        status=?, sampleTime=?, sampleCompletedTime=?, productionStartTime=?, shippingTime=?, paymentTime=?, reconciledTime=?, endTime=?,
        images=?, tableData=?, removedFormulaAddresses=?, modifiedFormulas=?, allFormulas=?, productionStepStatus=?, updated_at=? WHERE id=?`).run(
        updatedQuote.customerName, updatedQuote.quote_number, updatedQuote.customer_id, updatedQuote.user_id, updatedQuote.updated_by,
        updatedQuote.shippingAddress, updatedQuote.productStyle, (updatedQuote as any).templateId || '', updatedQuote.productSpec,
        updatedQuote.fabricMaterial, updatedQuote.process, updatedQuote.handleMaterial, updatedQuote.handleSpec,
        updatedQuote.quantity, updatedQuote.boxSpec, updatedQuote.remark,
        updatedQuote.sampleFee, updatedQuote.sampleDays, updatedQuote.massDays, updatedQuote.unitPrice,
        updatedQuote.productionTimeStart, updatedQuote.productionTimeEnd,
        updatedQuote.costPrice, updatedQuote.priceWithTax, updatedQuote.sellPriceNoTax, updatedQuote.sellPriceWithTax,
        updatedQuote.receivableSampleFee || 0, updatedQuote.actualSampleFee || 0, updatedQuote.sampleFeeDeduct ? 1 : 0, updatedQuote.deposit || 0, updatedQuote.pendingAmount || 0,
        updatedQuote.status, updatedQuote.sampleTime, updatedQuote.sampleCompletedTime, updatedQuote.productionStartTime,
        updatedQuote.shippingTime, updatedQuote.paymentTime, (updatedQuote as any).reconciledTime || existing.reconciledTime || '',
        updatedQuote.endTime,
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
        // V28 对账管理：订单管理不允许手动流转到已对账(8)，5→8 仅可经订单对账管理 reconcileQuote（确认对账）进入
        case 5: return toCamelRow(existing) as Quote
        // 已对账(8)为流转终态；结束(6)为旁路状态（仅 1/2/7 可经 endQuote 进入）
        case 8: return toCamelRow(existing) as Quote
        case 6: return toCamelRow(existing) as Quote
      }

      const updated = { ...(toCamelRow(existing) as Quote), status: newStatus, ...updates, updated_at: timeNow() } as any
      // 待收总额状态联动：仅做货中(3)/已发货未收款(4)保留计算；从非计算态进入时重算，离开时清零
      const inCalcStates = (s: number) => s === 3 || s === 4
      if (inCalcStates(newStatus) && !inCalcStates(existing.status)) {
        updated.pendingAmount = calcPendingAmount(existing)
      } else if (!inCalcStates(newStatus)) {
        updated.pendingAmount = 0
      }
      await dbConn.prepare(`UPDATE quotes SET status=?, sampleTime=?, sampleCompletedTime=?, productionStartTime=?, shippingTime=?, paymentTime=?, reconciledTime=?, endTime=?, pendingAmount=?, updated_at=? WHERE id=?`).run(
        newStatus,
        updates.sampleTime || existing.sampleTime,
        updates.sampleCompletedTime || (existing as any).sampleCompletedTime || '',
        updates.productionStartTime || existing.productionStartTime,
        updates.shippingTime || existing.shippingTime,
        updates.paymentTime || existing.paymentTime,
        (updates as any).reconciledTime || (existing as any).reconciledTime || '',
        updates.endTime || existing.endTime,
        updated.pendingAmount ?? (existing as any).pendingAmount ?? 0,
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
        // V28 对账管理：订单管理不允许手动退出已对账(8)，8→5 仅可经订单对账管理 unreconcileQuote（退回对账）操作
        case 8: return toCamelRow(existing) as Quote
        // 历史"结束"订单可退回已发货已收款，重新走对账流程
        case 6: newStatus = 5; break
        case 1: return toCamelRow(existing) as Quote
      }
      const updated = { ...(toCamelRow(existing) as Quote), status: newStatus, updated_at: timeNow() }
      // 待收总额状态联动：退回离开做货中(3)/已发货未收款(4)时清零；从非计算态退回进入时重算（如已收款退回未收款）
      const inCalcStates = (s: number) => s === 3 || s === 4
      if (inCalcStates(newStatus) && !inCalcStates(existing.status)) {
        updated.pendingAmount = calcPendingAmount(existing)
      } else if (!inCalcStates(newStatus)) {
        updated.pendingAmount = 0
      }
      await dbConn.prepare(`UPDATE quotes SET status=?, pendingAmount=?, updated_at=? WHERE id=?`).run(
        newStatus,
        updated.pendingAmount ?? (existing as any).pendingAmount ?? 0,
        updated.updated_at, id
      )
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
    copy: async (id: string, operator: string = '') => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id)
      if (!existing) return null

      const now = new Date()
      const today = now.toISOString().split('T')[0]
      const customerName = existing.customerName || ''
      const productStyle = existing.productStyle || '1'
      // 复制订单：订单号不复用原订单，自动生成全新 16 位随机订单号
      const quoteNumber = await generateUniqueQuoteNumber()
      const newId = `quote-${Date.now()}`

      await dbConn.prepare(`INSERT INTO quotes (id, user_id, created_by, updated_by, customer_id, quote_number, customerName, shippingAddress,
        productStyle, template_id, productSpec, fabricMaterial, process, handleMaterial, handleSpec, quantity, boxSpec, remark,
        sampleFee, sampleDays, massDays, unitPrice, productionTimeStart, productionTimeEnd,
        costPrice, priceWithTax, sellPriceNoTax, sellPriceWithTax, receivableSampleFee, actualSampleFee, sampleFeeDeduct, deposit, pendingAmount,
        status, quoteTime, sampleTime, sampleCompletedTime, productionStartTime,
        shippingTime, paymentTime, endTime, images, tableData, removedFormulaAddresses, modifiedFormulas, allFormulas, productionStepStatus)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        newId, existing.user_id || '', operator, operator, existing.customer_id || '', quoteNumber, customerName,
        existing.shippingAddress || '', productStyle, (existing as any).template_id || '', existing.productSpec || '',
        existing.fabricMaterial || '10安涤棉新本色', existing.process || '单面数码uv印刷+口头2.5cm',
        existing.handleMaterial || '帆布手提', existing.handleSpec || '',
        existing.quantity || '', existing.boxSpec || '', existing.remark || '',
        existing.sampleFee || '', existing.sampleDays || '', existing.massDays || '',
        existing.unitPrice || '', today, '',
        existing.costPrice || 0, existing.priceWithTax || 0, existing.sellPriceNoTax || 0, existing.sellPriceWithTax || 0,
        // 复制订单：收款相关字段不复制（新订单重新收款），重置为默认值
        0, 0, 0, 0, 0,
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
        created_by: operator, updated_by: operator,
        shippingAddress: existing.shippingAddress || '', productStyle,
        templateId: (existing as any).template_id || '',
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
        // 收款相关字段重置
        receivableSampleFee: 0,
        actualSampleFee: 0,
        sampleFeeDeduct: false,
        deposit: 0,
        pendingAmount: 0,
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

  /** 产品成本项配置（v31）：成本项 → 可选工艺（多对一） + 自定义字段定义 */
  productCostItems: {
    /** 获取全部成本项（组装树：含其下工艺列表与字段定义） */
    getAll: async (): Promise<ProductCostItem[]> => {
      const itemRows = await dbConn.prepare(
        'SELECT * FROM product_cost_items ORDER BY sort_order ASC, created_at ASC, id ASC'
      ).all()
      const processRows = await dbConn.prepare(
        'SELECT * FROM product_cost_processes ORDER BY sort_order ASC, created_at ASC, id ASC'
      ).all()
      const fieldRows = await dbConn.prepare(
        'SELECT * FROM product_cost_custom_fields ORDER BY sort_order ASC, created_at ASC, id ASC'
      ).all()
      const processesByItem = new Map<string, ProductCostProcess[]>()
      for (const row of processRows) {
        const p = parseCostProcessRow(row)
        const list = processesByItem.get(p.costItemId) || []
        list.push(p)
        processesByItem.set(p.costItemId, list)
      }
      const fieldsByItem = new Map<string, ProductCostCustomField[]>()
      for (const row of fieldRows) {
        const f = parseCostFieldRow(row)
        const list = fieldsByItem.get(f.costItemId) || []
        list.push(f)
        fieldsByItem.set(f.costItemId, list)
      }
      return itemRows.map((row) => ({
        id: row.id,
        name: row.name || '',
        sortOrder: Number(row.sort_order ?? 0),
        processes: processesByItem.get(row.id) || [],
        fields: fieldsByItem.get(row.id) || [],
        createdAt: String(row.created_at ?? ''),
        updatedAt: String(row.updated_at ?? ''),
      }))
    },

    /** 按 id 获取单个成本项（含工艺与字段） */
    getById: async (id: string): Promise<ProductCostItem | null> => {
      const row = await dbConn.prepare('SELECT * FROM product_cost_items WHERE id = ?').get(id)
      if (!row) return null
      const processRows = await dbConn.prepare(
        'SELECT * FROM product_cost_processes WHERE cost_item_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC'
      ).all(id)
      const fieldRows = await dbConn.prepare(
        'SELECT * FROM product_cost_custom_fields WHERE cost_item_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC'
      ).all(id)
      return {
        id: row.id,
        name: row.name || '',
        sortOrder: Number(row.sort_order ?? 0),
        processes: processRows.map(parseCostProcessRow),
        fields: fieldRows.map(parseCostFieldRow),
        createdAt: String(row.created_at ?? ''),
        updatedAt: String(row.updated_at ?? ''),
      }
    },

    /** 新增成本项 */
    createItem: async (name: string): Promise<ProductCostItem> => {
      const id = `pci-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      // 排在已有成本项之后（小在前）
      const maxRow = await dbConn.prepare(
        'SELECT MAX(sort_order) AS maxSort FROM product_cost_items'
      ).get() as { maxSort: number | null } | null
      const sortOrder = Number(maxRow?.maxSort ?? 0) + 1
      await dbConn.prepare('INSERT INTO product_cost_items (id, name, sort_order) VALUES (?, ?, ?)')
        .run(id, name, sortOrder)
      return (await db.productCostItems.getById(id))!
    },

    /** 更新成本项名称 */
    updateItem: async (id: string, name: string): Promise<ProductCostItem | null> => {
      const info = await dbConn.prepare('UPDATE product_cost_items SET name = ? WHERE id = ?').run(name, id)
      if (info.changes === 0) return null
      return db.productCostItems.getById(id)
    },

    /** 删除成本项（事务级联删除其下全部工艺与字段定义） */
    deleteItem: async (id: string): Promise<boolean> => {
      const run = dbConn.transaction(async () => {
        const item = await dbConn.prepare('SELECT id FROM product_cost_items WHERE id = ?').get(id)
        if (!item) return false
        await dbConn.prepare('DELETE FROM product_cost_processes WHERE cost_item_id = ?').run(id)
        await dbConn.prepare('DELETE FROM product_cost_custom_fields WHERE cost_item_id = ?').run(id)
        await dbConn.prepare('DELETE FROM product_cost_items WHERE id = ?').run(id)
        return true
      })
      return run()
    },

    /** 新增可选工艺（挂在指定成本项下） */
    createProcess: async (costItemId: string, data: {
      name: string
      cost?: number
      formula?: string
      features?: string
      remark?: string
      customValues?: Record<string, string>
    }): Promise<ProductCostProcess | null> => {
      const item = await dbConn.prepare('SELECT id FROM product_cost_items WHERE id = ?').get(costItemId)
      if (!item) return null
      const id = `pcp-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const maxRow = await dbConn.prepare(
        'SELECT MAX(sort_order) AS maxSort FROM product_cost_processes WHERE cost_item_id = ?'
      ).get(costItemId) as { maxSort: number | null } | null
      const sortOrder = Number(maxRow?.maxSort ?? 0) + 1
      await dbConn.prepare(
        `INSERT INTO product_cost_processes
           (id, cost_item_id, name, cost, formula, features, remark, custom_values, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, costItemId, data.name, Number(data.cost ?? 0) || 0,
        data.formula || '', data.features || '', data.remark || '',
        JSON.stringify(data.customValues || {}), sortOrder,
      )
      const row = await dbConn.prepare('SELECT * FROM product_cost_processes WHERE id = ?').get(id)
      return row ? parseCostProcessRow(row) : null
    },

    /**
     * 手动排序可选工艺：processIds 为该成本项下全部工艺 id 的新顺序，
     * 事务内整体重写 sort_order 为 1..N（原子，避免相邻交换产生重复序号）。
     * 传入列表与现有工艺集合不一致（漏传/多传/重复/混入其他成本项工艺）时抛错。
     */
    reorderProcesses: async (costItemId: string, processIds: string[]): Promise<ProductCostItem | null> => {
      const item = await dbConn.prepare('SELECT id FROM product_cost_items WHERE id = ?').get(costItemId)
      if (!item) return null
      const existingRows = await dbConn.prepare(
        'SELECT id FROM product_cost_processes WHERE cost_item_id = ?'
      ).all(costItemId)
      const existingIds = new Set(existingRows.map((r) => String(r.id)))
      const uniqueIds = new Set(processIds)
      if (uniqueIds.size !== processIds.length) {
        throw new Error('工艺排序列表存在重复 id')
      }
      if (uniqueIds.size !== existingIds.size || processIds.some((pid) => !existingIds.has(pid))) {
        throw new Error('工艺排序列表与当前配置不一致，请刷新后重试')
      }
      const run = dbConn.transaction(async () => {
        for (let i = 0; i < processIds.length; i++) {
          await dbConn.prepare(
            'UPDATE product_cost_processes SET sort_order = ? WHERE id = ? AND cost_item_id = ?'
          ).run(i + 1, processIds[i], costItemId)
        }
      })
      await run()
      return db.productCostItems.getById(costItemId)
    },

    /** 更新可选工艺（customValues 仅保留该成本项下仍存在字段的键） */
    updateProcess: async (id: string, data: {
      name?: string
      cost?: number
      formula?: string
      features?: string
      remark?: string
      customValues?: Record<string, string>
    }): Promise<ProductCostProcess | null> => {
      const existing = await dbConn.prepare('SELECT * FROM product_cost_processes WHERE id = ?').get(id)
      if (!existing) return null
      const merged: Record<string, any> = {
        name: data.name !== undefined ? data.name : existing.name,
        cost: data.cost !== undefined ? (Number(data.cost) || 0) : Number(existing.cost ?? 0),
        formula: data.formula !== undefined ? data.formula : existing.formula,
        features: data.features !== undefined ? data.features : existing.features,
        remark: data.remark !== undefined ? data.remark : existing.remark,
      }
      let customValuesJson: string
      if (data.customValues !== undefined) {
        // 只保留成本项下仍存在的字段键，字段删除后的孤儿值不落库
        const fieldRows = await dbConn.prepare('SELECT id FROM product_cost_custom_fields WHERE cost_item_id = ?').all(existing.cost_item_id)
        const fieldIds = new Set(fieldRows.map((r) => r.id))
        const filtered: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.customValues)) {
          if (fieldIds.has(k)) filtered[k] = String(v)
        }
        customValuesJson = JSON.stringify(filtered)
      } else {
        customValuesJson = existing.custom_values || '{}'
      }
      await dbConn.prepare(
        `UPDATE product_cost_processes SET name=?, cost=?, formula=?, features=?, remark=?, custom_values=? WHERE id=?`
      ).run(merged.name, merged.cost, merged.formula, merged.features, merged.remark, customValuesJson, id)
      const row = await dbConn.prepare('SELECT * FROM product_cost_processes WHERE id = ?').get(id)
      return row ? parseCostProcessRow(row) : null
    },

    /** 删除可选工艺 */
    deleteProcess: async (id: string): Promise<boolean> => {
      const info = await dbConn.prepare('DELETE FROM product_cost_processes WHERE id = ?').run(id)
      return info.changes > 0
    },

    /** 新增自定义字段定义 */
    createField: async (costItemId: string, data: {
      name: string
      fieldType?: ProductCostFieldType
      options?: string[]
      visible?: boolean
    }): Promise<ProductCostCustomField | null> => {
      const item = await dbConn.prepare('SELECT id FROM product_cost_items WHERE id = ?').get(costItemId)
      if (!item) return null
      const id = `pcf-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const maxRow = await dbConn.prepare(
        'SELECT MAX(sort_order) AS maxSort FROM product_cost_custom_fields WHERE cost_item_id = ?'
      ).get(costItemId) as { maxSort: number | null } | null
      const sortOrder = Number(maxRow?.maxSort ?? 0) + 1
      await dbConn.prepare(
        `INSERT INTO product_cost_custom_fields (id, cost_item_id, name, field_type, options, visible, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, costItemId, data.name, data.fieldType || 'text',
        JSON.stringify(data.options || []), data.visible === false ? 0 : 1, sortOrder,
      )
      const row = await dbConn.prepare('SELECT * FROM product_cost_custom_fields WHERE id = ?').get(id)
      return row ? parseCostFieldRow(row) : null
    },

    /** 更新自定义字段定义（名称/类型/选项/显隐/排序） */
    updateField: async (id: string, data: {
      name?: string
      fieldType?: ProductCostFieldType
      options?: string[]
      visible?: boolean
      sortOrder?: number
    }): Promise<ProductCostCustomField | null> => {
      const existing = await dbConn.prepare('SELECT * FROM product_cost_custom_fields WHERE id = ?').get(id)
      if (!existing) return null
      const name = data.name !== undefined ? data.name : existing.name
      const fieldType = data.fieldType !== undefined ? data.fieldType : existing.field_type
      const options = data.options !== undefined ? JSON.stringify(data.options) : (existing.options || '[]')
      const visible = data.visible !== undefined ? (data.visible ? 1 : 0) : Number(existing.visible ?? 1)
      const sortOrder = data.sortOrder !== undefined ? Number(data.sortOrder) : Number(existing.sort_order ?? 0)
      await dbConn.prepare(
        `UPDATE product_cost_custom_fields SET name=?, field_type=?, options=?, visible=?, sort_order=? WHERE id=?`
      ).run(name, fieldType, options, visible, sortOrder, id)
      const row = await dbConn.prepare('SELECT * FROM product_cost_custom_fields WHERE id = ?').get(id)
      return row ? parseCostFieldRow(row) : null
    },

    /** 删除自定义字段（事务内同步清理全部工艺 customValues 中的对应键） */
    deleteField: async (id: string): Promise<boolean> => {
      const run = dbConn.transaction(async () => {
        const existing = await dbConn.prepare('SELECT * FROM product_cost_custom_fields WHERE id = ?').get(id)
        if (!existing) return false
        // 清理该成本项下所有工艺的对应字段值，避免孤儿数据
        const processRows = await dbConn.prepare(
          'SELECT id, custom_values FROM product_cost_processes WHERE cost_item_id = ?'
        ).all(existing.cost_item_id)
        for (const p of processRows) {
          let values: Record<string, string> = {}
          try {
            const parsed = typeof p.custom_values === 'string' ? JSON.parse(p.custom_values || '{}') : {}
            values = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {}
          } catch {
            values = {}
          }
          if (id in values) {
            delete values[id]
            await dbConn.prepare('UPDATE product_cost_processes SET custom_values=? WHERE id=?')
              .run(JSON.stringify(values), p.id)
          }
        }
        await dbConn.prepare('DELETE FROM product_cost_custom_fields WHERE id = ?').run(id)
        return true
      })
      return run()
    },
  },

  sheetTemplates: {
    /** 获取全部模板（按款式 code + 排序字段） */
    getAll: async (): Promise<SheetTemplateRecord[]> => {
      const rows = await dbConn.prepare('SELECT * FROM sheet_templates ORDER BY style_code ASC, sort_order ASC, updated_at DESC').all()
      return rows.map(parseSheetTemplateRow)
    },
    /** 获取指定款式的全部模板（一对多） */
    getByStyleCode: async (styleCode: string): Promise<SheetTemplateRecord[]> => {
      const rows = await dbConn.prepare('SELECT * FROM sheet_templates WHERE style_code = ? ORDER BY sort_order ASC, updated_at DESC').all(styleCode)
      return rows.map(parseSheetTemplateRow)
    },
    /** 按 id 获取单个模板 */
    getById: async (id: string): Promise<SheetTemplateRecord | null> => {
      const row = await dbConn.prepare('SELECT * FROM sheet_templates WHERE id = ?').get(id)
      return row ? parseSheetTemplateRow(row as Record<string, any>) : null
    },
    /**
     * 新增模板（一对多：同款式可有多个，名称在款式内唯一）
     * @returns 新建的模板记录；重名时抛出错误
     */
    create: async (styleCode: string, name: string, data: (string | number | null)[][], formulas: Record<string, string>, updatedBy: string): Promise<SheetTemplateRecord> => {
      const trimmed = (name || '').trim()
      if (!trimmed) throw new Error('模板名称不能为空')
      const dup = await dbConn.prepare('SELECT id FROM sheet_templates WHERE style_code = ? AND name = ?').get(styleCode, trimmed)
      if (dup) throw new Error(`该款式下已存在同名模板「${trimmed}」`)
      const id = `sheet-tpl-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      const maxSort = await dbConn.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM sheet_templates WHERE style_code = ?').get(styleCode) as any
      await dbConn.prepare('INSERT INTO sheet_templates (id, style_code, name, data, formulas, sort_order, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, styleCode, trimmed, JSON.stringify(data), JSON.stringify(formulas), Number(maxSort?.max_sort ?? 0) + 1, updatedBy)
      const row = await dbConn.prepare('SELECT * FROM sheet_templates WHERE id = ?').get(id)
      return parseSheetTemplateRow(row as Record<string, any>)
    },
    /**
     * 更新模板（内容必传，名称可选改名）
     * @returns 更新后的模板记录；改名重名时抛出错误
     */
    update: async (id: string, name: string | undefined, data: (string | number | null)[][], formulas: Record<string, string>, updatedBy: string): Promise<SheetTemplateRecord | null> => {
      const existing = await dbConn.prepare('SELECT * FROM sheet_templates WHERE id = ?').get(id)
      if (!existing) return null
      const nextName = name !== undefined ? name.trim() : (existing as any).name
      if (!nextName) throw new Error('模板名称不能为空')
      const dup = await dbConn.prepare('SELECT id FROM sheet_templates WHERE style_code = ? AND name = ? AND id != ?')
        .get((existing as any).style_code, nextName, id)
      if (dup) throw new Error(`该款式下已存在同名模板「${nextName}」`)
      await dbConn.prepare('UPDATE sheet_templates SET name=?, data=?, formulas=?, updated_by=? WHERE id=?')
        .run(nextName, JSON.stringify(data), JSON.stringify(formulas), updatedBy, id)
      const row = await dbConn.prepare('SELECT * FROM sheet_templates WHERE id = ?').get(id)
      return parseSheetTemplateRow(row as Record<string, any>)
    },
    /** 删除模板（订单保存的 tableData 不受影响，历史订单仍可正常编辑） */
    remove: async (id: string): Promise<boolean> => {
      const info = await dbConn.prepare('DELETE FROM sheet_templates WHERE id = ?').run(id)
      return info.changes > 0
    },
  },

  /** 做货流程任务（材料准备项，v24） */
  productionTasks: {
    /** 获取订单的全部任务（按 step_order 升序） */
    getByQuoteId: async (quoteId: string): Promise<ProductionTaskRecord[]> => {
      const rows = await dbConn.prepare(
        'SELECT * FROM quote_production_tasks WHERE quote_id = ? ORDER BY step_order ASC, created_at ASC'
      ).all(quoteId)
      return rows.map(parseProductionTaskRow)
    },
    /**
     * 获取全部订单的做货流程任务总览（JOIN quotes 摘要字段，做货跟踪页用）：
     * 排序在服务层完成（订单按最早日期+订单号，订单内按步骤序），前端直接消费
     */
    getAllWithQuoteInfo: async (): Promise<ProductionTaskOverviewRow[]> => {
      const rows = await dbConn.prepare(`
        SELECT t.*, q.quote_number, q.customerName, q.quantity, q.status AS order_status, q.updated_at AS quote_updated_at
        FROM quote_production_tasks t
        JOIN quotes q ON q.id = t.quote_id
      `).all()
      return rows.map((row) => ({
        ...parseProductionTaskRow(row),
        quoteNumber: String(row.quote_number ?? ''),
        customerName: String(row.customerName ?? ''),
        quantity: String(row.quantity ?? ''),
        orderStatus: Number(row.order_status ?? 0),
        quoteUpdatedAt: String(row.quote_updated_at ?? ''),
      }))
    },
    /**
     * 整体替换订单的任务列表（事务：删 + 批量插）
     * 服务端重排 step_order 并生成新 id，返回落库后的记录
     */
    replaceForQuote: async (quoteId: string, tasks: Array<{
      name: string
      planStart?: string | null
      planEnd?: string | null
      actualStart?: string | null
      actualEnd?: string | null
      status?: number
      remark?: string
      materials?: ProductionTaskMaterial[]
    }>): Promise<ProductionTaskRecord[]> => {
      const run = dbConn.transaction(async () => {
        await dbConn.prepare('DELETE FROM quote_production_tasks WHERE quote_id = ?').run(quoteId)
        const inserted: ProductionTaskRecord[] = []
        const now = timeNow()
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i]
          const id = `prod-task-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`
          await dbConn.prepare(
            `INSERT INTO quote_production_tasks
             (id, quote_id, step_order, name, plan_start, plan_end, actual_start, actual_end, status, remark, materials, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id, quoteId, i + 1, t.name,
            t.planStart || null, t.planEnd || null, t.actualStart || null, t.actualEnd || null,
            Number(t.status ?? 0), t.remark || '',
            JSON.stringify(t.materials || []), now, now,
          )
          inserted.push({
            id, quoteId: quoteId, stepOrder: i + 1, name: t.name,
            planStart: t.planStart || null, planEnd: t.planEnd || null,
            actualStart: t.actualStart || null, actualEnd: t.actualEnd || null,
            status: Number(t.status ?? 0), remark: t.remark || '',
            materials: t.materials || [], createdAt: now, updatedAt: now,
          })
        }
        return inserted
      })
      return run()
    },
  },

  /** 订单对账管理（v28）：工艺成本明细 + 确认/退回对账 */
  reconciliation: {
    /** 获取订单的对账工艺成本明细（按 sort_order 升序） */
    getCosts: async (quoteId: string): Promise<ReconciliationCostRecord[]> => {
      const rows = await dbConn.prepare(
        'SELECT * FROM quote_reconciliation_costs WHERE quote_id = ? ORDER BY sort_order ASC, created_at ASC'
      ).all(quoteId)
      return rows.map(parseReconciliationCostRow)
    },
    /**
     * 整体替换订单的对账工艺成本明细（事务：删 + 批量插）
     * 服务端重排 sort_order 并生成新 id，返回落库后的记录
     */
    replaceCosts: async (quoteId: string, costs: Array<{
      name: string
      unitPrice?: number
      quantity?: number
      cost: number
      remark?: string
    }>): Promise<ReconciliationCostRecord[]> => {
      const run = dbConn.transaction(async () => {
        await dbConn.prepare('DELETE FROM quote_reconciliation_costs WHERE quote_id = ?').run(quoteId)
        const inserted: ReconciliationCostRecord[] = []
        const now = timeNow()
        for (let i = 0; i < costs.length; i++) {
          const c = costs[i]
          const id = `recon-cost-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`
          await dbConn.prepare(
            `INSERT INTO quote_reconciliation_costs
             (id, quote_id, name, unit_price, quantity, cost, remark, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id, quoteId, c.name,
            Math.round((Number(c.unitPrice) || 0) * 100) / 100,
            Math.round((Number(c.quantity) || 0) * 100) / 100,
            Math.round((Number(c.cost) || 0) * 100) / 100,
            c.remark || '', i + 1, now, now,
          )
          inserted.push({
            id, quoteId, name: c.name,
            unitPrice: Math.round((Number(c.unitPrice) || 0) * 100) / 100,
            quantity: Math.round((Number(c.quantity) || 0) * 100) / 100,
            cost: Math.round((Number(c.cost) || 0) * 100) / 100,
            remark: c.remark || '', sortOrder: i + 1, createdAt: now, updatedAt: now,
          })
        }
        return inserted
      })
      return run()
    },
    /**
     * 确认对账：已发货已收款(5) → 已对账(8)，记录对账时间
     * 非 5 状态时原样返回（不流转）
     */
    reconcileQuote: async (id: string): Promise<Quote | null> => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      if ((existing as any).status !== 5) return toCamelRow(existing) as Quote
      const today = new Date().toISOString().split('T')[0]
      await dbConn.prepare(
        'UPDATE quotes SET status = 8, reconciledTime = ?, updated_at = ? WHERE id = ?'
      ).run(today, timeNow(), id)
      const updated = toCamelRow(existing) as any
      updated.status = 8
      updated.reconciledTime = today
      updated.updated_at = timeNow()
      return updated as Quote
    },
    /**
     * 退回对账：已对账(8) → 已发货已收款(5)，清空对账时间（重新核对后可再次确认）
     * 非 8 状态时原样返回（不流转）
     */
    unreconcileQuote: async (id: string): Promise<Quote | null> => {
      const existing = await dbConn.prepare('SELECT * FROM quotes WHERE id = ?').get(id) as Quote | null
      if (!existing) return null
      if ((existing as any).status !== 8) return toCamelRow(existing) as Quote
      await dbConn.prepare(
        'UPDATE quotes SET status = 5, reconciledTime = ?, updated_at = ? WHERE id = ?'
      ).run('', timeNow(), id)
      const updated = toCamelRow(existing) as any
      updated.status = 5
      updated.reconciledTime = ''
      updated.updated_at = timeNow()
      return updated as Quote
    },
  },
}

export const db = dbApi
export default dbApi
