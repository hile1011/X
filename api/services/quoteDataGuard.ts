/**
 * 订单数据防篡改守卫（表格/公式字段）
 *
 * 背景（2026-09-13 生产事故）：编辑订单时切换款式/模板后保存，触发了两个前端缺陷叠加——
 *   1. 表格用新模板重新初始化，订单已保存的 101 行真实数据被 31 行模板默认数据替换；
 *   2. 公式收集存在竞态（公式引擎未就绪时收集为空），allFormulas 被清成 {} 写库。
 * 前端已在 BagQuote.tsx 修复（保存兜底 + 切换警告），本守卫作为服务端最后一道防线：
 * 即使前端缺陷复发或被绕过（直接调 API），公式清空/表格大幅缩水的写入也会被拦截，
 * 需显式携带 confirmDataReset=true（用户在确认框中明确同意）才放行。
 */

/** 守卫拦截后返回给前端的错误码（前端据此弹确认框） */
export const QUOTE_DATA_RESET_CODE = 'QUOTE_DATA_RESET_CONFIRM_REQUIRED'

/** 已保存公式数低于该阈值时不做"公式清空"拦截（小订单正常精简） */
const MIN_FORMULAS_TO_GUARD = 5

/** 已保存表格行数低于该阈值时不做"表格缩水"拦截（小表格允许大幅编辑） */
const MIN_ROWS_TO_GUARD = 20

/** 新表格行数低于已保存行数的该比例时判定为"大幅缩水"（事故场景：101 行 → 31 行 ≈ 31%） */
const ROW_SHRINK_RATIO = 0.5

/** 统计公式数量：allFormulas 为对象时返回键数，其他情况返回 0 */
function countFormulas(formulas: unknown): number {
  return formulas && typeof formulas === 'object' && !Array.isArray(formulas)
    ? Object.keys(formulas).length
    : 0
}

/** 统计表格行数：tableData 为数组时返回长度，其他情况返回 -1（字段缺失，不参与判定） */
function countRows(tableData: unknown): number {
  return Array.isArray(tableData) ? tableData.length : -1
}

/**
 * 检测一次订单更新是否疑似"数据重置"（公式清空 / 表格大幅缩水）
 *
 * @param existing  数据库中已保存的订单数据（tableData / allFormulas，已解析）
 * @param incoming  本次更新请求携带的 tableData / allFormulas（原始请求体字段）
 * @returns 拦截原因（用户可读文案）；null = 放行
 *
 * 判定规则（仅当请求显式携带对应字段时才检测，局部更新如仅改状态不受影响）：
 *   - 公式清空：已有公式 ≥ 5 个，请求把 allFormulas 替换为空对象
 *   - 表格缩水：已有行数 ≥ 20 行，请求表格行数 < 已有行数 × 50%（含空数组）
 */
export function detectQuoteDataReset(
  existing: { tableData?: unknown; allFormulas?: unknown },
  incoming: { tableData?: unknown; allFormulas?: unknown },
): string | null {
  // ── 公式清空检测 ──
  // 仅当请求显式携带 allFormulas 字段（undefined = 局部更新不动公式，放行）
  if (incoming.allFormulas !== undefined) {
    const existingCount = countFormulas(existing.allFormulas)
    const incomingCount = countFormulas(incoming.allFormulas)
    if (existingCount >= MIN_FORMULAS_TO_GUARD && incomingCount === 0) {
      return (
        `检测到本次保存将清空订单的全部 ${existingCount} 个表格公式。` +
        `这可能由切换款式/模板后的保存竞态导致，公式清空后计算链将全部丢失。\n\n` +
        `如确需清空请点击"确定"，否则点击"取消"并检查数据。`
      )
    }
  }

  // ── 表格缩水检测 ──
  // 仅当请求显式携带 tableData 字段且为合法数组
  if (Array.isArray(incoming.tableData)) {
    const existingRows = countRows(existing.tableData)
    const incomingRows = countRows(incoming.tableData)
    if (
      existingRows >= MIN_ROWS_TO_GUARD &&
      incomingRows >= 0 &&
      incomingRows < existingRows * ROW_SHRINK_RATIO
    ) {
      return (
        `检测到本次保存将把表格数据从 ${existingRows} 行缩减为 ${incomingRows} 行（不足原有的 50%）。` +
        `这可能由切换款式/模板后模板默认数据覆盖订单数据导致。\n\n` +
        `如确需替换请点击"确定"，否则点击"取消"并检查数据。`
      )
    }
  }

  return null
}
