/**
 * 做货流程跟踪表服务层（src/services/productionTracking.ts）单元测试
 *
 * 测试覆盖：
 *   1. rangesOverlap：日期区间相交判断（端点相等、空值无界、不相交）
 *   2. filterOverviewRows：多条件组合筛选（客户名称 / 订单号 / 订单状态 / 日期区间；
 *      设置日期区间时完全无日期的任务被排除）
 *   3. quoteEarliestDate / sortOverviewRows：按最早任务日期 + 订单号双重排序；
 *      无日期订单排最后；订单内按 stepOrder 升序
 *   4. 双维度展示：
 *      - sortOverviewRowsByOrderDim（订单优先）：订单组按开始日期排序（方向可控，无日期最后），
 *        同日期按订单号升序，订单内 stepOrder 升序
 *      - groupOverviewRowsByDate（日期优先）：按各步骤自身的开始日期分组插入分组头行
 *        （同一订单的步骤可散布到多个日期组；组序方向可控，无日期组最后），
 *        组内按订单号升序；分组头含日期标题（含星期）/统计/计数
 *      - buildDateBadgeImage：日期分组头徽标（蓝底白字日号；无日期组显示「无」）
 *   5. 名称排版：truncateText / normalizeQuantity / buildBarLabel（客户-步骤-数量）
 *   6. buildPlaceholderImage：无图订单灰底占位缩略图（SVG data URI，XML 转义）
 *   7. toTaskPayload：PUT 整体替换 payload（剥离 id / stepOrder / 订单摘要字段）
 *   8. summarizeOverview：订单数 / 步骤数 / 已完成步骤数汇总
 *   9. 步骤编辑操作：patchOverviewTask（修改字段 + 实际时间联动状态）/ appendOverviewTask（新增）/
 *      removeOverviewTask（删除 + 重排序号）/ moveOverviewTask（上移下移 + 重排序号）
 *   10. restoreOverviewTasks：撤销一键排期（快照行按原顺序替换回该订单）
 */
import { describe, it, expect } from 'vitest'
import {
  type ProductionTaskOverviewRow, type DateGroupHeaderRow,
  rangesOverlap, filterOverviewRows, quoteEarliestDate, sortOverviewRows,
  truncateText, normalizeQuantity, buildBarLabel, buildPlaceholderImage, buildDateBadgeImage,
  toTaskPayload, summarizeOverview,
  patchOverviewTask, appendOverviewTask, removeOverviewTask, moveOverviewTask, restoreOverviewTasks,
  sortOverviewRowsByOrderDim, groupOverviewRowsByDate,
} from '../src/services/productionTracking'

/** 构造测试总览行（缺省值与后端 overview 返回形态一致） */
function row(partial: Partial<ProductionTaskOverviewRow> = {}): ProductionTaskOverviewRow {
  return {
    id: partial.id ?? 't1',
    stepOrder: partial.stepOrder ?? 1,
    name: partial.name ?? '面料采购',
    planStart: partial.planStart ?? null,
    planEnd: partial.planEnd ?? null,
    actualStart: partial.actualStart ?? null,
    actualEnd: partial.actualEnd ?? null,
    status: partial.status ?? 0,
    remark: partial.remark ?? '',
    materials: partial.materials ?? [],
    quoteId: partial.quoteId ?? 'q1',
    quoteNumber: partial.quoteNumber ?? '2026090112345678',
    customerName: partial.customerName ?? '测试客户',
    quantity: partial.quantity ?? '1000',
    orderStatus: partial.orderStatus ?? 3,
    quoteUpdatedAt: partial.quoteUpdatedAt ?? '2026-09-01T00:00:00Z',
  }
}

describe('rangesOverlap', () => {
  it('端点相等视为相交', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-10', '2026-09-10', '2026-09-20')).toBe(true)
    expect(rangesOverlap('2026-09-15', '2026-09-20', '2026-09-01', '2026-09-15')).toBe(true)
  })

  it('区间重叠', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-10', '2026-09-05', '2026-09-20')).toBe(true)
    // 包含关系
    expect(rangesOverlap('2026-09-01', '2026-09-30', '2026-09-05', '2026-09-10')).toBe(true)
  })

  it('区间不相交', () => {
    expect(rangesOverlap('2026-09-01', '2026-09-05', '2026-09-06', '2026-09-10')).toBe(false)
  })

  it('空值视为无界（单侧开放区间）', () => {
    // 任务无结束日期（+∞）：与任何落在开始之后的区间都相交
    expect(rangesOverlap('2026-08-01', null, '2026-09-01', '2026-09-30')).toBe(true)
    // 任务无开始日期（-∞）：结束早于区间开始 → 不相交
    expect(rangesOverlap(null, '2026-07-01', '2026-08-01', null)).toBe(false)
    expect(rangesOverlap(null, '2026-08-01', '2026-08-01', null)).toBe(true)
  })
})

