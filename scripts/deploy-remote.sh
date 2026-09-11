#!/usr/bin/env bash
# ============================================================================
# 报价跟单系统 - 远程部署自动化脚本
# 版本: 2.0.0（本地构建模式）
# 用法: bash scripts/deploy-remote.sh [选项]
#
# 功能:
#   1. 本地构建前端（Vite）+ 后端（TypeScript）
#   2. 打包源码和构建产物并上传到远程服务器
#   3. 远程安装生产依赖、重启 PM2 服务
#   4. 完整健康检查与 API 性能验证
#   5. 失败时自动回滚到上一版本
#
# 选项:
#   --skip-build      跳过本地构建（使用已有 dist/ 和 api/dist/）
#   --skip-push       跳过 git commit & push
#   --skip-tag        跳过版本号递增与打标签（版本/tag 已手动完成时使用）
#   --rollback        回滚到上一版本
#   --version <ver>   指定版本号（如 v1.1.2）
#   --dry-run         仅打印命令，不实际执行
#   --help            显示帮助
#
# 说明:
#   - 本地构建模式：在本地 macOS 构建前后端产物，直接上传到服务器
#   - 好处：避免远程服务器 GLIBC 版本不兼容问题
#   - 构建产物：dist/（前端）+ api/dist/（后端）
# ============================================================================

set -euo pipefail

# ==================== 配置 ====================

# 服务器连接信息
REMOTE_HOST="8.136.117.41"
REMOTE_USER="root"
REMOTE_PASS="Huashao123"
REMOTE_DIR="/usr/X-prod"
SSH_PORT="22"

# 本地项目路径
LOCAL_DIR="/Users/hile/Documents/work/projects/X"

# 服务配置
APP_NAME="X-api"
APP_PORT="3003"
HEALTH_ENDPOINT="/api/health"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 日志文件
LOG_DIR="${LOCAL_DIR}/data/logs"
LOG_FILE="${LOG_DIR}/deploy-$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$LOG_DIR"

# ==================== 工具函数 ====================

log() {
    local level=$1
    shift
    local msg="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local color

    case "$level" in
        INFO)  color="$GREEN" ;;
        WARN)  color="$YELLOW" ;;
        ERROR) color="$RED" ;;
        STEP)  color="$CYAN" ;;
        *)     color="$NC" ;;
    esac

    echo -e "${color}[${level}]${NC} ${msg}"
    echo "[${timestamp}] [${level}] ${msg}" >> "$LOG_FILE"
}

log_step() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

remote_exec() {
    local cmd="$1"
    local desc="${2:-执行远程命令}"

    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log INFO "[DRY-RUN] $desc: $cmd"
        return 0
    fi

    log INFO "$desc"
    sshpass -p "$REMOTE_PASS" ssh -F /dev/null \
        -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null \
        -o ConnectTimeout=10 \
        "${REMOTE_USER}@${REMOTE_HOST}" "$cmd" 2>&1 | tee -a "$LOG_FILE"
    return ${PIPESTATUS[0]}
}

local_exec() {
    local cmd="$1"
    local desc="${2:-执行本地命令}"

    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        log INFO "[DRY-RUN] $desc: $cmd"
        return 0
    fi

    log INFO "$desc"
    eval "$cmd" 2>&1 | tee -a "$LOG_FILE"
    return ${PIPESTATUS[0]}
}

check_error() {
    local exit_code=$1
    local error_msg="${2:-操作失败}"
    local rollback="${3:-true}"

    if [[ $exit_code -ne 0 ]]; then
        log ERROR "$error_msg (退出码: $exit_code)"
        if [[ "$rollback" == "true" ]]; then
            log WARN "正在执行回滚..."
            do_rollback
        fi
        log ERROR "部署失败！详细日志: $LOG_FILE"
        exit 1
    fi
}

# ==================== 核心部署步骤 ====================

