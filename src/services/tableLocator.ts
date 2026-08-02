/**
 * 在线表格动态定位工具
 *
 * 核心功能：以文字标识动态定位"汇总"行、"参考卖价"行、"参考卖价"列、"含税价"列，
 * 确保当行/列位置因模板不同或用户编辑而发生变化时仍能正确识别。
 *
 * 定位规则：
 * - 汇总行：A列（第0列）文字 === "汇总"
 * - 参考卖价行：A列（第0列）文字 === "参考卖价"
 * - 成品行：A列（第0列）文字 === "成品"
 * - 参考卖价列：列标题行中包含"参考卖价"的列；若未找到，查找"单个布袋总价"；仍未找到则默认第9列
 * - 含税价列：列标题行中包含"含税价"的列；若未找到则默认为参考卖价列 + 1
 * - 列标题行：包含"加工费"关键字的行
 */

/** 单元格取值接口（适配 VTable 实例和纯二维数组） */
export interface CellValueGetter {
  (col: number, row: number): any
}

/** 表格定位结果 */
export interface TablePositions {
  /** 汇总行索引（A列="汇总"） */
  summaryRow: number
  /** 参考卖价行索引（A列="参考卖价"） */
  refSellRow: number
  /** 成品行索引（A列="成品"） */
  finishedRow: number
  /** 参考卖价列索引 */
  refSellCol: number
  /** 含税价列索引 */
  withTaxCol: number
}

/** 默认列索引（当动态查找失败时的回退值） */
const DEFAULT_REF_SELL_COL = 9
const DEFAULT_FINISHED_ROW = 1

/**
 * 在二维数组中查找指定行：遍历每行的第0列，匹配指定文字
 * @param data 二维数组
 * @param label 要匹配的A列文字
 * @returns 行索引，未找到返回 -1
 */
export function findRowByLabel(data: any[][], label: string): number {
  for (let r = 0; r < data.length; r++) {
    const row = data[r]
    if (row && row[0] === label) return r
  }
  return -1
}

/**
 * 在指定行中查找包含关键字的列
 * @param data 二维数组
 * @param row 行索引
 * @param keywords 关键字数组（按优先级匹配）
 * @returns 列索引，未找到返回 -1
 */
export function findColByHeader(data: any[][], row: number, keywords: string[]): number {
  if (row < 0 || row >= data.length) return -1
  const rowData = data[row]
  if (!rowData) return -1
  for (let c = 0; c < rowData.length; c++) {
    const val = rowData[c]
    if (typeof val === 'string') {
      for (const kw of keywords) {
        if (val.includes(kw)) return c
      }
    }
  }
  return -1
}

/**
 * 查找列标题行（包含"加工费"关键字的行）
 * @param data 二维数组
 * @returns 行索引，未找到返回 -1
 */
export function findHeaderRow(data: any[][]): number {
  for (let r = 0; r < data.length; r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      const val = row[c]
      if (typeof val === 'string' && val.includes('加工费')) return r
    }
  }
  return -1
}

/**
 * 动态定位表格中的关键行和列
 *
 * @param data 表格二维数组（行 × 列）
 * @returns 定位结果
 */
export function findTablePositions(data: any[][]): TablePositions {
  // 定位行：汇总行、参考卖价行、成品行
  const summaryRow = findRowByLabel(data, '汇总')
  const refSellRow = findRowByLabel(data, '参考卖价')
  const finishedRow = findRowByLabel(data, '成品')
  // 定位列标题行
  const headerRow = findHeaderRow(data)
  // 定位列：参考卖价列（优先"参考卖价"，其次"单个布袋总价"，回退默认9）
  let refSellCol = -1
  if (headerRow >= 0) {
    refSellCol = findColByHeader(data, headerRow, ['参考卖价', '单个布袋总价'])
  }
  if (refSellCol < 0) refSellCol = DEFAULT_REF_SELL_COL

  // 定位列：含税价列（优先"含税价"，回退 refSellCol + 1）
  let withTaxCol = -1
  if (headerRow >= 0) {
    withTaxCol = findColByHeader(data, headerRow, ['含税价'])
  }
  if (withTaxCol < 0) withTaxCol = refSellCol + 1

  return {
    summaryRow,
    refSellRow,
    finishedRow: finishedRow >= 0 ? finishedRow : DEFAULT_FINISHED_ROW,
    refSellCol,
    withTaxCol,
  }
}

/**
 * 从表格数据中提取成本价和卖价
 *
 * - 成本价 = 汇总行 × 参考卖价列交叉单元格的值
 * - 卖价(不含税) = 参考卖价行 × 参考卖价列交叉单元格的值
 * - 卖价(含税) = 参考卖价行 × 含税价列交叉单元格的值
 *
 * @param data 表格二维数组
 * @param positions 定位结果（可选，若不传则自动计算）
 * @returns { costPrice, sellPriceNoTax, sellPriceWithTax }
 */
export function extractPrices(
  data: any[][],
  positions?: TablePositions,
): { costPrice: number | null; sellPriceNoTax: number | null; sellPriceWithTax: number | null } {
  const pos = positions ?? findTablePositions(data)

  const getNum = (row: number, col: number): number | null => {
    if (row < 0 || col < 0) return null
    const val = data[row]?.[col]
    if (typeof val === 'number' && !isNaN(val)) return val
    return null
  }

  return {
    costPrice: getNum(pos.summaryRow, pos.refSellCol),
    sellPriceNoTax: getNum(pos.refSellRow, pos.refSellCol),
    sellPriceWithTax: getNum(pos.refSellRow, pos.withTaxCol),
  }
}