describe('filterOverviewRows', () => {
  const rows = [
    row({ id: 't1', quoteId: 'q1', quoteNumber: '2026090111111111', customerName: '阿里巴巴', quantity: '1000', orderStatus: 3, planStart: '2026-09-01', planEnd: '2026-09-05' }),
    row({ id: 't2', quoteId: 'q2', quoteNumber: '2026090122222222', customerName: '腾讯', quantity: '2000', orderStatus: 2, planStart: '2026-09-10', planEnd: '2026-09-15' }),
    row({ id: 't3', quoteId: 'q3', quoteNumber: '2026090133333333', customerName: '字节跳动', quantity: '500', orderStatus: 4, actualStart: '2026-08-20', actualEnd: '2026-08-25' }),
    row({ id: 't4', quoteId: 'q4', quoteNumber: '2026090144444444', customerName: '无日期客户', quantity: '300', orderStatus: 3 }),
  ]

  it('空筛选条件返回全部', () => {
    const filters = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filters)).toHaveLength(4)
  })

  it('客户名称（多选）：任一精确匹配且不区分大小写，空数组 = 不限', () => {
    const filters = { customerNames: ['阿里巴巴'], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filters).map((r) => r.id)).toEqual(['t1'])
    // 多选：任一命中即保留
    const filtersMulti = { customerNames: ['阿里巴巴', '腾讯'], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filtersMulti).map((r) => r.id)).toEqual(['t1', 't2'])
    // 精确匹配（非包含）：部分名称不命中
    const filtersExact = { customerNames: ['阿里'], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filtersExact)).toHaveLength(0)
    // 大小写不敏感
    const enRows = [
      row({ id: 'e1', customerName: 'Apple' }),
      row({ id: 'e2', customerName: 'Banana' }),
    ]
    const filtersLower = { customerNames: ['apple'], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(enRows, filtersLower).map((r) => r.id)).toEqual(['e1'])
    // 空白名称视为未选
    const filtersBlank = { customerNames: ['  '], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filtersBlank)).toHaveLength(4)
  })

  it('订单号：包含匹配', () => {
    const filters = { customerNames: [], quoteNumber: '2222', statuses: [], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filters).map((r) => r.id)).toEqual(['t2'])
  })

  it('订单状态：白名单（空数组 = 不限）', () => {
    const filters = { customerNames: [], quoteNumber: '', statuses: [2], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filters).map((r) => r.id)).toEqual(['t2'])
    const filtersMulti = { customerNames: [], quoteNumber: '', statuses: [2, 4], dateStart: '', dateEnd: '' }
    expect(filterOverviewRows(rows, filtersMulti).map((r) => r.id)).toEqual(['t2', 't3'])
  })

  it('日期区间：任务代表日期（计划优先，缺失回退实际）与区间有交集', () => {
    const filters = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '2026-08-25', dateEnd: '2026-09-02' }
    // t1 计划 09-01~09-05 相交；t3 实际 08-20~08-25 相交（端点相等）；t2/t4 不相交
    expect(filterOverviewRows(rows, filters).map((r) => r.id)).toEqual(['t1', 't3'])
  })

  it('日期区间：设置了区间时完全无日期的任务被排除', () => {
    const filters = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '2026-01-01', dateEnd: '2026-12-31' }
    const result = filterOverviewRows(rows, filters)
    expect(result.map((r) => r.id)).toEqual(['t1', 't2', 't3'])
    expect(result.some((r) => r.quoteId === 'q4')).toBe(false)
  })

  it('多条件组合（AND 语义）', () => {
    const filters = { customerNames: ['腾讯'], quoteNumber: '2222', statuses: [3], dateStart: '', dateEnd: '' }
    // 状态不匹配 → 空
    expect(filterOverviewRows(rows, filters)).toHaveLength(0)
    const filtersOk = { customerNames: ['腾讯'], quoteNumber: '2222', statuses: [2], dateStart: '2026-09-12', dateEnd: '2026-09-13' }
    expect(filterOverviewRows(rows, filtersOk).map((r) => r.id)).toEqual(['t2'])
  })

  it('仅开始 / 仅结束日期（单侧开放）', () => {
    const onlyStart = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '2026-09-16', dateEnd: '' }
    expect(filterOverviewRows(rows, onlyStart).map((r) => r.id)).toEqual([])
    const onlyEnd = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '', dateEnd: '2026-09-16' }
    // t1（09-01~09-05）、t2（09-10~09-15）、t3（实际 08-20~08-25）均在 09-16 之前 → 相交
    expect(filterOverviewRows(rows, onlyEnd).map((r) => r.id)).toEqual(['t1', 't2', 't3'])
  })
})

