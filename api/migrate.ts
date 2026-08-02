import initSqlJs from 'sql.js'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from './migrations/index.js'

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') })

const SQL = await initSqlJs()

const dbPath = process.env.DB_PATH || './data/quote-system.db'
const dbDir = path.dirname(path.resolve(dbPath))
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const resolvedPath = path.resolve(dbPath)
let rawDb: any
if (fs.existsSync(resolvedPath)) {
  const fileBuffer = fs.readFileSync(resolvedPath)
  rawDb = new SQL.Database(fileBuffer)
} else {
  rawDb = new SQL.Database()
}

const persist = () => {
  const data = rawDb.export()
  fs.writeFileSync(resolvedPath, Buffer.from(data))
}

const dbWrapper = {
  exec: (sql: string) => rawDb.run(sql),
  prepare: (sql: string) => ({
    run: (...params: any[]) => {
      const stmt = rawDb.prepare(sql)
      stmt.bind(params)
      stmt.step()
      const changes = rawDb.getRowsModified()
      stmt.free()
      return { changes }
    },
    get: (...params: any[]) => {
      const stmt = rawDb.prepare(sql)
      stmt.bind(params)
      const hasRow = stmt.step()
      const row = hasRow ? stmt.getAsObject() : null
      stmt.free()
      return row
    },
    all: (...params: any[]) => {
      const stmt = rawDb.prepare(sql)
      stmt.bind(params)
      const rows: Record<string, any>[] = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject())
      }
      stmt.free()
      return rows
    },
  }),
  transaction: (fn: () => any) => () => {
    rawDb.run('BEGIN')
    try {
      const result = fn()
      rawDb.run('COMMIT')
      return result
    } catch (e) {
      rawDb.run('ROLLBACK')
      throw e
    }
  },
}

const runner = new MigrationRunner(dbWrapper)
const currentVersion = runner.getCurrentVersion()

console.log(`[Migration] 当前版本: v${currentVersion}`)
console.log(`[Migration] 目标版本: v${CURRENT_SCHEMA_VERSION}`)

const pending = runner.getPendingMigrations()
if (pending.length === 0) {
  console.log('[Migration] 无需执行的迁移')
  rawDb.close()
  process.exit(0)
}

console.log(`[Migration] 待执行: ${pending.map((m) => `v${m.version} - ${m.name}`).join(', ')}`)

const result = runner.migrate()
if (result.applied.length > 0) {
  console.log('[Migration] 已执行:')
  result.applied.forEach((m) => console.log(`  ✅ ${m}`))
}
if (result.skipped.length > 0) {
  console.log('[Migration] 已跳过:')
  result.skipped.forEach((m) => console.log(`  ⏭️ ${m}`))
}

persist()
console.log(`[Migration] 完成，当前版本: v${runner.getCurrentVersion()}`)
rawDb.close()
