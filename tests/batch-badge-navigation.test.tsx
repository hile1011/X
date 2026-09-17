/**
 * 批次号徽标（v36）导航行为 前端组件测试
 *
 * 测试目标（返回导航与批次号管理解耦）：
 *   1. 批次内跳转调用 navigate(path, { replace: true })——替换当前历史记录而非压栈，
 *      编辑页「返回」（navigate(-1)）始终回到进入编辑页前的来源页，不被同批次切换链污染
 *   2. canEdit=true 跳编辑页 /quotes/:id/edit；canEdit=false 跳查看页 /quotes/:id
 *   3. 浮层只显示同批次订单（跨批次/无批次订单被过滤）
 *   4. 点击浮层外部仅关闭浮层，不触发任何导航（批次号状态不受返回动作影响）
 *   5. 当前订单带「当前」高亮标记
 *
 * Mock 说明：
 *   - api：隔离网络，getAll 返回固定多批次订单数据
 *   - useNavigate：捕获导航调用参数，直接断言 replace 语义（无需真实 Router）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BatchBadge } from '../src/components/BatchBadge'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  quotes: {
    getAll: vi.fn(),
  },
}))

/** 捕获 navigate(path, options) 调用，用于断言 replace 语义 */
const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('../src/api', () => ({ api: apiMock }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  }
})

// ============================ 测试数据 ============================

const BATCH = 'PN-20260917120000'

const allOrders = [
  { id: 'q1', quote_number: '1111111111111111', customerName: '客户甲', status: 3, batchNumber: BATCH },
  { id: 'q2', quote_number: '2222222222222222', customerName: '客户乙', status: 4, batchNumber: BATCH },
  { id: 'q3', quote_number: '3333333333333333', customerName: '客户丙', status: 1, batchNumber: null },
  { id: 'q4', quote_number: '4444444444444444', customerName: '客户丁', status: 5, batchNumber: 'PN-20260917150000' },
]

/** 渲染 BatchBadge（useNavigate 已 mock，无需 Router 包裹） */
function renderBadge(currentId = 'q1', canEdit = true) {
  return render(<BatchBadge batchNumber={BATCH} currentId={currentId} canEdit={canEdit} />)
}

/** 展开浮层并等待同批次订单加载完成 */
async function openAndWait() {
  fireEvent.click(screen.getByTitle(`批次 ${BATCH}（点击查看同批次订单）`))
  await waitFor(() => expect(screen.getByText('2222222222222222')).toBeTruthy())
}

beforeEach(() => {
  apiMock.quotes.getAll.mockReset().mockResolvedValue(allOrders)
  navigateSpy.mockClear()
})

afterEach(() => {
  cleanup() // vitest globals:false 无自动清理
  vi.clearAllMocks()
})

// ============================================================
// 批次内跳转与返回导航解耦
// ============================================================
describe('BatchBadge - 批次内跳转与返回导航解耦', () => {
  it('跳转同批次订单使用 replace（不压历史栈）：返回始终回来源页，不受批次切换影响', async () => {
    renderBadge()
    await openAndWait()

    // 点击同批次另一订单 q2
    fireEvent.click(screen.getByText('2222222222222222'))
    // 跳转目标为编辑页，且以 replace 替换当前历史记录（而非 push 压栈）
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/quotes/q2/edit', { replace: true })

    // 连续批次内切换（q2 → q1）仍为 replace：无论切换多少次，
    // 编辑页「返回」（navigate(-1)）都回到进入编辑页前的来源页
    fireEvent.click(screen.getByTitle(`批次 ${BATCH}（点击查看同批次订单）`))
    await waitFor(() => expect(screen.getByText('1111111111111111')).toBeTruthy())
    fireEvent.click(screen.getByText('1111111111111111'))
    expect(navigateSpy).toHaveBeenCalledTimes(2)
    expect(navigateSpy).toHaveBeenLastCalledWith('/quotes/q1/edit', { replace: true })
  })

  it('canEdit=false 时跳查看页（同样 replace）', async () => {
    renderBadge('q1', false)
    await openAndWait()

    fireEvent.click(screen.getByText('2222222222222222'))
    expect(navigateSpy).toHaveBeenCalledTimes(1)
    expect(navigateSpy).toHaveBeenCalledWith('/quotes/q2', { replace: true })
  })

  it('浮层展开期间点击外部（如返回按钮区域）：仅关闭浮层，不触发批次跳转', async () => {
    renderBadge()
    await openAndWait()
    expect(screen.getByText('同批次订单（2）')).toBeTruthy()

    // 浮层打开时点击外部（返回按钮所在区域）——浮层关闭且无任何批次导航发生
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('同批次订单（2）')).toBeNull())
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})

// ============================================================
// 浮层数据与状态
// ============================================================
describe('BatchBadge - 浮层数据与状态', () => {
  it('只显示同批次订单（跨批次/无批次订单被过滤），当前订单有标记', async () => {
    renderBadge()
    await openAndWait()

    // 同批次 q1/q2 显示；q3（无批次）、q4（其他批次）不显示
    expect(screen.getByText('1111111111111111')).toBeTruthy()
    expect(screen.getByText('2222222222222222')).toBeTruthy()
    expect(screen.queryByText('3333333333333333')).toBeNull()
    expect(screen.queryByText('4444444444444444')).toBeNull()
    // 当前订单标记
    expect(screen.getByText('当前')).toBeTruthy()
  })

  it('加载失败显示错误提示且不导航', async () => {
    apiMock.quotes.getAll.mockRejectedValueOnce(new Error('network'))
    renderBadge()
    fireEvent.click(screen.getByTitle(`批次 ${BATCH}（点击查看同批次订单）`))
    await waitFor(() => expect(screen.getByText('同批次订单加载失败，请重试')).toBeTruthy())
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
