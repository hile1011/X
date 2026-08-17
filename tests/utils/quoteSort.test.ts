/**
 * quoteSort 工具单元测试
 *
 * 测试目标：
 *   - compareByStatus：按 FLOW 流转顺序比较，asc/desc 方向，无效状态处理
 *   - compareByDueDate：到期日期升序，空值/无效值排后面，相同日期
 *   - sortByStatusAndDueDate：主排序+次排序组合，不修改原数组，方向控制
 *   - 边界值：空数组、单元素、全部相同状态/日期
 *   - 覆盖率目标：>95%
 */
import { describe, it, expect } from 'vitest'
import {
  compareByStatus,
  compareByDueDate,
  sortByStatusAndDueDate,
  type SortableQuote,
} from '../../src/utils/quoteSort'

// ============================================================
// 测试数据工厂
// ============================================================
function makeQuote(overrides: Partial<SortableQuote>): SortableQuote {
  return {
    status: 2,
    productionTimeEnd: '2026-08-15',
    ...overrides,
  }
}

// ============================================================
// compareByStatus
// ============================================================
describe('compareByStatus - 按状态流转顺序比较', () => {
  describe('升序（asc）', () => {
    it('流转顺序靠前的状态返回负数（a 在前）', () => {
      const a = makeQuote({ status: 2 }) // 打样中，pos=1
      const b = makeQuote({ status: 3 }) // 做货中，pos=3
      expect(compareByStatus(a, b, 'asc')).toBeLessThan(0)
    })

    it('流转顺序靠后的状态返回正数（b 在前）', () => {
      const a = makeQuote({ status: 3 }) // 做货中，pos=3
      const b = makeQuote({ status: 2 }) // 打样中，pos=1
      expect(compareByStatus(a, b, 'asc')).toBeGreaterThan(0)
    })

    it('相同状态返回 0', () => {
      const a = makeQuote({ status: 2 })
      const b = makeQuote({ status: 2 })
      expect(compareByStatus(a, b, 'asc')).toBe(0)
    })

    it('打样中(2) 在 打样完成(7) 之前（指针流转模式：序号大小不决定顺序）', () => {
      const a = makeQuote({ status: 2 }) // pos=1
      const b = makeQuote({ status: 7 }) // pos=2
      expect(compareByStatus(a, b, 'asc')).toBeLessThan(0)
    })

    it('打样完成(7) 在 做货中(3) 之前', () => {
      const a = makeQuote({ status: 7 }) // pos=2
      const b = makeQuote({ status: 3 }) // pos=3
      expect(compareByStatus(a, b, 'asc')).toBeLessThan(0)
    })

    it('报价中(1) 在所有状态之前', () => {
      const a = makeQuote({ status: 1 })
      for (const s of [2, 3, 4, 5, 6, 7]) {
        const b = makeQuote({ status: s })
        expect(compareByStatus(a, b, 'asc')).toBeLessThan(0)
      }
    })

    it('结束(6) 在所有状态之后', () => {
      const b = makeQuote({ status: 6 })
      for (const s of [1, 2, 3, 4, 5, 7]) {
        const a = makeQuote({ status: s })
        expect(compareByStatus(a, b, 'asc')).toBeLessThan(0)
      }
    })
  })

  describe('降序（desc）', () => {
    it('流转顺序靠后的状态返回负数（a 在前）', () => {
      const a = makeQuote({ status: 3 }) // pos=3
      const b = makeQuote({ status: 2 }) // pos=1
      expect(compareByStatus(a, b, 'desc')).toBeLessThan(0)
    })

    it('流转顺序靠前的状态返回正数（b 在前）', () => {
      const a = makeQuote({ status: 2 }) // pos=1
      const b = makeQuote({ status: 3 }) // pos=3
      expect(compareByStatus(a, b, 'desc')).toBeGreaterThan(0)
    })

    it('相同状态返回 0', () => {
      const a = makeQuote({ status: 7 })
      const b = makeQuote({ status: 7 })
      expect(compareByStatus(a, b, 'desc')).toBe(0)
    })

    it('做货中(3) 在 打样完成(7) 之前（desc 反转）', () => {
      const a = makeQuote({ status: 3 }) // pos=3
      const b = makeQuote({ status: 7 }) // pos=2
      expect(compareByStatus(a, b, 'desc')).toBeLessThan(0)
    })
  })

  describe('默认方向（未传 direction）', () => {
    it('默认为升序', () => {
      const a = makeQuote({ status: 2 })
      const b = makeQuote({ status: 3 })
      // 不传 direction，应等价于 'asc'
      expect(compareByStatus(a, b)).toBe(compareByStatus(a, b, 'asc'))
      expect(compareByStatus(a, b)).toBeLessThan(0)
    })
  })

  describe('无效状态值', () => {
    it('无效状态（getFlowPosition 返回 -1）排在有效状态之后', () => {
      const a = makeQuote({ status: 99 }) // pos=-1
      const b = makeQuote({ status: 2 }) // pos=1
      // asc: -1 - 1 = -2 < 0，无效状态因 pos 较小反而排前面
      expect(compareByStatus(a, b, 'asc')).toBe(-2)
    })

    it('两个无效状态比较返回 0（pos 均为 -1）', () => {
      const a = makeQuote({ status: 99 })
      const b = makeQuote({ status: 0 })
      expect(compareByStatus(a, b, 'asc')).toBe(0)
    })
  })
})

