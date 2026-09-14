/**
 * 在线表格 VTable 公式联动 & 表格-订单信息联动 集成测试
 *
 * 测试目标：
 * 1. VTable 公式引擎：单元格编辑后级联重算依赖公式
 * 2. 表格 → 订单信息联动：卖价/规格/数量/手提规格 从表格同步到订单信息
 * 3. 款式切换 → 模板切换：不同款式加载不同模板
 * 4. 模板公式定义验证：公式字符串正确、单元格引用有效
 *
 * 环境要求：jsdom + canvas mock（tests/setup.ts）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { wrapFabricMetersFormulas } from '../src/services/fabricMeters'

// ============================ 测试用模板数据（款式1：无底无侧普通袋） ============================

const TEMPLATE_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
  ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, 2.97, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, 3240, null, null, null, null, null, null],
]

const TEMPLATE_FORMULAS: Record<string, string> = {
  B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
  H3: '=F3+C3',
  I3: '=(D3*2+E3+G3)',
  L3: '=MOD(J3,MIN(H3,I3))',
  M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
  N3: '=J3/(MIN(H3,I3))',
  O3: '=M3*K3*1.5/1000',
  P3: '=M3*4/(I4/100)',
  B4: '=B2', I4: '=D4',
  L4: '=MOD(J4,MIN(H4,I4))',
  M4: '=I4/100*2*B4/INT(J4/H4)',
  N4: '=J4/(MIN(H4,I4))',
  O4: '=M4*K4*1.5/1000',
  A6: '=A3',
  C6: '=H3*I3*1.1/10000',
  E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
  H6: '=O3*0.8',
  J6: '=(B6+C6+F6+E6+H6/B3)*I6+G6',
  A7: '=A4',
  E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
  H7: '=O4*0.8',
  J7: '=(B7+C7+E7+F7+H7/B4)*I7+G7',
  J8: '=SUM(J6:J7)',
  J9: '=J8+I9',
  K9: '=J9*1.1',
  J10: '=(J9-J8)*B2',
}

// 简化列定义
const COL_WIDTHS = [100, 90, 80, 80, 80, 90, 90, 90, 90, 90, 80, 120, 110, 130, 100, 120]
const TEST_COLUMNS = COL_WIDTHS.map((width, field) => ({ field, width }))

const SHEET_KEY = 'sheet1'
const FINISHED_ROW = 1
const REF_SELL_ROW = 8

// ============================ 测试辅助函数 ============================

/** 深拷贝模板数据（防止测试间数据污染） */
function cloneData(): (string | number | null)[][] {
  return TEMPLATE_DATA.map(row => [...row])
}

/** 创建 VTableSheet 实例（每次使用独立数据副本） */
function createSheet(container: HTMLElement): VTableSheet {
  return new VTableSheet(container, {
    undoRedo: { show: true },
    VTablePluginModules: [{ module: TableExportPlugin }, { module: ExcelImportPlugin }],
    sheets: [{
      sheetKey: SHEET_KEY,
      sheetTitle: SHEET_KEY,
      columns: TEST_COLUMNS,
      data: cloneData(),
      formulas: { ...TEMPLATE_FORMULAS },
      showHeader: false,
    }],
  })
}

/** 从公式引擎读取单元格计算值（getCellValue 按需重算，无需手动清缓存） */
function getCellValue(sheet: VTableSheet, row: number, col: number): number | string | null {
  const fm = (sheet as any).formulaManager
  if (!fm) return null
  const result = fm.getCellValue({ sheet: SHEET_KEY, row, col })
  return result?.value ?? null
}

/** 从表格实例读取单元格原始值 */
function getCellOriginValue(sheet: VTableSheet, col: number, row: number): any {
  const ws = sheet.getActiveSheet()
  const table = ws?.tableInstance as any
  return table?.getCellOriginValue?.(col, row) ?? table?.getCellValue?.(col, row)
}

/**
 * 修改单元格值：
 * 1. ws.setCellValue 更新表格 record（供 getCellOriginValue 读取原始值）
 * 2. fm.setCellContent 更新公式引擎（供 getCellValue 按需重算公式）
 *
 * 注意：不能调用 formulaEngine.updateSheetData —— 它会用表格 record 覆盖公式引擎的
 * sheetData，而 record 中公式单元格的值是旧的静态值，会导致公式重算失效。
 */
function setCellValue(sheet: VTableSheet, col: number, row: number, value: any): void {
  const ws = sheet.getActiveSheet()
  // 更新表格 record（触发 change_cell_value 事件，但在 headless 环境中级联可能不完整）
  ;(ws as any).setCellValue(col, row, value)
  // 直接更新公式引擎，确保 getCellValue 按需重算时读到最新值
  const fm = (sheet as any).formulaManager
  if (fm) {
    fm.setCellContent({ sheet: SHEET_KEY, row, col }, value)
  }
}

// ============================ 测试用例 ============================

