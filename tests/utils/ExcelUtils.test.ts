/**
 * ExcelUtils 工具类单元测试
 *
 * 测试目标：
 *   - parseAddress() Excel 地址 → { row, col } 解析
 *   - toAddress() { row, col } → Excel 地址 生成
 *   - 正逆运算一致性（parseAddress ∘ toAddress = identity）
 *   - 边界情况处理
 */
import { describe, it, expect } from 'vitest'
import { ExcelUtils } from '../../src/utils/ExcelUtils'

describe('ExcelUtils.parseAddress - 解析 Excel 地址', () => {
  it('A1 → { row: 0, col: 0 }', () => {
    expect(ExcelUtils.parseAddress('A1')).toEqual({ row: 0, col: 0 })
  })

  it('B1 → { row: 0, col: 1 }', () => {
    expect(ExcelUtils.parseAddress('B1')).toEqual({ row: 0, col: 1 })
  })

  it('J8 → { row: 7, col: 9 }', () => {
    expect(ExcelUtils.parseAddress('J8')).toEqual({ row: 7, col: 9 })
  })

  it('Z1 → { row: 0, col: 25 }', () => {
    expect(ExcelUtils.parseAddress('Z1')).toEqual({ row: 0, col: 25 })
  })

  it('AA1 → { row: 0, col: 26 }（双字母列）', () => {
    expect(ExcelUtils.parseAddress('AA1')).toEqual({ row: 0, col: 26 })
  })

  it('AB12 → { row: 11, col: 27 }', () => {
    expect(ExcelUtils.parseAddress('AB12')).toEqual({ row: 11, col: 27 })
  })

  it('J3 → { row: 2, col: 9 }（公式行引用）', () => {
    expect(ExcelUtils.parseAddress('J3')).toEqual({ row: 2, col: 9 })
  })

  it('P2 → { row: 1, col: 15 }', () => {
    expect(ExcelUtils.parseAddress('P2')).toEqual({ row: 1, col: 15 })
  })
})

describe('ExcelUtils.parseAddress - 无效地址', () => {
  it('空字符串返回 { row: -1, col: -1 }', () => {
    expect(ExcelUtils.parseAddress('')).toEqual({ row: -1, col: -1 })
  })

  it('纯数字返回无效', () => {
    expect(ExcelUtils.parseAddress('123')).toEqual({ row: -1, col: -1 })
  })

  it('纯字母返回无效', () => {
    expect(ExcelUtils.parseAddress('ABC')).toEqual({ row: -1, col: -1 })
  })

  it('小写字母返回无效（仅支持大写）', () => {
    expect(ExcelUtils.parseAddress('a1')).toEqual({ row: -1, col: -1 })
  })

  it('特殊字符返回无效', () => {
    expect(ExcelUtils.parseAddress('A-1')).toEqual({ row: -1, col: -1 })
    expect(ExcelUtils.parseAddress('$A$1')).toEqual({ row: -1, col: -1 })
  })
})

describe('ExcelUtils.toAddress - 生成 Excel 地址', () => {
  it('{ row: 0, col: 0 } → A1', () => {
    expect(ExcelUtils.toAddress(0, 0)).toBe('A1')
  })

  it('{ row: 0, col: 1 } → B1', () => {
    expect(ExcelUtils.toAddress(0, 1)).toBe('B1')
  })

  it('{ row: 7, col: 9 } → J8', () => {
    expect(ExcelUtils.toAddress(7, 9)).toBe('J8')
  })

  it('{ row: 0, col: 25 } → Z1', () => {
    expect(ExcelUtils.toAddress(0, 25)).toBe('Z1')
  })

  it('{ row: 0, col: 26 } → AA1（双字母列）', () => {
    expect(ExcelUtils.toAddress(0, 26)).toBe('AA1')
  })

  it('{ row: 11, col: 27 } → AB12', () => {
    expect(ExcelUtils.toAddress(11, 27)).toBe('AB12')
  })

  it('{ row: 0, col: 51 } → AZ1', () => {
    expect(ExcelUtils.toAddress(0, 51)).toBe('AZ1')
  })

  it('{ row: 0, col: 52 } → BA1', () => {
    expect(ExcelUtils.toAddress(0, 52)).toBe('BA1')
  })
})

describe('ExcelUtils - 正逆运算一致性', () => {
  it('parseAddress(toAddress(row, col)) = { row, col }', () => {
    // 测试多个坐标的正逆运算
    const testCases = [
      { row: 0, col: 0 },
      { row: 7, col: 9 },   // J8
      { row: 0, col: 25 },  // Z1
      { row: 0, col: 26 },  // AA1
      { row: 11, col: 27 }, // AB12
      { row: 99, col: 100 },
    ]
    for (const { row, col } of testCases) {
      const addr = ExcelUtils.toAddress(row, col)
      const parsed = ExcelUtils.parseAddress(addr)
      expect(parsed).toEqual({ row, col })
    }
  })

  it('toAddress(parseAddress(addr)) = addr（大写地址）', () => {
    const testCases = ['A1', 'J8', 'Z1', 'AA1', 'AB12', 'P2']
    for (const addr of testCases) {
      const parsed = ExcelUtils.parseAddress(addr)
      const regenerated = ExcelUtils.toAddress(parsed.row, parsed.col)
      expect(regenerated).toBe(addr)
    }
  })
})