describe('排序（quoteEarliestDate / sortOverviewRows）', () => {
  it('quoteEarliestDate：取订单内最早日期（计划优先，缺失回退实际）', () => {
    const rows = [
      row({ id: 't1', planStart: '2026-09-10' }),
      row({ id: 't2', actualStart: '2026-09-01' }),
      row({ id: 't3', planStart: '2026-09-05' }),
    ]
    expect(quoteEarliestDate(rows)).toBe('2026-09-01')
    expect(quoteEarliestDate([row({ id: 't1' })])).toBeNull()
  })

  it('双重排序：订单按最早日期升序，同日期按订单号升序', () => {
    const rows = [
      // B 订单：日期最早
      row({ id: 't1', quoteId: 'qB', quoteNumber: '2026090199999999', planStart: '2026-08-01', stepOrder: 1 }),
      // C 订单：与 A 同日期，订单号更大
      row({ id: 't2', quoteId: 'qC', quoteNumber: '2026090133333333', planStart: '2026-09-01', stepOrder: 1 }),
      // A 订单：与 C 同日期，订单号更小 → A 在 C 前
      row({ id: 't3', quoteId: 'qA', quoteNumber: '2026090111111111', planStart: '2026-09-01', stepOrder: 1 }),
      // D 订单：无任何日期 → 最后
      row({ id: 't4', quoteId: 'qD', quoteNumber: '2026090100000001', stepOrder: 1 }),
    ]
    const sorted = sortOverviewRows(rows)
    expect(sorted.map((r) => r.quoteId)).toEqual(['qB', 'qA', 'qC', 'qD'])
  })

  it('订单内按 stepOrder 升序（输入乱序）', () => {
    const rows = [
      row({ id: 't2', quoteId: 'q1', stepOrder: 2, name: '裁剪' }),
      row({ id: 't3', quoteId: 'q1', stepOrder: 3, name: '印刷' }),
      row({ id: 't1', quoteId: 'q1', stepOrder: 1, name: '面料采购' }),
    ]
    expect(sortOverviewRows(rows).map((r) => r.name)).toEqual(['面料采购', '裁剪', '印刷'])
  })

  it('均为无日期订单时按订单号排序', () => {
    const rows = [
      row({ id: 't1', quoteId: 'qB', quoteNumber: '2026090122222222' }),
      row({ id: 't2', quoteId: 'qA', quoteNumber: '2026090111111111' }),
    ]
    expect(sortOverviewRows(rows).map((r) => r.quoteId)).toEqual(['qA', 'qB'])
  })

  it('混合日期订单：有日期订单排在无日期之前（覆盖 b 无日期 / a<b 比较对）', () => {
    // 行序（无日期在前 + 日期逆序）构造 sort 比较方向多样性：
    //   pivot(qX 09-10) vs mid(qD 无日期) → b.earliest === null → -1
    //   pivot(qY 09-01) vs mid(qX 09-10) → a.earliest < b.earliest → -1
    const rows = [
      row({ id: 't1', quoteId: 'qD', quoteNumber: '2026090144444444' }),
      row({ id: 't2', quoteId: 'qX', quoteNumber: '2026090133333333', planStart: '2026-09-10' }),
      row({ id: 't3', quoteId: 'qY', quoteNumber: '2026090122222222', planStart: '2026-09-01' }),
    ]
    expect(sortOverviewRows(rows).map((r) => r.quoteId)).toEqual(['qY', 'qX', 'qD'])
  })

  it('不修改原数组（纯函数）', () => {
    const rows = [row({ id: 't2', quoteId: 'q1', stepOrder: 2 }), row({ id: 't1', quoteId: 'q1', stepOrder: 1 })]
    const snapshot = rows.map((r) => r.id)
    sortOverviewRows(rows)
    expect(rows.map((r) => r.id)).toEqual(snapshot)
  })
})

describe('甘特图名称排版', () => {
  it('truncateText：超长截断并追加省略号，短文本原样返回', () => {
    expect(truncateText('客户', 6)).toBe('客户')
    expect(truncateText('六六六六六六', 6)).toBe('六六六六六六')
    // 超过 6 字：保留前 5 字 + 省略号
    expect(truncateText('超长客户名称测试', 6)).toBe('超长客户名…')
    expect(truncateText('', 6)).toBe('')
  })

  it('normalizeQuantity：去除尾随 .00，非法值回退 0，保留两位小数', () => {
    expect(normalizeQuantity('1000')).toBe('1000')
    expect(normalizeQuantity('1000.00')).toBe('1000')
    expect(normalizeQuantity('1000.50')).toBe('1000.5')
    expect(normalizeQuantity('1000.555')).toBe('1000.56')
    expect(normalizeQuantity('abc')).toBe('0')
    expect(normalizeQuantity('')).toBe('0')
  })

  it('buildBarLabel：客户-步骤-数量 组合（客户 6 字 / 步骤 8 字截断）', () => {
    expect(buildBarLabel('腾讯', '面料采购', '1000')).toBe('腾讯-面料采购-1000个')
    expect(buildBarLabel('这是一个超长客户名称', '面料采购', '1000')).toBe('这是一个超…-面料采购-1000个')
    expect(buildBarLabel('腾讯', '超长步骤名称超过八字', '2000.00')).toBe('腾讯-超长步骤名称超…-2000个')
  })
})

describe('buildPlaceholderImage', () => {
  it('生成灰底 SVG data URI，首字大写', () => {
    const uri = buildPlaceholderImage('腾讯')
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(uri)).toContain('腾')
    // 首字大写（英文客户名）
    expect(decodeURIComponent(buildPlaceholderImage('apple'))).toContain('A')
  })

  it('空字符串回退占位字符 ?', () => {
    expect(decodeURIComponent(buildPlaceholderImage(''))).toContain('?')
  })

  it('XML 特殊字符被转义（防注入）', () => {
    const uri = buildPlaceholderImage('<script>')
    expect(uri).not.toContain('<script>')
    // 占位图仅取首字符，'<' 被转义为 &lt; 后嵌入 SVG 文本
    expect(decodeURIComponent(uri)).toContain('&lt;')
  })
})

