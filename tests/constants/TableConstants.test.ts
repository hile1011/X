/**
 * TableConstants 常量类单元测试
 *
 * 测试目标：
 *   - SHEET_KEY 值正确性
 *   - COL_WIDTHS 列宽数组正确性
 *   - getColumnCount() 列数
 *   - getColumnWidth() 按索引获取列宽
 */
import { describe, it, expect } from 'vitest'
import { TableConstants } from '../../src/constants/TableConstants'

describe('TableConstants.SHEET_KEY', () => {
  it('值为 "sheet1"', () => {
    expect(TableConstants.SHEET_KEY).toBe('sheet1')
  })
})

describe('TableConstants.COL_WIDTHS - 列宽配置', () => {
  it('包含 16 列', () => {
    expect(TableConstants.COL_WIDTHS).toHaveLength(16)
  })

  it('第一列宽度为 100', () => {
    expect(TableConstants.COL_WIDTHS[0]).toBe(100)
  })

  it('第二列宽度为 90', () => {
    expect(TableConstants.COL_WIDTHS[1]).toBe(90)
  })

  it('包含特定列宽值', () => {
    expect(TableConstants.COL_WIDTHS).toEqual([
      100, 90, 80, 80, 80, 90, 90, 90, 90, 90, 80, 120, 110, 130, 100, 120,
    ])
  })
})

describe('TableConstants.getColumnCount - 列数', () => {
  it('返回 16', () => {
    expect(TableConstants.getColumnCount()).toBe(16)
  })
})

describe('TableConstants.getColumnWidth - 按索引获取列宽', () => {
  it('索引 0 → 100', () => {
    expect(TableConstants.getColumnWidth(0)).toBe(100)
  })

  it('索引 11 → 120', () => {
    expect(TableConstants.getColumnWidth(11)).toBe(120)
  })

  it('索引 13 → 130（最大列宽）', () => {
    expect(TableConstants.getColumnWidth(13)).toBe(130)
  })

  it('越界索引返回 undefined', () => {
    expect(TableConstants.getColumnWidth(16)).toBeUndefined()
    expect(TableConstants.getColumnWidth(-1)).toBeUndefined()
  })
})
