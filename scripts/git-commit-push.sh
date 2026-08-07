#!/bin/bash
#
# Git 提交并推送到 GitHub 远程仓库
#
# 用法:
#   ./scripts/git-commit-push.sh                          # 自动生成提交信息
#   ./scripts/git-commit-push.sh "修复打印预览样式"          # 指定提交信息
#   ./scripts/git-commit-push.sh "提交信息" --no-push       # 只提交不推送
#
# 脚本流程:
#   1. 检查工作目录（必须在项目根目录运行）
#   2. 显示当前状态（分支、变更文件）
#   3. 暂存所有已修改和新增的文件
#   4. 创建 commit（自动生成或使用指定信息）
#   5. 推送到远程仓库（可通过 --no-push 跳过）
#

set -e

# ── 颜色定义 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── 参数解析 ──
COMMIT_MSG=""
DO_PUSH=true

for arg in "$@"; do
  case "$arg" in
    --no-push)
      DO_PUSH=false
      ;;
    --help|-h)
      echo "用法: $0 [\"提交信息\"] [--no-push]"
      echo ""
      echo "选项:"
      echo "  \"提交信息\"   自定义 commit message（不传则自动生成）"
      echo "  --no-push     只提交不推送到远程"
      echo "  --help, -h    显示帮助"
      exit 0
      ;;
    *)
      if [ -z "$COMMIT_MSG" ]; then
        COMMIT_MSG="$arg"
      fi
      ;;
  esac
done

# ── 前置检查 ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 检查是否在 Git 仓库中
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo -e "${RED}[错误] 当前目录不是 Git 仓库${NC}"
  exit 1
fi

# 检查是否有远程仓库配置
REMOTE_COUNT=$(git remote | wc -l | tr -d ' ')
if [ "$REMOTE_COUNT" -eq 0 ] && [ "$DO_PUSH" = true ]; then
  echo -e "${RED}[错误] 没有配置远程仓库${NC}"
  exit 1
fi

# ── 获取当前状态 ──
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Git 提交 & 推送脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "项目目录:  ${PROJECT_DIR}"
echo -e "当前分支:  ${YELLOW}${CURRENT_BRANCH}${NC}"
echo ""

# ── 检查是否有变更 ──
HAS_STAGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
HAS_UNSTAGED=$(git diff --name-only | wc -l | tr -d ' ')
HAS_UNTRACKED=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')

if [ "$HAS_STAGED" -eq 0 ] && [ "$HAS_UNSTAGED" -eq 0 ] && [ "$HAS_UNTRACKED" -eq 0 ]; then
  echo -e "${YELLOW}[提示] 没有需要提交的变更${NC}"
  
  # 即使没有变更，如果需要推送且有未推送的 commit，仍可推送
  if [ "$DO_PUSH" = true ]; then
    UNPUSHED=$(git log @{u}..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
    if [ "$UNPUSHED" -gt 0 ]; then
      echo -e "${YELLOW}检测到 ${UNPUSHED} 个未推送的 commit，继续推送...${NC}"
    else
      echo -e "${GREEN}工作区干净，无需操作${NC}"
      exit 0
    fi
  else
    exit 0
  fi
fi

# 显示变更摘要
echo -e "${BLUE}--- 变更文件 ---${NC}"
if [ "$HAS_UNSTAGED" -gt 0 ]; then
  echo -e "${YELLOW}已修改（未暂存）:${NC}"
  git diff --name-only | sed 's/^/  M  /'
fi
if [ "$HAS_UNTRACKED" -gt 0 ]; then
  echo -e "${YELLOW}未跟踪（新文件）:${NC}"
  git ls-files --others --exclude-standard | sed 's/^/  ?  /'
fi
if [ "$HAS_STAGED" -gt 0 ]; then
  echo -e "${YELLOW}已暂存:${NC}"
  git diff --cached --name-only | sed 's/^/  A  /'
fi
echo ""

# ── 暂存文件 ──
echo -e "${BLUE}[1/3] 暂存文件...${NC}"

# 暂存已修改和已删除的文件（已跟踪）
if [ "$HAS_UNSTAGED" -gt 0 ]; then
  git add -u
  echo -e "  ${GREEN}✓ 已暂存修改的文件${NC}"
fi

# 暂存新文件（未跟踪），排除敏感文件
if [ "$HAS_UNTRACKED" -gt 0 ]; then
  # 排除 .env、密钥等敏感文件
  git ls-files --others --exclude-standard | while read -r file; do
    case "$file" in
      *.env|.env*|*secret*|*credential*|*password*|*.key|*.pem)
        echo -e "  ${YELLOW}⚠ 跳过敏感文件: $file${NC}"
        ;;
      *)
        git add "$file"
        ;;
    esac
  done
  echo -e "  ${GREEN}✓ 已暂存新文件${NC}"
