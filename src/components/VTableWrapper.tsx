import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react'
import { VTableSheet, type ISheetDefine, type IVTableSheetOptions } from '@visactor/vtable-sheet'
import * as XLSX from 'xlsx'

const hideVTableContextMenuStyle = document.createElement('style')
hideVTableContextMenuStyle.textContent = `
  .vtable-sheet-context-menu {
    display: none !important;
  }
  .visactor-vtable-context-menu {
    display: none !important;
  }
  .vtable-sheet-popup {
    display: none !important;
  }
`
document.head.appendChild(hideVTableContextMenuStyle)

export interface VTableColumnDef {
  key: string
  label: string
  type: 'text' | 'number' | 'formula'
  digits?: number
}

export interface VTableSectionProps {
  fields: VTableColumnDef[]
  rowCount: number
  getRowLabel: (i: number) => string
  isHighlightRow?: (i: number) => boolean
  getCellValue: (rowIndex: number, field: VTableColumnDef) => number | null
  getCellType: (rowIndex: number, field: VTableColumnDef) => 'input' | 'formula' | 'readonly'
  getFormulaExpr: (rowIndex: number, field: VTableColumnDef) => string | null
  isFormulaOverridden: (rowIndex: number, field: VTableColumnDef) => boolean
  onCellChange: (rowIndex: number, field: VTableColumnDef, value: number) => void
}

export interface VTableWrapperProps extends VTableSectionProps {
  title: string
  section2?: VTableSectionProps
  section2Title?: string
  onAddRow?: () => void
  onDeleteRow?: (rowIndex: number) => void
  footerRows?: React.ReactNode
  showContextMenu?: boolean
}

interface StyleOptions {
  fontSize: number
  rowHeight: number
  columnWidth: number
}