describe('toTaskPayload', () => {
  it('剥离 id / stepOrder / 订单摘要字段，保留任务业务字段', () => {
    const rows = [
      row({ id: 't1', stepOrder: 1, name: '面料采购', planStart: '2026-09-01', planEnd: '2026-09-05', status: 0, remark: '备注', materials: [{ name: '面料', spec: '30D', quantity: 100, unit: '米', ready: false }] }),
      row({ id: 't2', stepOrder: 2, name: '裁剪', planStart: null, planEnd: null, status: 1 }),
    ]
    const payload = toTaskPayload(rows)
    expect(payload).toHaveLength(2)
    expect(payload[0]).toEqual({
      name: '面料采购',
      planStart: '2026-09-01',
      planEnd: '2026-09-05',
      actualStart: null,
      actualEnd: null,
      status: 0,
      remark: '备注',
      materials: [{ name: '面料', spec: '30D', quantity: 100, unit: '米', ready: false }],
    })
    expect(payload[0]).not.toHaveProperty('id')
    expect(payload[0]).not.toHaveProperty('stepOrder')
    expect(payload[0]).not.toHaveProperty('quoteId')
    expect(payload[0]).not.toHaveProperty('quoteNumber')
    expect(payload[0]).not.toHaveProperty('customerName')
    expect(payload[0]).not.toHaveProperty('quantity')
    expect(payload[0]).not.toHaveProperty('orderStatus')
    expect(payload[0]).not.toHaveProperty('quoteUpdatedAt')
  })
})

describe('summarizeOverview', () => {
  it('按订单去重统计订单数；步骤数 / 完成数按行统计', () => {
    const rows = [
      row({ id: 't1', quoteId: 'q1', status: 2 }),
      row({ id: 't2', quoteId: 'q1', status: 2 }),
      row({ id: 't3', quoteId: 'q2', status: 0 }),
      row({ id: 't4', quoteId: 'q2', status: 1 }),
    ]
    expect(summarizeOverview(rows)).toEqual({ quotes: 2, tasks: 4, completed: 2 })
  })

  it('空数据返回全零', () => {
    expect(summarizeOverview([])).toEqual({ quotes: 0, tasks: 0, completed: 0 })
  })
})

describe('步骤编辑操作（patchOverviewTask / appendOverviewTask / removeOverviewTask / moveOverviewTask）', () => {
  // q1 两个步骤 + q2 一个步骤（穿插排列，验证跨订单隔离）
  const rows = [
    row({ id: 't1', quoteId: 'q1', stepOrder: 1, name: '面料采购', status: 0 }),
    row({ id: 'x1', quoteId: 'q2', stepOrder: 1, name: '其他订单步骤', status: 0 }),
    row({ id: 't2', quoteId: 'q1', stepOrder: 2, name: '裁剪', status: 0 }),
  ]

  it('patchOverviewTask：修改指定订单内第 idx 个步骤的字段，其他行不受影响', () => {
    const next = patchOverviewTask(rows, 'q1', 1, { name: '裁剪缝制' })
    expect(next.map((r) => r.name)).toEqual(['面料采购', '其他订单步骤', '裁剪缝制'])
    // 纯函数：原数组不变
    expect(rows[2].name).toBe('裁剪')
    // 未命中订单 / 越界：返回原数组引用
    expect(patchOverviewTask(rows, 'qX', 0, { name: 'y' })).toBe(rows)
    expect(patchOverviewTask(rows, 'q1', 5, { name: 'y' })).toBe(rows)
    expect(patchOverviewTask(rows, 'q1', -1, { name: 'y' })).toBe(rows)
  })

  it('patchOverviewTask：填实际开始 → 状态联动为进行中；再填实际结束 → 已完成', () => {
    const started = patchOverviewTask(rows, 'q1', 0, { actualStart: '2026-09-01' })
    expect(started.find((r) => r.id === 't1')?.status).toBe(1)
    const done = patchOverviewTask(started, 'q1', 0, { actualEnd: '2026-09-02' })
    expect(done.find((r) => r.id === 't1')?.status).toBe(2)
  })

  it('patchOverviewTask：清空实际时间 → 状态联动回未开始', () => {
    const started = patchOverviewTask(rows, 'q1', 0, { actualStart: '2026-09-01' })
    const cleared = patchOverviewTask(started, 'q1', 0, { actualStart: null, actualEnd: null })
    expect(cleared.find((r) => r.id === 't1')?.status).toBe(0)
  })

  it('appendOverviewTask：在订单末尾追加「新步骤」（无日期、未开始、复制订单摘要字段）', () => {
    const next = appendOverviewTask(rows, 'q1')
    expect(next).toHaveLength(4)
    const appended = next[3]
    expect(appended.quoteId).toBe('q1')
    expect(appended.name).toBe('新步骤')
    expect(appended.status).toBe(0)
    expect(appended.planStart).toBeNull()
    expect(appended.stepOrder).toBe(3)
    // id 为临时 id（保存后由服务端重新生成）
    expect(appended.id.startsWith('tmp-')).toBe(true)
    // 订单不存在时返回原数组
    expect(appendOverviewTask(rows, 'qX')).toBe(rows)
  })

  it('appendOverviewTask：达到 50 步上限时返回原数组', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      row({ id: `m${i}`, quoteId: 'q1', stepOrder: i + 1 }))
    expect(appendOverviewTask(many, 'q1')).toBe(many)
  })

  it('appendOverviewTask(defaultDate)：新步骤默认单日排期到指定日期（日期优先模式继承组日期）', () => {
    const next = appendOverviewTask(rows, 'q1', '2026-09-05')
    const appended = next[3]
    expect(appended.planStart).toBe('2026-09-05')
    expect(appended.planEnd).toBe('2026-09-05')
    // actualStart/actualEnd 仍为 null（仅计划日期继承）
    expect(appended.actualStart).toBeNull()
    expect(appended.actualEnd).toBeNull()
  })

  it('appendOverviewTask(defaultDate=null)：显式传 null 与不传等价，新步骤无日期', () => {
    const next = appendOverviewTask(rows, 'q1', null)
    expect(next[3].planStart).toBeNull()
    expect(next[3].planEnd).toBeNull()
  })

  it('removeOverviewTask：删除指定步骤并重排 stepOrder', () => {
    const next = removeOverviewTask(rows, 'q1', 0)
    expect(next.map((r) => r.id)).toEqual(['x1', 't2'])
    expect(next.find((r) => r.id === 't2')?.stepOrder).toBe(1)
    // 越界返回原数组
    expect(removeOverviewTask(rows, 'q1', 9)).toBe(rows)
  })

  it('moveOverviewTask：上移/下移交换位置并重排 stepOrder；边界越界返回原数组', () => {
    const down = moveOverviewTask(rows, 'q1', 0, 1)
    expect(down.map((r) => r.id)).toEqual(['t2', 'x1', 't1'])
    expect(down.find((r) => r.id === 't1')?.stepOrder).toBe(2)
    expect(down.find((r) => r.id === 't2')?.stepOrder).toBe(1)
    // 再移回去
    const up = moveOverviewTask(down, 'q1', 1, -1)
    expect(up.map((r) => r.id)).toEqual(['t1', 'x1', 't2'])
    // 边界：q1 首步上移 / 末步下移
    expect(moveOverviewTask(rows, 'q1', 0, -1)).toBe(rows)
    expect(moveOverviewTask(rows, 'q1', 1, 1)).toBe(rows)
    // 越界 idx
    expect(moveOverviewTask(rows, 'q1', 5, -1)).toBe(rows)
  })

  it('moveOverviewTask 不会把步骤移动到其他订单的位置（跨订单隔离）', () => {
    // q1 的末步（全局 idx 2）下移：目标位置是 q2 的步骤 → 越界返回原数组
    const next = moveOverviewTask(rows, 'q1', 1, 1)
    expect(next.map((r) => r.id)).toEqual(['t1', 'x1', 't2'])
  })
})

