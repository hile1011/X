/**
 * 款式模板管理页（SheetTemplates.tsx）组件测试
 *
 * 测试目标（v23 新功能）：
 *   1. 列表加载：按款式分组的树形结构、模板行信息、"暂无自定义模板"空态
 *   2. 树形展开/收起：点击款式父行切换子级可见性
 *   3. 字段查询：按模板名/款式名/更新人搜索 + 款式下拉筛选 + 无匹配空态
 *   4. 权限控制：无编辑权限时不显示新增按钮、编辑按钮禁用
 *   5. 新增弹窗：必填校验、同款式重名校验、创建成功流程
 *   6. 回归：新增成功进入编辑器后返回列表，弹窗不再重复弹出（bug 修复验证）
 *
 * Mock 说明：
 *   - api / usePermission / fetchStyleOptions / SheetTemplateManager：隔离网络与权限
 *   - VTableSheet 及插件：jsdom 无法运行真实表格，替换为可调用的假实例
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import SheetTemplates from '../src/pages/SheetTemplates'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  sheetTemplates: {
    getAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const permissionMock = vi.hoisted(() => ({ hasPermission: vi.fn() }))

// SheetTemplateManager mock：仅用到 loadOverrides/getBuiltinTemplate/setOverride
const managerMock = vi.hoisted(() => ({
  loadOverrides: vi.fn(async () => {}),
  getBuiltinTemplate: vi.fn(() => ({ data: [[null]], formulas: {} })),
  setOverride: vi.fn(),
  removeOverride: vi.fn(),
}))

vi.mock('../src/api', () => ({ api: apiMock }))
vi.mock('../src/hooks/usePermission', () => ({
  useHasPermission: (perm: string) => permissionMock.hasPermission(perm),
}))
vi.mock('../src/services/productStyles', () => ({
  fetchStyleOptions: vi.fn(async () => [
    { value: '1', label: '无底无侧普通袋' },
    { value: '2', label: '有底无侧普通袋' },
    { value: '3', label: '有底有侧普通袋' },
    { value: '4', label: '手提连底普通拼接袋' },
    { value: '5', label: '手提连底高级拼接袋' },
    { value: '6', label: '手提无连底拼接袋' },
  ]),
}))
vi.mock('../src/templates/SheetTemplateManager', () => ({
  SheetTemplateManager: managerMock,
}))
vi.mock('@visactor/vtable-sheet', () => ({
  VTableSheet: class MockVTableSheet {
    formulaManager = { getCellFormula: () => null }
    getActiveSheet() {
      return { tableInstance: {} }
    }
    release() {}
  },
}))
vi.mock('@visactor/vtable-plugins', () => ({
  TableExportPlugin: class {},
  ExcelImportPlugin: class {},
}))

// ============================ 测试数据 ============================

const tpl = (id: string, styleCode: string, name: string, updatedBy = 'admin') => ({
  id,
  styleCode,
  name,
  data: [[null]],
  formulas: {},
  sortOrder: 0,
  updatedBy,
  createdAt: '2026-08-20 10:00:00',
  updatedAt: '2026-08-21 10:00:00',
})

/** 两条款式2模板 + 一条款式3模板 */
const TEMPLATES = [
  tpl('tpl-1', '2', '常规款'),
  tpl('tpl-2', '2', '加厚款', 'operator'),
  tpl('tpl-3', '3', '侧底款'),
]

function renderPage() {
  return render(<SheetTemplates />)
}

// ============================ 测试用例 ============================

