#!/usr/bin/env bash
# ============================================================================
# 报价跟单系统 - 远程部署自动化脚本
# 版本: 1.0.0
# 用法: bash scripts/deploy-remote.sh [选项]
#
# 功能:
#   1. 本机构建前端+后端
#   2. 打包并上传代码到远程服务器
#   3. 远程安装依赖、重启服务
#   4. 健康检查与验证
#   5. 失败时自动回滚
#
# 选项:
#   --skip-build      跳过本机构建（使用已有 dist/）
#   --skip-push       跳过 git commit & push
#   --rollback        回滚到上一版本
#   --version <ver>   指定版本号（如 v1.1.2）
#   --dry-run         仅打印命令，不实际执行
#   --help            显示帮助
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
APP_PORT="3002"
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
    log_step "步骤 3/7: 本机构建"

    if [[ "${SKIP_BUILD:-false}" == "true" ]]; then
        log WARN "跳过构建（--skip-build）"
        return 0
    fi

    cd "$LOCAL_DIR"

    # 构建前端
    local_exec "npx vite build" "构建前端 (Vite)"
    check_error $? "前端构建失败" "false"

    # 验证构建产物
    if [[ ! -f "dist/index.html" ]]; then
        log ERROR "前端构建产物缺失: dist/index.html"
        exit 1
    fi
    log INFO "前端构建产物验证通过"

    # 构建后端
    local_exec "npx tsc -p api/tsconfig.json" "构建后端 (TypeScript)"
    check_error $? "后端构建失败" "false"

    if [[ ! -f "api/dist/index.js" ]]; then
        log ERROR "后端构建产物缺失: api/dist/index.js"
        exit 1
    fi
    log INFO "后端构建产物验证通过"
}

step_package_upload() {
    log_step "步骤 4/7: 打包与上传"

    cd "$LOCAL_DIR"

    local tarball="/tmp/X-deploy-$(date +%Y%m%d_%H%M%S).tar.gz"

    # 打包（排除不需要的文件）
    log INFO "打包项目文件..."
    tar czf "$tarball" \
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
        . 2>/dev/null

    local tarball_size
    tarball_size=$(du -h "$tarball" | cut -f1)
    log INFO "打包完成: $tarball ($tarball_size)"

    # 备份远程当前版本
    log INFO "备份远程当前版本..."
    remote_exec "cd ${REMOTE_DIR} && tar czf /tmp/X-backup-\$(date +%Y%m%d_%H%M%S).tar.gz --exclude=node_modules --exclude=.env . 2>/dev/null || true" "备份远程代码"
    remote_exec "ls -lt /tmp/X-backup-*.tar.gz 2>/dev/null | head -1" "确认备份"

    # 上传
    log INFO "上传代码包到服务器..."
    if [[ "${DRY_RUN:-false}" != "true" ]]; then
        sshpass -p "$REMOTE_PASS" scp -F /dev/null \
            -o StrictHostKeyChecking=no \
            -o UserKnownHostsFile=/dev/null \
            "$tarball" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/" 2>&1 | tee -a "$LOG_FILE"
        check_error $? "上传失败" "false"
    fi

    # 解压
    remote_exec "cd ${REMOTE_DIR} && tar xzf $(basename $tarball) 2>&1 | grep -v 'LIBARCHIVE' || true" "解压代码"

    # 上传构建产物
    local dist_tarball="/tmp/X-dist-$(date +%Y%m%d_%H%M%S).tar.gz"
    if [[ -d "dist" && -d "api/dist" ]]; then
        log INFO "打包并上传构建产物..."
        tar czf "$dist_tarball" dist/ api/dist/
        if [[ "${DRY_RUN:-false}" != "true" ]]; then
            sshpass -p "$REMOTE_PASS" scp -F /dev/null \
                -o StrictHostKeyChecking=no \
                -o UserKnownHostsFile=/dev/null \
                "$dist_tarball" "${REMOTE_USER}@${REMOTE_HOST}:/tmp/" 2>&1 | tee -a "$LOG_FILE"
            remote_exec "cd ${REMOTE_DIR} && tar xzf $(basename $dist_tarball) 2>&1 | grep -v 'LIBARCHIVE' || true" "解压构建产物"
        fi
    fi

    log INFO "打包与上传完成"
}

step_install_deps() {
    log_step "步骤 5/7: 安装依赖"

    remote_exec "cd ${REMOTE_DIR} && npm config set registry https://registry.npmmirror.com && npm install --production 2>&1 | tail -5" "安装生产依赖"
    check_error $? "依赖安装失败" "false"

    log INFO "依赖安装完成"
}

step_restart_service() {
    log_step "步骤 6/7: 重启服务"

    # 确保 .env 存在
    remote_exec "test -f ${REMOTE_DIR}/.env && echo '.env exists' || echo '.env missing'" "检查 .env 配置"

    # 重启 PM2
    remote_exec "cd ${REMOTE_DIR} && pm2 restart ${APP_NAME} --env production 2>&1 || pm2 start api/dist/index.js --name '${APP_NAME}' --env production 2>&1" "重启 PM2 服务"
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

    # 额外验证
    log INFO "验证前端页面..."
    remote_exec "curl -s http://localhost:${APP_PORT}/ | head -3" "前端页面检查"

    log INFO "验证 API 接口..."
    remote_exec "curl -s http://localhost:${APP_PORT}/api/quotes | head -100" "API 接口检查"

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
    remote_exec "cd ${REMOTE_DIR} && pm2 restart ${APP_NAME} --env production 2>&1 || pm2 start api/dist/index.js --name '${APP_NAME}' --env production 2>&1" "重启服务"

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
报价跟单系统 - 远程部署自动化脚本

用法:
  bash scripts/deploy-remote.sh [选项]

选项:
  --skip-build       跳过本机构建（使用已有 dist/）
  --skip-push        跳过 git commit & push
  --version <ver>    指定版本号（如 1.1.2）
  --rollback         回滚到上一版本
  --dry-run          仅打印命令，不实际执行
  --help             显示此帮助信息

示例:
  # 完整部署（构建+提交+推送+部署）
  bash scripts/deploy-remote.sh

  # 跳过构建，仅部署
  bash scripts/deploy-remote.sh --skip-build

  # 指定版本号
  bash scripts/deploy-remote.sh --version 1.2.0

  # 回滚
  bash scripts/deploy-remote.sh --rollback

  # 预演（不实际执行）
  bash scripts/deploy-remote.sh --dry-run
HELP
}

main() {
    # 解析参数
    SKIP_BUILD=false
    SKIP_PUSH=false
    DO_ROLLBACK=false
    DRY_RUN=false
    TARGET_VERSION=""
    COMMIT_MSG=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-build)   SKIP_BUILD=true; shift ;;
            --skip-push)    SKIP_PUSH=true; shift ;;
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

    step_version_tag
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
    echo -e "${GREEN}║  访问地址: http://${REMOTE_HOST}                    ${NC}"
    echo -e "${GREEN}║  健康检查: http://${REMOTE_HOST}/api/health          ${NC}"
    echo -e "${GREEN}║  日志文件: ${LOG_FILE}        ${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
}

main "$@"
