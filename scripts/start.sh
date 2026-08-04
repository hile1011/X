#!/bin/bash
# ============================================================
#  start.sh — 环境启动命令
#
#  启动主应用程序（后端 + 前端），支持两种运行模式：
#    - 前台交互式（开发调试，默认 dev 环境）
#    - 后台守护进程（生产环境，daemon 模式）
#
#  启动顺序控制：
#    1. 确保数据/日志目录就绪
#    2. 数据库迁移自动执行
#    3. 启动后端服务
#    4. 健康检查（等待 /api/health 就绪）
#    5. （dev 模式）启动前端开发服务器
#
#  用法：
#    bash scripts/start.sh [选项]
#
#  选项：
#    -e, --env <env>      环境 (dev|test|prod)，默认 dev
#    -d, --daemon         后台守护进程模式（适用于生产）
#    -f, --frontend-only   仅启动前端（dev 模式）
#    -b, --backend-only    仅启动后端
#    -h, --help            显示帮助
# ============================================================
set -eo pipefail

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

_start_help() {
  print_help_header "start.sh — 环境启动命令" "启动主应用程序及所有相关服务，支持前台/守护进程模式"
  echo "用法: bash scripts/start.sh [选项]"
  echo ""
  echo "选项:"
  print_help_option "-e, --env <env>"        "环境: dev(默认) / test / prod"
  print_help_option "-d, --daemon"           "后台守护进程模式（适用于生产环境）"
  print_help_option "-f, --frontend-only"    "仅启动前端开发服务器（仅 dev）"
  print_help_option "-b, --backend-only"     "仅启动后端服务"
  print_help_option "-h, --help"             "显示此帮助"
  echo ""
  echo "示例:"
  echo "  bash scripts/start.sh                    # 前台启动（dev 环境）"
  echo "  bash scripts/start.sh -e prod -d         # 生产后台守护进程"
  echo "  bash scripts/start.sh -b                 # 仅启动后端"
}

BUILD_ENV="dev"
FLAG_DAEMON=false
FLAG_FRONTEND_ONLY=false
FLAG_BACKEND_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    -e|--env)          BUILD_ENV="$2"; shift 2 ;;
    -d|--daemon)       FLAG_DAEMON=true; shift ;;
    -f|--frontend-only) FLAG_FRONTEND_ONLY=true; shift ;;
    -b|--backend-only)  FLAG_BACKEND_ONLY=true; shift ;;
    -h|--help)          _start_help; exit 0 ;;
    *)                  log_error "未知选项: $1"; _start_help; exit 1 ;;
  esac
done

load_config "$BUILD_ENV"

# ---------- 预检查 ----------
_start_precheck() {
  log_step "预检查"
  _start_ok=true

  # 检查端口是否已被占用
  if is_port_listening "$BACKEND_PORT"; then
    _pid="$(find_port_pid "$BACKEND_PORT")"
    log_warn "端口 $BACKEND_PORT 已被占用 (PID: ${_pid:-未知})"
    _start_ok=false
  fi

  if [ "$ENV_NAME" = "development" ] && ! $FLAG_BACKEND_ONLY && is_port_listening "$FRONTEND_PORT"; then
    log_warn "前端端口 $FRONTEND_PORT 已被占用"
    _start_ok=false
  fi

  # 检查 PID 文件是否残留
  if pid_is_running; then
    log_warn "检测到已有运行中的服务 (PID: $(pid_read))"
    _start_ok=false
  else
    pid_clear
  fi

  # 生产模式检查构建产物
  if [ "$ENV_NAME" = "production" ] || [ "$FLAG_DAEMON" = true ]; then
    if [ ! -f "$PROJECT_ROOT/api/dist/index.js" ]; then
      log_error "构建产物不存在: api/dist/index.js"
      log_info  "请先执行: bash scripts/build.sh -e $ENV_SHORT"
      exit 1
    fi
  fi

  if [ "$_start_ok" = false ]; then
    log_error "预检查失败，请先停止现有服务: bash scripts/stop.sh -e $ENV_SHORT"
    exit 1
  fi
  log_ok "预检查通过"
}

