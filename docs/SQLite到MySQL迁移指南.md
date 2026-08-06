# SQLite 到 MySQL 迁移指南

> 适用于从 SQLite（sql.js）版本升级到 MySQL 版本的生产环境

---

## 1. 迁移前准备

### 1.1 环境要求

- MySQL 8.0+（支持生成列和 utf8mb4 字符集）
- Node.js 20+
- 原 SQLite 数据库文件（`./data/quote-system.db`）

### 1.2 安装 MySQL

```bash
# macOS (Homebrew)
brew install mysql
brew services start mysql

# 设置 root 密码（按需）
mysql_secure_installation
```

### 1.3 创建数据库

```sql
CREATE DATABASE IF NOT EXISTS quote_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

---

## 2. 数据迁移

### 2.1 配置环境变量

更新 `api/.env`：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=quote_system
```

### 2.2 执行迁移脚本

```bash
# 1. 安装依赖（移除 sql.js，添加 mysql2）
npm install

# 2. 执行数据库 Schema 迁移（创建表结构）
npm run db:migrate

# 3. 执行数据迁移（从 SQLite 导入到 MySQL）
npx tsx api/migrate-sqlite-to-mysql.ts
```

`migrate-sqlite-to-mysql.ts` 脚本会：
1. 读取原 SQLite 数据库文件
2. 初始化 MySQL 数据库表结构
3. 逐表迁移数据（customers → products → quotes → orders → order_items → tasks → process_costs）
4. 验证数据完整性（比对 SQLite 和 MySQL 行数）

### 2.3 验证迁移结果

```bash
# 启动服务
bash scripts/start.sh -e dev -b

# 测试 API
curl http://localhost:3001/api/health
curl http://localhost:3001/api/quotes | python3 -m json.tool | head -20

# 停止服务
bash scripts/stop.sh -e dev
```

---

## 3. 回滚方案

如果迁移后发现问题，可以回滚到 SQLite 版本：

1. 保留原 SQLite 数据库文件备份（`./data/quote-system.db`）
2. 回退代码到迁移前的 Git 版本
3. 恢复 `api/.env` 中的 `DB_PATH` 配置

---

## 4. 注意事项

### 4.1 数据类型映射

| SQLite 类型 | MySQL 类型 | 说明 |
|-------------|-----------|------|
| TEXT | VARCHAR(64-500) / LONGTEXT | 根据字段用途选择长度 |
| INTEGER | INT | 整数类型 |
| REAL | DOUBLE | 浮点数类型 |
| datetime('now','localtime') | DATETIME DEFAULT CURRENT_TIMESTAMP | MySQL 自动使用 UTC |

### 4.2 生成列（Generated Column）

MySQL 使用生成列实现 `products.code_key`（部分唯一索引）：

```sql
code_key VARCHAR(64) GENERATED ALWAYS AS (IF(code = '', NULL, code)) STORED
CREATE UNIQUE INDEX idx_products_code ON products(code_key)
```

这确保 `code` 非空时唯一，空值可重复。

### 4.3 多语句执行

MySQL 连接池配置 `multipleStatements: false`（防 SQL 注入）。迁移系统通过 `execMultiStatement()` 按分号拆分 DDL 逐条执行。

### 4.4 时间格式

- MySQL `DATETIME` 格式：`YYYY-MM-DD HH:MM:SS`
- 代码中 `timeNow()` 函数已适配：`new Date().toISOString().slice(0, 19).replace('T', ' ')`

### 4.5 测试数据库

测试使用独立的 `quote_system_test` 数据库：

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS quote_system_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
```

---

## 5. 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `api/dbClient.ts` | 新增 | MySQL 连接池单例 |
| `api/db.ts` | 修改 | 异步数据库包装器 |
| `api/migrations/index.ts` | 修改 | MySQL 兼容的 DDL 语法 |
| `api/migrate.ts` | 修改 | 迁移命令行工具 |
| `api/reset.ts` | 修改 | 数据库重置工具 |
| `api/seed.ts` | 修改 | 数据种子工具 |
| `api/migrate-sqlite-to-mysql.ts` | 新增 | SQLite 到 MySQL 数据迁移脚本 |
| `api/.env` | 修改 | MySQL 连接配置 |
| `api/sqljs.d.ts` | 删除 | SQLite 类型声明 |
| `package.json` | 修改 | 移除 sql.js，添加 mysql2 |
| `scripts/env-config.sh` | 修改 | MySQL 环境变量配置 |
| `scripts/start.sh` | 修改 | 注入 MySQL 环境变量 |
| `scripts/restart.sh` | 修改 | MySQL 备份/恢复 |
| `scripts/status.sh` | 修改 | MySQL 数据库状态查询 |
| `tests/helpers/db-reset.ts` | 修改 | MySQL 测试数据重置 |
| `tests/setup.ts` | 修改 | MySQL 测试环境配置 |
| `tests/globalSetup.ts` | 新增 | 测试连接池清理 |
| `vitest.config.ts` | 修改 | vitest 4 配置适配 |