fi

echo ""

# ── 生成提交信息 ──
if [ -z "$COMMIT_MSG" ]; then
  # 自动生成提交信息
  STAGED_FILES=$(git diff --cached --name-only)
  FILE_COUNT=$(echo "$STAGED_FILES" | wc -l | tr -d ' ')
  
  # 分析变更类型
  HAS_FEAT=false
  HAS_FIX=false
  HAS_DOCS=false
  HAS_TEST=false
  HAS_STYLE=false
  HAS_REFACTOR=false
  
  echo "$STAGED_FILES" | while read -r f; do
    case "$f" in
      *.test.*|*.spec.*) HAS_TEST=true ;;
      *.md|docs/*) HAS_DOCS=true ;;
      src/pages/*|src/components/*|src/services/*|api/*) HAS_FEAT=true ;;
      *) HAS_FEAT=true ;;
    esac
  done
  
  # 获取最近的 commit 风格
  RECENT_COMMITS=$(git log --oneline -5 2>/dev/null)
  
  COMMIT_MSG="更新 ${FILE_COUNT} 个文件"
  
  # 尝试更具体的描述
  FIRST_FILE=$(echo "$STAGED_FILES" | head -1)
  if [ "$FILE_COUNT" -eq 1 ]; then
    COMMIT_MSG="更新 ${FIRST_FILE}"
  elif [ "$FILE_COUNT" -le 3 ]; then
    COMMIT_MSG="更新: $(echo "$STAGED_FILES" | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')"
  fi
fi

echo -e "${BLUE}[2/3] 创建提交...${NC}"
echo -e "  提交信息: ${YELLOW}${COMMIT_MSG}${NC}"

# 创建 commit
if git commit -m "$COMMIT_MSG" > /dev/null 2>&1; then
  COMMIT_HASH=$(git rev-parse --short HEAD)
  echo -e "  ${GREEN}✓ 提交成功: ${COMMIT_HASH}${NC}"
else
  echo -e "  ${RED}✗ 提交失败${NC}"
  exit 1
fi
echo ""

# ── 推送到远程 ──
if [ "$DO_PUSH" = true ]; then
  echo -e "${BLUE}[3/3] 推送到远程仓库...${NC}"
  
  # 获取远程仓库名（通常是 origin）
  REMOTE_NAME=$(git remote | head -1)
  
  if git push "$REMOTE_NAME" "$CURRENT_BRANCH" 2>&1; then
    echo -e "  ${GREEN}✓ 推送成功 → ${REMOTE_NAME}/${CURRENT_BRANCH}${NC}"
  else
    echo -e "  ${RED}✗ 推送失败${NC}"
    echo -e "  ${YELLOW}提交已保存到本地，可稍后手动推送: git push ${REMOTE_NAME} ${CURRENT_BRANCH}${NC}"
    exit 1
  fi
else
  echo -e "${BLUE}[3/3] 跳过推送（--no-push）${NC}"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  操作完成!${NC}"
echo -e "${GREEN}========================================${NC}"
