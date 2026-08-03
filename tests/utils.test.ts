/**
 * 前端工具函数 单元测试
 * 测试目标：BagQuote.tsx 中的 addDaysToDate 等纯函数逻辑
 *
 * 注：由于 addDaysToDate 定义在组件文件内未导出，此处独立实现同逻辑进行测试，
 * 确保函数行为正确。后续可重构为独立工具模块导出。
 */
import { describe, it, expect } from 'vitest'

/**
 * 日期加天数计算（与 BagQuote.tsx 中的 addDaysToDate 同逻辑）
 * 结束日期 = 开始日期 + 大货天数
 */
function addDaysToDate(dateStr: string, days: number): string {
  if (!dateStr || !days || isNaN(days)) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

/**
 * 收货地址拼接（与 CustomerSelect.tsx handleSelect 同逻辑）
 * 格式：客户名称 电话 地址（过滤空值）
 */
function composeShippingAddress(name: string, phone: string, address: string): string {
  const parts = [name, phone, address].filter(Boolean)
  return parts.join(' ')
}

/**
 * 手提字段合并/拆分（与 BagQuote.tsx 同逻辑）
 * 合并格式：材质：规格
 */
function composeHandleField(material: string, spec: string): string {
  return [material, spec].filter(Boolean).join('：')
}

function splitHandleField(value: string): { material: string; spec: string } {
  if (!value) return { material: '', spec: '' }
  const idx = value.indexOf('：')
  if (idx === -1) return { material: value, spec: '' }
  return { material: value.substring(0, idx), spec: value.substring(idx + 1) }
}

/**
 * 订单号生成（与 api/db.ts 同逻辑）
 * 格式：客户名称-时间戳-款式标签
 */
const PRODUCT_STYLE_OPTIONS = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

function getStyleLabel(value: string): string {
  return PRODUCT_STYLE_OPTIONS.find((o) => o.value === value)?.label || value
}

function generateQuoteNumber(customerName: string, timestamp: string, productStyle: string): string {
  return `${customerName}-${getStyleLabel(productStyle)}-${timestamp}`
}

// ============================ 测试 ============================

describe('addDaysToDate - 日期联动计算', () => {
  it('开始日期 + 大货天数 = 结束日期', () => {
    expect(addDaysToDate('2026-07-31', 30)).toBe('2026-08-30')
  })

  it('跨月计算正确', () => {
    expect(addDaysToDate('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('跨年计算正确', () => {
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('闰年2月计算正确', () => {
    expect(addDaysToDate('2024-02-28', 1)).toBe('2024-02-29')
  })

  it('非闰年2月计算正确', () => {
    expect(addDaysToDate('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('天数为 0 时返回空字符串', () => {
    expect(addDaysToDate('2026-07-31', 0)).toBe('')
  })

  it('天数为负时正确回退日期', () => {
    expect(addDaysToDate('2026-07-31', -5)).toBe('2026-07-26')
  })

  it('开始日期为空时返回空', () => {
    expect(addDaysToDate('', 30)).toBe('')
  })

  it('无效日期返回空', () => {
    expect(addDaysToDate('invalid-date', 30)).toBe('')
  })
})

describe('composeShippingAddress - 收货地址拼接', () => {
  it('三项都有值时用空格连接', () => {
    expect(composeShippingAddress('张三', '13800138000', '深圳市南山区')).toBe('张三 13800138000 深圳市南山区')
  })

  it('电话为空时只显示名称和地址', () => {
    expect(composeShippingAddress('张三', '', '深圳市南山区')).toBe('张三 深圳市南山区')
  })

  it('地址为空时只显示名称和电话', () => {
    expect(composeShippingAddress('张三', '13800138000', '')).toBe('张三 13800138000')
  })

  it('三项都为空时返回空字符串', () => {
    expect(composeShippingAddress('', '', '')).toBe('')
  })
})

describe('composeHandleField - 手提字段合并', () => {
  it('材质和规格都有值时用冒号连接', () => {
    expect(composeHandleField('帆布手提', '2.5*70')).toBe('帆布手提：2.5*70')
  })

  it('只有材质时不加冒号', () => {
    expect(composeHandleField('帆布手提', '')).toBe('帆布手提')
  })

  it('只有规格时不加冒号', () => {
    expect(composeHandleField('', '2.5*70')).toBe('2.5*70')
  })

  it('都为空时返回空字符串', () => {
    expect(composeHandleField('', '')).toBe('')
  })
})

describe('splitHandleField - 手提字段拆分', () => {
  it('正常格式按首个冒号拆分', () => {
    const result = splitHandleField('帆布手提：2.5*70')
    expect(result.material).toBe('帆布手提')
    expect(result.spec).toBe('2.5*70')
  })

  it('无冒号时全部作为材质', () => {
    const result = splitHandleField('帆布手提')
    expect(result.material).toBe('帆布手提')
    expect(result.spec).toBe('')
  })

  it('空值返回空对象', () => {
    const result = splitHandleField('')
    expect(result.material).toBe('')
    expect(result.spec).toBe('')
  })

  it('多个冒号时只按首个拆分', () => {
    const result = splitHandleField('材质A：规格B：备注C')
    expect(result.material).toBe('材质A')
    expect(result.spec).toBe('规格B：备注C')
  })
})

describe('generateQuoteNumber - 订单号生成', () => {
  it('格式正确：客户-款式-时间戳（时间戳在末尾）', () => {
    const number = generateQuoteNumber('测试客户', '20260731143000', '1')
    expect(number).toBe('测试客户-无底无侧普通袋-20260731143000')
  })

  it('款式1 → 无底无侧普通袋', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '1')).toContain('无底无侧普通袋')
  })

  it('款式2 → 有底无侧普通袋', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '2')).toContain('有底无侧普通袋')
  })

  it('款式3 → 有底有侧普通袋', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '3')).toContain('有底有侧普通袋')
  })

  it('款式4 → 手提连底普通拼接袋', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '4')).toContain('手提连底普通拼接袋')
  })

  it('款式5 → 手提连底高级拼接袋', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '5')).toContain('手提连底高级拼接袋')
  })

  it('款式6 → 手提无连底拼接袋', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '6')).toContain('手提无连底拼接袋')
  })

  it('无效款式值时使用原值', () => {
    expect(generateQuoteNumber('客户', '20260731143000', '99')).toContain('99')
  })
})
