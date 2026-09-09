/**
 * 产品管理-新增/编辑产品：款式模板逻辑同步测试
 *
 * 测试目标：
 * 1. 编码输入框提供 6 个内置款式快捷选项（datalist，与订单页款式/模板联动一致）
 * 2. 编码为 1-6 时显示对应款式模板关联提示（内置默认模板 + 数据库自定义模板名）
 * 3. 编码非 1-6（如历史数据 7/19/20）时提示订单中默认回退「无底无侧普通袋」模板
 * 4. 编码为空时提示默认模板
 * 5. 编辑模式加载产品数据后按其编码显示对应提示
 * 6. 编码切换时提示实时联动更新
 *
 * 环境要求：jsdom（tests/setup.ts）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CreateProduct from '../src/pages/CreateProduct'

// ============================ Mock API ============================
// vi.mock 被提升到文件顶部执行，必须使用 vi.hoisted 创建 mock 对象
const apiMock = vi.hoisted(() => ({
  products: {
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  sheetTemplates: {
    getAll: vi.fn(),
  },
}))

vi.mock('../src/api', () => ({
  api: apiMock,
}))

// 数据库模板固定数据（款式一对多：款式1 有两个模板，款式2 有一个，自定义编码 7 有一个）
const DB_TEMPLATES = [
  { id: 'tpl-1', styleCode: '1', name: '12安涤棉', data: [[1]], formulas: {} },
  { id: 'tpl-2', styleCode: '1', name: '10安涤棉', data: [[2]], formulas: {} },
  { id: 'tpl-3', styleCode: '2', name: '常规款', data: [[3]], formulas: {} },
  { id: 'tpl-7', styleCode: '7', name: '背心袋常规', data: [[4]], formulas: {} },
]

const mockProduct = (code: string) => ({
  id: 'prod-test-001',
  name: '测试产品',
  sku: 'TEST-001',
  code,
  description: '',
  price: 9.99,
  category: '款式',
  stock: 500,
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
})

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

/** 编码输入框（通过 datalist 属性定位） */
const codeInput = () => document.querySelector('input[list="builtin-style-codes"]') as HTMLInputElement

