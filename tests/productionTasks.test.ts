/**
 * 做货流程任务服务层（src/services/productionTasks.ts）单元测试
 *
 * 测试覆盖：
 *   1. 日期工具：toDateStr / parseDate / addDays / diffDays（本地时区安全）
 *   2. createDefaultTasks：默认 6 步骤（含首步骤今天排期）、临时 id、初始状态
 *      与甘特图事件日期归一化 normalizeGanttDateArg
 *   3. 状态联动：resolveStatusByActualTimes / isStatusConflicted
 *   4. 一键排期 autoSchedule：均分区间、退化场景（天数 < 任务数）、非法入参
 *   5. 甘特图 record 转换 toGanttRecords：progress 状态映射
 *   6. 时间轴范围 computeTimelineRange：min/max ± 7 天、无日期回退今天 ± 14 天
 *   7. 汇总 summarizeTasks：完成数、材料备齐、计划区间
 *   8. 备料联动 applySheetFabricPrep：字段映射、手提数量×2、米数向上取整、手动保留、ready 继承、幂等、不联动情形
 */
import { describe, it, expect } from 'vitest'
import {
  toDateStr, parseDate, addDays, diffDays, normalizeGanttDateArg,
  createDefaultTasks, resolveStatusByActualTimes, isStatusConflicted,
  autoSchedule, toGanttRecords, computeTimelineRange, computeInitialFocusDate, summarizeTasks,
  applySheetFabricPrep,
  type ProductionTask, type FabricPrepRow,
} from '../src/services/productionTasks'

/** 构造测试任务 */
function task(partial: Partial<ProductionTask> = {}): ProductionTask {
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
  }
}

describe('日期工具', () => {
  it('toDateStr：输出 YYYY-MM-DD（补零）', () => {
    expect(toDateStr(new Date(2026, 8, 6))).toBe('2026-09-06')
    expect(toDateStr(new Date(2026, 0, 1))).toBe('2026-01-01')
  })

  it('parseDate：合法字符串解析为本地午夜；非法返回 null', () => {
    const d = parseDate('2026-09-06')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(6)
    expect(parseDate(null)).toBeNull()
    expect(parseDate('')).toBeNull()
    expect(parseDate('2026/09/06')).toBeNull()
    expect(parseDate('2026-9-6')).toBeNull()
  })

  it('addDays / diffDays：跨月进位与差值计算', () => {
    const d = parseDate('2026-09-30')!
    expect(toDateStr(addDays(d, 1))).toBe('2026-10-01')
    expect(toDateStr(addDays(d, -1))).toBe('2026-09-29')
    expect(diffDays(parseDate('2026-09-01')!, parseDate('2026-09-10')!)).toBe(9)
    expect(diffDays(parseDate('2026-10-01')!, parseDate('2026-09-01')!)).toBe(-30)
  })
})

describe('createDefaultTasks', () => {
  it('生成 6 个默认步骤（无质检、裁剪后为手提），首步骤从今天开始', () => {
    const today = toDateStr(new Date())
    const tasks = createDefaultTasks()
    expect(tasks).toHaveLength(6)
    expect(tasks.map((t) => t.name)).toEqual(['面料采购', '裁剪', '手提', '印刷', '缝纫', '包装'])
    expect(tasks.map((t) => t.stepOrder)).toEqual([1, 2, 3, 4, 5, 6])
    // 首步骤：计划开始/结束为当天（单日排期）
    expect(tasks[0].planStart).toBe(today)
    expect(tasks[0].planEnd).toBe(today)
    // 其余步骤待排期
    for (const t of tasks.slice(1)) {
      expect(t.planStart).toBeNull()
      expect(t.planEnd).toBeNull()
    }
    for (const t of tasks) {
      expect(t.id).toMatch(/^tmp-/)
      expect(t.actualStart).toBeNull()
      expect(t.actualEnd).toBeNull()
      expect(t.status).toBe(0)
      expect(t.remark).toBe('')
      expect(t.materials).toEqual([])
    }
  })
})

