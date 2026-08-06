import dotenv from 'dotenv'
import path from 'path'
import { pool, initDatabase, closePool, withTransaction, execMultiStatement } from './dbClient.js'
import { MigrationRunner } from './migrations/index.js'

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') })

async function main() {
  await initDatabase()

  console.log('[Reset] 删除所有表...')

  // 关闭外键检查，删除所有表，然后重新创建
  await pool.query('SET FOREIGN_KEY_CHECKS = 0')
  const [tables] = await pool.query('SHOW TABLES') as any
  for (const row of tables) {
    const tableName = Object.values(row)[0] as string
    await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``)
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1')

  console.log('[Reset] 所有表已删除，重新执行迁移...')

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
  const result = await runner.migrate()

  console.log('[Reset] 数据库已重置')
  if (result.applied.length > 0) {
    console.log('[Reset] 执行的迁移:')
    result.applied.forEach((m) => console.log(`  ✅ ${m}`))
  }

  console.log('[Reset] 提示: 运行 npm run db:seed 可填充初始数据')
  await closePool()
}

main().catch((err) => {
  console.error('[Reset] 失败:', err)
  process.exit(1)
})
