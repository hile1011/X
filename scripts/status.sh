#!/bin/bash
# ============================================================
#  status.sh — 服务状态查询命令
#
#  查询所有环境的服务运行状态、端口监听情况、健康检查结果。
#
#  用法：
#    bash scripts/status.sh [选项]
#
#  选项：
#    -e, --env <env>    环境 (dev|test|prod)，默认 dev
#    -a, --all           查询所有环境
#    -h, --help          显示帮助
# ============================================================
set -eo pipefail

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

_status_help() {
  print_help_header "status.sh — 服务状态查询" "查询服务运行状态、端口监听和健康检查"
  echo "用法: bash scripts/status.sh [选项]"
  echo ""
  echo "选项:"
  print_help_option "-e, --env <env>"  "环境: dev(默认) / test / prod"
  print_help_option "-a, --all"          "查询所有环境"
  print_help_option "-h, --help"         "显示此帮助"
}

BUILD_ENV="dev"
FLAG_ALL=false

while [ $# -gt 0 ]; do
  case "$1" in
    -e|--env)  BUILD_ENV="$2"; shift 2 ;;
    -a|--all)   FLAG_ALL=true; shift ;;
    -h|--help)  _status_help; exit 0 ;;
    *)          log_error "未知选项: $1"; _status_help; exit 1 ;;
  esac
done

# ---------- 查询单个环境状态 ----------
_check_env_status() {
  local env_name="$1"
  load_config "$env_name"

  local status="未运行"
  local pid=""
  local health="N/A"

  _pid_file_pid="$(pid_read)"
  _port_pid="$(find_port_pid "$BACKEND_PORT")"

  if [ -n "$_pid_file_pid" ] && kill -0 "$_pid_file_pid" 2>/dev/null; then
    pid="$_pid_file_pid"
    status="运行中"
  elif [ -n "$_port_pid" ]; then
    pid="$_port_pid"
    status="运行中(端口)"
  fi

  if [ "$status" = "运行中" ] || [ "$status" = "运行中(端口)" ]; then
    if curl -sf "http://localhost:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
      health="✓ 健康"
    else
      health="✗ 不健康"
    fi
  fi

  # 数据库状态
  local db_status="不存在"
  if [ -f "$DB_PATH" ]; then
    local db_size
    db_size="$(du -h "$DB_PATH" 2>/dev/null | cut -f1)"
    db_status="$db_size"
  fi

  # 输出
  printf "${C_BOLD}%-12s${C_RESET} " "$ENV_NAME"
  if [ "$status" = "运行中" ] || [ "$status" = "运行中(端口)" ]; then
    printf "${C_GREEN}%-8s${C_RESET} " "● 运行"
  else
    printf "${C_GRAY}%-8s${C_RESET} " "○ 停止"
  fi
  printf "PID:%-8s 端口:%-6s 健康:%-12s DB:%s\n" \
    "${pid:-N/A}" "$BACKEND_PORT" "$health" "$db_status"
}

# ---------- 主流程 ----------
if [ "$FLAG_ALL" = true ]; then
  printf "\n${C_BOLD}所有环境服务状态${C_RESET}\n"
  echo "──────────────────────────────────────────────────────────────────────"
  printf "%-12s %-8s %-18s %-10s %-14s\n" "环境" "状态" "PID" "端口" "健康"
  echo "──────────────────────────────────────────────────────────────────────"
  for env in dev test prod; do
    _check_env_status "$env"
  done
else
  printf "\n${C_BOLD}服务状态${C_RESET}\n"
  echo "──────────────────────────────────────────────"
  _check_env_status "$BUILD_ENV"
fi
echo "──────────────────────────────────────────────"
