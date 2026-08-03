#!/bin/bash
# ============================================================
#  Quote Order System - V0.3 Production Deployment Script
#  Deploys X (source/dev) to X-PR (production/pre-release)
#
#  Key changes in V0.3:
#    - PR backend port: 3002 (independent from dev's 3001)
#    - Database migrations auto-run on app startup (api/db.ts)
#    - Removed broken require()-based migration (incompatible with ESM)
# ============================================================
set -e

SOURCE_DIR="/Users/hile/Documents/work/projects/X"
TARGET_DIR="/Users/hile/Documents/work/projects/X-PR"

# PR 环境端口（独立于开发环境 3001）
PR_PORT=3002
APP_VERSION="0.3.0"
DB_SCHEMA_VERSION=4

echo "============================================"
echo "  Quote Order System - V0.3 Deployment"
echo "  Source:  $SOURCE_DIR (dev)"
echo "  Target:  $TARGET_DIR (PR)"
echo "  Port:    $PR_PORT (independent from dev 3001)"
echo "============================================"
echo ""

if [ ! -d "$SOURCE_DIR" ]; then
  echo "[ERROR] Source directory not found: $SOURCE_DIR"
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "[ERROR] Target directory not found: $TARGET_DIR"
  exit 1
fi

# ------------------------------------------------------------
# [1/10] 备份现有数据
# ------------------------------------------------------------
echo "[1/10] Backing up existing data..."
BACKUP_DIR="$TARGET_DIR/data/backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -f "$TARGET_DIR/data/quote-system.db" ]; then
  cp "$TARGET_DIR/data/quote-system.db" "$BACKUP_DIR/"
  echo "      Database backed up to $BACKUP_DIR/"
fi
if [ -f "$TARGET_DIR/.env" ]; then
  cp "$TARGET_DIR/.env" "$BACKUP_DIR/"
  echo "      .env backed up to $BACKUP_DIR/"
fi
if [ -d "$TARGET_DIR/api/dist" ]; then
  cp -r "$TARGET_DIR/api/dist" "$BACKUP_DIR/api-dist" 2>/dev/null || true
fi
echo "      Done"

# ------------------------------------------------------------
# [2/10] 停止现有服务
# ------------------------------------------------------------
echo ""
echo "[2/10] Stopping PR service (if running)..."
if [ -f "$TARGET_DIR/scripts/stop.sh" ]; then
  bash "$TARGET_DIR/scripts/stop.sh" 2>/dev/null || true
fi
# 清理可能残留的 PID 文件
rm -f "$TARGET_DIR/data/app.pid" 2>/dev/null || true
echo "      Done"

# ------------------------------------------------------------
# [3/10] 同步源代码
# ------------------------------------------------------------
echo ""
echo "[3/10] Syncing source files from X to X-PR..."

# 后端代码（排除 node_modules/dist/data/.env）
rsync -av --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='data/' \
  --exclude='.env' \
  --exclude='*.log' \
  --exclude='.env.production' \
  --exclude='.DS_Store' \
  --exclude='uploads/' \
  --exclude='exports/' \
  "$SOURCE_DIR/api/" "$TARGET_DIR/api/"

# 前端源码
rsync -av --delete \
  --exclude='.DS_Store' \
  "$SOURCE_DIR/src/" "$TARGET_DIR/src/"

# 配置文件
rsync -av "$SOURCE_DIR/index.html" "$TARGET_DIR/" 2>/dev/null || true
rsync -av "$SOURCE_DIR/postcss.config.js" "$TARGET_DIR/" 2>/dev/null || true
rsync -av "$SOURCE_DIR/tailwind.config.js" "$TARGET_DIR/" 2>/dev/null || true
rsync -av "$SOURCE_DIR/tsconfig.json" "$TARGET_DIR/" 2>/dev/null || true
rsync -av "$SOURCE_DIR/vite.config.ts" "$TARGET_DIR/" 2>/dev/null || true
rsync -av "$SOURCE_DIR/package.json" "$TARGET_DIR/" 2>/dev/null || true
echo "      Source files synced (V0.3)"

# ------------------------------------------------------------
# [4/10] 配置 PR 环境（端口独立于开发环境）
# ------------------------------------------------------------
echo ""
echo "[4/10] Setting up PR environment (PORT=$PR_PORT, independent from dev 3001)..."
mkdir -p "$TARGET_DIR/data/uploads"
mkdir -p "$TARGET_DIR/data/logs"
mkdir -p "$TARGET_DIR/exports"

# 写入 .env，强制使用 PORT=3002 避免与开发环境冲突
cat > "$TARGET_DIR/.env" << EOF
PORT=$PR_PORT
DB_PATH=./data/quote-system.db
NODE_ENV=production
EXPORT_STORAGE_PATH=./exports
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
EOF
echo "      .env written (PORT=$PR_PORT, NODE_ENV=production)"

# 同步 .env.production 模板
cat > "$TARGET_DIR/.env.production" << EOF
PORT=$PR_PORT
DB_PATH=./data/quote-system.db
NODE_ENV=production
EXPORT_STORAGE_PATH=./exports
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
EOF
echo "      .env.production template updated"

# ------------------------------------------------------------
# [5/10] 安装依赖
# ------------------------------------------------------------
echo ""
echo "[5/10] Installing dependencies..."
cd "$TARGET_DIR"
npm install 2>&1 | tail -5
echo "      Dependencies installed"

# ------------------------------------------------------------
# [6/10] 构建前端
# ------------------------------------------------------------
echo ""
echo "[6/10] Building frontend (vite build)..."
cd "$TARGET_DIR"
npx vite build 2>&1 | tail -8
echo "      Frontend built → dist/"

