#!/bin/bash
# ============================================================
#  stop.sh — 环境停止命令
#
#  安全终止应用程序及所有相关服务进程。
#
#  优雅关闭机制：
#    1. 发送 SIGTERM 信号
#    2. 等待进程完成当前任务、数据持久化及资源释放
#    3. 超时后发送 SIGKILL 强制终止
#
#  用法：
#    bash scripts/stop.sh [选项]
#
#  选项：
#    -e, --env <env>    环境 (dev|test|prod)，默认 dev
#    -f, --force        强制终止（SIGKILL，跳过优雅关闭）
#    -a, --all          停止所有环境的所有服务
#    -h, --help         显示帮助
# ============================================================
set -eo pipefail

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

_stop_help() {
  print_help_header "stop.sh — 环境停止命令" "安全终止应用程序及所有相关服务进程"
  echo "用法: bash scripts/stop.sh [选项]"
  echo ""
  echo "选项:"
  print_help_option "-e, --env <env>"  "环境: dev(默认) / test / prod"
  print_help_option "-f, --force"       "强制终止（SIGKILL，跳过优雅关闭，有数据丢失风险）"
  print_help_option "-a, --all"          "停止所有环境的所有服务"
  print_help_option "-h, --help"         "显示此帮助"
  echo ""
  echo "示例:"
  echo "  bash scripts/stop.sh                # 优雅停止 dev 环境"
  echo "  bash scripts/stop.sh -e prod       # 停止生产环境"
  echo "  bash scripts/stop.sh -f             # 强制停止"
  echo "  bash scripts/stop.sh -a             # 停止所有"
}

BUILD_ENV="dev"
FLAG_FORCE=false
FLAG_ALL=false

while [ $# -gt 0 ]; do
  case "$1" in
    -e|--env)   BUILD_ENV="$2"; shift 2 ;;
    -f|--force) FLAG_FORCE=true; shift ;;
    -a|--all)    FLAG_ALL=true; shift ;;
    -h|--help)   _stop_help; exit 0 ;;
    *)           log_error "未知选项: $1"; _stop_help; exit 1 ;;
  esac
done

# ---------- 停止单个环境的后端进程 ----------
_stop_backend() {
  local env_name="$1"
  local stopped_pids=()
  local failed_pids=()

  load_config "$env_name"

  log_step "停止 $ENV_NAME 环境后端 (端口: $BACKEND_PORT)"

  # 查找 PID
  _pid="$(pid_read)"
  if [ -z "$_pid" ] || ! kill -0 "$_pid" 2>/dev/null; then
    # PID 文件无有效 PID，尝试通过端口查找
    _pid="$(find_port_pid "$BACKEND_PORT")"
  fi

  if [ -z "$_pid" ]; then
    log_info "未发现运行中的后端进程"
    pid_clear
    return 0
  fi

  if ! kill -0 "$_pid" 2>/dev/null; then
    log_info "进程 $_pid 已不存在，清理 PID 文件"
    pid_clear
    return 0
  fi

  log_info "目标进程 PID: $_pid"

  if [ "$FLAG_FORCE" = true ]; then
    log_warn "强制终止模式（SIGKILL）— 可能导致数据丢失"
    kill -KILL "$_pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$_pid" 2>/dev/null; then
      log_error "进程 $_pid 无法终止"
      failed_pids+=("$_pid")
    else
      log_ok "进程 $_pid 已强制终止"
      stopped_pids+=("$_pid")
    fi
  else
    log_info "优雅终止模式（SIGTERM → 等待 ${GRACEFUL_TIMEOUT}s）"
    if graceful_kill "$_pid" "$GRACEFUL_TIMEOUT"; then
      log_ok "进程 $_pid 已优雅终止"
      stopped_pids+=("$_pid")
    else
      log_error "进程 $_pid 优雅终止失败"
      failed_pids+=("$_pid")
    fi
  fi

  pid_clear

  # 确认端口已释放
  sleep 1
  if is_port_listening "$BACKEND_PORT"; then
    _port_pid="$(find_port_pid "$BACKEND_PORT")"
    log_warn "端口 $BACKEND_PORT 仍被占用 (PID: ${_port_pid:-未知})"
    if [ "$FLAG_FORCE" = true ] && [ -n "$_port_pid" ]; then
      log_warn "强制终止占用端口的进程: $_port_pid"
      kill -KILL "$_port_pid" 2>/dev/null || true
      sleep 1
    fi
  else
    log_ok "端口 $BACKEND_PORT 已释放"
  fi
}

# ---------- 停止前端进程 ----------
_stop_frontend() {
  if [ "$ENV_NAME" != "development" ]; then
    return 0
  fi

  _frontend_pid="$(find_port_pid "$FRONTEND_PORT")"
  if [ -n "$_frontend_pid" ]; then
    log_info "停止前端进程 (PID: $_frontend_pid, 端口: $FRONTEND_PORT)"
    if [ "$FLAG_FORCE" = true ]; then
      kill -KILL "$_frontend_pid" 2>/dev/null || true
    else
      graceful_kill "$_frontend_pid" 5
    fi
    sleep 1
    if is_port_listening "$FRONTEND_PORT"; then
      log_warn "前端端口 $FRONTEND_PORT 仍被占用"
    else
      log_ok "前端端口 $FRONTEND_PORT 已释放"
    fi
  else
    log_info "未发现运行中的前端进程"
  fi
}

# ---------- 停止报告 ----------
_stop_report() {
  log_step "停止操作报告"
  if [ ${#stopped_pids[@]} -gt 0 ]; then
    log_ok "成功终止的进程: ${stopped_pids[*]}"
  fi
  if [ ${#failed_pids[@]} -gt 0 ]; then
    log_error "异常终止的进程: ${failed_pids[*]}"
  fi

  # 检查端口释放状态
  if is_port_listening "$BACKEND_PORT"; then
    log_warn "后端端口 $BACKEND_PORT 仍被占用"
  else
    log_ok "后端端口 $BACKEND_PORT 已释放"
  fi
  log_dim "操作日志: $LOG_FILE"
}

# ---------- 主流程 ----------
declare -a stopped_pids=()
declare -a failed_pids=()

if [ "$FLAG_ALL" = true ]; then
  log_step "停止所有环境服务"
  for env in dev test prod; do
    _stop_backend "$env"
  done
else
  _stop_backend "$BUILD_ENV"
  load_config "$BUILD_ENV"
  _stop_frontend
fi

_stop_report
