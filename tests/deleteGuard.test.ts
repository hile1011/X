/**
 * 删除守卫服务 单元测试
 * 测试目标：api/services/deleteGuard.ts
 *   - checkCustomerDelete：客户被 quotes（按名称）/ orders（按 id）引用检测
 *   - checkProductDelete：默认款式保护 + quotes（按 code/id）/ order_items 引用检测
 *   - checkQuoteDelete：报价单始终可删 + 状态名映射
 *   - checkOrderDelete：order_items 级联提示 + tasks 阻断
 *   - checkTaskDelete：直接可删
 *   - checkProductCostItem/Process/FieldDelete（v31）：成本项级联提示 / 工艺直接可删 / 字段已录值提示
 *   - checkDelete：实体类型分发 + 未知类型
 *   - 实体不存在的统一处理
 *
 * 使用 MySQL 测试数据库，每个测试前 resetTestDatabase()。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { pool } from '../api/dbClient.js'
import { db } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'
import {
  checkCustomerDelete,
  checkProductDelete,
  checkQuoteDelete,
  checkOrderDelete,
  checkTaskDelete,
  checkProductCostItemDelete,
  checkProductCostProcessDelete,
  checkProductCostFieldDelete,
  checkDelete,
} from '../api/services/deleteGuard'

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
})

/** 插入客户 */
async function insertCustomer(id: string, name: string, contact = '联系人', phone = '13800000000') {
  await pool.execute(
    'INSERT INTO customers (id, name, contact_person, phone) VALUES (?, ?, ?, ?)',
    [id, name, contact, phone]
  )
}

/** 插入订单 */
async function insertOrder(id: string, customerId: string | null = null, orderNumber = `ORD-${id}`) {
  await pool.execute(
    'INSERT INTO orders (id, customer_id, order_number, status) VALUES (?, ?, ?, ?)',
    [id, customerId, orderNumber, 'pending']
  )
}

// ─── checkCustomerDelete ───────────────────────────────────────

describe('checkCustomerDelete - 客户删除检查', () => {
  it('无任何关联：可删除，返回联系人详情', async () => {
    await insertCustomer('c1', '自由客户')
    const result = await checkCustomerDelete('c1')
    expect(result.canDelete).toBe(true)
    expect(result.relationships).toHaveLength(0)
    expect(result.entityInfo).toMatchObject({ id: 'c1', name: '自由客户', type: 'customer' })
    expect(result.entityInfo.details).toContain('联系人: 联系人')
    expect(result.entityInfo.details).toContain('电话: 13800000000')
  })

  it('被报价单引用（customerName 匹配）：阻止并给出数量与样本', async () => {
    await insertCustomer('c1', '被报价客户')
    await db.quotes.create({ customerName: '被报价客户', productStyle: '1' })
    await db.quotes.create({ customerName: '被报价客户', productStyle: '1' })

    const result = await checkCustomerDelete('c1')
    expect(result.canDelete).toBe(false)
    expect(result.relationships).toHaveLength(1)
    expect(result.relationships[0].table).toBe('quotes')
    expect(result.relationships[0].count).toBe(2)
    expect(result.relationships[0].description).toContain('2 个报价/订单')
  })

  it('被订单引用（customer_id）：阻止', async () => {
    await insertCustomer('c1', '被下单客户')
    await insertOrder('o1', 'c1')

    const result = await checkCustomerDelete('c1')
    expect(result.canDelete).toBe(false)
    expect(result.relationships.some((r) => r.table === 'orders')).toBe(true)
    expect(result.relationships.find((r) => r.table === 'orders')!.count).toBe(1)
  })

  it('客户不存在：canDelete=false 且名称为 (不存在)', async () => {
    const result = await checkCustomerDelete('no-such-customer')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
    expect(result.relationships).toHaveLength(0)
  })

  it('联系人/电话为空时详情显示 无', async () => {
    await insertCustomer('c2', '简约客户', '', '')
    const result = await checkCustomerDelete('c2')
    expect(result.entityInfo.details).toContain('联系人: 无')
    expect(result.entityInfo.details).toContain('电话: 无')
  })
})

// ─── checkProductDelete ───────────────────────────────────────

