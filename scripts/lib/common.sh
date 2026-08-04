#!/bin/bash
# ============================================================
#  common.sh — 环境管理公共函数库
#
#  提供所有 env-management 脚本共享的功能：
#    - 彩色输出与日志记录
#    - 配置加载
#    - 健康检查
#    - 端口检测
#    - PID 文件管理
#    - 构建报告生成
#
#  依赖：scripts/env-config.sh（配置文件，由调用方 source）
# ============================================================

# ---------- 路径常量 ----------
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
LIB_DIR="$SCRIPTS_DIR/lib"

# ---------- 颜色定义 ----------
if [ -t 1 ]; then
  C_RESET="\033[0m"
  C_RED="\033[0;31m"
  C_GREEN="\033[0;32m"
  C_YELLOW="\033[0;33m"
  C_BLUE="\033[0;34m"
  C_CYAN="\033[0;36m"
  C_GRAY="\033[0;90m"
  C_BOLD="\033[1m"
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""; C_GRAY=""; C_BOLD=""
fi

# ---------- 日志函数 ----------
# 日志文件路径（由 env-config.sh 定义 LOG_DIR / LOG_FILE）
_log_write() {
  local level="$1"; shift
  local msg="$*"
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  local line="[$ts] [$level] $msg"
  if [ -n "${LOG_FILE:-}" ] && [ -d "${LOG_DIR:-}" ]; then
    echo "$line" >> "$LOG_FILE"
  fi
}

log_info()  { _log_write "INFO"  "$*"; printf "${C_BLUE}ℹ${C_RESET}  %s\n" "$*"; }
log_ok()    { _log_write "OK"    "$*"; printf "${C_GREEN}✓${C_RESET}  %s\n" "$*"; }
log_warn()  { _log_write "WARN"  "$*"; printf "${C_YELLOW}⚠${C_RESET}  %s\n" "$*" >&2; }
log_error() { _log_write "ERROR" "$*"; printf "${C_RED}✗${C_RESET}  %s\n" "$*" >&2; }
log_step()  { _log_write "STEP"  "$*"; printf "\n${C_CYAN}${C_BOLD}▶ %s${C_RESET}\n" "$*"; }
log_dim()   { printf "${C_GRAY}%s${C_RESET}\n" "$*"; }

# ---------- 配置加载 ----------
# 加载 env-config.sh，如未指定环境则默认 dev
load_config() {
  local env_name="${1:-dev}"

  local cfg_file="$SCRIPTS_DIR/env-config.sh"
  if [ ! -f "$cfg_file" ]; then
    log_error "配置文件不存在: $cfg_file"
    exit 1
  fi

  # shellcheck source=../env-config.sh
  source "$cfg_file"

  # 根据环境名加载对应配置
  case "$env_name" in
    dev|development)
      ENV_NAME="development"
      ENV_SHORT="dev"
      ;;
    test|testing)
      ENV_NAME="testing"
      ENV_SHORT="test"
      ;;
    prod|production)
      ENV_NAME="production"
      ENV_SHORT="prod"
      ;;
    *)
      log_error "未知环境: $env_name（可选: dev / test / prod）"
      exit 1
      ;;
  esac

  # 调用 env-config.sh 中的配置函数
  config_apply "$ENV_NAME"

  # 确保日志目录存在
  mkdir -p "$LOG_DIR"
}

# ---------- 端口检测 ----------
# 检查端口是否被监听
# 返回: 0=监听中, 1=未监听
is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# 等待端口就绪
# 参数: $1=端口 $2=超时秒数(默认30)
wait_for_port() {
  local port="$1"
  local timeout="${2:-30}"
  local elapsed=0
  while [ $elapsed -lt $timeout ]; do
    if is_port_listening "$port"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ---------- 健康检查 ----------
# 调用 /api/health 端点
# 返回: 0=健康, 1=不健康
health_check() {
  local port="${1:-$BACKEND_PORT}"
  local max_retries="${2:-15}"
  local retry=0

  while [ $retry -lt $max_retries ]; do
    local resp
    resp="$(curl -sf "http://localhost:$port/api/health" 2>/dev/null)"
    if [ $? -eq 0 ] && echo "$resp" | grep -q '"ok"'; then
      return 0
    fi
    retry=$((retry + 1))
    sleep 1
  done
  return 1
}

# ---------- PID 文件管理 ----------
# PID 文件路径由 env-config.sh 定义 PID_FILE
pid_read() {
  if [ -f "${PID_FILE:-}" ]; then
    cat "$PID_FILE" 2>/dev/null
  fi
}

pid_write() {
  local pid="$1"
  mkdir -p "$(dirname "${PID_FILE:-/tmp/app.pid}")"
  echo "$pid" > "$PID_FILE"
}

pid_clear() {
  rm -f "${PID_FILE:-/tmp/app.pid}" 2>/dev/null
}

pid_is_running() {
  local pid
  pid="$(pid_read)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# ---------- 进程管理 ----------
# 优雅终止进程
# 参数: $1=PID $2=等待秒数(默认10)
graceful_kill() {
  local pid="$1"
  local wait_secs="${2:-10}"

  if [ -z "$pid" ]; then
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  # 发送 SIGTERM
  kill -TERM "$pid" 2>/dev/null || true

  local elapsed=0
  while [ $elapsed -lt $wait_secs ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  # 超时后发送 SIGKILL
  kill -KILL "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  return 0
}

# 查找占用端口的进程 PID
# 返回: stdout=PID（无匹配时为空），退出码恒为 0
# 说明："未找到"是合法结果而非错误，恒返回 0 避免在 `var=$(...)` 赋值场景下触发 set -e
find_port_pid() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true
}

# ---------- 构建报告 ----------
# 写入构建报告到 BUILD_REPORT_FILE
# 参数: $1=状态(success/failed) $2=开始时间戳 $3=附加信息
write_build_report() {
  local status="$1"
  local start_ts="$2"
  local extra="${3:-}"

  local end_ts
  end_ts="$(date +%s)"
  local duration=$((end_ts - start_ts))
  local duration_fmt
  duration_fmt="$(printf '%dm%02ds' $((duration / 60)) $((duration % 60)))"

  local report_file="${BUILD_REPORT_FILE:-$PROJECT_ROOT/data/logs/build-report.log}"
  mkdir -p "$(dirname "$report_file")"

  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  {
    echo "============================================"
    echo "  Build Report - $ts"
    echo "============================================"
    echo "  Status:    $status"
    echo "  Duration:  $duration_fmt (${duration}s)"
    echo "  Env:       ${ENV_NAME:-unknown}"
    echo "  Node:      $(node -v 2>/dev/null || echo 'N/A')"
    echo "  Git:       $(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
    if [ -n "$extra" ]; then
      echo "  Details:   $extra"
    fi
    echo ""
  } >> "$report_file"

  # 同时在终端输出摘要
  if [ "$status" = "success" ]; then
    log_ok "构建成功 | 耗时 $duration_fmt"
  else
    log_error "构建失败 | 耗时 $duration_fmt"
  fi
  log_dim "报告已写入: $report_file"
}

# ---------- 帮助信息 ----------
# 打印带颜色的帮助信息
print_help_header() {
  local script_name="$1"
  local description="$2"
  printf "${C_CYAN}${C_BOLD}%s${C_RESET}\n" "$script_name"
  printf "${C_GRAY}%s${C_RESET}\n" "$description"
  echo ""
}

print_help_option() {
  printf "  ${C_GREEN}%-20s${C_RESET} %s\n" "$1" "$2"
}
