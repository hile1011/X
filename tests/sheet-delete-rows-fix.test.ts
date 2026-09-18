/**
 * 单元测试 + 集成测试：VTable-Sheet 多行删除公式错乱修复（sheetDeleteRowsFix）
 *
 * 测试分两部分：
 *
 * 一、setupDeleteRowsFix 单元测试：mock formulaManager，验证覆写逻辑
 *    - delete 分支：先 updateSheetData 同步数据，再按行号降序逐行 removeRows
 *    - add 等其他分支走原逻辑；recordIndexs 非法时回退原逻辑；异常静默；cleanup 恢复
 *
 * 二、真实 FormulaEngine 集成测试：直接从 node_modules 导入 @visactor/vtable-sheet
 *    的公式引擎（绕过包 exports 限制的 deep import），复现库 bug 并验证修复序列：
 *    - 复现：vtable ListTable.deleteRecords 在删除后才计算 rowIndexs（旧索引在新索引
 *      数组中反查 → 尾部行返回 -1），WorkSheet 再把多行坍缩成 [min, min+count) 区间
 *    - 验证：修复序列（updateSheetData + 降序逐行 adjust）在所有场景下保持公式正确
 *
 * 场景覆盖（对应生产反馈"单行正常、多行异常"）：
 *    尾部连续多行 / 非连续多行 / 中部连续多行 / 单行中部 / 单行尾行
 */
import { describe, it, expect, vi } from 'vitest'
import { setupDeleteRowsFix } from '../src/utils/sheetDeleteRowsFix'
// deep import 真实公式引擎（包根 exports 仅暴露 VTableSheet，需绕过；
// 升级 @visactor/vtable-sheet 版本时若内部路径变化，此处需同步调整）
import { FormulaEngine } from '../node_modules/@visactor/vtable-sheet/es/formula/formula-engine.js'

// ════════════════════════════════════════════════════════════════════
// 一、setupDeleteRowsFix 单元测试（mock formulaManager）
// ════════════════════════════════════════════════════════════════════

function createMockDeps(headerCount: number = 0) {
  const updateSheetData = vi.fn()
  const removeRows = vi.fn()
  const normalizeSheetData = vi.fn(() => 'normalized-data')
  const sheet = { formulaManager: { formulaEngine: { updateSheetData }, normalizeSheetData, removeRows } }
  const table = { columnHeaderLevelCount: headerCount, records: [['r0'], ['r1']] }
  const origHandler = vi.fn()
  const workSheet = { tableInstance: table, handleDataRecordsChanged: origHandler }
  return { sheet, table, workSheet, origHandler, updateSheetData, removeRows, normalizeSheetData }
}