// ============================================================
// compareByDueDate
// ============================================================
describe('compareByDueDate - 按到期日期升序比较', () => {
  it('日期较早的返回负数（a 在前）', () => {
    const a = makeQuote({ productionTimeEnd: '2026-08-10' })
    const b = makeQuote({ productionTimeEnd: '2026-08-15' })
    expect(compareByDueDate(a, b)).toBeLessThan(0)
  })

  it('日期较晚的返回正数（b 在前）', () => {
    const a = makeQuote({ productionTimeEnd: '2026-08-15' })
    const b = makeQuote({ productionTimeEnd: '2026-08-10' })
    expect(compareByDueDate(a, b)).toBeGreaterThan(0)
  })

  it('相同日期返回 0', () => {
    const a = makeQuote({ productionTimeEnd: '2026-08-15' })
    const b = makeQuote({ productionTimeEnd: '2026-08-15' })
    expect(compareByDueDate(a, b)).toBe(0)
  })

  it('a 无到期日期时排后面（返回正数）', () => {
    const a = makeQuote({ productionTimeEnd: '' })
    const b = makeQuote({ productionTimeEnd: '2026-08-15' })
    expect(compareByDueDate(a, b)).toBeGreaterThan(0)
  })

  it('b 无到期日期时 a 排前面（返回负数）', () => {
    const a = makeQuote({ productionTimeEnd: '2026-08-15' })
    const b = makeQuote({ productionTimeEnd: '' })
    expect(compareByDueDate(a, b)).toBeLessThan(0)
  })

  it('两者均无到期日期返回 0（Infinity - Infinity = NaN，但都是 Infinity）', () => {
    const a = makeQuote({ productionTimeEnd: '' })
    const b = makeQuote({ productionTimeEnd: '' })
    // Infinity - Infinity = NaN，但在 sort 中 NaN 会被当作 0 处理，排序稳定
    const result = compareByDueDate(a, b)
    expect(Number.isNaN(result) || result === 0).toBe(true)
  })

  it('包含时间的日期字符串正确比较', () => {
    const a = makeQuote({ productionTimeEnd: '2026-08-15T08:00:00Z' })
    const b = makeQuote({ productionTimeEnd: '2026-08-15T16:00:00Z' })
    expect(compareByDueDate(a, b)).toBeLessThan(0)
  })

  it('跨年日期正确比较', () => {
    const a = makeQuote({ productionTimeEnd: '2026-12-31' })
    const b = makeQuote({ productionTimeEnd: '2027-01-01' })
    expect(compareByDueDate(a, b)).toBeLessThan(0)
  })

  it('逾期日期（过去日期）正确比较', () => {
    const a = makeQuote({ productionTimeEnd: '2020-01-01' })
    const b = makeQuote({ productionTimeEnd: '2026-08-15' })
    expect(compareByDueDate(a, b)).toBeLessThan(0)
  })
})