// ============================ 测试用例 ============================
describe('产品管理-款式模板逻辑同步', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    apiMock.sheetTemplates.getAll.mockResolvedValue(DB_TEMPLATES)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('内置款式快捷选项（datalist）', () => {
    it('应渲染 6 个内置款式选项（code 1-6，含款式名）', () => {
      const { container } = renderWithRoute('/products/new')
      const options = container.querySelectorAll('#builtin-style-codes option')
      expect(options).toHaveLength(6)
      const values = Array.from(options).map((o) => (o as HTMLOptionElement).value)
      expect(values).toEqual(['1', '2', '3', '4', '5', '6'])
      expect(options[0].textContent).toBe('无底无侧普通袋')
      expect(options[5].textContent).toBe('手提无连底拼接袋')
    })

    it('编码输入框应绑定 datalist 并允许自由输入（兼容 7/19/20 等历史编码）', () => {
      renderWithRoute('/products/new')
      const input = codeInput()
      expect(input).toBeTruthy()
      fireEvent.change(input, { target: { value: '19' } })
      expect(input.value).toBe('19')
    })
  })

  describe('款式模板关联提示', () => {
    it('编码为 1-6 时显示对应款式名及模板列表（内置默认 + 数据库模板名）', async () => {
      renderWithRoute('/products/new')
      const input = codeInput()
      fireEvent.change(input, { target: { value: '1' } })

      // 等待数据库模板加载完成后展示完整关联提示
      await waitFor(() => {
        expect(screen.getByText(/已关联款式「无底无侧普通袋」模板：内置默认模板、12安涤棉、10安涤棉/)).toBeTruthy()
      })
    })

    it('编码为其他款式（如 2）时显示该款式的模板关联提示', async () => {
      renderWithRoute('/products/new')
      fireEvent.change(codeInput(), { target: { value: '2' } })

      await waitFor(() => {
        expect(screen.getByText(/已关联款式「有底无侧普通袋」模板：内置默认模板、常规款/)).toBeTruthy()
      })
    })

    it('编码对应的款式无数据库模板时仅显示内置默认模板', async () => {
      renderWithRoute('/products/new')
      fireEvent.change(codeInput(), { target: { value: '3' } })

      await waitFor(() => {
        expect(screen.getByText(/已关联款式「有底有侧普通袋」模板：内置默认模板$/)).toBeTruthy()
      })
    })

    it('自定义编码已有数据库模板时列出模板名（新增产品款式模板同步）', async () => {
      renderWithRoute('/products/new')
      fireEvent.change(codeInput(), { target: { value: '7' } })

      await waitFor(() => {
        expect(screen.getByText(/已关联自定义编码「7」模板：背心袋常规；订单未选模板时默认使用「无底无侧普通袋」/)).toBeTruthy()
      })
    })

    it('自定义编码无模板时引导到款式模板管理创建', () => {
      renderWithRoute('/products/new')
      fireEvent.change(codeInput(), { target: { value: '19' } })

      expect(screen.getByText(/自定义编码 19：可在「款式模板管理」中为该款式创建模板；订单未选模板时默认使用「无底无侧普通袋」/)).toBeTruthy()
    })

    it('编码为空时提示默认使用「无底无侧普通袋」模板', () => {
      renderWithRoute('/products/new')

      expect(screen.getByText(/未填写编码时，订单中该产品默认使用「无底无侧普通袋」模板/)).toBeTruthy()
    })

    it('编码切换时提示实时联动更新', async () => {
      renderWithRoute('/products/new')
      const input = codeInput()

      fireEvent.change(input, { target: { value: '1' } })
      await waitFor(() => {
        expect(screen.getByText(/已关联款式「无底无侧普通袋」/)).toBeTruthy()
      })

      fireEvent.change(input, { target: { value: '20' } })
      expect(screen.getByText(/自定义编码 20：可在「款式模板管理」中为该款式创建模板/)).toBeTruthy()

      fireEvent.change(input, { target: { value: '' } })
      expect(screen.getByText(/未填写编码时/)).toBeTruthy()
    })

    it('数据库模板加载失败时仍显示内置默认模板关联提示（静默降级）', async () => {
      apiMock.sheetTemplates.getAll.mockRejectedValue(new Error('network error'))
      renderWithRoute('/products/new')
      fireEvent.change(codeInput(), { target: { value: '1' } })

      await waitFor(() => {
        expect(screen.getByText(/已关联款式「无底无侧普通袋」模板：内置默认模板$/)).toBeTruthy()
      })
    })
  })

  describe('编辑模式：按产品编码同步模板关联提示', () => {
    it('加载 code=2 的产品后显示「有底无侧普通袋」关联提示', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct('2'))
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByText(/已关联款式「有底无侧普通袋」模板：内置默认模板、常规款/)).toBeTruthy()
      })
      expect(codeInput().value).toBe('2')
    })

    it('加载历史自定义编码（如 19）的产品后显示模板管理引导提示', async () => {
      apiMock.products.getById.mockResolvedValue(mockProduct('19'))
      renderWithRoute('/products/prod-test-001/edit')

      await waitFor(() => {
        expect(screen.getByText(/自定义编码 19：可在「款式模板管理」中为该款式创建模板/)).toBeTruthy()
      })
    })
  })

  describe('保存时编码随产品数据提交（款式模板绑定不变）', () => {
    it('选择款式编码后创建产品提交的 payload 携带该编码', async () => {
      apiMock.products.create.mockResolvedValue({ id: 'new-1' })
      renderWithRoute('/products/new')

      fireEvent.change(screen.getByPlaceholderText('请输入产品名称'), { target: { value: '新品' } })
      fireEvent.change(screen.getByPlaceholderText('请输入SKU编码'), { target: { value: 'SKU-1' } })
      fireEvent.change(codeInput(), { target: { value: '5' } })
      // 页面顶部工具栏与表单底部各有一个保存按钮，点击第一个即可
      fireEvent.click(screen.getAllByRole('button', { name: /保存/ })[0])

      await waitFor(() => {
        expect(apiMock.products.create).toHaveBeenCalledWith(
          expect.objectContaining({ name: '新品', sku: 'SKU-1', code: '5' }),
        )
      })
    })
  })
})