describe('setupDeleteRowsFix 单元测试', () => {
  it('delete 分支：先 updateSheetData 一次，再按行号降序逐行 removeRows', () => {
    const { sheet, workSheet, updateSheetData, removeRows, normalizeSheetData } = createMockDeps()
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [2, 5, 8] })

    expect(normalizeSheetData).toHaveBeenCalledTimes(1)
    expect(updateSheetData).toHaveBeenCalledTimes(1)
    expect(updateSheetData).toHaveBeenCalledWith('sheet1', 'normalized-data')
    expect(removeRows).toHaveBeenCalledTimes(3)
    // 降序：8 → 5 → 2
    expect(removeRows).toHaveBeenNthCalledWith(1, 'sheet1', 8, 1)
    expect(removeRows).toHaveBeenNthCalledWith(2, 'sheet1', 5, 1)
    expect(removeRows).toHaveBeenNthCalledWith(3, 'sheet1', 2, 1)
  })

  it('delete 分支：recordIndexs 去重后逐行调整', () => {
    const { sheet, workSheet, removeRows } = createMockDeps()
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [4, 4, 7] })
    expect(removeRows).toHaveBeenCalledTimes(2)
    expect(removeRows).toHaveBeenNthCalledWith(1, 'sheet1', 7, 1)
    expect(removeRows).toHaveBeenNthCalledWith(2, 'sheet1', 4, 1)
  })

  it('delete 分支：headerCount 偏移（showHeader 时视觉行 = recordIndex + headerCount）', () => {
    const { sheet, workSheet, removeRows } = createMockDeps(1)
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [3, 6] })
    expect(removeRows).toHaveBeenNthCalledWith(1, 'sheet1', 7, 1)
    expect(removeRows).toHaveBeenNthCalledWith(2, 'sheet1', 4, 1)
  })

  it('add 等其他分支：透传原逻辑', () => {
    const { sheet, workSheet, origHandler, removeRows } = createMockDeps()
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    const addEvent = { recordIndex: 2, recordCount: 1 }
    workSheet.handleDataRecordsChanged('add', addEvent)
    expect(origHandler).toHaveBeenCalledWith('add', addEvent)
    expect(removeRows).not.toHaveBeenCalled()
  })

  it('delete 分支：recordIndexs 为空数组时回退原逻辑', () => {
    const { sheet, workSheet, origHandler, removeRows } = createMockDeps()
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [] })
    expect(origHandler).toHaveBeenCalledWith('delete', { recordIndexs: [] })
    expect(removeRows).not.toHaveBeenCalled()
  })

  it('delete 分支：recordIndexs 全部非法（树形路径数组等）时回退原逻辑', () => {
    const { sheet, workSheet, origHandler, removeRows } = createMockDeps()
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [[0, 1], 'x', -1] })
    expect(origHandler).toHaveBeenCalled()
    expect(removeRows).not.toHaveBeenCalled()
  })

  it('delete 分支：recordIndexs 混合合法与非法值时仅取合法数字', () => {
    const { sheet, workSheet, removeRows } = createMockDeps()
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [[0, 2], 5, 'bad'] })
    expect(removeRows).toHaveBeenCalledTimes(1)
    expect(removeRows).toHaveBeenCalledWith('sheet1', 5, 1)
  })

  it('公式调整抛错时静默（不向调用方外抛，行删除已完成）', () => {
    const { sheet, workSheet, removeRows } = createMockDeps()
    removeRows.mockImplementation(() => { throw new Error('engine error') })
    setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    expect(() => workSheet.handleDataRecordsChanged('delete', { recordIndexs: [1] })).not.toThrow()
  })

  it('cleanup：恢复原始 handleDataRecordsChanged', () => {
    const { sheet, workSheet, origHandler, removeRows } = createMockDeps()
    const cleanup = setupDeleteRowsFix(sheet, workSheet, 'sheet1')

    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [1] })
    expect(removeRows).toHaveBeenCalledTimes(1)

    cleanup()
    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [1] })
    expect(origHandler).toHaveBeenCalledWith('delete', { recordIndexs: [1] })
    // cleanup 后不再走修复逻辑
    expect(removeRows).toHaveBeenCalledTimes(1)
  })

  it('参数缺失时安全返回 noop cleanup', () => {
    expect(() => setupDeleteRowsFix(null, null, 'sheet1')).not.toThrow()
    expect(() => setupDeleteRowsFix({} as any, {} as any, 'sheet1')).not.toThrow()
    // formulaManager 无 formulaEngine
    expect(() => setupDeleteRowsFix({ formulaManager: {} } as any, { handleDataRecordsChanged: vi.fn() } as any, 's')).not.toThrow()
    // workSheet 无 handleDataRecordsChanged
    expect(() => setupDeleteRowsFix({ formulaManager: { formulaEngine: {} } } as any, {} as any, 's')).not.toThrow()

    const cleanup = setupDeleteRowsFix(null, null, 'sheet1')
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })
})

// ════════════════════════════════════════════════════════════════════
// 二、真实 FormulaEngine 集成测试：复现库 bug + 验证修复序列
// ════════════════════════════════════════════════════════════════════

