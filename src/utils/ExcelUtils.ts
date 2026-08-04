/**
 * Excel 地址工具类
 *
 * 设计思路：
 *   - 将原 BagQuote.tsx 中未导出的 parseExcelAddress / toExcelAddress 封装为独立工具类
 *   - 使其可被组件和测试文件共享，消除 tests/utils.test.ts 中的重复实现
 *
 * 地址规则（0-based）：
 *   列字母：A=0, B=1, ..., Z=25, AA=26, AB=27, ...
 *   行数字：1→0, 2→1, ...
 *   示例："J8" → { row: 7, col: 9 }
 */

export interface CellAddress {
  row: number
  col: number
}

export class ExcelUtils {
  /**
   * 解析 Excel 单元格地址（如 "J8"、"AA12"）为 0-based 的 { row, col }
   * 无效地址返回 { row: -1, col: -1 }
   */
  static parseAddress(addr: string): CellAddress {
    const match = addr.match(/^([A-Z]+)(\d+)$/)
    if (!match) return { row: -1, col: -1 }
    let col = 0
    for (let i = 0; i < match[1].length; i++) {
      col = col * 26 + (match[1].charCodeAt(i) - 64)
    }
    return { row: parseInt(match[2], 10) - 1, col: col - 1 }
  }

  /**
   * 将 0-based { row, col } 转为 Excel 单元格地址（如 "J8"）
   * 是 parseAddress 的逆运算
   */
  static toAddress(row: number, col: number): string {
    let c = col + 1
    let letters = ''
    while (c > 0) {
      const rem = (c - 1) % 26
      letters = String.fromCharCode(65 + rem) + letters
      c = Math.floor((c - 1) / 26)
    }
    return `${letters}${row + 1}`
  }
}