# ------------------------------------------------------------
# [7/10] 构建后端
# ------------------------------------------------------------
echo ""
echo "[7/10] Building backend (tsc -p api/tsconfig.json)..."
cd "$TARGET_DIR"
npx tsc -p api/tsconfig.json 2>&1 | tail -5
# 验证编译产物存在
if [ ! -f "$TARGET_DIR/api/dist/index.js" ]; then
  echo "[ERROR] Backend build failed: api/dist/index.js not found"
  exit 1
fi
echo "      Backend built → api/dist/"

# ------------------------------------------------------------
# [8/10] 启动服务（数据库迁移在启动时自动执行）
# ------------------------------------------------------------
echo ""
echo "[8/10] Starting PR service (DB migrations auto-run on startup)..."
cd "$TARGET_DIR"

# 确保旧进程已停止
if [ -f "$TARGET_DIR/data/app.pid" ]; then
  OLD_PID=$(cat "$TARGET_DIR/data/app.pid")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
  rm -f "$TARGET_DIR/data/app.pid"
fi

# 启动服务
LOG_FILE="$TARGET_DIR/data/logs/app.log"
mkdir -p "$TARGET_DIR/data/logs"
# 清空旧日志以便观察迁移输出
> "$LOG_FILE"

NODE_ENV=production node api/dist/index.js >> "$LOG_FILE" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$TARGET_DIR/data/app.pid"

echo "      Service starting (PID: $APP_PID, PORT: $PR_PORT)"

# 等待服务启动并完成迁移
echo "      Waiting for service to initialize and run migrations..."
for i in $(seq 1 15); do
  sleep 1
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[ERROR] Process exited unexpectedly. Logs:"
    cat "$LOG_FILE"
    exit 1
  fi
  # 检查健康端点
  if curl -s "http://localhost:$PR_PORT/api/health" > /dev/null 2>&1; then
    echo "      Service is responding on port $PR_PORT"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "[WARN] Service did not respond within 15s. Checking logs..."
    tail -20 "$LOG_FILE"
  fi
done

# 显示迁移日志
echo ""
echo "      --- Migration / Startup Log ---"
grep -E '\[DB\]|\[Server\]' "$LOG_FILE" 2>/dev/null | head -20
echo "      --- End Log ---"

# ------------------------------------------------------------
# [9/10] 验证部署
# ------------------------------------------------------------
echo ""
echo "[9/10] Verifying deployment..."

# 9a. 健康检查
HEALTH=$(curl -s "http://localhost:$PR_PORT/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
  echo "      [OK] Health check passed: $HEALTH"
else
  echo "      [WARN] Health check response: $HEALTH"
fi

# 9b. 验证数据库 schema 版本（通过 schema_migrations 表）
DB_VERSION=$(cd "$TARGET_DIR" && node -e "
import('sql.js').then(async (mod) => {
  const initSqlJs = mod.default;
  const SQL = await initSqlJs();
  const fs = await import('fs');
  const path = await import('path');
  const dbPath = path.resolve('./data/quote-system.db');
  if (!fs.existsSync(dbPath)) { console.log('NO_DB'); return; }
  const buf = fs.readFileSync(dbPath);
  const db = new SQL.Database(buf);
  const stmt = db.prepare('SELECT MAX(version) as v FROM schema_migrations');
  stmt.step();
  const row = stmt.getAsObject();
  console.log(row.v || 0);
  stmt.free();
  db.close();
});
" 2>/dev/null)
echo "      Database schema version: v$DB_VERSION (target: v$DB_SCHEMA_VERSION)"

# 9c. 端口验证
PORT_CHECK=$(lsof -nP -iTCP:$PR_PORT -sTCP:LISTEN 2>/dev/null | tail -1)
if [ -n "$PORT_CHECK" ]; then
  echo "      [OK] Port $PR_PORT is listening: $PORT_CHECK"
else
  echo "      [WARN] Port $PR_PORT not detected"
fi

# 9d. 确认与开发环境端口不冲突
DEV_PORT_CHECK=$(lsof -nP -iTCP:3001 -sTCP:LISTEN 2>/dev/null | grep -v "PID" | head -1)
if [ -n "$DEV_PORT_CHECK" ]; then
  echo "      [OK] Dev port 3001 is in use (separate from PR port $PR_PORT)"
else
  echo "      [INFO] Dev port 3001 not currently in use"
fi

# ------------------------------------------------------------
# [10/10] 设置权限
# ------------------------------------------------------------
echo ""
echo "[10/10] Setting permissions..."
chmod +x "$TARGET_DIR/scripts/"*.sh 2>/dev/null || true
echo "      Done"

# ------------------------------------------------------------
echo ""
echo "============================================"
echo "  V0.3 Deployment Complete!"
echo "============================================"
echo ""
echo "  Application Version: v$APP_VERSION"
echo "  Database Schema:     v$DB_VERSION"
echo "  PR Service Port:    $PR_PORT"
echo "  Dev Service Port:   3001 (separate)"
echo "  PID:                $APP_PID"
echo ""
echo "  Access URL:         http://localhost:$PR_PORT"
echo ""
echo "  Commands:"
echo "    Start:   bash $TARGET_DIR/scripts/start.sh"
echo "    Stop:    bash $TARGET_DIR/scripts/stop.sh"
echo "    Status:  bash $TARGET_DIR/scripts/status.sh"
echo "    Logs:    bash $TARGET_DIR/scripts/logs.sh"
echo ""
