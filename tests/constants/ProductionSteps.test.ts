/**
 * ProductionSteps 枚举类单元测试
 *
 * 测试目标：
 *   - getAll() 返回所有 6 个生产步骤
 *   - getById() 按 id 查找步骤
 *   - getByName() 按 name 查找步骤
 *   - count() 返回步骤总数
 *   - 返回数据不可变性
 */
import { describe, it, expect } from 'vitest'
import { ProductionSteps } from '../../src/constants/ProductionSteps'

describe('ProductionSteps.getAll - 获取所有生产步骤', () => {
  it('返回 6 个步骤', () => {
    expect(ProductionSteps.getAll()).toHaveLength(6)
  })

  it('第一个步骤为面料采购', () => {
    const all = ProductionSteps.getAll()
    expect(all[0]).toEqual({ id: 1, name: '面料采购', description: '采购所需面料' })
  })

  it('最后一个步骤为包装', () => {
    const all = ProductionSteps.getAll()
    expect(all[5]).toEqual({ id: 6, name: '包装', description: '包装入库' })
  })

  it('返回数据为浅拷贝（修改不影响内部数据）', () => {
    const all = ProductionSteps.getAll()
    all[0].name = '被篡改'
    const fresh = ProductionSteps.getAll()
    expect(fresh[0].name).toBe('面料采购')
  })
})

describe('ProductionSteps.getById - 按 id 查找', () => {
  it('id=1 → 面料采购', () => {
    expect(ProductionSteps.getById(1)).toEqual({ id: 1, name: '面料采购', description: '采购所需面料' })
  })

  it('id=2 → 裁剪', () => {
    expect(ProductionSteps.getById(2)).toEqual({ id: 2, name: '裁剪', description: '根据规格裁剪面料' })
  })

  it('id=3 → 印刷', () => {
    expect(ProductionSteps.getById(3)).toEqual({ id: 3, name: '印刷', description: '进行图案印刷' })
  })

  it('id=4 → 缝纫', () => {
    expect(ProductionSteps.getById(4)).toEqual({ id: 4, name: '缝纫', description: '缝制袋子' })
  })

  it('id=5 → 质检', () => {
    expect(ProductionSteps.getById(5)).toEqual({ id: 5, name: '质检', description: '质量检查' })
  })

  it('id=6 → 包装', () => {
    expect(ProductionSteps.getById(6)).toEqual({ id: 6, name: '包装', description: '包装入库' })
  })

  it('不存在的 id 返回 undefined', () => {
    expect(ProductionSteps.getById(0)).toBeUndefined()
    expect(ProductionSteps.getById(7)).toBeUndefined()
    expect(ProductionSteps.getById(-1)).toBeUndefined()
  })
})

describe('ProductionSteps.getByName - 按 name 查找', () => {
  it('面料采购 → id=1', () => {
    expect(ProductionSteps.getByName('面料采购')).toEqual({ id: 1, name: '面料采购', description: '采购所需面料' })
  })

  it('裁剪 → id=2', () => {
    expect(ProductionSteps.getByName('裁剪')).toEqual({ id: 2, name: '裁剪', description: '根据规格裁剪面料' })
  })

  it('包装 → id=6', () => {
    expect(ProductionSteps.getByName('包装')).toEqual({ id: 6, name: '包装', description: '包装入库' })
  })

  it('不存在的 name 返回 undefined', () => {
    expect(ProductionSteps.getByName('不存在的步骤')).toBeUndefined()
    expect(ProductionSteps.getByName('')).toBeUndefined()
  })
})

describe('ProductionSteps.count - 步骤总数', () => {
  it('返回 6', () => {
    expect(ProductionSteps.count()).toBe(6)
  })
})
