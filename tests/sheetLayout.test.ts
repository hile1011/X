/**
 * 在线表格布局工具单元测试（v34：行列尺寸持久化）
 *
 * 覆盖：
 *   1. 前端 src/utils/sheetLayout.ts
 *      - collectSheetLayout：从 VTableSheet options 收集（合法条目保留、脏条目丢弃、实例异常返回空）
 *      - filterRowHeightConfigForSave：过滤超出保存行数的行号（与 trimTableDataForSave 联动）
 *      - resolveActualSizes：读取实际列宽/行高（非法回退 0、异常返回空数组）
 *   2. 后端 api/services/sheetLayout.ts
 *      - sanitizeSheetLayoutConfig：正有限数、key 界内校验
 *      - sanitizeSheetLayoutFields：请求体提取（未传字段不产生键）
 */
import { describe, it, expect } from 'vitest'
import {
  collectSheetLayout,
  applySheetLayout,
  filterRowHeightConfigForSave,
  resolveActualSizes,
} from '../src/utils/sheetLayout'
import {
  sanitizeSheetLayoutConfig,
  sanitizeSheetLayoutFields,
} from '../api/services/sheetLayout'

/** 伪造 VTableSheet 实例（saveToConfig 导出运行时布局；getOptions 只返回静态配置） */
function fakeSheet(sheets: any[]) {
  return { saveToConfig: () => ({ sheets }) }
}

// ============================================================
// collectSheetLayout
// ============================================================
describe('collectSheetLayout 从表格实例收集布局', () => {
  it('收集合法的列宽/行高配置（仅用户调整过的行列）', () => {
    const sheet = fakeSheet([{
      sheetKey: 'sheet1',
      columnWidthConfig: [{ key: 0, width: 120 }, { key: 5, width: 88.5 }],
      rowHeightConfig: [{ key: 2, height: 60 }],
    }])
    const layout = collectSheetLayout(sheet, 'sheet1')
    expect(layout.columnWidthConfig).toEqual([{ key: 0, width: 120 }, { key: 5, width: 88.5 }])
    expect(layout.rowHeightConfig).toEqual([{ key: 2, height: 60 }])
  })

  it('丢弃脏条目：非整数 key、负数 key、越界 key、非法尺寸', () => {
    const sheet = fakeSheet([{
      sheetKey: 'sheet1',
      columnWidthConfig: [
        { key: 1.5, width: 100 },      // 非整数 key
        { key: -1, width: 100 },       // 负数 key
        { key: 10000, width: 100 },    // 越界 key（> 9999）
        { key: 2, width: 0 },          // 非正尺寸
        { key: 3, width: -50 },        // 负尺寸
        { key: 4, width: NaN },        // NaN
        { key: 5, width: 3000 },       // 越界尺寸（> 2000）
        null,                          // 非对象
        { key: 6, width: 90 },         // 合法
      ],
      rowHeightConfig: [
        { key: '2', height: 50 },      // 字符串数字 key：Number 强转后保留（VTable 序列化场景）
        { key: 7, width: 50 },         // 尺寸字段错位（height 缺失）
        { key: 'abc', height: 50 },    // 非数字字符串 key：丢弃
        { key: 8, height: 66 },        // 合法
      ],
    }])
    const layout = collectSheetLayout(sheet, 'sheet1')
    expect(layout.columnWidthConfig).toEqual([{ key: 6, width: 90 }])
    expect(layout.rowHeightConfig).toEqual([{ key: 2, height: 50 }, { key: 8, height: 66 }])
  })

  it('未配置/空配置返回空数组', () => {
    const sheet = fakeSheet([{ sheetKey: 'sheet1' }])
    const layout = collectSheetLayout(sheet, 'sheet1')
    expect(layout.columnWidthConfig).toEqual([])
    expect(layout.rowHeightConfig).toEqual([])
  })

  it('sheetKey 不匹配时回退第一个 sheet', () => {
    const sheet = fakeSheet([{
      sheetKey: 'other',
      columnWidthConfig: [{ key: 1, width: 111 }],
      rowHeightConfig: [],
    }])
    const layout = collectSheetLayout(sheet, 'sheet1')
    expect(layout.columnWidthConfig).toEqual([{ key: 1, width: 111 }])
  })

  it('实例异常（saveToConfig 抛错/null）返回空配置，不阻断保存', () => {
    expect(collectSheetLayout(null)).toEqual({ columnWidthConfig: [], rowHeightConfig: [] })
    const throwing = { saveToConfig: () => { throw new Error('not ready') } }
    expect(collectSheetLayout(throwing)).toEqual({ columnWidthConfig: [], rowHeightConfig: [] })
    expect(collectSheetLayout({} as any)).toEqual({ columnWidthConfig: [], rowHeightConfig: [] })
  })
})

