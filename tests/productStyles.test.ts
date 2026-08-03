/**
 * 款式工具函数（productStyles.ts）单元测试
 *
 * 测试目标：
 *   - isDefaultStyleProduct：判断产品是否为默认款式（不可删除）
 *   - getStyleLabelFromProducts：按 code 或 id 查找产品名称
 *   - fetchStyleOptions：从产品管理模块获取款式选项（含兜底逻辑）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Product } from '../src/types'

// Mock api 模块，避免真实网络请求
vi.mock('../src/api', () => ({
  api: {
    products: {
      getAll: vi.fn(),
    },
  },
}))

// 在每个测试前重置模块缓存，确保 mock 状态干净
let mockGetAll: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  const { api } = await import('../src/api')
  mockGetAll = api.products.getAll as ReturnType<typeof vi.fn>
  mockGetAll.mockReset()
})

describe('isDefaultStyleProduct - 默认款式判断', () => {
  it('style-1 到 style-6 均为默认款式', async () => {
    const { isDefaultStyleProduct } = await import('../src/services/productStyles')
    for (let i = 1; i <= 6; i++) {
      expect(isDefaultStyleProduct(`style-${i}`)).toBe(true)
    }
  })

  it('非默认款式 id 返回 false', async () => {
    const { isDefaultStyleProduct } = await import('../src/services/productStyles')
    expect(isDefaultStyleProduct('prod-123')).toBe(false)
    expect(isDefaultStyleProduct('')).toBe(false)
    expect(isDefaultStyleProduct('custom-product')).toBe(false)
  })

  it('DEFAULT_STYLE_PRODUCT_IDS 包含 6 个默认 id', async () => {
    const { DEFAULT_STYLE_PRODUCT_IDS } = await import('../src/services/productStyles')
    expect(DEFAULT_STYLE_PRODUCT_IDS).toEqual([
      'style-1', 'style-2', 'style-3', 'style-4', 'style-5', 'style-6',
    ])
  })
})

describe('getStyleLabelFromProducts - 按 code 或 id 查找名称', () => {
  const products: Product[] = [
    { id: 'style-1', name: '无底无侧普通袋', sku: 'STYLE-1', code: '1', description: '', price: 0, category: '款式', stock: 0, created_at: '', updated_at: '' },
    { id: 'style-3', name: '有底有侧普通袋', sku: 'STYLE-3', code: '3', description: '', price: 0, category: '款式', stock: 0, created_at: '', updated_at: '' },
    { id: 'prod-100', name: '定制帆布袋A', sku: 'BAG-A', code: '', description: '', price: 10, category: '其他', stock: 50, created_at: '', updated_at: '' },
  ]

  it('按 code 查找：code="1" → 无底无侧普通袋', async () => {
    const { getStyleLabelFromProducts } = await import('../src/services/productStyles')
    expect(getStyleLabelFromProducts(products, '1')).toBe('无底无侧普通袋')
  })

  it('按 id 查找：无 code 的产品通过 id 匹配', async () => {
    const { getStyleLabelFromProducts } = await import('../src/services/productStyles')
    expect(getStyleLabelFromProducts(products, 'prod-100')).toBe('定制帆布袋A')
  })

  it('硬编码兜底：code="2" 不在产品列表时回退到硬编码', async () => {
    const { getStyleLabelFromProducts } = await import('../src/services/productStyles')
    // products 列表中没有 code=2，但硬编码兜底有
    expect(getStyleLabelFromProducts(products, '2')).toBe('有底无侧普通袋')
  })

  it('完全找不到时返回值本身', async () => {
    const { getStyleLabelFromProducts } = await import('../src/services/productStyles')
    expect(getStyleLabelFromProducts(products, '不存在的值')).toBe('不存在的值')
  })

  it('空产品列表时走硬编码兜底', async () => {
    const { getStyleLabelFromProducts } = await import('../src/services/productStyles')
    expect(getStyleLabelFromProducts([], '5')).toBe('手提连底高级拼接袋')
  })
})

describe('fetchStyleOptions - 从产品管理模块获取款式选项', () => {
  it('返回所有产品：有 code 的用 code 作 value，无 code 的用 id', async () => {
    const { fetchStyleOptions } = await import('../src/services/productStyles')
    mockGetAll.mockResolvedValue([
      { id: 'style-1', name: '无底无侧普通袋', sku: '', code: '1', description: '', price: 0, category: '', stock: 0, created_at: '', updated_at: '' },
      { id: 'prod-100', name: '定制袋', sku: '', code: '', description: '', price: 0, category: '', stock: 0, created_at: '', updated_at: '' },
    ])

    const options = await fetchStyleOptions()

    expect(options).toHaveLength(2)
    expect(options[0]).toEqual({ value: '1', label: '无底无侧普通袋' })
    expect(options[1]).toEqual({ value: 'prod-100', label: '定制袋' })
  })

  it('code 为空白字符串时用 id 作 value', async () => {
    const { fetchStyleOptions } = await import('../src/services/productStyles')
    mockGetAll.mockResolvedValue([
      { id: 'prod-200', name: '空白code产品', sku: '', code: '   ', description: '', price: 0, category: '', stock: 0, created_at: '', updated_at: '' },
    ])

    const options = await fetchStyleOptions()
    expect(options[0]).toEqual({ value: 'prod-200', label: '空白code产品' })
  })

  it('产品列表为空时回退到硬编码 6 款式', async () => {
    const { fetchStyleOptions } = await import('../src/services/productStyles')
    mockGetAll.mockResolvedValue([])

    const options = await fetchStyleOptions()
    expect(options).toHaveLength(6)
    expect(options[0]).toEqual({ value: '1', label: '无底无侧普通袋' })
    expect(options[5]).toEqual({ value: '6', label: '手提无连底拼接袋' })
  })

  it('API 异常时回退到硬编码 6 款式', async () => {
    const { fetchStyleOptions } = await import('../src/services/productStyles')
    mockGetAll.mockRejectedValue(new Error('网络错误'))

    const options = await fetchStyleOptions()
    expect(options).toHaveLength(6)
    expect(options.map(o => o.value)).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})
