/**
 * 产品详情/编辑共用页面（CreateProduct 三态）单元测试
 *
 * 测试目标（视图模式切换机制）：
 *   1. 查看模式（viewMode）：全部表单控件（名称/SKU/编码/价格/分类/库存/描述）不可编辑
 *   2. 查看模式：隐藏保存/取消操作区，显示「编辑产品」按钮（需 products:edit 权限）
 *   3. 查看模式：标题旁灰色「查看模式」徽标；编辑模式绿色「编辑模式」徽标
 *   4. 点击「编辑产品」导航到 /products/:id/edit
 *   5. 无 products:edit 权限时查看模式不显示「编辑产品」按钮
 *   6. 编辑模式控件可编辑、显示保存按钮
 *   7. 产品图册在查看/编辑模式均渲染（查看模式 readOnly：无上传按钮）
 *
 * Mock 策略：api / usePermission；MemoryRouter 包裹
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CreateProduct from '../src/pages/CreateProduct'

const mockProduct = {
  id: 'prod-view-001',
  name: '查看模式测试产品',
  sku: 'VIEW-001',
  code: '1',
  description: '产品描述内容',
  price: 19.9,
  category: '款式',
  stock: 66,
  created_at: '2026-09-01 08:00:00',
  updated_at: '2026-09-01 08:00:00',
}

const apiMock = vi.hoisted(() => ({
  products: {
    getById: vi.fn(),
    update: vi.fn(),
    getMedia: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({ api: apiMock }))

const permissionMock = vi.hoisted(() => ({ hasPermission: (_perm: string) => true }))
vi.mock('../src/hooks/usePermission', () => ({
  usePermission: () => ({ hasPermission: (p: string) => permissionMock.hasPermission(p) }),
}))

function renderWithRoute(path: string, viewMode = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/products/new" element={<CreateProduct />} />
        <Route path="/products/:id/edit" element={<CreateProduct />} />
        <Route path="/products/:id" element={<CreateProduct viewMode={viewMode} />} />
        <Route path="/products" element={<div data-testid="list-page">列表页</div>} />
      </Routes>
    </MemoryRouter>
  )
}

/** 等待产品数据加载完成（表单出现产品名） */
async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByDisplayValue('查看模式测试产品')).toBeTruthy()
  })
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  apiMock.products.getById.mockResolvedValue(mockProduct)
  apiMock.products.getMedia.mockResolvedValue([])
  permissionMock.hasPermission = () => true
})

afterEach(() => {
  cleanup()
})

// ============================================================
// 查看模式（viewMode）
// ============================================================
describe('产品详情查看模式（viewMode）', () => {
  it('全部表单控件不可编辑（disabled）', async () => {
    renderWithRoute('/products/prod-view-001', true)
    await waitForLoaded()

    expect((screen.getByTestId('field-name') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('field-sku') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('field-code') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('field-price') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('field-category') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByTestId('field-stock') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByTestId('field-description') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('隐藏保存/取消操作区，显示创建时间只读字段', async () => {
    renderWithRoute('/products/prod-view-001', true)
    await waitForLoaded()

    // 底部提交操作区不可见
    expect(screen.queryByText('取消')).toBeNull()
    expect(screen.queryByText('保存')).toBeNull()
    // 创建时间只读展示
    expect(screen.getByTestId('field-created-at')).toBeTruthy()
  })

  it('标题旁显示灰色「查看模式」徽标', async () => {
    renderWithRoute('/products/prod-view-001', true)
    await waitForLoaded()

    const badge = screen.getByTestId('mode-badge')
    expect(badge.textContent).toBe('查看模式')
    expect(badge.className).toContain('bg-gray-100')
  })

  it('持有 products:edit 权限时显示「编辑产品」按钮并跳转编辑页', async () => {
    apiMock.products.update.mockResolvedValue(mockProduct)
    renderWithRoute('/products/prod-view-001', true)
    await waitForLoaded()

    const editBtn = screen.getByTestId('edit-product-btn')
    expect(editBtn).toBeTruthy()
    fireEvent.click(editBtn)

    await waitFor(() => {
      // /products/:id/edit 路由渲染的是 CreateProduct（编辑模式）
      expect(screen.getByText('编辑模式')).toBeTruthy()
    })
  })

  it('无 products:edit 权限时查看模式不显示「编辑产品」按钮', async () => {
    permissionMock.hasPermission = () => false
    renderWithRoute('/products/prod-view-001', true)
    await waitForLoaded()

    expect(screen.queryByTestId('edit-product-btn')).toBeNull()
  })

  it('产品图册以 readOnly 渲染（无上传按钮）', async () => {
    renderWithRoute('/products/prod-view-001', true)
    await waitForLoaded()

    // 图册区域存在
    expect(screen.getByText('产品图册')).toBeTruthy()
    // readOnly：无上传按钮
    expect(screen.queryByText('上传图片/视频')).toBeNull()
  })
})

// ============================================================
// 编辑模式
// ============================================================
describe('产品编辑模式（对照）', () => {
  it('表单控件可编辑', async () => {
    renderWithRoute('/products/prod-view-001/edit')
    await waitForLoaded()

    expect((screen.getByTestId('field-name') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByTestId('field-sku') as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByTestId('field-description') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('标题旁显示绿色「编辑模式」徽标，显示保存按钮', async () => {
    renderWithRoute('/products/prod-view-001/edit')
    await waitForLoaded()

    const badge = screen.getByTestId('mode-badge')
    expect(badge.textContent).toBe('编辑模式')
    expect(badge.className).toContain('bg-green-50')
    // 顶部 + 底部各一个保存按钮
    expect(screen.getAllByText('保存').length).toBe(2)
    expect(screen.getByText('取消')).toBeTruthy()
  })

  it('产品图册显示上传按钮（编辑模式）', async () => {
    renderWithRoute('/products/prod-view-001/edit')
    await waitForLoaded()

    expect(screen.getByText('产品图册')).toBeTruthy()
    expect(screen.getByText('上传图片/视频')).toBeTruthy()
  })
})

// ============================================================
// 新建模式（对照：不受影响）
// ============================================================
describe('新建模式（对照）', () => {
  it('不显示模式徽标与图册，表单可编辑', () => {
    renderWithRoute('/products/new')
    expect(screen.getByText('添加产品')).toBeTruthy()
    expect(screen.queryByTestId('mode-badge')).toBeNull()
    expect((screen.getByTestId('field-name') as HTMLInputElement).disabled).toBe(false)
    // 新建未保存：提示先保存再上传图册
    expect(screen.getByText('保存产品后即可上传图片/视频，组成产品图册')).toBeTruthy()
  })
})
