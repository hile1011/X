/**
 * SheetTemplateManager（v23 一对多模板缓存）单元测试
 *
 * 测试目标：
 *   - loadOverrides：数据库模板加载、非法记录过滤、幂等、force 刷新、失败静默重试
 *   - setOverride / removeOverride：管理页保存/删除后的缓存维护（深拷贝隔离）
 *   - listByStyle：一对多按款式查询 + id 排序
 *   - getTemplateById / getTemplateName：按 id 读取
 *   - getTemplate(style, templateId?)：模板解析优先级（数据库模板 > 内置款式模板 > 默认款式）
 *   - getDefaultTemplate / getBuiltinTemplate / hasTemplate / getAllStyles：内置模板目录查询
 *
 * 状态隔离：每个用例前 vi.resetModules() + 动态 import，
 * 保证 static 类字段（entries / entriesLoaded）在每个用例中都是全新状态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock api 模块，避免真实网络请求
vi.mock('../src/api', () => ({
  api: {
    sheetTemplates: {
      getAll: vi.fn(),
    },
  },
}))

type ManagerType = typeof import('../src/templates/SheetTemplateManager')

let mockGetAll: ReturnType<typeof vi.fn>
let Manager: ManagerType

beforeEach(async () => {
  vi.resetModules()
  const { api } = await import('../src/api')
  mockGetAll = api.sheetTemplates.getAll as ReturnType<typeof vi.fn>
  mockGetAll.mockReset()
  Manager = (await import('../src/templates/SheetTemplateManager')).SheetTemplateManager
})

// ============================ 测试数据 ============================
const DATA_A: (string | number | null)[][] = [
  ['标题行', 1, 2],
  ['成品', 7200, 38],
]
const DATA_B: (string | number | null)[][] = [['另一模板', 9]]
const FORMULAS_A = { B2: '=B1*2', C2: '=SUM(B1:B1)' }

/** 构造一条合法的数据库模板记录（loadOverrides 的后端返回形态） */
const record = (id: string, styleCode: string, name: string, data = DATA_A, formulas = FORMULAS_A) => ({
  id, styleCode, name, data, formulas,
})

// ============================ 测试用例 ============================

describe('loadOverrides：数据库模板加载', () => {
  it('合法记录进入缓存，listByStyle 可按款式查询', async () => {
    mockGetAll.mockResolvedValue([
      record('tpl-1', '2', '常规款'),
      record('tpl-2', '2', '加厚款', DATA_B, {}),
      record('tpl-3', '3', '侧底款'),
    ])
    await Manager.loadOverrides()

    const style2 = Manager.listByStyle('2')
    expect(style2).toHaveLength(2)
    expect(style2.map((e) => e.name)).toEqual(['常规款', '加厚款'])
    expect(style2[0].template.data).toEqual(DATA_A)
    expect(style2[0].template.formulas).toEqual(FORMULAS_A)
    expect(style2[1].template.data).toEqual(DATA_B)

    expect(Manager.listByStyle('3')).toHaveLength(1)
    expect(Manager.listByStyle('1')).toHaveLength(0)
  })

  it('过滤非法记录：无 id / 无 styleCode / data 非数组 / data 空数组', async () => {
    mockGetAll.mockResolvedValue([
      { styleCode: '2', name: '缺 id', data: DATA_A, formulas: {} },          // 无 id
      { id: 'x1', name: '缺 styleCode', data: DATA_A, formulas: {} },          // 无 styleCode
      { id: 'x2', styleCode: '2', name: 'data 非数组', data: 'not-array' },    // data 非数组
      { id: 'x3', styleCode: '2', name: 'data 空数组', data: [] },             // data 空数组
      record('ok-1', '2', '唯一合法'),
      null, // 空记录整体跳过（可选链防御）
    ])
    await Manager.loadOverrides()

    const entries = Manager.listByStyle('2')
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('唯一合法')
  })

  it('name 缺省为空字符串、formulas 缺省为空对象', async () => {
    mockGetAll.mockResolvedValue([
      { id: 'tpl-x', styleCode: '4', data: DATA_A }, // 无 name、无 formulas
    ])
    await Manager.loadOverrides()

    expect(Manager.getTemplateName('tpl-x')).toBe('')
    expect(Manager.getTemplateById('tpl-x')!.formulas).toEqual({})
  })

  it('幂等：已加载后再次调用不重新请求后端', async () => {
    mockGetAll.mockResolvedValue([record('tpl-1', '2', '常规款')])
    await Manager.loadOverrides()
    await Manager.loadOverrides()

    expect(mockGetAll).toHaveBeenCalledTimes(1)
  })

  it('force=true 强制重新拉取并整体替换缓存', async () => {
    mockGetAll.mockResolvedValueOnce([
      record('tpl-1', '2', '旧模板'),
      record('tpl-2', '2', '旧模板2'),
    ])
    await Manager.loadOverrides()
    expect(Manager.listByStyle('2')).toHaveLength(2)

    // 管理页删除/修改后强制刷新：后端只剩一条（且是新的）
    mockGetAll.mockResolvedValueOnce([record('tpl-new', '2', '新模板')])
    await Manager.loadOverrides(true)

    const entries = Manager.listByStyle('2')
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('新模板')
    // 旧缓存被整体替换，不再能查到已删除的 tpl-1
    expect(Manager.getTemplateById('tpl-1')).toBeNull()
    expect(mockGetAll).toHaveBeenCalledTimes(2)
  })

  it('加载失败静默不抛错，且下次调用可重试成功', async () => {
    // 第一次失败（网络/权限）
    mockGetAll.mockRejectedValueOnce(new Error('network error'))
    await expect(Manager.loadOverrides()).resolves.toBeUndefined()
    // 失败后缓存保持空：内置模板兜底
    expect(Manager.listByStyle('2')).toHaveLength(0)

    // 第二次调用可重试（entriesLoaded 未被置 true）
    mockGetAll.mockResolvedValueOnce([record('tpl-1', '2', '重试成功')])
    await Manager.loadOverrides()
    expect(Manager.listByStyle('2')).toHaveLength(1)
  })
})

