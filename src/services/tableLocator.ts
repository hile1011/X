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

// ────────────────────────────────────────────────────────────
// 备料数据提取（在线表格规格试算区 → 面料采购材料清单）
// ────────────────────────────────────────────────────────────

/** 备料提取行（在线表格第二个标题行之前的规格区数据） */
export interface FabricPrepRow {
  /** 名称（行标签：正反面/手提/底部…） */
  name: string
  /** 数量（个） */
  quantity: number | null
  /** 切片宽 */
  cutWidth: number | null
  /** 切片高 */
  cutHeight: number | null
  /** 布料米数(M) */
  meters: number | null
}

/** 备料提取默认列索引（第一个标题行关键字定位失败时的回退值，与模板布局一致） */
const FABRIC_PREP_DEFAULT_COLS = { quantity: 1, cutWidth: 7, cutHeight: 8, meters: 12 }

/**
 * 判断是否标题行：A列无值，且其他列存在非空「文本」单元格
 * （标题行为表头文字；纯数值行是数据行而非标题，避免误判截断提取区）
 */
function isSheetTitleRow(row: any[]): boolean {
  if (!row) return false
  if (row[0] != null && row[0] !== '') return false
  for (let c = 1; c < row.length; c++) {
    const v = row[c]
    if (typeof v === 'string' && v.trim() !== '') return true
  }
  return false
}

/** 解析非负有限数值（数字或数字字符串），非法返回 null */
function parseNonNegativeNumber(v: any): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return isFinite(n) && n >= 0 ? n : null
}

/**
 * 从在线表格提取备料数据（第二个标题行之前的规格试算区）
 *
 * 定位规则（动态识别，行/列位置变化不影响）：
 * - 标题行 = 「A列无值且其他列存在非空文本」的行（表头文字；纯数值行为数据行）
 * - 第一个标题行 = 首个标题行；四个字段列在该行按关键字定位
 *   （数量/切片宽/切片高/布料米数），失败回退模板默认列
 * - 第二个标题行 = 其后下一个标题行（加工费成本核算区表头）
 * - 数据行 = 两个标题行之间、A列有名称且切片宽/高/米数不全为空的行
 *   （「成品」行无切料数据，天然被排除）
 *
 * 数值校验：仅接受非负有限数字（数字或数字字符串），非法置 null；米数保留两位小数
 *
 * @param data 表格二维数组（行 × 列）
 * @returns 提取行数组；表格结构不完整（无第二个标题行）时返回 null，表示不联动
 */
export function extractFabricPrepRows(data: any[][]): FabricPrepRow[] | null {
  if (!Array.isArray(data) || data.length === 0) return null

  // 定位第一个/第二个标题行
  let firstTitleRow = -1
  let secondTitleRow = -1
  for (let r = 0; r < data.length; r++) {
    if (isSheetTitleRow(data[r])) {
      if (firstTitleRow < 0) {
        firstTitleRow = r
        continue
      }
      secondTitleRow = r
      break
    }
  }
  // 结构不完整：返回 null 表示不联动，保留现有材料数据
  if (firstTitleRow < 0 || secondTitleRow < 0) return null

  // 列定位：第一个标题行关键字查找 + 回退
  const colOf = (keywords: string[], fallback: number): number => {
    const c = findColByHeader(data, firstTitleRow, keywords)
    return c >= 0 ? c : fallback
  }
  const qtyCol = colOf(['数量'], FABRIC_PREP_DEFAULT_COLS.quantity)
  const cutWCol = colOf(['切片宽'], FABRIC_PREP_DEFAULT_COLS.cutWidth)
  const cutHCol = colOf(['切片高'], FABRIC_PREP_DEFAULT_COLS.cutHeight)
  const metersCol = colOf(['布料米数'], FABRIC_PREP_DEFAULT_COLS.meters)

  const rows: FabricPrepRow[] = []
  for (let r = firstTitleRow + 1; r < secondTitleRow; r++) {
    const row = data[r]
    if (!row) continue
    const name = row[0] == null ? '' : String(row[0]).trim()
    if (!name) continue
    const quantity = parseNonNegativeNumber(row[qtyCol])
    const cutWidth = parseNonNegativeNumber(row[cutWCol])
    const cutHeight = parseNonNegativeNumber(row[cutHCol])
    const meters = parseNonNegativeNumber(row[metersCol])
    // 跳过切片宽/高/米数全为空的行（如成品行：仅有规格无切料数据）
    if (cutWidth == null && cutHeight == null && meters == null) continue
    rows.push({
      name: name.slice(0, 64),
      quantity,
      cutWidth,
      cutHeight,
      meters: meters != null ? Math.round(meters * 100) / 100 : null,
    })
  }
  return rows
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
