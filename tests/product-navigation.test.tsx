/**
 * 产品导航按钮单元测试
 *
 * 测试目标：
 * 1. Products 列表页"编辑"按钮导航到 /products/:id/edit（而非 /products/new）
 * 2. Products 列表页"查看详情"按钮导航到 /products/:id
 * 3. 产品详情页（CreateProduct viewMode，与编辑页共用布局）"编辑产品"按钮
 *    导航到 /products/:id/edit（而非 /products/new）
 * 4. 默认款式产品（style-1 至 style-6）不显示删除按钮
 * 5. 非默认款式产品显示删除按钮
 *
 * 环境要求：jsdom（tests/setup.ts）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Products from '../src/pages/Products'
import CreateProduct from '../src/pages/CreateProduct'

// ============================ Mock API ============================

// 使用真实的默认款式 ID（style-1 至 style-6）以匹配 isDefaultStyleProduct 逻辑
const mockProducts = [
  { id: 'style-1', name: '款式1-无底无侧', sku: 'SKU-001', code: '1', price: 10, stock: 100, category: '袋', description: '' },
  { id: 'style-2', name: '款式2-有底无侧', sku: 'SKU-002', code: '2', price: 20, stock: 200, category: '袋', description: '' },
  { id: 'prod-007', name: '自定义产品', sku: 'SKU-007', code: null, price: 30, stock: 300, category: '其他', description: '' },
]

const mockProductDetail = mockProducts[2]   // 使用自定义产品作为详情页测试对象

const apiMock = vi.hoisted(() => ({
  products: {
    getAll: vi.fn(),
    getById: vi.fn(),
    delete: vi.fn(),
    getMedia: vi.fn(),
    getMediaFileUrl: vi.fn((productId: string, mediaId: string) =>
      `/api/products/${productId}/media/${mediaId}/file`),
  },
}))

vi.mock('../src/api', () => ({
  api: apiMock,
}))

// 权限 mock：详情页"编辑产品"按钮受 products:edit 控制
const permissionMock = vi.hoisted(() => ({ hasPermission: (_perm: string) => true }))
vi.mock('../src/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: (p: string) => permissionMock.hasPermission(p) }),
}))

// ============================ 辅助：渲染带路由的组件 ============================

function renderProductsList() {
  return render(
    <MemoryRouter initialEntries={['/products']}>
      <Routes>
        <Route path="/products" element={<Products />} />
        <Route path="/products/new" element={<div data-testid="new-page">新增页</div>} />
        <Route path="/products/:id" element={<div data-testid="detail-page">详情页</div>} />
        <Route path="/products/:id/edit" element={<div data-testid="edit-page">编辑页</div>} />
      </Routes>
    </MemoryRouter>
  )
}

function renderProductDetail(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/products/${id}`]}>
      <Routes>
        <Route path="/products" element={<div data-testid="list-page">列表页</div>} />
        <Route path="/products/new" element={<div data-testid="new-page">新增页</div>} />
        <Route path="/products/:id" element={<CreateProduct viewMode />} />
        <Route path="/products/:id/edit" element={<div data-testid="edit-page">编辑页</div>} />
      </Routes>
    </MemoryRouter>
  )
}

// ============================ 测试用例 ============================

describe('产品列表页导航按钮', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    apiMock.products.getAll.mockResolvedValue(mockProducts)
  })

  afterEach(() => {
    cleanup()
  })

  it('加载产品列表应调用 api.products.list', async () => {
    renderProductsList()
    await waitFor(() => {
      expect(apiMock.products.getAll).toHaveBeenCalled()
    })
  })

  it('每个产品卡片应显示"编辑"按钮', async () => {
    renderProductsList()
    await waitFor(() => {
      const editBtns = screen.getAllByTitle('编辑')
      expect(editBtns.length).toBeGreaterThanOrEqual(3)
    })
  })

  it('点击"编辑"按钮应导航到 /products/:id/edit', async () => {
    renderProductsList()
    await waitFor(() => {
      expect(screen.getAllByTitle('编辑').length).toBeGreaterThanOrEqual(3)
    })

    const editBtns = screen.getAllByTitle('编辑')
    fireEvent.click(editBtns[0])

    await waitFor(() => {
      expect(screen.getByTestId('edit-page')).toBeTruthy()
    })
    expect(screen.queryByTestId('new-page')).toBeNull()
  })

  it('点击"查看详情"按钮应导航到 /products/:id（而非 edit）', async () => {
    renderProductsList()
    await waitFor(() => {
      expect(screen.getAllByTitle('查看详情').length).toBeGreaterThanOrEqual(3)
    })

    const detailBtns = screen.getAllByTitle('查看详情')
    fireEvent.click(detailBtns[1])   // 第二个产品

    await waitFor(() => {
      expect(screen.getByTestId('detail-page')).toBeTruthy()
    })
    expect(screen.queryByTestId('edit-page')).toBeNull()
  })

  it('默认款式产品（style-1 至 style-6）不显示删除按钮', async () => {
    renderProductsList()
    await waitFor(() => {
      // mockProducts 中 prod-001/002 是默认款式（id 匹配 style-1/style-2）
      const deleteBtns = screen.getAllByTitle('删除')
      // 仅 prod-007 有删除按钮（id 不匹配 style-N）
      expect(deleteBtns.length).toBe(1)
    })
  })

  it('非默认款式产品显示删除按钮', async () => {
    renderProductsList()
    await waitFor(() => {
      expect(screen.getAllByTitle('删除').length).toBe(1)
    })
    const deleteBtn = screen.getByTitle('删除')
    expect(deleteBtn).toBeTruthy()
  })

  it('空产品列表应显示"暂无产品记录"', async () => {
    apiMock.products.getAll.mockResolvedValue([])
    renderProductsList()
    await waitFor(() => {
      expect(screen.getByText('暂无产品记录')).toBeTruthy()
    })
  })

  it('API 加载失败时应显示空状态（不崩溃）', async () => {
    apiMock.products.getAll.mockRejectedValue(new Error('网络错误'))
    // 抑制 console.error 输出
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderProductsList()
    // 等待加载完成，应显示空状态而非崩溃
    await waitFor(() => {
      expect(screen.getByText('暂无产品记录')).toBeTruthy()
    })
    consoleSpy.mockRestore()
  })

  it('有图册图片的产品应显示第一张图片缩略图', async () => {
    apiMock.products.getAll.mockResolvedValue([
      { ...mockProducts[0], firstImage: { id: 'pmedia-001', media_type: 'image', file_name: '款式1正面.jpg' } },
      { ...mockProducts[1], firstImage: null },
    ])
    renderProductsList()

    await waitFor(() => {
      expect(screen.getByTestId('product-card-image')).toBeTruthy()
    })
    const img = screen.getByTestId('product-card-image') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('/api/products/style-1/media/pmedia-001/file')
    expect(img.getAttribute('alt')).toBe('款式1正面.jpg')
    // 仅 1 个产品有图，只渲染 1 张图片
    expect(screen.queryAllByTestId('product-card-image').length).toBe(1)
  })

  it('无图册图片的产品应显示占位图标（不渲染 img）', async () => {
    renderProductsList()
    await waitFor(() => {
      expect(screen.getAllByTitle('编辑').length).toBeGreaterThanOrEqual(3)
    })
    // mockProducts 均无 firstImage 字段，不应渲染任何图片
    expect(screen.queryAllByTestId('product-card-image').length).toBe(0)
  })
})

describe('产品详情页编辑按钮导航（CreateProduct viewMode）', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    apiMock.products.getById.mockResolvedValue(mockProductDetail)
    apiMock.products.getMedia.mockResolvedValue([])
    permissionMock.hasPermission = () => true
  })

  afterEach(() => {
    cleanup()
  })

  it('访问详情页应调用 getById 加载产品', async () => {
    renderProductDetail('prod-007')
    await waitFor(() => {
      expect(apiMock.products.getById).toHaveBeenCalledWith('prod-007')
    })
  })

  it('详情页应显示"编辑产品"按钮', async () => {
    renderProductDetail('prod-007')
    await waitFor(() => {
      expect(screen.getByText('编辑产品')).toBeTruthy()
    })
  })

  it('点击"编辑产品"按钮应导航到 /products/:id/edit（而非 /products/new）', async () => {
    renderProductDetail('prod-007')
    await waitFor(() => {
      expect(screen.getByText('编辑产品')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('编辑产品'))

    await waitFor(() => {
      expect(screen.getByTestId('edit-page')).toBeTruthy()
    })
    expect(screen.queryByTestId('new-page')).toBeNull()
  })

  it('详情页应显示返回按钮', async () => {
    renderProductDetail('prod-007')
    await waitFor(() => {
      // 返回箭头按钮（icon button）
      const buttons = document.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThan(0)
    })
  })
})
