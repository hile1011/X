/**
 * 产品成本项配置 - 可选工艺手动排序（db.productCostItems.reorderProcesses）单元测试
 *
 * 测试目标：
 *   - 按传入顺序整体重写 sort_order 为 1..N，getById 按新顺序返回工艺列表
 *   - 集合一致性校验：漏传 / 多传 / 重复 id / 混入其他成本项工艺时抛错且不改动任何序号
 *   - 成本项不存在返回 null
 *   - 幂等：重复调用同序无变化
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至最新版本。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

beforeAll(async () => {
  // 确保 schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
  await db.runner.migrate()
  // 重置数据：确保权限目录/角色为干净的种子状态
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

/** 查询指定成本项下工艺的当前序号列表（按 sort_order 排序返回 [id, sort_order]） */
async function fetchProcessOrders(costItemId: string): Promise<{ id: string; sortOrder: number }[]> {
  const [rows] = await pool.execute(
    'SELECT id, sort_order FROM product_cost_processes WHERE cost_item_id = ? ORDER BY sort_order ASC',
    [costItemId],
  )
  return (rows as any[]).map((r) => ({ id: String(r.id), sortOrder: Number(r.sort_order) }))
}

/** 造数：一个成本项 + N 个工艺（按创建顺序 sort_order 1..N），返回 { itemId, processIds } */
async function seedItemWithProcesses(name: string, processNames: string[]): Promise<{ itemId: string; processIds: string[] }> {
  const item = await db.productCostItems.createItem(name)
  const processIds: string[] = []
  for (const pname of processNames) {
    const created = await db.productCostItems.createProcess(item.id, { name: pname })
    processIds.push(created!.id)
  }
  return { itemId: item.id, processIds }
}

describe('可选工艺手动排序 - reorderProcesses', () => {
  it('按传入顺序整体重写 sort_order 为 1..N，getById 返回新顺序', async () => {
    const { itemId, processIds } = await seedItemWithProcesses('排序-正常', ['甲', '乙', '丙'])
    const [a, b, c] = processIds

    // 完全倒序
    const updated = await db.productCostItems.reorderProcesses(itemId, [c, a, b])
    expect(updated).not.toBeNull()
    expect(updated!.processes.map((p) => p.id)).toEqual([c, a, b])

    const orders = await fetchProcessOrders(itemId)
    expect(orders.map((o) => o.id)).toEqual([c, a, b])
    // 序号连续 1..N（不留洞、不重复）
    expect(orders.map((o) => o.sortOrder)).toEqual([1, 2, 3])
  })

  it('漏传一个工艺 id 时抛错且不改动任何序号', async () => {
    const { itemId, processIds } = await seedItemWithProcesses('排序-漏传', ['甲', '乙', '丙'])
    const before = await fetchProcessOrders(itemId)

    await expect(db.productCostItems.reorderProcesses(itemId, processIds.slice(1)))
      .rejects.toThrow('工艺排序列表与当前配置不一致')

    expect(await fetchProcessOrders(itemId)).toEqual(before)
  })

  it('重复 id 抛错', async () => {
    const { itemId, processIds } = await seedItemWithProcesses('排序-重复', ['甲', '乙'])
    await expect(db.productCostItems.reorderProcesses(itemId, [processIds[0], processIds[0]]))
      .rejects.toThrow('工艺排序列表存在重复 id')
  })

  it('混入其他成本项的工艺 id 时抛错且不改动任何序号', async () => {
    const main = await seedItemWithProcesses('排序-主项', ['甲', '乙'])
    const other = await seedItemWithProcesses('排序-他项', ['丙'])
    const before = await fetchProcessOrders(main.itemId)

    await expect(
      db.productCostItems.reorderProcesses(main.itemId, [main.processIds[0], other.processIds[0], main.processIds[1]]),
    ).rejects.toThrow('工艺排序列表与当前配置不一致')

    expect(await fetchProcessOrders(main.itemId)).toEqual(before)
  })

  it('成本项不存在返回 null', async () => {
    expect(await db.productCostItems.reorderProcesses('pci-not-exist', ['x'])).toBeNull()
  })

  it('幂等：重复调用同序无变化', async () => {
    const { itemId, processIds } = await seedItemWithProcesses('排序-幂等', ['甲', '乙', '丙'])
    const first = await db.productCostItems.reorderProcesses(itemId, processIds)
    const second = await db.productCostItems.reorderProcesses(itemId, processIds)
    expect(second!.processes.map((p) => p.id)).toEqual(first!.processes.map((p) => p.id))
    expect((await fetchProcessOrders(itemId)).map((o) => o.sortOrder)).toEqual([1, 2, 3])
  })

  it('新增工艺排在当前末尾（与手动排序共存）', async () => {
    const { itemId, processIds } = await seedItemWithProcesses('排序-追加', ['甲', '乙'])
    // 手动把乙移到最前
    await db.productCostItems.reorderProcesses(itemId, [processIds[1], processIds[0]])
    // 再新增丙：sort_order = MAX+1，仍排在末尾
    const created = await db.productCostItems.createProcess(itemId, { name: '丙' })
    const orders = await fetchProcessOrders(itemId)
    expect(orders.map((o) => o.id)).toEqual([processIds[1], processIds[0], created!.id])
    expect(orders.map((o) => o.sortOrder)).toEqual([1, 2, 3])
  })
})
