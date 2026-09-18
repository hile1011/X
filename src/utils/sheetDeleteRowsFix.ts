/**
 * VTable-Sheet 多行删除公式错乱修复
 *
 * ⚠️ VTABLE WORKAROUND — 本文件全部代码为临时修复，等 VTable 官方修复后整体移除。
 *    移除条件: @visactor/vtable 修复 ListTable.deleteRecords 中 rowIndexs 的计算时机，
 *              且 @visactor/vtable-sheet 的 WorkSheet.handleDataRecordsChanged
 *              支持非连续多行删除的公式引用调整。
 *    移除步骤: 删除本文件 → 删除 BagQuote.tsx / BagQuoteTable.tsx / SheetTemplates.tsx
 *              中的 import 和调用 → 删除测试文件 tests/sheet-delete-rows-fix.test.ts
 *
 * 问题现象：在线表格中多选行后右键「删除行」，公式计算结果异常、表格内容显示错乱；
 *           单行删除正常。
 *
 * 根因（@visactor/vtable 与 @visactor/vtable-sheet 1.26.6 两个缺陷叠加）：
 *
 *   1. vtable/es/ListTable.js deleteRecords()：
 *      先执行 listTableDeleteRecords 物理删除记录（DataSource 重建恒等索引数组
 *      [0..n-k-1]），之后才计算事件里的 rowIndexs —— 用「删除前的旧 record 索引」
 *      到「删除后的新索引数组」里反查（getTableIndex = findIndex(v => v === 旧索引)）：
 *      旧索引 ≤ n-k-1 时碰巧返回原值（恰好等于删除前视觉行号，正确）；
 *      旧索引 ≥ n-k（删除涉及尾部行，如删除自动补齐的空行区）时返回 -1。
 *
 *   2. vtable-sheet/es/core/WorkSheet.js handleDataRecordsChanged('delete')：
 *      const minIndex = Math.min(...rowIndexs)          // 尾部删除时 = -1；非连续选区时被错误坍缩
 *      formulaManager.removeRows(sheetKey, minIndex, deletedCount)
 *      把任意多行删除一律当作「从 minIndex 开始的连续 deletedCount 行」来调整公式引用。
 *
 *   后果矩阵（本项目 showHeader:false，公式行号 = 记录行号）：
 *     单行(非尾行)        → removeRows(r,1)            ✅ 正确（与用户反馈一致）
 *     单行(最后一行)      → removeRows(-1,1)           ❌ 全部公式上移 1 行
 *     连续多行(中部)      → removeRows(a,k)            ✅ 正确
 *     连续多行(含尾部)    → removeRows(-1,k)           ❌ 公式整体错位 k 行、引用大面积 #REF!
 *     非连续多选(Ctrl+选) → 区间坍缩错误 + 可能 -1     ❌
 *
 * 修复策略：覆写 WorkSheet 实例的 handleDataRecordsChanged —— 仅接管 delete 分支：
 *   - 用事件里的 recordIndexs（删除前旧索引，HistoryPlugin 撤销历史同样使用它，
 *     不受本修复影响）+ columnHeaderLevelCount 还原真实被删的视觉行号；
 *   - 先 normalizeSheetData + updateSheetData 把公式引擎数据同步为删除后的记录；
 *   - 再按行号降序逐行 removeRows(row, 1)（等价 Excel 逐行删除语义，
 *     连续/非连续/触及尾部的选区全部正确；降序保证低位行的调整不受高位行影响）。
 *   add / column 等其他分支走原有逻辑。
 *
 * 使用：
 *   const cleanup = setupDeleteRowsFix(sheet, activeWs, TableConstants.SHEET_KEY)
 *   // 组件卸载时调用 cleanup()
 */

/**
 * 覆写 WorkSheet.handleDataRecordsChanged，修复多行删除时公式引用调整错误。
 *
 * @param sheet     VTableSheet 实例（提供 formulaManager）
 * @param workSheet 活动 WorkSheet 实例（sheet.getActiveSheet()）
 * @param sheetKey  工作表标识（TableConstants.SHEET_KEY）
 * @returns cleanup 函数，恢复原始 handleDataRecordsChanged
 */
export function setupDeleteRowsFix(sheet: any, workSheet: any, sheetKey: string): () => void {
  const table = workSheet?.tableInstance
  const fm = sheet?.formulaManager
  if (!fm?.formulaEngine || !workSheet || typeof workSheet.handleDataRecordsChanged !== 'function' || !table) {
    return () => {}
  }

  const orig = workSheet.handleDataRecordsChanged.bind(workSheet)

  workSheet.handleDataRecordsChanged = (type: string, event: any) => {
    // 仅接管行删除分支；其余（add 行 / 列增删）走原逻辑
    if (
      type !== 'delete' ||
      !event ||
      !Array.isArray(event.recordIndexs) ||
      event.recordIndexs.length === 0
    ) {
      return orig(type, event)
    }

    // recordIndexs 是删除前的旧 record 索引（树形/分组表格里可能是路径数组，需过滤）
    const headerCount = table.columnHeaderLevelCount ?? 0
    const rows = Array.from(
      new Set(
        event.recordIndexs.filter(
          (idx: unknown): idx is number => typeof idx === 'number' && idx >= 0,
        ),
      ),
    ).map((recordIndex) => recordIndex + headerCount)
    if (rows.length === 0) {
      return orig(type, event)
    }

    try {
      // 1. 同步公式引擎数据为删除后的记录（与原实现一致）
      const normalized = fm.normalizeSheetData(table.records, table)
      fm.formulaEngine.updateSheetData(sheetKey, normalized)
      // 2. 按行号降序逐行调整公式引用（核心修复：不用 min+count 连续区间坍缩）
      rows.sort((a, b) => b - a)
      for (const row of rows) {
        fm.removeRows(sheetKey, row, 1)
      }
    } catch {
      // 与原实现一致：公式调整失败静默（行删除本身已完成，不影响数据）
    }
  }

  return () => {
    // 恢复原始方法（组件卸载 / HMR 场景）
    workSheet.handleDataRecordsChanged = orig
  }
}
