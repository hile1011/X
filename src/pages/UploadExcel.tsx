import { useState, useCallback } from 'react'
import { Upload, FileText, AlertCircle, Trash2, CheckCircle } from 'lucide-react'

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

interface ParseResult {
  success: boolean
  message: string
  sheetName: string
  totalRows: number
  splitRow: number
  orderFields: OrderField[]
  costTables: CostTable[]
}

function formatValue(v: string | number | null): string {
  if (v === null || v === undefined) return '-'
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, '')
  }
  return v
}

export default function UploadExcel() {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [error, setError] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      const ext = selectedFile.name.split('.').pop()?.toLowerCase()
      if (ext !== 'xlsx' && ext !== 'xls') {
        setError('请上传Excel文件(.xlsx或.xls)')
        setFile(null)
      } else {
        setError('')
        setFile(selectedFile)
        setParseResult(null)
      }
    }
  }

  const handleParse = useCallback(async () => {
    if (!file) return

    setIsUploading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload/excel', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setParseResult(data)
      } else {
        setError(data.error || '解析失败')
        setParseResult(null)
      }
    } catch (err) {
      setError('解析失败，请检查网络连接')
      setParseResult(null)
    } finally {
      setIsUploading(false)
    }
  }, [file])

  const handleClear = () => {
    setFile(null)
    setParseResult(null)
    setError('')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Excel 文件解析</h2>
          <p className="mt-1 text-sm text-gray-500">
            上传帆布袋价格试算表，系统自动识别黄色分割线：以上为订单信息，以下为成本计算公式
          </p>
        </div>

        <div className="px-6 py-8">
          <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-8 hover:border-blue-500 transition-colors">
            <Upload className="w-12 h-12 text-gray-400 mb-4" />
            <p className="text-gray-600 mb-2">点击或拖拽文件到此处上传</p>
            <p className="text-sm text-gray-400">支持 .xlsx 和 .xls 格式</p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="mt-4 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {error && (
            <div className="mt-4 flex items-center text-red-600 bg-red-50 px-4 py-3 rounded-lg">
              <AlertCircle className="w-5 h-5 mr-2" />
              <span>{error}</span>
            </div>
          )}

          {file && (
            <div className="mt-4 flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
              <div className="flex items-center">
                <FileText className="w-5 h-5 text-blue-500 mr-3" />
                <span className="text-gray-700">{file.name}</span>
                <span className="text-sm text-gray-400 ml-2">
                  ({(file.size / 1024).toFixed(2)} KB)
                </span>
              </div>
              <button
                onClick={handleClear}
                className="flex items-center text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                清除
              </button>
            </div>
          )}

          <div className="mt-6">
            <button
              onClick={handleParse}
              disabled={!file || isUploading}
              className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <FileText className="w-5 h-5 mr-2" />
              {isUploading ? '解析中...' : '解析文件'}
            </button>
          </div>
        </div>
      </div>

      {parseResult && (
        <div className="mt-6 space-y-6">
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center">
            <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
            <span className="text-green-700">
              解析成功：工作表「{parseResult.sheetName}」，共 {parseResult.totalRows} 行，
              黄色分割线位于第 {parseResult.splitRow} 行
            </span>
          </div>

          {/* 订单信息 */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 bg-yellow-50">
              <h3 className="text-lg font-semibold text-gray-900">
                订单信息（黄色线以上 · 第1-{parseResult.splitRow - 1}行）
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {parseResult.orderFields.map((field) => (
                <div key={field.row} className="flex px-6 py-3 hover:bg-gray-50">
                  <div className="w-32 flex-shrink-0 text-sm font-medium text-gray-500">
                    {field.label}
                  </div>
                  <div className="flex-1 text-sm text-gray-900 whitespace-pre-wrap">
                    {field.value || <span className="text-gray-300">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 黄色分割线标识 */}
          <div className="flex items-center justify-center">
            <div className="flex-1 h-0.5 bg-yellow-400"></div>
            <span className="px-4 text-sm font-medium text-yellow-600 bg-yellow-100 rounded-full py-1">
              黄色分割线 · 第 {parseResult.splitRow} 行
            </span>
            <div className="flex-1 h-0.5 bg-yellow-400"></div>
          </div>

          {/* 成本计算表 */}
          {parseResult.costTables.map((table, tableIndex) => (
            <div key={tableIndex} className="bg-white rounded-lg shadow">
              <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
                <h3 className="text-lg font-semibold text-gray-900">
                  {table.title}（第{table.headerRow}行起）
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 bg-gray-50">
                        项目
                      </th>
                      {table.headers.map((header, i) => (
                        <th key={i} className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {table.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={row.label === '汇总' || row.label === '参考卖价' || row.label === '利润' ? 'bg-amber-50' : ''}>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 sticky left-0 bg-inherit">
                          {row.label}
                        </td>
                        {row.values.map((val, i) => (
                          <td key={i} className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                            {formatValue(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
