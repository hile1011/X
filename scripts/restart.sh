#!/bin/bash
# ============================================================
#  restart.sh — 环境重启命令
#
#  实现应用程序的平滑重启，最小化服务中断时间。
#
#  重启策略：
#    - 滚动重启（默认）：停止旧进程 → 启动新进程
#    - 蓝绿部署（--blue-green）：启动新实例 → 健康检查通过后停止旧实例
#
#  回滚机制：
#    - 重启前备份数据库
#    - 记录旧版本 PID 和启动时间
#    - 健康检查失败时自动恢复到之前的状态
#
#  用法：
#    bash scripts/restart.sh [选项]
#
#  选项：
#    -e, --env <env>        环境 (dev|test|prod)，默认 dev
#    -g, --blue-green       蓝绿部署模式（零停机）
#    --rollback              回滚到上次重启前的状态
#    -h, --help              显示帮助
# ============================================================
set -eo pipefail

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

_restart_help() {
  print_help_header "restart.sh — 环境重启命令" "平滑重启应用程序，支持滚动重启和蓝绿部署"
  echo "用法: bash scripts/restart.sh [选项]"
  echo ""
  echo "选项:"
  print_help_option "-e, --env <env>"      "环境: dev(默认) / test / prod"
  print_help_option "-g, --blue-green"    "蓝绿部署模式（启动新实例后停止旧实例，零停机）"
  print_help_option "    --rollback"       "回滚到上次重启前的状态"
  print_help_option "-h, --help"           "显示此帮助"
  echo ""
  echo "示例:"
  echo "  bash scripts/restart.sh                  # 滚动重启 dev"
  echo "  bash scripts/restart.sh -e prod -g       # 生产蓝绿部署"
  echo "  bash scripts/restart.sh --rollback        # 回滚"
}

BUILD_ENV="dev"
FLAG_BLUE_GREEN=false
FLAG_ROLLBACK=false

while [ $# -gt 0 ]; do
  case "$1" in
    -e|--env)       BUILD_ENV="$2"; shift 2 ;;
    -g|--blue-green) FLAG_BLUE_GREEN=true; shift ;;
    --rollback)     FLAG_ROLLBACK=true; shift ;;
    -h|--help)      _restart_help; exit 0 ;;
    *)              log_error "未知选项: $1"; _restart_help; exit 1 ;;
  esac
done

load_config "$BUILD_ENV"

# ---------- 回滚机制 ----------
# 重启前备份当前数据库和状态
_restart_backup() {
  log_info "创建重启前备份..."
  _backup_dir="$DATA_DIR/backup/restart-$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$_backup_dir"

  # 备份数据库
  if [ -f "$DB_PATH" ]; then
    cp "$DB_PATH" "$_backup_dir/quote-system.db"
    log_info "数据库已备份: $_backup_dir/quote-system.db"
  fi

  # 记录当前 PID
  _old_pid="$(pid_read)"
  if [ -n "$_old_pid" ]; then
    echo "$_old_pid" > "$_backup_dir/old-pid.txt"
  fi

  # 记录备份路径到状态文件（供 --rollback 使用）
  echo "$_backup_dir" > "$DATA_DIR/.last-restart-backup"
  log_ok "备份完成: $_backup_dir"
}

# 回滚到上次重启前的状态
_restart_rollback() {
  log_step "回滚操作"
  _backup_ref="$DATA_DIR/.last-restart-backup"

  if [ ! -f "$_backup_ref" ]; then
    log_error "未找到上次重启备份记录，无法回滚"
    exit 1
  fi

  _backup_dir="$(cat "$_backup_ref")"
  if [ ! -d "$_backup_dir" ]; then
    log_error "备份目录不存在: $_backup_dir"
    exit 1
  fi

  log_info "回滚目标: $_backup_dir"

  # 停止当前服务
  log_info "停止当前服务..."
  bash "$SCRIPTS_DIR/stop.sh" -e "$ENV_SHORT" -f 2>/dev/null || true

  # 恢复数据库
  if [ -f "$_backup_dir/quote-system.db" ]; then
    cp "$_backup_dir/quote-system.db" "$DB_PATH"
    log_ok "数据库已恢复"
  fi

  # 重新启动
  log_info "重新启动服务..."
  bash "$SCRIPTS_DIR/start.sh" -e "$ENV_SHORT" -d

  # 健康检查
  if health_check "$BACKEND_PORT" "$HEALTH_TIMEOUT"; then
    log_ok "回滚完成 — 服务已恢复"
    rm -f "$_backup_ref"
  else
    log_error "回滚后健康检查失败"
    exit 1
  fi
}