step_git_commit() {
    log_step "步骤 1/7: Git 提交与推送"

    cd "$LOCAL_DIR"

    # 检查是否有未提交的更改
    if [[ -z "$(git status --porcelain)" ]]; then
        log INFO "没有未提交的更改，跳过 git commit"
        return 0
    fi

    local commit_msg="${COMMIT_MSG:-chore(deploy): 自动部署 $(date '+%Y-%m-%d %H:%M')}"

    local_exec "git add ." "暂存所有更改"
    check_error $? "git add 失败" "false"

    local_exec "git commit -m \"${commit_msg}\"" "提交代码"
    check_error $? "git commit 失败" "false"

    local_exec "git push origin main" "推送到 GitHub"
    check_error $? "git push 失败" "false"

    log INFO "Git 提交与推送完成"
}

step_version_tag() {
    log_step "步骤 2/7: 版本标签管理"

    cd "$LOCAL_DIR"

    local current_version
    current_version=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"//;s/".*//')
    log INFO "当前版本: v${current_version}"

    if [[ -n "${TARGET_VERSION:-}" ]]; then
        # 使用指定版本
        local tag_name="v${TARGET_VERSION}"
    else
        # 自动递增 patch 版本
        local major minor patch
        IFS='.' read -r major minor patch <<< "$current_version"
        patch=$((patch + 1))
        local new_version="${major}.${minor}.${patch}"
        local tag_name="v${new_version}"

        # 更新 package.json
        sed -i.bak "s/\"version\": \"${current_version}\"/\"version\": \"${new_version}\"/" package.json
        rm -f package.json.bak
        local_exec "git add package.json && git commit -m 'chore(release): ${tag_name}'" "更新版本号"
        local_exec "git push origin main" "推送版本更新"
    fi

    log INFO "创建标签: $tag_name"
    local_exec "git tag -a ${tag_name} -m 'Release ${tag_name}'" "创建 Git 标签"
    local_exec "git push origin ${tag_name}" "推送标签到 GitHub"
    check_error $? "Git 标签推送失败" "false"

    log INFO "版本标签管理完成: $tag_name"
}

step_local_build() {
    log_step "步骤 3/7: 本地构建（前端+后端）"

    if [[ "${SKIP_BUILD:-false}" == "true" ]]; then
        log WARN "跳过构建（--skip-build）"
        return 0
    fi

    cd "$LOCAL_DIR"

    # 清理旧的构建产物
    log INFO "清理旧的构建产物..."
    rm -rf dist/ api/dist/ 2>/dev/null || true

    # 安装依赖（确保依赖完整）
    if [[ ! -d "node_modules" ]]; then
        log INFO "安装项目依赖..."
        local_exec "npm install" "安装依赖"
        check_error $? "依赖安装失败" "false"
    fi

    # 构建前端
    log INFO "构建前端..."
    local_exec "npm run build:frontend" "构建前端 (Vite)"
    check_error $? "前端构建失败" "false"

    # 验证前端构建产物
    if [[ ! -f "dist/index.html" ]]; then
        log ERROR "前端构建产物缺失: dist/index.html"
        exit 1
    fi
    local FE_SIZE=$(du -sh dist/ 2>/dev/null | cut -f1)
    log INFO "前端构建产物验证通过 ($FE_SIZE)"

    # 构建后端
    log INFO "构建后端..."
    local_exec "npm run build:backend" "构建后端 (TypeScript)"
    check_error $? "后端构建失败" "false"

    # 验证后端构建产物
    if [[ ! -f "api/dist/index.js" ]]; then
        log ERROR "后端构建产物缺失: api/dist/index.js"
        exit 1
    fi
    local BE_SIZE=$(du -sh api/dist/ 2>/dev/null | cut -f1)
    log INFO "后端构建产物验证通过 ($BE_SIZE)"

    log INFO "本地构建完成 ✅"
}

