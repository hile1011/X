# 环境管理命令使用文档

> 本文档描述项目的标准化环境管理命令集，支持日常开发与运维操作。

## 目录

- [命令概览](#命令概览)
- [集中配置](#集中配置)
- [构建命令 (build.sh)]#构建命令-buildsh)
- [启动命令 (start.sh)](#启动命令-startsh)
- [停止命令 (stop.sh)](#停止命令-stopsh)
- [重启命令 (restart.sh)](#重启命令-restartsh)
- [状态查询 (status.sh)](#状态查询-statussh)
- [npm 命令别名](#npm-命令别名)
- [常见问题 (FAQ)](#常见问题-faq)

---

## 命令概览

| 命令 | 文件 | 功能 |
|------|------|------|
| 构建 | `scripts/build.sh` | 完整构建流水线（依赖→检查→测试→覆盖率→打包→报告） |
| 启动 | `scripts/start.sh` | 启动服务（前台/守护进程模式） |
| 停止 | `scripts/stop.sh` | 安全终止服务（优雅/强制） |
| 重启 | `scripts/restart.sh` | 平滑重启（滚动/蓝绿部署 + 回滚） |
| 状态 | `scripts/status.sh` | 查询服务运行状态 |

所有命令支持 `-h` / `--help` 查看帮助。

---

## 集中配置

所有端口、路径、超时等配置集中管理在 [scripts/env-config.sh](file:///Users/hile/Documents/work/projects/X/scripts/env-config.sh)，支持三种环境：

| 环境 | 参数值 | 后端端口 | 前端端口 | 数据库 |
|------|--------|----------|----------|--------|
| 开发 | `dev` | 3001 | 5173 | data/quote-system.db |
| 测试 | `test` | 3002 | 5174 | data/quote-system-test.db |
| 生产 | `prod` | 3003 | 80 | data/quote-system.db |

> **关于生产环境**：真正的生产部署位于独立目录 `X-PR`（端口 3002），由 [scripts/deploy.js](file:///Users/hile/Documents/work/projects/X/scripts/deploy.js) 管理。
> 此处的 `prod` 配置用于在本项目目录内运行编译后的构建产物进行本地冒烟验证，使用 3003 端口以避免与 `dev`(3001)/`test`(3002) 冲突。
> 启动时会通过环境变量注入 `PORT`/`DB_PATH`/`NODE_ENV` 覆盖 `api/.env` 默认值，实现多环境隔离。

配置项一览：

```bash
ENV_NAME          # 环境名称
BACKEND_PORT      # 后端端口
FRONTEND_PORT     # 前端端口
NODE_ENV           # NODE_ENV 值
DB_PATH            # SQLite 数据库路径
DATA_DIR           # 数据目录
LOG_DIR            # 日志目录
LOG_FILE           # 操作日志文件
PID_FILE           # PID 文件
BUILD_REPORT_FILE  # 构建报告文件
EXPORT_DIR         # 导出目录
HEALTH_TIMEOUT     # 健康检查超时秒数
GRACEFUL_TIMEOUT   # 优雅关闭等待秒数
```

---

## 构建命令 (build.sh)

### 功能

从源代码到可执行文件的完整构建流水线：

1. **依赖安装与版本校验** — 检查 Node/npm 版本，增量或全量安装依赖
2. **静态代码质量检查** — TypeScript 类型检查 (`tsc --noEmit`)
3. **单元测试执行** — Vitest 运行全部测试
4. **代码覆盖率分析** — V8 provider 覆盖率报告（90% 阈值）
5. **构建产物打包** — 前端 (vite build) + 后端 (tsc 编译)
6. **构建报告生成** — 耗时、状态、Git 版本等

### 选项

| 选项 | 说明 |
|------|------|
| `-e, --env <env>` | 目标环境: `dev`(默认) / `test` / `prod` |
| `-c, --clean` | 全量构建（清理缓存后重建） |
| `--skip-deps` | 跳过依赖安装 |
| `--skip-test` | 跳过单元测试 |
| `--skip-coverage` | 跳过覆盖率分析 |
| `--skip-build` | 跳过构建产物打包（仅检查和测试） |
| `-h, --help` | 显示帮助 |

### 示例

```bash
# 增量构建（dev 环境）
bash scripts/build.sh

# 生产全量构建
bash scripts/build.sh -e prod -c

# 跳过测试快速构建
bash scripts/build.sh --skip-test

# 仅运行类型检查和测试（不打包）
bash scripts/build.sh --skip-build
```

### 构建报告

构建报告输出到 `data/logs/build-report-{env}.log`，包含：
- 构建状态（成功/失败）
- 构建耗时
- 环境信息
- Node 版本
- Git commit hash
- 跳过的步骤

---

## 启动命令 (start.sh)

### 功能

启动后端 + 前端服务，支持两种运行模式：

- **前台模式**（默认 dev）：使用 `tsx watch` 热重载，便于开发调试
- **守护进程模式**（`-d` 或 prod 环境）：后台运行编译后的代码

### 启动流程

1. 预检查（端口冲突、PID 残留、构建产物存在性）
2. 启动后端服务
3. 健康检查（`/api/health` 端点，超时 15s）
4. （dev 模式）启动前端 Vite 开发服务器
5. 启动总结报告

### 选项

| 选项 | 说明 |
|------|------|
| `-e, --env <env>` | 环境: `dev`(默认) / `test` / `prod` |
| `-d, --daemon` | 后台守护进程模式 |
| `-f, --frontend-only` | 仅启动前端（dev 模式） |
| `-b, --backend-only` | 仅启动后端 |
| `-h, --help` | 显示帮助 |

### 示例

```bash
# 前台启动 dev 环境（前端+后端）
bash scripts/start.sh

# 生产后台守护进程
bash scripts/start.sh -e prod -d

# 仅启动后端
bash scripts/start.sh -b

# 仅启动前端开发服务器
bash scripts/start.sh -f
```

---

## 停止命令 (stop.sh)

### 功能

安全终止应用程序及所有相关服务进程。

### 优雅关闭机制

1. 发送 `SIGTERM` 信号
2. 等待进程完成当前任务、数据持久化及资源释放（默认 10s）
3. 超时后自动发送 `SIGKILL` 强制终止
4. 确认端口已释放

### 选项

| 选项 | 说明 |
|------|------|
| `-e, --env <env>` | 环境: `dev`(默认) / `test` / `prod` |
| `-f, --force` | 强制终止（SIGKILL，跳过优雅关闭，有数据丢失风险） |
| `-a, --all` | 停止所有环境的所有服务 |
| `-h, --help` | 显示帮助 |

### 示例

```bash
# 优雅停止 dev 环境
bash scripts/stop.sh

# 停止生产环境
bash scripts/stop.sh -e prod

# 强制停止（无响应进程）
bash scripts/stop.sh -f

# 停止所有环境
bash scripts/stop.sh -a
```

### 停止报告

执行后输出：
- 成功终止的进程列表
- 异常终止的进程列表
- 端口释放状态

---

## 重启命令 (restart.sh)

### 功能

平滑重启应用程序，最小化服务中断时间。

### 重启策略

| 策略 | 命令 | 说明 |
|------|------|------|
| 滚动重启 | `bash scripts/restart.sh` | 停止旧进程 → 启动新进程 |
| 蓝绿部署 | `bash scripts/restart.sh -g` | 启动新实例 → 健康检查通过后停止旧实例 |

### 回滚机制

- 重启前自动备份数据库到 `data/backup/restart-{timestamp}/`
- 记录旧 PID 和备份路径
- 健康检查失败时自动恢复数据库并重新启动

### 选项

| 选项 | 说明 |
|------|------|
| `-e, --env <env>` | 环境: `dev`(默认) / `test` / `prod` |
| `-g, --blue-green` | 蓝绿部署模式（零停机） |
| `--rollback` | 回滚到上次重启前的状态 |
| `-h, --help` | 显示帮助 |

### 示例

```bash
# 滚动重启 dev
bash scripts/restart.sh

# 生产蓝绿部署
bash scripts/restart.sh -e prod -g

# 回滚到上次重启前的状态
bash scripts/restart.sh --rollback
```

---

## 状态查询 (status.sh)

### 功能

查询服务运行状态、端口监听、健康检查、数据库大小。

### 选项

| 选项 | 说明 |
|------|------|
| `-e, --env <env>` | 环境: `dev`(默认) / `test` / `prod` |
| `-a, --all` | 查询所有环境 |
| `-h, --help` | 显示帮助 |

### 示例

```bash
# 查询 dev 环境状态
bash scripts/status.sh

# 查询所有环境
bash scripts/status.sh -a
```

---

## npm 命令别名

也可通过 npm 脚本调用：

```bash
npm run env:build    # = bash scripts/build.sh
npm run env:start    # = bash scripts/start.sh
npm run env:stop     # = bash scripts/stop.sh
npm run env:restart  # = bash scripts/restart.sh
npm run env:status   # = bash scripts/status.sh
```

---

## 日志

所有操作日志按规范格式存储在 `data/logs/env-operations.log`：

```
[2026-08-04 16:30:00] [INFO] 依赖就绪
[2026-08-04 16:30:05] [OK] 类型检查通过
[2026-08-04 16:30:10] [STEP] 单元测试执行
```

其他日志文件：
- `data/logs/app-dev.log` — 开发环境后端日志
- `data/logs/app-prod.log` — 生产环境后端日志
- `data/logs/build-report-{env}.log` — 构建报告

---

## 常见问题 (FAQ)

### Q: 端口被占用怎么办？

```bash
# 查看占用进程
lsof -nP -iTCP:3001 -sTCP:LISTEN

# 停止占用端口的服务
bash scripts/stop.sh -e dev -f
```

### Q: 构建失败如何排查？

1. 查看 `data/logs/build-report-dev.log` 中的构建报告
2. 单独运行类型检查：`npm run check`
3. 单独运行测试：`npm test`
4. 全量构建清除缓存：`bash scripts/build.sh -c`

### Q: 重启后服务不健康怎么办？

```bash
# 自动回滚到上次重启前的状态
bash scripts/restart.sh --rollback
```

### Q: 生产环境需要先做什么？

```bash
# 1. 全量构建
bash scripts/build.sh -e prod -c

# 2. 后台启动
bash scripts/start.sh -e prod -d

# 3. 验证状态
bash scripts/status.sh -e prod
```

### Q: 如何查看实时日志？

```bash
# 后端日志
tail -f data/logs/app-prod.log

# 操作日志
tail -f data/logs/env-operations.log
```