const SHEET_KEY = 'sheet1'
const COL_COUNT = 2
const ROW_COUNT = 10

/**
 * 构造测试网格（10 行 × 2 列，公式行号 = 记录行号，对应 showHeader:false）：
 *   row0 数量 100 / row1 单价 2 / row2 小计 =B1*B2 / row3 税率 0.1
 *   row4 总计 =B3+B4 / row5..row9 行5..行9
 */
function buildGrid(): (string | number | null)[][] {
  return [
    ['数量', 100],
    ['单价', 2],
    ['小计', '=B1*B2'],
    ['税率', 0.1],
    ['总计', '=B3+B4'],
    ['行5', 5],
    ['行6', 6],
    ['行7', 7],
    ['行8', 8],
    ['行9', 9],
  ]
}

/** 创建引擎并注册公式（复刻 FormulaManager 初始化：addSheet + setCellContent） */
function createEngine(data: (string | number | null)[][]): FormulaEngine {
  const engine = new FormulaEngine({})
  engine.addSheet(SHEET_KEY, data)
  engine.setActiveSheet(SHEET_KEY)
  // 重新写入公式以注册 formulaCells + 依赖关系
  engine.setCellContent({ sheet: SHEET_KEY, row: 2, col: 1 }, '=B1*B2')
  engine.setCellContent({ sheet: SHEET_KEY, row: 4, col: 1 }, '=B3+B4')
  return engine
}

/**
 * 复刻 vtable ListTable.deleteRecords 删除后 rowIndexs 的计算逻辑：
 * DataSource 重建恒等索引数组 [0..countAfter-1]，
 * getTableIndex(旧索引) = findIndex(v => v === 旧索引) → 旧索引 ≥ countAfter 时返回 -1。
 */
function computeLibraryRowIndexs(oldRecordIndexs: number[], countAfter: number): number[] {
  return oldRecordIndexs.map((r) => (r >= 0 && r < countAfter ? r : -1))
}

/**
 * 复刻 vtable-sheet WorkSheet.handleDataRecordsChanged('delete') 的原始（有缺陷）流程：
 * updateSheetData + removeRows(Math.min(rowIndexs), deletedCount) —— 连续区间坍缩
 */
function applyLibraryDelete(
  engine: FormulaEngine,
  dataAfter: (string | number | null)[][],
  oldRecordIndexs: number[],
): void {
  engine.updateSheetData(SHEET_KEY, dataAfter)
  const rowIndexs = computeLibraryRowIndexs(oldRecordIndexs, dataAfter.length)
  const minIndex = Math.min(...rowIndexs.flat())
  engine.adjustFormulaReferences(SHEET_KEY, 'delete', 'row', minIndex, oldRecordIndexs.length, COL_COUNT, dataAfter.length)
}

/** 修复后的流程：updateSheetData + 按行号降序逐行调整 */
function applyFixedDelete(
  engine: FormulaEngine,
  dataAfter: (string | number | null)[][],
  deletedVisualRows: number[],
): void {
  engine.updateSheetData(SHEET_KEY, dataAfter)
  for (const row of [...deletedVisualRows].sort((a, b) => b - a)) {
    engine.adjustFormulaReferences(SHEET_KEY, 'delete', 'row', row, 1, COL_COUNT, dataAfter.length)
  }
}

/** 从网格中删除指定行（模拟 listTableDeleteRecords 的物理删除） */
function removeRowsFromGrid(grid: (string | number | null)[][], rows: number[]): (string | number | null)[][] {
  return grid.filter((_, i) => !rows.includes(i))
}

const f = (row: number) => ({ sheet: SHEET_KEY, row, col: 1 })

