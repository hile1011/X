import dotenv from 'dotenv'
import path from 'path'
import { pool, initDatabase, closePool, withTransaction, execMultiStatement } from './dbClient.js'
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from './migrations/index.js'

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') })

async function main() {
  await initDatabase()

  // 创建一个简单的 wrapper 供 MigrationRunner 使用
  const dbConn = {
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
  }

  const runner = new MigrationRunner(dbConn)
  const currentVersion = await runner.getCurrentVersion()

  console.log(`[Migration] 当前版本: v${currentVersion}`)
  console.log(`[Migration] 目标版本: v${CURRENT_SCHEMA_VERSION}`)

  const pending = runner.getPendingMigrations()
  if (pending.length === 0) {
    console.log('[Migration] 无需执行的迁移')
    await closePool()
    process.exit(0)
  }

  console.log(`[Migration] 待执行: ${pending.map((m) => `v${m.version} - ${m.name}`).join(', ')}`)

  const result = await runner.migrate()
  if (result.applied.length > 0) {
    console.log('[Migration] 已执行:')
    result.applied.forEach((m) => console.log(`  ✅ ${m}`))
  }
  if (result.skipped.length > 0) {
    console.log('[Migration] 已跳过:')
    result.skipped.forEach((m) => console.log(`  ⏭️ ${m}`))
  }

  console.log(`[Migration] 完成，当前版本: v${await runner.getCurrentVersion()}`)
  await closePool()
}

main().catch((err) => {
  console.error('[Migration] 失败:', err)
  process.exit(1)
})
