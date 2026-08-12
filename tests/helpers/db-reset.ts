/**
 * 测试数据库重置工具
 *
 * 在每个测试用例前调用 resetTestDatabase()，DELETE 所有业务表数据（保留 schema_migrations），
 * 并重新插入 6 条默认款式产品 + RBAC 种子数据（权限目录/admin 角色/默认管理员），
 * 保证测试隔离性且不破坏 getStyleLabel 对默认款式的依赖。
 *
 * 使用单一连接执行所有操作，避免连接池中不同连接间的事务隔离问题。
 * 替代原 SQLite 的 :memory: 方案。
 */
import bcrypt from 'bcryptjs'
import { pool } from '../../api/dbClient.js'

const TABLES_TO_RESET = [
  // 业务表（按 FK 依赖顺序删除）
  'order_items',
  'orders',
  'tasks',
  'quotes',
  'process_costs',
  'products',
  'customers',
  // RBAC 表（按 FK 依赖顺序删除）
  'user_roles',
  'role_permissions',
  'users',
  'roles',
  'permissions',
  // 审计表：必须在 quotes 之后清空（删除 quotes 时触发器会写入历史记录）
  'quote_history',
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

/** RBAC 种子权限目录（与 v12 迁移保持一致） */
const SEED_PERMISSIONS = [
  { id: 'perm-dashboard-view', code: 'dashboard:view', name: '仪表盘', module: 'dashboard', action: 'view', type: 'menu', sort: 1 },
  { id: 'perm-quotes-view', code: 'quotes:view', name: '订单-查看菜单', module: 'quotes', action: 'view', type: 'menu', sort: 10 },
  { id: 'perm-quotes-create', code: 'quotes:create', name: '订单-新增', module: 'quotes', action: 'create', type: 'button', sort: 11 },
  { id: 'perm-quotes-edit', code: 'quotes:edit', name: '订单-编辑', module: 'quotes', action: 'edit', type: 'button', sort: 12 },
  { id: 'perm-quotes-delete', code: 'quotes:delete', name: '订单-删除', module: 'quotes', action: 'delete', type: 'button', sort: 13 },
  { id: 'perm-quotes-copy', code: 'quotes:copy', name: '订单-复制', module: 'quotes', action: 'copy', type: 'button', sort: 14 },
  { id: 'perm-quotes-export', code: 'quotes:export', name: '订单-导出', module: 'quotes', action: 'export', type: 'button', sort: 15 },
  { id: 'perm-quotes-print', code: 'quotes:print', name: '订单-打印', module: 'quotes', action: 'print', type: 'button', sort: 16 },
  { id: 'perm-quotes-status', code: 'quotes:status-transition', name: '订单-状态流转', module: 'quotes', action: 'status-transition', type: 'button', sort: 17 },
  { id: 'perm-quotes-export-payment', code: 'quotes:export-payment', name: '订单-导出收款单', module: 'quotes', action: 'export-payment', type: 'button', sort: 18 },
  { id: 'perm-quotes-table-view', code: 'quotes-table:view', name: '订单表格版-查看', module: 'quotes-table', action: 'view', type: 'menu', sort: 20 },
  { id: 'perm-quotes-wps-view', code: 'quotes-wps:view', name: '订单WPS版-查看', module: 'quotes-wps', action: 'view', type: 'menu', sort: 30 },
  { id: 'perm-process-costs-view', code: 'process-costs:view', name: '工艺成本-查看', module: 'process-costs', action: 'view', type: 'menu', sort: 40 },
  { id: 'perm-process-costs-create', code: 'process-costs:create', name: '工艺成本-新增', module: 'process-costs', action: 'create', type: 'button', sort: 41 },
  { id: 'perm-process-costs-edit', code: 'process-costs:edit', name: '工艺成本-编辑', module: 'process-costs', action: 'edit', type: 'button', sort: 42 },
  { id: 'perm-process-costs-delete', code: 'process-costs:delete', name: '工艺成本-删除', module: 'process-costs', action: 'delete', type: 'button', sort: 43 },
  { id: 'perm-customers-view', code: 'customers:view', name: '客户管理-查看', module: 'customers', action: 'view', type: 'menu', sort: 50 },
  { id: 'perm-customers-create', code: 'customers:create', name: '客户-新增', module: 'customers', action: 'create', type: 'button', sort: 51 },
  { id: 'perm-customers-edit', code: 'customers:edit', name: '客户-编辑', module: 'customers', action: 'edit', type: 'button', sort: 52 },
  { id: 'perm-customers-delete', code: 'customers:delete', name: '客户-删除', module: 'customers', action: 'delete', type: 'button', sort: 53 },
  { id: 'perm-products-view', code: 'products:view', name: '产品管理-查看', module: 'products', action: 'view', type: 'menu', sort: 60 },
  { id: 'perm-products-create', code: 'products:create', name: '产品-新增', module: 'products', action: 'create', type: 'button', sort: 61 },
  { id: 'perm-products-edit', code: 'products:edit', name: '产品-编辑', module: 'products', action: 'edit', type: 'button', sort: 62 },
  { id: 'perm-products-delete', code: 'products:delete', name: '产品-删除', module: 'products', action: 'delete', type: 'button', sort: 63 },
  { id: 'perm-tasks-view', code: 'tasks:view', name: '跟单任务-查看', module: 'tasks', action: 'view', type: 'menu', sort: 70 },
  { id: 'perm-tasks-create', code: 'tasks:create', name: '任务-新增', module: 'tasks', action: 'create', type: 'button', sort: 71 },
  { id: 'perm-tasks-edit', code: 'tasks:edit', name: '任务-编辑', module: 'tasks', action: 'edit', type: 'button', sort: 72 },
  { id: 'perm-tasks-delete', code: 'tasks:delete', name: '任务-删除', module: 'tasks', action: 'delete', type: 'button', sort: 73 },
  { id: 'perm-reports-view', code: 'reports:view', name: '报表统计-查看', module: 'reports', action: 'view', type: 'menu', sort: 80 },
  { id: 'perm-operation-logs-view', code: 'operation-logs:view', name: '操作日志-查看', module: 'operation-logs', action: 'view', type: 'menu', sort: 90 },
  { id: 'perm-users-view', code: 'users:view', name: '用户管理-查看', module: 'users', action: 'view', type: 'menu', sort: 100 },
  { id: 'perm-users-create', code: 'users:create', name: '用户-新增', module: 'users', action: 'create', type: 'button', sort: 101 },
  { id: 'perm-users-edit', code: 'users:edit', name: '用户-编辑', module: 'users', action: 'edit', type: 'button', sort: 102 },
  { id: 'perm-users-delete', code: 'users:delete', name: '用户-删除', module: 'users', action: 'delete', type: 'button', sort: 103 },
  { id: 'perm-roles-view', code: 'roles:view', name: '角色管理-查看', module: 'roles', action: 'view', type: 'menu', sort: 110 },
  { id: 'perm-roles-create', code: 'roles:create', name: '角色-新增', module: 'roles', action: 'create', type: 'button', sort: 111 },
  { id: 'perm-roles-edit', code: 'roles:edit', name: '角色-编辑', module: 'roles', action: 'edit', type: 'button', sort: 112 },
  { id: 'perm-roles-delete', code: 'roles:delete', name: '角色-删除', module: 'roles', action: 'delete', type: 'button', sort: 113 },
  { id: 'perm-system-admin', code: 'system:admin', name: '系统管理员特权', module: 'system', action: 'admin', type: 'button', sort: 200 },
]

/** 重新插入 RBAC 种子数据（权限目录、admin 角色、默认管理员账号） */
async function reseedAuthData(conn: any): Promise<void> {
  // 1. 插入权限目录
  for (const p of SEED_PERMISSIONS) {
    await conn.execute(
      'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [p.id, p.code, p.name, p.module, p.action, p.type, '', p.sort]
    )
  }

  // 2. 插入 admin 角色
  await conn.execute(
    'INSERT IGNORE INTO roles (id, name, code, description, is_system) VALUES (?, ?, ?, ?, ?)',
    ['role-admin', '系统管理员', 'admin', '拥有系统全部权限的内置管理员角色', 1]
  )

  // 3. 给 admin 角色分配全部权限
  for (const p of SEED_PERMISSIONS) {
    await conn.execute(
      'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      ['role-admin', p.id]
    )
  }

  // 4. 插入默认管理员账号
  const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || '123456'
  const passwordHash = bcrypt.hashSync(defaultPassword, 10)
  await conn.execute(
    'INSERT IGNORE INTO users (id, email, password_hash, name, status) VALUES (?, ?, ?, ?, ?)',
    ['user-admin-default', '517290808@qq.com', passwordHash, '管理员', 1]
  )

  // 5. 给默认管理员账号分配 admin 角色
  await conn.execute(
    'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
    ['user-admin-default', 'role-admin']
  )
}

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

    // 重新插入 RBAC 种子数据（v12 迁移逻辑的等价操作）
    // 认证/权限测试依赖完整的权限目录和默认管理员账号
    await reseedAuthData(conn)
  } finally {
    conn.release()
  }
}
