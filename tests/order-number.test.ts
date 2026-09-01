/**
 * 订单号（quote_number）16位随机数字生成机制 全面单元测试
 *
 * 覆盖目标（对应需求：16位随机数、全局唯一、防重复校验、复制生成新号、订单号不变性）：
 *   1. 生成格式：16位纯数字
 *   2. 全局唯一性：批量创建互不重复、与存量订单号不冲突
 *   3. 防重复校验：碰撞后重试（mock Math.random 强制碰撞）、重试耗尽走时间戳兜底
 *   4. 不变性：update（客户名/款式/局部状态更新/显式传入订单号）均不得改变订单号
 *   5. 复制逻辑：copy 生成全新订单号、多次复制互不相同、其他字段正确继承
 *   6. 持久化与查询：getById/getAll 返回一致订单号
 *
 * 使用 MySQL 测试数据库（quote_system_test），每个测试用例前 resetTestDatabase() 保证隔离性。
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { db, generateUniqueQuoteNumber } from '../api/db'
import { resetTestDatabase } from './helpers/db-reset'

beforeAll(async () => {
  await db.runner.migrate()
})

beforeEach(async () => {
  await resetTestDatabase()
})

/** 直接修改订单的 quote_number（绕过业务层不变性保护，用于构造碰撞场景） */
async function forceQuoteNumber(id: string, quoteNumber: string): Promise<void> {
  await db.db.prepare('UPDATE quotes SET quote_number = ? WHERE id = ?').run(quoteNumber, id)
}

describe('订单号生成 - 基础格式', () => {
  it('create 生成的订单号为 16 位纯数字', async () => {
    const quote = await db.quotes.create({ customerName: '格式客户', productStyle: '1' })
    expect(quote.quote_number).toMatch(/^\d{16}$/)
    expect(quote.quote_number).toHaveLength(16)
  })

  it('订单号不含客户名称与款式信息（纯随机）', async () => {
    const quote = await db.quotes.create({ customerName: '客户甲', productStyle: '3' })
    expect(quote.quote_number).not.toContain('客户甲')
    expect(quote.quote_number).not.toContain('袋')
  })

  it('未传客户名称时仍能生成订单号', async () => {
    const quote = await db.quotes.create({ productStyle: '1' })
    expect(quote.quote_number).toMatch(/^\d{16}$/)
  })
})

describe('订单号生成 - 全局唯一性', () => {
  it('批量创建 50 个订单，订单号互不重复', async () => {
    const numbers = new Set<string>()
    for (let i = 0; i < 50; i++) {
      // 间隔 2ms：规避现有 quote-${Date.now()} 主键 id 的同毫秒碰撞（与订单号唯一性无关）
      await new Promise((resolve) => setTimeout(resolve, 2))
      const quote = await db.quotes.create({ customerName: `批量客户${i}`, productStyle: '1' })
      expect(quote.quote_number).toMatch(/^\d{16}$/)
      numbers.add(quote.quote_number)
    }
    expect(numbers.size).toBe(50)
  })

  it('新生成的订单号不与存量订单号冲突（数据库层防重复）', async () => {
    // 收集当前全部订单号
    const existing = (await db.quotes.getAll()).map((q) => q.quote_number)
    const quote = await db.quotes.create({ customerName: '冲突检测客户', productStyle: '2' })
    expect(existing).not.toContain(quote.quote_number)
  })

  it('generateUniqueQuoteNumber 返回的订单号在数据库中不存在', async () => {
    const number = await generateUniqueQuoteNumber()
    expect(number).toMatch(/^\d{16}$/)
    const rows = (await db.quotes.getAll()).map((q) => q.quote_number)
    expect(rows).not.toContain(number)
  })
})