describe('甘特图事件日期归一化 normalizeGanttDateArg', () => {
  it('yyyy-mm-dd 字符串原样返回（库真实事件签名）', () => {
    expect(normalizeGanttDateArg('2026-09-10')).toBe('2026-09-10')
  })

  it('Date 对象转为本地日期串', () => {
    expect(normalizeGanttDateArg(new Date(2026, 8, 10))).toBe('2026-09-10')
  })

  it('非法入参返回 null', () => {
    expect(normalizeGanttDateArg('invalid-date')).toBeNull()
    expect(normalizeGanttDateArg('2026/09/10')).toBeNull()
    expect(normalizeGanttDateArg(null)).toBeNull()
    expect(normalizeGanttDateArg(undefined)).toBeNull()
  })
})

describe('状态联动（resolveStatusByActualTimes / isStatusConflicted）', () => {
  it('实际结束优先 → 已完成(2)', () => {
    expect(resolveStatusByActualTimes({ actualStart: '2026-09-01', actualEnd: '2026-09-02', status: 1 })).toBe(2)
  })

  it('仅有实际开始 → 进行中(1)', () => {
    expect(resolveStatusByActualTimes({ actualStart: '2026-09-01', actualEnd: null, status: 0 })).toBe(1)
  })

  it('无实际时间 → 未开始(0)', () => {
    expect(resolveStatusByActualTimes({ actualStart: null, actualEnd: null, status: 2 })).toBe(0)
  })

  it('isStatusConflicted：状态与时间矛盾时为 true', () => {
    expect(isStatusConflicted({ actualStart: null, actualEnd: null, status: 0 })).toBe(false)
    expect(isStatusConflicted({ actualStart: '2026-09-01', actualEnd: null, status: 0 })).toBe(true)
    expect(isStatusConflicted({ actualStart: null, actualEnd: '2026-09-02', status: 2 })).toBe(false)
  })
})

describe('一键排期 autoSchedule', () => {
  it('区间按任务数均分（末任务到结束日期）', () => {
    const tasks = createDefaultTasks()
    const scheduled = autoSchedule(tasks, '2026-09-01', '2026-09-12')!
    expect(scheduled).toHaveLength(6)
    // 12 天 / 6 任务 = 2 天每任务
    expect(scheduled[0].planStart).toBe('2026-09-01')
    expect(scheduled[0].planEnd).toBe('2026-09-02')
    expect(scheduled[1].planStart).toBe('2026-09-03')
    expect(scheduled[2].planStart).toBe('2026-09-05')
    // 末任务固定收在结束日期
    expect(scheduled[5].planStart).toBe('2026-09-11')
    expect(scheduled[5].planEnd).toBe('2026-09-12')
  })

  it('区间天数小于任务数时每任务 1 天（允许重叠）', () => {
    const tasks = createDefaultTasks()
    const scheduled = autoSchedule(tasks, '2026-09-01', '2026-09-02')!
    // 2 天 < 6 任务：退化为每天 1 任务，末任务收在结束日期
    expect(scheduled[0].planStart).toBe('2026-09-01')
    expect(scheduled[0].planEnd).toBe('2026-09-01')
    expect(scheduled[5].planEnd).toBe('2026-09-02')
  })

  it('不修改原数组（返回副本）', () => {
    const tasks = createDefaultTasks()
    const today = toDateStr(new Date())
    const scheduled = autoSchedule(tasks, '2026-09-01', '2026-09-12')!
    // 首步骤默认排期为今天，排期后不应回写原数组
    expect(tasks[0].planStart).toBe(today)
    expect(scheduled[0].planStart).toBe('2026-09-01')
  })

  it('非法入参返回 null：缺日期 / 空任务 / 格式错误', () => {
    const tasks = createDefaultTasks()
    expect(autoSchedule(tasks, null, '2026-09-12')).toBeNull()
    expect(autoSchedule(tasks, '2026-09-01', null)).toBeNull()
    expect(autoSchedule(tasks, '2026-09-01', '2026/09/12')).toBeNull()
    expect(autoSchedule([], '2026-09-01', '2026-09-12')).toBeNull()
  })
})