describe('款式模板管理页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    permissionMock.hasPermission.mockReturnValue(true)
    apiMock.sheetTemplates.getAll.mockResolvedValue(TEMPLATES)
    managerMock.loadOverrides.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  describe('列表加载与树形结构', () => {
    it('按款式分组展示 6 个款式，模板行显示名称与最后修改人', async () => {
      renderPage()

      // 等待加载完成
      await waitFor(() => {
        expect(screen.getByText('常规款')).toBeTruthy()
      })

      // 6 个款式分组头全部展示
      expect(screen.getByText('无底无侧普通袋', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText('有底无侧普通袋', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText('有底有侧普通袋', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText('手提连底普通拼接袋', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText('手提连底高级拼接袋', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText('手提无连底拼接袋', { selector: 'span' })).toBeTruthy()

      // 模板行：名称 + 更新人
      expect(screen.getByText('加厚款')).toBeTruthy()
      expect(screen.getByText(/operator/)).toBeTruthy()
      // 默认展开（树形二级可见）
      expect(screen.getByText('侧底款')).toBeTruthy()
    })

    it('款式分组显示模板数量', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      expect(screen.getByText('2 个模板')).toBeTruthy() // 款式2
      expect(screen.getByText('1 个模板')).toBeTruthy() // 款式3
      expect(screen.getAllByText('0 个模板')).toHaveLength(4) // 款式1/4/5/6
    })

    it('无自定义模板的款式显示空态提示与立即创建入口', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      expect(screen.getAllByText('暂无自定义模板，订单将使用内置默认模板')).toHaveLength(4)
      expect(screen.getAllByText('立即创建').length).toBeGreaterThan(0)
    })

    it('点击款式父行收起子级，再次点击展开', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      const style2Header = screen.getByText('有底无侧普通袋', { selector: 'span' }).closest('button')!
      fireEvent.click(style2Header)

      // 收起：模板行消失，但分组头仍在
      expect(screen.queryByText('常规款')).not.toBeTruthy()
      expect(screen.queryByText('加厚款')).not.toBeTruthy()
      expect(screen.getByText('有底无侧普通袋', { selector: 'span' })).toBeTruthy()
      // 其他款式不受影响
      expect(screen.getByText('侧底款')).toBeTruthy()

      // 再点击展开恢复
      fireEvent.click(screen.getByText('有底无侧普通袋', { selector: 'span' }).closest('button')!)
      expect(screen.getByText('常规款')).toBeTruthy()
      expect(screen.getByText('加厚款')).toBeTruthy()
    })
  })

  describe('字段查询（与订单列表一致）', () => {
    it('按模板名称搜索：仅显示命中的模板，无命中的款式组隐藏', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText('搜索模板名称/款式/更新人...'), {
        target: { value: '加厚' },
      })

      // 命中：加厚款所在的款式2 分组
      expect(screen.getByText('加厚款')).toBeTruthy()
      // 未命中：款式2 的另一模板与款式3 模板均隐藏
      expect(screen.queryByText('常规款')).not.toBeTruthy()
      expect(screen.queryByText('侧底款')).not.toBeTruthy()
      // 无模板的款式组（款式1/4/5/6）整体隐藏
      expect(screen.queryByText('无底无侧普通袋', { selector: 'span' })).not.toBeTruthy()
    })

    it('按款式名称搜索：展示该款式全部模板', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText('搜索模板名称/款式/更新人...'), {
        target: { value: '有底有侧' },
      })

      // 款式名命中 → 该款式全部模板显示
      expect(screen.getByText('侧底款')).toBeTruthy()
      // 其他款式组与模板隐藏
      expect(screen.queryByText('常规款')).not.toBeTruthy()
      expect(screen.queryByText('加厚款')).not.toBeTruthy()
    })

    it('按更新人搜索', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText('搜索模板名称/款式/更新人...'), {
        target: { value: 'operator' },
      })

      expect(screen.getByText('加厚款')).toBeTruthy()
      expect(screen.queryByText('常规款')).not.toBeTruthy()
    })

    it('款式下拉筛选：仅显示选中款式的分组', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      fireEvent.change(screen.getByDisplayValue('全部款式'), { target: { value: '3' } })

      expect(screen.getByText('有底有侧普通袋', { selector: 'span' })).toBeTruthy()
      expect(screen.getByText('侧底款')).toBeTruthy()
      expect(screen.queryByText('有底无侧普通袋', { selector: 'span' })).not.toBeTruthy()
      expect(screen.queryByText('常规款')).not.toBeTruthy()
    })

    it('无匹配结果显示空态', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      fireEvent.change(screen.getByPlaceholderText('搜索模板名称/款式/更新人...'), {
        target: { value: '不存在的模板名' },
      })

      expect(screen.getByText('未找到匹配的模板')).toBeTruthy()
    })
  })

  describe('权限控制', () => {
    it('无编辑权限：不显示新增按钮，编辑按钮禁用', async () => {
      permissionMock.hasPermission.mockReturnValue(false)
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())

      expect(screen.queryByText('新增模板')).not.toBeTruthy()
      expect(screen.queryByText('立即创建')).not.toBeTruthy()
      // 编辑按钮存在但禁用
      const editBtn = screen.getAllByText('编辑')[0].closest('button')! as HTMLButtonElement
      expect(editBtn.disabled).toBe(true)
    })
  })

  describe('新增模板弹窗', () => {
    const NAME_PLACEHOLDER = '如：常规报价、加厚款、含手提款'

    async function openCreateModal() {
      renderPage()
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())
      fireEvent.click(screen.getByText('新增模板', { selector: 'button' }))
      await waitFor(() => expect(screen.getByText('新增模板', { selector: 'h2' })).toBeTruthy())
    }

    /** 提交按钮（"创建并编辑"） */
    const submitBtn = () =>
      screen.getByRole('button', { name: '创建并编辑' }) as HTMLButtonElement

    /** 切换弹窗内的款式选择（默认款式 1） */
    function selectStyle(code: string) {
      fireEvent.change(screen.getByDisplayValue('无底无侧普通袋'), { target: { value: code } })
    }

    it('名称为空时提交按钮禁用，无法提交', async () => {
      await openCreateModal()

      expect(submitBtn().disabled).toBe(true)
      expect(apiMock.sheetTemplates.create).not.toHaveBeenCalled()
    })

    it('同款式同名模板提示冲突且提交按钮禁用', async () => {
      await openCreateModal()

      // 款式2 下已存在"常规款"：先切换款式再输入同名
      selectStyle('2')
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), { target: { value: '常规款' } })

      // 前端即时冲突提示
      expect(await screen.findByText('该款式下已存在同名模板')).toBeTruthy()
      expect(submitBtn().disabled).toBe(true)
      expect(apiMock.sheetTemplates.create).not.toHaveBeenCalled()
    })

    it('跨款式同名不冲突：款式1 可创建与款式2 同名的模板', async () => {
      await openCreateModal()

      // 保持默认款式1（款式2 已有"常规款"，跨款式允许同名）
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), { target: { value: '常规款' } })

      expect(screen.queryByText('该款式下已存在同名模板')).toBeNull()
      expect(submitBtn().disabled).toBe(false)
    })

    it('点击遮罩关闭弹窗', async () => {
      const { container } = render(<SheetTemplates />)
      await waitFor(() => expect(screen.getByText('常规款')).toBeTruthy())
      fireEvent.click(screen.getByText('新增模板', { selector: 'button' }))
      await waitFor(() => expect(screen.getByText('新增模板', { selector: 'h2' })).toBeTruthy())

      // 点击最外层遮罩（内容框 stopPropagation，需直接点击遮罩层）
      fireEvent.click(container.querySelector('.fixed')!)
      expect(screen.queryByText('所属款式')).toBeNull()
    })

    it('创建成功：按所选款式调用 create 并同步缓存', async () => {
      await openCreateModal()

      const created = tpl('tpl-new', '2', '新模板')
      apiMock.sheetTemplates.create.mockResolvedValue(created)

      selectStyle('2')
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: '新模板' },
      })
      fireEvent.click(submitBtn())

      await waitFor(() => {
        expect(apiMock.sheetTemplates.create).toHaveBeenCalledWith({
          styleCode: '2',
          name: '新模板',
          data: [[null]],
          formulas: {},
        })
      })
      // 同步内存缓存：订单页立即可选
      expect(managerMock.setOverride).toHaveBeenCalledWith('tpl-new', '2', '新模板', {
        data: [[null]], formulas: {},
      })
    })

    it('回归：创建成功进入编辑器后返回列表，弹窗不再重复弹出', async () => {
      await openCreateModal()

      apiMock.sheetTemplates.create.mockResolvedValue(tpl('tpl-new', '2', '新模板'))
      selectStyle('2')
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: '新模板' },
      })
      fireEvent.click(submitBtn())

      // 进入编辑器（显示返回按钮）
      await waitFor(() => expect(screen.getByText('返回列表')).toBeTruthy())

      // 从编辑器返回列表
      fireEvent.click(screen.getByText('返回列表'))

      // 弹窗必须保持关闭（修复前 showCreateModal 未重置会再次弹出）
      await waitFor(() => expect(screen.getByText('新增模板', { selector: 'button' })).toBeTruthy()) // 列表头部按钮
      expect(screen.queryByText('新增模板', { selector: 'h2' })).toBeNull()
      // 新模板出现在列表中
      expect(screen.getByText('新模板')).toBeTruthy()
    })

    it('创建失败时显示错误信息且弹窗保持打开', async () => {
      await openCreateModal()

      apiMock.sheetTemplates.create.mockRejectedValue(new Error('服务器错误'))
      fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
        target: { value: '失败模板' },
      })
      fireEvent.click(submitBtn())

      expect(await screen.findByText('服务器错误')).toBeTruthy()
      // 弹窗仍在（可重试）
      expect(screen.getByText('新增模板', { selector: 'h2' })).toBeTruthy()
    })
  })
})
