/**
 * VTable-Sheet 复制功能增强
 *
 * 解决三个生产环境实际反馈的问题：
 *   1. 「单单元格无法成功复制」—— VTable-Sheet 默认 editCellTrigger 包含 "keydown"，
 *      且 keydown 监听器中单单元格选中 + 字符键（含 'c'）会触发 startEditCell 进入编辑模式，
 *      该逻辑不检查 ctrlKey/metaKey，导致 Ctrl+C 被当作编辑输入而非复制。
 *      整行选中时 start.col !== end.col 不满足条件，故整行复制不受影响。
 *   2. 「HTTP 环境下剪贴板写入失败」—— 在 HTTP（非安全上下文）下 navigator.clipboard 不可用，
 *      VTable 的 handleCopy 是 async 函数（含 yield setTimeout），失去用户手势上下文后
 *      fallback 的 textarea + execCommand('copy') 常失败。
 *   3. 「整行复制后粘贴内容不含公式」—— VTable-Sheet 默认只配置了
 *      keyboardOptions.getCopyCellValue.html（HTML 模式带公式），未配置 .value，
 *      导致纯文本模式（text/plain）复制的是公式计算后的值（如 "0.00"），不是公式字符串（如 "=B6*F6"）。
 *
 * 修复策略：
 *   A. 覆盖 keyboardOptions.getCopyCellValue.value，让纯文本模式也返回公式字符串。
 *   B. keydown capture 阶段拦截 Ctrl+C，用 stopImmediatePropagation 阻止 VTable 的 keydown
 *      监听器执行（防止单单元格进入编辑模式），但不 preventDefault，让浏览器原生 copy 事件触发。
 *   C. copy 事件 capture 阶段同步写入 e.clipboardData（原生事件的 clipboardData 可用），
 *      用 stopImmediatePropagation 阻止 VTable 的 async handleCopy（避免 fallback 失败）。
 *      支持单单元格：当 ranges 为空但 cellPos 有效时，临时注入单单元格 range 供 getCopyValue 使用。
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

  // ─── 修复 B+C：keydown 拦截 + copy 事件同步写入 ───
  const element = activeTable.getElement?.() as HTMLElement | undefined
  if (!element) return () => {}

  // 判断是否需要介入 copy 事件：仅在 navigator.clipboard 不可用时（非安全上下文）才启用
  const needsClipboardOverride = (): boolean =>
    !navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined'

  // 判断当前是否有有效选区（ranges 或 cellPos）
  const hasSelection = (): boolean => {
    const select = activeTable.stateManager?.select
    if (!select) return false
    const ranges = select.ranges
    if (ranges && ranges.length > 0) return true
    // 单单元格选中时 ranges 可能为空，但 cellPos 有效
    const cellPos = select.cellPos
    if (cellPos && cellPos.col >= 0 && cellPos.row >= 0) return true
    return false
  }

  // keydown 拦截：Ctrl+C 时阻止 VTable 的 keydown 监听器执行
  // 目的：防止 VTable 在单单元格选中时把 'c' 当作编辑输入（startEditCell），不检查 ctrlKey 的 bug
  // 不 preventDefault，让浏览器原生 copy 事件触发（原生事件的 clipboardData 可用）
  const onKeyDown = (e: KeyboardEvent) => {
    // 仅处理 Ctrl+C / Cmd+C
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'c' && e.key !== 'C')) return
    // 在编辑器内时不拦截，让浏览器默认处理（用户想复制编辑器内选中的文本）
    const target = e.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return
    }
    // 无选区时不拦截（让浏览器默认处理）
    if (!hasSelection()) return

    // stopImmediatePropagation 阻止同一 element 上 VTable 的 keydown 监听器执行
    // （capture 阶段先于 target/bubble 阶段，stopImmediatePropagation 可阻止后续监听器）
    // 不 preventDefault：让浏览器原生 copy 事件触发，其 clipboardData 可用于 setData
    e.stopImmediatePropagation()
  }

  // copy 事件处理：同步写入 e.clipboardData（原生 copy 事件的 clipboardData 可用）
  const onCopy = (e: ClipboardEvent) => {
    if (!needsClipboardOverride()) return // HTTPS 环境让 VTable 自己处理
    if (!e.clipboardData) return // 无剪贴板对象，让 VTable 走它的 fallback

    const select = activeTable.stateManager?.select
    if (!select) return

    const ranges = select.ranges
    const cellPos = select.cellPos

    // 修复 C：单单元格选中时 ranges 可能为空（只有 cellPos），临时注入单单元格 range
    // getCopyValue 依赖 ranges 遍历，没有 ranges 会返回空字符串
    let injectedRange = false
    if ((!ranges || ranges.length === 0) && cellPos && cellPos.col >= 0 && cellPos.row >= 0) {
      select.ranges = [{
        start: { col: cellPos.col, row: cellPos.row },
        end: { col: cellPos.col, row: cellPos.row },
      }]
      injectedRange = true
    }

    if (!select.ranges || select.ranges.length === 0) {
      return
    }

    // 修复 D：设置 copySourceRange，让粘贴时公式引用能自动迁移（auto-migration）
    // VTable 的公式引用调整在粘贴阶段完成（processFormulaBeforePaste），
    // 依赖 eventManager.copySourceRange 记录的源区域起点来计算偏移量。
    // 我们 stopImmediatePropagation 阻止了 VTable 的 handleCopy，导致 copySourceRange 未被设置，
    // 粘贴时 processPastedText 检查 copySourceRange 为 null → 跳过公式调整 → =B6*F6 原样粘贴不迁移。
    // 这里补设 copySourceRange，与 VTable handleCopy（event.js:298-306）逻辑完全一致。
    const eventManager = activeTable.eventManager
    if (eventManager) {
      const currentRanges = select.ranges
      if (currentRanges.length === 1) {
        eventManager.copySourceRange = {
          startCol: Math.min(currentRanges[0].start.col, currentRanges[0].end.col),
          startRow: Math.min(currentRanges[0].start.row, currentRanges[0].end.row),
        }
      } else {
        // 多选区时 VTable 也不设 copySourceRange（handleCopy 中多选区会 return）
        eventManager.copySourceRange = null
      }
    }

    const plainData = activeTable.getCopyValue(formulaAwareValue)

    // 恢复 ranges（避免影响 VTable 内部状态）
    if (injectedRange) {
      select.ranges = ranges || []
    }

    if (!plainData) return

    // 同步写入剪贴板（原生 copy 事件的 clipboardData 可写）
    e.preventDefault()
    // stopImmediatePropagation 阻止 VTable 的 async handleCopy 执行
    // （VTable handleCopy 含 yield setTimeout，失去用户手势后 fallback execCommand 失败）
    e.stopImmediatePropagation()
    e.clipboardData.setData('text/plain', plainData)
    // 同时写 text/html，让 Excel 等支持 HTML 的目标也能正确粘贴公式
    const htmlData = activeTable.getCopyValue(originalHtml || formulaAwareValue)
    if (htmlData) {
      e.clipboardData.setData('text/html', dataToHTML(htmlData))
    }
  }

  // 用 capture 阶段监听，先于 VTable 内部处理
  element.addEventListener('keydown', onKeyDown, true)
  element.addEventListener('copy', onCopy, true)

  return () => {
    element.removeEventListener('keydown', onKeyDown, true)
    element.removeEventListener('copy', onCopy, true)
  }
}
