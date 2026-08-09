#!/bin/bash
# ============================================================
#  env-config.sh — 集中化环境配置
#
#  所有端口、路径、服务地址等配置信息集中管理于此文件，
#  支持按环境（开发/测试/生产）区分配置，便于统一修改和版本控制。
#
#  使用方式：
#    source scripts/env-config.sh
#    config_apply development   # 或 testing / production
#
#  配置项加载后，以下变量可用：
#    ENV_NAME          环境名称
#    BACKEND_PORT      后端端口
#    FRONTEND_PORT     前端端口（dev 模式）
#    NODE_ENV           NODE_ENV 值
#    MYSQL_HOST         MySQL 主机地址
#    MYSQL_PORT         MySQL 端口
#    MYSQL_USER         MySQL 用户名
#    MYSQL_PASSWORD     MySQL 密码
#    MYSQL_DATABASE     MySQL 数据库名称
#    DATA_DIR           数据目录
#    LOG_DIR            日志目录
#    LOG_FILE           操作日志文件
#    PID_FILE           PID 文件
#    BUILD_REPORT_FILE  构建报告文件
#    EXPORT_DIR         导出目录
#    HEALTH_TIMEOUT     健康检查超时秒数
#    GRACEFUL_TIMEOUT   优雅关闭等待秒数
# ============================================================

# 默认项目根目录（可被外部覆盖）
_PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# ============================================================
# 环境配置定义
# ============================================================

# 开发环境
_config_dev() {
  ENV_NAME="development"
  NODE_ENV="development"
  BACKEND_PORT=3001
  FRONTEND_PORT=5173
  MYSQL_HOST="127.0.0.1"
  MYSQL_PORT="3306"
  MYSQL_USER="root"
  MYSQL_PASSWORD=""
  MYSQL_DATABASE="quote_system"
  DATA_DIR="$_PROJECT_ROOT/data"
  LOG_DIR="$_PROJECT_ROOT/data/logs"
  PID_FILE="$_PROJECT_ROOT/data/app-dev.pid"
  BUILD_REPORT_FILE="$_PROJECT_ROOT/data/logs/build-report-dev.log"
  EXPORT_DIR="$_PROJECT_ROOT/exports"
  HEALTH_TIMEOUT=15
  GRACEFUL_TIMEOUT=10
  # 开发环境不需要构建产物
  BUILD_OUTPUT_DIR=""
  START_MODE="foreground"
}

# 测试环境
_config_test() {
  ENV_NAME="testing"
  NODE_ENV="test"
  BACKEND_PORT=3002
  FRONTEND_PORT=5174
  MYSQL_HOST="127.0.0.1"
  MYSQL_PORT="3306"
  MYSQL_USER="root"
  MYSQL_PASSWORD=""
  MYSQL_DATABASE="quote_system_test"
  DATA_DIR="$_PROJECT_ROOT/data"
  LOG_DIR="$_PROJECT_ROOT/data/logs"
  PID_FILE="$_PROJECT_ROOT/data/app-test.pid"
  BUILD_REPORT_FILE="$_PROJECT_ROOT/data/logs/build-report-test.log"
  EXPORT_DIR="$_PROJECT_ROOT/exports"
  HEALTH_TIMEOUT=15
  GRACEFUL_TIMEOUT=10
  BUILD_OUTPUT_DIR="$_PROJECT_ROOT/dist"
  START_MODE="daemon"
}

# 生产环境（本机生产模式构建的本地冒烟测试）
# 注意：真正的生产部署位于独立目录 X-PR（端口 3002），由 scripts/deploy.js 管理。
# 此处的 prod 配置用于在本项目目录内运行编译后的构建产物进行冒烟验证，
# 因此使用与 dev(3001)/test(3002) 不冲突的端口 3003，避免与 dev 服务争用端口。
_config_prod() {
  ENV_NAME="production"
  NODE_ENV="production"
  BACKEND_PORT=3003
  FRONTEND_PORT=80
  MYSQL_HOST="127.0.0.1"
  MYSQL_PORT="3306"
  MYSQL_USER="root"
  MYSQL_PASSWORD="MyNewPass123!"
  MYSQL_DATABASE="quote_system_prod"
  DATA_DIR="$_PROJECT_ROOT/data"
  LOG_DIR="$_PROJECT_ROOT/data/logs"
  PID_FILE="$_PROJECT_ROOT/data/app-prod.pid"
  BUILD_REPORT_FILE="$_PROJECT_ROOT/data/logs/build-report-prod.log"
  EXPORT_DIR="$_PROJECT_ROOT/exports"
  HEALTH_TIMEOUT=30
  GRACEFUL_TIMEOUT=30
  BUILD_OUTPUT_DIR="$_PROJECT_ROOT/dist"
  START_MODE="daemon"
}

# 配置应用入口函数
# 参数: $1=环境名称 (development / testing / production)
config_apply() {
  local env_name="$1"
  case "$env_name" in
    development) _config_dev ;;
    testing)     _config_test ;;
    production)  _config_prod ;;
    *)
      echo "[env-config] 未知环境: $env_name" >&2
      return 1
      ;;
  esac

  # 确保 LOG_FILE 变量存在（common.sh 的日志函数依赖它）
  LOG_FILE="$LOG_DIR/env-operations.log"

  # 确保必需目录存在
  mkdir -p "$DATA_DIR" "$LOG_DIR" "$EXPORT_DIR"
}

# 打印当前配置
config_print() {
  echo "============================================"
  echo "  当前环境配置"
  echo "============================================"
  echo "  ENV_NAME:          $ENV_NAME"
  echo "  NODE_ENV:          $NODE_ENV"
  echo "  BACKEND_PORT:      $BACKEND_PORT"
  echo "  FRONTEND_PORT:     $FRONTEND_PORT"
  echo "  MYSQL_HOST:        $MYSQL_HOST"
  echo "  MYSQL_PORT:        $MYSQL_PORT"
  echo "  MYSQL_DATABASE:    $MYSQL_DATABASE"
  echo "  DATA_DIR:          $DATA_DIR"
  echo "  LOG_DIR:           $LOG_DIR"
  echo "  LOG_FILE:          $LOG_FILE"
  echo "  PID_FILE:          $PID_FILE"
  echo "  EXPORT_DIR:        $EXPORT_DIR"
  echo "  HEALTH_TIMEOUT:    ${HEALTH_TIMEOUT}s"
  echo "  GRACEFUL_TIMEOUT:  ${GRACEFUL_TIMEOUT}s"
  echo "============================================"
}