# ---------- 启动后端 ----------
_start_backend() {
  log_step "启动后端服务 (端口: $BACKEND_PORT)"

  if [ "$FLAG_DAEMON" = true ] || [ "$ENV_NAME" = "production" ]; then
    # 守护进程模式
    log_info "模式: 后台守护进程"
    _app_log="$LOG_DIR/app-$ENV_SHORT.log"
    : > "$_app_log"

    # 通过环境变量注入端口/数据库路径，覆盖 api/.env 默认值，实现多环境隔离
    # （dotenv override 默认 false，已存在的 process.env 优先）
    PORT="$BACKEND_PORT" DB_PATH="$DB_PATH" NODE_ENV="$NODE_ENV" \
      node "$PROJECT_ROOT/api/dist/index.js" >> "$_app_log" 2>&1 &
    _pid=$!
    pid_write "$_pid"
    log_info "后端启动中 (PID: $_pid | 端口: $BACKEND_PORT | DB: $DB_PATH)"

    # 健康检查
    log_info "等待健康检查（超时: ${HEALTH_TIMEOUT}s）..."
    if health_check "$BACKEND_PORT" "$HEALTH_TIMEOUT"; then
      log_ok "后端健康检查通过"
    else
      log_error "后端启动失败 — 健康检查超时"
      log_info  "查看日志: cat $_app_log"
      _tail="$(tail -15 "$_app_log" 2>/dev/null)"
      [ -n "$_tail" ] && log_dim "$_tail"
      exit 1
    fi

    # 端口确认
    if is_port_listening "$BACKEND_PORT"; then
      log_ok "后端端口 $BACKEND_PORT 监听中"
    else
      log_error "后端端口 $BACKEND_PORT 未监听"
      exit 1
    fi
  else
    # 开发模式：使用 tsx watch
    log_info "模式: 前台开发模式 (tsx watch)"
    PORT="$BACKEND_PORT" DB_PATH="$DB_PATH" NODE_ENV="$NODE_ENV" \
      npx tsx watch api/index.ts &
    _pid=$!
    pid_write "$_pid"
    log_info "后端启动中 (PID: $_pid | 端口: $BACKEND_PORT | DB: $DB_PATH)"

    # 等待端口就绪
    log_info "等待端口就绪..."
    if wait_for_port "$BACKEND_PORT" "$HEALTH_TIMEOUT"; then
      log_ok "后端端口 $BACKEND_PORT 监听中"
    else
      log_error "后端启动超时 — 端口 $BACKEND_PORT 未就绪"
      exit 1
    fi

    # 健康检查
    if health_check "$BACKEND_PORT" 10; then
      log_ok "后端健康检查通过"
    else
      log_warn "健康检查未通过（开发模式可能正在编译，稍后重试）"
    fi
  fi
}

# ---------- 启动前端 ----------
_start_frontend() {
  if [ "$ENV_NAME" != "development" ]; then
    return 0
  fi
  if [ "$FLAG_BACKEND_ONLY" = true ]; then
    return 0
  fi

  log_step "启动前端开发服务器 (端口: $FRONTEND_PORT)"

  npx vite --port "$FRONTEND_PORT" --host &
  _frontend_pid=$!
  log_info "前端启动中 (PID: $_frontend_pid)"

  if wait_for_port "$FRONTEND_PORT" 15; then
    log_ok "前端端口 $FRONTEND_PORT 监听中"
  else
    log_warn "前端端口 $FRONTEND_PORT 未就绪（可能仍在编译）"
  fi
}

# ---------- 启动总结 ----------
_start_summary() {
  log_step "启动总结"
  log_ok "环境: $ENV_NAME"
  log_ok "后端: http://localhost:$BACKEND_PORT"
  if [ "$ENV_NAME" = "development" ] && [ "$FLAG_BACKEND_ONLY" = false ]; then
    log_ok "前端: http://localhost:$FRONTEND_PORT"
  fi
  if [ "$FLAG_DAEMON" = true ] || [ "$ENV_NAME" = "production" ]; then
    log_dim "PID: $(pid_read) | 日志: $LOG_DIR/app-$ENV_SHORT.log"
  fi
  log_dim "操作日志: $LOG_FILE"
}

# ---------- 主流程 ----------
if [ "$FLAG_FRONTEND_ONLY" = true ]; then
  load_config "$BUILD_ENV"
  _start_frontend
  log_ok "前端已启动: http://localhost:$FRONTEND_PORT"
  exit 0
fi

_start_precheck
_start_backend
_start_frontend
_start_summary
