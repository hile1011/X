/**
 * 款式切换 + 公式持久化 端到端集成测试
 *
 * 模拟前端 BagQuote.tsx 的真实逻辑：
 * 1. handleSave：遍历表格所有单元格，通过 fm.getCellFormula 收集所有公式到 allFormulas
 * 2. loadQuote：用数据库保存的 allFormulas 创建新 VTableSheet（不依赖模板比对）
 * 3. 款式切换：清空 allFormulasRef = {}，用新款式模板创建表格
 *
 * 验证目标：
 * - 修改公式后保存→重新加载，公式不恢复原状
 * - 切换款式后保存→重新加载，使用新款式模板公式
 * - 用户新增公式到无公式单元格→保存→重新加载，新增公式持久化
 * - 用户删除公式→保存→重新加载，公式被正确删除
 * - 切换回原款式→使用数据库保存的 allFormulas（含修改）
 *
 * 环境要求：jsdom + canvas mock（tests/setup.ts）
 */
import { describe, it, expect } from 'vitest'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'

const SHEET_KEY = 'sheet1'
const COL_WIDTHS = [100, 90, 80, 80, 80, 90, 90, 90, 90, 90, 80, 120, 110, 130, 100, 120]
const TEST_COLUMNS = COL_WIDTHS.map((width, field) => ({ field, width }))