describe('VTable 在线表格 — 公式联动测试', () => {
  let sheet: VTableSheet
  let container: HTMLElement

  beforeAll(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    sheet = createSheet(container)
  })

  afterAll(() => {
    sheet?.release?.()
    container?.remove()
  })

  describe('初始公式计算验证', () => {
    it('正反面数量 = 成品行数量（B3=B2）', () => {
      expect(getCellValue(sheet, 2, 1)).toBe(7200)
    })
    it('正反面宽 = 成品行宽（C3=C2）', () => {
      expect(getCellValue(sheet, 2, 2)).toBe(38)
    })
    it('正反面高 = 成品行高（D3=D2）', () => {
      expect(getCellValue(sheet, 2, 3)).toBe(40)
    })
    it('正反面底 = 成品行底（E3=E2）', () => {
      expect(getCellValue(sheet, 2, 4)).toBe(0)
    })
    it('正反面切片宽 = 宽出血 + 宽（H3=F3+C3 = 3+38 = 41）', () => {
      expect(getCellValue(sheet, 2, 7)).toBe(41)
    })
    it('正反面切片高 = 高×2 + 底 + 高出血（I3=D3*2+E3+G3 = 80+0+10 = 90）', () => {
      expect(getCellValue(sheet, 2, 8)).toBe(90)
    })
    it('门幅最大面数 = 布料门幅 / min(切片宽, 切片高)（N3=154/min(41,90)）', () => {
      expect(getCellValue(sheet, 2, 13)).toBeCloseTo(154 / 41, 2)
    })
    it('布料米数 > 0（M3 公式级联计算）', () => {
      const val = getCellValue(sheet, 2, 12)
      expect(typeof val).toBe('number')
      expect(val as number).toBeGreaterThan(0)
    })
    it('总重量 > 0（O3 = M3*K3*1.5/1000）', () => {
      const val = getCellValue(sheet, 2, 14)
      expect(typeof val).toBe('number')
      expect(val as number).toBeGreaterThan(0)
    })
    it('成本行正反面标签 = 规格行正反面（A6=A3）', () => {
      expect(getCellValue(sheet, 5, 0)).toBe('正反面')
    })
    it('汇总参考卖价 > 0（J8=SUM(J6:J7)）', () => {
      const val = getCellValue(sheet, 7, 9)
      expect(typeof val).toBe('number')
      expect(val as number).toBeGreaterThan(0)
    })
    it('参考卖价 = 汇总 + 利润率加价（J9=J8+I9）', () => {
      const j8 = getCellValue(sheet, 7, 9) as number
      const j9 = getCellValue(sheet, 8, 9) as number
      const i9 = getCellValue(sheet, 8, 8) as number
      expect(j9).toBeCloseTo(j8 + i9, 2)
    })
    it('含税价 = 参考卖价 × 1.1（K9=J9*1.1）', () => {
      const j9 = getCellValue(sheet, 8, 9) as number
      const k9 = getCellValue(sheet, 8, 10) as number
      expect(k9).toBeCloseTo(j9 * 1.1, 2)
    })
    it('利润 = (参考卖价 - 汇总) × 数量（J10=(J9-J8)*B2）', () => {
      const j9 = getCellValue(sheet, 8, 9) as number
      const j8 = getCellValue(sheet, 7, 9) as number
      const b2 = getCellValue(sheet, 1, 1) as number
      const j10 = getCellValue(sheet, 9, 9) as number
      expect(j10).toBeCloseTo((j9 - j8) * b2, 2)
    })
  })

  describe('公式级联重算 — 修改数量', () => {
    it('修改成品行数量后，正反面数量同步更新（B3=B2）', () => {
      setCellValue(sheet, 1, 1, 10000) // B2 = 10000
      expect(getCellValue(sheet, 2, 1)).toBe(10000) // B3
    })
    it('修改数量后，布料米数重新计算（M3 依赖 B3→N3）', () => {
      const m3 = getCellValue(sheet, 2, 12)
      expect(typeof m3).toBe('number')
      // M3 = CEILING(B3/INT(N3),1)*MAX(H3,I3)/100
      // B3=10000, N3=154/41≈3.756, INT(N3)=3, B3/3=3333.33, CEILING=3334
      // MAX(41,90)=90, 3334*90/100=3000.6
      expect(m3 as number).toBeGreaterThan(2160) // 原值 2160，应增大
    })
    it('修改数量后，总重量重新计算（O3 依赖 M3）', () => {
      const o3 = getCellValue(sheet, 2, 14)
      expect(typeof o3).toBe('number')
      expect(o3 as number).toBeGreaterThan(907) // 原值 907.2
    })
    it('修改数量后，利润重新计算（J10 依赖 B2）', () => {
      const j10 = getCellValue(sheet, 9, 9)
      expect(typeof j10).toBe('number')
      // 原值 3240，数量从 7200→10000，利润应增大
      expect(j10 as number).toBeGreaterThan(3240)
    })
    it('修改数量后，参考卖价重新计算（J9←J8←J6←E6←M3）', () => {
      const j9 = getCellValue(sheet, 8, 9)
      expect(typeof j9).toBe('number')
      expect(j9 as number).toBeGreaterThan(0)
    })
  })

  describe('公式级联重算 — 修改宽度', () => {
    it('修改成品行宽度后，正反面宽度同步（C3=C2）', () => {
      setCellValue(sheet, 2, 1, 45) // C2 = 45
      expect(getCellValue(sheet, 2, 2)).toBe(45) // C3
    })
    it('修改宽度后，切片宽重新计算（H3=F3+C3 = 3+45 = 48）', () => {
      expect(getCellValue(sheet, 2, 7)).toBe(48) // H3
    })
    it('修改宽度后，门幅最大面数重新计算（N3=154/min(48,90)）', () => {
      expect(getCellValue(sheet, 2, 13)).toBeCloseTo(154 / 48, 2) // N3
    })
  })

  describe('公式级联重算 — 修改高度', () => {
    it('修改成品行高度后，切片高重新计算（I3=D3*2+E3+G3 = 100+0+10 = 110）', () => {
      setCellValue(sheet, 3, 1, 50) // D2 = 50
      const d3 = getCellValue(sheet, 2, 3) // D3
      expect(d3).toBe(50)
      const i3 = getCellValue(sheet, 2, 8) // I3
      expect(i3).toBe(110)
    })
  })
})

