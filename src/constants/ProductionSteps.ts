/**
 * 生产步骤枚举类
 *
 * 设计思路：
 *   - 将 BagQuote.tsx 中的 PRODUCTION_STEPS 常量封装为独立枚举类
 *   - 提供按 id / name 查找的方法
 *   - STEPS 设为 private，仅通过方法暴露，保证封装性
 */

export interface ProductionStep {
  id: number
  name: string
  description: string
}

export class ProductionSteps {
  private static readonly STEPS: readonly ProductionStep[] = [
    { id: 1, name: '面料采购', description: '采购所需面料' },
    { id: 2, name: '裁剪', description: '根据规格裁剪面料' },
    { id: 3, name: '手提', description: '手提处理' },
    { id: 4, name: '印刷', description: '进行图案印刷' },
    { id: 5, name: '缝纫', description: '缝制袋子' },
    { id: 6, name: '包装', description: '包装入库' },
  ]

  /**
   * 获取所有生产步骤（返回浅拷贝）
   */
  static getAll(): ProductionStep[] {
    return ProductionSteps.STEPS.map((s) => ({ ...s }))
  }

  /**
   * 根据 id 查找生产步骤
   */
  static getById(id: number): ProductionStep | undefined {
    const step = ProductionSteps.STEPS.find((s) => s.id === id)
    return step ? { ...step } : undefined
  }

  /**
   * 根据 name 查找生产步骤
   */
  static getByName(name: string): ProductionStep | undefined {
    const step = ProductionSteps.STEPS.find((s) => s.name === name)
    return step ? { ...step } : undefined
  }

  /**
   * 获取步骤总数
   */
  static count(): number {
    return ProductionSteps.STEPS.length
  }
}
