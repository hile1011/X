# 生产环境网络配置与服务重启流程

适用环境：X-PR（预发布/生产环境）
文档日期：2026-08-03
应用版本：V0.3.0

本文档说明如何配置 X-PR 生产环境以支持 **IP+端口访问** 与 **外部网络访问**，
以及如何执行**可靠的服务重启**流程。

---

## 一、网络配置

### 1.1 服务监听地址（IP+端口访问）

服务在 `api/index.ts` 中通过 `app.listen(port, host, ...)` 启动：

- **PORT**：来自 `.env`（PR 环境 = `3002`）
- **HOST**：来自 `.env` 的 `HOST` 变量。**留空（默认）则绑定所有接口**（IPv4 + IPv6 双栈 `::`），

  支持 IP+端口访问与外部网络访问；也可设为 `0.0.0.0`（仅 IPv4）或具体网卡 IP。

PR 环境 `.env` 配置（位于 `/Users/hile/Documents/work/projects/X-PR/.env`）：

```env
PORT=3002
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=quote_system
NODE_ENV=production
EXPORT_STORAGE_PATH=./exports
# HOST 留空 = 绑定所有接口（默认，支持外部访问）
# HOST=0.0.0.0   # 仅 IPv4
```

启动后验证监听地址（应显示 `*:3002` 表示所有接口）：

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
# 预期: node  <PID>  ...  TCP *:3002 (LISTEN)
```

启动日志会输出：`[Server] 运行于 0.0.0.0/:: (所有接口):3002`

### 1.2 访问地址

| 访问方式 | 地址 | 说明 |
|---------|------|------|
| 本机 | `http://localhost:3002` | 仅本机访问 |
| 局域网（IP+端口） | `http://192.168.2.8:3002` | 同一局域网内任意设备访问 |
| 公网（互联网） | `http://<公网IP>:<外部端口>` | 需路由器端口转发（见 1.4） |

获取本机局域网 IP：

```bash
ifconfig | grep 'inet ' | grep -v 127.0.0.1
# 示例: inet 192.168.2.8 netmask 0xffffff00 broadcast 192.168.2.255
```

### 1.3 防火墙配置

macOS 有两套防火墙。PR 环境提供配置脚本 `scripts/firewall-setup.sh`：

| 模式 | 命令 | 行为 |
|------|------|------|
| 安全模式（默认） | `bash scripts/firewall-setup.sh` | 检查状态 + 将 node 加入 Application Firewall 允许列表 + 生成 pf 规则文件（不启用防火墙） |
| 启用模式 | `bash scripts/firewall-setup.sh --enable` | 上述 + 启用 pf 与 Application Firewall（需 sudo，invasive） |
| 仅查看状态 | `bash scripts/firewall-setup.sh --status` | 只读，查看防火墙与端口监听状态 |

**安全模式**（推荐先执行）：

```bash
cd /Users/hile/Documents/work/projects/X-PR
bash scripts/firewall-setup.sh
```

安全模式不会改变防火墙启用状态。由于 macOS 默认 Application Firewall 为关闭，
入站流量默认放行，外部访问已可用。安全模式仅确保**未来启用防火墙时** PR 服务不会被阻断。

**启用模式**（安全加固时使用，需 sudo）：

```bash
bash scripts/firewall-setup.sh --enable
```

该模式会：
1. 将 node 加入 socketfilterfw 允许列表并解除阻断
2. 写入 pf anchor 规则文件到 `/etc/pf.anchors/quotepr`（允许入站 TCP 3002）
3. 引导在 `/etc/pf.conf` 中引用 anchor（手动编辑，避免破坏现有配置）
4. 启用 pf 与 Application Firewall

> ⚠️ **注意**：`--enable` 模式会启用 macOS 防火墙，可能影响机器上其他应用。
> 仅在需要安全加固时使用。脚本对 `/etc/pf.conf` 的修改采用手动引导方式，避免自动破坏现有配置。

#### pf 规则文件

pf anchor 规则位于 `config/pf-anchors/quotepr`，内容（允许入站 TCP 3002）：

```pf
PR_PORT = 3002
pass in inet  proto tcp from any to any port $PR_PORT flags S/SA keep state
pass in inet6 proto tcp from any to any port $PR_PORT flags S/SA keep state
```

### 1.4 端口转发（公网/互联网访问）

若需从公网访问 PR 服务，需在**路由器**上配置端口转发（端口映射）。路由器配置无法在主机完成，
需登录路由器管理界面：

| 字段 | 值 |
|------|----|
| 内部主机 IP | `192.168.2.8`（PR 服务所在机器的局域网 IP） |
| 内部端口 | `3002` |
| 外部端口 | 自选（如 `3002` 或 `80`） |
| 协议 | TCP |

配置完成后，公网访问地址为 `http://<路由器公网IP>:<外部端口>`。

> ⚠️ **安全提示**：将服务暴露到公网前，建议：
> - 启用防火墙（`firewall-setup.sh --enable`）
> - 在路由器/反向代理层加 HTTPS（如 nginx + Let's Encrypt）
> - 限制访问来源 IP（若仅特定人员使用）
> - 确认服务已有认证机制（本系统已实现基于 token 的登录，10 分钟无操作自动登出）

---

## 二、服务重启流程

### 2.1 可靠重启脚本

重启脚本位于 `scripts/restart.sh`，采用四阶段机制，最小化停机时间并确保服务可用性：