describe('撤销一键排期（restoreOverviewTasks）', () => {
  // 排期后形态：q1 两步均被均分排期、q2 穿插其中（验证跨订单隔离）
  const scheduled = [
    row({ id: 't1', quoteId: 'q1', stepOrder: 1, name: '面料采购', planStart: '2026-09-01', planEnd: '2026-09-05' }),
    row({ id: 'x1', quoteId: 'q2', stepOrder: 1, name: '其他订单步骤', planStart: '2026-09-10', planEnd: '2026-09-12' }),
    row({ id: 't2', quoteId: 'q1', stepOrder: 2, name: '裁剪', planStart: '2026-09-06', planEnd: '2026-09-10' }),
  ]
  // 排期前快照：q1 两步均无计划日期、t1 已有实际开始（应随快照整体恢复）
  const snapshot = [
    row({ id: 't1', quoteId: 'q1', stepOrder: 1, name: '面料采购', planStart: null, planEnd: null, actualStart: '2026-08-25', status: 1 }),
    row({ id: 't2', quoteId: 'q1', stepOrder: 2, name: '裁剪', planStart: null, planEnd: null }),
  ]

  it('按原顺序替换回该订单的行，其他订单行不受影响', () => {
    const restored = restoreOverviewTasks(scheduled, 'q1', snapshot)
    // q1 的行恢复为快照内容
    expect(restored.map((r) => r.id)).toEqual(['t1', 'x1', 't2'])
    expect(restored[0]).toMatchObject({ planStart: null, planEnd: null, actualStart: '2026-08-25', status: 1 })
    expect(restored[2]).toMatchObject({ planStart: null, planEnd: null, actualStart: null, status: 0 })
    // q2 的行保持排期后形态
    expect(restored[1]).toMatchObject({ id: 'x1', planStart: '2026-09-10', planEnd: '2026-09-12' })
  })

  it('纯函数：原数组不变', () => {
    restoreOverviewTasks(scheduled, 'q1', snapshot)
    expect(scheduled[0].planStart).toBe('2026-09-01')
    expect(scheduled[0].actualStart).toBeNull()
  })

  it('快照行为空 / 订单不存在：返回原数组引用', () => {
    expect(restoreOverviewTasks(scheduled, 'q1', [])).toBe(scheduled)
    expect(restoreOverviewTasks(scheduled, 'qX', snapshot)).toBe(scheduled)
  })

  it('快照行数与当前不一致时按较少数截断替换（防御性处理）', () => {
    // 快照只有 1 行（正常不应发生——其他编辑会使快照失效）
    const partial = [snapshot[0]]
    const restored = restoreOverviewTasks(scheduled, 'q1', partial)
    expect(restored[0]).toMatchObject({ id: 't1', planStart: null })
    // 第 2 行保留排期后形态
    expect(restored[2]).toMatchObject({ id: 't2', planStart: '2026-09-06' })
  })
})

// ============================================================
// 分支补充：日期回退链 / stepOrder 保持 / 状态未变化
// ============================================================

