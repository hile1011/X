import express from 'express'
import multer from 'multer'
import ExcelJS from 'exceljs'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

export const uploadRouter = express.Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`)
  },
})

const upload = multer({ storage })

interface OrderField {
  label: string
  value: string
  row: number
}

interface CostRow {
  label: string
  values: (string | number | null)[]
}

interface CostTable {
  title: string
  headerRow: number
  headers: string[]
  rows: CostRow[]
}

interface ParseSheetResult {
  sheetName: string
  totalRows: number
  splitRow: number
  orderFields: OrderField[]
  costTables: CostTable[]
}

function isYellow(argb: string | undefined): boolean {
  if (!argb) return false
  const upper = argb.toUpperCase()
  return upper === 'FFFFFF00' || upper === 'FFFF00'
}

function getCellValue(cell: ExcelJS.Cell): string | number | null {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined && v.result !== null) {
      return v.result as number | string
    }
    if ('sharedFormula' in v && !('result' in v)) {
      return null
    }
    if ('text' in v) {
      return String(v.text)
    }
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((rt: { text?: string }) => rt.text || '').join('')
    }
    if ('formula' in v && !('result' in v)) {
      return ''
    }
    return ''
  }
  return String(v)
}

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return true
  if (typeof v === 'string') return v.trim() !== '' && !isNaN(Number(v))
  return false
}

async function parseSheet(filePath: string): Promise<ParseSheetResult> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets[0]
  if (!sheet) {
    throw new Error('未找到工作表')
  }

  const sheetName = sheet.name
  const totalRows = sheet.rowCount

  let splitRow = -1
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    let yellowCellCount = 0
    let nonEmptyCount = 0
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber > sheet.columnCount) return
      const fill = cell.fill
      if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
        const fg = fill.fgColor
        if (fg && isYellow(fg.argb)) {
          yellowCellCount++
        }
      }
      const v = getCellValue(cell)
      if (v !== null && String(v).trim() !== '') {
        nonEmptyCount++
      }
    })
    if (yellowCellCount >= 3 && yellowCellCount >= nonEmptyCount) {
      splitRow = r
      break
    }
  }

  if (splitRow === -1) {
    throw new Error('未找到黄色分割线')
  }

  const orderFields: OrderField[] = []
  for (let r = 1; r < splitRow; r++) {
    const row = sheet.getRow(r)
    const labelCell = row.getCell(2)
    const valueCell = row.getCell(4)
    const label = labelCell.value ? String(getCellValue(labelCell) || '').trim() : ''
    if (label) {
      const rawValue = getCellValue(valueCell)
      const value = rawValue !== null ? String(rawValue).trim() : ''
      orderFields.push({ label, value, row: r })
    }
  }

  const costTables: CostTable[] = []
  let currentTable: CostTable | null = null
  let tableIndex = 0

  for (let r = splitRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const bValue = getCellValue(row.getCell(2))
    const cValue = getCellValue(row.getCell(3))

    const bText = bValue !== null ? String(bValue).trim() : ''
    const cText = cValue !== null ? String(cValue).trim() : ''

    const rowHasAnyValue = bText !== '' || cText !== '' ||
      Array.from({ length: sheet.columnCount - 3 }, (_, i) => getCellValue(row.getCell(4 + i)))
        .some(v => v !== null && String(v).trim() !== '')

    if (!rowHasAnyValue) {
      continue
    }

    const bIsEmpty = bText === ''
    const cIsTextHeader = cText !== '' && !isNumericValue(cValue)

    if (bIsEmpty && cIsTextHeader) {
      const headers: string[] = []
      for (let c = 3; c <= sheet.columnCount; c++) {
        const hv = getCellValue(row.getCell(c))
        if (hv !== null && String(hv).trim() !== '') {
          headers.push(String(hv).trim())
        }
      }
      tableIndex++
      currentTable = {
        title: `成本计算表 ${tableIndex}`,
        headerRow: r,
        headers,
        rows: [],
      }
      costTables.push(currentTable)
    } else if (currentTable) {
      const values: (string | number | null)[] = []
      for (let c = 3; c < 3 + currentTable.headers.length; c++) {
        values.push(getCellValue(row.getCell(c)))
      }
      currentTable.rows.push({ label: bText, values })
    }
  }

  return { sheetName, totalRows, splitRow, orderFields, costTables }
}

uploadRouter.post('/excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' })
    }
    const filePath = req.file.path
    const result = await parseSheet(filePath)
    fs.unlinkSync(filePath)
    res.json({ success: true, message: '文件解析成功', ...result })
  } catch (error) {
    console.error('Excel解析错误:', error)
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    res.status(500).json({ error: '文件解析失败', details: (error as Error).message })
  }
})

uploadRouter.post('/excel/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传文件' })
    }
    const filePath = req.file.path
    const result = await parseSheet(filePath)
    fs.unlinkSync(filePath)
    res.json({ success: true, ...result })
  } catch (error) {
    console.error('Excel预览错误:', error)
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    res.status(500).json({ error: '文件解析失败', details: (error as Error).message })
  }
})
