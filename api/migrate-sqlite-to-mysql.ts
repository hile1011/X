/**
 * SQLite → MySQL 一次性数据迁移脚本
 *
 * 用途：将旧 SQLite 数据库文件（./data/quote-system.db）中的业务数据迁移到 MySQL。
 *
 * 流程：
 *   1. 用 sql.js 只读打开 SQLite 源文件
 *   2. 初始化 MySQL 数据库（CREATE DATABASE IF NOT EXISTS）
 *   3. 删除 MySQL 中所有现有表（清理旧数据）
 *   4. 执行迁移重建 schema（migrate to v10，含 v7 默认款式插入）
 *   5. TRUNCATE 业务表（清除 v7 插入的默认款式，以 SQLite 源数据为准）
 *   6. 按外键依赖顺序逐表迁移：customers → products → process_costs → quotes → orders → order_items → tasks
 *   7. 行数对比校验 + 抽查 JSON 完整性
 *
 * 用法：
 *   SQLITE_SOURCE_PATH=./data/quote-system.db MYSQL_DATABASE=quote_system tsx api/migrate-sqlite-to-mysql.ts
 *
 * 生产环境升级步骤：
 *   1. 停止后端服务（bash scripts/stop.sh）
 *   2. 备份 SQLite 文件（cp data/quote-system.db data/backup/quote-system-$(date +%Y%m%d).db）
 *   3. 确保 MySQL 已安装并运行，root 用户可连接
 *   4. 在 api/.env 中配置 MYSQL_* 参数（或通过环境变量传入）
 *   5. 执行：SQLITE_SOURCE_PATH=./data/quote-system.db npm run tsx api/migrate-sqlite-to-mysql.ts
 *   6. 验证：对比行数、抽查记录、启动后端 curl 验证
 *   7. 归档 SQLite 文件：mv data/quote-system.db data/backup/sqlite-pre-migration/
 */
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { pool, initDatabase, closePool, withTransaction, execMultiStatement } from './dbClient.js'
import { MigrationRunner, CURRENT_SCHEMA_VERSION } from './migrations/index.js'

dotenv.config({ path: path.resolve(process.cwd(), 'api/.env') })

// sql.js 是 CommonJS 模块，在 ESM 项目中通过 createRequire 导入
const require = createRequire(import.meta.url)
const initSqlJs = require('sql.js') as (config?: { locateFile?: (file: string) => string }) => Promise<any>

/** 迁移顺序：按外键依赖排列，被依赖的表先迁移 */
const MIGRATION_ORDER = [
  'customers',
  'products',
  'process_costs',
  'quotes',
  'orders',
  'order_items',
  'tasks',
] as const

/** 每批 INSERT 的行数 */
const BATCH_SIZE = 500

/**
 * 读取 SQLite 表的所有列名
 */
function getSqliteColumns(sqliteDb: any, table: string): string[] {
  const result = sqliteDb.exec(`PRAGMA table_info(${table})`)
  if (!result.length) return []
  return result[0].values.map((row: any[]) => row[1] as string)
}

/**
 * 读取 SQLite 表的所有数据行
 */
function readSqliteTable(sqliteDb: any, table: string): { columns: string[]; rows: any[][] } {
  const columns = getSqliteColumns(sqliteDb, table)
  if (columns.length === 0) return { columns, rows: [] }
  const result = sqliteDb.exec(`SELECT * FROM ${table}`)
  if (!result.length) return { columns, rows: [] }
  return { columns, rows: result[0].values }
}

/**
 * 将 SQLite 值适配为 MySQL 可接受的值
 * - undefined → null（mysql2 不接受 undefined）
 * - DATETIME 列的 ISO 8601 字符串 → MySQL DATETIME 格式（YYYY-MM-DD HH:MM:SS）
 * - 其余原样传递（JSON 字段在 SQLite 中已是字符串，直接写入 LONGTEXT）
 */