step_package_upload() {
    log_step "步骤 4/7: 打包与上传"

    cd "$LOCAL_DIR"

    # 检查构建产物是否存在
    if [[ ! -d "dist" || ! -d "api/dist" ]]; then
        log ERROR "构建产物不存在，请先执行构建步骤"
        exit 1
    fi

    # 打包项目源码（排除构建产物和不需要的文件）
    log INFO "打包项目源码..."
    local src_tarball="/tmp/X-src-$(date +%Y%m%d_%H%M%S).tar.gz"
    tar czf "$src_tarball" \
        --exclude='node_modules' \
        --exclude='.env' \
        --exclude='.env.local' \
        --exclude='.DS_Store' \
        --exclude='.trae' \
        --exclude='*.log' \
        --exclude='*.xlsx' \
        --exclude='data' \
        --exclude='*.db' \
        --exclude='.git' \
        --exclude='coverage' \
        --exclude='tests' \
        --exclude='docs' \
        --exclude='dist' \
        --exclude='api/dist' \
        --exclude='api/uploads' \
        . 2>/dev/null

    local src_size=$(du -h "$src_tarball" | cut -f1)
    log INFO "源码打包完成: $src_tarball ($src_size)"

    # 打包构建产物（前端 dist + 后端 api/dist）
    log INFO "打包构建产物..."
    local dist_tarball="/tmp/X-dist-$(date +%Y%m%d_%H%M%S).tar.gz"
    tar czf "$dist_tarball" dist/ api/dist/
    local dist_size=$(du -h "$dist_tarball" | cut -f1)
    log INFO "构建产物打包完成: $dist_tarball ($dist_size)"

    # 备份远程当前版本
    log INFO "备份远程当前版本..."
    remote_exec "cd ${REMOTE_DIR} && tar czf /tmp/X-backup-\$(date +%Y%m%d_%H%M%S).tar.gz --exclude=node_modules --exclude=.env --exclude=dist_backup_* . 2>/dev/null || true" "备份远程代码"

    # 获取远程文件名（不含路径）
    local src_filename=$(basename "$src_tarball")
    local dist_filename=$(basename "$dist_tarball")

    # 上传源码
    log INFO "上传源码到服务器..."
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        sshpass -p "$REMOTE_PASS" scp -F /dev/null \
            -o StrictHostKeyChecking=no \
            -o UserKnownHostsFile=/dev/null \
            "$src_tarball" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/${src_filename}" 2>&1 | tee -a "$LOG_FILE"
        check_error $? "上传源码失败" "false"
    fi
    remote_exec "cd ${REMOTE_DIR} && tar xzf /tmp/${src_filename} 2>&1 | grep -v 'LIBARCHIVE' || true" "解压源码"

    # 上传构建产物
    log INFO "上传构建产物到服务器..."
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        sshpass -p "$REMOTE_PASS" scp -F /dev/null \
            -o StrictHostKeyChecking=no \
            -o UserKnownHostsFile=/dev/null \
            "$dist_tarball" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/${dist_filename}" 2>&1 | tee -a "$LOG_FILE"
        check_error $? "上传构建产物失败" "false"
    fi
    remote_exec "cd ${REMOTE_DIR} && rm -rf dist dist_backup_* api/dist 2>/dev/null; tar xzf /tmp/${dist_filename} 2>&1 | grep -v 'LIBARCHIVE' || true" "解压构建产物"

    log INFO "打包与上传完成 ✅"
}

step_install_deps() {
    log_step "步骤 5/7: 安装依赖（仅生产环境）"

    remote_exec "cd ${REMOTE_DIR} && npm config set registry https://registry.npmmirror.com && npm install --omit=dev 2>&1 | tail -5" "安装生产依赖"
    check_error $? "依赖安装失败" "false"

    log INFO "依赖安装完成 ✅"
}

step_restart_service() {
    log_step "步骤 6/7: 重启服务"

    # 确保 .env 存在
    remote_exec "test -f ${REMOTE_DIR}/.env && echo '.env exists' || echo '.env missing'" "检查 .env 配置"

    # 重启 PM2（确保读取最新的 .env 配置）
    remote_exec "cd ${REMOTE_DIR} && pm2 restart ${APP_NAME} --update-env 2>&1 || pm2 start api/dist/index.js --name '${APP_NAME}' 2>&1" "重启 PM2 服务"
    check_error $? "PM2 重启失败" "false"

    remote_exec "pm2 save 2>&1" "保存 PM2 进程列表"

    log INFO "服务重启完成"
}