function VTableSection({
  fields,
  rowCount,
  getRowLabel,
  isHighlightRow,
  getCellValue,
  getCellType,
  getFormulaExpr,
  isFormulaOverridden,
  onCellChange,
  showToolbar = true,
  height = 860,
  styleOptions = { fontSize: 12, rowHeight: 28, columnWidth: 100 },
  enableContextMenu = true,
}: VTableSectionProps & { showToolbar?: boolean; height?: number; styleOptions?: StyleOptions; enableContextMenu?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<VTableSheet | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)

  useLayoutEffect(() => {
    if (!containerRef.current) return

    const buildSheetData = (): (string | number | null)[][] => {
      const data: (string | number | null)[][] = []
      const totalRows = Math.max(rowCount, 30)
      for (let i = 0; i < totalRows; i++) {
        const row: (string | number | null)[] = []
        if (i < rowCount) {
          row.push(getRowLabel(i))
          fields.forEach(field => {
            const value = getCellValue(i, field)
            row.push(value)
          })
        } else {
          row.push('')
          fields.forEach(() => {
            row.push(null)
          })
        }
        data.push(row)
      }
      console.log('Sheet data row 1:', data[1]?.slice(0, 10))
      return data
    }

    const buildFormulas = (): Record<string, string> => {
      const formulas: Record<string, string> = {}
      for (let i = 0; i < rowCount; i++) {
        fields.forEach((field, fieldIndex) => {
          const formulaExpr = getFormulaExpr(i, field)
          if (formulaExpr) {
            const colIndex = fieldIndex + 1
            const colLetter = String.fromCharCode(65 + colIndex)
            const cellKey = `${colLetter}${i + 1}`
            formulas[cellKey] = formulaExpr
          }
        })
      }
      return formulas
    }

    const columns: ISheetDefine['columns'] = [
      {
        field: 0,
        title: '项目',
        width: styleOptions.columnWidth,
        style: (args: any) => {
          const rowIndex = args.row - 1
          return {
            fontWeight: 500,
            color: '#111827',
            bgColor: isHighlightRow?.(rowIndex) ? '#fef3c7' : undefined,
            fontSize: styleOptions.fontSize,
          }
        },
      },
      ...fields.map((field, index) => ({
        field: index + 1,
        title: field.label,
        width: styleOptions.columnWidth,
        style: (args: any) => {
          const rowIndex = args.row - 1
          const cellType = getCellType(rowIndex, field)
          const overridden = isFormulaOverridden(rowIndex, field)
          const style: any = { fontSize: styleOptions.fontSize }
          if (cellType === 'input') {
            style.color = '#2563eb'
            style.bgColor = '#eff6ff'
          } else if (cellType === 'formula') {
            style.color = overridden ? '#9333ea' : '#374151'
            style.bgColor = overridden ? '#faf5ff' : '#f9fafb'
          }
          return style
        },
      })),
    ]

    const sheetData = buildSheetData()
    const sheetFormulas = buildFormulas()
    
    console.log('Generated formulas:', sheetFormulas)
    console.log('Formula keys:', Object.keys(sheetFormulas).slice(0, 10))

    const sheetDef: ISheetDefine = {
      sheetTitle: '',
      sheetKey: '',
      columns,
      data: sheetData,
      formulas: sheetFormulas,
      frozenColCount: 1,
    }

    const options: IVTableSheetOptions = {
      sheets: [sheetDef],
      showFormulaBar: showToolbar,
      showSheetTab: false,
      mainMenu: { show: showToolbar },
      undoRedo: { show: showToolbar },
      defaultRowHeight: styleOptions.rowHeight,
    }

    const container = containerRef.current
    console.log('Container element:', container)
    console.log('Container computed height:', container?.getBoundingClientRect().height)
    
    const sheet = new VTableSheet(container, options)
    sheetRef.current = sheet
    
    console.log('Sheet created:', sheet)
    console.log('Formulas passed to sheet:', Object.keys(sheetFormulas).length)
    
    setTimeout(() => {
      const workSheet = sheet.getActiveSheet()
      if (workSheet) {
        console.log('Setting formulas via setCellFormula...')
        for (let i = 0; i < rowCount; i++) {
          fields.forEach((field, fieldIndex) => {
            const formulaExpr = getFormulaExpr(i, field)
            if (formulaExpr) {
              const colIndex = fieldIndex + 1
              const cellKey = `${String.fromCharCode(65 + colIndex)}${i + 1}`
              workSheet.setCellFormula(i + 1, colIndex, formulaExpr)
              console.log(`Set formula ${cellKey}: ${formulaExpr}`)
            }
          })
        }
        console.log('Recalculating all formulas...')
        workSheet.recalculateAllFormulas?.()
        console.log('Recalculation done')
      }
    }, 100)

    const handleCellChange = (args: any) => {
      const colIndex = args.col - 1
      const rowIndex = args.row - 1
      if (colIndex >= 0 && colIndex < fields.length && rowIndex >= 0 && rowIndex < rowCount) {
        const field = fields[colIndex]
        const value = args.changedValue
        if (typeof value === 'number') {
          onCellChange(rowIndex, field, value)
        }
      }
    }

    sheet.onTableEvent('change_cell_value', handleCellChange)

    sheet.onTableEvent('selected_cell', (args: any) => {
      setSelectedCell({ row: args.row, col: args.col })
    })

    const handleContextMenu = (e: MouseEvent) => {
      if (!enableContextMenu) return
      const target = e.target as HTMLElement
      if (target.closest('.vtable-context-menu')) return
      
      const vtableContainer = target.closest('.vtable-sheet-container')
      if (!vtableContainer) return
      
      e.preventDefault()
      
      const menuWidth = 150
      const menuHeight = 160
      
      let x = e.clientX + 10
      let y = e.clientY + 10
      
      if (x + menuWidth > window.innerWidth) {
        x = e.clientX - menuWidth - 10
      }
      if (y + menuHeight > window.innerHeight) {
        y = e.clientY - menuHeight - 10
      }
      
      setContextMenuPosition({ x, y })
      setShowContextMenu(true)
    }

    if (enableContextMenu) {
      containerRef.current.addEventListener('contextmenu', handleContextMenu)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (!containerRef.current?.contains(target)) return

      const workSheet = sheet.getActiveSheet()
      if (!workSheet) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        const selection = workSheet.getSelection()
        if (selection) {
          const copiedData = workSheet.getCopiedData()
          const formulas: string[][] = []
          for (let r = selection.startRow; r <= selection.endRow; r++) {
            const rowFormulas: string[] = []
            for (let c = selection.startCol; c <= selection.endCol; c++) {
              rowFormulas.push('')
            }
            formulas.push(rowFormulas)
          }
          const data = {
            values: copiedData,
            formulas,
            startRow: selection.startRow,
            startCol: selection.startCol,
          }
          navigator.clipboard.writeText(JSON.stringify(data))
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        navigator.clipboard.readText().then(text => {
          try {
            const data = JSON.parse(text)
            if (data.values && selectedCell) {
              const processedFormulas = data.formulas 
                ? workSheet.processFormulaPaste(data.formulas, data.startCol, data.startRow, selectedCell.col, selectedCell.row)
                : null
              workSheet.pasteData(data.values, selectedCell.col, selectedCell.row)
              if (processedFormulas) {
                let dataRow = 0
                for (let r = selectedCell.row; r < selectedCell.row + data.values.length; r++) {
                  let dataCol = 0
                  for (let c = selectedCell.col; c < selectedCell.col + (data.values[dataRow]?.length || 0); c++) {
                    if (processedFormulas[dataRow]?.[dataCol]) {
                      workSheet.setCellFormula(r, c, processedFormulas[dataRow][dataCol])
                    }
                    dataCol++
                  }
                  dataRow++
                }
              }
            }
          } catch {
            const cellValue = parseFloat(text)
            if (!isNaN(cellValue) && selectedCell) {
              workSheet.setCellValue(selectedCell.col, selectedCell.row, cellValue)
            }
          }
        })
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          sheet.redo()
        } else {
          sheet.undo()
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        sheet.redo()
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selectedCell) {
          workSheet.setCellValue(selectedCell.col, selectedCell.row, null)
        }
      }
    }

    containerRef.current.addEventListener('keydown', handleKeyDown, true)

    return () => {
      if (enableContextMenu) {
        containerRef.current?.removeEventListener('contextmenu', handleContextMenu)
      }
      containerRef.current?.removeEventListener('keydown', handleKeyDown, true)
      sheet.release()
      sheetRef.current = null
    }
  }, [fields, rowCount, getRowLabel, showToolbar, height, styleOptions, enableContextMenu])

  const handleContextMenuClick = (action: string) => {
    if (!sheetRef.current || !selectedCell) return
    const workSheet = sheetRef.current.getActiveSheet()
    if (!workSheet) return

    switch (action) {
      case 'copy': {
        const selection = workSheet.getSelection() || { startRow: selectedCell.row, endRow: selectedCell.row, startCol: selectedCell.col, endCol: selectedCell.col }
        const copiedData = workSheet.getCopiedData()
        const data = {
          values: copiedData,
          formulas: [],
          startRow: selection.startRow,
          startCol: selection.startCol,
        }
        navigator.clipboard.writeText(JSON.stringify(data))
        break
      }
      case 'paste': {
        navigator.clipboard.readText().then(text => {
          try {
            const data = JSON.parse(text)
            if (data.values) {
              const processedFormulas = data.formulas 
                ? workSheet.processFormulaPaste(data.formulas, data.startCol, data.startRow, selectedCell.col, selectedCell.row)
                : null
              workSheet.pasteData(data.values, selectedCell.col, selectedCell.row)
              if (processedFormulas) {
                let dataRow = 0
                for (let r = selectedCell.row; r < selectedCell.row + data.values.length; r++) {
                  let dataCol = 0
                  for (let c = selectedCell.col; c < selectedCell.col + (data.values[dataRow]?.length || 0); c++) {
                    if (processedFormulas[dataRow]?.[dataCol]) {
                      workSheet.setCellFormula(r, c, processedFormulas[dataRow][dataCol])
                    }
                    dataCol++
                  }
                  dataRow++
                }
              }
            }
          } catch {
            const cellValue = parseFloat(text)
            if (!isNaN(cellValue)) {
              workSheet.setCellValue(selectedCell.col, selectedCell.row, cellValue)
            }
          }
        })
        break
      }
      case 'clear':
        workSheet.setCellValue(selectedCell.col, selectedCell.row, null)
        break
      case 'undo':
        sheetRef.current.undo()
        break
      case 'redo':
        sheetRef.current.redo()
        break
    }
    setShowContextMenu(false)
  }

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest('.vtable-context-menu')) {
      setShowContextMenu(false)
    }
  }

  useEffect(() => {
    if (showContextMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showContextMenu])

  return (
    <div className="relative" style={{ height, overflow: 'auto' }}>
      <div ref={containerRef} style={{ height: '100%' }} />
      {showContextMenu && contextMenuPosition && (
        <div
          className="vtable-context-menu fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[120px]"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <button
            onClick={() => handleContextMenuClick('copy')}
            className="w-full px-4 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <span>复制</span>
            <span className="text-xs text-gray-400 ml-auto">Ctrl+C</span>
          </button>
          <button
            onClick={() => handleContextMenuClick('paste')}
            className="w-full px-4 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <span>粘贴</span>
            <span className="text-xs text-gray-400 ml-auto">Ctrl+V</span>
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={() => handleContextMenuClick('clear')}
            className="w-full px-4 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            清除内容
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={() => handleContextMenuClick('undo')}
            className="w-full px-4 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <span>撤销</span>
            <span className="text-xs text-gray-400 ml-auto">Ctrl+Z</span>
          </button>
          <button
            onClick={() => handleContextMenuClick('redo')}
            className="w-full px-4 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <span>重做</span>
            <span className="text-xs text-gray-400 ml-auto">Ctrl+Y</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default function VTableWrapper({
  title,
  section2,
  section2Title,
  onAddRow,
  onDeleteRow,
  footerRows,
  showContextMenu = true,
  ...section1
}: VTableWrapperProps) {
  const [styleOptions, setStyleOptions] = useState<StyleOptions>({ fontSize: 12, rowHeight: 28, columnWidth: 100 })
  const [showStylePanel, setShowStylePanel] = useState(false)

  const handleExport = useCallback(() => {
    const wb = XLSX.utils.book_new()
    const data: any[] = []
    const headers = ['项目', ...section1.fields.map(f => f.label)]
    data.push(headers)
    for (let i = 0; i < section1.rowCount; i++) {
      const row: any[] = [section1.getRowLabel(i)]
      section1.fields.forEach(field => {
        const value = section1.getCellValue(i, field)
        row.push(value ?? '')
      })
      data.push(row)
    }
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, title)
    XLSX.writeFile(wb, `${title}.xlsx`)
  }, [title, section1])

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const data = new Uint8Array(event.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const ws = workbook.Sheets[workbook.SheetNames[0]]
      if (ws) {
        const jsonData = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][]
        if (jsonData.length > 1) {
          for (let i = 1; i < jsonData.length && i <= section1.rowCount; i++) {
            const rowData = jsonData[i]
            if (rowData && rowData.length > 1) {
              for (let j = 1; j < rowData.length && j <= section1.fields.length; j++) {
                const field = section1.fields[j - 1]
                const value = rowData[j]
                if (typeof value === 'number') {
                  section1.onCellChange(i - 1, field, value)
                }
              }
            }
          }
        }
      }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }, [section1])

  const tableHeight = styleOptions.rowHeight * 32 + 80

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-5 py-2.5 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-700 text-sm">{title}</span>
          <span className="text-[10px] text-gray-500 px-1.5 py-0.5 bg-gray-200/60 rounded-full">{section1.rowCount} 行</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowStylePanel(!showStylePanel)}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 transition-colors"
            >
              样式调整
            </button>
            {showStylePanel && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-3 z-50 min-w-[200px]">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">字号</label>
                    <input
                      type="range"
                      min="10"
                      max="16"
                      value={styleOptions.fontSize}
                      onChange={(e) => setStyleOptions({ ...styleOptions, fontSize: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-gray-400">{styleOptions.fontSize}px</span>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">行高</label>
                    <input
                      type="range"
                      min="20"
                      max="40"
                      value={styleOptions.rowHeight}
                      onChange={(e) => setStyleOptions({ ...styleOptions, rowHeight: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-gray-400">{styleOptions.rowHeight}px</span>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">列宽</label>
                    <input
                      type="range"
                      min="60"
                      max="150"
                      value={styleOptions.columnWidth}
                      onChange={(e) => setStyleOptions({ ...styleOptions, columnWidth: parseInt(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-gray-400">{styleOptions.columnWidth}px</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImport}
            className="hidden"
            id={`import-${title}`}
          />
          <button
            onClick={() => document.getElementById(`import-${title}`)?.click()}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 transition-colors"
          >
            导入
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 transition-colors"
          >
            导出
          </button>
          {onAddRow && (
            <button onClick={onAddRow} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors">
              <span className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">+</span>
              增加行
            </button>
          )}
        </div>
      </div>

      <div className="border-b border-gray-100 px-4 py-1.5 bg-gray-50/50 flex items-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100"></span> 输入参数</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100"></span> 公式计算</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-100"></span> 已修改公式</span>
        <span className="flex items-center gap-1 ml-auto">快捷键: Ctrl+C复制 | Ctrl+V粘贴 | Ctrl+Z撤销 | Ctrl+Y重做</span>
      </div>

      <VTableSection {...section1} showToolbar={true} height={tableHeight} styleOptions={styleOptions} enableContextMenu={showContextMenu} />

      {onAddRow && (
        <div className="border-t border-gray-200">
          <button onClick={onAddRow} className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50/40 transition-colors">
            增加一行
          </button>
        </div>
      )}

      {footerRows}
    </div>
  )
}