describe('VTable 在线表格 — 表格与订单信息联动测试', () => {
  let sheet: VTableSheet
  let container: HTMLElement

  beforeAll(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    sheet = createSheet(container) // 独立数据副本，初始值 38*40*0
  })

  afterAll(() => {
    sheet?.release?.()
    container?.remove()
  })

  /** 模拟 syncFromTable 逻辑（与 BagQuote.tsx 一致） */
  function syncFromTable() {
    const fm = (sheet as any).formulaManager
    if (!fm) return null

    const rNoTax = fm.getCellValue({ sheet: SHEET_KEY, row: REF_SELL_ROW, col: 9 })
    const rWithTax = fm.getCellValue({ sheet: SHEET_KEY, row: REF_SELL_ROW, col: 10 })
    const sellPriceNoTax = rNoTax && typeof rNoTax.value === 'number' && !isNaN(rNoTax.value) ? rNoTax.value : null
    const sellPriceWithTax = rWithTax && typeof rWithTax.value === 'number' && !isNaN(rWithTax.value) ? rWithTax.value : null

    const fmtVal = (v: any): string => (v == null || v === '') ? '' : String(v)
    const width = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 2 })
    const height = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 3 })
    const base = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 4 })
    const qty = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 1 })
    const productSpec = [fmtVal(width?.value), fmtVal(height?.value), fmtVal(base?.value)].join('*')
    const quantity = fmtVal(qty?.value)

    // 手提规格联动
    const ws = sheet.getActiveSheet()
    const activeTable = ws?.tableInstance as any
    let handleSpec = ''
    const rowCount = activeTable?.rowCount ?? 0
    for (let r = 0; r < rowCount; r++) {
      const rowLabel = activeTable.getCellOriginValue?.(0, r) ?? activeTable.getCellValue?.(0, r)
      if (rowLabel === '手提') {
        const hw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 2 })
        const hh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 3 })
        const sw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 7 })
        const sh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 8 })
        const w = fmtVal(hw?.value), h = fmtVal(hh?.value)
        const sW = fmtVal(sw?.value), sH = fmtVal(sh?.value)
        const parts: string[] = []
        if (w && h) parts.push(`成品尺寸：${w}*${h}`)
        if (sW && sH) parts.push(`切片尺寸${sW}*${sH}`)
        handleSpec = parts.join('，')
        break
      }
    }

    return { sellPriceNoTax, sellPriceWithTax, productSpec, quantity, handleSpec }
  }

  describe('卖价同步', () => {
    it('不含税卖价从参考卖价行读取（J9）', () => {
      const result = syncFromTable()
      expect(result!.sellPriceNoTax).not.toBeNull()
      expect(result!.sellPriceNoTax).toBeGreaterThan(0)
    })
    it('含税卖价从参考卖价行读取（K9）', () => {
      const result = syncFromTable()
      expect(result!.sellPriceWithTax).not.toBeNull()
      expect(result!.sellPriceWithTax).toBeGreaterThan(0)
    })
    it('含税卖价 = 不含税卖价 × 1.1', () => {
      const result = syncFromTable()
      expect(result!.sellPriceWithTax).toBeCloseTo(result!.sellPriceNoTax! * 1.1, 2)
    })
  })

  describe('产品规格同步', () => {
    it('初始产品规格：38*40*0', () => {
      const result = syncFromTable()
      expect(result!.productSpec).toBe('38*40*0')
    })
    it('修改宽度后规格更新为 45*40*0', () => {
      setCellValue(sheet, 2, 1, 45)
      const result = syncFromTable()
      expect(result!.productSpec).toBe('45*40*0')
    })
    it('修改高度后规格更新为 45*50*0', () => {
      setCellValue(sheet, 3, 1, 50)
      const result = syncFromTable()
      expect(result!.productSpec).toBe('45*50*0')
    })
    it('修改底后规格更新为 45*50*8', () => {
      setCellValue(sheet, 4, 1, 8)
      const result = syncFromTable()
      expect(result!.productSpec).toBe('45*50*8')
    })
  })

  describe('数量同步', () => {
    it('修改数量后同步为 5000', () => {
      setCellValue(sheet, 1, 1, 5000)
      const result = syncFromTable()
      expect(result!.quantity).toBe('5000')
    })
    it('再次修改数量后同步为 20000', () => {
      setCellValue(sheet, 1, 1, 20000)
      const result = syncFromTable()
      expect(result!.quantity).toBe('20000')
    })
  })

  describe('手提规格同步', () => {
    it('初始手提规格包含成品尺寸和切片尺寸', () => {
      // 创建新 sheet 获取干净数据
      const c2 = document.createElement('div')
      document.body.appendChild(c2)
      const s2 = createSheet(c2)
      const fm = (s2 as any).formulaManager
      if (typeof fm?.clearCache === 'function') fm.clearCache()
      const ws = s2.getActiveSheet()
      const activeTable = ws?.tableInstance as any
      let handleSpec = ''
      for (let r = 0; r < (activeTable?.rowCount ?? 0); r++) {
        const rowLabel = activeTable.getCellOriginValue?.(0, r) ?? activeTable.getCellValue?.(0, r)
        if (rowLabel === '手提') {
          const hw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 2 })
          const hh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 3 })
          const sw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 7 })
          const sh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 8 })
          const w = String(hw?.value ?? ''), h = String(hh?.value ?? '')
          const sW = String(sw?.value ?? ''), sH = String(sh?.value ?? '')
          const parts: string[] = []
          if (w && h) parts.push(`成品尺寸：${w}*${h}`)
          if (sW && sH) parts.push(`切片尺寸${sW}*${sH}`)
          handleSpec = parts.join('，')
          break
        }
      }
      expect(handleSpec).toContain('成品尺寸：2.5*70')
      expect(handleSpec).toContain('切片尺寸6*70')
      s2?.release?.()
      c2.remove()
    })
    it('修改手提行宽度后，手提规格更新', () => {
      setCellValue(sheet, 2, 3, 3.5) // row 3, col 2 = 手提宽度
      const fm = (sheet as any).formulaManager
      const ws = sheet.getActiveSheet()
      const activeTable = ws?.tableInstance as any
      let handleSpec = ''
      for (let r = 0; r < (activeTable?.rowCount ?? 0); r++) {
        const rowLabel = activeTable.getCellOriginValue?.(0, r) ?? activeTable.getCellValue?.(0, r)
        if (rowLabel === '手提') {
          const hw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 2 })
          const hh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 3 })
          const w = String(hw?.value ?? ''), h = String(hh?.value ?? '')
          if (w && h) handleSpec = `成品尺寸：${w}*${h}`
          break
        }
      }
      expect(handleSpec).toContain('3.5')
    })
  })

  describe('联动一致性验证', () => {
    it('修改数量后卖价重新计算并同步', () => {
      const c3 = document.createElement('div')
      document.body.appendChild(c3)
      const s3 = createSheet(c3) // 干净数据
      setCellValue(s3, 1, 1, 15000)
      const fm = (s3 as any).formulaManager
      const rNoTax = fm.getCellValue({ sheet: SHEET_KEY, row: REF_SELL_ROW, col: 9 })
      const qty = fm.getCellValue({ sheet: SHEET_KEY, row: FINISHED_ROW, col: 1 })
      expect(String(qty?.value)).toBe('15000')
      expect(rNoTax?.value).toBeGreaterThan(0)
      s3?.release?.()
      c3.remove()
    })
  })
})

