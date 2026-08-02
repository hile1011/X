import initSqlJs from 'sql.js'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') })

const SQL = await initSqlJs()

const dbPath = process.env.DB_PATH || './data/quote-system.db'
const dbDir = path.dirname(path.resolve(dbPath))
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const resolvedPath = path.resolve(dbPath)
let db: any
if (fs.existsSync(resolvedPath)) {
  const fileBuffer = fs.readFileSync(resolvedPath)
  db = new SQL.Database(fileBuffer)
} else {
  db = new SQL.Database()
}

const persist = () => {
  if (dbPath !== ':memory:') {
    const data = db.export()
    fs.writeFileSync(resolvedPath, Buffer.from(data))
  }
}

const customers = [
  { id: 'cust-001', name: '上海科技有限公司', contact_person: '张三', phone: '13800138001', email: 'zhangsan@shanghai-tech.com', address: '上海市浦东新区张江高科技园区', industry: 'IT' },
  { id: 'cust-002', name: '北京贸易有限公司', contact_person: '李四', phone: '13900139002', email: 'lisi@beijing-trade.com', address: '北京市朝阳区望京SOHO', industry: '零售' },
  { id: 'cust-003', name: '深圳制造有限公司', contact_person: '王五', phone: '13700137003', email: 'wangwu@shenzhen-mfg.com', address: '深圳市南山区科技园', industry: '制造' },
]

const products = [
  { id: 'prod-001', name: '无底无侧普通袋', sku: 'BAG-001', description: '无底无侧普通款帆布袋', price: 3.5, category: '帆布袋', stock: 10000 },
  { id: 'prod-002', name: '有底无侧普通袋', sku: 'BAG-002', description: '有底无侧普通款帆布袋', price: 4.2, category: '帆布袋', stock: 8000 },
  { id: 'prod-003', name: '有底有侧普通袋', sku: 'BAG-003', description: '有底有侧普通款帆布袋', price: 5.0, category: '帆布袋', stock: 6000 },
  { id: 'prod-004', name: '手提连底普通拼接袋', sku: 'BAG-004', description: '手提连底普通拼接款帆布袋', price: 4.8, category: '帆布袋', stock: 5000 },
  { id: 'prod-005', name: '手提连底高级拼接袋', sku: 'BAG-005', description: '手提连底高级拼接款帆布袋', price: 6.5, category: '帆布袋', stock: 3000 },
  { id: 'prod-006', name: '手提无连底拼接袋', sku: 'BAG-006', description: '手提无连底拼接款帆布袋', price: 5.2, category: '帆布袋', stock: 4000 },
]

const processCosts = [
  { id: 'pc-001', name: '单面数码UV印刷', cost: 0.8, formula: '印刷面积 × 单价' },
  { id: 'pc-002', name: '双面数码UV印刷', cost: 1.5, formula: '印刷面积 × 单价 × 2' },
  { id: 'pc-003', name: '热转印印刷', cost: 0.5, formula: '印刷面积 × 单价' },
  { id: 'pc-004', name: '丝网印刷', cost: 0.3, formula: '印刷面积 × 单价 × 色数' },
]

const seed = () => {
  for (const c of customers) {
    db.run(`INSERT OR IGNORE INTO customers (id, name, contact_person, phone, email, address, industry)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [c.id, c.name, c.contact_person, c.phone, c.email, c.address, c.industry])
  }

  for (const p of products) {
    db.run(`INSERT OR IGNORE INTO products (id, name, sku, description, price, category, stock)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [p.id, p.name, p.sku, p.description, p.price, p.category, p.stock])
  }

  for (const pc of processCosts) {
    db.run(`INSERT OR IGNORE INTO process_costs (id, name, cost, formula)
      VALUES (?, ?, ?, ?)`, [pc.id, pc.name, pc.cost, pc.formula])
  }
}

seed()

const countRows = (table: string) => {
  const stmt = db.prepare(`SELECT COUNT(*) as c FROM ${table}`)
  stmt.step()
  const row = stmt.getAsObject()
  stmt.free()
  return row.c
}

console.log('[Seed] 数据初始化完成:')
console.log(`  客户: ${countRows('customers')} 条`)
console.log(`  产品: ${countRows('products')} 条`)
console.log(`  工艺成本: ${countRows('process_costs')} 条`)

persist()
console.log(`[Seed] 数据已保存至: ${resolvedPath}`)
db.close()