describe('甘特图 record 转换 toGanttRecords', () => {
  it('progress 按状态映射 0/50/100，materialsCount 正确', () => {
    const records = toGanttRecords([
      task({ id: 'a', status: 0 }),
      task({ id: 'b', status: 1 }),
      task({ id: 'c', status: 2, materials: [{ name: '白坯布', quantity: 1, ready: false }] }),
    ])
    expect(records.map((r) => r.progress)).toEqual([0, 50, 100])
    expect(records.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(records[2].materialsCount).toBe(1)
    expect(records[0].materialsCount).toBe(0)
  })
})

describe('时间轴范围 computeTimelineRange', () => {
  it('取全部日期 min/max ± 7 天 buffer', () => {
    const range = computeTimelineRange([
      task({ planStart: '2026-09-01', planEnd: '2026-09-05' }),
      task({ planStart: '2026-09-10', planEnd: '2026-09-15', actualStart: '2026-09-09' }),
    ])
    expect(range.minDate).toBe('2026-08-25')
    expect(range.maxDate).toBe('2026-09-22')
  })

  it('无任何日期时回退为今天 ± 14 天', () => {
    const today = new Date()
    const range = computeTimelineRange([task(), task()])
    expect(range.minDate).toBe(toDateStr(addDays(today, -14)))
    expect(range.maxDate).toBe(toDateStr(addDays(today, 14)))
  })
})

describe('初始视口定位 computeInitialFocusDate', () => {
  it('最早计划开始晚于今天 → 定位到今天', () => {
    const future = toDateStr(addDays(new Date(), 10))
    const focus = computeInitialFocusDate([task({ planStart: future })])
    expect(toDateStr(focus)).toBe(toDateStr(new Date()))
  })

  it('排期已开始（最早开始在过去）→ 定位到最早开始', () => {
    const past = toDateStr(addDays(new Date(), -20))
    const focus = computeInitialFocusDate([
      task({ planStart: past }),
      task({ planStart: toDateStr(addDays(new Date(), -5)) }),
    ])
    expect(toDateStr(focus)).toBe(past)
  })

  it('无计划日期时回退实际开始日期', () => {
    const past = toDateStr(addDays(new Date(), -3))
    const focus = computeInitialFocusDate([task({ planStart: null, actualStart: past })])
    expect(toDateStr(focus)).toBe(past)
  })

  it('无任何日期 → 今天', () => {
    expect(toDateStr(computeInitialFocusDate([task()]))).toBe(toDateStr(new Date()))
    expect(toDateStr(computeInitialFocusDate([]))).toBe(toDateStr(new Date()))
  })
})

describe('汇总 summarizeTasks', () => {
  it('完成数、材料备齐、计划区间', () => {
    const summary = summarizeTasks([
      task({
        status: 2, planStart: '2026-09-02', planEnd: '2026-09-03',
        materials: [
          { name: '白坯布', quantity: 1, ready: true },
          { name: '油墨', quantity: 1, ready: false },
        ],
      }),
      task({ status: 1, planStart: '2026-09-01', planEnd: '2026-09-10', materials: [{ name: '纸箱', quantity: 2, ready: true }] }),
      task({ status: 0 }),
    ])
    expect(summary.total).toBe(3)
    expect(summary.completed).toBe(1)
    expect(summary.materialsTotal).toBe(3)
    expect(summary.materialsReady).toBe(2)
    expect(summary.planRange).toBe('2026-09-01 ~ 2026-09-10')
  })

  it('无任务与未排期场景', () => {
    expect(summarizeTasks([])).toMatchObject({ total: 0, completed: 0, materialsTotal: 0, materialsReady: 0, planRange: '未排期' })
    expect(summarizeTasks([task()]).planRange).toBe('未排期')
  })
})

// ============================ 备料联动（applySheetFabricPrep） ============================

describe('applySheetFabricPrep - 在线表格备料合并', () => {
  const rows: FabricPrepRow[] = [
    { name: '正反面', quantity: 7200, cutWidth: 41, cutHeight: 90, meters: 2160 },
    { name: '手提', quantity: 7200, cutWidth: 6, cutHeight: 70, meters: 403.2 },
  ]

  it('字段映射：名称/数量→quantity、切宽×切高→cutSize、米数向上取整→meters、来源标记 sheet', () => {
    const next = applySheetFabricPrep([task()], rows)!
    expect(next[0].materials).toEqual([
      { name: '正反面', quantity: 7200, cutSize: '41×90cm', meters: 2160, ready: false, source: 'sheet' },
      { name: '手提', quantity: 14400, cutSize: '6×70cm', meters: 404, ready: false, source: 'sheet' },
    ])
  })

  it('手提数量自动×2；布料米数向上取整（2160.5 → 2161）', () => {
    const next = applySheetFabricPrep([task()], [
      { name: '手提', quantity: 3600, cutWidth: 6, cutHeight: 70, meters: 2160.5 },
    ])!
    expect(next[0].materials[0]).toMatchObject({ name: '手提', quantity: 7200, meters: 2161 })
  })

  it('手动材料原样保留且排在同步条目之前；ready 按名称从旧条目继承', () => {
    const tasks: ProductionTask[] = [
      task({
        materials: [
          { name: '白坯布', quantity: 5, ready: true },
          { name: '正反面', quantity: 999, cutSize: '旧尺寸', meters: 999, ready: true, source: 'sheet' },
        ],
      }),
    ]
    const next = applySheetFabricPrep(tasks, rows)!
    expect(next[0].materials).toEqual([
      { name: '白坯布', quantity: 5, ready: true },
      { name: '正反面', quantity: 7200, cutSize: '41×90cm', meters: 2160, ready: true, source: 'sheet' },
      { name: '手提', quantity: 14400, cutSize: '6×70cm', meters: 404, ready: false, source: 'sheet' },
    ])
  })

  it('旧 sheet 条目整体替换：表格删行后同步条目随之消失', () => {
    const tasks: ProductionTask[] = [
      task({
        materials: [
          { name: '正反面', quantity: 7200, cutSize: '41×90cm', meters: 2160, ready: false, source: 'sheet' },
          { name: '手提', quantity: 14400, cutSize: '6×70cm', meters: 404, ready: false, source: 'sheet' },
        ],
      }),
    ]
    // 表格只剩正反面一行
    const next = applySheetFabricPrep(tasks, rows.slice(0, 1))!
    expect(next[0].materials).toHaveLength(1)
    expect(next[0].materials[0].name).toBe('正反面')
  })

  it('幂等：合并结果与现有材料一致时返回 null（不误标 dirty）', () => {
    const once = applySheetFabricPrep([task()], rows)!
    expect(applySheetFabricPrep(once, rows)).toBeNull()
  })

  it('rows 为 null（表格结构不完整）返回 null 不联动', () => {
    expect(applySheetFabricPrep([task()], null)).toBeNull()
  })

  it('找不到「面料采购」任务（被改名/删除）返回 null', () => {
    const tasks: ProductionTask[] = [task({ name: '采购面料' })]
    expect(applySheetFabricPrep(tasks, rows)).toBeNull()
    expect(applySheetFabricPrep([], rows)).toBeNull()
  })

  it('数值缺失容错：数量 null → 0；切宽高不全 → cutSize 空；米数 null → 0', () => {
    const next = applySheetFabricPrep([task()], [
      { name: '底部', quantity: null, cutWidth: 41, cutHeight: null, meters: null },
    ])!
    expect(next[0].materials).toEqual([
      { name: '底部', quantity: 0, cutSize: '', meters: 0, ready: false, source: 'sheet' },
    ])
  })

  it('其他任务不受影响（原数组浅拷贝，仅面料采购任务被替换）', () => {
    const tasks: ProductionTask[] = [
      task(),
      task({ id: 't2', stepOrder: 2, name: '裁剪' }),
    ]
    const next = applySheetFabricPrep(tasks, rows)!
    expect(next).toHaveLength(2)
    expect(next[1]).toBe(tasks[1])
    expect(next[0]).not.toBe(tasks[0])
  })
})