# 回滚优先处理
if [ "$FLAG_ROLLBACK" = true ]; then
  _restart_rollback
  exit 0
fi

# ---------- 重启前健康检查 ----------
_restart_precheck() {
  log_step "重启前健康检查"
  if pid_is_running; then
    log_info "当前服务运行中 (PID: $(pid_read))"
    if health_check "$BACKEND_PORT" 5; then
      log_ok "当前服务健康"
    else
      log_warn "当前服务不健康，仍将进行重启"
    fi
  else
    log_info "当前无运行中的服务，直接启动"
  fi
}

# ---------- 滚动重启 ----------
_restart_rolling() {
  log_step "滚动重启模式"
  _restart_backup

  log_info "停止旧服务..."
  bash "$SCRIPTS_DIR/stop.sh" -e "$ENV_SHORT"

  log_info "启动新服务..."
  if [ "$ENV_NAME" = "production" ]; then
    bash "$SCRIPTS_DIR/start.sh" -e "$ENV_SHORT" -d
  else
    # 开发模式：启动后端(tsx watch) + 前端(vite)，不使用 -d（daemon 模式会改用 node 加载编译产物，丢失热重载）
    bash "$SCRIPTS_DIR/start.sh" -e "$ENV_SHORT"
  fi

  log_info "重启后健康检查..."
  if health_check "$BACKEND_PORT" "$HEALTH_TIMEOUT"; then
    log_ok "重启成功 — 服务已恢复"
  else
    log_error "重启后健康检查失败 — 尝试自动回滚"
    bash "$SCRIPTS_DIR/restart.sh" -e "$ENV_SHORT" --rollback
    exit 1
  fi
}

# ---------- 蓝绿部署 ----------
_restart_blue_green() {
  log_step "蓝绿部署模式（零停机）"
  _restart_backup

  _old_pid="$(pid_read)"
  _old_port="$BACKEND_PORT"

  # 新实例使用新端口（+100 偏移）
  _new_port=$((BACKEND_PORT + 100))
  log_info "新实例端口: $_new_port（蓝绿切换）"

  # 启动新实例
  log_info "启动新实例（绿）..."
  PORT="$_new_port" DB_PATH="$DB_PATH" NODE_ENV="$NODE_ENV" \
    nohup node "$PROJECT_ROOT/api/dist/index.js" >> "$LOG_DIR/app-bg.log" 2>&1 &
  _new_pid=$!
  disown 2>/dev/null || true

  log_info "等待新实例健康检查..."
  if ! health_check "$_new_port" "$HEALTH_TIMEOUT"; then
    log_error "新实例健康检查失败 — 终止新实例，保持旧实例运行"
    kill -KILL "$_new_pid" 2>/dev/null || true
    log_ok "旧实例仍在运行 (PID: ${_old_pid:-N/A})"
    exit 1
  fi
  log_ok "新实例健康 (PID: $_new_pid)"

  # 停止旧实例
  if [ -n "$_old_pid" ] && kill -0 "$_old_pid" 2>/dev/null; then
    log_info "停止旧实例（蓝）PID: $_old_pid"
    graceful_kill "$_old_pid" "$GRACEFUL_TIMEOUT"
  fi

  # 新实例接替（更新 PID 文件）
  # 注意：新实例运行在偏移端口，蓝绿切换后需要重启到正式端口
  kill -TERM "$_new_pid" 2>/dev/null || true
  sleep 2

  log_info "切换到正式端口 $BACKEND_PORT..."
  bash "$SCRIPTS_DIR/start.sh" -e "$ENV_SHORT" -d

  if health_check "$BACKEND_PORT" "$HEALTH_TIMEOUT"; then
    log_ok "蓝绿部署完成"
  else
    log_error "蓝绿部署后健康检查失败 — 尝试回滚"
    bash "$SCRIPTS_DIR/restart.sh" -e "$ENV_SHORT" --rollback
    exit 1
  fi
}

# ---------- 主流程 ----------
_restart_precheck

if [ "$FLAG_BLUE_GREEN" = true ]; then
  if [ ! -f "$PROJECT_ROOT/api/dist/index.js" ]; then
    log_error "蓝绿部署需要构建产物，请先执行: bash scripts/build.sh -e $ENV_SHORT"
    exit 1
  fi
  _restart_blue_green
else
  _restart_rolling
fi
