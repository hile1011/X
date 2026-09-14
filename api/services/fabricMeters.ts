/**
 * 布料米数(M)列向上取整服务（后端）
 *
 * 职责：订单/在线表格模板持久化前，对布料米数列执行统一的向上取整规范化——
 *   1. tableData/data 二维数组中布料米数列的数值向上取整
 *   2. allFormulas/formulas 中布料米数列公式整体包裹 CEILING(...,1)
 *   3. 取整变更写入审计日志（operation_logs，记录原值与取整后值）
 *
 * 与 src/services/fabricMeters.ts 算法完全一致（前后端同口径，勿单边修改）；
 * 取整规则见该文件头注释（标准数学向上取整，负数按绝对值取整后保持负号）。
 */
import { logOperation } from './auditLog.js'

/** 布料米数列默认索引（表头定位失败时的回退值，与前端 FABRIC_METERS_DEFAULT_COL 一致） */
export const FABRIC_METERS_DEFAULT_COL = 12

/** 表头关键字 */
const FABRIC_METERS_HEADER_KEYWORD = '布料米数'

/** 表头扫描的最大行数 */
const HEADER_SCAN_ROWS = 5

/** 审计日志操作类型（operation_logs.operation_type） */
export const FABRIC_METERS_CEIL_OPERATION = 'fabric-meters-ceil'

/** 审计 entity_name 字段上限（operation_logs.entity_name VARCHAR(255)） */
const AUDIT_NAME_MAX = 255

/** 单元格取整变更明细 */
export interface FabricMetersChange {
  address: string
  row: number
  from: number
  to: number
}

/** 解析 Excel 单元格地址（如 "M3"）为 0-based 列索引；无效返回 -1（与前端 ExcelUtils.parseAddress 同规则） */
export function parseColFromAddress(addr: string): number {
  const match = addr.match(/^([A-Z]+)(\d+)$/)
  if (!match) return -1
  let col = 0
  for (let i = 0; i < match[1].length; i++) {
    col = col * 26 + (match[1].charCodeAt(i) - 64)
  }
  return col - 1
}

/** 0-based { row, col } 转 Excel 地址（与前端 ExcelUtils.toAddress 同规则） */
function toAddress(row: number, col: number): string {
  let c = col + 1
  let letters = ''
  while (c > 0) {
    const rem = (c - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    c = Math.floor((c - 1) / 26)
  }
  return `${letters}${row + 1}`
}

/**
 * 布料米数取整（标准向上取整）；非有限数字原样返回
 */
export function ceilFabricMeters<T>(value: T): T | number {
  if (typeof value !== 'number' || !isFinite(value)) return value
  if (value === 0) return 0
  // 负数按绝对值向上取整后保持负号（-1.1 → -2），与 Excel CEILING(x,1) 语义一致
  return value > 0 ? Math.ceil(value) : -Math.ceil(Math.abs(value))
}

/**
 * 从表格数据定位布料米数列索引（表头关键字查找，失败回退默认列 12）
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
    changes.push({ address: toAddress(r, col), row: r, from: value, to: ceiled })
  }
  return { data: next ?? data, changes }
}

/** 判断公式是否已被整体包裹 CEILING（=CEILING(…,1)） */
function isFullyCeilingWrapped(formula: string): boolean {
  return formula.startsWith('=CEILING(') && formula.endsWith(',1)')
}

/**
 * 布料米数列公式整体包裹 CEILING(...,1)（幂等：已包裹的跳过）
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
    if (parseColFromAddress(addr) !== metersCol || isFullyCeilingWrapped(formula)) continue
    if (!next) next = { ...formulas }
    next[addr] = `=CEILING(${formula.slice(1)},1)`
    changes.push({ address: addr, from: formula })
  }
  return { formulas: next ?? formulas, changes }
}

/**
 * 还原布料米数列公式的 CEILING 包裹（逆运算，供迁移 down 使用）
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
    if (parseColFromAddress(addr) !== metersCol) continue
    if (!next) next = { ...formulas }
    next[addr] = `=${formula.slice(9, -3)}`
    changes.push({ address: addr, from: formula })
  }
  return { formulas: next ?? formulas, changes }
}

/**
 * 组合规范化：数据取整 + 公式包裹（与前端 normalizeFabricMeters 同口径）
 * 返回新数据与变更明细；无变更时原样返回（引用不变）
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

/**
 * 记录布料米数取整审计日志（原值 → 取整值），审计失败不阻断主流程
 */
export async function logFabricMetersCeil(params: {
  entityType: string
  entityId: string
  entityName: string
  operator: string
  ceilChanges: FabricMetersChange[]
  formulaChanges: { address: string; from: string }[]
}): Promise<void> {
  const parts: string[] = []
  for (const c of params.ceilChanges) parts.push(`${c.address} ${c.from}→${c.to}`)
  for (const c of params.formulaChanges) parts.push(`${c.address} 公式包裹CEILING`)
  if (parts.length === 0) return
  const detail = parts.join('；')
  await logOperation({
    operationType: FABRIC_METERS_CEIL_OPERATION,
    entityType: params.entityType,
    entityId: params.entityId,
    entityName: `${params.entityName}（布料米数向上取整：${detail}）`.slice(0, AUDIT_NAME_MAX),
    operator: params.operator,
    result: 'success',
  })
}