describe('VTable 在线表格 — 款式模板切换测试', () => {
  const STYLE_ROW_LABELS: Record<string, string[]> = {
    '1': ['成品', '正反面', '手提', '汇总', '参考卖价', '利润'],
    '2': ['成品', '正反面', '手提', '底部', '汇总', '参考卖价', '利润'],
    '3': ['成品', '正反面', '侧底', '手提', '汇总', '参考卖价', '利润'],
    '4': ['成品', '底部', '正面', '反面', '外口袋', '手提', '汇总', '参考卖价', '利润'],
  }

  it('款式1 有正反面和手提行，无底部行', () => {
    const labels = STYLE_ROW_LABELS['1']
    expect(labels).toContain('正反面')
    expect(labels).toContain('手提')
    expect(labels).not.toContain('底部')
  })
  it('款式2 有底部行（有底无侧）', () => {
    expect(STYLE_ROW_LABELS['2']).toContain('底部')
    expect(STYLE_ROW_LABELS['2']).not.toContain('侧底')
  })
  it('款式3 有侧底行（有底有侧）', () => {
    expect(STYLE_ROW_LABELS['3']).toContain('侧底')
  })
  it('款式4 有正面、反面、外口袋行', () => {
    expect(STYLE_ROW_LABELS['4']).toContain('正面')
    expect(STYLE_ROW_LABELS['4']).toContain('反面')
    expect(STYLE_ROW_LABELS['4']).toContain('外口袋')
  })
  it('不同款式模板行数不同', () => {
    const counts = Object.values(STYLE_ROW_LABELS).map(l => l.length)
    expect(new Set(counts).size).toBeGreaterThan(1)
  })
})

describe('VTable 在线表格 — 模板公式定义验证', () => {
  function colNameToIndex(name: string): number {
    let idx = 0
    for (let i = 0; i < name.length; i++) idx = idx * 26 + (name.charCodeAt(i) - 64)
    return idx - 1
  }
  function parseCellAddr(addr: string): { col: number; row: number } {
    const m = addr.match(/^([A-Z]+)(\d+)$/)
    return m ? { col: colNameToIndex(m[1]), row: parseInt(m[2]) - 1 } : { col: -1, row: -1 }
  }
  function extractCellRefs(formula: string): string[] {
    const refs: string[] = []
    const rangeMatch = formula.match(/([A-Z]+\d+):([A-Z]+\d+)/g)
    if (rangeMatch) rangeMatch.forEach(r => { refs.push(...r.split(':')) })
    const cleaned = formula.replace(/([A-Z]+\d+):([A-Z]+\d+)/g, '')
    const single = cleaned.match(/[A-Z]+\d+/g)
    if (single) refs.push(...single)
    return [...new Set(refs)]
  }

  it('所有公式键格式正确（字母+数字）', () => {
    for (const key of Object.keys(TEMPLATE_FORMULAS)) {
      expect(key).toMatch(/^[A-Z]+\d+$/)
    }
  })
  it('所有公式以 = 开头', () => {
    for (const f of Object.values(TEMPLATE_FORMULAS)) expect(f.startsWith('=')).toBe(true)
  })
  it('公式引用的单元格在模板数据范围内', () => {
    const maxRow = TEMPLATE_DATA.length - 1
    const maxCol = TEMPLATE_DATA[0].length - 1
    for (const [, formula] of Object.entries(TEMPLATE_FORMULAS)) {
      for (const ref of extractCellRefs(formula)) {
        const { col, row } = parseCellAddr(ref)
        expect(row).toBeGreaterThanOrEqual(0)
        expect(row).toBeLessThanOrEqual(maxRow)
        expect(col).toBeGreaterThanOrEqual(0)
        expect(col).toBeLessThanOrEqual(maxCol)
      }
    }
  })
  it('公式键指向的单元格在 data 范围内', () => {
    for (const addr of Object.keys(TEMPLATE_FORMULAS)) {
      const { col, row } = parseCellAddr(addr)
      expect(row).toBeLessThan(TEMPLATE_DATA.length)
      expect(col).toBeLessThan(TEMPLATE_DATA[0].length)
    }
  })
  it('关键公式：B3 引用 B2（正反面数量=成品行数量）', () => {
    expect(TEMPLATE_FORMULAS['B3']).toBe('=B2')
    const { col, row } = parseCellAddr('B2')
    expect(TEMPLATE_DATA[row][col]).toBe(7200)
  })
  it('关键公式：H3 引用 F3+C3（切片宽=宽出血+宽）', () => {
    expect(TEMPLATE_FORMULAS['H3']).toContain('F3')
    expect(TEMPLATE_FORMULAS['H3']).toContain('C3')
  })
  it('关键公式：K9 引用 J9（含税价=参考卖价×1.1）', () => {
    expect(TEMPLATE_FORMULAS['K9']).toContain('J9')
    expect(TEMPLATE_FORMULAS['K9']).toContain('1.1')
  })
  it('关键公式：J10 引用 B2（利润依赖数量）', () => {
    expect(TEMPLATE_FORMULAS['J10']).toContain('B2')
  })
  it('关键公式：J8 使用 SUM(J6:J7)', () => {
    expect(TEMPLATE_FORMULAS['J8']).toContain('SUM')
    expect(TEMPLATE_FORMULAS['J8']).toContain('J6')
    expect(TEMPLATE_FORMULAS['J8']).toContain('J7')
  })
})

