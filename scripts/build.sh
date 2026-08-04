#!/bin/bash
# ============================================================
#  build.sh — 标准化构建流水线
#
#  完整构建步骤：
#    1. 依赖安装与版本校验
#    2. 静态代码质量检查（TypeScript 类型检查）
#    3. 单元测试执行
#    4. 代码覆盖率分析
#    5. 构建产物打包（前端 + 后端）
#    6. 构建报告生成
#
#  支持：增量构建（默认）与全量构建（--clean）
#
#  用法：
#    bash scripts/build.sh [选项]
#
#  选项：
#    -e, --env <env>      环境 (dev|test|prod)，默认 dev
#    -c, --clean          全量构建（先清理 node_modules 和 dist）
#    --skip-deps          跳过依赖安装
#    --skip-test          跳过测试
#    --skip-coverage      跳过覆盖率分析
#    --skip-build         跳过构建产物打包
#    -h, --help           显示帮助
# ============================================================
set -eo pipefail

# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

# ---------- 帮助信息 ----------
_build_help() {
  print_help_header "build.sh — 标准化构建流水线" "从源代码到可执行文件的完整构建，包含依赖、检查、测试、覆盖率、打包、报告"
  echo "用法: bash scripts/build.sh [选项]"
  echo ""
  echo "选项:"
  print_help_option "-e, --env <env>"     "目标环境: dev(默认) / test / prod"
  print_help_option "-c, --clean"          "全量构建（清理 node_modules、dist、cache 后重建）"
  print_help_option "    --skip-deps"      "跳过依赖安装"
  print_help_option "    --skip-test"     "跳过单元测试"
  print_help_option "    --skip-coverage" "跳过覆盖率分析"
  print_help_option "    --skip-build"    "跳过构建产物打包（仅运行检查和测试）"
  print_help_option "-h, --help"           "显示此帮助"
  echo ""
  echo "示例:"
  echo "  bash scripts/build.sh                    # 增量构建（dev 环境）"
  echo "  bash scripts/build.sh -e prod -c         # 生产全量构建"
  echo "  bash scripts/build.sh --skip-test        # 跳过测试快速构建"
}

# ---------- 参数解析 ----------
BUILD_ENV="dev"
FLAG_CLEAN=false
FLAG_SKIP_DEPS=false
FLAG_SKIP_TEST=false
FLAG_SKIP_COVERAGE=false
FLAG_SKIP_BUILD=false

while [ $# -gt 0 ]; do
  case "$1" in
    -e|--env)        BUILD_ENV="$2"; shift 2 ;;
    -c|--clean)      FLAG_CLEAN=true; shift ;;
    --skip-deps)     FLAG_SKIP_DEPS=true; shift ;;
    --skip-test)     FLAG_SKIP_TEST=true; shift ;;
    --skip-coverage) FLAG_SKIP_COVERAGE=true; shift ;;
    --skip-build)    FLAG_SKIP_BUILD=true; shift ;;
    -h|--help)       _build_help; exit 0 ;;
    *)               log_error "未知选项: $1"; _build_help; exit 1 ;;
  esac
done

# ---------- 加载配置 ----------
load_config "$BUILD_ENV"

BUILD_START_TS="$(date +%s)"
BUILD_STEP_NUM=0
BUILD_TOTAL_STEPS=0
# 统计实际会执行的步骤数（与下方执行逻辑严格对应）
[ "$FLAG_CLEAN" = true ]                                       && BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 清理
[ "$FLAG_SKIP_DEPS" = false ]                                  && BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 依赖安装与版本校验
                                                                 BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 静态类型检查（始终执行）
if [ "$FLAG_SKIP_TEST" = false ] && [ "$FLAG_SKIP_COVERAGE" = true ]; then
                                                                 BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 仅单元测试
elif [ "$FLAG_SKIP_TEST" = false ] && [ "$FLAG_SKIP_COVERAGE" = false ]; then
                                                                 BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 单元测试 + 覆盖率
fi
if [ "$FLAG_SKIP_BUILD" = false ] && [ -n "$BUILD_OUTPUT_DIR" ]; then
                                                                 BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 构建产物打包
fi
                                                                 BUILD_TOTAL_STEPS=$((BUILD_TOTAL_STEPS + 1)) # 报告

_next_step() { BUILD_STEP_NUM=$((BUILD_STEP_NUM + 1)); }

log_step "构建开始 — 环境: $ENV_NAME | 全量: $FLAG_CLEAN"

cd "$PROJECT_ROOT"

