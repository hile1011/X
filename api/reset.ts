import initSqlJs from 'sql.js'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { MigrationRunner } from './migrations/index.js'

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') })

const SQL = await initSqlJs()

const dbPath = process.env.DB_PATH || './data/quote-system.db'
const resolvedPath = path.resolve(dbPath)

if (fs.existsSync(resolvedPath)) {
  console.log(`[Reset] 删除数据库文件: ${resolvedPath}`)
  fs.unlinkSync(resolvedPath)
}

const dbDir = path.dirname(resolvedPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const rawDb = new SQL.Database()

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
const result = runner.migrate()

console.log('[Reset] 数据库已重置')
if (result.applied.length > 0) {
  console.log('[Reset] 执行的迁移:')
  result.applied.forEach((m) => console.log(`  ✅ ${m}`))
}

persist()
console.log('[Reset] 提示: 运行 npm run db:seed 可填充初始数据')
rawDb.close()