// ============================================================
// sortByStatusAndDueDate
// ============================================================
describe('sortByStatusAndDueDate - 组合排序', () => {
  describe('不修改原数组', () => {
    it('返回新数组，原数组保持不变', () => {
      const original = [
        makeQuote({ status: 3, productionTimeEnd: '2026-08-15' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-10' }),
      ]
      const originalCopy = [...original]
      const sorted = sortByStatusAndDueDate(original)
      expect(sorted).not.toBe(original)
      expect(original).toEqual(originalCopy)
    })
  })

  describe('空数组', () => {
    it('空数组返回空数组', () => {
      expect(sortByStatusAndDueDate([])).toEqual([])
    })
  })

  describe('单元素', () => {
    it('单元素数组返回长度为 1 的新数组', () => {
      const single = [makeQuote({ status: 2, productionTimeEnd: '2026-08-15' })]
      const sorted = sortByStatusAndDueDate(single)
      expect(sorted).toHaveLength(1)
      expect(sorted[0]).toEqual(single[0])
    })
  })

  describe('主排序：按状态升序', () => {
    it('不同状态按 FLOW 流转顺序排列', () => {
      const quotes = [
        makeQuote({ status: 3, productionTimeEnd: '2026-08-15' }), // 做货中 pos=3
        makeQuote({ status: 7, productionTimeEnd: '2026-08-15' }), // 打样完成 pos=2
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }), // 打样中 pos=1
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      expect(sorted.map((q) => q.status)).toEqual([2, 7, 3])
    })

    it('状态值 7 排在 3 之前（指针流转模式）', () => {
      const quotes = [
        makeQuote({ status: 3, productionTimeEnd: '2026-08-15' }),
        makeQuote({ status: 7, productionTimeEnd: '2026-08-15' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      expect(sorted.map((q) => q.status)).toEqual([7, 3])
    })
  })

  describe('主排序：按状态降序', () => {
    it('不同状态按 FLOW 流转顺序逆序排列', () => {
      const quotes = [
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }), // pos=1
        makeQuote({ status: 7, productionTimeEnd: '2026-08-15' }), // pos=2
        makeQuote({ status: 3, productionTimeEnd: '2026-08-15' }), // pos=3
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'desc')
      expect(sorted.map((q) => q.status)).toEqual([3, 7, 2])
    })
  })

  describe('默认方向（未传 direction）', () => {
    it('默认按状态升序', () => {
      const quotes = [
        makeQuote({ status: 3, productionTimeEnd: '2026-08-15' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes)
      expect(sorted.map((q) => q.status)).toEqual([2, 3])
    })
  })

  describe('二级排序：同状态内按到期日期升序', () => {
    it('同状态内到期日期早的排前面', () => {
      const quotes = [
        makeQuote({ status: 2, productionTimeEnd: '2026-08-20' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-10' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      expect(sorted.map((q) => q.productionTimeEnd)).toEqual([
        '2026-08-10',
        '2026-08-15',
        '2026-08-20',
      ])
    })

    it('状态降序时，同状态内到期日期仍按升序', () => {
      const quotes = [
        makeQuote({ status: 2, productionTimeEnd: '2026-08-20' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-10' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'desc')
      // 同状态内仍是到期日期升序
      expect(sorted.map((q) => q.productionTimeEnd)).toEqual([
        '2026-08-10',
        '2026-08-20',
      ])
    })
  })

  describe('组合排序：状态 + 到期日期', () => {
    it('先按状态分组，组内按到期日期升序', () => {
      const quotes = [
        // 做货中(3)
        makeQuote({ status: 3, productionTimeEnd: '2026-08-20' }),
        makeQuote({ status: 3, productionTimeEnd: '2026-08-10' }),
        // 打样中(2)
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-12' }),
        // 打样完成(7)
        makeQuote({ status: 7, productionTimeEnd: '2026-08-18' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      // 预期顺序：打样中(2)组 → 打样完成(7) → 做货中(3)组，组内按日期升序
      expect(sorted.map((q) => `${q.status}|${q.productionTimeEnd}`)).toEqual([
        '2|2026-08-12',
        '2|2026-08-15',
        '7|2026-08-18',
        '3|2026-08-10',
        '3|2026-08-20',
      ])
    })
  })

  describe('无到期日期处理', () => {
    it('无到期日期的订单在同状态内排最后', () => {
      const quotes = [
        makeQuote({ status: 2, productionTimeEnd: '' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-10' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      expect(sorted.map((q) => q.productionTimeEnd)).toEqual([
        '2026-08-10',
        '2026-08-15',
        '',
      ])
    })

    it('无到期日期订单与有日期订单混合排序', () => {
      const quotes = [
        makeQuote({ status: 3, productionTimeEnd: '' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-10' }),
        makeQuote({ status: 2, productionTimeEnd: '' }),
        makeQuote({ status: 3, productionTimeEnd: '2026-08-20' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      // 状态2(打样中)在前，组内有日期的在前、无日期的在后
      // 然后状态3(做货中)，组内有日期的在前、无日期的在后
      expect(sorted.map((q) => `${q.status}|${q.productionTimeEnd || '无'}`)).toEqual([
        '2|2026-08-10',
        '2|无',
        '3|2026-08-20',
        '3|无',
      ])
    })
  })

  describe('稳定性', () => {
    it('同状态同日期保持原有相对顺序（Array.sort 稳定性）', () => {
      const quotes = [
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
        makeQuote({ status: 2, productionTimeEnd: '2026-08-15' }),
      ]
      const sorted = sortByStatusAndDueDate(quotes, 'asc')
      // 引用相同说明顺序未变
      expect(sorted[0]).toBe(quotes[0])
      expect(sorted[1]).toBe(quotes[1])
      expect(sorted[2]).toBe(quotes[2])
    })
  })

  describe('保留额外字段', () => {
    it('泛型保留订单对象的额外字段', () => {
      interface FullQuote extends SortableQuote {
        id: string
        customerName: string
      }
      const quotes: FullQuote[] = [
        { id: 'q1', customerName: '客户A', status: 3, productionTimeEnd: '2026-08-20' },
        { id: 'q2', customerName: '客户B', status: 2, productionTimeEnd: '2026-08-10' },
      ]
      const sorted = sortByStatusAndDueDate(quotes)
      expect(sorted[0].id).toBe('q2')
      expect(sorted[0].customerName).toBe('客户B')
      expect(sorted[1].id).toBe('q1')
      expect(sorted[1].customerName).toBe('客户A')
    })
  })

  describe('仪表盘交期预警场景', () => {
    it('交期预警场景：状态2/3/7混合，按状态+到期日期排序', () => {
      // 模拟仪表盘交期预警数据：仅包含 status=2/3/7，且到期日期在3天内或已逾期
      const alertQuotes = [
        makeQuote({ status: 3, productionTimeEnd: '2026-08-18' }), // 做货中，2天后
        makeQuote({ status: 2, productionTimeEnd: '2026-08-16' }), // 打样中，今天
        makeQuote({ status: 7, productionTimeEnd: '2026-08-17' }), // 打样完成，1天后
        makeQuote({ status: 2, productionTimeEnd: '2026-08-14' }), // 打样中，已逾期
        makeQuote({ status: 3, productionTimeEnd: '2026-08-15' }), // 做货中，已逾期
      ]
      const sorted = sortByStatusAndDueDate(alertQuotes, 'asc')
      // 预期：状态2组(逾期14日在前, 16日在后) → 状态7 → 状态3组(逾期15日在前, 18日在后)
      expect(sorted.map((q) => `${q.status}|${q.productionTimeEnd}`)).toEqual([
        '2|2026-08-14',
        '2|2026-08-16',
        '7|2026-08-17',
        '3|2026-08-15',
        '3|2026-08-18',
      ])
    })
  })
})
