/**
 * 历史记录清理逻辑 单元测试（mock 数据库）
 * 测试目标：api/services/quoteHistory.ts cleanupOldHistory
 *
 * 通过 mock pool 覆盖真实 MySQL 无法触发的防御性分支：
 *   - COUNT 结果集为空（countRows[0]?.cnt ?? 0 兜底）
 *   - DELETE 结果缺少 affectedRows（?? 0 兜底）
 *   - 分批删除多轮循环（affected === BATCH 继续 / affected === 0 终止）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('../api/dbClient.js', () => ({
  pool: { query: queryMock },
}))

import { cleanupOldHistory } from '../api/services/quoteHistory.js'

beforeEach(() => {
  queryMock.mockReset()
})

describe('cleanupOldHistory - 防御性分支（mock pool）', () => {
  it('COUNT 结果集为空时按 0 处理，直接返回', async () => {
    queryMock.mockResolvedValueOnce([[]]) // countRows 为空数组

    const result = await cleanupOldHistory(30, false)

    expect(result).toEqual({ expired: 0, deleted: 0, retainDays: 30, dryRun: false })
    expect(queryMock).toHaveBeenCalledTimes(1) // 未进入删除分支
  })

  it('DELETE 结果缺少 affectedRows 时按 0 处理并终止循环', async () => {
    queryMock
      .mockResolvedValueOnce([[{ cnt: 5 }]]) // 过期 5 条
      .mockResolvedValueOnce([[{}]]) // 无 affectedRows 字段 → ?? 0

    const result = await cleanupOldHistory(30, false)

    expect(result.expired).toBe(5)
    expect(result.deleted).toBe(0)
    expect(queryMock).toHaveBeenCalledTimes(2) // 仅一轮删除尝试
  })

  it('affectedRows 达到单批上限时继续下一轮，不足一批时终止', async () => {
    queryMock
      .mockResolvedValueOnce([[{ cnt: 1500 }]]) // 过期 1500 条
      .mockResolvedValueOnce([{ affectedRows: 1000 }]) // 第一批满额 → 继续
      .mockResolvedValueOnce([{ affectedRows: 500 }]) // 第二批不足 → 终止

    const result = await cleanupOldHistory(30, false)

    expect(result.expired).toBe(1500)
    expect(result.deleted).toBe(1500)
    expect(queryMock).toHaveBeenCalledTimes(3) // 1 次 COUNT + 2 轮 DELETE
    // 第二轮 DELETE 仍带 LIMIT 1000
    const secondDeleteArgs = queryMock.mock.calls[2][1] as number[]
    expect(secondDeleteArgs).toEqual([30, 1000])
  })

  it('整批删除后下一轮 affectedRows 为 0 时终止（added===0 break）', async () => {
    queryMock
      .mockResolvedValueOnce([[{ cnt: 1000 }]])
      .mockResolvedValueOnce([{ affectedRows: 1000 }]) // 恰好一批 → 继续
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // 下一轮无剩余 → 终止

    const result = await cleanupOldHistory(7, false)

    expect(result.expired).toBe(1000)
    expect(result.deleted).toBe(1000)
    expect(result.retainDays).toBe(7)
  })

  it('dryRun 时统计后直接返回，不执行 DELETE', async () => {
    queryMock.mockResolvedValueOnce([[{ cnt: 42 }]])

    const result = await cleanupOldHistory(30, true)

    expect(result).toEqual({ expired: 42, deleted: 0, retainDays: 30, dryRun: true })
    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