describe('真实 FormulaEngine：库 bug 复现', () => {
  it('尾部连续多行删除（如删除补齐空行区 rows 7,8,9）：rowIndexs 全为 -1，公式全部丢失', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [7, 8, 9])

    applyLibraryDelete(engine, dataAfter, [7, 8, 9])

    // rowIndexs = [-1,-1,-1] → minIndex=-1 → 删除区间被当作 [-1,2)，全体行上移 3
    expect(computeLibraryRowIndexs([7, 8, 9], dataAfter.length)).toEqual([-1, -1, -1])
    // 小计(row2)被移到 row-1（越界键），写回时 setCellContentWithoutDependencyUpdate 抛错，
    // 异常中断迁移循环 → 总计(row4)的迁移也未执行 —— 全部公式从可见网格丢失（显示混乱）
    expect(engine.getFormulaString(f(2))).toBeNull()
    expect(engine.getFormulaString(f(4))).toBeNull()
    expect(engine.getFormulaString(f(1))).toBeNull()
    expect(engine.getFormulaString(f(0))).toBeNull()
  })

  it('非连续多行删除（Ctrl 多选 rows 1,3,5）：坍缩为连续区间，公式被误删/误移', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [1, 3, 5])

    applyLibraryDelete(engine, dataAfter, [1, 3, 5])

    // rowIndexs = [1,3,5] → minIndex=1, count=3 → 区间 [1,4) 被当作连续删除区
    // 小计(row2)落入误判区间：被"上移"到 row-1（越界抛错），总计(row4)的迁移被异常中断
    // —— 两个公式全部丢失（修复后应分别为 '=B1*#REF!'@row1、'=B2+#REF!'@row2）
    expect(engine.getFormulaString(f(2))).toBeNull()
    expect(engine.getFormulaString(f(1))).toBeNull()
  })

  it('单行删除最后一行（row 9）：getTableIndex 返回 -1，全部公式错误上移', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [9])

    applyLibraryDelete(engine, dataAfter, [9])

    expect(computeLibraryRowIndexs([9], dataAfter.length)).toEqual([-1])
    // minIndex=-1, count=1 → 区间 [-1,0)，全体行上移 1：前 9 行数据未动，公式注册整体错位一行
    expect(engine.getFormulaString(f(2))).toBeNull()
    // 小计公式从 row2 错移到 row1，引用被错误递减为 B0*B1
    expect(engine.getFormulaString(f(1))).toBe('=B0*B1')
    // 总计公式从 row4 错移到 row3，引用同样错位
    expect(engine.getFormulaString(f(4))).toBeNull()
    expect(engine.getFormulaString(f(3))).toBe('=B2+B3')
  })

  it('中部连续多行（rows 6,7）与单行中部（row 3）：旧索引碰巧查得到，库流程正确（回归对照）', () => {
    // 该两个场景是"单行删除正常"的原因：旧索引 < 删除后行数 → findIndex 碰巧返回原值
    const engineA = createEngine(buildGrid())
    applyLibraryDelete(engineA, removeRowsFromGrid(buildGrid(), [6, 7]), [6, 7])
    expect(computeLibraryRowIndexs([6, 7], 8)).toEqual([6, 7])
    expect(engineA.getFormulaString(f(2))).toBe('=B1*B2')
    expect(engineA.getFormulaString(f(4))).toBe('=B3+B4')

    const engineB = createEngine(buildGrid())
    applyLibraryDelete(engineB, removeRowsFromGrid(buildGrid(), [3]), [3])
    // 单行 row3：总计公式正确上移到 row3，被删行引用正确变 #REF!
    expect(engineB.getFormulaString(f(3))).toBe('=B3+#REF!')
  })
})

