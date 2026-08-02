export const CURRENT_SCHEMA_VERSION = 3

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
