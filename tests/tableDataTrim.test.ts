/**
 * 表格数据尾部空区裁剪 单元测试
 * 测试目标：src/pages/BagQuote.tsx 导出的 trimTrailingEmptyRowsAndCols
 *
 * 背景（2026-09-14 生产反馈）：VTable-Sheet 会把加载的数据自动补齐到默认
 * 100 行 × 100 列（类似 Excel 的空白区域）。保存/导出按 rowCount 全量收集时，
 * 用户删除底部无用行后保存的数据会被空区重新膨胀——表现为"删除行无效"。
 * 裁剪函数从尾部去掉全空行/空列，中间的空行/空列保留（行结构与公式不受影响）。
 */
import { describe, it, expect } from 'vitest'
import { trimTrailingEmptyRowsAndCols, trimTableDataForSave } from '../src/pages/BagQuote'

/** 构造 VTable 补齐后的数据：有效行 + 尾部全 null 行 */
function padded(rows: (string | number | null)[][]): (string | number | null)[][] {
  return [...rows, ...Array.from({ length: 100 - rows.length }, () =>
    Array.from({ length: 100 }, () => null),
  )]
}

describe('trimTrailingEmptyRowsAndCols - 尾部空行裁剪', () => {
  it('事故场景：31 行有效数据 + VTable 补齐到 100 行 → 裁剪回 31 行', () => {
    const valid = Array.from({ length: 31 }, (_, r) =>
      Array.from({ length: 100 }, (_, c) => (c === 0 ? `行${r}` : c < 16 ? r * c : null)),
    )
    const result = trimTrailingEmptyRowsAndCols(padded(valid))
    expect(result.length).toBe(31)
    // 列也被裁剪到有效列（16 列，索引 0-15）
    expect(result[0].length).toBe(16)
  })

  it('全空数据 → 空数组', () => {
    expect(trimTrailingEmptyRowsAndCols(padded([]))).toEqual([])
  })

  it('中间空行保留，仅裁尾部', () => {
    const data: (string | number | null)[][] = [
      ['成品', 1],
      [null, null],
      ['底部', 2],
      [null, null],
      [null, null],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result.length).toBe(3) // 第 2 行（中间空行）保留，尾部 2 行空行裁掉
    expect(result[1]).toEqual([null, null])
  })

  it('尾部空行的列已裁剪时行保留正确', () => {
    const data: (string | number | null)[][] = [
      ['A', null, null],
      [null, null, null],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result).toEqual([['A']])
  })
})

