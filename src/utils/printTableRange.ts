/**
 * 打印表格范围工具
 *
 * 打印时仅输出在线表格第二个标题行之前的内容（不含第二个标题行及其之后的所有行），
 * 即只打印"参数输入区"（第一个标题行 + 成品/正反面/手提等行），排除"成本计算区"
 * （加工费/汇总/参考卖价/利润等）。
 *
 * 标题行识别规则与在线表格 getCellStyle（BagQuoteTable.tsx / BagQuote.tsx）一致：
 *   1) 具有蓝色背景（#4472C4）的行 —— 由「第一列无值且其他列有值」的数据特征触发
 *   2) 第一列内容为空的行
 * 两种识别方式在数据层面收敛为同一规则：第一列无值且其他列至少一个有值 → 标题行。
 */

/** 在线表格行数据类型（与 Quote.tableData 的行一致） */
export type TableRow = (string | number | null)[]

/** 单元格是否为有效值（非 null/undefined/纯空字符串） */
function hasValue(cell: string | number | null | undefined): boolean {
  return cell !== null && cell !== undefined && String(cell).trim() !== ''
}

/**
 * 判断表格行是否为标题行（蓝底白字行）
 * 规则：第一列无值 且 其他列至少一个有值
 */
export function isTableTitleRow(row: TableRow | undefined | null): boolean {
  if (!row || row.length === 0) return false
  // 第一列有值 → 不是标题行
  if (hasValue(row[0])) return false
  // 其他列至少一个有值 → 标题行；全部无值 → 空行，不是标题行
  return row.slice(1).some(hasValue)
}

/**
 * 获取打印用的表格行：
 *   1. 过滤全空行（与打印原有逻辑一致）
 *   2. 定位第二个标题行，仅保留其之前的行（不含第二个标题行及其之后内容）
 *   3. 标题行不足 2 个时返回全部非空行
 */
export function getPrintTableRows(tableData: TableRow[] | undefined | null): TableRow[] {
  const rows = (tableData ?? []).filter((row) => row.some(hasValue))
  let titleCount = 0
  for (let i = 0; i < rows.length; i++) {
    if (isTableTitleRow(rows[i])) {
      titleCount++
      if (titleCount === 2) {
        return rows.slice(0, i)
      }
    }
  }
  return rows
}
