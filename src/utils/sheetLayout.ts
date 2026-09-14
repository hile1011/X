/**
 * 在线表格布局配置工具（v34：行列尺寸持久化）
 *
 * VTable-Sheet 原生支持：
 *   - 用户拖拽调整的行列尺寸记录在 internalProps._widthResizedColMap / _heightResizedRowMap
 *   - getOptions() 自动导出为 columnWidthConfig[{key:列号,width:px}] / rowHeightConfig[{key:行号,height:px}]
 *
 * ⚠️ 不能把这两个字段传给 VTableSheet 的 sheets 配置（ISheetDefine 虽然声明接收，
 * 但 ListTable.isAutoRowHeight 对 options.rowHeightConfig 做 truthy 判断——空数组 [] 也是
 * truthy，会使全表进入"逐行内容自适应行高"模式（BaseTable.isAutoRowHeight），导致行高
 * 参差不齐、表格错位。因此恢复布局必须走本模块的 applySheetLayout（公开 API 手动应用，
 * 不触发 isAutoRowHeight 副作用）。
 *
 * 本工具封装四件事：
 *   1. collectSheetLayout：从 VTableSheet 实例收集布局配置（仅用户调整过的行列）
 *   2. applySheetLayout：初始化后恢复布局（setColWidth/setRowHeight 公开 API）
 *   3. filterRowHeightConfigForSave：保存时与 trimTableDataForSave 联动，过滤超出数据行数的行号
 *   4. resolveActualSizes：读取表格当前实际列宽/行高（含未调整的默认值），供导出 Excel / 打印按页面所见输出
 *
 * 与后端 api/services/sheetLayout.ts 同口径校验（正有限数、key 界内），勿单边修改。
 */

/** 列宽配置条目（VTable columnWidthConfig 原生格式） */
export interface ColumnWidthConfig {
  /** 列号（0-based） */
  key: number
  /** 列宽（px） */
  width: number
}

/** 行高配置条目（VTable rowHeightConfig 原生格式） */
export interface RowHeightConfig {
  /** 行号（0-based） */
  key: number
  /** 行高（px） */
  height: number
}

/** 布局配置合法条目数（key 上限，与后端 MAX_KEY 同口径） */
const MAX_KEY = 9999
/** 尺寸上限（px，与后端 MAX_SIZE 同口径） */
const MAX_SIZE = 2000

/** 单个尺寸值是否合法：正有限数且在界内 */
function isValidSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_SIZE
}

/**
 * 从 VTableSheet 实例收集布局配置（仅用户拖拽调整过的行列）
 * 数据来源：sheet.saveToConfig().sheets 中目标 sheet 的 columnWidthConfig / rowHeightConfig
 * （saveToConfig 从 internalProps._widthResizedColMap / _heightResizedRowMap 导出运行时
 * 调整状态；getOptions() 只返回构造时的静态配置，不含运行时布局）
 * @param sheet VTableSheet 实例
 * @param sheetKey 目标 sheet 的 key（默认 sheet1）
 */
export function collectSheetLayout(
  sheet: any,
  sheetKey = 'sheet1',
): { columnWidthConfig: ColumnWidthConfig[]; rowHeightConfig: RowHeightConfig[] } {
  const empty = { columnWidthConfig: [] as ColumnWidthConfig[], rowHeightConfig: [] as RowHeightConfig[] }
  try {
    const exported = sheet?.saveToConfig?.()
    const sheets: any[] = exported?.sheets ?? []
    const target = sheets.find((s) => s?.sheetKey === sheetKey) ?? sheets[0]
    if (!target) return empty

    const widths: ColumnWidthConfig[] = []
    for (const item of (target.columnWidthConfig ?? []) as any[]) {
      if (item == null || typeof item !== 'object') continue
      const key = Number(item.key)
      if (!Number.isInteger(key) || key < 0 || key > MAX_KEY) continue
      if (!isValidSize(item.width)) continue
      widths.push({ key, width: item.width })
    }

    const heights: RowHeightConfig[] = []
    for (const item of (target.rowHeightConfig ?? []) as any[]) {
      if (item == null || typeof item !== 'object') continue
      const key = Number(item.key)
      if (!Number.isInteger(key) || key < 0 || key > MAX_KEY) continue
      if (!isValidSize(item.height)) continue
      heights.push({ key, height: item.height })
    }
    return { columnWidthConfig: widths, rowHeightConfig: heights }
  } catch {
    // 表格实例未就绪（初始化/销毁瞬间）：返回空配置，不阻断保存
    return empty
  }
}

