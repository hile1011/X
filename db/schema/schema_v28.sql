-- ============================================================
-- 全量数据库脚本 — Schema v28
-- 生成日期：2026-09-10
-- 对应代码：api/migrations/index.ts (CURRENT_SCHEMA_VERSION = 28)
-- 数据库引擎：MySQL 8.0+ / utf8mb4
-- ============================================================
-- 用途：
--   1. 新环境初始化（替代逐个执行增量迁移）
--   2. 数据库结构参照（审核、文档、排查）
--   3. 测试环境快速重建
--
-- 使用方法：
--   mysql -u root -p <database_name> < db/schema/schema_v28.sql
--
-- 注意：
--   - 此脚本包含 CREATE TABLE IF NOT EXISTS，可安全重复执行
--   - 种子数据使用 INSERT IGNORE，可安全重复执行
--   - 触发器使用 DROP TRIGGER IF EXISTS + CREATE TRIGGER，可安全重复执行
--   - 默认管理员密码为 123456（bcrypt 哈希），生产环境部署后必须立即修改
--   - 执行此脚本后，schema_migrations 表会记录 v1-v28 全部版本
--   - 所有表统一 COLLATE utf8mb4_unicode_ci（v26，避免跨表 JOIN 排序规则冲突）
--   - v27：仪表盘菜单权限更名为工作台（dashboard:view）
--   - v28：订单对账管理——quotes 新增 reconciledTime 字段、新增 quote_reconciliation_costs 表
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
  `tags` TEXT COMMENT '客户标签，JSON数组字符串，如 ["重点客户","老客户"]（v22 新增）',
  `remark` TEXT COMMENT '客户备注（v22 新增）',
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
  `created_by` VARCHAR(64) DEFAULT '',
  `updated_by` VARCHAR(64) DEFAULT '',
  `customer_id` VARCHAR(64) DEFAULT '',
  `quote_number` VARCHAR(255) NOT NULL,
  `customerName` VARCHAR(255) NOT NULL,
  `shippingAddress` VARCHAR(500) DEFAULT '',
  `productStyle` VARCHAR(64) DEFAULT '1',
  `template_id` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '使用的款式模板id（空=内置默认模板，v23 新增）',
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
  `receivableSampleFee` DECIMAL(12,2) DEFAULT 0,
  `actualSampleFee` DECIMAL(12,2) DEFAULT 0,
  `sampleFeeDeduct` TINYINT(1) DEFAULT 0,
  `deposit` DECIMAL(12,2) DEFAULT 0,
  `pendingAmount` DECIMAL(12,2) DEFAULT 0,
  `status` INT DEFAULT 1,
  `quoteTime` VARCHAR(64) DEFAULT '',
  `sampleTime` VARCHAR(64) DEFAULT '',
  `sampleCompletedTime` VARCHAR(64) DEFAULT '',
  `productionStartTime` VARCHAR(64) DEFAULT '',
  `shippingTime` VARCHAR(64) DEFAULT '',
  `paymentTime` VARCHAR(64) DEFAULT '',
  `reconciledTime` VARCHAR(64) DEFAULT '' COMMENT '对账时间（状态8已对账，V28 新增）',
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

