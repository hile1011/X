#!/bin/bash
# ============================================================
#  Quote Order System - Production Deployment Script
#  Deploys X (source) to X-PR (production)
# ============================================================
set -e

SOURCE_DIR="/Users/hile/Documents/work/projects/X"
TARGET_DIR="/Users/hile/Documents/work/projects/X-PR"

echo "============================================"
echo "  Quote Order System - Deployment"
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

echo "[1/9] Backing up existing data..."
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
echo "      Done"

echo ""
echo "[2/9] Stopping production service (if running)..."
if [ -f "$TARGET_DIR/scripts/stop.sh" ]; then
  bash "$TARGET_DIR/scripts/stop.sh" 2>/dev/null || true
fi
echo "      Done"

echo ""
echo "[3/9] Syncing source files from X to X-PR..."
rsync -av --delete \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='data/' \
  --exclude='.env' \
  --exclude='*.log' \
  --exclude='.env.production' \
  "$SOURCE_DIR/api/" "$TARGET_DIR/api/"

rsync -av \
  "$SOURCE_DIR/src/" "$TARGET_DIR/src/"

rsync -av \
  "$SOURCE_DIR/index.html" "$TARGET_DIR/" 2>/dev/null || true
rsync -av \
  "$SOURCE_DIR/postcss.config.js" "$TARGET_DIR/" 2>/dev/null || true
rsync -av \
  "$SOURCE_DIR/tailwind.config.js" "$TARGET_DIR/" 2>/dev/null || true
rsync -av \
  "$SOURCE_DIR/package.json" "$TARGET_DIR/" 2>/dev/null || true
echo "      Source files synced"

echo ""
echo "[4/9] Setting up production environment..."
mkdir -p "$TARGET_DIR/data/uploads"
mkdir -p "$TARGET_DIR/data/logs"
mkdir -p "$TARGET_DIR/exports"

if [ ! -f "$TARGET_DIR/.env" ]; then
  cp "$TARGET_DIR/.env.production" "$TARGET_DIR/.env" 2>/dev/null || true
  echo "      Created .env from .env.production template"
else
  echo "      .env already exists, keeping current config"
fi
echo "      Done"

echo ""
echo "[5/9] Installing dependencies..."
cd "$TARGET_DIR"
npm install 2>&1 | tail -3
echo "      Dependencies installed"

echo ""
echo "[6/9] Building frontend..."
cd "$TARGET_DIR"
npx vite build 2>&1 | tail -5
echo "      Frontend built"

echo ""
echo "[7/9] Building backend..."
cd "$TARGET_DIR"
npx tsc -p api/tsconfig.json 2>&1 | tail -5
echo "      Backend built"

echo ""
echo "[8/9] Running database migrations..."
cd "$TARGET_DIR"
node -e "
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.resolve('./data/quote-system.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  
  let rawDb;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }
  
  rawDb.run('PRAGMA foreign_keys = ON');
  
  // Run migrations
  const { MigrationRunner } = require('./api/dist/migrations/index');
  
  const dbWrapper = {
    exec: (sql) => rawDb.run(sql),
    prepare: (sql) => ({
      run: (...params) => {
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        stmt.step();
        const changes = rawDb.getRowsModified();
        stmt.free();
        return { changes };
      },
      get: (...params) => {
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        const hasRow = stmt.step();
        const row = hasRow ? stmt.getAsObject() : null;
        stmt.free();
        return row;
      },
      all: (...params) => {
        const stmt = rawDb.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
    }),
    transaction: (fn) => () => {
      rawDb.run('BEGIN');
      try { const result = fn(); rawDb.run('COMMIT'); return result; }
      catch (e) { rawDb.run('ROLLBACK'); throw e; }
    },
  };
  
  const runner = new MigrationRunner(dbWrapper);
  const currentVersion = runner.getCurrentVersion();
  console.log('[DB] Current schema version:', currentVersion);
  
  const result = runner.migrate();
  result.applied.forEach(m => console.log('[DB] Applied:', m));
  if (result.skipped.length > 0) result.skipped.forEach(m => console.log('[DB] Skipped:', m));
  console.log('[DB] Schema at version', runner.getCurrentVersion());
  
  // Persist
  const data = rawDb.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
  rawDb.close();
  console.log('[OK] Database migrations completed');
})().catch(err => {
  console.error('[ERROR] Migration failed:', err.message);
  process.exit(1);
});
"
echo "      Database migrations applied"

echo ""
echo "[9/9] Setting permissions..."
chmod +x "$TARGET_DIR/scripts/"*.sh 2>/dev/null || true
echo "      Done"

echo ""
echo "============================================"
echo "  Deployment Complete!"
echo "============================================"
echo ""
echo "  Production server is ready."
echo ""
echo "  Commands:"
echo "    Start:   bash $TARGET_DIR/scripts/start.sh"
echo "    Stop:    bash $TARGET_DIR/scripts/stop.sh"
echo "    Restart: bash $TARGET_DIR/scripts/restart.sh"
echo "    Logs:    bash $TARGET_DIR/scripts/logs.sh"
echo "    Status:  bash $TARGET_DIR/scripts/status.sh"
echo ""
echo "  To configure nginx:"
echo "    sudo cp $TARGET_DIR/nginx/quote-system.conf /etc/nginx/conf.d/"
echo "    sudo nginx -t"
echo "    sudo systemctl reload nginx"
echo ""