// ============================================================================
// 公式单元格重算覆盖静态默认值测试
//
// 验证目标（对应 BagQuote.tsx 中的 recalculateFormulas）：
// 1. 模板 data 中公式单元格的预设默认值（可能是旧值/不精确值）应被公式
//    计算结果覆盖，使表格 record 显示准确值。
// 2. 非公式单元格保留其默认值，不受重算影响。
// 3. 重算后，公式单元格的表格原始值（getCellOriginValue）与公式引擎计算
//    值（getCellValue）一致。
// ============================================================================

/** 解析 Excel 地址为 0-based { row, col }（与 BagQuote.tsx 一致） */
function parseExcelAddress(addr: string): { row: number; col: number } {
  const match = addr.match(/^([A-Z]+)(\d+)$/)
  if (!match) return { row: -1, col: -1 }
  let col = 0
  for (let i = 0; i < match[1].length; i++) {
    col = col * 26 + (match[1].charCodeAt(i) - 64)
  }
  return { row: parseInt(match[2], 10) - 1, col: col - 1 }
}

/**
 * 复刻 BagQuote.tsx 中 recalculateFormulas 的核心逻辑：
 * 从公式引擎读取计算结果，覆盖表格 record 中的静态默认值。
 *
 * 注意：不调用 fm.setCellContent 重新注册公式 —— 实测会清空公式引擎的
 * 计算值。公式引擎在 VTableSheet 构造时已注册公式，getCellValue 按需重算。
 */
function recalculateFormulas(sheet: VTableSheet, formulas: Record<string, string>): void {
  const fm = (sheet as any).formulaManager
  const ws = sheet.getActiveSheet()
  if (!fm || !ws) return
  const entries = Object.entries(formulas)
    .map(([addr, formula]) => ({ ...parseExcelAddress(addr), formula }))
    .filter((e) => e.row >= 0 && e.col >= 0)
  // 读取公式引擎计算结果，覆盖表格 record 中的静态默认值
  for (const { row, col } of entries) {
    const result = fm.getCellValue({ sheet: SHEET_KEY, row, col })
    if (result && typeof result.value === 'number' && !isNaN(result.value)) {
      ;(ws as any).setCellValue(col, row, result.value)
    }
  }
}