describe('订单号生成 - 防重复校验（碰撞重试）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * 控制 Math.random 产出指定数字序列：
   * random() 返回队列值循环，floor(random()*10) 即目标数字
   * 0.15 → 数字 1，0.25 → 数字 2，依此类推
   */
  const mockRandomDigits = (values: number[]) => {
    let call = 0
    vi.spyOn(Math, 'random').mockImplementation(() => values[call++ % values.length])
  }

  it('首次生成碰撞时自动重试并返回不冲突的订单号', async () => {
    // 预置一个订单号为 1111111111111111 的存量订单
    const existing = await db.quotes.create({ customerName: '存量客户', productStyle: '1' })
    await forceQuoteNumber(existing.id, '1111111111111111')

    // 第一次生成 16 个 1（碰撞），之后生成 16 个 2（不碰撞）
    const ones = Array(16).fill(0.15)
    const twos = Array(16).fill(0.25)
    mockRandomDigits([...ones, ...twos])

    const result = await generateUniqueQuoteNumber()
    expect(result).toBe('2222222222222222')
    expect(result).not.toBe('1111111111111111')
  })

  it('连续多次碰撞仍能重试成功（重试上限 10 次内）', async () => {
    // 存量订单：111...（第1候选）和 333...（第3候选）
    const q1 = await db.quotes.create({ customerName: '碰撞A', productStyle: '1' })
    await forceQuoteNumber(q1.id, '1111111111111111')
    const q2 = await db.quotes.create({ customerName: '碰撞B', productStyle: '1' })
    await forceQuoteNumber(q2.id, '2222222222222222')

    // 序列：全1（碰撞）→ 全2（碰撞）→ 全3（成功）
    const seq = [...Array(16).fill(0.15), ...Array(16).fill(0.25), ...Array(16).fill(0.35)]
    mockRandomDigits(seq)

    const result = await generateUniqueQuoteNumber()
    expect(result).toBe('3333333333333333')
  })

  it('重试 10 次全部碰撞时走时间戳兜底（仍为 16 位数字且全局唯一）', async () => {
    // 存量订单占用固定候选号 1111111111111111
    const existing = await db.quotes.create({ customerName: '兜底存量', productStyle: '1' })
    await forceQuoteNumber(existing.id, '1111111111111111')

    // Math.random 恒定 → 10 次重试全部生成 1111111111111111（均碰撞）
    vi.spyOn(Math, 'random').mockImplementation(() => 0.15)
    // 固定 Date.now：兜底号 = 时间戳(13位) + pad(floor(0.15*1000),3) = 时间戳 + '150'
    vi.spyOn(Date, 'now').mockImplementation(() => 1750000000000)

    const result = await generateUniqueQuoteNumber()
    // 兜底格式：13位时间戳 + 3位随机后缀 = 16位
    expect(result).toMatch(/^\d{16}$/)
    expect(result).toBe('1750000000000150')
    expect(result).not.toBe('1111111111111111')
    // 全局唯一：与数据库中所有订单号不冲突
    const rows = (await db.quotes.getAll()).map((q) => q.quote_number)
    expect(rows).not.toContain(result)
  })
})

describe('订单号 - 不变性（创建后不可变更）', () => {
  it('修改客户名称时订单号保持不变', async () => {
    const quote = await db.quotes.create({ customerName: '原客户', productStyle: '1' })
    const updated = await db.quotes.update(quote.id, { customerName: '新客户' })
    expect(updated!.quote_number).toBe(quote.quote_number)
  })

  it('修改款式时订单号保持不变', async () => {
    const quote = await db.quotes.create({ customerName: '款式客户', productStyle: '1' })
    const updated = await db.quotes.update(quote.id, { productStyle: '4' })
    expect(updated!.quote_number).toBe(quote.quote_number)
  })

  it('局部更新（仅改状态）时订单号保持不变', async () => {
    const quote = await db.quotes.create({ customerName: '状态客户', productStyle: '1' })
    const updated = await db.quotes.update(quote.id, { status: 2 })
    expect(updated!.quote_number).toBe(quote.quote_number)
  })

  it('显式传入 quote_number 的更新请求被忽略（防止外部篡改）', async () => {
    const quote = await db.quotes.create({ customerName: '防篡改客户', productStyle: '1' })
    const updated = await db.quotes.update(quote.id, {
      customerName: '防篡改客户',
      // @ts-expect-error 测试故意传入非法字段
      quote_number: '9999999999999999',
    })
    expect(updated!.quote_number).toBe(quote.quote_number)
    expect(updated!.quote_number).not.toBe('9999999999999999')
  })

  it('状态流转（nextStatus）不改变订单号', async () => {
    const quote = await db.quotes.create({ customerName: '流转客户', productStyle: '1' })
    const updated = await db.quotes.nextStatus(quote.id)
    expect(updated!.quote_number).toBe(quote.quote_number)
  })
})