describe('setOverride / removeOverride：管理页缓存维护', () => {
  it('setOverride 写入后可查询，并标记已加载（loadOverrides 不再请求）', async () => {
    Manager.setOverride('tpl-a', '2', '手工写入', { data: DATA_A, formulas: FORMULAS_A })

    expect(Manager.getTemplateName('tpl-a')).toBe('手工写入')
    expect(Manager.listByStyle('2')).toHaveLength(1)

    // 已标记 loaded：loadOverrides 直接短路，不触达后端
    await Manager.loadOverrides()
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('setOverride 深拷贝：修改传入模板对象不影响缓存', () => {
    const original = { data: [[1, 2]], formulas: { A1: '=1' } }
    Manager.setOverride('tpl-a', '2', '隔离验证', original)

    // 污染调用方对象
    original.data[0][0] = 999
    original.formulas.A1 = '=changed'

    const cached = Manager.getTemplateById('tpl-a')!
    expect(cached.data[0][0]).toBe(1)
    expect(cached.formulas.A1).toBe('=1')
  })

  it('removeOverride 删除后 getTemplateById / getTemplateName 均失效', () => {
    Manager.setOverride('tpl-a', '2', '待删除', { data: DATA_A, formulas: {} })
    expect(Manager.getTemplateById('tpl-a')).not.toBeNull()

    Manager.removeOverride('tpl-a')
    expect(Manager.getTemplateById('tpl-a')).toBeNull()
    expect(Manager.getTemplateName('tpl-a')).toBeNull()
    expect(Manager.listByStyle('2')).toHaveLength(0)
  })
})

describe('listByStyle：一对多按款式查询', () => {
  it('仅返回匹配款式的模板，且按 id 字典序排序', () => {
    // 乱序写入（插入顺序 c → a → b）
    Manager.setOverride('tpl-c', '2', 'C', { data: DATA_A, formulas: {} })
    Manager.setOverride('tpl-a', '2', 'A', { data: DATA_A, formulas: {} })
    Manager.setOverride('tpl-b', '3', 'B', { data: DATA_A, formulas: {} })
    Manager.setOverride('tpl-a2', '2', 'A2', { data: DATA_A, formulas: {} })

    const style2 = Manager.listByStyle('2')
    expect(style2.map((e) => e.id)).toEqual(['tpl-a', 'tpl-a2', 'tpl-c'])
    expect(Manager.listByStyle('3').map((e) => e.id)).toEqual(['tpl-b'])
  })

  it('无模板的款式返回空数组', () => {
    expect(Manager.listByStyle('5')).toEqual([])
  })
})

describe('getTemplateById / getTemplateName：按 id 读取', () => {
  it('返回深拷贝：修改返回值不影响后续读取', () => {
    Manager.setOverride('tpl-a', '2', '深拷贝验证', { data: DATA_A, formulas: FORMULAS_A })

    const first = Manager.getTemplateById('tpl-a')!
    first.data[0][1] = '污染'
    first.formulas.B2 = '=changed'

    const second = Manager.getTemplateById('tpl-a')!
    expect(second.data[0][1]).toBe(1)
    expect(second.formulas.B2).toBe('=B1*2')
  })

  it('不存在的 id：getTemplateById 返回 null，getTemplateName 返回 null', () => {
    expect(Manager.getTemplateById('not-exist')).toBeNull()
    expect(Manager.getTemplateName('not-exist')).toBeNull()
  })
})

describe('isOverridden：款式覆盖判断', () => {
  it('有数据库模板的款式返回 true，无模板的款式返回 false', () => {
    Manager.setOverride('tpl-a', '2', '覆盖款', { data: DATA_A, formulas: {} })

    expect(Manager.isOverridden('2')).toBe(true)
    expect(Manager.isOverridden('1')).toBe(false)
  })
})

describe('getTemplate：模板解析优先级（订单页核心路径）', () => {
  it('templateId 命中数据库模板时优先返回数据库版本', () => {
    // 款式 2 已有数据库覆盖，且与内置数据不同
    Manager.setOverride('tpl-2', '2', '数据库版本', { data: DATA_B, formulas: {} })

    const result = Manager.getTemplate('2', 'tpl-2')
    expect(result.data).toEqual(DATA_B)
  })

  it('templateId 指向已删除的模板时回退内置款式模板', () => {
    // 款式 2 有另一条数据库模板，但传入的 templateId 不存在
    Manager.setOverride('tpl-2', '2', '另一模板', { data: DATA_B, formulas: {} })

    const result = Manager.getTemplate('2', 'ghost-deleted-id')
    // 回退到内置款式 2 模板（非空、非 DATA_B）
    expect(result.data).not.toEqual(DATA_B)
    expect(result.data.length).toBeGreaterThan(0)
    expect(Manager.hasTemplate('2')).toBe(true)
  })

  it('无 templateId 时返回内置款式模板', () => {
    // 即使款式 3 有数据库覆盖，不传 templateId 仍返回内置版本
    Manager.setOverride('tpl-3', '3', '覆盖版本', { data: DATA_B, formulas: {} })

    const result = Manager.getTemplate('3')
    expect(result.data).not.toEqual(DATA_B)
    expect(result.data.length).toBeGreaterThan(0)
  })

  it('未知款式回退默认款式（无底无侧普通袋）模板', () => {
    const unknown = Manager.getTemplate('99')
    const fallback = Manager.getTemplate('1')
    expect(unknown.data).toEqual(fallback.data)
    expect(unknown.formulas).toEqual(fallback.formulas)
  })

  it('返回深拷贝：两次调用修改互不影响', () => {
    const first = Manager.getTemplate('1')
    first.data[0][1] = '污染'

    const second = Manager.getTemplate('1')
    expect(second.data[0][1]).not.toBe('污染')
  })
})

describe('getDefaultTemplate / getBuiltinTemplate：内置模板获取', () => {
  it('getDefaultTemplate 还认内置默认款式（无底无侧）深拷贝', () => {
    const tpl = Manager.getDefaultTemplate()
    const style1 = Manager.getTemplate('1')
    expect(tpl.data).toEqual(style1.data)
    expect(tpl.formulas).toEqual(style1.formulas)

    // 深拷贝验证
    tpl.data[0][1] = '污染'
    expect(Manager.getDefaultTemplate().data[0][1]).not.toBe('污染')
  })

  it('getBuiltinTemplate 忽略数据库覆盖，始终返回内置版本', () => {
    Manager.setOverride('tpl-2', '2', '数据库覆盖', { data: DATA_B, formulas: {} })

    // 模板管理页"复制内置模板"场景：不受覆盖影响
    const builtin = Manager.getBuiltinTemplate('2')
    expect(builtin.data).not.toEqual(DATA_B)
    expect(builtin.data.length).toBeGreaterThan(0)
  })

  it('getBuiltinTemplate 未知款式回退默认款式', () => {
    const unknown = Manager.getBuiltinTemplate('xyz')
    const style1 = Manager.getTemplate('1')
    expect(unknown.data).toEqual(style1.data)
  })
})

describe('内置模板目录查询', () => {
  it('DEFAULT_STYLE 为款式 1（无底无侧普通袋）', () => {
    expect(Manager.DEFAULT_STYLE).toBe('1')
  })

  it('hasTemplate：款式 1-6 均有内置模板，其他值无', () => {
    for (let i = 1; i <= 6; i++) {
      expect(Manager.hasTemplate(String(i))).toBe(true)
    }
    expect(Manager.hasTemplate('0')).toBe(false)
    expect(Manager.hasTemplate('')).toBe(false)
    expect(Manager.hasTemplate('99')).toBe(false)
    expect(Manager.hasTemplate('undefined')).toBe(false)
  })

  it('getAllStyles 返回全部 6 个款式 code', () => {
    expect(Manager.getAllStyles()).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('每个内置模板 data 为非空二维数组、formulas 为对象', () => {
    for (const style of Manager.getAllStyles()) {
      const tpl = Manager.getTemplate(style)
      expect(Array.isArray(tpl.data)).toBe(true)
      expect(tpl.data.length).toBeGreaterThan(0)
      expect(typeof tpl.formulas).toBe('object')
      // 每行都是数组（保证表格渲染安全）
      for (const row of tpl.data) {
        expect(Array.isArray(row)).toBe(true)
      }
    }
  })
})