// ============================================================
// applySheetLayout（初始化后恢复布局——不传 sheets 配置避免 isAutoRowHeight 副作用）
// ============================================================
describe('applySheetLayout 恢复布局', () => {
  /** 伪造 sheet：getActiveSheet 返回带 setColWidth/setRowHeight 记录器的 tableInstance */
  function fakeSheetWithTable(colCount = 16, rowCount = 20) {
    const calls: { type: 'col' | 'row'; key: number; size: number }[] = []
    const table = {
      colCount,
      rowCount,
      setColWidth: (key: number, width: number) => calls.push({ type: 'col', key, size: width }),
      setRowHeight: (key: number, height: number) => calls.push({ type: 'row', key, size: height }),
    }
    const sheet = { getActiveSheet: () => ({ tableInstance: table }) }
    return { sheet, calls }
  }

  it('通过公开 API setColWidth/setRowHeight 应用合法配置', () => {
    const { sheet, calls } = fakeSheetWithTable()
    applySheetLayout(sheet, {
      columnWidthConfig: [{ key: 2, width: 200 }, { key: 5, width: 88.5 }],
      rowHeightConfig: [{ key: 3, height: 60 }],
    })
    expect(calls).toEqual([
      { type: 'col', key: 2, size: 200 },
      { type: 'col', key: 5, size: 88.5 },
      { type: 'row', key: 3, size: 60 },
    ])
  })

  it('跳过超界 key（复制到更小表格场景）与非法尺寸', () => {
    const { sheet, calls } = fakeSheetWithTable(16, 20)
    applySheetLayout(sheet, {
      columnWidthConfig: [{ key: 16, width: 100 }, { key: -1, width: 100 }, { key: 3, width: 120 }],
      rowHeightConfig: [{ key: 20, height: 50 }, { key: 2, height: 40 }],
    })
    // col 16 越界（colCount=16，合法 0-15）；row 20 越界（rowCount=20，合法 0-19）
    expect(calls).toEqual([
      { type: 'col', key: 3, size: 120 },
      { type: 'row', key: 2, size: 40 },
    ])
  })

  it('空配置/空布局不产生任何调用', () => {
    const { sheet, calls } = fakeSheetWithTable()
    applySheetLayout(sheet, { columnWidthConfig: [], rowHeightConfig: [] })
    applySheetLayout(sheet, null)
    applySheetLayout(sheet, undefined)
    expect(calls).toEqual([])
  })

  it('实例异常静默跳过不抛错（初始化/销毁瞬间）', () => {
    expect(() => applySheetLayout(null, { columnWidthConfig: [{ key: 0, width: 100 }] })).not.toThrow()
    const throwing = { getActiveSheet: () => { throw new Error('not ready') } }
    expect(() => applySheetLayout(throwing, { rowHeightConfig: [{ key: 0, height: 50 }] })).not.toThrow()
    // tableInstance 缺失（getActiveSheet 返回空）
    expect(() => applySheetLayout({ getActiveSheet: () => ({}) } as any, { columnWidthConfig: [{ key: 0, width: 100 }] })).not.toThrow()
  })
})

