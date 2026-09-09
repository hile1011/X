import { api } from '../api'
import type { Product } from '../types'

/**
 * 款式字段数据来源：产品管理模块
 *
 * 款式选项 = products 表中的所有产品（显示产品管理全部数据）
 * 选项 value 取值规则：
 *   - 产品有 code（1-6）时 → value = code（向后兼容已有订单数据）
 *   - 产品无 code 时 → value = 产品 id（唯一标识，模板默认走无底无侧）
 * 款式标签 = 产品名称（动态，产品改名后自动更新）
 *
 * 模板绑定：code 1-6 对应在线表格模板；无 code 或非 1-6 的产品默认使用「无底无侧」模板
 *
 * 硬编码兜底：网络失败 / 产品为空 / 测试场景时使用，保证健壮性
 */

// 硬编码兜底款式（与迁移脚本插入的 6 条默认款式一致）
export const BUILTIN_STYLE_OPTIONS: readonly StyleOption[] = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

// 6 个默认款式产品的 id（迁移脚本 v7 插入，不可删除）
export const DEFAULT_STYLE_PRODUCT_IDS = ['style-1', 'style-2', 'style-3', 'style-4', 'style-5', 'style-6']

/** 判断产品是否为默认款式（默认款式不可删除） */
export function isDefaultStyleProduct(id: string): boolean {
  return DEFAULT_STYLE_PRODUCT_IDS.includes(id)
}

export interface StyleOption {
  value: string
  label: string
}

/**
 * 从产品管理模块获取款式选项（返回所有产品）
 *  - 有 code 的产品：value = code（向后兼容）
 *  - 无 code 的产品：value = 产品 id（模板默认走无底无侧）
 * 失败或为空时回退到硬编码 6 款式
 */
export async function fetchStyleOptions(): Promise<StyleOption[]> {
  try {
    const products = (await api.products.getAll()) as Product[]
    if (products.length === 0) return [...BUILTIN_STYLE_OPTIONS]
    return products.map((p) => ({
      value: p.code && p.code.trim() !== '' ? p.code : p.id,
      label: p.name,
    }))
  } catch {
    return [...BUILTIN_STYLE_OPTIONS]
  }
}

/**
 * 根据值（code 或产品 id）获取款式标签
 * 优先按 code 匹配，再按 id 匹配；找不到时回退到硬编码兜底，再找不到返回值本身
 */
export function getStyleLabelFromProducts(products: Product[], value: string): string {
  const product = products.find((p) => p.code === value || p.id === value)
  if (product) return product.name
  const fallback = BUILTIN_STYLE_OPTIONS.find((o) => o.value === value)
  return fallback ? fallback.label : value
}