/**
 * 初始化后恢复布局配置：通过 ListTable 公开 API setColWidth / setRowHeight 应用。
 *
 * 为什么不用 ISheetDefine 的 columnWidthConfig / rowHeightConfig 传入恢复：
 * ListTable.isAutoRowHeight 对 options.rowHeightConfig 做 truthy 判断（空数组也成立），
 * 会使全表进入逐行内容自适应行高模式导致行高错位；且 _parseColumnWidthConfigForListTable
 * 走 getColumnByKey 匹配列定义，语义脆弱。setColWidth/setRowHeight 直接写尺寸映射并标记
 * _widthResizedColMap / _heightResizedRowMap（与用户手动拖拽等效，collectSheetLayout 可完整导出），
 * 不触发 isAutoRowHeight 副作用。
 *
 * key 语义与 _widthResizedColMap / _heightResizedRowMap 一致（ListTable 实际 col/row 号），
 * 与 collectSheetLayout 导出往返一致。超界 key（复制到更小表格等场景）静默跳过。
 *
 * @param sheet VTableSheet 实例
 * @param layout 布局配置（订单自身保存的或所选模板继承的）
 * @param sheetKey 目标 sheet 的 key（默认 sheet1）
 */
export function applySheetLayout(
  sheet: any,
  layout: { columnWidthConfig?: ColumnWidthConfig[]; rowHeightConfig?: RowHeightConfig[] } | null | undefined,
  sheetKey = 'sheet1',
): void {
  try {
    if (!sheet || !layout) return
    const widths = Array.isArray(layout.columnWidthConfig) ? layout.columnWidthConfig : []
    const heights = Array.isArray(layout.rowHeightConfig) ? layout.rowHeightConfig : []
    if (widths.length === 0 && heights.length === 0) return

    const ws = sheet.getActiveSheet?.() ?? sheet.workSheetInstances?.get(sheetKey)
    const table = ws?.tableInstance
    if (!table) return

    const colCount = Number(table.colCount) || 0
    const rowCount = Number(table.rowCount) || 0
    for (const item of widths) {
      if (item == null || !isValidSize(item.width)) continue
      const key = Number(item.key)
      if (!Number.isInteger(key) || key < 0 || key >= colCount) continue
      table.setColWidth?.(key, item.width)
    }
    for (const item of heights) {
      if (item == null || !isValidSize(item.height)) continue
      const key = Number(item.key)
      if (!Number.isInteger(key) || key < 0 || key >= rowCount) continue
      table.setRowHeight?.(key, item.height)
    }
  } catch {
    // 表格实例未就绪（初始化/销毁瞬间）：跳过恢复，不阻断页面
  }
}

/**
 * 保存时过滤行高配置：与 trimTableDataForSave 联动——
 * 尾部补齐空行被裁剪后，超出保存行数的行高配置一并丢弃（该行已不存在）；
 * 用户手动增加的空白行未触发裁剪时其行高原样保留。
 * 列宽配置不过滤：列数由 SHEET_COLUMNS 固定定义（16 列），与数据裁剪无关。
 */
export function filterRowHeightConfigForSave(
  config: RowHeightConfig[],
  savedRowCount: number,
): RowHeightConfig[] {
  return config.filter((item) => item.key < savedRowCount)
}

/**
 * 读取表格当前实际列宽/行高（含未调整过的默认尺寸），供导出 Excel / 打印按页面所见输出。
 * @param activeTable VTable ListTable 实例（sheet.getActiveSheet().tableInstance）
 * @param rowCount 读取的行数（通常为裁剪后的数据行数）
 * @param colCount 读取的列数（通常为裁剪后的数据列数）
 */
export function resolveActualSizes(
  activeTable: any,
  rowCount: number,
  colCount: number,
): { columnWidths: number[]; rowHeights: number[] } {
  // 实例未就绪：返回空数组，调用方回退默认尺寸
  if (!activeTable) return { columnWidths: [], rowHeights: [] }
  const columnWidths: number[] = []
  const rowHeights: number[] = []
  try {
    for (let c = 0; c < colCount; c++) {
      const w = activeTable.getColWidth?.(c)
      columnWidths.push(typeof w === 'number' && Number.isFinite(w) && w > 0 ? Math.round(w) : 0)
    }
    for (let r = 0; r < rowCount; r++) {
      const h = activeTable.getRowHeight?.(r)
      rowHeights.push(typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.round(h) : 0)
    }
  } catch {
    // 读取过程异常（初始化/销毁瞬间）：同样返回空数组，调用方回退默认尺寸
    return { columnWidths: [], rowHeights: [] }
  }
  return { columnWidths, rowHeights }
}