describe('分支补充 - 日期回退与编辑边界', () => {
  it('任务仅有开始无结束：代表区间结束回退到开始日期', () => {
    const rows = [
      // 只有计划开始 → 区间 [09-01, 09-01]
      row({ id: 'only-plan', planStart: '2026-09-01' }),
      // 只有实际开始 → 区间 [08-01, 08-01]
      row({ id: 'only-actual', actualStart: '2026-08-01' }),
    ]
    // 精确命中单点区间
    const filters = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '2026-09-01', dateEnd: '2026-09-01' }
    expect(filterOverviewRows(rows, filters).map((r) => r.id)).toEqual(['only-plan'])
  })

  it('任务仅有计划结束无任何开始：代表区间为 [-∞, 计划结束]', () => {
    const rows = [row({ id: 'only-end', planEnd: '2026-09-05' })]
    // 开始早于计划结束 → 相交
    const filters = { customerNames: [], quoteNumber: '', statuses: [], dateStart: '2026-08-01', dateEnd: '2026-08-31' }
    expect(filterOverviewRows(rows, filters).map((r) => r.id)).toEqual(['only-end'])
  })

  it('quoteEarliestDate：开始日期全缺失时回退结束日期（计划优先于实际）', () => {
    expect(quoteEarliestDate([row({ planEnd: '2026-09-05' })])).toBe('2026-09-05')
    expect(quoteEarliestDate([row({ actualEnd: '2026-09-03' })])).toBe('2026-09-03')
    expect(quoteEarliestDate([row({ planEnd: '2026-09-05', actualEnd: '2026-09-03' })])).toBe('2026-09-05')
  })

  it('removeOverviewTask：删除中间步骤时，首步骤 stepOrder 不变（复用原对象）', () => {
    const three = [
      row({ id: 's1', quoteId: 'q1', stepOrder: 1 }),
      row({ id: 's2', quoteId: 'q1', stepOrder: 2 }),
      row({ id: 's3', quoteId: 'q1', stepOrder: 3 }),
    ]
    const next = removeOverviewTask(three, 'q1', 1)
    expect(next.map((r) => r.id)).toEqual(['s1', 's3'])
    // s1 的 stepOrder 仍为 1 且复用原对象引用（stepOrder 相同分支）
    expect(next[0]).toBe(three[0])
    expect(next[0].stepOrder).toBe(1)
    expect(next[1].stepOrder).toBe(2)
  })

  it('patchOverviewTask：实际时间未引起状态变化时保持原状态', () => {
    // 已是进行中的步骤再次修改实际开始（或备注）→ resolved === 当前状态，不触发变更
    const started = [
      row({ id: 's1', quoteId: 'q1', status: 1, actualStart: '2026-09-01' }),
    ]
    const next = patchOverviewTask(started, 'q1', 0, { remark: '更新备注', actualStart: '2026-09-01' })
    expect(next[0].status).toBe(1)
    expect(next[0].remark).toBe('更新备注')
  })
})

// ────────────────────────────────────────────────────────────
// 双维度展示（订单优先 / 日期优先）
// ────────────────────────────────────────────────────────────