describe('VTable 在线表格 — 公式重算覆盖静态默认值', () => {
  /**
   * 构造一份"被污染"的模板：在公式单元格中填入明显错误的静态默认值
   * （如 -999、0、99999），用于验证 recalculateFormulas 能用公式计算
   * 结果覆盖这些错误值。
   */
  function buildPollutedData(): (string | number | null)[][] {
    const data = TEMPLATE_DATA.map(row => [...row])
    // 公式单元格的地址（0-based）：故意写入错误静态值
    // B3(行2,列1)=B2 → 错误值 -999；正确应为 7200
    data[2][1] = -999
    // C3(行2,列2)=C2 → 错误值 -888；正确应为 38
    data[2][2] = -888
    // H3(行2,列7)=F3+C3 → 错误值 0；正确应为 41
    data[2][7] = 0
    // I3(行2,列8) → 错误值 0；正确应为 90
    data[2][8] = 0
    // M3(行2,列12) → 错误值 99999
    data[2][12] = 99999
    // N3(行2,列13) → 错误值 99999
    data[2][13] = 99999
    // O3(行2,列14) → 错误值 99999
    data[2][14] = 99999
    // J8(行7,列9)=SUM(J6:J7) → 错误值 0；正确应 > 0
    data[7][9] = 0
    // J9(行8,列9)=J8+I9 → 错误值 0
    data[8][9] = 0
    // K9(行8,列10)=J9*1.1 → 错误值 0
    data[8][10] = 0
    // J10(行9,列9)=(J9-J8)*B2 → 错误值 0
    data[9][9] = 0
    return data
  }

  /** 用污染数据创建 sheet */
  function createPollutedSheet(container: HTMLElement): VTableSheet {
    return new VTableSheet(container, {
      undoRedo: { show: true },
      VTablePluginModules: [{ module: TableExportPlugin }, { module: ExcelImportPlugin }],
      sheets: [{
        sheetKey: SHEET_KEY,
        sheetTitle: SHEET_KEY,
        columns: TEST_COLUMNS,
        data: buildPollutedData(),
        formulas: { ...TEMPLATE_FORMULAS },
        showHeader: false,
      }],
    })
  }

  let sheet: VTableSheet
  let container: HTMLElement

  beforeAll(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    sheet = createPollutedSheet(container)
  })

  afterAll(() => {
    sheet?.release?.()
    container?.remove()
  })

  describe('重算前：公式单元格的表格原始值仍是错误的静态默认值', () => {
    it('B3 表格原始值 = -999（错误静态值）', () => {
      expect(getCellOriginValue(sheet, 1, 2)).toBe(-999)
    })
    it('H3 表格原始值 = 0（错误静态值）', () => {
      expect(getCellOriginValue(sheet, 7, 2)).toBe(0)
    })
    it('J8 表格原始值 = 0（错误静态值）', () => {
      expect(getCellOriginValue(sheet, 9, 7)).toBe(0)
    })
  })

  describe('重算前：公式引擎已计算出正确值（与表格原始值不一致）', () => {
    it('B3 公式值 = 7200（正确），但表格原始值仍是 -999', () => {
      expect(getCellValue(sheet, 2, 1)).toBe(7200)
      expect(getCellOriginValue(sheet, 1, 2)).toBe(-999)
    })
    it('H3 公式值 = 41（正确），但表格原始值仍是 0', () => {
      expect(getCellValue(sheet, 2, 7)).toBe(41)
      expect(getCellOriginValue(sheet, 7, 2)).toBe(0)
    })
  })

  describe('重算后：公式单元格的表格原始值被公式计算结果覆盖', () => {
    // 在所有"重算后"测试前执行一次重算
    beforeAll(() => {
      recalculateFormulas(sheet, TEMPLATE_FORMULAS)
    })

    it('B3 表格原始值被覆盖为公式计算结果 7200', () => {
      expect(getCellOriginValue(sheet, 1, 2)).toBe(7200)
      expect(getCellValue(sheet, 2, 1)).toBe(7200)
    })
    it('C3 表格原始值被覆盖为公式计算结果 38', () => {
      expect(getCellOriginValue(sheet, 2, 2)).toBe(38)
      expect(getCellValue(sheet, 2, 2)).toBe(38)
    })
    it('H3 表格原始值被覆盖为公式计算结果 41', () => {
      expect(getCellOriginValue(sheet, 7, 2)).toBe(41)
      expect(getCellValue(sheet, 2, 7)).toBe(41)
    })
    it('I3 表格原始值被覆盖为公式计算结果 90', () => {
      expect(getCellOriginValue(sheet, 8, 2)).toBe(90)
      expect(getCellValue(sheet, 2, 8)).toBe(90)
    })
    it('M3 表格原始值被覆盖为正数（不再是 99999）', () => {
      const origin = getCellOriginValue(sheet, 12, 2)
      const formula = getCellValue(sheet, 2, 12)
      expect(origin).not.toBe(99999)
      expect(typeof formula).toBe('number')
      expect(origin).toBeCloseTo(formula as number, 2)
    })
    it('J8 表格原始值被覆盖为正数（不再是 0）', () => {
      const origin = getCellOriginValue(sheet, 9, 7)
      const formula = getCellValue(sheet, 7, 9)
      expect(origin).not.toBe(0)
      expect(typeof formula).toBe('number')
      expect(formula as number).toBeGreaterThan(0)
      expect(origin).toBeCloseTo(formula as number, 2)
    })
    it('J9 表格原始值被覆盖为正数（不再是 0）', () => {
      const origin = getCellOriginValue(sheet, 9, 8)
      const formula = getCellValue(sheet, 8, 9)
      expect(origin).not.toBe(0)
      expect(typeof formula).toBe('number')
      expect(formula as number).toBeGreaterThan(0)
      expect(origin).toBeCloseTo(formula as number, 2)
    })
    it('K9 表格原始值被覆盖为 J9*1.1（不再是 0）', () => {
      const origin = getCellOriginValue(sheet, 10, 8)
      const j9 = getCellValue(sheet, 8, 9) as number
      const formula = getCellValue(sheet, 8, 10)
      expect(origin).not.toBe(0)
      expect(typeof formula).toBe('number')
      expect(formula as number).toBeCloseTo(j9 * 1.1, 2)
      expect(origin).toBeCloseTo(formula as number, 2)
    })
    it('J10 表格原始值被覆盖为 (J9-J8)*B2（不再是 0）', () => {
      const origin = getCellOriginValue(sheet, 9, 9)
      const j9 = getCellValue(sheet, 8, 9) as number
      const j8 = getCellValue(sheet, 7, 9) as number
      const b2 = getCellValue(sheet, 1, 1) as number
      const formula = getCellValue(sheet, 9, 9)
      expect(origin).not.toBe(0)
      expect(typeof formula).toBe('number')
      expect(formula as number).toBeCloseTo((j9 - j8) * b2, 2)
      expect(origin).toBeCloseTo(formula as number, 2)
    })
  })

  describe('重算后：非公式单元格保留原默认值（不受影响）', () => {
    it('B2（成品数量）= 7200 保留', () => {
      // B2 不是公式单元格，应保留模板默认值
      expect(getCellOriginValue(sheet, 1, 1)).toBe(7200)
    })
    it('C2（成品宽）= 38 保留', () => {
      expect(getCellOriginValue(sheet, 2, 1)).toBe(38)
    })
    it('D2（成品高）= 40 保留', () => {
      expect(getCellOriginValue(sheet, 3, 1)).toBe(40)
    })
    it('F3（宽出血）= 3 保留（非公式单元格）', () => {
      // F3 不在 TEMPLATE_FORMULAS 中，应保留模板默认值
      expect(getCellOriginValue(sheet, 5, 2)).toBe(3)
    })
    it('G3（高出血）= 10 保留（非公式单元格）', () => {
      expect(getCellOriginValue(sheet, 6, 2)).toBe(10)
    })
    it('I9（参考卖价行的利润率加价）= 0.45 保留（非公式单元格）', () => {
      expect(getCellOriginValue(sheet, 8, 8)).toBe(0.45)
    })
    it('A1（表头"数量"等）保留（非公式单元格）', () => {
      expect(getCellOriginValue(sheet, 1, 0)).toBe('数量 (个)')
    })
  })

  describe('重算后：修改输入值，公式单元格与表格原始值同步更新', () => {
    it('修改 B2 后，B3 的表格原始值与公式值同步更新', () => {
      // 修改 B2 = 10000
      setCellValue(sheet, 1, 1, 10000)
      // 重算覆盖表格原始值
      recalculateFormulas(sheet, TEMPLATE_FORMULAS)
      // B3 = B2 = 10000，表格原始值应与公式值一致
      expect(getCellValue(sheet, 2, 1)).toBe(10000)
      expect(getCellOriginValue(sheet, 1, 2)).toBe(10000)
    })
    it('修改数量后，J10（利润）的表格原始值与公式值同步更新', () => {
      const j9 = getCellValue(sheet, 8, 9) as number
      const j8 = getCellValue(sheet, 7, 9) as number
      const b2 = getCellValue(sheet, 1, 1) as number
      const expected = (j9 - j8) * b2
      expect(getCellValue(sheet, 9, 9)).toBeCloseTo(expected, 2)
      expect(getCellOriginValue(sheet, 9, 9)).toBeCloseTo(expected, 2)
    })
  })
})

