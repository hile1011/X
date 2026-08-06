/**
 * 删除守卫服务
 *
 * 在执行删除操作前，自动检测该数据是否存在关联关系：
 *   - 被其他数据表作为外键引用
 *   - 在业务流程中处于活跃使用状态
 *   - 与其他关键数据存在逻辑关联
 *
 * 若检测到任何关联关系，阻止删除并返回具体的关联信息。
 */
import { pool } from '../dbClient.js'

export interface RelationshipCheck {
  table: string                 // 关联表名
  description: string           // 关联描述
  count: number                 // 关联记录数
  samples: Array<Record<string, any>>  // 关联记录样本（最多3条）
}

export interface DeleteCheckResult {
  canDelete: boolean
  entityInfo: {
    id: string
    name: string
    type: string
    details: string             // 额外描述信息
  }
  relationships: RelationshipCheck[]
}

/**
 * 检查客户是否可删除
 * 关联：quotes.customerName → customers.name, orders.customer_id → customers.id
 */
export async function checkCustomerDelete(id: string): Promise<DeleteCheckResult> {
  // 获取客户信息
  const [customerRows] = await pool.execute(
    'SELECT id, name, contact_person, phone FROM customers WHERE id = ?',
    [id]
  )
  const customer = (customerRows as any[])[0]

  if (!customer) {
    return {
      canDelete: false,
      entityInfo: { id, name: '(不存在)', type: 'customer', details: '' },
      relationships: [],
    }
  }

  const relationships: RelationshipCheck[] = []

  // 检查 quotes 中引用了该客户名称的报价单
  const [quoteRows] = await pool.execute(
    'SELECT id, quote_number, customerName, status FROM quotes WHERE customerName = ? LIMIT 3',
    [customer.name]
  )
  const [quoteCount] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM quotes WHERE customerName = ?',
    [customer.name]
  )
  const quoteCnt = (quoteCount as any[])[0].cnt
  if (quoteCnt > 0) {
    relationships.push({
      table: 'quotes',
      description: `有 ${quoteCnt} 个报价/订单引用了该客户（通过客户名称"${customer.name}"）`,
      count: quoteCnt,
      samples: quoteRows as any[],
    })
  }

  // 检查 orders 中引用了该客户的订单
  const [orderRows] = await pool.execute(
    'SELECT id, order_number, customer_id FROM orders WHERE customer_id = ? LIMIT 3',
    [id]
  )
  const [orderCount] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM orders WHERE customer_id = ?',
    [id]
  )
  const orderCnt = (orderCount as any[])[0].cnt
  if (orderCnt > 0) {
    relationships.push({
      table: 'orders',
      description: `有 ${orderCnt} 个订单引用了该客户`,
      count: orderCnt,
      samples: orderRows as any[],
    })
  }

  return {
    canDelete: relationships.length === 0,
    entityInfo: {
      id: customer.id,
      name: customer.name,
      type: 'customer',
      details: `联系人: ${customer.contact_person || '无'} | 电话: ${customer.phone || '无'}`,
    },
    relationships,
  }
}

/**
 * 检查产品是否可删除
 * 关联：quotes.productStyle → products.code, order_items.product_id → products.id
 * 保护：默认款式（style-1 至 style-6）不可删除
 */
export async function checkProductDelete(id: string): Promise<DeleteCheckResult> {
  // 获取产品信息
  const [productRows] = await pool.execute(
    'SELECT id, name, code, sku FROM products WHERE id = ?',
    [id]
  )
  const product = (productRows as any[])[0]

  if (!product) {
    return {
      canDelete: false,
      entityInfo: { id, name: '(不存在)', type: 'product', details: '' },
      relationships: [],
    }
  }

  // 默认款式保护
  const isDefaultStyle = id.startsWith('style-') && ['style-1','style-2','style-3','style-4','style-5','style-6'].includes(id)
  if (isDefaultStyle) {
    return {
      canDelete: false,
      entityInfo: {
        id: product.id,
        name: product.name,
        type: 'product',
        details: `编码: ${product.code} | SKU: ${product.sku}`,
      },
      relationships: [{
        table: 'system',
        description: '默认款式受系统保护，不可删除（style-1 至 style-6 为系统内置款式）',
        count: 1,
        samples: [],
      }],
    }
  }

  const relationships: RelationshipCheck[] = []

  // 检查 quotes 中引用了该产品（通过 productStyle = code 或 id）
  const styleValue = product.code || product.id
  const [quoteRows] = await pool.execute(
    'SELECT id, quote_number, customerName, productStyle, status FROM quotes WHERE productStyle = ? LIMIT 3',
    [styleValue]
  )
  const [quoteCount] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM quotes WHERE productStyle = ?',
    [styleValue]
  )
  const quoteCnt = (quoteCount as any[])[0].cnt
  if (quoteCnt > 0) {
    relationships.push({
      table: 'quotes',
      description: `有 ${quoteCnt} 个报价/订单使用了该款式（productStyle = "${styleValue}"）`,
      count: quoteCnt,
      samples: quoteRows as any[],
    })
  }

  // 检查 order_items 中引用了该产品
  const [itemRows] = await pool.execute(
    'SELECT id, order_id, product_id FROM order_items WHERE product_id = ? LIMIT 3',
    [id]
  )
  const [itemCount] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM order_items WHERE product_id = ?',
    [id]
  )
  const itemCnt = (itemCount as any[])[0].cnt
  if (itemCnt > 0) {
    relationships.push({
      table: 'order_items',
      description: `有 ${itemCnt} 个订单明细引用了该产品`,
      count: itemCnt,
      samples: itemRows as any[],
    })
  }

  return {
    canDelete: relationships.length === 0,
    entityInfo: {
      id: product.id,
      name: product.name,
      type: 'product',
      details: `编码: ${product.code || '无'} | SKU: ${product.sku || '无'}`,
    },
    relationships,
  }
}

