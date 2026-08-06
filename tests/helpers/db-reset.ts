/**
 * 测试数据库重置工具
 *
 * 在每个测试用例前调用 resetTestDatabase()，DELETE 所有业务表数据（保留 schema_migrations），
 * 并重新插入 6 条默认款式产品，保证测试隔离性且不破坏 getStyleLabel 对默认款式的依赖。
 *
 * 使用单一连接执行所有操作，避免连接池中不同连接间的事务隔离问题。
 * 替代原 SQLite 的 :memory: 方案。
 */
import { pool } from '../../api/dbClient.js'

const TABLES_TO_RESET = [
  'order_items',
  'orders',
  'tasks',
  'quotes',
  'process_costs',
  'products',
  'customers',
  // schema_migrations 保留，避免重复跑迁移
]

const DEFAULT_STYLES = [
  { id: 'style-1', name: '无底无侧普通袋', code: '1' },
  { id: 'style-2', name: '有底无侧普通袋', code: '2' },
  { id: 'style-3', name: '有底有侧普通袋', code: '3' },
  { id: 'style-4', name: '手提连底普通拼接袋', code: '4' },
  { id: 'style-5', name: '手提连底高级拼接袋', code: '5' },
  { id: 'style-6', name: '手提无连底拼接袋', code: '6' },
]

export async function resetTestDatabase(): Promise<void> {
  // 使用单一连接确保所有操作在同一事务上下文中执行
  const conn = await pool.getConnection()
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const table of TABLES_TO_RESET) {
      await conn.query(`DELETE FROM \`${table}\``)
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')

    // 重新插入 6 条默认款式产品（v7 迁移逻辑的等价操作）
    // 许多测试依赖 getStyleLabel 查询 products 表获取款式名称
    for (const s of DEFAULT_STYLES) {
      await conn.execute(
        `INSERT INTO products (id, name, code, sku, description, price, category, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, s.name, s.code, `STYLE-${s.code}`, `${s.name}款式`, 0, '款式', 0]
      )
    }
  } finally {
    conn.release()
  }
}
