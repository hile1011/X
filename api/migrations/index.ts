export const CURRENT_SCHEMA_VERSION = 7

export interface Migration {
  version: number
  name: string
  description: string
  up: (db: any) => void
  down: (db: any) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    description: '初始化数据库表结构（客户、产品、订单、任务、报价、工艺成本）',
    up: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          applied_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          contact_person TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          email TEXT DEFAULT '',
          address TEXT DEFAULT '',
          industry TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT DEFAULT '',
          description TEXT DEFAULT '',
          price REAL DEFAULT 0,
          category TEXT DEFAULT '',
          stock INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT '',
          customer_id TEXT DEFAULT '',
          quote_id TEXT DEFAULT '',
          order_number TEXT DEFAULT '',
          status TEXT DEFAULT 'pending',
          total_amount REAL DEFAULT 0,
          remarks TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          product_id TEXT DEFAULT '',
          quantity INTEGER DEFAULT 0,
          unit_price REAL DEFAULT 0,
          amount REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT '',
          order_id TEXT DEFAULT '',
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          status TEXT DEFAULT 'pending',
          due_date TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS quotes (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT '',
          customer_id TEXT DEFAULT '',
          quote_number TEXT NOT NULL,
          customerName TEXT NOT NULL,
          shippingAddress TEXT DEFAULT '',
          productStyle TEXT DEFAULT '1',
          productSpec TEXT DEFAULT '',
          fabricMaterial TEXT DEFAULT '10安涤棉新本色',
          process TEXT DEFAULT '单面数码uv印刷',
          handleMaterial TEXT DEFAULT '帆布手提',
          handleSpec TEXT DEFAULT '',
          quantity TEXT DEFAULT '',
          boxSpec TEXT DEFAULT '',
          remark TEXT DEFAULT '',
          sampleFee TEXT DEFAULT '',
          sampleDays TEXT DEFAULT '',
          massDays TEXT DEFAULT '',
          unitPrice TEXT DEFAULT '',
          productionTimeStart TEXT DEFAULT '',
          productionTimeEnd TEXT DEFAULT '',
          sellPriceNoTax REAL DEFAULT 0,
          sellPriceWithTax REAL DEFAULT 0,
          status INTEGER DEFAULT 1,
          quoteTime TEXT DEFAULT '',
          sampleTime TEXT DEFAULT '',
          productionStartTime TEXT DEFAULT '',
          shippingTime TEXT DEFAULT '',
          paymentTime TEXT DEFAULT '',
          endTime TEXT DEFAULT '',
          images TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS process_costs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          cost REAL DEFAULT 0,
          formula TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_quotes_customerName ON quotes(customerName);
        CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
        CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      `)
    },
    down: (db: any) => {
      db.exec(`
        DROP TABLE IF EXISTS schema_migrations;
        DROP TABLE IF EXISTS customers;
        DROP TABLE IF EXISTS products;
        DROP TABLE IF EXISTS orders;
        DROP TABLE IF EXISTS order_items;
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS quotes;
        DROP TABLE IF EXISTS process_costs;
      `)
    },
  },
  {
    version: 2,
    name: 'add-cost-price',
    description: '为 quotes 表添加成本价字段（costPrice），来源为在线表格汇总行与参考卖价列交叉单元格',
    up: (db: any) => {
      db.exec(`ALTER TABLE quotes ADD COLUMN costPrice REAL DEFAULT 0`)
    },
    down: (db: any) => {
      // SQLite 不支持 DROP COLUMN（旧版本），通过重建表实现
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, sellPriceNoTax, sellPriceWithTax, status,
          quoteTime, sampleTime, productionStartTime, shippingTime, paymentTime, endTime, images,
          created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 3,
    name: 'add-price-with-tax',
    description: '为 quotes 表添加含税价字段（priceWithTax），即成本含税价 = 成本价 × 1.1，支持手动覆盖',
    up: (db: any) => {
      db.exec(`ALTER TABLE quotes ADD COLUMN priceWithTax REAL DEFAULT 0`)
    },
    down: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, sellPriceNoTax, sellPriceWithTax, costPrice,
          status, quoteTime, sampleTime, productionStartTime, shippingTime, paymentTime, endTime,
          images, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 4,
    name: 'migrate-productstyle-to-numeric',
    description: 'V0.3：将 quotes 表 productStyle 字段从中文名称迁移为数字编码（1-6），统一前后端枚举值，并重建 quote_number 中款式部分',
    up: (db: any) => {
      // 中文标签 → 数字编码映射表
      const styleMap: Record<string, string> = {
        '无底无侧普通袋': '1',
        '有底无侧普通袋': '2',
        '有底有侧普通袋': '3',
        '手提连底普通拼接袋': '4',
        '手提连底高级拼接袋': '5',
        '手提无连底拼接袋': '6',
        // 兼容历史变体
        '无底无侧普通款': '1',
        '手提无连底拼接款': '6',
      }

      // 逐行迁移 productStyle 字段
      const rows = db.prepare('SELECT id, productStyle, quote_number FROM quotes').all() as {
        id: string
        productStyle: string
        quote_number: string
      }[]

      const updateStmt = db.prepare('UPDATE quotes SET productStyle = ?, quote_number = ? WHERE id = ?')

      for (const row of rows) {
        const currentStyle = row.productStyle ?? ''
        // 已经是数字编码则跳过（幂等性保证）
        if (/^[1-6]$/.test(currentStyle)) continue

        const numericStyle = styleMap[currentStyle] ?? '1' // 未知值默认为 '1'
        // 重建 quote_number：将中文款式部分替换为数字编码
        let newQuoteNumber = row.quote_number ?? ''
        for (const [label, code] of Object.entries(styleMap)) {
          if (newQuoteNumber.includes(label)) {
            newQuoteNumber = newQuoteNumber.replace(label, code)
            break
          }
        }
        updateStmt.run(numericStyle, newQuoteNumber, row.id)
      }
    },
    down: (db: any) => {
      // 回滚：将数字编码还原为中文名称
      const labelMap: Record<string, string> = {
        '1': '无底无侧普通袋',
        '2': '有底无侧普通袋',
        '3': '有底有侧普通袋',
        '4': '手提连底普通拼接袋',
        '5': '手提连底高级拼接袋',
        '6': '手提无连底拼接袋',
      }

      const rows = db.prepare('SELECT id, productStyle, quote_number FROM quotes').all() as {
        id: string
        productStyle: string
        quote_number: string
      }[]

      const updateStmt = db.prepare('UPDATE quotes SET productStyle = ?, quote_number = ? WHERE id = ?')

      for (const row of rows) {
        const currentStyle = row.productStyle ?? ''
        // 已经是中文则跳过
        if (!/^[1-6]$/.test(currentStyle)) continue

        const label = labelMap[currentStyle] ?? currentStyle
        // 还原 quote_number
        let newQuoteNumber = row.quote_number ?? ''
        newQuoteNumber = newQuoteNumber.replace(currentStyle, label)
        updateStmt.run(label, newQuoteNumber, row.id)
      }
    },
  },
  {
    version: 5,
    name: 'add-table-data',
    description: '为 quotes 表添加 tableData 字段，持久化在线表格二维数据（用户编辑后的值），仅新增订单时从模板加载，后续以数据库为准',
    up: (db: any) => {
      // tableData 存储 JSON 字符串：二维数组 (string|number|null)[][]
      db.exec(`ALTER TABLE quotes ADD COLUMN tableData TEXT DEFAULT '[]'`)
    },
    down: (db: any) => {
      // 重建表移除 tableData 列（SQLite 旧版本不支持 DROP COLUMN）
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, costPrice, priceWithTax, sellPriceNoTax,
          sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime, shippingTime,
          paymentTime, endTime, images, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 6,
    name: 'add-removed-formula-addresses',
    description: '为 quotes 表添加 removedFormulaAddresses 字段，持久化用户已删除的公式地址列表，加载时排除这些公式使 tableData 值生效',
    up: (db: any) => {
      // removedFormulaAddresses 存储 JSON 字符串：字符串数组 ["J8", "K9"]
      db.exec(`ALTER TABLE quotes ADD COLUMN removedFormulaAddresses TEXT DEFAULT '[]'`)
    },
    down: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, costPrice, priceWithTax, sellPriceNoTax,
          sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime, shippingTime,
          paymentTime, endTime, images, tableData, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 7,
    name: 'add-product-code-and-default-styles',
    description: 'V0.4：为 products 表添加 code 字段（款式编码，对应 quotes.productStyle 1-6），并插入 6 条默认款式产品，使款式数据来源由产品管理模块统一管理',
    up: (db: any) => {
      // 1. 新增 code 字段（可空，普通产品可为空）
      db.exec(`ALTER TABLE products ADD COLUMN code TEXT DEFAULT ''`)

      // 2. 创建唯一索引：非空 code 唯一，避免重复款式编码；空 code 允许多条（普通产品）
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON products(code) WHERE code != ''`)