-- ─── 在线表格模板表（v19 新增，v23 升级为一对多，v25 扩容 style_code） ──
-- 存储款式模板（data 二维数组 + formulas 公式映射，均为 JSON）
-- 同一款式可建多个差异化模板（uk_style_name 保证同款式名称唯一）
-- style_code：内置款式 1-6 / 产品自定义编码 / 无编码产品 id（v25 扩容至 64）
-- 前端内置模板（SheetTemplateManager）作为兜底：订单未选模板时使用内置默认
CREATE TABLE IF NOT EXISTS `sheet_templates` (
  `id` VARCHAR(64) NOT NULL,
  `style_code` VARCHAR(64) NOT NULL COMMENT '款式编码（内置1-6/产品自定义编码/无编码产品id）',
  `name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '模板名称（同款式内唯一）',
  `data` LONGTEXT NOT NULL COMMENT '表格二维数据 JSON',
  `formulas` LONGTEXT NOT NULL COMMENT '公式映射 JSON',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '同款式内排序（小在前）',
  `updated_by` VARCHAR(64) DEFAULT '' COMMENT '最后修改人',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_style_name` (`style_code`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='在线表格模板（款式一对多）';

-- ─── 订单做货流程任务表（v24 新增） ──────────────────────────
-- 甘特图数据：每行一个生产任务（计划/实际起止时间、状态、材料清单 JSON）
-- 存量数据由 v24 迁移从 quotes.productionStepStatus 转换（状态映射，日期为 NULL）
CREATE TABLE IF NOT EXISTS `quote_production_tasks` (
  `id` VARCHAR(64) NOT NULL COMMENT '任务id（prod-task-{ts}-{rand}）',
  `quote_id` VARCHAR(64) NOT NULL COMMENT '所属订单（quotes.id）',
  `step_order` INT NOT NULL DEFAULT 1 COMMENT '步骤顺序（甘特图行序，小在前）',
  `name` VARCHAR(64) NOT NULL COMMENT '步骤名称',
  `plan_start` DATE NULL COMMENT '计划开始',
  `plan_end` DATE NULL COMMENT '计划结束',
  `actual_start` DATE NULL COMMENT '实际开始',
  `actual_end` DATE NULL COMMENT '实际结束',
  `status` TINYINT NOT NULL DEFAULT 0 COMMENT '0未开始 1进行中 2已完成',
  `remark` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  `materials` LONGTEXT NULL COMMENT '材料清单 JSON：[{name,spec,quantity,unit,ready}]',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qpt_quote_id` (`quote_id`),
  KEY `idx_qpt_plan_start` (`plan_start`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单做货流程任务（甘特图数据，V24）';

-- ─── 订单对账工艺成本明细表（v28 新增） ──────────────────────
-- 订单对账管理：处于"已发货已收款"状态的订单录入各环节工艺成本，
-- 确认对账后订单流转为"已对账"(8)；累计成本与订单不含税成本对比展示
CREATE TABLE IF NOT EXISTS `quote_reconciliation_costs` (
  `id` VARCHAR(64) NOT NULL COMMENT '明细id（recon-cost-{ts}-{rand}）',
  `quote_id` VARCHAR(64) NOT NULL COMMENT '所属订单（quotes.id）',
  `name` VARCHAR(128) NOT NULL COMMENT '工艺名称（必填）',
  `unit_price` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '工艺单价',
  `quantity` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '工艺数量',
  `cost` DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '工艺成本（必填）',
  `remark` VARCHAR(500) NOT NULL DEFAULT '' COMMENT '工艺备注',
  `sort_order` INT NOT NULL DEFAULT 1 COMMENT '明细顺序（小在前）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qrc_quote_id` (`quote_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单对账工艺成本明细（V28）';

-- ─── 订单模板表（v20 新增） ──────────────────────────────────
-- 可复用的订单信息快照（款式/材质/工艺/价格等字段），与款式模板相互独立
CREATE TABLE IF NOT EXISTS `order_templates` (
  `id` VARCHAR(64) NOT NULL COMMENT '模板ID',
  `name` VARCHAR(128) NOT NULL COMMENT '模板名称',
  `order_data` LONGTEXT NOT NULL COMMENT '订单信息快照 JSON',
  `created_by` VARCHAR(64) DEFAULT '' COMMENT '创建人',
  `updated_by` VARCHAR(64) DEFAULT '' COMMENT '最后修改人',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单模板（可复用的订单信息快照）';

-- ─── 订单数据修改历史记录表（v13 新增） ──────────────────────
-- 由 quotes 表的 INSERT/UPDATE/DELETE 触发器自动写入，记录业务字段变更快照
-- 定时清理脚本：scripts/cleanup-quote-history.ts（保留最近 1 个月）
CREATE TABLE IF NOT EXISTS `quote_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `quote_id` VARCHAR(64) NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `old_values` LONGTEXT,
  `new_values` LONGTEXT,
  `changed_fields` VARCHAR(2000),
  `operator` VARCHAR(255) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_quote_history_quote_id` (`quote_id`),
  KEY `idx_quote_history_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RBAC 认证与权限表 ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL DEFAULT '',
  `phone` VARCHAR(64) DEFAULT '',
  `tags` VARCHAR(500) COMMENT '用户标签（v21 新增）',
  `notes` TEXT COMMENT '用户备注（v21 新增）',
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
-- 触发器：订单数据修改历史记录（v13 新增）
-- ============================================================
-- 单语句触发体（无 BEGIN...END），每个 CREATE TRIGGER 以分号结束，可被 mysql 客户端直接执行
-- operator 优先取应用层 @app_operator 会话变量，回退到数据库当前用户 CURRENT_USER()
-- 追踪 36 个业务字段（排除 id/created_at/updated_at 及 6 个 LONGTEXT 大字段）
-- 注：v16 新增的 created_by/updated_by 为操作人字段，不纳入业务字段变更追踪
-- 注：v17 新增的 actualSampleFee/sampleFeeDeduct/deposit/pendingAmount 为收款字段，纳入变更追踪

DROP TRIGGER IF EXISTS `quotes_audit_insert`;
CREATE TRIGGER `quotes_audit_insert` AFTER INSERT ON `quotes` FOR EACH ROW
INSERT INTO `quote_history` (`quote_id`, `action`, `old_values`, `new_values`, `changed_fields`, `operator`)
VALUES (NEW.`id`, 'insert', NULL, JSON_OBJECT('user_id', NEW.`user_id`, 'customer_id', NEW.`customer_id`, 'quote_number', NEW.`quote_number`, 'customerName', NEW.`customerName`, 'shippingAddress', NEW.`shippingAddress`, 'productStyle', NEW.`productStyle`, 'productSpec', NEW.`productSpec`, 'fabricMaterial', NEW.`fabricMaterial`, 'process', NEW.`process`, 'handleMaterial', NEW.`handleMaterial`, 'handleSpec', NEW.`handleSpec`, 'quantity', NEW.`quantity`, 'boxSpec', NEW.`boxSpec`, 'remark', NEW.`remark`, 'sampleFee', NEW.`sampleFee`, 'sampleDays', NEW.`sampleDays`, 'massDays', NEW.`massDays`, 'unitPrice', NEW.`unitPrice`, 'productionTimeStart', NEW.`productionTimeStart`, 'productionTimeEnd', NEW.`productionTimeEnd`, 'sellPriceNoTax', NEW.`sellPriceNoTax`, 'sellPriceWithTax', NEW.`sellPriceWithTax`, 'actualSampleFee', NEW.`actualSampleFee`, 'sampleFeeDeduct', NEW.`sampleFeeDeduct`, 'deposit', NEW.`deposit`, 'pendingAmount', NEW.`pendingAmount`, 'status', NEW.`status`, 'quoteTime', NEW.`quoteTime`, 'sampleTime', NEW.`sampleTime`, 'sampleCompletedTime', NEW.`sampleCompletedTime`, 'productionStartTime', NEW.`productionStartTime`, 'shippingTime', NEW.`shippingTime`, 'paymentTime', NEW.`paymentTime`, 'endTime', NEW.`endTime`, 'costPrice', NEW.`costPrice`, 'priceWithTax', NEW.`priceWithTax`), NULL, COALESCE(@app_operator, CURRENT_USER()));

DROP TRIGGER IF EXISTS `quotes_audit_update`;
CREATE TRIGGER `quotes_audit_update` AFTER UPDATE ON `quotes` FOR EACH ROW
INSERT INTO `quote_history` (`quote_id`, `action`, `old_values`, `new_values`, `changed_fields`, `operator`)
VALUES (NEW.`id`, 'update', JSON_OBJECT('user_id', OLD.`user_id`, 'customer_id', OLD.`customer_id`, 'quote_number', OLD.`quote_number`, 'customerName', OLD.`customerName`, 'shippingAddress', OLD.`shippingAddress`, 'productStyle', OLD.`productStyle`, 'productSpec', OLD.`productSpec`, 'fabricMaterial', OLD.`fabricMaterial`, 'process', OLD.`process`, 'handleMaterial', OLD.`handleMaterial`, 'handleSpec', OLD.`handleSpec`, 'quantity', OLD.`quantity`, 'boxSpec', OLD.`boxSpec`, 'remark', OLD.`remark`, 'sampleFee', OLD.`sampleFee`, 'sampleDays', OLD.`sampleDays`, 'massDays', OLD.`massDays`, 'unitPrice', OLD.`unitPrice`, 'productionTimeStart', OLD.`productionTimeStart`, 'productionTimeEnd', OLD.`productionTimeEnd`, 'sellPriceNoTax', OLD.`sellPriceNoTax`, 'sellPriceWithTax', OLD.`sellPriceWithTax`, 'actualSampleFee', OLD.`actualSampleFee`, 'sampleFeeDeduct', OLD.`sampleFeeDeduct`, 'deposit', OLD.`deposit`, 'pendingAmount', OLD.`pendingAmount`, 'status', OLD.`status`, 'quoteTime', OLD.`quoteTime`, 'sampleTime', OLD.`sampleTime`, 'sampleCompletedTime', OLD.`sampleCompletedTime`, 'productionStartTime', OLD.`productionStartTime`, 'shippingTime', OLD.`shippingTime`, 'paymentTime', OLD.`paymentTime`, 'endTime', OLD.`endTime`, 'costPrice', OLD.`costPrice`, 'priceWithTax', OLD.`priceWithTax`), JSON_OBJECT('user_id', NEW.`user_id`, 'customer_id', NEW.`customer_id`, 'quote_number', NEW.`quote_number`, 'customerName', NEW.`customerName`, 'shippingAddress', NEW.`shippingAddress`, 'productStyle', NEW.`productStyle`, 'productSpec', NEW.`productSpec`, 'fabricMaterial', NEW.`fabricMaterial`, 'process', NEW.`process`, 'handleMaterial', NEW.`handleMaterial`, 'handleSpec', NEW.`handleSpec`, 'quantity', NEW.`quantity`, 'boxSpec', NEW.`boxSpec`, 'remark', NEW.`remark`, 'sampleFee', NEW.`sampleFee`, 'sampleDays', NEW.`sampleDays`, 'massDays', NEW.`massDays`, 'unitPrice', NEW.`unitPrice`, 'productionTimeStart', NEW.`productionTimeStart`, 'productionTimeEnd', NEW.`productionTimeEnd`, 'sellPriceNoTax', NEW.`sellPriceNoTax`, 'sellPriceWithTax', NEW.`sellPriceWithTax`, 'actualSampleFee', NEW.`actualSampleFee`, 'sampleFeeDeduct', NEW.`sampleFeeDeduct`, 'deposit', NEW.`deposit`, 'pendingAmount', NEW.`pendingAmount`, 'status', NEW.`status`, 'quoteTime', NEW.`quoteTime`, 'sampleTime', NEW.`sampleTime`, 'sampleCompletedTime', NEW.`sampleCompletedTime`, 'productionStartTime', NEW.`productionStartTime`, 'shippingTime', NEW.`shippingTime`, 'paymentTime', NEW.`paymentTime`, 'endTime', NEW.`endTime`, 'costPrice', NEW.`costPrice`, 'priceWithTax', NEW.`priceWithTax`), CONCAT_WS(',', IF(NOT(OLD.`user_id` <=> NEW.`user_id`), 'user_id', NULL), IF(NOT(OLD.`customer_id` <=> NEW.`customer_id`), 'customer_id', NULL), IF(NOT(OLD.`quote_number` <=> NEW.`quote_number`), 'quote_number', NULL), IF(NOT(OLD.`customerName` <=> NEW.`customerName`), 'customerName', NULL), IF(NOT(OLD.`shippingAddress` <=> NEW.`shippingAddress`), 'shippingAddress', NULL), IF(NOT(OLD.`productStyle` <=> NEW.`productStyle`), 'productStyle', NULL), IF(NOT(OLD.`productSpec` <=> NEW.`productSpec`), 'productSpec', NULL), IF(NOT(OLD.`fabricMaterial` <=> NEW.`fabricMaterial`), 'fabricMaterial', NULL), IF(NOT(OLD.`process` <=> NEW.`process`), 'process', NULL), IF(NOT(OLD.`handleMaterial` <=> NEW.`handleMaterial`), 'handleMaterial', NULL), IF(NOT(OLD.`handleSpec` <=> NEW.`handleSpec`), 'handleSpec', NULL), IF(NOT(OLD.`quantity` <=> NEW.`quantity`), 'quantity', NULL), IF(NOT(OLD.`boxSpec` <=> NEW.`boxSpec`), 'boxSpec', NULL), IF(NOT(OLD.`remark` <=> NEW.`remark`), 'remark', NULL), IF(NOT(OLD.`sampleFee` <=> NEW.`sampleFee`), 'sampleFee', NULL), IF(NOT(OLD.`sampleDays` <=> NEW.`sampleDays`), 'sampleDays', NULL), IF(NOT(OLD.`massDays` <=> NEW.`massDays`), 'massDays', NULL), IF(NOT(OLD.`unitPrice` <=> NEW.`unitPrice`), 'unitPrice', NULL), IF(NOT(OLD.`productionTimeStart` <=> NEW.`productionTimeStart`), 'productionTimeStart', NULL), IF(NOT(OLD.`productionTimeEnd` <=> NEW.`productionTimeEnd`), 'productionTimeEnd', NULL), IF(NOT(OLD.`sellPriceNoTax` <=> NEW.`sellPriceNoTax`), 'sellPriceNoTax', NULL), IF(NOT(OLD.`sellPriceWithTax` <=> NEW.`sellPriceWithTax`), 'sellPriceWithTax', NULL), IF(NOT(OLD.`actualSampleFee` <=> NEW.`actualSampleFee`), 'actualSampleFee', NULL), IF(NOT(OLD.`sampleFeeDeduct` <=> NEW.`sampleFeeDeduct`), 'sampleFeeDeduct', NULL), IF(NOT(OLD.`deposit` <=> NEW.`deposit`), 'deposit', NULL), IF(NOT(OLD.`pendingAmount` <=> NEW.`pendingAmount`), 'pendingAmount', NULL), IF(NOT(OLD.`status` <=> NEW.`status`), 'status', NULL), IF(NOT(OLD.`quoteTime` <=> NEW.`quoteTime`), 'quoteTime', NULL), IF(NOT(OLD.`sampleTime` <=> NEW.`sampleTime`), 'sampleTime', NULL), IF(NOT(OLD.`sampleCompletedTime` <=> NEW.`sampleCompletedTime`), 'sampleCompletedTime', NULL), IF(NOT(OLD.`productionStartTime` <=> NEW.`productionStartTime`), 'productionStartTime', NULL), IF(NOT(OLD.`shippingTime` <=> NEW.`shippingTime`), 'shippingTime', NULL), IF(NOT(OLD.`paymentTime` <=> NEW.`paymentTime`), 'paymentTime', NULL), IF(NOT(OLD.`endTime` <=> NEW.`endTime`), 'endTime', NULL), IF(NOT(OLD.`costPrice` <=> NEW.`costPrice`), 'costPrice', NULL), IF(NOT(OLD.`priceWithTax` <=> NEW.`priceWithTax`), 'priceWithTax', NULL)), COALESCE(@app_operator, CURRENT_USER()));

DROP TRIGGER IF EXISTS `quotes_audit_delete`;
CREATE TRIGGER `quotes_audit_delete` AFTER DELETE ON `quotes` FOR EACH ROW
INSERT INTO `quote_history` (`quote_id`, `action`, `old_values`, `new_values`, `changed_fields`, `operator`)
VALUES (OLD.`id`, 'delete', JSON_OBJECT('user_id', OLD.`user_id`, 'customer_id', OLD.`customer_id`, 'quote_number', OLD.`quote_number`, 'customerName', OLD.`customerName`, 'shippingAddress', OLD.`shippingAddress`, 'productStyle', OLD.`productStyle`, 'productSpec', OLD.`productSpec`, 'fabricMaterial', OLD.`fabricMaterial`, 'process', OLD.`process`, 'handleMaterial', OLD.`handleMaterial`, 'handleSpec', OLD.`handleSpec`, 'quantity', OLD.`quantity`, 'boxSpec', OLD.`boxSpec`, 'remark', OLD.`remark`, 'sampleFee', OLD.`sampleFee`, 'sampleDays', OLD.`sampleDays`, 'massDays', OLD.`massDays`, 'unitPrice', OLD.`unitPrice`, 'productionTimeStart', OLD.`productionTimeStart`, 'productionTimeEnd', OLD.`productionTimeEnd`, 'sellPriceNoTax', OLD.`sellPriceNoTax`, 'sellPriceWithTax', OLD.`sellPriceWithTax`, 'actualSampleFee', OLD.`actualSampleFee`, 'sampleFeeDeduct', OLD.`sampleFeeDeduct`, 'deposit', OLD.`deposit`, 'pendingAmount', OLD.`pendingAmount`, 'status', OLD.`status`, 'quoteTime', OLD.`quoteTime`, 'sampleTime', OLD.`sampleTime`, 'sampleCompletedTime', OLD.`sampleCompletedTime`, 'productionStartTime', OLD.`productionStartTime`, 'shippingTime', OLD.`shippingTime`, 'paymentTime', OLD.`paymentTime`, 'endTime', OLD.`endTime`, 'costPrice', OLD.`costPrice`, 'priceWithTax', OLD.`priceWithTax`), NULL, NULL, COALESCE(@app_operator, CURRENT_USER()));

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

-- ─── 权限目录（43项） ───────────────────────────────────────
INSERT IGNORE INTO `permissions` (`id`, `code`, `name`, `module`, `action`, `type`, `description`, `sort_order`) VALUES
  ('perm-dashboard-view', 'dashboard:view', '工作台', 'dashboard', 'view', 'menu', '', 1),
  ('perm-quotes-view', 'quotes:view', '订单-查看菜单', 'quotes', 'view', 'menu', '', 10),
  ('perm-quotes-create', 'quotes:create', '订单-新增', 'quotes', 'create', 'button', '', 11),
  ('perm-quotes-edit', 'quotes:edit', '订单-编辑', 'quotes', 'edit', 'button', '', 12),
  ('perm-quotes-delete', 'quotes:delete', '订单-删除', 'quotes', 'delete', 'button', '', 13),
  ('perm-quotes-copy', 'quotes:copy', '订单-复制', 'quotes', 'copy', 'button', '', 14),
  ('perm-quotes-export', 'quotes:export', '订单-导出', 'quotes', 'export', 'button', '', 15),
  ('perm-quotes-print', 'quotes:print', '订单-打印', 'quotes', 'print', 'button', '', 16),
  ('perm-quotes-status', 'quotes:status-transition', '订单-状态流转', 'quotes', 'status-transition', 'button', '', 17),
  ('perm-quotes-export-payment', 'quotes:export-payment', '订单-导出收款单', 'quotes', 'export-payment', 'button', '导出已发货未收款订单的收款单（Excel/ZIP）', 18),
  ('perm-sheet-templates-view', 'sheet-templates:view', '模板管理-查看', 'sheet-templates', 'view', 'menu', '查看在线表格模板管理页面', 19),
  ('perm-sheet-templates-edit', 'sheet-templates:edit', '模板管理-编辑', 'sheet-templates', 'edit', 'button', '编辑并保存在线表格模板', 20),
  ('perm-order-templates-view', 'order-templates:view', '订单模板-查看', 'order-templates', 'view', 'menu', '查看订单模板管理页面', 21),
  ('perm-order-templates-edit', 'order-templates:edit', '订单模板-编辑', 'order-templates', 'edit', 'button', '保存/编辑/重命名/删除订单模板', 22),
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

-- ─── admin 角色权限（全部43项） ─────────────────────────────
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

-- ─── 迁移版本记录（标记 v1-v28 全部已执行） ─────────────────
INSERT IGNORE INTO `schema_migrations` (`version`, `name`, `description`) VALUES
  (1, 'initial-schema', '初始化数据库表结构（客户、产品、订单、任务、报价、工艺成本）'),
  (2, 'add-cost-price', '为 quotes 表添加成本价字段（costPrice），来源为在线表格汇总行与参考卖价列交叉单元格'),
  (3, 'add-price-with-tax', '为 quotes 表添加含税价字段（priceWithTax），即成本含税价 = 成本价 × 1.1，支持手动覆盖'),
  (4, 'migrate-productstyle-to-numeric', 'V0.3：将 quotes 表 productStyle 字段从中文名称迁移为数字编码（1-6），统一前后端枚举值，并重建 quote_number 中款式部分'),
  (5, 'add-table-data', '为 quotes 表添加 tableData 字段，持久化在线表格二维数据（用户编辑后的值），仅新增订单时从模板加载，后续以数据库为准'),
  (6, 'add-removed-formula-addresses', '为 quotes 表添加 removedFormulaAddresses 字段，持久化用户已删除的公式地址列表，加载时排除这些公式使 tableData 值生效'),
  (7, 'add-product-code-and-default-styles', 'V0.4：为 products 表添加 code 字段（款式编码，对应 quotes.productStyle 1-6），并插入 6 条默认款式产品，使款式数据来源由产品管理模块统一管理'),
  (8, 'add-modified-formulas', '为 quotes 表添加 modifiedFormulas 字段，持久化用户修改过的公式内容'),
  (9, 'add-all-formulas', 'V0.4.2：新增 allFormulas 字段持久化所有公式'),
  (10, 'add-production-step-status', 'V0.4.3：新增 productionStepStatus 字段持久化做货流程各步骤的状态（步骤id→pending/in_progress/completed），使做货中状态下设置的生产流程内容可保存'),
  (11, 'add-operation-logs', 'V0.5.1：新增操作日志表，记录所有删除操作（成功和被阻止），包含操作人、时间、数据ID、操作结果等'),
  (12, 'add-auth-rbac', 'V0.6：新增 RBAC 用户认证与权限管理系统（users/roles/permissions/role_permissions/user_roles 表），预置权限目录、admin 角色、默认管理员账号'),
  (13, 'add-quote-history-triggers', 'V0.7：新增订单数据修改历史记录表（quote_history）及 INSERT/UPDATE/DELETE 触发器，自动捕获订单业务字段变更（旧值/新值/变更字段列表），操作人优先取 @app_operator 会话变量，回退到数据库用户'),
  (14, 'add-sample-completed-status', 'V0.8：新增打样完成状态(7)及 sampleCompletedTime 字段，重构状态流转为指针模式；更新审计触发器追踪新字段'),
  (15, 'add-payment-export-permission', 'V0.9：新增 quotes:export-payment 权限（导出收款单），并分配给 admin 角色'),
  (16, 'add-created-by-updated-by', 'V0.9：quotes表新增 created_by 和 updated_by 字段，记录创建人和修改人'),
  (17, 'add-payment-fields', 'V0.10：quotes表新增收款相关字段（实际收取打样费、打样费抵扣大货、收取定金、待收总金额）'),
  (18, 'add-receivable-sample-fee', 'V0.11：quotes表新增应收打样费字段（receivableSampleFee），待收总额计算公式调整'),
  (19, 'add-sheet-templates', 'V0.12：新增在线表格模板表（sheet_templates）及管理权限，支持模板在线可视化编辑。内置模板作为兜底，数据库存储覆盖版本'),
  (20, 'add-order-templates', 'V0.13：新增订单模板表（order_templates）及管理权限，支持将订单信息保存为可复用模板。与款式模板（sheet_templates）数据结构相互独立'),
  (21, 'add-user-tags-notes', 'V0.13.1：users表新增 tags（用户标签）和 notes（用户备注）字段'),
  (22, 'add-customer-tags-remark', 'V0.14：customers表新增 tags（客户标签，JSON数组字符串）和 remark（备注）字段'),
  (23, 'sheet-templates-one-to-many', 'V0.15：款式模板升级为一对多关系（同一款式可建多个差异化模板），quotes表新增template_id记录订单使用的模板'),
  (24, 'production-task-gantt', 'V0.16：新增quote_production_tasks表存储订单做货流程任务（甘特图数据：计划/实际起止时间、状态、材料清单），迁移存量productionStepStatus数据'),
  (25, 'sheet-templates-style-code-widen', 'V0.17：sheet_templates.style_code 扩容至 VARCHAR(64)，支持新增产品款式编码与无编码产品 id 绑定模板'),
  (26, 'unify-table-collation', 'V0.18：统一 quote_production_tasks / sheet_templates 表排序规则为 utf8mb4_unicode_ci（v23/v24 增量建表未显式指定 COLLATE 落到 MySQL 8 默认 utf8mb4_0900_ai_ci，与 quotes 等表 JOIN 时报 Illegal mix of collations，导致做货跟踪总览接口 500）'),
  (27, 'rename-dashboard-to-workbench', 'V0.19：仪表盘更名为工作台，更新 dashboard:view 菜单权限显示名'),
  (28, 'order-reconciliation', 'V0.20：订单对账管理——quotes 新增 reconciledTime 对账时间字段，新建 quote_reconciliation_costs 表存储对账工艺成本明细（工艺名称/单价/数量/成本/备注）');

-- ============================================================
-- 验证（执行后可运行以下查询确认）
-- ============================================================
-- SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;  -- 应为 28
-- SHOW COLUMNS FROM quotes LIKE 'reconciledTime';  -- 应存在，VARCHAR(64) DEFAULT ''（v28）
-- SHOW CREATE TABLE quote_reconciliation_costs;  -- 应存在，含 name/unit_price/quantity/cost/remark/sort_order
-- SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='quote_reconciliation_costs';  -- 应为 utf8mb4_unicode_ci
-- SELECT name FROM permissions WHERE code = 'dashboard:view';  -- 应为 工作台
-- SHOW CREATE TABLE quote_production_tasks;  -- 应存在，含 plan_start/plan_end/actual_start/actual_end/status/materials
-- SHOW COLUMNS FROM quotes LIKE 'template_id';  -- 应存在，VARCHAR(64) DEFAULT ''
-- SHOW CREATE TABLE sheet_templates;  -- 应含 sort_order 列和 uk_style_name 唯一键，无 uk_style_code
-- SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.columns WHERE table_name='sheet_templates' AND column_name='style_code';  -- 应为 64（v25）
-- SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('quote_production_tasks','sheet_templates');  -- 均应为 utf8mb4_unicode_ci（v26）
-- SHOW TABLES LIKE 'order_templates';  -- 应存在
-- SHOW COLUMNS FROM users LIKE 'tags';  -- 应存在（v21）
-- SHOW COLUMNS FROM customers LIKE 'remark';  -- 应存在（v22）
-- SELECT COUNT(*) FROM permissions;  -- 应为 43
-- SELECT COUNT(*) FROM role_permissions WHERE role_id = 'role-admin';  -- 应为 43
-- SELECT COUNT(*) FROM users WHERE email = '517290808@qq.com';  -- 应为 1
-- SHOW COLUMNS FROM quotes LIKE 'receivableSampleFee';  -- 应存在，DECIMAL(12,2) DEFAULT 0
-- SHOW COLUMNS FROM quotes LIKE 'actualSampleFee';  -- 应存在，DECIMAL(12,2) DEFAULT 0
-- SHOW COLUMNS FROM quotes LIKE 'sampleFeeDeduct';  -- 应存在，TINYINT(1) DEFAULT 0
-- SHOW COLUMNS FROM quotes LIKE 'deposit';  -- 应存在，DECIMAL(12,2) DEFAULT 0
-- SHOW COLUMNS FROM quotes LIKE 'pendingAmount';  -- 应存在，DECIMAL(12,2) DEFAULT 0
-- SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE();  -- 应包含 quotes_audit_insert/update/delete