describe('真实 FormulaEngine：修复序列验证', () => {
  it('尾部连续多行删除（rows 7,8,9）：公式保持原位、引用与计算值不变', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [7, 8, 9])

    applyFixedDelete(engine, dataAfter, [7, 8, 9])

    expect(engine.getFormulaString(f(2))).toBe('=B1*B2')
    expect(engine.getFormulaString(f(4))).toBe('=B3+B4')
    expect(engine.getCellValue(f(2)).value).toBe(200)
    expect(engine.getCellValue(f(4)).value).toBeCloseTo(200.1, 6)
  })

  it('非连续多行删除（rows 1,3,5）：公式按实际删除行正确迁移', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [1, 3, 5])
    // 删除后：row0 数量 / row1 小计 / row2 总计 / row3 行6 ...

    applyFixedDelete(engine, dataAfter, [1, 3, 5])

    // 小计从 row2 → row1（其上删除了 row1）；引用 B1（row0 未删）保持，B2（row1 已删）→ #REF!
    expect(engine.getFormulaString(f(1))).toBe('=B1*#REF!')
    // 总计从 row4 → row2（其上删除了 row1、row3）；B3（旧row2→新row1，1-based B2）迁移，B4（row3 已删）→ #REF!
    expect(engine.getFormulaString(f(2))).toBe('=B2+#REF!')
  })

  it('中部连续多行删除（rows 6,7）：与库原流程结果一致（回归保护）', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [6, 7])

    applyFixedDelete(engine, dataAfter, [6, 7])

    expect(engine.getFormulaString(f(2))).toBe('=B1*B2')
    expect(engine.getFormulaString(f(4))).toBe('=B3+B4')
    expect(engine.getCellValue(f(2)).value).toBe(200)
    expect(engine.getCellValue(f(4)).value).toBeCloseTo(200.1, 6)
  })

  it('单行删除中部（row 3）：与库原流程结果一致（单行场景不劣化）', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [3])

    applyFixedDelete(engine, dataAfter, [3])

    expect(engine.getFormulaString(f(3))).toBe('=B3+#REF!')
    expect(engine.getFormulaString(f(2))).toBe('=B1*B2')
  })

  it('单行删除最后一行（row 9）：公式保持原位（库流程会错误上移）', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [9])

    applyFixedDelete(engine, dataAfter, [9])

    expect(engine.getFormulaString(f(2))).toBe('=B1*B2')
    expect(engine.getFormulaString(f(4))).toBe('=B3+B4')
    expect(engine.getCellValue(f(2)).value).toBe(200)
  })

  it('删除含公式的行（rows 2,4）：公式随行删除，不再残留', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [2, 4])

    applyFixedDelete(engine, dataAfter, [2, 4])

    expect(engine.getFormulaString(f(2))).toBeNull()
    expect(engine.getFormulaString(f(4))).toBeNull()
    expect(engine.getFormulaString(f(1))).toBeNull()
  })

  it('连续多行含公式与数据混合（rows 3,4）：仅上方引用被删行的公式变 #REF!', () => {
    const engine = createEngine(buildGrid())
    const dataAfter = removeRowsFromGrid(buildGrid(), [3, 4])
    // 删除后：row0 数量 / row1 单价 / row2 小计 / row3 行5 ...

    applyFixedDelete(engine, dataAfter, [3, 4])

    // 小计引用 B1/B2 均未删，保持原样
    expect(engine.getFormulaString(f(2))).toBe('=B1*B2')
    expect(engine.getCellValue(f(2)).value).toBe(200)
    // 总计公式随 row4 删除而消失
    expect(engine.getFormulaString(f(4))).toBeNull()
    expect(engine.getFormulaString(f(3))).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════
// 三、setupDeleteRowsFix 与真实 FormulaEngine 的组合验证
//     （覆写逻辑驱动真实公式管理器，端到端验证调用序列产生正确结果）
// ════════════════════════════════════════════════════════════════════

describe('setupDeleteRowsFix × 真实公式栈（端到端）', () => {
  /**
   * 用真实 FormulaEngine + 轻量 FormulaManager 代理构造可运行的 sheet：
   * normalizeSheetData → 深拷贝纯值网格（公式单元格取计算值）
   * removeRows → 复刻 FormulaManager.removeRows（adjust + 无需写回表格）
   */
  function createRealStack(grid: (string | number | null)[][]) {
    const engine = createEngine(grid)
    const activeSheetData = () => grid
    const fm = {
      formulaEngine: engine,
      normalizeSheetData: (records: any) => JSON.parse(JSON.stringify(records)),
      removeRows: (sheetKey: string, rowIndex: number, numberOfRows: number) => {
        engine.adjustFormulaReferences(
          sheetKey, 'delete', 'row', rowIndex, numberOfRows,
          COL_COUNT, activeSheetData().length,
        )
      },
    }
    const workSheet: any = {
      tableInstance: { columnHeaderLevelCount: 0, records: activeSheetData() },
      handleDataRecordsChanged(type: string, event: any) {
        // 原始（有缺陷）实现：min+count 连续区间坍缩
        if (type === 'delete' && event?.rowIndexs?.length > 0) {
          const normalized = fm.normalizeSheetData(workSheet.tableInstance.records)
          engine.updateSheetData(sheetKey0, normalized)
          const minIndex = Math.min(...event.rowIndexs.flat())
          engine.adjustFormulaReferences(sheetKey0, 'delete', 'row', minIndex, event.deletedCount, COL_COUNT, workSheet.tableInstance.records.length)
        }
      },
    }
    const sheetKey0 = SHEET_KEY
    const sheet = { formulaManager: fm }
    return { sheet, workSheet, engine, grid }
  }

  it('端到端：覆写后多行删除（尾部 rows 7,8,9）公式保持正确', () => {
    const { sheet, workSheet, engine, grid } = createRealStack(buildGrid())

    // 安装修复
    setupDeleteRowsFix(sheet, workSheet, SHEET_KEY)

    // 模拟删除：物理移除记录后触发 delete 事件（recordIndexs = 删除前旧索引）
    const removed = removeRowsFromGrid(grid, [7, 8, 9])
    grid.length = 0
    removed.forEach((r) => grid.push(r))
    workSheet.tableInstance.records = grid
    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [7, 8, 9], rowIndexs: [-1, -1, -1], deletedCount: 3 })

    expect(engine.getFormulaString(f(2))).toBe('=B1*B2')
    expect(engine.getFormulaString(f(4))).toBe('=B3+B4')
    expect(engine.getCellValue(f(2)).value).toBe(200)
    expect(engine.getCellValue(f(4)).value).toBeCloseTo(200.1, 6)
  })

  it('端到端：覆写后非连续删除（rows 1,3,5）公式正确迁移', () => {
    const { sheet, workSheet, engine, grid } = createRealStack(buildGrid())
    setupDeleteRowsFix(sheet, workSheet, SHEET_KEY)

    const removed = removeRowsFromGrid(grid, [1, 3, 5])
    grid.length = 0
    removed.forEach((r) => grid.push(r))
    workSheet.tableInstance.records = grid
    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [1, 3, 5], rowIndexs: [1, 3, 5], deletedCount: 3 })

    expect(engine.getFormulaString(f(1))).toBe('=B1*#REF!')
    expect(engine.getFormulaString(f(2))).toBe('=B2+#REF!')
  })

  it('端到端：cleanup 后恢复原有缺陷行为（验证覆写确实被移除）', () => {
    const { sheet, workSheet, engine, grid } = createRealStack(buildGrid())
    const cleanup = setupDeleteRowsFix(sheet, workSheet, SHEET_KEY)
    cleanup()

    const removed = removeRowsFromGrid(grid, [7, 8, 9])
    grid.length = 0
    removed.forEach((r) => grid.push(r))
    workSheet.tableInstance.records = grid
    workSheet.handleDataRecordsChanged('delete', { recordIndexs: [7, 8, 9], rowIndexs: [-1, -1, -1], deletedCount: 3 })

    // 恢复原始缺陷行为：公式错乱
    expect(engine.getFormulaString(f(2))).toBeNull()
  })
})
