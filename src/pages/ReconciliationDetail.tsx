import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Scale, Loader2, AlertCircle, Plus, Trash2, CheckCircle2, Undo2, Save, Calculator,
} from 'lucide-react'
import { api } from '../api'
import { OrderStatus } from '../constants/OrderStatus'
import { getStyleLabelFromProducts } from '../services/productStyles'
import { usePermission } from '../hooks/usePermission'
import type { Product, Quote } from '../types'

/** 保留2位小数 */
const round2 = (n: number) => Math.round(n * 100) / 100

/** 金额格式化：¥1,234.56 */
const formatAmount = (n: number) =>
  `¥${round2(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 工艺成本编辑行（输入框以字符串保存，提交时转数字） */
interface EditableCostRow {
  name: string
  unitPrice: string
  quantity: string
  cost: string
  remark: string
}

const emptyRow = (): EditableCostRow => ({ name: '', unitPrice: '', quantity: '', cost: '', remark: '' })

/** 列索引 → Excel 列字母（0→A, 25→Z, 26→AA） */
const colLetter = (idx: number): string => {
  let s = ''
  let n = idx
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

/** 状态徽标 */
const getStatusBadge = (status: number) => {
  if (status === OrderStatus.RECONCILED) return 'bg-teal-100 text-teal-700'
  if (status === OrderStatus.SHIPPED_PAID) return 'bg-green-100 text-green-700'
  return 'bg-gray-100 text-gray-700'
}

/** 只读信息字段 */
function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-400 mb-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 break-words" title={value}>{value || '-'}</dd>
    </div>
  )
}

/**
 * 订单对账详情页（v28）
 *
 * 从「订单对账管理」双列表进入，包含：
 *   1. 订单基本信息（只读）
 *   2. 工艺成本录入（仅"已发货已收款"状态可编辑）：工艺名称*、单价、数量、成本*、备注 + 累计成本对比
 *   3. 在线表格信息（只读，样式与小数位与订单管理页一致：标题行蓝底/公式格橙底/数值保留2位小数）
 *   4. 确认对账（5→8）/ 退回对账（8→5）
 */
export default function ReconciliationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasPermission } = usePermission()

  const [quote, setQuote] = useState<Quote | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [rows, setRows] = useState<EditableCostRow[]>([emptyRow()])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [saving, setSaving] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [unreconciling, setUnreconciling] = useState(false)

  const canEdit = hasPermission('quotes:edit')
  const canTransition = hasPermission('quotes:status-transition')

  const isEditable = !!quote && quote.status === OrderStatus.SHIPPED_PAID

  const loadData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const [quoteData, costData, productData] = await Promise.all([
        api.quotes.getById(id),
        api.quotes.getReconciliationCosts(id),
        api.products.getAll(),
      ])
      setQuote(quoteData)
      setProducts(productData)
      setRows(
        costData.length > 0
          ? costData.map((c: any) => ({
              name: c.name || '',
              unitPrice: c.unitPrice != null ? String(c.unitPrice) : '',
              quantity: c.quantity != null ? String(c.quantity) : '',
              cost: c.cost != null ? String(c.cost) : '',
              remark: c.remark || '',
            }))
          : [emptyRow()],
      )
    } catch (e: any) {
      setError(e.message || '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ─── 工艺成本行编辑 ─────────────────────────────────────

  const updateRow = (index: number, field: keyof EditableCostRow, value: string) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row
        const next = { ...row, [field]: value }
        // 公式联动：工艺成本 = 工艺单价 × 工艺数量；单价/数量变更且两者均有效时自动重算（覆盖旧值），
        // 任一缺失时不改动成本（保留手动输入的值）；成本框本身也支持手动输入
        if (field === 'unitPrice' || field === 'quantity') {
          const unit = parseFloat(next.unitPrice)
          const qty = parseFloat(next.quantity)
          if (!isNaN(unit) && !isNaN(qty)) {
            next.cost = String(round2(unit * qty))
          }
        }
        return next
      }),
    )
  }

  const addRow = () => setRows((prev) => [...prev, emptyRow()])

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [emptyRow()]))
  }

  /** 过滤完全空白的行 */
  const getFilledRows = () =>
    rows.filter((r) => r.name.trim() || r.unitPrice.trim() || r.quantity.trim() || r.cost.trim() || r.remark.trim())

  /** 校验并转为提交 payload；校验失败返回错误信息 */
  const buildPayload = (): { error: string; payload: Array<{ name: string; unitPrice: number; quantity: number; cost: number; remark: string }> } => {
    const filled = getFilledRows()
    for (let i = 0; i < filled.length; i++) {
      const row = filled[i]
      const no = rows.indexOf(row) + 1
      if (!row.name.trim()) return { error: `第 ${no} 行：工艺名称不能为空`, payload: [] }
      if (row.unitPrice.trim() !== '' && isNaN(Number(row.unitPrice))) return { error: `第 ${no} 行：工艺单价必须为数字`, payload: [] }
      if (row.quantity.trim() !== '' && isNaN(Number(row.quantity))) return { error: `第 ${no} 行：工艺数量必须为数字`, payload: [] }
      if (row.cost.trim() === '' || isNaN(Number(row.cost))) return { error: `第 ${no} 行：工艺成本不能为空且必须为数字`, payload: [] }
      if (Number(row.cost) < 0) return { error: `第 ${no} 行：工艺成本不能为负数`, payload: [] }
    }
    return {
      error: '',
      payload: filled.map((r) => ({
        name: r.name.trim(),
        unitPrice: round2(Number(r.unitPrice) || 0),
        quantity: round2(Number(r.quantity) || 0),
        cost: round2(Number(r.cost) || 0),
        remark: r.remark.trim(),
      })),
    }
  }

  /** 累计工艺成本总额（按当前已填数字行实时计算） */
  const totalCost = round2(
    getFilledRows().reduce((sum, r) => sum + (isNaN(Number(r.cost)) ? 0 : Number(r.cost) || 0), 0),
  )

  // ─── 操作 ───────────────────────────────────────────────

  /** 保存工艺成本明细 */
  const handleSaveCosts = async (): Promise<boolean> => {
    if (!id) return false
    const { error: validationError, payload } = buildPayload()
    if (validationError) {
      setActionError(validationError)
      return false
    }
    setSaving(true)
    setActionError('')
    try {
      const saved = await api.quotes.saveReconciliationCosts(id, payload)
      setRows(
        saved.length > 0
          ? saved.map((c: any) => ({
              name: c.name || '',
              unitPrice: c.unitPrice != null ? String(c.unitPrice) : '',
              quantity: c.quantity != null ? String(c.quantity) : '',
              cost: c.cost != null ? String(c.cost) : '',
              remark: c.remark || '',
            }))
          : [emptyRow()],
      )
      return true
    } catch (e: any) {
      setActionError(e.message || '保存失败，请重试')
      return false
    } finally {
      setSaving(false)
    }
  }

  /** 确认对账：先保存成本明细（有编辑权限时），再流转 5→8 */
  const handleReconcile = async () => {
    if (!id) return
    setReconciling(true)
    setActionError('')
    try {
      if (canEdit) {
        const saved = await handleSaveCosts()
        if (!saved) {
          setReconciling(false)
          return
        }
      }
      await api.quotes.reconcileQuote(id)
      navigate('/reconciliation-alerts')
    } catch (e: any) {
      setActionError(e.message || '确认对账失败，请重试')
    } finally {
      setReconciling(false)
    }
  }

  /** 退回对账：8→5，回到本页可重新调整成本 */
  const handleUnreconcile = async () => {
    if (!id) return
    setUnreconciling(true)
    setActionError('')
    try {
      await api.quotes.unreconcileQuote(id)
      await loadData()
    } catch (e: any) {
      setActionError(e.message || '退回失败，请重试')
    } finally {
      setUnreconciling(false)
    }
  }

  // ─── 渲染 ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 min-h-[calc(100vh-3.5rem)] flex items-center justify-center">
        <div className="text-center text-gray-400">
          <Loader2 size={26} className="animate-spin mx-auto mb-3" />
          加载中...
        </div>
      </div>
    )
  }

  if (error || !quote) {
    return (
      <div className="p-6 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-xl mx-auto bg-white rounded-xl border border-gray-100 p-10 text-center">
          <AlertCircle size={30} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-base font-semibold text-gray-800 mb-2">无法加载订单</h2>
          <p className="text-sm text-gray-500 mb-6">{error || '订单不存在'}</p>
          <button
            onClick={() => navigate('/reconciliation-alerts')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
          >
            <ArrowLeft size={15} />
            返回订单对账管理
          </button>
        </div>
      </div>
    )
  }

  // 仅"已发货已收款(5)"与"已对账(8)"状态支持对账
  if (quote.status !== OrderStatus.SHIPPED_PAID && quote.status !== OrderStatus.RECONCILED) {
    return (
      <div className="p-6 min-h-[calc(100vh-3.5rem)]">
        <div className="max-w-xl mx-auto bg-white rounded-xl border border-gray-100 p-10 text-center">
          <AlertCircle size={30} className="text-amber-400 mx-auto mb-4" />
          <h2 className="text-base font-semibold text-gray-800 mb-2">该订单当前不支持对账</h2>
          <p className="text-sm text-gray-500 mb-6">
            当前状态为「{OrderStatus.getLabel(quote.status)}」，仅「已发货已收款」状态的订单可发起对账
          </p>
          <button
            onClick={() => navigate('/reconciliation-alerts')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
          >
            <ArrowLeft size={15} />
            返回订单对账管理
          </button>
        </div>
      </div>
    )
  }

  const qty = parseFloat(quote.quantity) || 0
  const styleLabel = getStyleLabelFromProducts(products, quote.productStyle)
  const orderCostNoTax = round2(round2(quote.costPrice || 0) * qty)
  const diff = round2(totalCost - orderCostNoTax)
  const tableData = quote.tableData || []

  /** 在线表格行是否为标题行：第一列无值且其他列有值 */
  const isTitleRow = (row: (string | number | null)[]) =>
    (row[0] === null || row[0] === '') && row.some((cell, i) => i > 0 && cell !== null && cell !== '')

  return (
    <div className="p-4 sm:p-6 min-h-[calc(100vh-3.5rem)] space-y-4 sm:space-y-5">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/reconciliation-alerts')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors shrink-0"
          >
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-gray-800 flex items-center gap-2 flex-wrap">
              <Scale className="text-primary-600" size={19} />
              订单对账
              <span className="font-mono text-sm font-normal text-gray-500">{quote.quote_number}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${getStatusBadge(quote.status)}`}>
                {OrderStatus.getLabel(quote.status)}
              </span>
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              客户：{quote.customerName}
              {quote.status === OrderStatus.RECONCILED && quote.reconciledTime && ` · 对账时间：${quote.reconciledTime}`}
            </p>
          </div>
        </div>
        {/* 操作区 */}
        <div className="flex flex-wrap gap-2">
          {isEditable ? (
            <>
              {canEdit && (
                <button
                  onClick={handleSaveCosts}
                  disabled={saving || reconciling}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary-700 border border-primary-200 bg-white rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  保存成本明细
                </button>
              )}
              {canTransition && (
                <button
                  onClick={handleReconcile}
                  disabled={saving || reconciling}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
                >
                  {reconciling ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  确认对账
                </button>
              )}
            </>
          ) : (
            canTransition && (
              <button
                onClick={handleUnreconcile}
                disabled={unreconciling}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-amber-700 border border-amber-200 bg-white rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50"
              >
                {unreconciling ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}
                退回已发货已收款
              </button>
            )
          )}
        </div>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* 区域一：订单基本信息（只读） */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">订单基本信息</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">所有字段为只读展示，不可修改</p>
        </div>
        <dl className="px-4 sm:px-5 py-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-3">
          <InfoField label="客户名称" value={quote.customerName} />
          <InfoField label="款式" value={styleLabel} />
          <InfoField label="产品规格" value={quote.productSpec} />
          <InfoField label="面料材质" value={quote.fabricMaterial} />
          <InfoField label="工艺" value={quote.process} />
          <InfoField label="提手材质" value={quote.handleMaterial} />
          <InfoField label="提手规格" value={quote.handleSpec} />
          <InfoField label="数量" value={quote.quantity} />
          <InfoField label="装箱规格" value={quote.boxSpec} />
          <InfoField label="成本价（不含税）" value={quote.costPrice != null ? formatAmount(quote.costPrice) : ''} />
          <InfoField label="成本价（含税）" value={quote.priceWithTax != null ? formatAmount(quote.priceWithTax) : ''} />
          <InfoField label="不含税卖价" value={quote.sellPriceNoTax != null ? formatAmount(quote.sellPriceNoTax) : ''} />
          <InfoField label="含税卖价" value={quote.sellPriceWithTax != null ? formatAmount(quote.sellPriceWithTax) : ''} />
          <InfoField label="收款时间" value={quote.paymentTime} />
          {quote.status === OrderStatus.RECONCILED && (
            <InfoField label="对账时间" value={quote.reconciledTime || ''} />
          )}
          <InfoField label="创建时间" value={quote.created_at?.slice(0, 10)} />
          <div className="col-span-2 md:col-span-4 xl:col-span-6">
            <InfoField label="备注" value={quote.remark} />
          </div>
        </dl>
      </section>

      {/* 区域二：工艺成本录入 + 成本对比 */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">工艺成本明细</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {isEditable
                ? '录入各环节工艺成本：成本自动按单价×数量联动，也可手动输入；工艺名称与工艺成本为必填项'
                : '订单已对账，明细为只读；退回后可重新调整'}
            </p>
          </div>
          {isEditable && canEdit && (
            <button
              onClick={addRow}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
            >
              <Plus size={14} />
              添加工艺
            </button>
          )}
        </div>

        {/* 成本明细表 */}
        <div className="p-4 sm:p-5 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium w-[18%]">工艺名称 <span className="text-red-500">*</span></th>
                <th className="py-2 pr-3 font-medium w-[14%]">工艺单价</th>
                <th className="py-2 pr-3 font-medium w-[14%]">工艺数量</th>
                <th className="py-2 pr-3 font-medium w-[16%]" title="自动按单价×数量联动，也可手动输入">
                  工艺成本 <span className="text-red-500">*</span>
                </th>
                <th className="py-2 pr-3 font-medium w-[28%]">工艺备注</th>
                {isEditable && canEdit && <th className="py-2 font-medium w-[10%] text-center">操作</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-b border-gray-50 last:border-b-0">
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      value={row.name}
                      readOnly={!isEditable || !canEdit}
                      onChange={(e) => updateRow(index, 'name', e.target.value)}
                      placeholder="如：印刷费"
                      className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 read-only:bg-gray-50 read-only:text-gray-600 read-only:border-gray-100"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={row.unitPrice}
                      readOnly={!isEditable || !canEdit}
                      onChange={(e) => updateRow(index, 'unitPrice', e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 read-only:bg-gray-50 read-only:text-gray-600 read-only:border-gray-100"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={row.quantity}
                      readOnly={!isEditable || !canEdit}
                      onChange={(e) => updateRow(index, 'quantity', e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 read-only:bg-gray-50 read-only:text-gray-600 read-only:border-gray-100"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={row.cost}
                      readOnly={!isEditable || !canEdit}
                      onChange={(e) => updateRow(index, 'cost', e.target.value)}
                      placeholder="0.00"
                      title="自动按单价×数量联动，也可手动输入"
                      className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 read-only:bg-gray-50 read-only:text-gray-600 read-only:border-gray-100"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      value={row.remark}
                      readOnly={!isEditable || !canEdit}
                      onChange={(e) => updateRow(index, 'remark', e.target.value)}
                      placeholder="选填"
                      className="w-full px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 read-only:bg-gray-50 read-only:text-gray-600 read-only:border-gray-100"
                    />
                  </td>
                  {isEditable && canEdit && (
                    <td className="py-2 text-center">
                      <button
                        onClick={() => removeRow(index)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                        title="删除该行"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 成本对比 */}
        <div className="px-4 sm:px-5 pb-5">
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Calculator size={14} className="text-gray-500" />
              <h3 className="text-xs font-semibold text-gray-700">成本对比</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white rounded-lg border border-gray-100 px-4 py-3">
                <p className="text-[11px] text-gray-400 mb-1">累计工艺成本总额</p>
                <p className="text-lg font-bold text-teal-700">{formatAmount(totalCost)}</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-100 px-4 py-3">
                <p className="text-[11px] text-gray-400 mb-1">订单不含税成本</p>
                <p className="text-lg font-bold text-gray-800">{formatAmount(orderCostNoTax)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">成本价 ¥{round2(quote.costPrice || 0).toFixed(2)} × 数量 {qty}</p>
              </div>
              <div className={`rounded-lg border px-4 py-3 ${diff > 0 ? 'bg-red-50/60 border-red-100' : diff < 0 ? 'bg-green-50/60 border-green-100' : 'bg-white border-gray-100'}`}>
                <p className="text-[11px] text-gray-400 mb-1">差额（工艺成本 − 订单成本）</p>
                <p className={`text-lg font-bold ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-700' : 'text-gray-800'}`}>
                  {diff > 0 ? '+' : ''}{formatAmount(diff)}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {diff > 0 ? '实际工艺成本超出订单成本' : diff < 0 ? '实际工艺成本低于订单成本' : '两者一致'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 区域三：在线表格信息（只读，样式与小数位与订单管理页在线表格一致） */}
      <section className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800">在线表格信息</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">所有字段为只读展示，不可修改</p>
        </div>
        <div className="p-4 sm:p-5 overflow-x-auto">
          {tableData.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">暂无在线表格数据</p>
          ) : (
            <table className="border-collapse text-sm">
              <tbody>
                {tableData.map((row, r) => {
                  const title = isTitleRow(row)
                  return (
                    <tr key={r}>
                      {row.map((cell, c) => {
                        const address = `${colLetter(c)}${r + 1}`
                        const isFormula = !!(quote as any).allFormulas?.[address]
                        // 与订单管理页在线表格（VTable fieldFormat）一致：数值保留2位小数
                        const isNumber = typeof cell === 'number' && !isNaN(cell)
                        const display = cell === null || cell === '' ? '' : isNumber ? (cell as number).toFixed(2) : String(cell)
                        return (
                          <td
                            key={c}
                            className={`border border-black px-2.5 py-1.5 whitespace-nowrap font-bold ${
                              title ? 'text-white' : 'text-black'
                            } ${isNumber ? 'text-right' : ''}`}
                            style={{
                              backgroundColor: title ? '#4472C4' : isFormula ? '#F8CBAD' : '#FFFFFF',
                            }}
                          >
                            {display}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
