/**
 * MySQL 连接池单例
 *
 * 提供连接池管理、事务封装和数据库初始化。
 * 环境变量配置：
 *   MYSQL_HOST     主机地址（默认 127.0.0.1）
 *   MYSQL_PORT     端口（默认 3306）
 *   MYSQL_USER     用户名（默认 root）
 *   MYSQL_PASSWORD 密码（默认空）
 *   MYSQL_DATABASE 数据库名（默认 quote_system）
 */
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

// ESM 模块导入会在 index.ts 的 dotenv.config() 之前执行（import 会被提升），
// 因此必须在读取环境变量之前先加载 .env，否则 MYSQL_DATABASE 等配置始终为默认值。
const envPath = fs.existsSync(path.resolve(process.cwd(), '.env'))
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'api/.env')
dotenv.config({ path: envPath })

const host = process.env.MYSQL_HOST || '127.0.0.1'
const port = Number(process.env.MYSQL_PORT) || 3306
const user = process.env.MYSQL_USER || 'root'
const password = process.env.MYSQL_PASSWORD || ''
const database = process.env.MYSQL_DATABASE || 'quote_system'

/** MySQL 连接池（模块级单例，所有数据库操作共享） */
export const pool: Pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+08:00',
  multipleStatements: false,
})

/**
 * 确保目标数据库存在（启动时调用）。
 * 连接到 MySQL 服务器（不指定 database），执行 CREATE DATABASE IF NOT EXISTS。
 */
export async function initDatabase(): Promise<void> {
  const adminPool = mysql.createPool({
    host,
    port,
    user,
    password,
    waitForConnections: true,
    connectionLimit: 1,
  })
  try {
    await adminPool.execute(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await adminPool.end()
  }
}

/**
 * 执行查询（不返回参数化结果，用于 DDL 或无参数 SQL）。
 */
export async function query(sql: string, params?: any[]): Promise<any> {
  const [rows] = await pool.query(sql, params)
  return rows
}

/**
 * 执行可能包含多条语句的 SQL（用于迁移系统的 DDL）。
 * mysql2 连接池配置 multipleStatements=false（防 SQL 注入），不支持多语句，
 * 因此按分号拆分后逐条执行。仅用于迁移 DDL，不要用于含用户输入的 SQL。
 */
export async function execMultiStatement(sql: string): Promise<void> {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))
  for (const stmt of statements) {
    await pool.query(stmt)
  }
}

/**
 * 执行参数化查询（使用预编译语句，防止 SQL 注入）。
 * 返回 [rows, fields] 中的 rows 部分。
 */
export async function execute(sql: string, params?: any[]): Promise<RowDataPacket[] | ResultSetHeader> {
  const [rows] = await pool.execute(sql, params)
  return rows as RowDataPacket[] | ResultSetHeader
}

/**
 * 在事务中执行一组操作。
 * 获取独占连接 → BEGIN → 执行 fn → COMMIT / ROLLBACK → 释放连接。
 *
 * @param fn 事务体，接收共享连接 conn（事务内的所有操作应使用此连接）
 * @returns fn 的返回值
 */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 关闭连接池（用于测试结束或进程退出）。
 */
export async function closePool(): Promise<void> {
  await pool.end()
}