describe('checkProductDelete - 产品删除检查', () => {
  it('默认款式（style-1 至 style-6）受系统保护：不可删除', async () => {
    const result = await checkProductDelete('style-3')
    expect(result.canDelete).toBe(false)
    expect(result.relationships).toHaveLength(1)
    expect(result.relationships[0].table).toBe('system')
    expect(result.relationships[0].description).toContain('系统内置款式')
  })

  it('style- 前缀但不在 1-6 范围：不触发默认款式保护', async () => {
    await pool.execute(
      "INSERT INTO products (id, name, code, sku) VALUES ('style-9', '自定义款', '9', 'SKU-9')"
    )
    const result = await checkProductDelete('style-9')
    // 未被引用 → 可删除
    expect(result.canDelete).toBe(true)
    expect(result.relationships).toHaveLength(0)
  })

  it('被报价单按 code 引用：阻止', async () => {
    await pool.execute(
      "INSERT INTO products (id, name, code, sku) VALUES ('p1', '产品一', '8', 'SKU-8')"
    )
    await db.quotes.create({ customerName: '客户A', productStyle: '8' })

    const result = await checkProductDelete('p1')
    expect(result.canDelete).toBe(false)
    expect(result.relationships.find((r) => r.table === 'quotes')!.count).toBe(1)
  })

  it('无 code 产品回退按 id 匹配 productStyle', async () => {
    await pool.execute(
      "INSERT INTO products (id, name, code, sku) VALUES ('p-no-code', '无码产品', '', 'SKU-X')"
    )
    await db.quotes.create({ customerName: '客户B', productStyle: 'p-no-code' })

    const result = await checkProductDelete('p-no-code')
    expect(result.canDelete).toBe(false)
    expect(result.relationships.find((r) => r.table === 'quotes')!.count).toBe(1)
  })

  it('被订单明细引用（order_items.product_id）：阻止', async () => {
    await pool.execute(
      "INSERT INTO products (id, name, code, sku) VALUES ('p2', '产品二', '9', 'SKU-9')"
    )
    await insertOrder('o1', 'c-any')
    await pool.execute(
      "INSERT INTO order_items (id, order_id, product_id, quantity) VALUES ('oi1', 'o1', 'p2', 10)"
    )

    const result = await checkProductDelete('p2')
    expect(result.canDelete).toBe(false)
    expect(result.relationships.find((r) => r.table === 'order_items')!.count).toBe(1)
  })

  it('产品不存在：canDelete=false', async () => {
    const result = await checkProductDelete('no-such-product')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })

  it('实体详情显示编码与 SKU（缺失时显示 无）', async () => {
    await pool.execute(
      "INSERT INTO products (id, name, code, sku) VALUES ('p3', '产品三', '', '')"
    )
    const result = await checkProductDelete('p3')
    expect(result.entityInfo.details).toContain('编码: 无')
    expect(result.entityInfo.details).toContain('SKU: 无')
  })
})

// ─── checkQuoteDelete ─────────────────────────────────────────

describe('checkQuoteDelete - 报价/订单删除检查', () => {
  it('报价单始终可删除（无外键引用）', async () => {
    const quote = await db.quotes.create({ customerName: '删除检查客户', productStyle: '1' })
    const result = await checkQuoteDelete(quote.id)
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.type).toBe('quote')
    expect(result.entityInfo.name).toBeTruthy()
  })

  it('详情包含客户/款式/状态名', async () => {
    const quote = await db.quotes.create({ customerName: '状态客户', productStyle: '1' })
    const result = await checkQuoteDelete(quote.id)
    expect(result.entityInfo.details).toContain('客户: 状态客户')
    expect(result.entityInfo.details).toContain('状态: 报价中')
  })

  it('未知状态号原样显示', async () => {
    const quote = await db.quotes.create({ customerName: '怪状态客户', productStyle: '1' })
    await pool.execute('UPDATE quotes SET status = 99 WHERE id = ?', [quote.id])
    const result = await checkQuoteDelete(quote.id)
    expect(result.entityInfo.details).toContain('状态: 99')
  })

  it('报价单不存在：canDelete=false', async () => {
    const result = await checkQuoteDelete('no-such-quote')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })
})

// ─── checkOrderDelete ─────────────────────────────────────────