function adaptValue(value: any, columnName: string): any {
  if (value === undefined) return null
  // created_at / updated_at 在 SQLite 中可能以 ISO 8601 存储（如 2026-08-04T14:24:21.980Z），
  // MySQL DATETIME 不接受 T 分隔符和 Z 后缀，需转换为 'YYYY-MM-DD HH:MM:SS'
  if (
    (columnName === 'created_at' || columnName === 'updated_at') &&
    typeof value === 'string' &&
    value.includes('T')
  ) {
    return value.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '')
  }
  return value
}

/**
 * 分批插入数据到 MySQL 表
 */
async function insertBatch(
  table: string,
  columns: string[],
  rows: any[][],
): Promise<number> {
  if (rows.length === 0) return 0

  const placeholders = columns.map(() => '?').join(', ')
  const columnList = columns.map((c) => `\`${c}\``).join(', ')
  const sql = `INSERT INTO \`${table}\` (${columnList}) VALUES (${placeholders})`

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const params = batch.map((row) => row.map((val, colIdx) => adaptValue(val, columns[colIdx])))
    // 使用事务批量插入
    await withTransaction(async (conn) => {
      for (const rowParams of params) {
        await conn.execute(sql, rowParams)
        inserted++
      }
    })
  }
  return inserted
}

/**
 * 获取 MySQL 表的行数
 */
async function getMysqlCount(table: string): Promise<number> {
  const [rows] = await pool.execute(`SELECT COUNT(*) as cnt FROM \`${table}\``)
  return (rows as any[])[0].cnt
}