describe('trimTrailingEmptyRowsAndCols - 尾部空列裁剪', () => {
  it('每行右侧的补齐 null 列被裁掉（100 列 → 16 列）', () => {
    const data: (string | number | null)[][] = [
      Array.from({ length: 100 }, (_, c) => (c < 16 ? `v${c}` : null)),
      Array.from({ length: 100 }, (_, c) => (c < 16 ? c : null)),
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result[0].length).toBe(16)
    expect(result[1].length).toBe(16)
    expect(result[0][15]).toBe('v15')
    expect(result[1][15]).toBe(15)
  })

  it('不同行有效列数不同时取最大值', () => {
    const data: (string | number | null)[][] = [
      ['A', 'B', null, null],
      ['C', 'D', 'E', null],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    // 第二行有效到第 2 列（索引2），第一行也裁到 3 列宽（最大有效列）
    expect(result).toEqual([
      ['A', 'B', null],
      ['C', 'D', 'E'],
    ])
  })

  it('空字符串视为空单元格参与裁剪', () => {
    const data: (string | number | null)[][] = [
      ['A', '', null],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result).toEqual([['A']])
  })

  it('数值 0 是有效数据不参与裁剪', () => {
    const data: (string | number | null)[][] = [
      ['A', 0, null, null],
      ['B', 0, 0, null],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result).toEqual([
      ['A', 0, null],
      ['B', 0, 0],
    ])
  })
})

describe('trimTrailingEmptyRowsAndCols - 不可变性与边界', () => {
  it('返回新数组，不修改入参', () => {
    const data: (string | number | null)[][] = [
      ['A', null],
      [null, null],
    ]
    const snapshot = JSON.stringify(data)
    trimTrailingEmptyRowsAndCols(data)
    expect(JSON.stringify(data)).toBe(snapshot)
  })

  it('短划线/空格等字符串值是有效数据（不裁剪）', () => {
    const data: (string | number | null)[][] = [
      ['-', ' '],
      ['-', null],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result.length).toBe(2)
    expect(result[0]).toEqual(['-', ' '])
  })

  it('数据本身无空区时原样返回（等值）', () => {
    const data: (string | number | null)[][] = [
      ['成品', '宽', '高'],
      ['袋1', 35, 45],
    ]
    const result = trimTrailingEmptyRowsAndCols(data)
    expect(result).toEqual(data)
  })
})

describe('trimTableDataForSave - 保存前裁剪策略（空白行去留由用户操作决定）', () => {
  /**
   * 2026-09-14 需求：仅新建场景（初始化补齐到 20 行，当日默认值由 25 调整为 20）
   * 且用户未增加行时裁掉补齐空行；
   * 编辑已保存订单（初始化无补齐）或用户手动增加过行时原样保存——
   * 用户增加的空白行必须保留，删除的行不会被补回（VTable 删除行为物理删除）。
   */

  /** 构造含尾部空行的数据：rows 有效行 + pad 行全空行（16 列宽） */
  function withEmptyTail(rows: (string | number | null)[][], pad: number): (string | number | null)[][] {
    return [...rows, ...Array.from({ length: pad }, () =>
      Array.from({ length: 16 }, () => null),
    )]
  }

  const VALID_10: (string | number | null)[][] = Array.from({ length: 10 }, (_, r) =>
    Array.from({ length: 16 }, (_, c) => (c === 0 ? `行${r + 1}` : r)),
  )

  it('新建场景无操作：补齐的空行被裁掉（20 行 → 10 有效行）', () => {
    const data = withEmptyTail(VALID_10, 10) // 模板 10 行 + 补齐 10 空行
    const result = trimTableDataForSave(data, 20, true)
    expect(result.length).toBe(10)
  })

  it('新建场景在补齐区填了数据：裁到有效行（13 行有效）', () => {
    const data = withEmptyTail(VALID_10, 10) // 10 有效 + 10 空
    data[10] = ['新增行1', 1]
    data[11] = ['新增行2', 2]
    data[12] = ['新增行3', 3]
    const result = trimTableDataForSave(data, 20, true)
    expect(result.length).toBe(13)
  })

  it('新建场景用户增加行：不裁剪，所见即所存（28 行原样保留）', () => {
    const data = withEmptyTail(VALID_10, 18) // 10 有效 + 18 空（含用户加的 8 行）
    // 初始化配置 20 行，用户加了 8 行 → 收集 28 行 > 20 → 判定用户加过行
    const result = trimTableDataForSave(data, 20, true)
    expect(result.length).toBe(28) // 用户加行后全量保存
  })

  it('编辑场景（无补齐）：原样保存，已保存的空白行不被裁掉（核心需求）', () => {
    // 用户上次保存了 15 行（10 有效 + 5 空行），本次打开无操作直接保存
    const data = withEmptyTail(VALID_10, 5)
    const result = trimTableDataForSave(data, 15, false)
    expect(result.length).toBe(15) // 空白行保留
    expect(result[14]).toEqual(Array.from({ length: 16 }, () => null))
  })

  it('编辑场景用户增加空白行：不裁剪，原样保存（10 行 → 15 行）', () => {
    const data = withEmptyTail(VALID_10, 5) // 用户加了 5 行空白
    const result = trimTableDataForSave(data, 10, false)
    expect(result.length).toBe(15)
  })

  it('编辑场景用户删除行：物理删除后按实际行数原样保存（15 行 → 10 行）', () => {
    const deleted = VALID_10.slice(0, 10) // 用户删掉了 5 行空白
    const result = trimTableDataForSave(deleted, 15, false)
    expect(result.length).toBe(10)
  })

  it('新建场景用户删除部分补齐行后保存：裁剪剩余补齐空行', () => {
    // 初始化配置 20 行，用户删了 3 行 → 收集 17 行 ≤ 20 → 仍裁剪补齐区空行
    const data = withEmptyTail(VALID_10, 7)
    const result = trimTableDataForSave(data, 20, true)
    expect(result.length).toBe(10)
  })

  it('返回原数组引用时不裁剪场景（无数据复制开销）', () => {
    const data = withEmptyTail(VALID_10, 5)
    const result = trimTableDataForSave(data, 10, false)
    expect(result).toBe(data) // 原样返回同一引用
  })
})