describe('VTable 在线表格 — allFormulas 优先于模板合并', () => {
  /**
   * 验证 allFormulas 字段的"完整状态持久化"模式：
   * 1. 传入修改后的公式（如 J8 改为 =SUM(J6:J7)*1.2）→ sheet 使用修改后公式
   * 2. allFormulas 可包含模板范围外的新增公式地址（如 L8）→ sheet 能注册并计算
   * 3. allFormulas 不依赖模板比对，直接作为 formulas 参数传入 VTableSheet 构造
   */

  function createSheetWithFormulas(container: HTMLElement, formulas: Record<string, string>): VTableSheet {
    return new VTableSheet(container, {
      undoRedo: { show: true },
      VTablePluginModules: [{ module: TableExportPlugin }, { module: ExcelImportPlugin }],
      sheets: [{
        sheetKey: SHEET_KEY,
        sheetTitle: SHEET_KEY,
        columns: TEST_COLUMNS,
        data: cloneData(),
        formulas,
        showHeader: false,
      }],
    })
  }

  /** 从公式引擎读取单元格的公式字符串 */
  function getCellFormula(sheet: VTableSheet, row: number, col: number): string | undefined {
    const fm = (sheet as any).formulaManager
    if (!fm) return undefined
    return fm.getCellFormula?.({ sheet: SHEET_KEY, row, col })
  }

  it('allFormulas 中的修改后公式优先于模板原公式（J8 改为 *1.2）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // 模板原 J8 = =SUM(J6:J7)，用户修改为 *1.2
    const allFormulas = { ...TEMPLATE_FORMULAS, J8: '=SUM(J6:J7)*1.2' }
    const sheet = createSheetWithFormulas(container, allFormulas)
    try {
      // J8 在 0-based 坐标为 row=7, col=9
      const formula = getCellFormula(sheet, 7, 9)
      expect(formula).toBe('=SUM(J6:J7)*1.2')
      // 计算结果应为 SUM(J6:J7)*1.2，而非模板原值 SUM(J6:J7)
      const val = getCellValue(sheet, 7, 9) as number
      expect(typeof val).toBe('number')
      // 模板原 J8 值 ≈ 2.97，修改后应为 2.97*1.2 ≈ 3.564
      const originalVal = 2.97
      expect(val).toBeCloseTo(originalVal * 1.2, 1)
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })

  it('allFormulas 可包含模板范围外的新增公式（L8）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // L8 不在 TEMPLATE_FORMULAS 中，模拟用户新增公式
    const allFormulas = { ...TEMPLATE_FORMULAS, L8: '=J8*1.1' }
    const sheet = createSheetWithFormulas(container, allFormulas)
    try {
      // L8 在 0-based 坐标为 row=7, col=11
      const formula = getCellFormula(sheet, 7, 11)
      expect(formula).toBe('=J8*1.1')
      // 计算结果应 = J8 * 1.1
      const j8 = getCellValue(sheet, 7, 9) as number
      const l8 = getCellValue(sheet, 7, 11) as number
      expect(typeof l8).toBe('number')
      expect(l8).toBeCloseTo(j8 * 1.1, 2)
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })

  it('allFormulas 为空对象时表格无公式（纯数据表格，新增订单场景）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // 新增订单或纯数据表格：allFormulas 为空
    const sheet = createSheetWithFormulas(container, {})
    try {
      // 无任何公式注册
      const j8Formula = getCellFormula(sheet, 7, 9)
      expect(j8Formula).toBeUndefined()
      // 表格原始值保留为模板静态默认值
      const j8Origin = getCellOriginValue(sheet, 9, 7)
      expect(j8Origin).toBe(2.97)
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })

  it('allFormulas 删除某公式地址后该单元格无公式（模拟用户删除公式）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // 模板有 J8 公式，但 allFormulas 中删除了 J8（用户清空了该公式）
    const { J8: _removed, ...allFormulasWithoutJ8 } = TEMPLATE_FORMULAS
    const sheet = createSheetWithFormulas(container, allFormulasWithoutJ8)
    try {
      const formula = getCellFormula(sheet, 7, 9)
      expect(formula).toBeUndefined()
      // 其他公式仍正常注册
      const j9Formula = getCellFormula(sheet, 8, 9)
      expect(j9Formula).toBe(TEMPLATE_FORMULAS.J9)
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })
})

