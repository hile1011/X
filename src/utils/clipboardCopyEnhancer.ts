/**
 * VTable-Sheet 复制功能增强
 *
 * 解决两个生产环境实际反馈的问题：
 *   1. 「单单元格无法成功复制」—— 在 HTTP（非安全上下文）下 navigator.clipboard 不可用，
 *      VTable 内部 fallback 到 document.execCommand('copy') + 隐藏 textarea 的路径，
 *      在 canvas 焦点情况下常失败，导致剪贴板根本没写入内容。
 *   2. 「整行复制后粘贴内容不含公式」—— VTable-Sheet 默认只配置了
 *      keyboardOptions.getCopyCellValue.html（HTML 模式带公式），未配置 .value，
 *      导致纯文本模式（text/plain）复制的是公式计算后的值（如 "0.00"），不是公式字符串（如 "=B6*F6"）。
 *      而 fallback 路径只写 text/plain，HTML 模式的公式根本没用上。
 *
 * 修复策略：
 *   A. 覆盖 keyboardOptions.getCopyCellValue.value，让纯文本模式也返回公式字符串。
 *   B. 在 navigator.clipboard 不可用（HTTP 非安全上下文）时，主动拦截 keydown Ctrl+C
 *      并通过 copy 事件直接写入 e.clipboardData，同时写 text/plain 和 text/html，
 *      确保公式无论粘贴到表格内、Excel 还是纯文本编辑器都能正确呈现。
 *
 * 使用：
 *   const cleanup = setupCopyFormulaEnhancement(sheet, activeTable, sheetKey)
 *   // 组件卸载时调用 cleanup()
 */
import { TableConstants } from '../constants/TableConstants'

/**
 * 将 tab+换行 分隔的纯文本数据转成 HTML 表格字符串（用于剪贴板 text/html）。
 * 等价于 VTable 内部的 setDataToHTML（未公开导出），实现保持一致以确保 Excel 能正确解析。
 */
function dataToHTML(data: string): string {
  const META_HEAD =
    '<meta name="author" content="Visactor"/>' +
    '<style type="text/css">td{white-space:normal}br{mso-data-placement:same-cell}</style>'
  const rows = data.split('\r\n')
  const result: string[] = ['<table>']
  rows.forEach((rowCells, rowIndex) => {
    const cells = rowCells.split('\t')
    const rowValues: string[] = []
    if (rowIndex === 0) result.push('<tbody>')
    cells.forEach((cell) => {
      const parsedCellData = cell
        ? cell
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
            .replace(/(<br(\s*|\/)>(\r\n|\n)?|\r\n|\n)/g, '<br>\r\n')
            .replace(/\x20{2,}/gi, (s) => `<span style="mso-spacerun: yes">${'&nbsp;'.repeat(s.length - 1)} </span>`)
            .replace(/\t/gi, '&#9;')
        : ' '
      rowValues.push(`<td>${parsedCellData}</td>`)
    })
    result.push('<tr>', ...rowValues, '</tr>')
    if (rowIndex === rows.length - 1) result.push('</tbody>')
  })
  result.push('</table>')
  return [META_HEAD, result.join('')].join('')
}

/**
 * 安装复制功能增强。
 *
 * @param sheet VTableSheet 实例
 * @param activeTable 当前活动 WorkSheet 的 tableInstance（ListTable）
 * @param sheetKey 当前活动 sheet 的 key（用于公式引擎查询）
 * @returns cleanup 函数，组件卸载时调用以移除所有补丁和监听器
 */
