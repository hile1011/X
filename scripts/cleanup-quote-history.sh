#!/bin/bash
# ============================================================
#  cleanup-quote-history.sh — 订单历史记录定时清理（cron 入口）
#
#  清理 quote_history 表中超过保留期限（默认 30 天）的历史记录。
#  适合通过 crontab 定时调用，日志输出到 stdout/stderr 便于重定向。
#
#  用法：
#    bash scripts/cleanup-quote-history.sh              # 清理 30 天前的记录
#    bash scripts/cleanup-quote-history.sh --dry-run    # 仅统计不删除
#    bash scripts/cleanup-quote-history.sh --retain 90  # 自定义保留 90 天
#
#  crontab 配置（每天凌晨 3:17 执行）：
#    17 3 * * * cd /path/to/project && bash scripts/cleanup-quote-history.sh >> logs/cleanup.log 2>&1
#
#  退出码：0=成功，1=失败
# ============================================================
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# 优先使用项目本地 tsx，避免全局依赖
TSX_BIN="$PROJECT_ROOT/node_modules/.bin/tsx"
if [ ! -x "$TSX_BIN" ]; then
  echo "[cleanup-quote-history] 未找到 tsx（$TSX_BIN），请先执行 npm install" >&2
  exit 1
fi

exec "$TSX_BIN" "$PROJECT_ROOT/scripts/cleanup-quote-history.ts" "$@"
