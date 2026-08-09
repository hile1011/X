# 数据库基准快照（Baselines）

> ⚠️ **安全警告**：此目录包含生产环境真实数据，**严禁提交到 Git 仓库**。
> 已通过 `.gitignore` 排除。

## 文件说明

| 文件 | 说明 | 生成时间 |
|------|------|----------|
| `baseline_v11_prod.sql` | 生产环境 v11 完整快照（结构 + 数据） | 从远程数据库导出 |
| `baseline_v12_integrated.sql` | v12 整合快照（v11 生产数据 + RBAC 权限系统） | v11 基准 + v12 迁移 |

## 用途

1. **开发环境初始化**：导入 `baseline_v12_integrated.sql` 可一步到位获得完整开发数据
2. **数据对比基准**：开发/测试环境数据与生产基准的差异化检查
3. **灾难恢复**：生产环境数据丢失时的恢复来源

## 使用方法

```bash
# 初始化开发环境数据库（从整合快照）
mysql -u root -h 127.0.0.1 -e "DROP DATABASE IF EXISTS quote_system; CREATE DATABASE quote_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -h 127.0.0.1 quote_system < db/baselines/baseline_v12_integrated.sql

# 验证
mysql -u root -h 127.0.0.1 quote_system -e "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;"
# 应输出 12
```

## 生成方法

```bash
# 1. 从生产环境导出基准
mysqldump -u root -h 127.0.0.1 quote_system_prod \
  --single-transaction --routines --triggers --skip-comments \
  --set-gtid-purged=OFF > db/baselines/baseline_v11_prod.sql

# 2. 导入到临时数据库并执行迁移
mysql -u root -e "CREATE DATABASE quote_system_integrated CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root quote_system_integrated < db/baselines/baseline_v11_prod.sql
MYSQL_DATABASE=quote_system_integrated npm run db:migrate

# 3. 导出整合快照
mysqldump -u root -h 127.0.0.1 quote_system_integrated \
  --single-transaction --routines --triggers --skip-comments \
  --set-gtid-purged=OFF > db/baselines/baseline_v12_integrated.sql

# 4. 清理临时数据库
mysql -u root -e "DROP DATABASE IF EXISTS quote_system_integrated;"
```

## 更新时机

- 每次发布新版本前，重新从生产环境导出并整合
- 生产环境数据发生重大变更后
- 开发环境需要同步最新生产数据时
