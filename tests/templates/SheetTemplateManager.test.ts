/**
 * SheetTemplateManager 模板管理类单元测试
 *
 * 测试目标：
 *   - getTemplate() 按款式 code 获取模板（1-6 + 默认回退）
 *   - getDefaultTemplate() 获取默认模板
 *   - hasTemplate() 判断款式是否有专属模板
 *   - getAllStyles() 获取所有有模板的款式 code
 *   - 模板不可变性（修改返回值不影响内部数据）
 *   - 模板数据结构正确性（data + formulas）
 */
import { describe, it, expect } from 'vitest'
import { SheetTemplateManager } from '../../src/templates/SheetTemplateManager'

describe('SheetTemplateManager.getTemplate - 按款式获取模板', () => {
  it('款式1 → 无底无侧普通袋模板', () => {
    const t = SheetTemplateManager.getTemplate('1')
    expect(t.data).toBeDefined()
    expect(t.formulas).toBeDefined()
    // 验证第一行标题
    expect(t.data[0][1]).toBe('数量 (个)')
    // 验证成品行
    expect(t.data[1][0]).toBe('成品')
    expect(t.data[1][1]).toBe(7200)
  })

  it('款式2 → 有底无侧普通袋模板', () => {
    const t = SheetTemplateManager.getTemplate('2')
    expect(t.data[1][0]).toBe('成品')
    // 有底无侧的成品底 > 0
    expect(t.data[1][4]).toBe(8)
  })

  it('款式3 → 有底有侧普通袋模板', () => {
    const t = SheetTemplateManager.getTemplate('3')
    expect(t.data[1][0]).toBe('成品')
    expect(t.data[1][1]).toBe(300)
    // 有侧：包含"侧底"行
    const hasSideRow = t.data.some((row) => row[0] === '侧底')
    expect(hasSideRow).toBe(true)
  })

  it('款式4 → 手提连底普通拼接袋模板', () => {
    const t = SheetTemplateManager.getTemplate('4')
    expect(t.data[1][0]).toBe('成品')
    // 包含"外口袋"行
    const hasPocketRow = t.data.some((row) => row[0] === '外口袋')
    expect(hasPocketRow).toBe(true)
  })

  it('款式5 → 手提连底高级拼接袋模板', () => {
    const t = SheetTemplateManager.getTemplate('5')
    expect(t.data[1][0]).toBe('成品')
    // 包含"包边条"和"阴阳手提-本色"行
    const hasBindingRow = t.data.some((row) => row[0] === '包边条')
    const hasYinYangRow = t.data.some((row) => row[0] === '阴阳手提-本色')
    expect(hasBindingRow).toBe(true)
    expect(hasYinYangRow).toBe(true)
  })

  it('款式6 → 手提无连底拼接袋模板', () => {
    const t = SheetTemplateManager.getTemplate('6')
    expect(t.data[1][0]).toBe('成品')
    expect(t.data[1][1]).toBe(1000)
  })

  it('无效款式 → 默认使用无底无侧模板', () => {
    const t = SheetTemplateManager.getTemplate('99')
    const defaultT = SheetTemplateManager.getTemplate('1')
    // 验证与款式1模板数据相同
    expect(t.data[1][0]).toBe('成品')
    expect(t.data[1][4]).toBe(0) // 无底
    expect(t.data).toEqual(defaultT.data)
  })

  it('空字符串款式 → 默认模板', () => {
    const t = SheetTemplateManager.getTemplate('')
    expect(t.data[1][0]).toBe('成品')
  })
})

describe('SheetTemplateManager.getDefaultTemplate - 默认模板', () => {
  it('返回无底无侧模板', () => {
    const t = SheetTemplateManager.getDefaultTemplate()
    expect(t.data[1][0]).toBe('成品')
    expect(t.data[1][4]).toBe(0) // 无底
  })

  it('与 getTemplate("1") 数据一致', () => {
    const defaultT = SheetTemplateManager.getDefaultTemplate()
    const style1T = SheetTemplateManager.getTemplate('1')
    expect(defaultT.data).toEqual(style1T.data)
    expect(defaultT.formulas).toEqual(style1T.formulas)
  })
})

describe('SheetTemplateManager.hasTemplate - 判断款式是否有模板', () => {
  it('款式1-6 均有模板', () => {
    for (let i = 1; i <= 6; i++) {
      expect(SheetTemplateManager.hasTemplate(String(i))).toBe(true)
    }
  })

  it('款式7 无模板', () => {
    expect(SheetTemplateManager.hasTemplate('7')).toBe(false)
  })

  it('空字符串无模板', () => {
    expect(SheetTemplateManager.hasTemplate('')).toBe(false)
  })

  it('非数字字符串无模板', () => {
    expect(SheetTemplateManager.hasTemplate('abc')).toBe(false)
  })
})

describe('SheetTemplateManager.getAllStyles - 所有款式 code', () => {
  it('返回 6 个款式', () => {
    expect(SheetTemplateManager.getAllStyles()).toHaveLength(6)
  })

  it('包含 1-6', () => {
    const styles = SheetTemplateManager.getAllStyles()
    expect(styles).toContain('1')
    expect(styles).toContain('2')
    expect(styles).toContain('3')
    expect(styles).toContain('4')
    expect(styles).toContain('5')
    expect(styles).toContain('6')
  })
})

describe('SheetTemplateManager - 模板不可变性', () => {
  it('修改 getTemplate 返回的 data 不影响内部数据', () => {
    const t1 = SheetTemplateManager.getTemplate('1')
    t1.data[1][1] = 99999
    t1.data.push(['篡改行'])

    const t2 = SheetTemplateManager.getTemplate('1')
    expect(t2.data[1][1]).toBe(7200)
    expect(t2.data).toHaveLength(10)
  })

  it('修改 getTemplate 返回的 formulas 不影响内部数据', () => {
    const t1 = SheetTemplateManager.getTemplate('1')
    t1.formulas['B3'] = '=篡改'
    delete t1.formulas['J8']

    const t2 = SheetTemplateManager.getTemplate('1')
    expect(t2.formulas['B3']).toBe('=B2')
    expect(t2.formulas['J8']).toBe('=SUM(J6:J7)')
  })

  it('两次调用返回不同对象（深拷贝）', () => {
    const t1 = SheetTemplateManager.getTemplate('1')
    const t2 = SheetTemplateManager.getTemplate('1')
    expect(t1).not.toBe(t2)
    expect(t1.data).not.toBe(t2.data)
    expect(t1.formulas).not.toBe(t2.formulas)
  })
})

describe('SheetTemplateManager - 模板数据结构正确性', () => {
  it('每个模板的 data 是二维数组', () => {
    for (let i = 1; i <= 6; i++) {
      const t = SheetTemplateManager.getTemplate(String(i))
      expect(Array.isArray(t.data)).toBe(true)
      t.data.forEach((row) => {
        expect(Array.isArray(row)).toBe(true)
      })
    }
  })

  it('每个模板的 formulas 是对象', () => {
    for (let i = 1; i <= 6; i++) {
      const t = SheetTemplateManager.getTemplate(String(i))
      expect(typeof t.formulas).toBe('object')
      expect(t.formulas).not.toBeNull()
    }
  })

  it('每个模板至少包含一个公式', () => {
    for (let i = 1; i <= 6; i++) {
      const t = SheetTemplateManager.getTemplate(String(i))
      expect(Object.keys(t.formulas).length).toBeGreaterThan(0)
    }
  })

  it('DEFAULT_STYLE = "1"', () => {
    expect(SheetTemplateManager.DEFAULT_STYLE).toBe('1')
  })
})
