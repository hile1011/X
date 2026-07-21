import { useEffect, useRef } from 'react'
import { VTableSheet, type ISheetDefine, type IVTableSheetOptions } from '@visactor/vtable-sheet'

export default function SimpleVTable() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    console.log('SimpleVTable container:', containerRef.current)
    console.log('Container height:', containerRef.current.getBoundingClientRect().height)

    const data = [
      ['项目', '数量', '宽', '高', '底'],
      ['成品', 7200, 38, 40, 0],
      ['正反面', 7200, 38, 40, 0],
      ['印刷手提', 7200, 2.5, 70, 0],
      ['汇总', 7200, null, null, null],
    ]

    const columns: ISheetDefine['columns'] = [
      { field: 0, title: '项目', width: 100 },
      { field: 1, title: '数量', width: 100 },
      { field: 2, title: '宽', width: 100 },
      { field: 3, title: '高', width: 100 },
      { field: 4, title: '底', width: 100 },
    ]

    const sheetDef: ISheetDefine = {
      sheetTitle: '测试表',
      sheetKey: 'test',
      columns,
      data,
    }

    const options: IVTableSheetOptions = {
      sheets: [sheetDef],
      showFormulaBar: true,
      showSheetTab: false,
      mainMenu: { show: true },
      undoRedo: { show: true },
      defaultRowHeight: 28,
    }

    const sheet = new VTableSheet(containerRef.current, options)
    console.log('Sheet instance:', sheet)
    console.log('Active sheet:', sheet.getActiveSheet())

    return () => {
      sheet.destroy()
    }
  }, [])

  return (
    <div style={{ height: 600, border: '1px solid #ddd' }}>
      <div ref={containerRef} style={{ height: '100%' }} />
    </div>
  )
}