step_health_check() {
    log_step "步骤 7/7: 健康检查与验证"

    local max_retries=5
    local retry=0
    local health_ok=false

    while [[ $retry -lt $max_retries ]]; do
        retry=$((retry + 1))
        log INFO "健康检查尝试 $retry/$max_retries..."

        local response
        response=$(remote_exec "curl -s --connect-timeout 5 http://localhost:${APP_PORT}${HEALTH_ENDPOINT}" "健康检查")
        echo "$response" | tee -a "$LOG_FILE"

        if echo "$response" | grep -q '"status":"ok"'; then
            health_ok=true
            log INFO "健康检查通过 ✅"
            break
        fi

        sleep 3
    done

    if [[ "$health_ok" != "true" ]]; then
        log ERROR "健康检查失败！服务未正常启动"
        log WARN "正在执行回滚..."
        do_rollback
        exit 1
    fi

    # 验证前端页面
    log INFO "验证前端页面..."
    remote_exec "curl -s http://localhost:${APP_PORT}/ | grep -o '<title>[^<]*</title>' | head -1" "前端标题检查"

    # 验证 API 列表查询性能
    log INFO "验证 API 列表查询..."
    local quotes_perf
    quotes_perf=$(remote_exec "curl -s -H 'Accept-Encoding: gzip' http://localhost:${APP_PORT}/api/quotes -o /dev/null -w 'HTTP %{http_code} 大小: %{size_download} bytes 耗时: %{time_total}s'" "列表查询性能")
    log INFO "列表查询: $quotes_perf"

    # 验证图片标识 API
    log INFO "验证图片标识 API..."
    remote_exec "curl -s http://localhost:${APP_PORT}/api/quotes/image-flags | python3 -c 'import json,sys; d=json.load(sys.stdin); print(f\"订单数: {len(d)}, 有图片: {sum(1 for v in d.values() if v)}\")'" "图片标识检查"

    # 验证缩略图 API
    log INFO "验证缩略图 API..."
    local first_id
    first_id=$(remote_exec "curl -s http://localhost:${APP_PORT}/api/quotes | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0][\"id\"])' 2>/dev/null" "获取订单ID" | tail -1)
    if [[ -n "$first_id" ]]; then
        local thumb_perf
        thumb_perf=$(remote_exec "curl -s http://localhost:${APP_PORT}/api/quotes/${first_id}/thumbnail -o /dev/null -w 'HTTP %{http_code} 大小: %{size_download} bytes 耗时: %{time_total}s'" "缩略图检查")
        log INFO "缩略图 ($first_id): $thumb_perf"
    fi

    # 检查 PM2 状态
    log INFO "检查 PM2 状态..."
    remote_exec "pm2 list" "PM2 进程状态"

    log INFO "健康检查与验证完成 ✅"
}

# ==================== 回滚 ====================

do_rollback() {
    log_step "执行回滚"

    log WARN "正在回滚到上一版本..."

    # 查找最近的备份
    local backup_file
    backup_file=$(remote_exec "ls -t /tmp/X-backup-*.tar.gz 2>/dev/null | head -1" "查找备份文件" | tail -1)

    if [[ -z "$backup_file" ]]; then
        log ERROR "未找到备份文件，无法回滚"
        return 1
    fi

    log INFO "使用备份: $backup_file"

    # 停止服务
    remote_exec "pm2 stop ${APP_NAME} 2>/dev/null || true" "停止服务"

    # 恢复代码
    remote_exec "cd ${REMOTE_DIR} && tar xzf ${backup_file} 2>&1 | grep -v 'LIBARCHIVE' || true" "恢复代码"

    # 重启服务
    remote_exec "cd ${REMOTE_DIR} && pm2 restart ${APP_NAME} --update-env 2>&1 || pm2 start api/dist/index.js --name '${APP_NAME}' 2>&1" "重启服务"

    # 验证
    sleep 5
    local response
    response=$(remote_exec "curl -s http://localhost:${APP_PORT}${HEALTH_ENDPOINT}" "回滚后健康检查")
    if echo "$response" | grep -q '"status":"ok"'; then
        log INFO "回滚成功 ✅"
    else
        log ERROR "回滚后健康检查失败！请手动检查服务状态"
        log ERROR "SSH 登录: ssh ${REMOTE_USER}@${REMOTE_HOST}"
        log ERROR "查看日志: pm2 logs ${APP_NAME}"
    fi
}

