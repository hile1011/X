/**
 * 在线表格布局配置（v34）：校验与规范化服务
 *
 * 用途：quotes / sheet_templates 的 columnWidthConfig / rowHeightConfig 字段
 * （LONGTEXT JSON，VTable 结构 [{key:行/列号, width/height:px}]，仅记录用户拖拽调整过的行列）
 * 在入库前做服务端校验兜底——前端正常收集的数据天然合法，此层防御 API 直接调用时的脏数据。
 *
 * 校验规则（与前端 src/utils/sheetLayout.ts 同口径，勿单边修改）：
 *   - 入参 undefined → 返回 undefined（局部更新不触碰已存布局）
 *   - 非数组 → 返回 []（视为清空布局）
 *   - 条目 key 必须为 >= 0 的整数且 < 10000（防御异常行/列号）
 *   - 条目尺寸（width/height）必须为正有限数且 <= 2000（px 上限，防御异常拖拽值）
 *   - 不合规条目直接丢弃，不阻断保存
 */

/** 行列尺寸配置条目（VTable-Sheet 原生格式） */
export interface LayoutSizeConfig {
  /** 行号或列号（0-based） */
  key: number
  /** 列宽（px，columnWidthConfig 用） */
  width?: number
  /** 行高（px，rowHeightConfig 用） */
  height?: number
}

/** key 上限（行/列号最大值，正常表格远达不到，仅防御异常值） */
const MAX_KEY = 9999
/** 尺寸上限（px，VTable 单列/单行拖拽不会超过，仅防御异常值） */
const MAX_SIZE = 2000

/**
 * 校验并规范化布局配置
 * @param value 请求体中的 columnWidthConfig / rowHeightConfig 原始值
 * @param sizeKey 'width'（列宽）或 'height'（行高）
 * @returns undefined = 未传（保持原值）；数组 = 合法化后的配置（可能为空 = 清空）
 */
export function sanitizeSheetLayoutConfig(
  value: unknown,
  sizeKey: 'width' | 'height',
): LayoutSizeConfig[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return []

  const result: LayoutSizeConfig[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const key = (item as any).key
    const size = (item as any)[sizeKey]
    // key：非负整数且在界内
    if (typeof key !== 'number' || !Number.isInteger(key) || key < 0 || key > MAX_KEY) continue
    // 尺寸：正有限数且在界内
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > MAX_SIZE) continue
    result.push(sizeKey === 'width' ? { key, width: size } : { key, height: size })
  }
  return result
}

/**
 * 从订单/模板保存请求体中提取并校验布局字段
 * @returns 字段集（仅在请求体包含对应字段时返回键，便于与展开的 body 合并实现局部更新）
 */
export function sanitizeSheetLayoutFields(body: any): Record<string, LayoutSizeConfig[]> {
  const fields: Record<string, LayoutSizeConfig[]> = {}
  const widths = sanitizeSheetLayoutConfig(body?.columnWidthConfig, 'width')
  if (widths !== undefined) fields.columnWidthConfig = widths
  const heights = sanitizeSheetLayoutConfig(body?.rowHeightConfig, 'height')
  if (heights !== undefined) fields.rowHeightConfig = heights
  return fields
}