describe('订单号 - 复制逻辑（触发新增订单逻辑）', () => {
  it('复制生成全新订单号，不复用原订单号', async () => {
    const quote = await db.quotes.create({ customerName: '复制客户', productStyle: '1', quantity: '1000' })
    const copied = await db.quotes.copy(quote.id, 'tester')
    expect(copied).not.toBeNull()
    expect(copied!.quote_number).toMatch(/^\d{16}$/)
    expect(copied!.quote_number).not.toBe(quote.quote_number)
  })

  it('多次复制同一订单，每次生成互不相同的新订单号', async () => {
    const quote = await db.quotes.create({ customerName: '多次复制客户', productStyle: '2' })
    const numbers = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const copied = await db.quotes.copy(quote.id, 'tester')
      expect(copied!.quote_number).toMatch(/^\d{16}$/)
      numbers.add(copied!.quote_number)
    }
    expect(numbers.size).toBe(3)
    expect(numbers.has(quote.quote_number)).toBe(false)
  })

  it('复制订单正确继承业务字段（复制=新增订单逻辑）', async () => {
    const quote = await db.quotes.create({
      customerName: '字段继承客户',
      productStyle: '3',
      quantity: '2000',
      fabricMaterial: '无纺布',
      process: '丝印',
    })
    const copied = await db.quotes.copy(quote.id, 'tester')
    expect(copied!.customerName).toBe(quote.customerName)
    expect(copied!.productStyle).toBe(quote.productStyle)
    expect(copied!.quantity).toBe(quote.quantity)
    expect(copied!.fabricMaterial).toBe(quote.fabricMaterial)
    expect(copied!.process).toBe(quote.process)
    // id 不同：是全新的订单记录
    expect(copied!.id).not.toBe(quote.id)
  })

  it('复制订单后原订单订单号不受影响', async () => {
    const quote = await db.quotes.create({ customerName: '原单保护客户', productStyle: '1' })
    await db.quotes.copy(quote.id, 'tester')
    const reloaded = await db.quotes.getById(quote.id)
    expect(reloaded!.quote_number).toBe(quote.quote_number)
  })

  it('复制的订单号与库中所有订单号不冲突', async () => {
    const quote = await db.quotes.create({ customerName: '唯一性客户', productStyle: '1' })
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      await db.quotes.create({ customerName: `其他客户${i}`, productStyle: '1' })
    }
    const copied = await db.quotes.copy(quote.id, 'tester')
    const numbers = (await db.quotes.getAll()).map((q) => q.quote_number)
    // 库中 7 条记录（1 原单 + 5 新建 + 1 复制），订单号全部唯一
    expect(numbers).toHaveLength(7)
    expect(new Set(numbers).size).toBe(7)
    expect(numbers).toContain(copied!.quote_number)
  })
})

describe('订单号 - 持久化与查询一致性', () => {
  it('getById 返回的订单号与创建时一致', async () => {
    const quote = await db.quotes.create({ customerName: '查询客户', productStyle: '1' })
    const reloaded = await db.quotes.getById(quote.id)
    expect(reloaded!.quote_number).toBe(quote.quote_number)
  })

  it('getAll 返回的订单号与各订单创建时一致', async () => {
    const created: string[] = []
    for (let i = 0; i < 3; i++) {
      const q = await db.quotes.create({ customerName: `列表客户${i}`, productStyle: '1' })
      created.push(q.quote_number)
    }
    const all = await db.quotes.getAll()
    const numbers = all.map((q) => q.quote_number)
    for (const n of created) {
      expect(numbers).toContain(n)
    }
  })

  it('订单号字段非空（所有订单均有订单号）', async () => {
    await db.quotes.create({ customerName: '非空校验客户', productStyle: '1' })
    const all = await db.quotes.getAll()
    for (const q of all) {
      expect(q.quote_number).toBeTruthy()
      expect(q.quote_number).toMatch(/^\d{16}$/)
    }
  })
})

describe('订单号 - 旧格式兼容', () => {
  it('存量旧格式订单号（客户-款式-时间戳）可正常读取与保留', async () => {
    const quote = await db.quotes.create({ customerName: '旧格式客户', productStyle: '1' })
    await forceQuoteNumber(quote.id, '旧格式客户-无底无侧普通袋-20260101120000')

    // 读取不报错、值保留
    const reloaded = await db.quotes.getById(quote.id)
    expect(reloaded!.quote_number).toBe('旧格式客户-无底无侧普通袋-20260101120000')

    // update 后旧格式订单号同样保持不变
    const updated = await db.quotes.update(quote.id, { customerName: '改名客户' })
    expect(updated!.quote_number).toBe('旧格式客户-无底无侧普通袋-20260101120000')
  })

  it('旧格式订单号不阻碍新订单号生成（混合环境唯一性）', async () => {
    const legacy = await db.quotes.create({ customerName: '旧单', productStyle: '1' })
    await forceQuoteNumber(legacy.id, '旧格式客户-无底无侧普通袋-20260101120000')

    const fresh = await db.quotes.create({ customerName: '新单', productStyle: '1' })
    expect(fresh.quote_number).toMatch(/^\d{16}$/)
    expect(fresh.quote_number).not.toBe('旧格式客户-无底无侧普通袋-20260101120000')
  })
})