# ==================== 主流程 ====================

show_help() {
    cat << 'HELP'
报价跟单系统 - 远程部署自动化脚本 v2.0（本地构建模式）

用法:
  bash scripts/deploy-remote.sh [选项]

选项:
  --skip-build       跳过本地构建（使用已有 dist/ 和 api/dist/）
  --skip-push        跳过 git commit & push
  --skip-tag         跳过版本号递增与打标签（版本/tag 已手动完成时使用）
  --version <ver>    指定版本号（如 1.1.2）
  --rollback         回滚到上一版本
  --dry-run          仅打印命令，不实际执行
  --help             显示此帮助

部署流程:
  1. Git 提交与推送（--skip-push 跳过）
  2. 版本标签管理（自动递增版本号；--skip-tag 跳过）
  3. 本地构建（前端 Vite + 后端 TypeScript）
  4. 打包与上传（源码 + 构建产物分开打包）
  5. 安装依赖（仅生产环境）
  6. 重启 PM2 服务
  7. 健康检查与 API 验证

示例:
  # 完整部署（推荐）
  bash scripts/deploy-remote.sh

  # 仅部署（不重新构建）
  bash scripts/deploy-remote.sh --skip-build

  # 指定版本号
  bash scripts/deploy-remote.sh --version 1.2.0

  # 回滚到上一版本
  bash scripts/deploy-remote.sh --rollback

  # 预演（不实际执行）
  bash scripts/deploy-remote.sh --dry-run
HELP
}

main() {
    # 解析参数
    SKIP_BUILD=false
    SKIP_PUSH=false
    SKIP_TAG=false
    DO_ROLLBACK=false
    DRY_RUN=false
    TARGET_VERSION=""
    COMMIT_MSG=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-build)   SKIP_BUILD=true; shift ;;
            --skip-push)    SKIP_PUSH=true; shift ;;
            --skip-tag)     SKIP_TAG=true; shift ;;
            --rollback)     DO_ROLLBACK=true; shift ;;
            --dry-run)      DRY_RUN=true; shift ;;
            --version)      TARGET_VERSION="$2"; shift 2 ;;
            --commit-msg)   COMMIT_MSG="$2"; shift 2 ;;
            --help)         show_help; exit 0 ;;
            *)              log ERROR "未知选项: $1"; show_help; exit 1 ;;
        esac
    done

    # 回滚模式
    if [[ "$DO_ROLLBACK" == "true" ]]; then
        do_rollback
        exit $?
    fi

    # 打印部署信息
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║     报价跟单系统 - 远程部署自动化脚本 v1.0.0       ║${NC}"
    echo -e "${CYAN}╠══════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║  服务器: ${REMOTE_HOST}                          ║${NC}"
    echo -e "${CYAN}║  目录:   ${REMOTE_DIR}                        ║${NC}"
    echo -e "${CYAN}║  端口:   ${APP_PORT}                                  ║${NC}"
    echo -e "${CYAN}║  日志:   ${LOG_FILE}         ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 执行部署步骤
    if [[ "$SKIP_PUSH" != "true" ]]; then
        step_git_commit
    fi

    if [[ "$SKIP_TAG" != "true" ]]; then
        step_version_tag
    fi

    step_local_build
    step_package_upload
    step_install_deps
    step_restart_service
    step_health_check

    # 部署成功
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              ✅ 部署成功！                            ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║  访问地址: http://${REMOTE_HOST}:${APP_PORT}         ${NC}"
    echo -e "${GREEN}║  健康检查: http://${REMOTE_HOST}:${APP_PORT}${HEALTH_ENDPOINT}  ${NC}"
    echo -e "${GREEN}║  日志文件: ${LOG_FILE}        ${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

main "$@"