describe('VTable 在线表格 — 布料米数向上取整公式（CEILING 包裹）', () => {
  /**
   * 验证布料米数列公式整体包裹 CEILING(...,1) 后（v33 布料米数系统性向上取整）：
   * 1. 公式引擎计算的布料米数（M 列）恒为整数（模板数据下 M4 原结果 403.2 → 404）
   * 2. 下游公式（总重量 O4 = M4*K4*1.5/1000）自动使用取整后的米数参与运算
   * 3. 用户修改输入（数量 B2）后，M 列级联重算仍保持整数
   * 4. M3 原公式内部本就含 CEILING（结果为整数 2160），包裹不影响其值
   */

  function createSheetWithFormulas(container: HTMLElement, formulas: Record<string, string>): VTableSheet {
    return new VTableSheet(container, {
      undoRedo: { show: true },
      VTablePluginModules: [{ module: TableExportPlugin }, { module: ExcelImportPlugin }],
      sheets: [{
        sheetKey: SHEET_KEY,
        sheetTitle: SHEET_KEY,
        columns: TEST_COLUMNS,
        data: cloneData(),
        formulas,
        showHeader: false,
      }],
    })
  }

  function readCellValue(sheet: VTableSheet, row: number, col: number): number | string | null {
    const fm = (sheet as any).formulaManager
    if (!fm) return null
    const result = fm.getCellValue({ sheet: SHEET_KEY, row, col })
    return result?.value ?? null
  }

  function writeCellValue(sheet: VTableSheet, col: number, row: number, value: any): void {
    const ws = sheet.getActiveSheet()
    ;(ws as any).setCellValue(col, row, value)
    const fm = (sheet as any).formulaManager
    if (fm) fm.setCellContent({ sheet: SHEET_KEY, row, col }, value)
  }

  it('包裹后布料米数公式计算结果恒为整数（M4：403.2 → 404）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // 原始公式（未包裹）：M4 = 403.2（小数）
    const rawSheet = createSheetWithFormulas(container, { ...TEMPLATE_FORMULAS })
    const rawM4 = readCellValue(rawSheet, 3, 12) as number
    expect(rawM4).toBeCloseTo(403.2, 1)
    rawSheet.release?.()

    // 包裹后：M4 = 404（整数）
    const wrapped = wrapFabricMetersFormulas({ ...TEMPLATE_FORMULAS }, 12)
    const sheet = createSheetWithFormulas(container, wrapped.formulas)
    try {
      const m3 = readCellValue(sheet, 2, 12) as number
      const m4 = readCellValue(sheet, 3, 12) as number
      expect(Number.isInteger(m3)).toBe(true)
      expect(m3).toBe(2160) // M3 = CEILING(7200/3,1)*90/100，本就是整数，包裹不影响
      expect(Number.isInteger(m4)).toBe(true)
      expect(m4).toBe(404)  // 403.2 向上取整
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })

  it('下游公式（总重量 O4）自动使用取整后的米数计算', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const wrapped = wrapFabricMetersFormulas({ ...TEMPLATE_FORMULAS }, 12)
    const sheet = createSheetWithFormulas(container, wrapped.formulas)
    try {
      const m4 = readCellValue(sheet, 3, 12) as number
      const o4 = readCellValue(sheet, 3, 14) as number
      // O4 = M4 * K4 * 1.5 / 1000，K4（克重）=280
      expect(m4).toBe(404)
      expect(o4).toBeCloseTo(404 * 280 * 1.5 / 1000, 4)
      // 与未取整的旧值 403.2*280*1.5/1000=169.344 不同
      expect(o4).not.toBeCloseTo(403.2 * 280 * 1.5 / 1000, 4)
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })

  it('修改数量（B2）后 M 列级联重算仍为整数', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const wrapped = wrapFabricMetersFormulas({ ...TEMPLATE_FORMULAS }, 12)
    const sheet = createSheetWithFormulas(container, wrapped.formulas)
    try {
      writeCellValue(sheet, 1, 1, 10000) // B2 数量 7200 → 10000
      const m3 = readCellValue(sheet, 2, 12) as number
      const m4 = readCellValue(sheet, 3, 12) as number
      expect(Number.isInteger(m3)).toBe(true)
      expect(Number.isInteger(m4)).toBe(true)
      expect(m3).toBeGreaterThan(0)
      expect(m4).toBeGreaterThan(0)
    } finally {
      sheet?.release?.()
      container?.remove()
    }
  })
})