describe('checkOrderDelete - 订单删除检查', () => {
  it('无任务关联：可删除', async () => {
    await insertOrder('o-free')
    const result = await checkOrderDelete('o-free')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('ORD-o-free')
  })

  it('仅订单明细：提示级联删除但不阻断', async () => {
    await insertOrder('o-items')
    await pool.execute(
      "INSERT INTO order_items (id, order_id, product_id, quantity) VALUES ('oi1', 'o-items', 'p-any', 5)"
    )
    const result = await checkOrderDelete('o-items')
    expect(result.canDelete).toBe(true)
    const rel = result.relationships.find((r) => r.table === 'order_items')
    expect(rel).toBeDefined()
    expect(rel!.description).toContain('级联删除')
  })

  it('被任务关联（tasks.order_id）：阻止', async () => {
    await insertOrder('o-tasks')
    await pool.execute(
      "INSERT INTO tasks (id, title, order_id, status) VALUES ('t1', '跟单任务', 'o-tasks', 'pending')"
    )
    const result = await checkOrderDelete('o-tasks')
    expect(result.canDelete).toBe(false)
    const rel = result.relationships.find((r) => r.table === 'tasks')
    expect(rel).toBeDefined()
    expect(rel!.description).toContain('请先删除或解除关联')
  })

  it('订单不存在：canDelete=false', async () => {
    const result = await checkOrderDelete('no-such-order')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })
})

// ─── checkTaskDelete / checkProcessCostDelete ─────────────────

describe('checkTaskDelete - 任务删除检查', () => {
  it('任务可直接删除，详情含关联订单', async () => {
    await pool.execute(
      "INSERT INTO tasks (id, title, order_id, status) VALUES ('t1', '某任务', 'o-1', 'done')"
    )
    const result = await checkTaskDelete('t1')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('某任务')
    expect(result.entityInfo.details).toContain('关联订单: o-1')
  })

  it('任务不存在：canDelete=false', async () => {
    const result = await checkTaskDelete('no-such-task')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })
})

describe('checkProductCostItemDelete - 产品成本项删除检查（v31）', () => {
  it('成本项可删除，详情与级联提示含工艺数与字段数', async () => {
    await pool.execute("INSERT INTO product_cost_items (id, name) VALUES ('pci-1', '印刷成本')")
    await pool.execute(
      "INSERT INTO product_cost_processes (id, cost_item_id, name, cost, formula) VALUES ('pcp-1', 'pci-1', 'UV印刷', 0.5, '宽*高*0.1')"
    )
    await pool.execute(
      "INSERT INTO product_cost_custom_fields (id, cost_item_id, name, field_type) VALUES ('pcf-1', 'pci-1', '适用数量', 'select')"
    )
    const result = await checkProductCostItemDelete('pci-1')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('印刷成本')
    expect(result.entityInfo.details).toContain('可选工艺: 1 个')
    expect(result.entityInfo.details).toContain('自定义字段: 1 个')
    // 级联删除提示（可删除但提示影响）
    expect(result.relationships).toHaveLength(2)
    expect(result.relationships[0].description).toContain('1 个可选工艺')
    expect(result.relationships[1].description).toContain('1 个自定义字段')
  })

  it('成本项不存在：canDelete=false', async () => {
    const result = await checkProductCostItemDelete('no-such-item')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })
})

describe('checkProductCostProcessDelete - 可选工艺删除检查（v31）', () => {
  it('工艺可直接删除，详情含成本金额与公式', async () => {
    await pool.execute("INSERT INTO product_cost_items (id, name) VALUES ('pci-1', '印刷成本')")
    await pool.execute(
      "INSERT INTO product_cost_processes (id, cost_item_id, name, cost, formula) VALUES ('pcp-1', 'pci-1', 'UV印刷', 0.5, '宽*高*0.1')"
    )
    const result = await checkProductCostProcessDelete('pcp-1')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('UV印刷')
    expect(result.entityInfo.details).toContain('成本金额: 0.5')
    expect(result.entityInfo.details).toContain('公式: 宽*高*0.1')
  })

  it('公式为空时显示 无', async () => {
    await pool.execute("INSERT INTO product_cost_items (id, name) VALUES ('pci-1', '印刷成本')")
    await pool.execute(
      "INSERT INTO product_cost_processes (id, cost_item_id, name, cost, formula) VALUES ('pcp-2', 'pci-1', '覆膜', 100, '')"
    )
    const result = await checkProductCostProcessDelete('pcp-2')
    expect(result.entityInfo.details).toContain('公式: 无')
  })

  it('工艺不存在：canDelete=false', async () => {
    const result = await checkProductCostProcessDelete('no-such-process')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })
})

