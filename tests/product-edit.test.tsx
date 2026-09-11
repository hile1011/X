/**
 * 产品编辑功能端到端测试
 *
 * 测试目标：
 * 1. 编辑按钮导航到 /products/:id/edit（而非 /products/new）
 * 2. CreateProduct 在编辑模式下正确加载产品数据填充表单
 * 3. 提交编辑后调用 api.products.update 并跳转回详情页
 * 4. 新增模式下仍调用 api.products.create 并跳转回列表
 * 5. 编辑模式下加载失败时显示提示
 *
 * 环境要求：jsdom（tests/setup.ts）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CreateProduct from '../src/pages/CreateProduct'

// ============================ Mock API ============================
const mockProduct = {
  id: 'prod-test-001',
  name: '测试产品',
  sku: 'TEST-001',
  code: '1',
  description: '测试描述',
  price: 9.99,
  category: '款式',
  stock: 500,
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
}

// vi.mock 被提升到文件顶部执行，必须使用 vi.hoisted 创建 mock 对象
const apiMock = vi.hoisted(() => ({
  products: {
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getMedia: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({
  api: apiMock,
}))

// ============================ 辅助：渲染带路由的组件 ============================
function renderWithRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/products/new" element={<CreateProduct />} />
        <Route path="/products/:id/edit" element={<CreateProduct />} />
        <Route path="/products/:id" element={<div data-testid="detail-page">详情页</div>} />
        <Route path="/products" element={<div data-testid="list-page">列表页</div>} />
      </Routes>
    </MemoryRouter>
  )
}

// ============================ 测试用例 ============================

describe('产品编辑功能', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    apiMock.products.getMedia.mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('编辑模式：从 URL 加载产品数据', () => {
    it('访问 /products/:id/edit 时应调用 getById 加载产品', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(apiMock.products.getById).toHaveBeenCalledWith('prod-test-001')
      })
    })

    it('加载完成后应填充表单所有字段', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      // 等待表单加载完成
      await waitFor(() => {
        expect(screen.getByDisplayValue('测试产品')).toBeTruthy()
      })

      // 验证所有字段都已正确填充
      expect(screen.getByDisplayValue('测试产品')).toBeTruthy() // name
      expect(screen.getByDisplayValue('TEST-001')).toBeTruthy() // sku
      expect(screen.getByDisplayValue('1')).toBeTruthy() // code
      expect(screen.getByDisplayValue('9.99')).toBeTruthy() // price
      expect(screen.getByDisplayValue('500')).toBeTruthy() // stock
      expect(screen.getByDisplayValue('测试描述')).toBeTruthy() // description
    })

    it('页面标题应显示"编辑产品"而非"添加产品"', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByText('编辑产品')).toBeTruthy()
      })
      expect(screen.queryByText('添加产品')).toBeNull()
    })

    it('页面副标题应显示"修改产品基本信息与图册"', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByText('修改产品基本信息与图册')).toBeTruthy()
      })
    })
  })

  describe('编辑模式：提交保存', () => {
    it('点击保存应调用 api.products.update 而非 create', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      apiMock.products.update.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      // 等待表单加载
      await waitFor(() => {
        expect(screen.getByDisplayValue('测试产品')).toBeTruthy()
      })

      // 修改名称
      const nameInput = screen.getByDisplayValue('测试产品')
      fireEvent.change(nameInput, { target: { value: '修改后的产品名' } })

      // 提交表单
      const form = screen.getByPlaceholderText('请输入产品名称').closest('form')
      fireEvent.submit(form!)

      await waitFor(() => {
        expect(apiMock.products.update).toHaveBeenCalledWith('prod-test-001', expect.objectContaining({
          name: '修改后的产品名',
          sku: 'TEST-001',
        }))
      })
      expect(apiMock.products.create).not.toHaveBeenCalled()
    })

    it('保存成功后应跳转到产品详情页 /products/:id', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      apiMock.products.update.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByDisplayValue('测试产品')).toBeTruthy()
      })

      // 提交表单
      const form = screen.getByPlaceholderText('请输入产品名称').closest('form')
      fireEvent.submit(form!)

      // 验证跳转到详情页
      await waitFor(() => {
        expect(screen.getByTestId('detail-page')).toBeTruthy()
      })
    })

    it('提交的 payload 应包含所有字段', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      apiMock.products.update.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByDisplayValue('测试产品')).toBeTruthy()
      })

      const form = screen.getByPlaceholderText('请输入产品名称').closest('form')
      fireEvent.submit(form!)

      await waitFor(() => {
        expect(apiMock.products.update).toHaveBeenCalledWith('prod-test-001', expect.objectContaining({
          name: '测试产品',
          sku: 'TEST-001',
          code: '1',
          description: '测试描述',
          price: 9.99,
          category: '款式',
          stock: 500,
        }))
      })
    })
  })

  describe('新增模式：不受编辑功能影响', () => {
    it('访问 /products/new 时不应调用 getById', async () => {
      renderWithRoute('/products/new')

      // 新增模式不应调用 getById
      expect(apiMock.products.getById).not.toHaveBeenCalled()
    })

    it('页面标题应显示"添加产品"', async () => {
      renderWithRoute('/products/new')
      expect(screen.getByText('添加产品')).toBeTruthy()
    })

    it('提交新增应调用 api.products.create 并跳转回列表', async () => {
      apiMock.products.create.mockResolvedValue(mockProduct)
      renderWithRoute('/products/new')

      // 填写必填字段
      const nameInput = screen.getByPlaceholderText('请输入产品名称')
      fireEvent.change(nameInput, { target: { value: '新产品' } })
      const skuInput = screen.getByPlaceholderText('请输入SKU编码')
      fireEvent.change(skuInput, { target: { value: 'NEW-001' } })

      // 提交表单
      const form = nameInput.closest('form')
      fireEvent.submit(form!)

      await waitFor(() => {
        expect(apiMock.products.create).toHaveBeenCalledWith(expect.objectContaining({
          name: '新产品',
          sku: 'NEW-001',
        }))
      })
      expect(apiMock.products.update).not.toHaveBeenCalled()

      // 验证跳转回列表页
      await waitFor(() => {
        expect(screen.getByTestId('list-page')).toBeTruthy()
      })
    })
  })

  describe('编辑模式：加载失败处理', () => {
    it('getById 失败时表单应为空（不阻塞页面）', async () => {
      apiMock.products.getById.mockRejectedValue(new Error('网络错误'))
      apiMock.products.update.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      // 等待加载完成
      await waitFor(() => {
        expect(apiMock.products.getById).toHaveBeenCalled()
      })

      // 等待加载状态消失，编辑页面标题出现
      await waitFor(() => {
        expect(screen.getByText('编辑产品')).toBeTruthy()
      })

      // 表单应为空（加载失败）
      const nameInput = screen.getByPlaceholderText('请输入产品名称') as HTMLInputElement
      expect(nameInput.value).toBe('')
    })
  })

  describe('编辑模式：返回按钮', () => {
    it('编辑模式的返回按钮（箭头）应跳转到产品列表页 /products', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByText('编辑产品')).toBeTruthy()
      })

      // 返回箭头按钮：位于"编辑产品"标题容器（div.min-w-0）之前的兄弟位置，
      // 需上溯到包含两者的头部行（div.flex.items-center）内查找
      const title = screen.getByText('编辑产品')
      const titleContainer = title.closest('div')?.parentElement
      const back = titleContainer?.parentElement?.querySelector('button') as HTMLElement
      expect(back).toBeTruthy()
      fireEvent.click(back!)

      // 应跳转到产品列表页（而非详情页）
      await waitFor(() => {
        expect(screen.getByTestId('list-page')).toBeTruthy()
      })
      expect(screen.queryByTestId('detail-page')).toBeNull()
    })

    it('编辑模式的"取消"按钮应跳转到产品列表页 /products', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct)
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByText('取消')).toBeTruthy()
      })

      const cancelBtn = screen.getByText('取消')
      fireEvent.click(cancelBtn)

      // 应跳转到产品列表页（而非详情页）
      await waitFor(() => {
        expect(screen.getByTestId('list-page')).toBeTruthy()
      })
      expect(screen.queryByTestId('detail-page')).toBeNull()
    })
  })
})