/**
 * 检查报价/订单是否可删除
 * 报价单本身通常不被其他表引用，可以直接删除
 */
export async function checkQuoteDelete(id: string): Promise<DeleteCheckResult> {
  const [quoteRows] = await pool.execute(
    'SELECT id, quote_number, customerName, productStyle, status FROM quotes WHERE id = ?',
    [id]
  )
  const quote = (quoteRows as any[])[0]

  if (!quote) {
    return {
      canDelete: false,
      entityInfo: { id, name: '(不存在)', type: 'quote', details: '' },
      relationships: [],
    }
  }

  const statusNames: Record<number, string> = {
    1: '报价中', 2: '打样中', 3: '做货中', 4: '已发货未收款', 5: '已发货已收款', 6: '结束',
  }

  return {
    canDelete: true,
    entityInfo: {
      id: quote.id,
      name: quote.quote_number || quote.customerName || quote.id,
      type: 'quote',
      details: `客户: ${quote.customerName} | 款式: ${quote.productStyle} | 状态: ${statusNames[quote.status] || quote.status}`,
    },
    relationships: [],
  }
}

/**
 * 检查订单是否可删除
 * 关联：order_items.order_id, tasks.order_id
 */
export async function checkOrderDelete(id: string): Promise<DeleteCheckResult> {
  const [orderRows] = await pool.execute(
    'SELECT id, order_number, customer_id, status FROM orders WHERE id = ?',
    [id]
  )
  const order = (orderRows as any[])[0]

  if (!order) {
    return {
      canDelete: false,
      entityInfo: { id, name: '(不存在)', type: 'order', details: '' },
      relationships: [],
    }
  }

  const relationships: RelationshipCheck[] = []

  // order_items 会在删除时级联删除，不算阻止原因，但提示用户
  const [itemCount] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM order_items WHERE order_id = ?',
    [id]
  )
  const itemCnt = (itemCount as any[])[0].cnt
  if (itemCnt > 0) {
    relationships.push({
      table: 'order_items',
      description: `有 ${itemCnt} 个订单明细将一并删除（级联删除）`,
      count: itemCnt,
      samples: [],
    })
  }

  // tasks 引用 → 阻止删除
  const [taskRows] = await pool.execute(
    'SELECT id, title, status FROM tasks WHERE order_id = ? LIMIT 3',
    [id]
  )
  const [taskCount] = await pool.execute(
    'SELECT COUNT(*) as cnt FROM tasks WHERE order_id = ?',
    [id]
  )
  const taskCnt = (taskCount as any[])[0].cnt
  if (taskCnt > 0) {
    relationships.push({
      table: 'tasks',
      description: `有 ${taskCnt} 个跟单任务关联了该订单，请先删除或解除关联`,
      count: taskCnt,
      samples: taskRows as any[],
    })
  }

  // 只有 tasks 关联才会阻止删除（order_items 是级联删除）
  const hasBlockingRelations = taskCnt > 0

  return {
    canDelete: !hasBlockingRelations,
    entityInfo: {
      id: order.id,
      name: order.order_number || order.id,
      type: 'order',
      details: `状态: ${order.status}`,
    },
    relationships,
  }
}

/**
 * 检查任务是否可删除
 * 任务通常不被其他表引用，可以直接删除
 */
export async function checkTaskDelete(id: string): Promise<DeleteCheckResult> {
  const [taskRows] = await pool.execute(
    'SELECT id, title, order_id, status FROM tasks WHERE id = ?',
    [id]
  )
  const task = (taskRows as any[])[0]

  if (!task) {
    return {
      canDelete: false,
      entityInfo: { id, name: '(不存在)', type: 'task', details: '' },
      relationships: [],
    }
  }

  return {
    canDelete: true,
    entityInfo: {
      id: task.id,
      name: task.title || task.id,
      type: 'task',
      details: `关联订单: ${task.order_id || '无'} | 状态: ${task.status}`,
    },
    relationships: [],
  }
}

/**
 * 检查工艺成本是否可删除
 * 工艺成本通常不被其他表引用，可以直接删除
 */
export async function checkProcessCostDelete(id: string): Promise<DeleteCheckResult> {
  const [costRows] = await pool.execute(
    'SELECT id, name, category FROM process_costs WHERE id = ?',
    [id]
  )
  const cost = (costRows as any[])[0]

  if (!cost) {
    return {
      canDelete: false,
      entityInfo: { id, name: '(不存在)', type: 'process_cost', details: '' },
      relationships: [],
    }
  }

  return {
    canDelete: true,
    entityInfo: {
      id: cost.id,
      name: cost.name || cost.id,
      type: 'process_cost',
      details: `分类: ${cost.category || '无'}`,
    },
    relationships: [],
  }
}

/**
 * 统一入口：根据实体类型调用对应的检查函数
 */
export async function checkDelete(
  entityType: string,
  id: string
): Promise<DeleteCheckResult> {
  switch (entityType) {
    case 'customer':
      return checkCustomerDelete(id)
    case 'product':
      return checkProductDelete(id)
    case 'quote':
      return checkQuoteDelete(id)
    case 'order':
      return checkOrderDelete(id)
    case 'task':
      return checkTaskDelete(id)
    case 'process_cost':
      return checkProcessCostDelete(id)
    default:
      return {
        canDelete: false,
        entityInfo: { id, name: '', type: entityType, details: '' },
        relationships: [{
          table: 'system',
          description: `未知的实体类型: ${entityType}`,
          count: 1,
          samples: [],
        }],
      }
  }
}