async function main() {
  const sqlitePath = process.env.SQLITE_SOURCE_PATH || './data/quote-system.db'
  const resolvedPath = path.resolve(process.cwd(), sqlitePath)

  console.log('='.repeat(60))
  console.log('  SQLite → MySQL 数据迁移')
  console.log('='.repeat(60))
  console.log(`  SQLite 源文件: ${resolvedPath}`)
  console.log(`  MySQL 数据库:  ${process.env.MYSQL_DATABASE || 'quote_system'}`)
  console.log(`  MySQL 主机:    ${process.env.MYSQL_HOST || '127.0.0.1'}:${process.env.MYSQL_PORT || '3306'}`)
  console.log('='.repeat(60))

  // 1. 检查 SQLite 源文件
  if (!fs.existsSync(resolvedPath)) {
    console.error(`[迁移失败] SQLite 源文件不存在: ${resolvedPath}`)
    process.exit(1)
  }

  // 2. 用 sql.js 只读打开 SQLite
  console.log('\n[1/7] 打开 SQLite 源文件...')
  const SQL = await initSqlJs()
  const sqliteBuf = fs.readFileSync(resolvedPath)
  const sqliteDb = new SQL.Database(sqliteBuf)

  // 3. 初始化 MySQL 数据库
  console.log('[2/7] 初始化 MySQL 数据库...')
  await initDatabase()

  // 4. 删除 MySQL 中所有现有表（清理旧数据）
  console.log('[3/7] 清理 MySQL 现有表...')
  await pool.query('SET FOREIGN_KEY_CHECKS = 0')
  const [tables] = await pool.query('SHOW TABLES') as any
  for (const row of tables) {
    const tableName = Object.values(row)[0] as string
    await pool.query(`DROP TABLE IF EXISTS \`${tableName}\``)
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1')
  console.log(`  已删除 ${tables.length} 张表`)

  // 5. 执行迁移重建 schema
  console.log('[4/7] 执行迁移重建 schema...')
  const dbConn = {
    async exec(sql: string) {
      await execMultiStatement(sql)
    },
    prepare(sql: string) {
      const sanitize = (params: any[]) => params.map((p) => (p === undefined ? null : p))
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
  const migrateResult = await runner.migrate()
  const mysqlVersion = await runner.getCurrentVersion()
  console.log(`  MySQL schema 版本: v${mysqlVersion} (目标 v${CURRENT_SCHEMA_VERSION})`)
  if (migrateResult.applied.length > 0) {
    migrateResult.applied.forEach((m) => console.log(`  ✅ ${m}`))
  }

  // 6. TRUNCATE 业务表（清除 v7 迁移插入的默认款式，以 SQLite 源数据为准）
  console.log('[5/7] 清除 v7 迁移插入的默认数据，以 SQLite 源数据为准...')
  await pool.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const table of MIGRATION_ORDER) {
    await pool.query(`TRUNCATE TABLE \`${table}\``)
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1')

  // 7. 逐表迁移数据
  console.log('[6/7] 迁移业务数据...')
  const summary: { table: string; sqlite: number; mysql: number; ok: boolean }[] = []

  for (const table of MIGRATION_ORDER) {
    const { columns, rows } = readSqliteTable(sqliteDb, table)
    const sqliteCount = rows.length

    if (sqliteCount === 0) {
      console.log(`  ${table}: 0 行（跳过）`)
      const mysqlCount = await getMysqlCount(table)
      summary.push({ table, sqlite: 0, mysql: mysqlCount, ok: mysqlCount === 0 })
      continue
    }

    await insertBatch(table, columns, rows)
    const mysqlCount = await getMysqlCount(table)
    const ok = mysqlCount === sqliteCount
    console.log(`  ${table}: ${sqliteCount} 行 → MySQL ${mysqlCount} 行 ${ok ? '✅' : '❌ 行数不匹配!'}`)
    summary.push({ table, sqlite: sqliteCount, mysql: mysqlCount, ok })
  }

  // 8. 数据完整性校验
  console.log('[7/7] 数据完整性校验...')
  let allOk = true
  for (const s of summary) {
    if (!s.ok) {
      console.error(`  ❌ ${s.table}: SQLite ${s.sqlite} 行 ≠ MySQL ${s.mysql} 行`)
      allOk = false
    }
  }

  // 抽查 quotes 表的 JSON 字段完整性
  if (summary.find((s) => s.table === 'quotes' && s.sqlite > 0)) {
    console.log('  抽查 quotes JSON 字段...')
    const sqliteQuoteResult = sqliteDb.exec(
      `SELECT id, images, tableData, allFormulas FROM quotes LIMIT 1`
    )
    if (sqliteQuoteResult.length) {
      const [sqId, sqImages, sqTableData, sqAllFormulas] = sqliteQuoteResult[0].values[0]
      const [mysqlRows] = await pool.execute(
        `SELECT id, images, tableData, allFormulas FROM quotes WHERE id = ?`,
        [sqId]
      )
      const mysqlRow = (mysqlRows as any[])[0]
      if (mysqlRow) {
        const checkField = (name: string, sq: any, my: any) => {
          const sqStr = sq ? String(sq) : ''
          const myStr = my ? String(my) : ''
          const match = sqStr === myStr
          console.log(`    ${name}: ${match ? '✅ 一致' : '❌ 不一致'}`)
          if (!match) allOk = false
        }
        checkField('images', sqImages, mysqlRow.images)
        checkField('tableData', sqTableData, mysqlRow.tableData)
        checkField('allFormulas', sqAllFormulas, mysqlRow.allFormulas)
      }
    }
  }

  // 关闭资源
  sqliteDb.close()
  await closePool()

  console.log('\n' + '='.repeat(60))
  console.log('  迁移结果汇总')
  console.log('='.repeat(60))
  console.log('  表名              SQLite    MySQL     状态')
  console.log('  ' + '-'.repeat(56))
  for (const s of summary) {
    const tablePadded = s.table.padEnd(18)
    const sqlitePadded = String(s.sqlite).padStart(8)
    const mysqlPadded = String(s.mysql).padStart(8)
    const status = s.ok ? '✅' : '❌'
    console.log(`  ${tablePadded}${sqlitePadded}  ${mysqlPadded}  ${status}`)
  }
  console.log('  ' + '-'.repeat(56))
  console.log(`  Schema 版本: v${mysqlVersion}`)

  if (allOk) {
    console.log('\n  ✅ 数据迁移成功完成！所有表行数匹配，JSON 字段完整。')
    console.log('\n  下一步:')
    console.log('    1. 启动后端验证：npm run dev:backend')
    console.log(`    2. 归档 SQLite 文件：mv "${resolvedPath}" data/backup/sqlite-pre-migration/`)
    console.log('    3. 卸载 sql.js 依赖：npm uninstall sql.js')
  } else {
    console.log('\n  ❌ 数据迁移完成，但存在不一致，请检查上方日志！')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[迁移失败]', err)
  process.exit(1)
})
