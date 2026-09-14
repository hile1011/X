/**
 * 布料米数向上取整服务 单元测试（前后端双实现）
 *
 * 测试目标：
 *   - src/services/fabricMeters.ts（前端：展示/保存/打印/导出共用口径）
 *   - api/services/fabricMeters.ts（后端：入库兜底 + 审计日志）
 *
 * 覆盖范围（对应需求 6 测试验证要求）：
 *   - 整数输入：0, 1, 5, 10, 100
 *   - 小数输入：0.1, 0.5, 0.999, 1.0, 1.0001, 9.999
 *   - 边界值：-1.1, -0.1, -1.0, -0.0, Number.MAX_SAFE_INTEGER 附近
 *   - 异常值：NaN, ±Infinity, 字符串数字, null, undefined
 *   - 列定位 / 数据取整 / 公式包裹 / 组合规范化 / 逆运算
 *   - 前后端算法一致性（相同输入必须产生完全相同的输出）
 */
import { describe, it, expect } from 'vitest'
import {
  ceilFabricMeters as ceilFE,
  findFabricMetersCol as findColFE,
  applyFabricMetersCeil as applyFE,
  wrapFabricMetersFormulas as wrapFE,
  unwrapFabricMetersFormulas as unwrapFE,
  normalizeFabricMeters as normalizeFE,
  FABRIC_METERS_DEFAULT_COL,
} from '../../src/services/fabricMeters'
import {
  ceilFabricMeters as ceilBE,
  findFabricMetersCol as findColBE,
  applyFabricMetersCeil as applyBE,
  wrapFabricMetersFormulas as wrapBE,
  unwrapFabricMetersFormulas as unwrapBE,
  normalizeFabricMeters as normalizeBE,
  parseColFromAddress,
  FABRIC_METERS_DEFAULT_COL as BE_DEFAULT_COL,
} from '../../api/services/fabricMeters.js'

/** 标准表头（布料米数固定 M 列，0-based col=12，与内置模板一致） */
const HEADER = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
]

/** 构造测试表格：表头 + 数据行（meters 为布料米数列值，其余列固定） */
function makeTable(meters: (string | number | null)[]): (string | number | null)[][] {
  const rows = HEADER.map((r) => [...r])
  meters.forEach((m, i) => {
    const row: (string | number | null)[] = [`行${i + 1}`, 100, 38, 40, 0, null, null, 41, 90, 154, 280, 31, m, 3.75, 907, 123]
    rows.push(row)
  })
  return rows
}

