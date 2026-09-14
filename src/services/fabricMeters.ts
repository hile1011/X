/**
 * 布料米数(M)列向上取整服务
 *
 * 业务规则：布料按整米采购/裁切，布料米数一律向上取整（Excel CEILING 语义），
 * 前端展示、公式计算、数据库存储三方使用同一取整口径（见 docs/API文档.md / docs/用户手册.md）。
 *
 * 取整规则（标准数学向上取整）：
 *   1.0 → 1，1.1 → 2，1.9 → 2，0.0 → 0，0.1 → 1
 *   负数按绝对值向上取整后保持负号：-1.1 → -2，-1.0 → -1（与 Excel CEILING(x,1) 一致）
 *
 * 与 api/services/fabricMeters.ts 保持算法完全一致（前后端同口径，勿单边修改）。
 */
import { ExcelUtils } from '../utils/ExcelUtils'

/** 布料米数列默认索引（表头定位失败时的回退值，与 tableLocator 备料默认列一致） */
export const FABRIC_METERS_DEFAULT_COL = 12

/** 表头关键字（列标题「布料米数(M)」） */
const FABRIC_METERS_HEADER_KEYWORD = '布料米数'

/** 表头扫描的最大行数（表头行位于表格顶部，避免误匹配数据区文本） */
const HEADER_SCAN_ROWS = 5

/** 单元格取整变更明细（用于保存前二次确认与审计日志） */
export interface FabricMetersChange {
  /** Excel 单元格地址（如 M3） */
  address: string
  /** 行索引（0-based） */
  row: number
  /** 原值 */
  from: number
  /** 取整后值 */
  to: number
}

/**
 * 布料米数取整（标准向上取整）
 *
 * 非有限数字（null/字符串/NaN/Infinity）原样返回，由调用方决定处理方式
 */
export function ceilFabricMeters<T>(value: T): T | number {
  if (typeof value !== 'number' || !isFinite(value)) return value
  if (value === 0) return 0
  // 负数按绝对值向上取整后保持负号（-1.1 → -2），与 Excel CEILING(x,1) 语义一致
  return value > 0 ? Math.ceil(value) : -Math.ceil(Math.abs(value))
}

/**
 * 从表格数据定位布料米数列索引
 *
 * 在表格顶部（前 5 行）按表头关键字「布料米数」查找；未找到回退默认列 12
 * （与 FABRIC_PREP_DEFAULT_COLS.meters 一致，标准模板布料米数固定为 M 列）
 */
export function findFabricMetersCol(data: unknown): number {
  if (!Array.isArray(data)) return FABRIC_METERS_DEFAULT_COL
  const rows = Math.min(data.length, HEADER_SCAN_ROWS)
  for (let r = 0; r < rows; r++) {
    const row = data[r]
    if (!Array.isArray(row)) continue
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v === 'string' && v.includes(FABRIC_METERS_HEADER_KEYWORD)) return c
    }
  }
  return FABRIC_METERS_DEFAULT_COL
}

/**
 * 表格二维数据布料米数列取整（返回新数组，原数组不变）
 *
 * - 仅布料米数列的有限数字值会被取整；文本/null/其他列不受影响
 * - 返回取整明细（地址 + 原值→新值），供保存前二次确认与审计日志使用
 * - 无变更时返回原数组引用（便于调用方跳过无谓的渲染/持久化）
 */
export function applyFabricMetersCeil(
  data: (string | number | null)[][],
): { data: (string | number | null)[][]; changes: FabricMetersChange[] } {
  if (!Array.isArray(data) || data.length === 0) return { data, changes: [] }
  const col = findFabricMetersCol(data)
  const changes: FabricMetersChange[] = []
  let next: (string | number | null)[][] | null = null
  for (let r = 0; r < data.length; r++) {
    const row = data[r]
    if (!Array.isArray(row)) continue
    const value = row[col]
    if (typeof value !== 'number' || !isFinite(value)) continue
    const ceiled = ceilFabricMeters(value)
    if (ceiled === value) continue
    if (!next) next = data.slice()
    next[r] = row.slice()
    next[r][col] = ceiled
    changes.push({ address: ExcelUtils.toAddress(r, col), row: r, from: value, to: ceiled })
  }
  return { data: next ?? data, changes }
}