// ============================ 款式1：无底无侧普通袋 ============================
const STYLE1_DATA: (string | number | null)[][] = [
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
const STYLE1_FORMULAS: Record<string, string> = {
  B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
  L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
  O3: '=M3*K3*1.5/1000', P3: '=M3*4/(I4/100)',
  B4: '=B2', I4: '=D4', L4: '=MOD(J4,MIN(H4,I4))', M4: '=I4/100*2*B4/INT(J4/H4)',
  N4: '=J4/(MIN(H4,I4))', O4: '=M4*K4*1.5/1000',
  A6: '=A3', C6: '=H3*I3*1.1/10000', E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
  H6: '=O3*0.8', J6: '=(B6+C6+F6+E6+H6/B3)*I6+G6',
  A7: '=A4', E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H7: '=O4*0.8',
  J7: '=(B7+C7+E7+F7+H7/B4)*I7+G7',
  J8: '=SUM(J6:J7)', J9: '=J8+I9', K9: '=J9*1.1', J10: '=(J9-J8)*B2',
}

// ============================ 款式2：有底无侧普通袋 ============================
const STYLE2_DATA: (string | number | null)[][] = [
  [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
  ['成品', 7200, 38, 40, 8, null, null, null, null, null, null, null, null, null, null, null],
  ['正反面', 7200, 38, 40, 8, 3, 10, 41, 98, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
  ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
  ['底部', 7200, 38, 8, 0, 3, 3, 41, 14, 154, 280, 154, null, 11, null, null],
  [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
  ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
  ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
  ['底部', null, 0, 4.4, null, null, null, null, 1.03, null, null, null, null, null, null, null],
  ['汇总', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ['参考卖价', null, null, null, null, null, null, null, 0.45, null, null, null, null, null, null, null],
  ['利润', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
]
const STYLE2_FORMULAS: Record<string, string> = {
  B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
  L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
  O3: '=M3*K3*1.5/1000', P3: '=M3*4/(I4/100)',
  B4: '=B2', I4: '=D4', L4: '=MOD(J4,MIN(H4,I4))', M4: '=I4/100*2*B4/INT(J4/H4)',
  N4: '=J4/(MIN(H4,I4))', O4: '=M4*K4*1.5/1000',
  B5: '=B2', C5: '=C2', D5: '=E2', H5: '=F5+C5', I5: '=D5+G5*2',
  L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
  O5: '=M5*K5*1.5/1000',
  A7: '=A3', C7: '=H3*I3*1.1/10000', E7: '=D7*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
  H7: '=O3*0.8', J7: '=(B7+C7+F7+E7+H7/B3)*I7+G7',
  A8: '=A4', E8: '=D8*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H8: '=O4*0.8',
  J8: '=(B8+C8+E8+F8+H8/B4)*I8+G8',
  A9: '=A5', E9: '=D9*M5/B5+CEILING(M5/100,1)*15/B5+0.04', J9: '=(B9+C9+E9+F9)*I9+G9',
  J10: '=SUM(J7:J9)', J11: '=J10+I11', K11: '=J11*1.1', J12: '=(J11-J10)*B2',
}

// ============================ 模拟前端工具函数 ============================

/** 0-based { row, col } → Excel 地址（如 "J8"）。与 BagQuote.tsx 的 toExcelAddress 一致 */
function toExcelAddress(row: number, col: number): string {
  let c = col + 1
  let letters = ''
  while (c > 0) {
    const rem = (c - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    c = Math.floor((c - 1) / 26)
  }
  return `${letters}${row + 1}`
}

/** 深拷贝二维数组 */
function cloneData(data: (string | number | null)[][]): (string | number | null)[][] {
  return data.map(row => [...row])
}

/**
 * 创建 VTableSheet 实例（精确模拟 BagQuote.tsx 的表格初始化逻辑，见 useEffect L932-935）：
 *   const loadedFormulas = allFormulasRef.current
 *   const activeFormulas = Object.keys(loadedFormulas).length > 0
 *     ? { ...loadedFormulas }       // 编辑已有订单：用数据库 allFormulas
 *     : { ...template.formulas }    // 新增订单/切换款式：用模板公式
 *
 * 参数：
 * - templateFormulas：当前款式模板的 formulas（对应 BagQuote.tsx 中 getTemplateByStyle(style).formulas）
 * - allFormulas：数据库存储的 allFormulas（对应 allFormulasRef.current）
 *
 * 两者通过 templateFormulas 参数传入，确保测试与生产代码逻辑完全一致。
 */
function createSheet(
  container: HTMLElement,
  data: (string | number | null)[][],
  templateFormulas: Record<string, string>,
  allFormulas: Record<string, string> = {},
): VTableSheet {
  // activeFormulas 构建策略（与 BagQuote.tsx 完全一致）
  const activeFormulas: Record<string, string> = Object.keys(allFormulas).length > 0
    ? { ...allFormulas }
    : { ...templateFormulas }
  return new VTableSheet(container, {
    undoRedo: { show: true },
    VTablePluginModules: [{ module: TableExportPlugin }, { module: ExcelImportPlugin }],
    sheets: [{
      sheetKey: SHEET_KEY,
      sheetTitle: SHEET_KEY,
      columns: TEST_COLUMNS,
      data: cloneData(data),
      formulas: activeFormulas,
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

/**
 * 模拟 BagQuote.tsx 的 handleSave 逻辑：
 * 遍历表格所有单元格，通过 fm.getCellFormula 收集所有公式到 allFormulas
 */
function collectAllFormulas(sheet: VTableSheet): Record<string, string> {
  const allFormulas: Record<string, string> = {}
  const ws = sheet.getActiveSheet()
  const activeTable = ws?.tableInstance as any
  const fm = (sheet as any).formulaManager
  const rowCount = activeTable?.rowCount ?? 0
  const colCount = activeTable?.colCount ?? 16
  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const formula = fm?.getCellFormula?.({ sheet: SHEET_KEY, row: r, col: c })
      if (formula) {
        allFormulas[toExcelAddress(r, c)] = formula
      }
    }
  }
  return allFormulas
}

/** 修改公式引擎中单元格的公式（模拟用户编辑公式） */
function setCellFormula(sheet: VTableSheet, row: number, col: number, formula: string): void {
  const fm = (sheet as any).formulaManager
  if (fm) {
    fm.setCellContent({ sheet: SHEET_KEY, row, col }, formula)
  }
}

/** 清除公式引擎中单元格的公式（模拟用户删除公式） */
function clearCellFormula(sheet: VTableSheet, row: number, col: number): void {
  const fm = (sheet as any).formulaManager
  if (fm) {
    fm.setCellContent({ sheet: SHEET_KEY, row, col }, null)
  }
}

// ============================ 测试用例 ============================

describe('款式切换 + 公式持久化 端到端验证', () => {
  describe('场景1：修改公式后保存→重新加载，公式不恢复原状', () => {
    it('款式1：修改 J8 公式 → 保存 → 重新加载 → J8 应为修改后的公式', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      // 1. 创建款式1表格（模拟新增订单，allFormulas 为空，用模板公式）
      const sheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        // 2. 修改 J8 公式（0-based row=7, col=9）
        //    模板原值: =SUM(J6:J7) → 修改为: =SUM(J6:J7)*1.2
        setCellFormula(sheet, 7, 9, '=SUM(J6:J7)*1.2')

        // 3. 模拟 handleSave：收集所有公式
        const savedAllFormulas = collectAllFormulas(sheet)
        expect(savedAllFormulas.J8).toBe('=SUM(J6:J7)*1.2')
        expect(savedAllFormulas.J9).toBe('=J8+I9') // 其他公式正常

        // 4. 模拟 loadQuote：用 savedAllFormulas 重新创建表格
        const reloadedSheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS, savedAllFormulas)
        try {
          // 5. 验证 J8 是修改后的公式（非模板原值）
          const j8Formula = getCellFormula(reloadedSheet, 7, 9)
          expect(j8Formula).toBe('=SUM(J6:J7)*1.2')
          // 关键断言：不是模板原值 =SUM(J6:J7)
          expect(j8Formula).not.toBe('=SUM(J6:J7)')
        } finally {
          reloadedSheet?.release?.()
        }
      } finally {
        sheet?.release?.()
        container?.remove()
      }
    })
  })

  describe('场景2：切换款式后保存→重新加载，使用新款式模板公式', () => {
    it('从款式1切换到款式2 → 保存 → 重新加载 → 应使用款式2模板公式', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      // 1. 创建款式1表格，修改 J8
      const sheet1 = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        setCellFormula(sheet1, 7, 9, '=SUM(J6:J7)*1.2')
        const style1AllFormulas = collectAllFormulas(sheet1)
        expect(style1AllFormulas.J8).toBe('=SUM(J6:J7)*1.2')

        // 2. 模拟款式切换：清空 allFormulasRef = {}，用款式2模板创建新表格
        //    （前端 updateOrderField 逻辑：allFormulasRef.current = {}，使用新款式模板）
        const sheet2 = createSheet(container, STYLE2_DATA, STYLE2_FORMULAS)
        try {
          // 款式2 的 J8 是不同的公式：=(B8+C8+E8+F8+H8/B4)*I8+G8（不是 SUM）
          const j8Style2 = getCellFormula(sheet2, 7, 9)
          expect(j8Style2).toBe('=(B8+C8+E8+F8+H8/B4)*I8+G8')

          // 3. 模拟 handleSave：收集款式2的公式
          const style2AllFormulas = collectAllFormulas(sheet2)
          expect(style2AllFormulas.J8).toBe('=(B8+C8+E8+F8+H8/B4)*I8+G8')
          // 款式2 独有公式 J12 应存在
          expect(style2AllFormulas.J12).toBe('=(J11-J10)*B2')
          // 款式1 独有公式 J10（利润行）不应出现在款式2中
          // 注意：款式1的 J10 = '=(J9-J8)*B2'，款式2的 J10 = '=SUM(J7:J9)'
          expect(style2AllFormulas.J10).toBe('=SUM(J7:J9)')

          // 4. 模拟 loadQuote：用款式2的 allFormulas 重新创建表格
          const reloadedSheet2 = createSheet(container, STYLE2_DATA, STYLE2_FORMULAS, style2AllFormulas)
          try {
            // 5. 验证使用款式2模板公式（非款式1的修改值）
            const j8Reloaded = getCellFormula(reloadedSheet2, 7, 9)
            expect(j8Reloaded).toBe('=(B8+C8+E8+F8+H8/B4)*I8+G8')
            expect(j8Reloaded).not.toBe('=SUM(J6:J7)*1.2') // 不是款式1的修改值
          } finally {
            reloadedSheet2?.release?.()
          }
        } finally {
          sheet2?.release?.()
        }
      } finally {
        sheet1?.release?.()
        container?.remove()
      }
    })
  })

  describe('场景3：用户新增公式到无公式单元格→保存→重新加载', () => {
    it('在 L8（原本无公式）输入公式 → 保存 → 重新加载 → 公式应被持久化', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      // 1. 创建款式1表格
      const sheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        // L8 在 0-based row=7, col=11，模板中无公式
        expect(getCellFormula(sheet, 7, 11)).toBeUndefined()

        // 2. 模拟用户在 L8 输入新公式
        setCellFormula(sheet, 7, 11, '=J8*1.1')

        // 3. handleSave：收集所有公式
        const savedAllFormulas = collectAllFormulas(sheet)
        expect(savedAllFormulas.L8).toBe('=J8*1.1')

        // 4. loadQuote：用 allFormulas 重新创建
        const reloadedSheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS, savedAllFormulas)
        try {
          // 5. 验证 L8 公式被持久化
          const l8Formula = getCellFormula(reloadedSheet, 7, 11)
          expect(l8Formula).toBe('=J8*1.1')
        } finally {
          reloadedSheet?.release?.()
        }
      } finally {
        sheet?.release?.()
        container?.remove()
      }
    })
  })

  describe('场景4：用户删除公式→保存→重新加载', () => {
    it('清空 J8 公式 → 保存 → 重新加载 → J8 应无公式', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      // 1. 创建款式1表格
      const sheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        // 确认 J8 初始有公式
        expect(getCellFormula(sheet, 7, 9)).toBe('=SUM(J6:J7)')

        // 2. 模拟用户删除 J8 公式
        clearCellFormula(sheet, 7, 9)

        // 3. handleSave：收集所有公式
        const savedAllFormulas = collectAllFormulas(sheet)
        expect(savedAllFormulas.J8).toBeUndefined() // J8 公式已被删除

        // 4. loadQuote：用 allFormulas 重新创建
        const reloadedSheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS, savedAllFormulas)
        try {
          // 5. 验证 J8 无公式
          const j8Formula = getCellFormula(reloadedSheet, 7, 9)
          expect(j8Formula).toBeUndefined()
          // 其他公式仍正常
          expect(getCellFormula(reloadedSheet, 8, 9)).toBe('=J8+I9') // J9
        } finally {
          reloadedSheet?.release?.()
        }
      } finally {
        sheet?.release?.()
        container?.remove()
      }
    })
  })

  describe('场景5：完整款式切换循环（款式1→款式2→款式1）', () => {
    it('款式1修改保存 → 切换款式2保存 → 重新打开款式1 → 公式应与款式1保存时一致', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      // ===== 阶段1：款式1，修改 J8 并保存 =====
      const sheet1 = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        setCellFormula(sheet1, 7, 9, '=SUM(J6:J7)*1.5') // 修改 J8
        const style1Saved = collectAllFormulas(sheet1)
        expect(style1Saved.J8).toBe('=SUM(J6:J7)*1.5')

        // ===== 阶段2：切换到款式2，保存 =====
        // 模拟 updateOrderField：allFormulasRef = {}，用款式2模板
        const sheet2 = createSheet(container, STYLE2_DATA, STYLE2_FORMULAS)
        try {
          const style2Saved = collectAllFormulas(sheet2)
          expect(style2Saved.J8).toBe('=(B8+C8+E8+F8+H8/B4)*I8+G8')

          // ===== 阶段3：模拟重新打开款式1订单（数据库中存储的是 style1Saved） =====
          // loadQuote：用 style1Saved 的 allFormulas 创建表格
          const reloadedSheet1 = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS, style1Saved)
          try {
            // 验证 J8 是款式1修改后的公式（非款式2的，非模板原值）
            const j8Formula = getCellFormula(reloadedSheet1, 7, 9)
            expect(j8Formula).toBe('=SUM(J6:J7)*1.5')
            expect(j8Formula).not.toBe('=SUM(J6:J7)') // 不是模板原值
            expect(j8Formula).not.toBe('=(B8+C8+E8+F8+H8/B4)*I8+G8') // 不是款式2的
          } finally {
            reloadedSheet1?.release?.()
          }
        } finally {
          sheet2?.release?.()
        }
      } finally {
        sheet1?.release?.()
        container?.remove()
      }
    })
  })

  describe('场景6：allFormulas 完整性验证（所有公式都被收集）', () => {
    it('款式1：handleSave 收集的公式数量应与模板一致（30个）', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const sheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        const savedAllFormulas = collectAllFormulas(sheet)
        // 款式1 模板有 30 个公式
        expect(Object.keys(savedAllFormulas).length).toBe(Object.keys(STYLE1_FORMULAS).length)
        // 验证每个模板公式都被收集
        for (const addr of Object.keys(STYLE1_FORMULAS)) {
          expect(savedAllFormulas[addr]).toBe(STYLE1_FORMULAS[addr])
        }
      } finally {
        sheet?.release?.()
        container?.remove()
      }
    })

    it('款式2：handleSave 收集的公式数量应与模板一致（38个）', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const sheet = createSheet(container, STYLE2_DATA, STYLE2_FORMULAS)
      try {
        const savedAllFormulas = collectAllFormulas(sheet)
        // 款式2 模板有 38 个公式
        expect(Object.keys(savedAllFormulas).length).toBe(Object.keys(STYLE2_FORMULAS).length)
        for (const addr of Object.keys(STYLE2_FORMULAS)) {
          expect(savedAllFormulas[addr]).toBe(STYLE2_FORMULAS[addr])
        }
      } finally {
        sheet?.release?.()
        container?.remove()
      }
    })
  })

  describe('场景7：保存后 allFormulas 两次加载结果一致（幂等性）', () => {
    it('同一份 allFormulas 加载两次，公式应完全一致', () => {
      const container = document.createElement('div')
      document.body.appendChild(container)

      // 1. 创建并修改公式
      const sheet = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS)
      try {
        setCellFormula(sheet, 7, 9, '=SUM(J6:J7)*1.3')
        setCellFormula(sheet, 7, 11, '=J8*1.1') // 新增 L8 公式
        const savedAllFormulas = collectAllFormulas(sheet)

        // 2. 第一次加载
        const reload1 = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS, savedAllFormulas)
        const reload1Formulas = collectAllFormulas(reload1)
        reload1?.release?.()

        // 3. 第二次加载
        const reload2 = createSheet(container, STYLE1_DATA, STYLE1_FORMULAS, savedAllFormulas)
        const reload2Formulas = collectAllFormulas(reload2)
        reload2?.release?.()

        // 4. 两次加载的公式应完全一致
        expect(reload1Formulas).toEqual(reload2Formulas)
        expect(reload1Formulas.J8).toBe('=SUM(J6:J7)*1.3')
        expect(reload1Formulas.L8).toBe('=J8*1.1')
      } finally {
        sheet?.release?.()
        container?.remove()
      }
    })
  })
})