      // 3. 插入 6 条默认款式产品（幂等：INSERT OR IGNORE 保证重复执行不报错）
      const insertStmt = db.prepare(
        `INSERT OR IGNORE INTO products (id, name, code, sku, description, price, category, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const defaultStyles = [
        { id: 'style-1', name: '无底无侧普通袋', code: '1' },
        { id: 'style-2', name: '有底无侧普通袋', code: '2' },
        { id: 'style-3', name: '有底有侧普通袋', code: '3' },
        { id: 'style-4', name: '手提连底普通拼接袋', code: '4' },
        { id: 'style-5', name: '手提连底高级拼接袋', code: '5' },
        { id: 'style-6', name: '手提无连底拼接袋', code: '6' },
      ]
      for (const s of defaultStyles) {
        insertStmt.run(s.id, s.name, s.code, `STYLE-${s.code}`, `${s.name}款式`, 0, '款式', 0)
      }
    },
    down: (db: any) => {
      // 1. 删除插入的默认款式产品
      db.exec(`DELETE FROM products WHERE id IN ('style-1','style-2','style-3','style-4','style-5','style-6')`)
      // 2. 删除唯一索引
      db.exec(`DROP INDEX IF EXISTS idx_products_code`)
      // 3. 重建 products 表移除 code 列（SQLite 旧版本不支持 DROP COLUMN）
      db.exec(`
        CREATE TABLE IF NOT EXISTS products_backup AS SELECT id, name, sku, description, price, category, stock, created_at, updated_at FROM products;
        DROP TABLE products;
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT DEFAULT '',
          description TEXT DEFAULT '',
          price REAL DEFAULT 0,
          category TEXT DEFAULT '',
          stock INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        INSERT INTO products SELECT id, name, sku, description, price, category, stock, created_at, updated_at FROM products_backup;
        DROP TABLE products_backup;
      `)
    },
  },
]

export class MigrationRunner {
  private db: any
  private appliedVersions: Set<number> = new Set()

  constructor(db: any) {
    this.db = db
    this.ensureMigrationTable()
    this.loadAppliedVersions()
  }

  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        applied_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `)
  }

  private loadAppliedVersions(): void {
    const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
    this.appliedVersions = new Set(rows.map((r) => r.version))
  }

  getCurrentVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null }
    return row.v ?? 0
  }

  getPendingMigrations(): Migration[] {
    return migrations.filter((m) => !this.appliedVersions.has(m.version))
  }

  migrate(upToVersion?: number): { applied: string[]; skipped: string[] } {
    const pending = this.getPendingMigrations()
    const targetVersion = upToVersion ?? CURRENT_SCHEMA_VERSION
    const toApply = pending.filter((m) => m.version <= targetVersion)

    const applied: string[] = []
    const skipped: string[] = []

    if (toApply.length === 0) {
      skipped.push('无待执行的迁移')
      return { applied, skipped }
    }

    const migrateAll = this.db.transaction(() => {
      for (const migration of toApply) {
        migration.up(this.db)
        this.db.prepare(
          'INSERT INTO schema_migrations (version, name, description) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, migration.description)
        this.appliedVersions.add(migration.version)
        applied.push(`v${String(migration.version).padStart(4, '0')} - ${migration.name}`)
      }
    })

    migrateAll()

    return { applied, skipped }
  }

  rollback(toVersion: number): { rolledBack: string[] } {
    const applied = migrations
      .filter((m) => this.appliedVersions.has(m.version) && m.version > toVersion)
      .sort((a, b) => b.version - a.version)

    const rolledBack: string[] = []

    const rollbackAll = this.db.transaction(() => {
      for (const migration of applied) {
        migration.down(this.db)
        this.db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.version)
        this.appliedVersions.delete(migration.version)
        rolledBack.push(`v${String(migration.version).padStart(4, '0')} - ${migration.name}`)
      }
    })

    rollbackAll()

    return { rolledBack }
  }

  reset(): { rolledBack: string[] } {
    return this.rollback(0)
  }

  static fromPath(): Migration[] {
    return migrations
  }
}

export function getMigrations(): Migration[] {
  return [...migrations]
}