// ============================================================
// ceilFabricMeters：取整规则（标准数学向上取整）
// ============================================================
describe('ceilFabricMeters 取整规则', () => {
  describe('整数输入（原样返回）', () => {
    it.each([0, 1, 5, 10, 100, 2160])('%s → %s', (v) => {
      expect(ceilFE(v)).toBe(v)
      expect(ceilBE(v)).toBe(v)
    })
  })

  describe('正小数输入（小数部分无论多少均进位）', () => {
    it.each([
      [0.1, 1], [0.5, 1], [0.999, 1],
      [1.0, 1], [1.0001, 2], [1.1, 2], [1.9, 2], [9.999, 10],
      [403.2, 404], [25.6667, 26],
    ])('%s → %s', (input, expected) => {
      expect(ceilFE(input)).toBe(expected)
      expect(ceilBE(input)).toBe(expected)
    })
  })

  describe('负数输入（按绝对值向上取整后保持负号）', () => {
    it.each([
      [-1.1, -2], [-0.1, -1], [-1.0, -1], [-1.9, -2], [-0.0001, -1],
    ])('%s → %s', (input, expected) => {
      expect(ceilFE(input)).toBe(expected)
      expect(ceilBE(input)).toBe(expected)
    })
  })

  describe('异常值输入（非有限数字原样返回）', () => {
    it('NaN / Infinity / -Infinity 原样返回', () => {
      expect(ceilFE(NaN)).toBeNaN()
      expect(ceilBE(NaN)).toBeNaN()
      expect(ceilFE(Infinity)).toBe(Infinity)
      expect(ceilBE(Infinity)).toBe(Infinity)
      expect(ceilFE(-Infinity)).toBe(-Infinity)
      expect(ceilBE(-Infinity)).toBe(-Infinity)
    })

    it('字符串 / null / undefined 原样返回（由调用方决定处理方式）', () => {
      expect(ceilFE('3.5')).toBe('3.5')
      expect(ceilBE('3.5')).toBe('3.5')
      expect(ceilFE(null)).toBe(null)
      expect(ceilBE(null)).toBe(null)
      expect(ceilFE(undefined)).toBe(undefined)
      expect(ceilBE(undefined)).toBe(undefined)
    })
  })

  describe('大数值边界', () => {
    it('大数值小数部分仍进位且不丢精度', () => {
      const big = 1e15 + 0.3
      expect(ceilFE(big)).toBe(1e15 + 1)
      expect(ceilBE(big)).toBe(1e15 + 1)
      expect(ceilFE(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
      expect(ceilBE(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    })
  })
})

// ============================================================
// findFabricMetersCol：布料米数列定位
// ============================================================
describe('findFabricMetersCol 列定位', () => {
  it('标准表头（首行含「布料米数(M)」）→ 12', () => {
    const data = makeTable([1.5])
    expect(findColFE(data)).toBe(12)
    expect(findColBE(data)).toBe(12)
  })

  it('表头关键字在不同列位置也能命中', () => {
    const data = [[null, '布料米数', '其他'], [null, 1.2, 'x']]
    expect(findColFE(data)).toBe(1)
    expect(findColBE(data)).toBe(1)
  })

  it('表头在前 5 行内即可命中（兼容多行表头）', () => {
    const data = [
      [null, null, null],
      [null, null, null],
      [null, '布料米数', null],
      [null, 5, null],
    ]
    expect(findColFE(data)).toBe(1)
    expect(findColBE(data)).toBe(1)
  })

  it('关键字仅出现在第 6 行之后（数据区）→ 回退默认列 12', () => {
    // 表头 + 5 行数据（前 5 行无关键字），第 7 行出现「布料米数」文本
    const data = [
      ...makeTable([1, 2, 3, 4, 5]),
      [null, null, '布料米数'],
    ]
    expect(data.length).toBeGreaterThanOrEqual(7)
    expect(findColFE(data)).toBe(FABRIC_METERS_DEFAULT_COL)
    expect(findColBE(data)).toBe(FABRIC_METERS_DEFAULT_COL)
  })

  it('无表头 / 非数组输入 → 回退默认列 12', () => {
    expect(findColFE(null)).toBe(12)
    expect(findColBE(null)).toBe(12)
    expect(findColFE('not-array')).toBe(12)
    expect(findColBE('not-array')).toBe(12)
    expect(findColFE([[1, 2], [3, 4]])).toBe(12)
    expect(findColBE([[1, 2], [3, 4]])).toBe(12)
  })

  it('前后端默认列一致（12）', () => {
    expect(FABRIC_METERS_DEFAULT_COL).toBe(BE_DEFAULT_COL)
    expect(FABRIC_METERS_DEFAULT_COL).toBe(12)
  })
})

// ============================================================
// applyFabricMetersCeil：数据取整
// ============================================================
describe('applyFabricMetersCeil 数据取整', () => {
  it('布料米数列小数全部取整，其他列不受影响', () => {
    const table = makeTable([1.2, 3, 9.999, null, 'x'])
    const fe = applyFE(table)
    expect(fe.data[1][12]).toBe(2)
    expect(fe.data[2][12]).toBe(3)      // 已是整数，值不变
    expect(fe.data[3][12]).toBe(10)
    expect(fe.data[4][12]).toBe(null)   // null 不处理
    expect(fe.data[5][12]).toBe('x')    // 文本不处理
    // 其他列不变
    expect(fe.data[1][1]).toBe(100)
    expect(fe.data[1][11]).toBe(31)
    expect(fe.data[1][13]).toBe(3.75)
  })

  it('变更明细记录 地址/行号/原值/取整值', () => {
    const table = makeTable([1.2, 3, 9.999])
    const fe = applyFE(table)
    expect(fe.changes).toHaveLength(2)
    expect(fe.changes[0]).toEqual({ address: 'M2', row: 1, from: 1.2, to: 2 })
    expect(fe.changes[1]).toEqual({ address: 'M4', row: 3, from: 9.999, to: 10 })
  })

  it('不修改原数组（返回新数组）', () => {
    const table = makeTable([1.5])
    const original = JSON.stringify(table)
    applyFE(table)
    applyBE(table)
    expect(JSON.stringify(table)).toBe(original)
    expect(table[1][12]).toBe(1.5)
  })

  it('无变更时返回原数组引用', () => {
    const table = makeTable([2, 10])
    expect(applyFE(table).data).toBe(table)
    expect(applyBE(table).data).toBe(table)
  })

  it('空数组 / 非法输入安全返回', () => {
    expect(applyFE([] as any).changes).toHaveLength(0)
    expect(applyBE(null as any).changes).toHaveLength(0)
  })
})

// ============================================================
// wrapFabricMetersFormulas / unwrap：公式包裹与还原
// ============================================================
describe('wrapFabricMetersFormulas 公式包裹', () => {
  const formulas: Record<string, string> = {
    M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
    M4: '=I4/100*2*B4/INT(J4/H4)',
    M5: '=I5/100*2*B5/INT(J5/H5)',
    N3: '=J3/(MIN(H3,I3))',   // 非米数列，不应包裹
    O3: '=M3*K3*1.5/1000',    // 非米数列
    J8: '=SUM(J6:J7)',
  }

  it('仅布料米数列公式被整体包裹 CEILING(...,1)', () => {
    const fe = wrapFE({ ...formulas }, 12)
    // M3 原公式仅内部使用 CEILING（结尾非 ,1)），整体包裹后嵌套
    expect(fe.formulas.M3).toBe('=CEILING(CEILING(B3/INT(N3),1)*MAX(H3,I3)/100,1)')
    expect(fe.formulas.M4).toBe('=CEILING(I4/100*2*B4/INT(J4/H4),1)')
    expect(fe.formulas.M5).toBe('=CEILING(I5/100*2*B5/INT(J5/H5),1)')
    expect(fe.formulas.N3).toBe('=J3/(MIN(H3,I3))')
    expect(fe.formulas.O3).toBe('=M3*K3*1.5/1000')
    expect(fe.formulas.J8).toBe('=SUM(J6:J7)')
    expect(fe.changes.map((c) => c.address).sort()).toEqual(['M3', 'M4', 'M5'])
  })

  it('已整体包裹的公式跳过（幂等，M3 内部含 CEILING 但未被整体包裹 → 会被包裹）', () => {
    const once = wrapFE({ ...formulas }, 12)
    const twice = wrapFE(once.formulas, 12)
    expect(twice.changes).toHaveLength(0)
    expect(twice.formulas).toBe(once.formulas) // 无变更返回原引用
    // M3 原公式仅内部使用 CEILING，整体包裹后为 =CEILING(CEILING(B3/INT(N3),1)*MAX(H3,I3)/100,1)
    expect(once.formulas.M3).toBe('=CEILING(CEILING(B3/INT(N3),1)*MAX(H3,I3)/100,1)')
  })

  it('非 = 开头的条目跳过', () => {
    const fe = wrapFE({ M3: '纯文本', M4: 123 } as any, 12)
    expect(fe.changes).toHaveLength(0)
  })

  it('wrap + unwrap 可逆还原原公式', () => {
    const wrapped = wrapFE({ ...formulas }, 12)
    const restored = unwrapFE(wrapped.formulas, 12)
    expect(restored.formulas.M3).toBe(formulas.M3)
    expect(restored.formulas.M4).toBe(formulas.M4)
    expect(restored.formulas.M5).toBe(formulas.M5)
    // 未包裹的公式还原后不变
    expect(restored.formulas.N3).toBe(formulas.N3)
  })
})

// ============================================================
// normalizeFabricMeters：组合规范化
// ============================================================
describe('normalizeFabricMeters 组合规范化', () => {
  it('数据取整 + 公式包裹一次完成', () => {
    const table = makeTable([1.2, 403.2])
    const formulas = { M2: '=I2/100*2*B2/INT(J2/H2)', N2: '=J2/(MIN(H2,I2))' }
    const fe = normalizeFE(table, formulas)
    expect(fe.data[1][12]).toBe(2)
    expect(fe.data[2][12]).toBe(404)
    expect(fe.formulas!.M2).toBe('=CEILING(I2/100*2*B2/INT(J2/H2),1)')
    expect(fe.formulas!.N2).toBe('=J2/(MIN(H2,I2))')
    expect(fe.ceilChanges).toHaveLength(2)
    expect(fe.formulaChanges).toHaveLength(1)
  })

  it('formulas 缺省时仅做数据取整', () => {
    const table = makeTable([1.2])
    const fe = normalizeFE(table)
    expect(fe.data[1][12]).toBe(2)
    expect(fe.formulas).toBeUndefined()
    expect(fe.formulaChanges).toHaveLength(0)
  })

  it('幂等：已规范化的数据再跑一次无变更', () => {
    const table = makeTable([1.2])
    const first = normalizeFE(table, { M2: '=I2/100*2*B2/INT(J2/H2)' })
    const second = normalizeFE(first.data, first.formulas)
    expect(second.ceilChanges).toHaveLength(0)
    expect(second.formulaChanges).toHaveLength(0)
    expect(second.data).toBe(first.data) // 引用不变
  })
})

// ============================================================
// 后端特有：parseColFromAddress
// ============================================================
describe('parseColFromAddress 地址解析（后端）', () => {
  it.each([
    ['A1', 0], ['M3', 12], ['Z1', 25], ['AA1', 26], ['AM1', 38],
  ])('%s → col %s', (addr, expected) => {
    expect(parseColFromAddress(addr)).toBe(expected)
  })

  it('无效地址返回 -1', () => {
    expect(parseColFromAddress('abc')).toBe(-1)
    expect(parseColFromAddress('')).toBe(-1)
    expect(parseColFromAddress('3M')).toBe(-1)
  })
})

// ============================================================
// 前后端一致性（需求 5：前后端必须使用完全一致的算法）
// ============================================================
describe('前后端算法一致性', () => {
  const SAMPLE_VALUES: (string | number | null)[] = [
    0, 1, 5, 10, 100, 0.1, 0.5, 0.999, 1.0, 1.0001, 9.999, 403.2, 25.6667,
    -1.1, -0.1, -1.0, NaN, Infinity, null, '文本', '',
  ]

  it('ceilFabricMeters：相同输入产生完全相同的输出', () => {
    for (const v of SAMPLE_VALUES) {
      expect(ceilFE(v)).toEqual(ceilBE(v))
    }
  })

  it('applyFabricMetersCeil：取整数据与变更明细逐项一致', () => {
    const fe = applyFE(makeTable(SAMPLE_VALUES))
    const be = applyBE(makeTable(SAMPLE_VALUES))
    expect(be.data).toEqual(fe.data)
    expect(be.changes).toEqual(fe.changes)
  })

  it('wrapFabricMetersFormulas：包裹结果与变更明细逐项一致', () => {
    const formulas = {
      M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
      M4: '=I4/100*2*B4/INT(J4/H4)',
      N3: '=J3/(MIN(H3,I3))',
      M5: '=CEILING(I5/100*2*B5/INT(J5/H5),1)',
    }
    const fe = wrapFE({ ...formulas }, 12)
    const be = wrapBE({ ...formulas }, 12)
    expect(be.formulas).toEqual(fe.formulas)
    expect(be.changes).toEqual(fe.changes)
  })

  it('normalizeFabricMeters：组合规范化结果完全一致', () => {
    const formulas = { M2: '=I2/100*2*B2/INT(J2/H2)', M3: '=I3/100*2*B3/INT(J3/H3)', N2: '=J2/(MIN(H2,I2))' }
    const fe = normalizeFE(makeTable(SAMPLE_VALUES), { ...formulas })
    const be = normalizeBE(makeTable(SAMPLE_VALUES), { ...formulas })
    expect(be.data).toEqual(fe.data)
    expect(be.formulas).toEqual(fe.formulas)
    expect(be.ceilChanges).toEqual(fe.ceilChanges)
    expect(be.formulaChanges).toEqual(fe.formulaChanges)
  })
})
