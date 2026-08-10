/**
 * 单元测试：VTable-Sheet 复制功能增强
 *
 * 测试 setupCopyFormulaEnhancement 的核心行为：
 *   1. 覆盖 keyboardOptions.getCopyCellValue.value，让纯文本模式返回公式字符串
 *   2. 在 navigator.clipboard 不可用时，通过 copy 事件接管剪贴板写入
 *   3. cleanup 函数能正确移除监听器
 *
 * 测试策略：用一个 mock 的 VTable 实例（含 getCellValue / getCopyValue / stateManager），
 * 不依赖真实 VTable-Sheet 渲染，专注验证 enhancer 的补丁逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupCopyFormulaEnhancement } from '../src/utils/clipboardCopyEnhancer'

// ─── 构造 mock VTable 实例 ──────────────────────────────────────────
// 模拟 VTable-Sheet 内部的 ListTable，仅暴露 enhancer 用到的 API
function createMockTable(options: {
  formulas?: Record<string, string>
  values?: Record<string, any>
  element?: HTMLElement
} = {}) {
  const { formulas = {}, values = {}, element = document.createElement('div') } = options

  // 公式管理器：模拟 getCellFormula
  const formulaManager = {
    getCellFormula: ({ row, col }: { sheet: string; row: number; col: number }) => {
      // 地址转 col+row 反查 formulas（col字母+row数字，如 J6 → col=9, row=5）
      const colLetter = String.fromCharCode(65 + col)
      const addr = `${colLetter}${row + 1}`
      return formulas[addr]
    },
  }

  // 模拟 keyboardOptions（VTable-Sheet 默认只设 html，不设 value）
  const keyboardOptions: any = {
    copySelected: true,
    pasteValueToCell: true,
    showCopyCellBorder: true,
    cutSelected: true,
    getCopyCellValue: {
      // VTable-Sheet 默认的 html：公式单元格返回公式，普通单元格返回值
      html: (col: number, row: number) => {
        const colLetter = String.fromCharCode(65 + col)
        const addr = `${colLetter}${row + 1}`
        if (formulas[addr]) return formulas[addr]
        return values[addr] ?? ''
      },
      // 注意：默认没有 value 字段（这是 bug 根因）
    },
  }

  // 模拟 select.ranges
  let ranges: any[] = []

  // 模拟 ListTable
  const table: any = {
    options: { keyboardOptions },
    getElement: () => element,
    stateManager: {
      select: {
        get ranges() {
          return ranges
        },
        set ranges(v: any[]) {
          ranges = v
        },
        cellPos: { col: 0, row: 0 },
      },
    },
    // getCellValue：返回普通值（不含公式）
    getCellValue: (col: number, row: number) => {
      const colLetter = String.fromCharCode(65 + col)
      const addr = `${colLetter}${row + 1}`
      return values[addr] ?? ''
    },
    // getCopyValue：模拟 VTable 的 getCopyValue，遍历选区拼接 tab+换行
    getCopyValue: (getCellValueFunction: ((col: number, row: number) => any) | undefined) => {
      if (ranges.length === 0) return ''
      const r = ranges[0]
      const minCol = Math.min(r.start.col, r.end.col)
      const maxCol = Math.max(r.start.col, r.end.col)
      const minRow = Math.min(r.start.row, r.end.row)
      const maxRow = Math.max(r.start.row, r.end.row)
      let copyValue = ''
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const v = getCellValueFunction ? getCellValueFunction(col, row) : table.getCellValue(col, row)
          copyValue += v == null ? '' : String(v)
          if (col < maxCol) copyValue += '\t'
        }
        if (row < maxRow) copyValue += '\r\n'
      }
      return copyValue
    },
  }

  const sheet: any = { formulaManager }

  return { sheet, table, element, setRanges: (r: any[]) => (ranges = r) }
}

describe('setupCopyFormulaEnhancement', () => {
  let originalClipboard: any
  let originalClipboardItem: any

  beforeEach(() => {
    originalClipboard = navigator.clipboard
    originalClipboardItem = (window as any).ClipboardItem
  })

  afterEach(() => {
    // 恢复 navigator.clipboard 和 ClipboardItem
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        configurable: true,
        writable: true,
      })
    } catch {
      /* ignore */
    }
    if (originalClipboardItem) {
      ;(window as any).ClipboardItem = originalClipboardItem
    }
  })

  // 辅助：模拟 navigator.clipboard 不可用（HTTP 非安全上下文）
  function disableClipboard() {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    try {
      delete (window as any).ClipboardItem
    } catch {
      ;(window as any).ClipboardItem = undefined
    }
  }

  // 辅助：模拟 navigator.clipboard 可用（HTTPS 或 localhost）
  function enableClipboard() {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(), write: vi.fn(), read: vi.fn(), readText: vi.fn() },
      configurable: true,
    })
    ;(window as any).ClipboardItem = class ClipboardItem {
      constructor(public data: any) {}
    }
  }

  it('修复 A：覆盖 getCopyCellValue.value，使纯文本模式也返回公式字符串', () => {
    const { sheet, table, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { J6: 0 },
    })

    // 修复前：getCopyCellValue 没有 value 字段
    expect(table.options.keyboardOptions.getCopyCellValue.value).toBeUndefined()

    setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    // 修复后：value 字段已设置
    expect(table.options.keyboardOptions.getCopyCellValue.value).toBeDefined()

    // 选中 J6（col=9, row=5），调用 getCopyValue
    setRanges([{ start: { col: 9, row: 5 }, end: { col: 9, row: 5 } }])

    const plainData = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.value)
    expect(plainData).toBe('=B6*F6') // 应该是公式字符串，不是计算值 0
  })

  it('修复 A：普通单元格（无公式）复制后返回值，不受影响', () => {
    const { sheet, table, setRanges } = createMockTable({
      formulas: {}, // 没有公式
      values: { A1: '加工费', B1: 100 },
    })

    setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])
    const dataA1 = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.value)
    expect(dataA1).toBe('加工费')

    setRanges([{ start: { col: 1, row: 0 }, end: { col: 1, row: 0 } }])
    const dataB1 = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.value)
    expect(dataB1).toBe('100')
  })

  it('修复 A：整行复制后，公式单元格保留公式（不再丢失）', () => {
    const { sheet, table, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { A6: '加工费', J6: 0 },
    })

    setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    // 选中整行 row=5（J6 所在行），col 0-15
    setRanges([{ start: { col: 0, row: 5 }, end: { col: 15, row: 5 } }])

    const data = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.value)
    // 公式位置（J 列，第10个 tab 段）应该是公式字符串，不是 0
    expect(data).toContain('=B6*F6')
    expect(data).toContain('加工费')
    // 验证 J 列位置不再是 0
    expect(data).not.toMatch(/加工费\t\t\t\t\t\t\t\t\t0(\t|$)/)
  })

  it('修复 B：navigator.clipboard 不可用时，Ctrl+C 触发 copy 事件并写入剪贴板', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { J6: 0 },
    })

    const cleanup = setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    // 选中 J6
    setRanges([{ start: { col: 9, row: 5 }, end: { col: 9, row: 5 } }])

    // 捕获 enhancer 派发的 copy 事件，读取 onCopy 写入的 clipboardData
    let caughtEvent: ClipboardEvent | null = null
    const captureCopy = (e: Event) => {
      caughtEvent = e as ClipboardEvent
    }
    element.addEventListener('copy', captureCopy, true)

    // 派发 Ctrl+C keydown
    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    // keydown 应被 preventDefault
    expect(ke.defaultPrevented).toBe(true)

    // copy 事件应被触发
    expect(caughtEvent).not.toBeNull()
    // 剪贴板应写入公式字符串（text/plain 含公式，不再是计算值 0）
    const plainData = caughtEvent!.clipboardData?.getData('text/plain') ?? ''
    expect(plainData).toBe('=B6*F6')
    // text/html 也应写入（Excel 粘贴用）
    const htmlData = caughtEvent!.clipboardData?.getData('text/html') ?? ''
    expect(htmlData).toContain('=B6*F6')

    element.removeEventListener('copy', captureCopy, true)
    cleanup()
  })

  it('修复 B：navigator.clipboard 可用时不介入，让 VTable 自行处理', () => {
    enableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { J6: 0 },
    })

    const cleanup = setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    setRanges([{ start: { col: 9, row: 5 }, end: { col: 9, row: 5 } }])

    let copyEventCaught = false
    element.addEventListener('copy', () => {
      copyEventCaught = true
    })

    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    // keydown 不应被阻止（让 VTable 自己处理）
    expect(ke.defaultPrevented).toBe(false)
    // 也不应主动派发 copy 事件
    expect(copyEventCaught).toBe(false)

    cleanup()
  })

  it('修复 B：编辑器中按 Ctrl+C 不拦截，让浏览器默认处理', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { J6: 0 },
    })

    const cleanup = setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    setRanges([{ start: { col: 9, row: 5 }, end: { col: 9, row: 5 } }])

    // 创建一个 input 元素作为事件目标（模拟编辑器）
    const input = document.createElement('input')
    element.appendChild(input)

    let copyEventCaught = false
    element.addEventListener('copy', () => {
      copyEventCaught = true
    })

    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    // 派发到 input 上（target 是 input）
    Object.defineProperty(ke, 'target', { value: input, configurable: true })
    input.dispatchEvent(ke)

    // 不应拦截（让浏览器默认复制 input 中的选中文本）
    expect(ke.defaultPrevented).toBe(false)
    expect(copyEventCaught).toBe(false)

    cleanup()
  })

  it('修复 B：无选区时不拦截 Ctrl+C（让浏览器默认处理）', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { J6: 0 },
    })

    const cleanup = setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    // 不设置选区
    setRanges([])

    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    expect(ke.defaultPrevented).toBe(false)

    cleanup()
  })

  it('cleanup 函数：调用后移除所有监听器，不再拦截 Ctrl+C', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      formulas: { J6: '=B6*F6' },
      values: { J6: 0 },
    })

    const cleanup = setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 9, row: 5 }, end: { col: 9, row: 5 } }])

    let copyEventCaught = false
    element.addEventListener('copy', () => {
      copyEventCaught = true
    })

    // cleanup 后再派发 Ctrl+C
    cleanup()
    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    expect(ke.defaultPrevented).toBe(false)
    expect(copyEventCaught).toBe(false)
  })

  it('兼容性：sheet 或 activeTable 为空时返回空 cleanup，不抛错', () => {
    expect(() => setupCopyFormulaEnhancement(null, null, 'sheet1')).not.toThrow()
    expect(() => setupCopyFormulaEnhancement({} as any, null, 'sheet1')).not.toThrow()

    const cleanup = setupCopyFormulaEnhancement(null, null, 'sheet1')
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('兼容性：keyboardOptions 不存在时不抛错', () => {
    const { sheet, table } = createMockTable()
    delete table.options.keyboardOptions

    expect(() => setupCopyFormulaEnhancement(sheet, table, 'sheet1')).not.toThrow()
  })

  it('兼容性：getElement 返回 undefined 时返回空 cleanup', () => {
    const { sheet, table } = createMockTable()
    // 模拟 activeTable.getElement 返回 undefined
    delete (table as any).getElement
    const cleanup = setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })

  it('修复 A：fm.getCellFormula 抛错时回退到 getCellValue', () => {
    // 构造一个 getCellFormula 会抛错的公式管理器
    const sheetWithError = {
      formulaManager: {
        getCellFormula: () => { throw new Error('Formula engine error') }
      }
    }
    const { table, setRanges } = createMockTable({ values: { A1: 'test_value' } })
    setupCopyFormulaEnhancement(sheetWithError as any, table, 'sheet1')

    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])
    const data = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.value)
    // 公式引擎报错，回退到 getCellValue，返回普通值
    expect(data).toBe('test_value')
  })

  it('修复 B：onCopy 中 clipboardData 为 null 时直接返回', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    // 派发一个没有 clipboardData 的 copy 事件
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
    // 强制设置 clipboardData 为 null
    Object.defineProperty(copyEvent, 'clipboardData', { value: null, configurable: true })

    let defaultPrevented = false
    copyEvent.preventDefault = () => { defaultPrevented = true }
    element.dispatchEvent(copyEvent)

    // 因为 clipboardData 为 null，onCopy 应该直接返回，不会调用 preventDefault
    expect(defaultPrevented).toBe(false)
  })

  it('修复 B：onKeyDown 中 ClipboardEvent 抛错时回退到 execCommand', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    // 确保 document.execCommand 存在
    if (!document.execCommand) {
      (document as any).execCommand = () => true
    }
    // Mock document.execCommand 以验证 fallback 被调用
    const execCommandSpy = vi.spyOn(document, 'execCommand').mockImplementation(() => true)

    // Mock ClipboardEvent 构造函数抛出错误
    const originalClipboardEvent = (window as any).ClipboardEvent
    ;(window as any).ClipboardEvent = class { constructor() { throw new Error('Cannot construct') } }

    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    // 应该调用了 preventDefault 和 execCommand
    expect(ke.defaultPrevented).toBe(true)
    expect(execCommandSpy).toHaveBeenCalledWith('copy')

    // 恢复 ClipboardEvent
    ;(window as any).ClipboardEvent = originalClipboardEvent
    execCommandSpy.mockRestore()
  })

  it('修复 B：onKeyDown 中 ClipboardEvent 和 execCommand 都抛错时不抛出', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    // 确保 document.execCommand 存在
    if (!document.execCommand) {
      (document as any).execCommand = () => true
    }

    // Mock ClipboardEvent 构造函数抛出错误
    const originalClipboardEvent = (window as any).ClipboardEvent
    ;(window as any).ClipboardEvent = class { constructor() { throw new Error('Cannot construct') } }

    // Mock execCommand 也抛出错误
    const execCommandSpy = vi.spyOn(document, 'execCommand').mockImplementation(() => { throw new Error('exec failed') })

    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    
    // 整个派发过程不应抛出
    expect(() => element.dispatchEvent(ke)).not.toThrow()
    expect(ke.defaultPrevented).toBe(true) // 仍然调用了 preventDefault

    // 恢复
    ;(window as any).ClipboardEvent = originalClipboardEvent
    execCommandSpy.mockRestore()
  })

  it('dataToHTML：处理连续空格（2个以上）为 mso-spacerun span', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'hello  world' }, // 两个空格
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    let caughtEvent: ClipboardEvent | null = null
    const captureCopy = (e: Event) => {
      caughtEvent = e as ClipboardEvent
    }
    element.addEventListener('copy', captureCopy, true)

    const ke = new KeyboardEvent('keydown', {
      key: 'c', ctrlKey: true, bubbles: true, cancelable: true,
    })
    element.dispatchEvent(ke)

    expect(caughtEvent).not.toBeNull()
    const htmlData = caughtEvent!.clipboardData?.getData('text/html') ?? ''
    // 验证包含空格替换的 HTML 结构
    expect(htmlData).toContain('<span style="mso-spacerun: yes">&nbsp; </span>')
  })

  it('dataToHTML：处理换行符为 <br>', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'line1\nline2' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    let caughtEvent: ClipboardEvent | null = null
    const captureCopy = (e: Event) => {
      caughtEvent = e as ClipboardEvent
    }
    element.addEventListener('copy', captureCopy, true)

    const ke = new KeyboardEvent('keydown', {
      key: 'c', ctrlKey: true, bubbles: true, cancelable: true,
    })
    element.dispatchEvent(ke)

    expect(caughtEvent).not.toBeNull()
    const htmlData = caughtEvent!.clipboardData?.getData('text/html') ?? ''
    // 验证换行符被替换为 <br>（后面可能跟随 \r\n 由第二个正则处理）
    expect(htmlData).toContain('line1<br>')
    expect(htmlData).toContain('line2')
  })

  it('dataToHTML：处理特殊字符转义', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: '<script>&test&\'quote\'' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    let caughtEvent: ClipboardEvent | null = null
    const captureCopy = (e: Event) => {
      caughtEvent = e as ClipboardEvent
    }
    element.addEventListener('copy', captureCopy, true)

    const ke = new KeyboardEvent('keydown', {
      key: 'c', ctrlKey: true, bubbles: true, cancelable: true,
    })
    element.dispatchEvent(ke)

    expect(caughtEvent).not.toBeNull()
    const htmlData = caughtEvent!.clipboardData?.getData('text/html') ?? ''
    // 验证特殊字符被正确转义
    expect(htmlData).toContain('&amp;') // & 被转义
    expect(htmlData).toContain('&lt;') // < 被转义
    expect(htmlData).toContain('&gt;') // > 被转义
    expect(htmlData).toContain('&#39;') // ' 被转义
  })

  it('onCopy 中 needsClipboardOverride 为 false 时直接返回（HTTPS 环境）', () => {
    enableClipboard() // 模拟 HTTPS 环境
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    // 直接派发一个 copy 事件
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
    let defaultPrevented = false
    copyEvent.preventDefault = () => { defaultPrevented = true }
    element.dispatchEvent(copyEvent)

    // 因为 needsClipboardOverride 为 false，onCopy 应该直接返回，不会调用 preventDefault
    expect(defaultPrevented).toBe(false)
  })

  it('onCopy 中 ranges 为空时直接返回', () => {
    disableClipboard()
    const { sheet, table, element } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    // 选区为空
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
    let defaultPrevented = false
    copyEvent.preventDefault = () => { defaultPrevented = true }
    element.dispatchEvent(copyEvent)

    // ranges 为空，onCopy 应该直接返回
    expect(defaultPrevented).toBe(false)
  })

  it('onCopy 中 plainData 为空时直接返回', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: '' }, // 空单元格
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
    let defaultPrevented = false
    copyEvent.preventDefault = () => { defaultPrevented = true }
    element.dispatchEvent(copyEvent)

    // getCopyValue 返回空字符串，onCopy 应该直接返回
    expect(defaultPrevented).toBe(false)
  })

  it('onKeyDown 中支持大写 C (Ctrl+C)', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    const ke = new KeyboardEvent('keydown', {
      key: 'C', // 大写 C
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    // 应该被拦截
    expect(ke.defaultPrevented).toBe(true)
  })

  it('onKeyDown 中非复制快捷键不拦截', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    const ke = new KeyboardEvent('keydown', {
      key: 'x', // 不是 c 或 C
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    // 不应该被拦截
    expect(ke.defaultPrevented).toBe(false)
  })

  it('修复 A：当 originalHtml 为 undefined 时，html 使用 formulaAwareValue', () => {
    // 创建一个没有 html 函数的 keyboardOptions
    const { sheet, table, setRanges } = createMockTable({
      values: { A1: 'test_html_fallback' },
      formulas: { B1: '=1+1' }
    })
    // 手动删除 html 方法
    delete (table.options.keyboardOptions.getCopyCellValue as any).html
    
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')

    // 验证 getCopyCellValue.html 现在使用 formulaAwareValue
    expect(table.options.keyboardOptions.getCopyCellValue.html).toBeDefined()
    expect(typeof table.options.keyboardOptions.getCopyCellValue.html).toBe('function')
    
    // 测试调用
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])
    const value = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.html)
    expect(value).toBe('test_html_fallback')
  })

  it('修复 A：fm 存在但 getCellFormula 方法不存在时不报错', () => {
    // 创建一个 fm 对象，但没有 getCellFormula 方法
    const sheetWithoutGetCellFormula = {
      formulaManager: {} // 空对象
    }
    const { table, setRanges } = createMockTable({ values: { A1: 'test_no_getCellFormula' } })
    
    setupCopyFormulaEnhancement(sheetWithoutGetCellFormula as any, table, 'sheet1')

    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])
    const value = table.getCopyValue(table.options.keyboardOptions.getCopyCellValue.value)
    // 应该回退到 getCellValue
    expect(value).toBe('test_no_getCellFormula')
  })

  it('onKeyDown 中 metaKey (Command) + C 也能触发复制（Mac 环境）', () => {
    disableClipboard()
    const { sheet, table, element, setRanges } = createMockTable({
      values: { A1: 'test' },
    })
    setupCopyFormulaEnhancement(sheet, table, 'sheet1')
    setRanges([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    const ke = new KeyboardEvent('keydown', {
      key: 'c',
      metaKey: true, // Mac 的 Command 键
      ctrlKey: false,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(ke)

    // 应该被拦截
    expect(ke.defaultPrevented).toBe(true)
  })
})