describe('checkProductCostFieldDelete - 自定义字段删除检查（v31）', () => {
  it('字段可删除，已录值的工艺数作为级联提示', async () => {
    await pool.execute("INSERT INTO product_cost_items (id, name) VALUES ('pci-1', '印刷成本')")
    await pool.execute(
      "INSERT INTO product_cost_custom_fields (id, cost_item_id, name, field_type, options) VALUES ('pcf-1', 'pci-1', '适用数量', 'select', '[\"小批量\",\"大批量\"]')"
    )
    await pool.execute(
      "INSERT INTO product_cost_processes (id, cost_item_id, name, custom_values) VALUES ('pcp-1', 'pci-1', 'UV印刷', '{\"pcf-1\":\"小批量\"}')"
    )
    await pool.execute(
      "INSERT INTO product_cost_processes (id, cost_item_id, name) VALUES ('pcp-2', 'pci-1', '丝网印刷')"
    )
    const result = await checkProductCostFieldDelete('pcf-1')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('适用数量')
    expect(result.entityInfo.details).toContain('类型: select')
    // 仅 1 个工艺录入了该字段值
    expect(result.relationships).toHaveLength(1)
    expect(result.relationships[0].description).toContain('1 个可选工艺已录入该字段值')
  })

  it('字段未录入任何值时无级联提示', async () => {
    await pool.execute("INSERT INTO product_cost_items (id, name) VALUES ('pci-1', '印刷成本')")
    await pool.execute(
      "INSERT INTO product_cost_custom_fields (id, cost_item_id, name, field_type) VALUES ('pcf-2', 'pci-1', '最小起订量', 'number')"
    )
    const result = await checkProductCostFieldDelete('pcf-2')
    expect(result.canDelete).toBe(true)
    expect(result.relationships).toHaveLength(0)
  })

  it('字段不存在：canDelete=false', async () => {
    const result = await checkProductCostFieldDelete('no-such-field')
    expect(result.canDelete).toBe(false)
    expect(result.entityInfo.name).toBe('(不存在)')
  })
})

// ─── 实体详情字段缺失回退 ─────────────────────────────────────

describe('实体详情字段缺失回退', () => {
  it('客户联系人/电话为 NULL 时显示 无', async () => {
    await pool.execute(
      "INSERT INTO customers (id, name, contact_person, phone) VALUES ('c-null', '无联系客户', NULL, NULL)"
    )
    const result = await checkCustomerDelete('c-null')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.details).toBe('联系人: 无 | 电话: 无')
  })

  it('订单号为空串时名称回退订单 id', async () => {
    await insertOrder('o-empty-num', null, '')
    const result = await checkOrderDelete('o-empty-num')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('o-empty-num')
  })

  it('任务标题为空串时名称回退 id，关联订单为 NULL 时显示 无', async () => {
    await pool.execute(
      "INSERT INTO tasks (id, title, order_id, status) VALUES ('t-empty', '', NULL, 'pending')"
    )
    const result = await checkTaskDelete('t-empty')
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe('t-empty')
    expect(result.entityInfo.details).toBe('关联订单: 无 | 状态: pending')
  })

  it('报价单订单号与客户名为空串时名称回退 id', async () => {
    const quote = await db.quotes.create({ customerName: '回退客户', productStyle: '1' })
    await pool.execute(
      "UPDATE quotes SET quote_number = '', customerName = '' WHERE id = ?",
      [quote.id]
    )
    const result = await checkQuoteDelete(quote.id)
    expect(result.canDelete).toBe(true)
    expect(result.entityInfo.name).toBe(quote.id)
  })
})

// ─── checkDelete 统一分发 ────────────────────────────────────

describe('checkDelete - 统一入口分发', () => {
  it.each([
    ['customer', checkCustomerDelete],
    ['product', checkProductDelete],
    ['quote', checkQuoteDelete],
    ['order', checkOrderDelete],
    ['task', checkTaskDelete],
    ['product_cost_item', checkProductCostItemDelete],
    ['product_cost_process', checkProductCostProcessDelete],
    ['product_cost_field', checkProductCostFieldDelete],
  ] as const)('实体类型 %s 分发到对应检查函数', async (type, fn) => {
    const viaEntry = await checkDelete(type, `probe-${type}`)
    const direct = await fn(`probe-${type}`)
    expect(viaEntry.canDelete).toBe(direct.canDelete)
    expect(viaEntry.entityInfo.name).toBe(direct.entityInfo.name)
    expect(viaEntry.entityInfo.type).toBe(direct.entityInfo.type)
  })

  it('未知实体类型：返回 system 阻断关系', async () => {
    const result = await checkDelete('unknown-type', 'x1')
    expect(result.canDelete).toBe(false)
    expect(result.relationships[0].description).toContain('未知的实体类型: unknown-type')
  })
})