```
Phase 1: 预检（Pre-restart checks）
  ├─ 后端构建产物 api/dist/index.js 存在？
  ├─ 前端构建产物 dist/index.html 存在？（警告级别）
  ├─ 配置文件 .env 存在？
  ├─ 数据目录就绪？
  ├─ node 可用？
  └─ 端口当前占用情况检查

Phase 2: 优雅关闭（Graceful shutdown）
  ├─ 读取 PID 文件
  ├─ 发送 SIGTERM（触发应用内优雅关闭：停止接受新连接，等待进行中请求完成）
  ├─ 轮询等待进程退出（最长 15s）
  ├─ 超时则发送 SIGKILL 强制终止（兜底）
  ├─ 等待端口释放（最长 10s）
  └─ 端口仍占用则强制结束占用进程

Phase 3: 启动服务（Start service）
  ├─ 备份并清空旧日志
  ├─ 启动新进程（node api/dist/index.js，后台运行）
  ├─ 写入新 PID 文件
  └─ 确认进程未立即退出（1s 后存活检查）

Phase 4: 重启后健康检查（Post-restart health checks）
  ├─ 轮询 http://localhost:<PORT>/api/health（最长 20s，间隔 1s）
  ├─ 进程存活检查（启动过程中崩溃则报告并退出）
  ├─ 数据库 schema 版本验证
  ├─ 端口监听确认
  └─ 启动日志摘要输出
```

**退出码**：`0` 成功 / `1` 预检失败 / `2` 关闭失败 / `3` 启动或进程退出 / `4` 健康检查超时

### 2.2 执行重启

```bash
cd /Users/hile/Documents/work/projects/X-PR
bash scripts/restart.sh
```

预期输出（成功示例）：

```
============================================
  Quote Order System - Robust Restart
  App Dir: /Users/hile/Documents/work/projects/X-PR
  Port:    3002
============================================

[14:07:43] === Phase 1: Pre-restart checks ===
  ... 各项 [OK] ...
[14:07:43] Phase 1 通过 ✓

[14:07:43] === Phase 2: Graceful shutdown ===
  正在优雅停止 PID 40874（SIGTERM）...
  进程已优雅退出（2s）
  等待端口 3002 释放...
  端口 3002 已释放（1s）
[14:07:45] Phase 2 完成 ✓ (服务已停止)

[14:07:45] === Phase 3: Starting service ===
  新进程已启动 (PID 44644)
[14:07:46] Phase 3 完成 ✓ (进程运行中)

[14:07:47] === Phase 4: Post-restart health checks ===
  轮询 http://localhost:3002/api/health ...
  [OK] 健康检查通过（1s）: {"status":"ok",...}
  [OK] 数据库 schema 版本: v4
  [OK] 端口 3002 正在监听
[14:07:47] Phase 4 完成 ✓ (服务健康)

============================================
  Restart Successful ✓
============================================
  PID: 44644 | Port: 3002 | DB Schema: v4
============================================
```

### 2.3 优雅关闭原理

应用代码（`api/index.ts`）注册了 `SIGTERM`/`SIGINT` 信号处理器：

1. 收到信号后调用 `server.close()`，**停止接受新连接**
2. 等待进行中的请求完成
3. 全部连接关闭后正常退出（`exit 0`）
4. 兜底：10 秒未完成则强制退出（防止卡死）

这意味着 `restart.sh` 发送 `SIGTERM` 后，服务会优雅排空当前请求再退出，
**不会中断正在处理的请求**，最大化服务可用性。

### 2.4 其他运维命令

```bash
cd /Users/hile/Documents/work/projects/X-PR

bash scripts/start.sh       # 启动（无预检，简单启动）
bash scripts/stop.sh        # 停止（SIGTERM 优先）
bash scripts/restart.sh     # 可靠重启（推荐，含完整检查）
bash scripts/status.sh     # 查看运行状态（PID/运行时间/内存/CPU）
bash scripts/logs.sh        # 查看日志
```

手动验证健康状态：

```bash
curl http://localhost:3002/api/health
# 预期: {"status":"ok","timestamp":"..."}
```

---

## 三、停机时间分析

四阶段重启的停机时间主要发生在 Phase 2（关闭）到 Phase 3（启动）之间：

| 阶段 | 耗时 | 说明 |
|------|------|------|
| Phase 1 预检 | <1s | 文件检查，无停机 |
| Phase 2 优雅关闭 | 1-15s | 取决于进行中请求；实测约 2s |
| 端口释放等待 | 1-10s | 实测约 1s |
| Phase 3 启动 | 1-2s | node 进程启动 |
| Phase 4 健康检查 | 1-20s | 实测约 1s（迁移已完成时） |

**实测总停机时间约 4-5 秒**（无进行中长请求时）。若数据库有待执行迁移，启动阶段会额外耗时（迁移在事务中执行）。

---

## 四、部署后网络配置清单（首次或环境变更时）

- [ ] 确认 `.env` 中 `PORT=3002`（独立于开发环境 3001/5173）
- [ ] 确认 `HOST` 留空（绑定所有接口）或设为期望地址
- [ ] 执行 `bash scripts/firewall-setup.sh`（安全模式，将 node 加入允许列表）
- [ ] 验证 `lsof -nP -iTCP:3002 -sTCP:LISTEN` 显示 `*:3002`
- [ ] 验证局域网访问：`curl http://192.168.2.8:3002/api/health`
- [ ] （可选）路由器配置端口转发以支持公网访问
- [ ] （可选）`bash scripts/firewall-setup.sh --enable` 启用防火墙加固
- [ ] 执行 `bash scripts/restart.sh` 验证重启流程