describe('双维度展示：测试数据与解析器', () => {
  /**
   * 订单开始日期解析器（模拟页面注入的回退链结果）：
   *   q1 = 2026-09-02（周三）、q2 = 2026-09-10（周四）、q3 = 2026-09-02（周三，与 q1 同日）
   *   q4 = 无开始日期、q5 = 2026-09-10T08:00:00Z（日期时间字符串，应按 09-10 参与排序）
   */
  const START_DATES: Record<string, string | null> = {
    q1: '2026-09-02',
    q2: '2026-09-10',
    q3: '2026-09-02',
    q4: null,
    q5: '2026-09-10T08:00:00.000Z',
  }
  const startDateOf = (quoteId: string) => START_DATES[quoteId] ?? null

  /** 乱序任务行（q1 两步乱序 / q2 一步 / q3 一步 / q4 一步 / q5 一步） */
  const mixedRows = (): ProductionTaskOverviewRow[] => [
    row({ id: 'q1-s2', quoteId: 'q1', quoteNumber: 'B002', stepOrder: 2, name: '裁剪', customerName: '客户B' }),
    row({ id: 'q2-s1', quoteId: 'q2', quoteNumber: 'A001', stepOrder: 1, name: '面料采购', customerName: '客户A' }),
    row({ id: 'q1-s1', quoteId: 'q1', quoteNumber: 'B002', stepOrder: 1, name: '面料采购', customerName: '客户B' }),
    row({ id: 'q4-s1', quoteId: 'q4', quoteNumber: 'C003', stepOrder: 1, name: '等待排期', customerName: '客户C' }),
    row({ id: 'q5-s1', quoteId: 'q5', quoteNumber: 'D004', stepOrder: 1, name: '印花', customerName: '客户D' }),
    row({ id: 'q3-s1', quoteId: 'q3', quoteNumber: 'E005', stepOrder: 1, name: '车缝', customerName: '客户E' }),
  ]

  describe('订单优先（sortOverviewRowsByOrderDim）', () => {
    it('desc（默认）：订单按开始日期从新到旧，无开始日期最后，订单内 stepOrder 升序', () => {
      const sorted = sortOverviewRowsByOrderDim(mixedRows(), startDateOf)
      // 09-10 组：q2（A001）与 q5（D004）同日期 → 按订单号升序 A001 < D004
      // 09-02 组：q1（B002）、q3（E005）→ B002 < E005
      // 无日期：q4 最后
      expect(sorted.map((r) => r.id)).toEqual([
        'q2-s1', 'q5-s1',        // 2026-09-10（新）
        'q1-s1', 'q1-s2', 'q3-s1', // 2026-09-02（旧；q1 内 stepOrder 1→2）
        'q4-s1',                  // 无开始日期最后
      ])
    })

    it('asc：订单按开始日期从旧到新（无开始日期仍排最后）', () => {
      const sorted = sortOverviewRowsByOrderDim(mixedRows(), startDateOf, 'asc')
      expect(sorted.map((r) => r.id)).toEqual([
        'q1-s1', 'q1-s2', 'q3-s1', // 2026-09-02（旧）
        'q2-s1', 'q5-s1',          // 2026-09-10（新）
        'q4-s1',                    // 无开始日期最后
      ])
    })

    it('同日期订单按订单号升序（与方向无关，稳定排序）', () => {
      // q5 订单号 D004 > q2 订单号 A001 → desc 与 asc 下 q2 均在 q5 前
      const ids = (direction: 'asc' | 'desc') => sortOverviewRowsByOrderDim(mixedRows(), startDateOf, direction).map((r) => r.id)
      expect(ids('desc').indexOf('q2-s1')).toBeLessThan(ids('desc').indexOf('q5-s1'))
      expect(ids('asc').indexOf('q2-s1')).toBeLessThan(ids('asc').indexOf('q5-s1'))
    })

    it('开始日期为日期时间字符串时按日期部分参与排序', () => {
      // q5 的 '2026-09-10T08:00:00Z' 与 q2 的 '2026-09-10' 归一化为同一天
      const sorted = sortOverviewRowsByOrderDim(mixedRows(), startDateOf, 'asc')
      expect(sorted[3].id).toBe('q2-s1')
      expect(sorted[4].id).toBe('q5-s1')
    })

    it('纯函数：不修改原数组', () => {
      const input = mixedRows()
      const snapshot = input.map((r) => r.id)
      sortOverviewRowsByOrderDim(input, startDateOf, 'desc')
      expect(input.map((r) => r.id)).toEqual(snapshot)
    })

    it('多个无开始日期订单：互相比较时按订单号升序（与方向无关）', () => {
      const rows = [
        row({ id: 'd2', quoteId: 'qd2', quoteNumber: '2026090199999999' }),
        row({ id: 'd1', quoteId: 'qd1', quoteNumber: '2026090111111111' }),
      ]
      // 两组 startDate 均为 null → 日期比较视为相等 → 回退订单号升序
      expect(sortOverviewRowsByOrderDim(rows, () => null).map((r) => r.id)).toEqual(['d1', 'd2'])
      expect(sortOverviewRowsByOrderDim(rows, () => null, 'asc').map((r) => r.id)).toEqual(['d1', 'd2'])
    })
  })

  describe('日期优先（groupOverviewRowsByDate，按步骤开始日期分组）', () => {
    /**
     * 行级步骤开始日期（q1 两步散布不同日期组；q5 无计划开始回退实际开始）：
     *   q1-s1 = 09-02、q1-s2 = 09-05（同订单拆组）、q2-s1 = 09-10、q3-s1 = 09-02
     *   q4-s1 = 无、q5-s1 = 无计划开始但实际开始 09-10、q6 两步均 09-02（组内 stepOrder）
     */
    const datedRows = (): ProductionTaskOverviewRow[] => [
      row({ id: 'q1-s2', quoteId: 'q1', quoteNumber: 'B002', stepOrder: 2, planStart: '2026-09-05' }),
      row({ id: 'q2-s1', quoteId: 'q2', quoteNumber: 'A001', stepOrder: 1, planStart: '2026-09-10' }),
      row({ id: 'q1-s1', quoteId: 'q1', quoteNumber: 'B002', stepOrder: 1, planStart: '2026-09-02' }),
      row({ id: 'q4-s1', quoteId: 'q4', quoteNumber: 'C003', stepOrder: 1 }),
      row({ id: 'q5-s1', quoteId: 'q5', quoteNumber: 'D004', stepOrder: 1, planStart: null, actualStart: '2026-09-10' }),
      row({ id: 'q3-s1', quoteId: 'q3', quoteNumber: 'E005', stepOrder: 1, planStart: '2026-09-02' }),
      row({ id: 'q6-s2', quoteId: 'q6', quoteNumber: 'F006', stepOrder: 2, planStart: '2026-09-02' }),
      row({ id: 'q6-s1', quoteId: 'q6', quoteNumber: 'F006', stepOrder: 1, planStart: '2026-09-02' }),
    ]

    /** 仅看任务行的辅助（过滤分组头） */
    const taskIdsOf = (view: Array<DateGroupHeaderRow | ProductionTaskOverviewRow>) =>
      view.filter((r): r is ProductionTaskOverviewRow => !('isDateHeader' in r)).map((r) => r.id)
    /** 仅看分组头行的辅助 */
    const headersOf = (view: Array<DateGroupHeaderRow | ProductionTaskOverviewRow>): DateGroupHeaderRow[] =>
      view.filter((r): r is DateGroupHeaderRow => 'isDateHeader' in r)

    it('desc（默认）：按步骤开始日期分组；同订单步骤散布到各自日期组；组序新→旧，无开始日期组最后', () => {
      const view = groupOverviewRowsByDate(datedRows())
      // q1 两步分入 09-02 / 09-05 两组；q5 无计划开始回退实际开始 09-10
      expect(view.map((r) => ('isDateHeader' in r ? `头:${r.dateKey}` : r.id))).toEqual([
        '头:2026-09-10', 'q2-s1', 'q5-s1',
        '头:2026-09-05', 'q1-s2',
        '头:2026-09-02', 'q1-s1', 'q3-s1', 'q6-s1', 'q6-s2',
        '头:null', 'q4-s1',
      ])
    })

    it('asc：组序旧→新（无开始日期组仍最后）', () => {
      const view = groupOverviewRowsByDate(datedRows(), 'asc')
      expect(view.map((r) => ('isDateHeader' in r ? `头:${r.dateKey}` : r.id))).toEqual([
        '头:2026-09-02', 'q1-s1', 'q3-s1', 'q6-s1', 'q6-s2',
        '头:2026-09-05', 'q1-s2',
        '头:2026-09-10', 'q2-s1', 'q5-s1',
        '头:null', 'q4-s1',
      ])
    })

    it('分组头行：日期标题含星期与统计（订单数按去重、步骤数按行数；2026-09-10 为周四）', () => {
      const view = groupOverviewRowsByDate(datedRows())
      const headers = headersOf(view)
      expect(headers).toHaveLength(4)
      expect(headers[0]).toMatchObject({
        dateKey: '2026-09-10',
        dateTitle: '2026/9/10 周四',
        groupSummary: '2 单 · 2 步',
        quoteCount: 2,
        taskCount: 2,
      })
      expect(headers[1]).toMatchObject({ dateKey: '2026-09-05', dateTitle: '2026/9/5 周六', quoteCount: 1, taskCount: 1 })
      // 09-02 组：q1 / q3 / q6 三单四步
      expect(headers[2]).toMatchObject({ dateKey: '2026-09-02', quoteCount: 3, taskCount: 4 })
      expect(headers[3]).toMatchObject({ dateKey: null, dateTitle: '无开始日期', quoteCount: 1, taskCount: 1 })
    })

    it('组内订单按订单号升序、订单内 stepOrder 升序', () => {
      const view = groupOverviewRowsByDate(datedRows())
      expect(taskIdsOf(view)).toEqual([
        'q2-s1', 'q5-s1',                       // 09-10 组内：A001 → D004
        'q1-s2',                                // 09-05 组内
        'q1-s1', 'q3-s1', 'q6-s1', 'q6-s2',     // 09-02 组内：B002 → E005 → F006（stepOrder 1→2）
        'q4-s1',
      ])
    })

    it('计划开始缺失时回退实际开始（同组参与排序）', () => {
      // q5 仅 actualStart = 09-10：与 q2（planStart 09-10）同组且按订单号 A001 → D004
      const view = groupOverviewRowsByDate(datedRows())
      const start = view.findIndex((r) => 'isDateHeader' in r && r.dateKey === '2026-09-10')
      const end = view.findIndex((r, i) => i > start && 'isDateHeader' in r)
      const group = view.slice(start, end === -1 ? view.length : end)
      expect(group.map((r) => ('isDateHeader' in r ? r.dateKey : r.id))).toEqual(['2026-09-10', 'q2-s1', 'q5-s1'])
    })

    it('任务行数不变（分组头行数 + 任务行数 = 视图总行数）', () => {
      const view = groupOverviewRowsByDate(datedRows())
      expect(view).toHaveLength(datedRows().length + 4) // 4 个日期分组
    })

    it('纯函数：不修改原数组', () => {
      const input = datedRows()
      const snapshot = input.map((r) => r.id)
      groupOverviewRowsByDate(input, 'desc')
      expect(input.map((r) => r.id)).toEqual(snapshot)
    })

    it('全部步骤均无开始日期：仅一个「无开始日期」组', () => {
      const rows = [
        row({ id: 'a', quoteId: 'q4', quoteNumber: 'C003' }),
        row({ id: 'b', quoteId: 'q4', quoteNumber: 'C003', stepOrder: 2 }),
      ]
      const view = groupOverviewRowsByDate(rows)
      expect(view).toHaveLength(3)
      expect(view[0]).toMatchObject({ isDateHeader: true, dateKey: null, dateTitle: '无开始日期' })
      expect(taskIdsOf(view)).toEqual(['a', 'b'])
    })

    it('开始日期为非法字符串时归入「无开始日期」组（不影响其他分组）', () => {
      const rows = [
        row({ id: 'bad-1', quoteId: 'q7', quoteNumber: 'G007', planStart: 'not-a-date' }),
        row({ id: 'ok-1', quoteId: 'q8', quoteNumber: 'H008', planStart: '2026-09-08' }),
        row({ id: 'bad-2', quoteId: 'q9', quoteNumber: 'I009', planStart: '2026/09/01' }),
      ]
      const view = groupOverviewRowsByDate(rows)
      expect(view.map((r) => ('isDateHeader' in r ? `头:${r.dateKey}` : r.id))).toEqual([
        '头:2026-09-08', 'ok-1',
        '头:null', 'bad-1', 'bad-2',
      ])
      // 订单优先维度同样不受非法日期影响（该订单与无日期订单同序最后）
      const sorted = sortOverviewRowsByOrderDim(rows, (qid) => (qid === 'q8' ? '2026-09-08' : 'not-a-date'))
      expect(sorted.map((r) => r.id)).toEqual(['ok-1', 'bad-1', 'bad-2'])
    })
  })

  describe('日期分组头徽标（buildDateBadgeImage）', () => {
    it('有日期：蓝底白字 SVG data URI，包含日号', () => {
      const uri = buildDateBadgeImage('2026-09-10')
      expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
      const svg = decodeURIComponent(uri)
      expect(svg).toContain('#2563eb')
      expect(svg).toContain('10')
    })

    it('无日期：显示「无」占位（单字符同默认字号）', () => {
      const svg = decodeURIComponent(buildDateBadgeImage(null))
      expect(svg).toContain('无')
      expect(svg).toContain('font-size="34"')
    })
  })
})