// ============================================================
// filterRowHeightConfigForSave
// ============================================================
describe('filterRowHeightConfigForSave 行高与裁剪联动', () => {
  it('过滤超出保存行数的行号（尾部补齐空行被裁剪后行高一并丢弃）', () => {
    const config = [
      { key: 0, height: 40 },
      { key: 17, height: 55 },
      { key: 18, height: 60 },
      { key: 25, height: 45 },
    ]
    expect(filterRowHeightConfigForSave(config, 18)).toEqual([
      { key: 0, height: 40 },
      { key: 17, height: 55 },
    ])
  })

  it('保存行数覆盖全部行号时原样保留（用户手动增加的空白行）', () => {
    const config = [{ key: 0, height: 40 }, { key: 21, height: 50 }]
    expect(filterRowHeightConfigForSave(config, 25)).toEqual(config)
  })

  it('空配置/零行数边界', () => {
    expect(filterRowHeightConfigForSave([], 20)).toEqual([])
    expect(filterRowHeightConfigForSave([{ key: 0, height: 40 }], 0)).toEqual([])
  })
})

// ============================================================
// resolveActualSizes
// ============================================================
describe('resolveActualSizes 读取实际尺寸（导出/打印用）', () => {
  it('读取各列宽/各行高并取整', () => {
    const table = {
      getColWidth: (c: number) => [100.4, 90, 80.6][c],
      getRowHeight: (r: number) => [40, 55.5][r],
    }
    const sizes = resolveActualSizes(table, 2, 3)
    expect(sizes.columnWidths).toEqual([100, 90, 81])
    expect(sizes.rowHeights).toEqual([40, 56])
  })

  it('非法值（0/负数/NaN/undefined）回退 0，由调用方兜底默认尺寸', () => {
    const table = {
      getColWidth: (c: number) => [0, -10, NaN, undefined, 120][c] as any,
      getRowHeight: () => null,
    }
    const sizes = resolveActualSizes(table, 1, 5)
    expect(sizes.columnWidths).toEqual([0, 0, 0, 0, 120])
    expect(sizes.rowHeights).toEqual([0])
  })

  it('实例异常返回空数组（调用方回退默认尺寸）', () => {
    expect(resolveActualSizes(null, 2, 2)).toEqual({ columnWidths: [], rowHeights: [] })
    const throwing = {
      getColWidth: () => { throw new Error('not ready') },
      getRowHeight: () => { throw new Error('not ready') },
    }
    expect(resolveActualSizes(throwing, 1, 1)).toEqual({ columnWidths: [], rowHeights: [] })
  })
})

// ============================================================
// 后端 sanitizeSheetLayoutConfig / sanitizeSheetLayoutFields
// ============================================================
describe('sanitizeSheetLayoutConfig 后端校验（API 直调兜底）', () => {
  it('undefined/null 返回 undefined（保持已存值，局部更新语义）', () => {
    expect(sanitizeSheetLayoutConfig(undefined, 'width')).toBeUndefined()
    expect(sanitizeSheetLayoutConfig(null, 'height')).toBeUndefined()
  })

  it('非数组返回空数组（清空）；合法条目保留、脏条目丢弃', () => {
    expect(sanitizeSheetLayoutConfig('bad', 'width')).toEqual([])
    expect(sanitizeSheetLayoutConfig(42, 'height')).toEqual([])
    expect(sanitizeSheetLayoutConfig([
      { key: 0, width: 120 },
      { key: -1, width: 100 },
      { key: 2, width: 0 },
      { key: 10000, width: 100 },
      { key: 3, width: 90 },
    ], 'width')).toEqual([{ key: 0, width: 120 }, { key: 3, width: 90 }])
    expect(sanitizeSheetLayoutConfig([
      { key: 1, height: 66 },
      { key: 2, width: 66 },  // 字段错位丢弃
    ], 'height')).toEqual([{ key: 1, height: 66 }])
  })

  it('sanitizeSheetLayoutFields：仅在请求体包含对应字段时返回键', () => {
    expect(sanitizeSheetLayoutFields({})).toEqual({})
    expect(sanitizeSheetLayoutFields({ columnWidthConfig: [{ key: 0, width: 100 }] }))
      .toEqual({ columnWidthConfig: [{ key: 0, width: 100 }] })
    expect(sanitizeSheetLayoutFields({ rowHeightConfig: [] }))
      .toEqual({ rowHeightConfig: [] })
    // null 视为未传（保持已存值）
    expect(sanitizeSheetLayoutFields({ columnWidthConfig: null, rowHeightConfig: null })).toEqual({})
  })
})