export function setupCopyFormulaEnhancement(
  sheet: any,
  activeTable: any,
  sheetKey: string = TableConstants.SHEET_KEY,
): () => void {
  if (!sheet || !activeTable) return () => {}

  const fm = (sheet as any).formulaManager
  const ko = activeTable.options?.keyboardOptions
  if (!ko) return () => {}

  // ─── 修复 A：覆盖 getCopyCellValue.value，让纯文本模式也返回公式字符串 ───
  // VTable-Sheet 默认只设了 html，未设 value，导致 getCopyValue(undefined) 走默认 getCellValue，
  // 公式单元格复制后是计算值（如 0），不是公式（如 =B6*F6）。
  // 我们让 value 也调用 getCellValueConsiderFormula 的等价逻辑：公式单元格返回公式，普通单元格返回值。
  const originalHtml = ko.getCopyCellValue?.html
  const formulaAwareValue = (col: number, row: number): any => {
    if (fm?.getCellFormula) {
      try {
        const formula = fm.getCellFormula({ sheet: sheetKey, row, col })
        if (formula) return formula
      } catch {
        /* 公式引擎未就绪，回退到默认值 */
      }
    }
    return activeTable.getCellValue(col, row)
  }
  // getCopyCellValue 是个普通对象，直接替换；html 保留 VTable-Sheet 默认的 getCellValueConsiderFormula
  ko.getCopyCellValue = {
    value: formulaAwareValue,
    html: originalHtml || formulaAwareValue,
  }

  // ─── 修复 B：HTTP 环境下接管 copy 事件，绕过 navigator.clipboard 限制 ───
  const element = activeTable.getElement?.() as HTMLElement | undefined
  if (!element) return () => {}

  // 判断是否需要介入：仅在 navigator.clipboard 不可用时（非安全上下文）才启用
  const needsClipboardOverride = (): boolean =>
    !navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined'

  // copy 事件处理：直接用 e.clipboardData 写入 text/plain + text/html
  const onCopy = (e: ClipboardEvent) => {
    if (!needsClipboardOverride()) return // 安全上下文让 VTable 自己处理
    if (!e.clipboardData) return // 没剪贴板对象，让 VTable 走它的 fallback
    const ranges = activeTable.stateManager?.select?.ranges
    if (!ranges || ranges.length === 0) return

    const plainData = activeTable.getCopyValue(formulaAwareValue)
    if (!plainData) return

    e.preventDefault()
    e.clipboardData.setData('text/plain', plainData)
    // 同时写 text/html，让 Excel 等支持 HTML 的目标也能正确粘贴公式
    const htmlData = activeTable.getCopyValue(originalHtml || formulaAwareValue)
    if (htmlData) {
      e.clipboardData.setData('text/html', dataToHTML(htmlData))
    }
  }

  // keydown 拦截：在 navigator.clipboard 不可用时，阻止 VTable 的默认 handleCopy 流程，
  // 改为主动触发 copy 事件（由 onCopy 处理写入），避免 VTable fallback 走 textarea + execCommand 失败
  const onKeyDown = (e: KeyboardEvent) => {
    if (!needsClipboardOverride()) return
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'c' && e.key !== 'C') return
    // 在编辑器内时不拦截，让浏览器默认处理（用户可能想复制编辑器内选中的文本）
    const target = e.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return
    }
    const ranges = activeTable.stateManager?.select?.ranges
    if (!ranges || ranges.length === 0) return

    // 阻止 VTable 的 keydown 处理（防止它走 fallback textarea 路径导致复制失败）
    e.preventDefault()
    e.stopPropagation()
    // 主动派发 copy 事件，由 onCopy 写入剪贴板
    // 注意：ClipboardEvent 构造函数在所有现代浏览器中都支持
    try {
      const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
      element.dispatchEvent(copyEvent)
    } catch {
      // 极少数旧浏览器不支持 ClipboardEvent 构造，回退到 execCommand
      try {
        document.execCommand('copy')
      } catch {
        /* 忽略 */
      }
    }
  }

  // 用 capture 阶段监听，先于 VTable 内部处理
  element.addEventListener('copy', onCopy, true)
  element.addEventListener('keydown', onKeyDown, true)

  return () => {
    element.removeEventListener('copy', onCopy, true)
    element.removeEventListener('keydown', onKeyDown, true)
  }
}