/**
 * 判断公式是否已被整体包裹 CEILING（=CEILING(…,1) 形式，避免重复包裹）
 */
function isFullyCeilingWrapped(formula: string): boolean {
  return formula.startsWith('=CEILING(') && formula.endsWith(',1)')
}

/**
 * 布料米数列公式整体包裹 CEILING(...,1)
 *
 * 作用：使公式计算结果本身即为整数，下游公式（总重量/布料成本/参考卖价等
 * 引用布料米数的单元格）自动使用取整后的米数参与运算，无需逐个改写。
 *
 * 规则：
 * - 仅处理地址位于布料米数列的公式
 * - 已整体包裹（=CEILING( 开头且 ,1) 结尾）的公式跳过，保证幂等
 * - 变更明细（地址 + 原公式）返回，供审计日志使用
 */
export function wrapFabricMetersFormulas(
  formulas: Record<string, string>,
  metersCol: number,
): { formulas: Record<string, string>; changes: { address: string; from: string }[] } {
  const changes: { address: string; from: string }[] = []
  if (!formulas || typeof formulas !== 'object') return { formulas, changes }
  let next: Record<string, string> | null = null
  for (const [addr, formula] of Object.entries(formulas)) {
    if (typeof formula !== 'string' || !formula.startsWith('=')) continue
    const { col } = ExcelUtils.parseAddress(addr)
    if (col !== metersCol || isFullyCeilingWrapped(formula)) continue
    if (!next) next = { ...formulas }
    next[addr] = `=CEILING(${formula.slice(1)},1)`
    changes.push({ address: addr, from: formula })
  }
  return { formulas: next ?? formulas, changes }
}

/**
 * 还原布料米数列公式的 CEILING 包裹（wrapFabricMetersFormulas 的逆运算，供迁移 down 使用）
 *
 * 仅还原「整体包裹」形式的公式（=CEILING(…,1) → 原公式）；
 * 数值取整（applyFabricMetersCeil）不可逆，down 不处理
 */
export function unwrapFabricMetersFormulas(
  formulas: Record<string, string>,
  metersCol: number,
): { formulas: Record<string, string>; changes: { address: string; from: string }[] } {
  const changes: { address: string; from: string }[] = []
  if (!formulas || typeof formulas !== 'object') return { formulas, changes }
  let next: Record<string, string> | null = null
  for (const [addr, formula] of Object.entries(formulas)) {
    if (typeof formula !== 'string' || !isFullyCeilingWrapped(formula)) continue
    const { col } = ExcelUtils.parseAddress(addr)
    if (col !== metersCol) continue
    if (!next) next = { ...formulas }
    // 去掉 '=CEILING(' 前缀与 ',1)' 后缀，恢复原公式
    next[addr] = `=${formula.slice(9, -3)}`
    changes.push({ address: addr, from: formula })
  }
  return { formulas: next ?? formulas, changes }
}

/**
 * 持久化前统一规范化（保存/打印/导出共用口径）
 *
 * @param data 表格二维数据（数值取整）
 * @param formulas 公式映射（可选；布料米数列公式整体包裹 CEILING）
 */
export function normalizeFabricMeters(
  data: (string | number | null)[][],
  formulas?: Record<string, string>,
): {
  data: (string | number | null)[][]
  formulas?: Record<string, string>
  ceilChanges: FabricMetersChange[]
  formulaChanges: { address: string; from: string }[]
} {
  const ceilResult = applyFabricMetersCeil(data)
  const wrapResult = formulas
    ? wrapFabricMetersFormulas(formulas, findFabricMetersCol(ceilResult.data))
    : { formulas, changes: [] as { address: string; from: string }[] }
  return {
    data: ceilResult.data,
    formulas: wrapResult.formulas,
    ceilChanges: ceilResult.changes,
    formulaChanges: wrapResult.changes,
  }
}
