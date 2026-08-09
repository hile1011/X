-- ============================================================
-- 全量数据库脚本 — Schema v12
-- 生成日期：2026-08-09
-- 对应代码：api/migrations/index.ts (CURRENT_SCHEMA_VERSION = 12)
-- 数据库引擎：MySQL 8.0+ / utf8mb4
-- ============================================================
-- 用途：
--   1. 新环境初始化（替代逐个执行增量迁移）
--   2. 数据库结构参照（审核、文档、排查）
--   3. 测试环境快速重建
--
-- 使用方法：
--   mysql -u root -p <database_name> < db/schema/schema_v12.sql
--
-- 注意：
--   - 此脚本包含 CREATE TABLE IF NOT EXISTS，可安全重复执行
--   - 种子数据使用 INSERT IGNORE，可安全重复执行
--   - 默认管理员密码为 123456（bcrypt 哈希），生产环境部署后必须立即修改
--   - 执行此脚本后，schema_migrations 表会记录 v1-v12 全部版本
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ─── 迁移版本记录表 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` INT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `applied_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── 业务表 ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `contact_person` VARCHAR(255) DEFAULT '',
  `phone` VARCHAR(64) DEFAULT '',
  `email` VARCHAR(255) DEFAULT '',
  `address` VARCHAR(500) DEFAULT '',
  `industry` VARCHAR(255) DEFAULT '',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `sku` VARCHAR(255) DEFAULT '',
  `description` TEXT,
  `price` DOUBLE DEFAULT 0,
  `category` VARCHAR(255) DEFAULT '',
  `stock` INT DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `code` VARCHAR(64) DEFAULT '',
  `code_key` VARCHAR(64) GENERATED ALWAYS AS (IF(`code` = '', NULL, `code`)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_products_code` (`code_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) DEFAULT '',
  `customer_id` VARCHAR(64) DEFAULT '',
  `quote_id` VARCHAR(64) DEFAULT '',
  `order_number` VARCHAR(255) DEFAULT '',
  `status` VARCHAR(64) DEFAULT 'pending',
  `total_amount` DOUBLE DEFAULT 0,
  `remarks` TEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_orders_customer_id` (`customer_id`),
  KEY `idx_orders_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id` VARCHAR(64) NOT NULL,
  `order_id` VARCHAR(64) NOT NULL,
  `product_id` VARCHAR(64) DEFAULT '',
  `quantity` INT DEFAULT 0,
  `unit_price` DOUBLE DEFAULT 0,
  `amount` DOUBLE DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) DEFAULT '',
  `order_id` VARCHAR(64) DEFAULT '',
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `status` VARCHAR(64) DEFAULT 'pending',
  `due_date` VARCHAR(64) DEFAULT '',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quotes` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) DEFAULT '',
  `customer_id` VARCHAR(64) DEFAULT '',
  `quote_number` VARCHAR(255) NOT NULL,
  `customerName` VARCHAR(255) NOT NULL,
  `shippingAddress` VARCHAR(500) DEFAULT '',
  `productStyle` VARCHAR(64) DEFAULT '1',
  `productSpec` VARCHAR(255) DEFAULT '',
  `fabricMaterial` VARCHAR(255) DEFAULT '10安涤棉新本色',
  `process` VARCHAR(255) DEFAULT '单面数码uv印刷',
  `handleMaterial` VARCHAR(255) DEFAULT '帆布手提',
  `handleSpec` VARCHAR(255) DEFAULT '',
  `quantity` VARCHAR(255) DEFAULT '',
  `boxSpec` VARCHAR(255) DEFAULT '',
  `remark` TEXT,
  `sampleFee` VARCHAR(64) DEFAULT '',
  `sampleDays` VARCHAR(64) DEFAULT '',
  `massDays` VARCHAR(64) DEFAULT '',
  `unitPrice` VARCHAR(255) DEFAULT '',
  `productionTimeStart` VARCHAR(64) DEFAULT '',
  `productionTimeEnd` VARCHAR(64) DEFAULT '',
  `sellPriceNoTax` DOUBLE DEFAULT 0,
  `sellPriceWithTax` DOUBLE DEFAULT 0,
  `status` INT DEFAULT 1,
  `quoteTime` VARCHAR(64) DEFAULT '',
  `sampleTime` VARCHAR(64) DEFAULT '',
  `productionStartTime` VARCHAR(64) DEFAULT '',
  `shippingTime` VARCHAR(64) DEFAULT '',
  `paymentTime` VARCHAR(64) DEFAULT '',
  `endTime` VARCHAR(64) DEFAULT '',
  `images` LONGTEXT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `costPrice` DOUBLE DEFAULT 0,
  `priceWithTax` DOUBLE DEFAULT 0,
  `tableData` LONGTEXT,
  `removedFormulaAddresses` LONGTEXT,
  `modifiedFormulas` LONGTEXT,
  `allFormulas` LONGTEXT,
  `productionStepStatus` LONGTEXT,
  PRIMARY KEY (`id`),
  KEY `idx_quotes_customerName` (`customerName`),
  KEY `idx_quotes_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `process_costs` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `cost` DOUBLE DEFAULT 0,
  `formula` VARCHAR(500) DEFAULT '',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `operation_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `operation_type` VARCHAR(50) NOT NULL DEFAULT 'delete',
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` VARCHAR(255) NOT NULL,
  `entity_name` VARCHAR(255) DEFAULT '',
  `operator` VARCHAR(255) DEFAULT 'unknown',
  `result` VARCHAR(20) NOT NULL DEFAULT 'success',
  `blocked_reason` TEXT,
  `ip_address` VARCHAR(45) DEFAULT '',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_operation_logs_entity` (`entity_type`, `entity_id`),
  KEY `idx_operation_logs_created` (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RBAC 认证与权限表 ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `phone` VARCHAR(64) DEFAULT '',
  `status` TINYINT NOT NULL DEFAULT 1,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `roles` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `description` VARCHAR(500) DEFAULT '',
  `is_system` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_roles_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `permissions` (
  `id` VARCHAR(64) NOT NULL,
  `code` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `module` VARCHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `type` VARCHAR(20) NOT NULL DEFAULT 'button',
  `description` VARCHAR(500) DEFAULT '',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_permissions_code` (`code`),
  KEY `idx_permissions_module` (`module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id` VARCHAR(64) NOT NULL,
  `permission_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`, `permission_id`),
  KEY `idx_role_permissions_perm` (`permission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_roles` (
  `user_id` VARCHAR(64) NOT NULL,
  `role_id` VARCHAR(64) NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `role_id`),
  KEY `idx_user_roles_role` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 种子数据
-- ============================================================

-- ─── 默认款式产品（6条，不可删除） ──────────────────────────
INSERT IGNORE INTO `products` (`id`, `name`, `code`, `sku`, `description`, `price`, `category`, `stock`) VALUES
  ('style-1', '无底无侧普通袋', '1', 'STYLE-1', '无底无侧普通袋款式', 0, '款式', 0),
  ('style-2', '有底无侧普通袋', '2', 'STYLE-2', '有底无侧普通袋款式', 0, '款式', 0),
  ('style-3', '有底有侧普通袋', '3', 'STYLE-3', '有底有侧普通袋款式', 0, '款式', 0),
  ('style-4', '手提连底普通拼接袋', '4', 'STYLE-4', '手提连底普通拼接袋款式', 0, '款式', 0),
  ('style-5', '手提连底高级拼接袋', '5', 'STYLE-5', '手提连底高级拼接袋款式', 0, '款式', 0),
  ('style-6', '手提无连底拼接袋', '6', 'STYLE-6', '手提无连底拼接袋款式', 0, '款式', 0);

-- ─── 权限目录（38项） ───────────────────────────────────────
INSERT IGNORE INTO `permissions` (`id`, `code`, `name`, `module`, `action`, `type`, `description`, `sort_order`) VALUES
  ('perm-dashboard-view', 'dashboard:view', '仪表盘', 'dashboard', 'view', 'menu', '', 1),
  ('perm-quotes-view', 'quotes:view', '订单-查看菜单', 'quotes', 'view', 'menu', '', 10),
  ('perm-quotes-create', 'quotes:create', '订单-新增', 'quotes', 'create', 'button', '', 11),
  ('perm-quotes-edit', 'quotes:edit', '订单-编辑', 'quotes', 'edit', 'button', '', 12),
  ('perm-quotes-delete', 'quotes:delete', '订单-删除', 'quotes', 'delete', 'button', '', 13),
  ('perm-quotes-copy', 'quotes:copy', '订单-复制', 'quotes', 'copy', 'button', '', 14),
  ('perm-quotes-export', 'quotes:export', '订单-导出', 'quotes', 'export', 'button', '', 15),
  ('perm-quotes-print', 'quotes:print', '订单-打印', 'quotes', 'print', 'button', '', 16),
  ('perm-quotes-status', 'quotes:status-transition', '订单-状态流转', 'quotes', 'status-transition', 'button', '', 17),
  ('perm-quotes-table-view', 'quotes-table:view', '订单表格版-查看', 'quotes-table', 'view', 'menu', '', 20),
  ('perm-quotes-wps-view', 'quotes-wps:view', '订单WPS版-查看', 'quotes-wps', 'view', 'menu', '', 30),
  ('perm-process-costs-view', 'process-costs:view', '工艺成本-查看', 'process-costs', 'view', 'menu', '', 40),
  ('perm-process-costs-create', 'process-costs:create', '工艺成本-新增', 'process-costs', 'create', 'button', '', 41),
  ('perm-process-costs-edit', 'process-costs:edit', '工艺成本-编辑', 'process-costs', 'edit', 'button', '', 42),
  ('perm-process-costs-delete', 'process-costs:delete', '工艺成本-删除', 'process-costs', 'delete', 'button', '', 43),
  ('perm-customers-view', 'customers:view', '客户管理-查看', 'customers', 'view', 'menu', '', 50),
  ('perm-customers-create', 'customers:create', '客户-新增', 'customers', 'create', 'button', '', 51),
  ('perm-customers-edit', 'customers:edit', '客户-编辑', 'customers', 'edit', 'button', '', 52),
  ('perm-customers-delete', 'customers:delete', '客户-删除', 'customers', 'delete', 'button', '', 53),
  ('perm-products-view', 'products:view', '产品管理-查看', 'products', 'view', 'menu', '', 60),
  ('perm-products-create', 'products:create', '产品-新增', 'products', 'create', 'button', '', 61),
  ('perm-products-edit', 'products:edit', '产品-编辑', 'products', 'edit', 'button', '', 62),
  ('perm-products-delete', 'products:delete', '产品-删除', 'products', 'delete', 'button', '', 63),
  ('perm-tasks-view', 'tasks:view', '跟单任务-查看', 'tasks', 'view', 'menu', '', 70),
  ('perm-tasks-create', 'tasks:create', '任务-新增', 'tasks', 'create', 'button', '', 71),
  ('perm-tasks-edit', 'tasks:edit', '任务-编辑', 'tasks', 'edit', 'button', '', 72),
  ('perm-tasks-delete', 'tasks:delete', '任务-删除', 'tasks', 'delete', 'button', '', 73),
  ('perm-reports-view', 'reports:view', '报表统计-查看', 'reports', 'view', 'menu', '', 80),
  ('perm-operation-logs-view', 'operation-logs:view', '操作日志-查看', 'operation-logs', 'view', 'menu', '', 90),
  ('perm-users-view', 'users:view', '用户管理-查看', 'users', 'view', 'menu', '', 100),
  ('perm-users-create', 'users:create', '用户-新增', 'users', 'create', 'button', '', 101),
  ('perm-users-edit', 'users:edit', '用户-编辑', 'users', 'edit', 'button', '', 102),
  ('perm-users-delete', 'users:delete', '用户-删除', 'users', 'delete', 'button', '', 103),
  ('perm-roles-view', 'roles:view', '角色管理-查看', 'roles', 'view', 'menu', '', 110),
  ('perm-roles-create', 'roles:create', '角色-新增', 'roles', 'create', 'button', '', 111),
  ('perm-roles-edit', 'roles:edit', '角色-编辑', 'roles', 'edit', 'button', '', 112),
  ('perm-roles-delete', 'roles:delete', '角色-删除', 'roles', 'delete', 'button', '', 113),
  ('perm-system-admin', 'system:admin', '系统管理员特权', 'system', 'admin', 'button', '', 200);

-- ─── admin 角色 ─────────────────────────────────────────────
INSERT IGNORE INTO `roles` (`id`, `name`, `code`, `description`, `is_system`) VALUES
  ('role-admin', '系统管理员', 'admin', '拥有系统全部权限的内置管理员角色', 1);

-- ─── admin 角色权限（全部38项） ─────────────────────────────
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT 'role-admin', `id` FROM `permissions`;

-- ─── 默认管理员账号 ─────────────────────────────────────────
-- 密码：123456（bcrypt 哈希，生产环境部署后必须立即修改）
-- 如需重新生成哈希：node -e "console.log(require('bcryptjs').hashSync('新密码', 10))"
INSERT IGNORE INTO `users` (`id`, `email`, `password_hash`, `name`, `status`) VALUES
  ('user-admin-default', '517290808@qq.com', '$2b$10$Ka13DTpRqB7l0zFMO2JHQOA6enxZPLujjJWvZDSR/QBMPezQreBf.', '管理员', 1);

-- ─── 默认管理员角色分配 ─────────────────────────────────────
INSERT IGNORE INTO `user_roles` (`user_id`, `role_id`) VALUES
  ('user-admin-default', 'role-admin');

-- ─── 迁移版本记录（标记 v1-v12 全部已执行） ─────────────────
INSERT IGNORE INTO `schema_migrations` (`version`, `name`, `description`) VALUES
  (1, 'initial-schema', '初始化数据库表结构（客户、产品、订单、任务、报价、工艺成本）'),
  (2, 'add-quote-fields', '报价表新增字段'),
  (3, 'add-operation-logs', '操作日志表'),
  (4, 'add-process-costs', '工艺成本表'),
  (5, 'add-quote-status-fields', '报价状态时间节点字段'),
  (6, 'add-quote-table-fields', '报价在线表格字段'),
  (7, 'add-product-code-and-default-styles', '产品表新增 code 字段并插入6条默认款式'),
  (8, 'add-quote-cost-price-fields', '报价表新增成本价和含税价字段'),
  (9, 'add-all-formulas', '报价表新增 allFormulas 字段并从老数据初始化'),
  (10, 'add-production-step-status', '报价表新增 productionStepStatus 字段'),
  (11, 'add-quote-status-index', '报价表新增复合索引优化排序查询'),
  (12, 'add-auth-rbac', 'V0.6：新增 RBAC 用户认证与权限管理系统');

-- ============================================================
-- 验证（执行后可运行以下查询确认）
-- ============================================================
-- SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;  -- 应为 12
-- SELECT COUNT(*) FROM permissions;  -- 应为 38
-- SELECT COUNT(*) FROM role_permissions WHERE role_id = 'role-admin';  -- 应为 38
-- SELECT COUNT(*) FROM users WHERE email = '517290808@qq.com';  -- 应为 1