# ============================================================
# Step 1: 清理（仅 --clean 时执行）
# ============================================================
if [ "$FLAG_CLEAN" = true ]; then
  _next_step
  log_info "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 清理构建产物..."
  rm -rf node_modules/.vite
  rm -rf dist
  rm -rf api/dist
  rm -rf coverage
  log_ok "清理完成"
fi

# ============================================================
# Step 2: 依赖安装与版本校验
# ============================================================
if [ "$FLAG_SKIP_DEPS" = false ]; then
  _next_step
  log_step "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 依赖安装与版本校验"

  # 版本校验
  _node_ver="$(node -v 2>/dev/null || echo 'N/A')"
  _npm_ver="$(npm -v 2>/dev/null || echo 'N/A')"
  log_info "Node: $_node_ver | npm: $_npm_ver"

  # 依赖安装
  if [ "$FLAG_CLEAN" = true ]; then
    log_info "执行全量依赖安装 (npm ci)..."
    npm ci 2>&1 | tail -5
  else
    # 增量：仅在 package-lock.json 变化时重装
    _need_install=false
    if [ ! -d node_modules ]; then
      _need_install=true
    elif [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
      _need_install=true
    fi

    if [ "$_need_install" = true ]; then
      log_info "检测到依赖变化，执行安装 (npm install)..."
      npm install 2>&1 | tail -5
    else
      log_ok "依赖已是最新，跳过安装"
    fi
  fi
  log_ok "依赖就绪"
fi

# ============================================================
# Step 3: 静态代码质量检查（TypeScript 类型检查）
# ============================================================
_next_step
log_step "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 静态代码质量检查 (TypeScript)"

if npx tsc --noEmit 2>&1; then
  log_ok "类型检查通过"
else
  write_build_report "failed" "$BUILD_START_TS" "TypeScript 类型检查失败"
  log_error "类型检查失败，构建终止"
  exit 1
fi

# ============================================================
# Step 4: 单元测试执行
# ============================================================
if [ "$FLAG_SKIP_TEST" = false ]; then
  _next_step
  if [ "$FLAG_SKIP_COVERAGE" = true ]; then
    log_step "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 单元测试执行"
    if npx vitest run 2>&1 | tail -15; then
      log_ok "单元测试通过"
    else
      write_build_report "failed" "$BUILD_START_TS" "单元测试失败"
      log_error "单元测试失败，构建终止"
      exit 1
    fi
  else
    log_step "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 单元测试 + 覆盖率分析"
    if npx vitest run --coverage 2>&1 | tail -25; then
      log_ok "单元测试与覆盖率分析通过"
    else
      write_build_report "failed" "$BUILD_START_TS" "单元测试或覆盖率分析失败"
      log_error "单元测试或覆盖率分析失败，构建终止"
      exit 1
    fi
  fi
fi

# ============================================================
# Step 5: 构建产物打包
# ============================================================
if [ "$FLAG_SKIP_BUILD" = false ] && [ -n "$BUILD_OUTPUT_DIR" ]; then
  _next_step
  log_step "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 构建产物打包"

  # 前端构建
  log_info "构建前端 (vite build)..."
  if npx vite build 2>&1 | tail -8; then
    log_ok "前端构建完成 → dist/"
  else
    write_build_report "failed" "$BUILD_START_TS" "前端构建失败"
    log_error "前端构建失败，构建终止"
    exit 1
  fi

  # 后端构建
  log_info "构建后端 (tsc -p api/tsconfig.json)..."
  if npx tsc -p api/tsconfig.json 2>&1 | tail -5; then
    log_ok "后端构建完成 → api/dist/"
  else
    write_build_report "failed" "$BUILD_START_TS" "后端构建失败"
    log_error "后端构建失败，构建终止"
    exit 1
  fi

  # 验证构建产物
  if [ ! -f "$PROJECT_ROOT/api/dist/index.js" ]; then
    write_build_report "failed" "$BUILD_START_TS" "构建产物缺失: api/dist/index.js"
    log_error "构建产物验证失败: api/dist/index.js 不存在"
    exit 1
  fi
  log_ok "构建产物验证通过"
fi

# ============================================================
# Step 6: 构建报告
# ============================================================
_next_step
log_step "[$BUILD_STEP_NUM/$BUILD_TOTAL_STEPS] 构建报告"

_extra="Steps: $BUILD_STEP_NUM | Clean: $FLAG_CLEAN"
_extra="$_extra | SkipDeps: $FLAG_SKIP_DEPS | SkipTest: $FLAG_SKIP_TEST | SkipBuild: $FLAG_SKIP_BUILD"

write_build_report "success" "$BUILD_START_TS" "$_extra"

echo ""
log_ok "构建流水线全部完成"
