import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Select as AntSelect } from 'antd'
import {
  Scale, RefreshCw, ChevronDown, ChevronUp, Undo2, Eye, AlertCircle, Loader2, X, Image, Clock, Calendar, FileCheck, Building, Search,
} from 'lucide-react'
import { api } from '../api'
import { OrderStatus } from '../constants/OrderStatus'
import { fetchStyleOptions, getStyleLabelFromProducts, type StyleOption } from '../services/productStyles'
import { TooltipCell } from '../components/TooltipCell'
import { usePermission } from '../hooks/usePermission'
import type { Product, Quote } from '../types'

/** 保留2位小数（与订单管理列表口径一致） */
const round2 = (n: number) => Math.round(n * 100) / 100

/** 状态徽标颜色（与订单管理列表一致） */
const getStatusColor = (status: number) => {
  switch (status) {
    case 5: return 'bg-green-100 text-green-700'
    case 8: return 'bg-teal-100 text-teal-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('zh-CN')

/** 客户分组（与订单管理列表一致：默认展开、每组默认显示前 5 条） */
interface QuoteGroup {
  customerName: string
  expanded: boolean
  quotes: Quote[]
  visibleCount: number
}

/**
 * 订单对账管理（v28）
 *
 * 双列表（均使用订单管理列表的表格格式与列结构）：
 *   - 上：已发货已收款订单（待对账），可发起对账（跳转专属对账页）
 *   - 下：已对账订单，可查看对账详情或退回已发货已收款状态
 *
 * 排序规则（同状态内）：修改时间 DESC → 客户名称 ASC → 订单号 DESC（与订单列表一致）
 */
export default function ReconciliationAlerts() {
  const navigate = useNavigate()
  const { hasPermission } = usePermission()

  const [quotes, setQuotes] = useState<Quote[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [imageFlags, setImageFlags] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [unreconciling, setUnreconciling] = useState(false)
  /** 待退回确认的订单（已对账列表） */
  const [confirmQuote, setConfirmQuote] = useState<Quote | null>(null)
  /** 两个列表的客户分组（与订单管理列表一致） */
  const [pendingGroups, setPendingGroups] = useState<QuoteGroup[]>([])
  const [reconciledGroups, setReconciledGroups] = useState<QuoteGroup[]>([])
  // ===== 查询条件（与订单管理筛选栏一致：客户多选 / 款式 / 做货日期区间）=====
  const [searchTerm, setSearchTerm] = useState('')
  const [customerFilters, setCustomerFilters] = useState<string[]>([])
  const [styleFilters, setStyleFilters] = useState<string[]>([])
  const [productionDateStart, setProductionDateStart] = useState('')
  const [productionDateEnd, setProductionDateEnd] = useState('')
  /** 款式下拉选项（产品管理模块动态获取） */
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])

  const canTransition = hasPermission('quotes:status-transition')

  /** 同状态内排序：修改时间 DESC → 客户名称 ASC → 订单号 DESC */
  const sortQuotes = (list: Quote[]) =>
    [...list].sort((a, b) => {
      const ta = new Date(a.updated_at || '').getTime() || 0
      const tb = new Date(b.updated_at || '').getTime() || 0
      if (tb !== ta) return tb - ta
      const nameCmp = a.customerName.localeCompare(b.customerName, 'zh-Hans-CN')
      if (nameCmp !== 0) return nameCmp
      return b.quote_number.localeCompare(a.quote_number)
    })

  /** 按客户名称分组（保持排序后的插入顺序，默认展开、每组显示前 5 条） */
  const buildGroups = (list: Quote[]): QuoteGroup[] => {
    const grouped: Record<string, Quote[]> = {}
    list.forEach((quote) => {
      if (!grouped[quote.customerName]) grouped[quote.customerName] = []
      grouped[quote.customerName].push(quote)
    })
    return Object.entries(grouped).map(([customerName, groupQuotes]) => ({
      customerName,
      expanded: true,
      quotes: groupQuotes,
      visibleCount: 5,
    }))
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [quoteData, productData, flags] = await Promise.all([
        api.quotes.getAll(),
        api.products.getAll(),
        api.quotes.getImageFlags(),
      ])
      setQuotes(quoteData)
      setProducts(productData)
      setImageFlags(flags || {})
    } catch (e: any) {
      setError(e.message || '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    fetchStyleOptions().then(setStyleOptions)
  }, [loadData])

  /**
   * 查询条件过滤（与订单管理筛选逻辑一致）：
   *   - 搜索词：客户名称 / 款式 / 订单号 模糊匹配
   *   - 客户多选：订单客户名与任一选中客户名匹配（忽略大小写）
   *   - 款式：productStyle 或款式名匹配
   *   - 做货日期区间：基于做货开始时间（productionStartTime || productionTimeStart）
   */
  const matchesFilters = (quote: Quote) => {
    const matchesSearch =
      !searchTerm ||
      quote.quote_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      quote.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getStyleLabelFromProducts(products, quote.productStyle).toLowerCase().includes(searchTerm.toLowerCase())

    const matchesCustomer =
      customerFilters.length === 0 ||
      customerFilters.some((name) => quote.customerName.toLowerCase() === name.toLowerCase())

    const matchesStyle = styleFilters.length === 0 ||
      styleFilters.some((style) =>
        quote.productStyle === style ||
        getStyleLabelFromProducts(products, quote.productStyle) === getStyleLabelFromProducts(products, style)
      )

    const matchesDateRange = (() => {
      if (!productionDateStart && !productionDateEnd) return true
      const dateStr = quote.productionStartTime || quote.productionTimeStart
      if (!dateStr) return false
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return false
      if (productionDateStart) {
        const start = new Date(productionDateStart)
        start.setHours(0, 0, 0, 0)
        if (date < start) return false
      }
      if (productionDateEnd) {
        const end = new Date(productionDateEnd)
        end.setHours(23, 59, 59, 999)
        if (date > end) return false
      }
      return true
    })()

    return matchesSearch && matchesCustomer && matchesStyle && matchesDateRange
  }

  // 数据或查询条件变化时重建两个列表的客户分组（先过滤后排序）
  useEffect(() => {
    setPendingGroups(buildGroups(sortQuotes(quotes.filter((q) => q.status === OrderStatus.SHIPPED_PAID && matchesFilters(q)))))
    setReconciledGroups(buildGroups(sortQuotes(quotes.filter((q) => q.status === OrderStatus.RECONCILED && matchesFilters(q)))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, searchTerm, customerFilters, styleFilters, productionDateStart, productionDateEnd, products])

  const toggleGroup = (setter: React.Dispatch<React.SetStateAction<QuoteGroup[]>>) => (customerName: string) => {
    setter((prev) =>
      prev.map((group) =>
        group.customerName === customerName ? { ...group, expanded: !group.expanded } : group
      )
    )
  }

  const showMore = (setter: React.Dispatch<React.SetStateAction<QuoteGroup[]>>) => (customerName: string) => {
    setter((prev) =>
      prev.map((group) =>
        group.customerName === customerName ? { ...group, visibleCount: group.visibleCount + 5 } : group
      )
    )
  }

  /** 退回对账：已对账(8) → 已发货已收款(5) */
  const handleUnreconcile = async () => {
    if (!confirmQuote) return
    setUnreconciling(true)
    setActionError('')
    try {
      await api.quotes.unreconcileQuote(confirmQuote.id)
      setConfirmQuote(null)
      await loadData()
    } catch (e: any) {
      setActionError(e.message || '退回失败，请重试')
    } finally {
      setUnreconciling(false)
    }
  }

  /**
   * 订单表格（与订单管理列表同格式：列结构 / 客户分组 / 缩略图 / 金额口径完全一致）
   * @param variant 'pending' 待对账（操作=发起对账）；'reconciled' 已对账（操作=查看/退回，状态列附对账时间）
   */
  const renderQuoteTable = (groups: QuoteGroup[], variant: 'pending' | 'reconciled') => {
    const setter = variant === 'pending' ? setPendingGroups : setReconciledGroups
    const total = groups.reduce((sum, g) => sum + g.quotes.length, 0)
    if (total === 0) {
      return (
        <div className="py-14 text-center text-sm text-gray-400">
          {variant === 'pending' ? '暂无待对账订单' : '暂无已对账订单'}
        </div>
      )
    }
    return (
      <div className="overflow-x-auto">
        <div className="min-w-[2200px]">
          {/* 表头（与订单管理列表一致） */}
          <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
            <div className="flex">
              <div className="w-16 px-4 py-3 flex-shrink-0"></div>
              <div className="w-44 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单号</div>
              <div className="w-40 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">款式</div>
              <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">产品规格</div>
              <div className="w-24 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">数量</div>
              <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">面料</div>
              <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">工艺</div>
              <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">订单状态</div>
              <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(不含税)</div>
              <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">卖价(含税)</div>
              <div className="w-28 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">成本价</div>
              <div className="w-28 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">含税价</div>
              <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">利润(不含税)</div>
              <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">利润(含税)</div>
              <div className="w-36 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0" title="数量 × 卖价(含税)">销售总额(含税)</div>
              <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0" title="数量 × 利润(不含税)">利润总额</div>
              <div className="w-44 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">做货到期时间</div>
              <div className="w-32 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0">创建日期</div>
              <div className="w-56 px-4 py-3 text-left text-sm font-semibold text-gray-600 flex-shrink-0 sticky right-0 bg-gray-50 z-20 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">操作</div>
            </div>
          </div>

          {/* 父子列表（按客户分组，与订单管理列表一致） */}
          <div className="divide-y divide-gray-100">
            {groups.map((group) => (
              <div key={group.customerName}>
                {/* 父行 - 客户名称 */}
                <div
                  className="flex items-center hover:bg-gray-50 cursor-pointer transition-colors bg-gray-50/50"
                  onClick={() => toggleGroup(setter)(group.customerName)}
                >
                  <div className="w-16 px-4 py-4 flex-shrink-0 flex items-center justify-center">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                      {group.customerName.charAt(0)}
                    </div>
                  </div>
                  <div className="flex-1 px-4 py-4">
                    <div className="flex items-center gap-3">
                      {group.expanded ? (
                        <ChevronUp size={20} className="text-gray-400" />
                      ) : (
                        <ChevronDown size={20} className="text-gray-400" />
                      )}
                      <span className="text-lg font-semibold text-gray-800">{group.customerName}</span>
                      <span className="text-sm text-gray-500">({group.quotes.length}个订单)</span>
                    </div>
                  </div>
                  <div className="w-56 px-4 py-4 flex-shrink-0 sticky right-0 bg-gray-50/50 z-20 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]"></div>
                </div>

                {/* 子行 - 订单详情（每组默认显示前 5 条，可展开更多） */}
                {group.expanded &&
                  group.quotes.slice(0, group.visibleCount).map((quote) => {
                    const qty = parseFloat(quote.quantity) || 0
                    return (
                      <div
                        key={quote.id}
                        className="flex items-center hover:bg-gray-50 cursor-pointer transition-colors"
                        onDoubleClick={() => navigate(`/reconciliation-alerts/${quote.id}`)}
                        title="双击进入对账详情"
                      >
                        {/* 产品图 */}
                        <div className="w-16 px-4 py-4 flex-shrink-0 flex items-center justify-center">
                          {imageFlags[quote.id] ? (
                            <img
                              src={api.quotes.getThumbnailUrl(quote.id, quote.updated_at)}
                              alt="产品图"
                              loading="lazy"
                              className="w-10 h-10 rounded-lg object-cover border border-gray-200"
                              onError={(e) => {
                                const target = e.currentTarget
                                target.style.display = 'none'
                                const placeholder = target.nextElementSibling as HTMLElement
                                if (placeholder) placeholder.style.display = 'flex'
                              }}
                            />
                          ) : null}
                          {(!imageFlags[quote.id]) && (
                            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                              <Image className="text-gray-400" size={18} />
                            </div>
                          )}
                          <div className="w-10 h-10 rounded-lg bg-gray-100 items-center justify-center" style={{ display: 'none' }}>
                            <Image className="text-gray-400" size={18} />
                          </div>
                        </div>

                        {/* 订单号 */}
                        <TooltipCell
                          className="w-44 px-4 py-4 text-gray-600 text-sm font-mono"
                          tooltip={quote.quote_number}
                        >
                          {quote.quote_number}
                        </TooltipCell>

                        {/* 款式 */}
                        <TooltipCell
                          className="w-40 px-4 py-4 text-gray-600 text-sm"
                          tooltip={getStyleLabelFromProducts(products, quote.productStyle)}
                        >
                          {getStyleLabelFromProducts(products, quote.productStyle)}
                        </TooltipCell>

                        {/* 产品规格 */}
                        <TooltipCell
                          className="w-36 px-4 py-4 text-gray-600 text-sm"
                          tooltip={quote.productSpec ? `${quote.productSpec}CM` : ''}
                        >
                          {quote.productSpec}{quote.productSpec ? 'CM' : ''}
                        </TooltipCell>

                        {/* 数量 */}
                        <div className="w-24 px-4 py-4 flex-shrink-0 text-gray-600 text-sm">
                          {quote.quantity}{quote.quantity ? '个' : ''}
                        </div>

                        {/* 面料 */}
                        <TooltipCell
                          className="w-32 px-4 py-4 text-gray-600 text-sm"
                          tooltip={quote.fabricMaterial}
                        >
                          {quote.fabricMaterial}
                        </TooltipCell>

                        {/* 工艺 */}
                        <TooltipCell
                          className="w-32 px-4 py-4 text-gray-600 text-sm"
                          tooltip={quote.process}
                        >
                          {quote.process}
                        </TooltipCell>

                        {/* 订单状态（已对账附对账时间） */}
                        <div className="w-36 px-4 py-4 flex-shrink-0">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(quote.status)}`}>
                            {OrderStatus.getLabel(quote.status)}
                          </span>
                          {variant === 'reconciled' && quote.reconciledTime && (
                            <p className="text-[10px] text-gray-400 mt-1">对账于 {quote.reconciledTime}</p>
                          )}
                        </div>

                        {/* 卖价(不含税) */}
                        <div className="w-36 px-4 py-4 flex-shrink-0">
                          <span className="text-primary-600 font-semibold text-sm">
                            ¥{(quote.sellPriceNoTax || 0).toFixed(2)}
                          </span>
                        </div>

                        {/* 卖价(含税) */}
                        <div className="w-36 px-4 py-4 flex-shrink-0">
                          <span className="text-primary-600 font-semibold text-sm">
                            ¥{(quote.sellPriceWithTax || 0).toFixed(2)}
                          </span>
                        </div>

                        {/* 成本价 */}
                        <div className="w-28 px-4 py-4 flex-shrink-0">
                          <span className="text-gray-600 font-medium text-sm">
                            ¥{(quote.costPrice || 0).toFixed(2)}
                          </span>
                        </div>

                        {/* 含税价 */}
                        <div className="w-28 px-4 py-4 flex-shrink-0">
                          <span className="text-gray-700 font-medium text-sm">
                            ¥{(quote.priceWithTax || 0).toFixed(2)}
                          </span>
                        </div>

                        {/* 利润(不含税) = 卖价不含税 - 成本价 */}
                        <div className="w-32 px-4 py-4 flex-shrink-0">
                          <span className={`font-semibold text-sm ${((quote.sellPriceNoTax || 0) - (quote.costPrice || 0)) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ¥{((quote.sellPriceNoTax || 0) - (quote.costPrice || 0)).toFixed(2)}
                          </span>
                        </div>

                        {/* 利润(含税) = 卖价含税 - 含税价 */}
                        <div className="w-32 px-4 py-4 flex-shrink-0">
                          <span className={`font-semibold text-sm ${((quote.sellPriceWithTax || 0) - (quote.priceWithTax || 0)) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ¥{((quote.sellPriceWithTax || 0) - (quote.priceWithTax || 0)).toFixed(2)}
                          </span>
                        </div>

                        {/* 销售总额(含税) = 数量 × 卖价(含税)（与订单管理列表口径一致） */}
                        <div className="w-36 px-4 py-4 flex-shrink-0">
                          <span className="text-primary-600 font-semibold text-sm">
                            ¥{round2(round2(quote.sellPriceWithTax || 0) * qty).toFixed(2)}
                          </span>
                        </div>

                        {/* 利润总额 = 数量 × 单个利润(不含税) */}
                        <div className="w-32 px-4 py-4 flex-shrink-0">
                          <span className={`font-semibold text-sm ${round2(round2(round2(quote.sellPriceNoTax || 0) - round2(quote.costPrice || 0)) * qty) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ¥{round2(round2(round2(quote.sellPriceNoTax || 0) - round2(quote.costPrice || 0)) * qty).toFixed(2)}
                          </span>
                        </div>

                        {/* 做货到期时间 */}
                        <div className="w-44 px-4 py-4 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <Clock className="text-gray-400" size={14} />
                            <span className="text-gray-500 text-sm truncate">
                              {quote.productionTimeEnd ? formatDate(quote.productionTimeEnd) : '-'}
                            </span>
                          </div>
                        </div>

                        {/* 创建日期 */}
                        <div className="w-32 px-4 py-4 flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <Calendar className="text-gray-400" size={14} />
                            <span className="text-gray-500 text-sm">
                              {formatDate(quote.created_at)}
                            </span>
                          </div>
                        </div>

                        {/* 操作 - 固定列（对账专属操作） */}
                        <div className="w-56 px-4 py-4 flex-shrink-0 sticky right-0 bg-white z-20 hover:bg-gray-50 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.1)]">
                          <div className="flex items-center gap-2">
                            {variant === 'pending' ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  navigate(`/reconciliation-alerts/${quote.id}`)
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                                title="进入对账页录入工艺成本并确认对账"
                              >
                                <FileCheck size={13} />
                                发起对账
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigate(`/reconciliation-alerts/${quote.id}`)
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                                  title="查看对账详情"
                                >
                                  <Eye size={13} />
                                  查看
                                </button>
                                {canTransition && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActionError('')
                                      setConfirmQuote(quote)
                                    }}
                                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                                    title="退回已发货已收款状态，重新核对成本"
                                  >
                                    <Undo2 size={13} />
                                    退回
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                {/* 显示更多按钮：订单数超过当前可见数时显示 */}
                {group.expanded && group.quotes.length > group.visibleCount && (
                  <div
                    className="flex justify-center py-2 border-b border-gray-100 bg-gray-50/30"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => showMore(setter)(group.customerName)}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <ChevronDown size={14} />
                      显示更多（剩余 {group.quotes.length - group.visibleCount} 条）
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const pendingCount = pendingGroups.reduce((sum, g) => sum + g.quotes.length, 0)
  const reconciledCount = reconciledGroups.reduce((sum, g) => sum + g.quotes.length, 0)

  /** 客户名称候选（当前全部订单去重排序，供客户多选下拉） */
  const getCustomerNames = () =>
    [...new Set(quotes.map((q) => q.customerName))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

  const hasActiveFilters = !!(searchTerm || customerFilters.length > 0 || styleFilters.length > 0 || productionDateStart || productionDateEnd)

  /** 筛选栏（同时作用于上下两个列表，样式与订单管理筛选栏一致） */
  const renderFilterBar = (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-5">
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索客户/款式/订单号..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>
        {/* 客户名称多选：输入关键字实时模糊检索 + 下拉多选 */}
        <div className="relative flex-1 min-w-[180px]">
          <Building className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
          <AntSelect
            mode="multiple"
            showSearch
            allowClear
            value={customerFilters}
            onChange={(values: string[]) => setCustomerFilters(values)}
            placeholder="客户名称（输入检索，可多选）"
            optionFilterProp="label"
            filterSort={(a, b) => String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'zh-Hans-CN')}
            options={getCustomerNames().map((name) => ({ value: name, label: name }))}
            maxTagCount="responsive"
            popupClassName="quotes-multi-select-dropdown"
            className="quotes-multi-select"
            style={{ width: '100%' }}
          />
        </div>
        {/* 款式多选：下拉多选，可搜索 */}
        <div className="relative flex-1 min-w-[150px]">
          <Eye className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10 pointer-events-none" size={18} />
          <AntSelect
            mode="multiple"
            showSearch
            allowClear
            value={styleFilters}
            onChange={(values: string[]) => setStyleFilters(values)}
            placeholder="款式（可多选）"
            optionFilterProp="label"
            filterSort={(a, b) => String(a?.label ?? '').localeCompare(String(b?.label ?? ''), 'zh-Hans-CN')}
            options={styleOptions.map((style) => ({ value: style.value, label: style.label }))}
            maxTagCount="responsive"
            popupClassName="quotes-multi-select-dropdown"
            className="style-multi-select"
            style={{ width: '100%' }}
          />
        </div>
        {/* 做货日期区间（基于做货开始时间） */}
        <div className="relative flex-1 min-w-[230px]">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <div className="w-full pl-9 pr-1 py-1 border border-gray-200 rounded-lg flex items-center gap-1 focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
            <input
              type="date"
              value={productionDateStart}
              onChange={(e) => setProductionDateStart(e.target.value)}
              title="做货开始日期（起）"
              className="flex-1 min-w-0 px-1 py-1 text-sm text-gray-700 outline-none bg-transparent"
            />
            <span className="text-gray-400 text-xs">至</span>
            <input
              type="date"
              value={productionDateEnd}
              onChange={(e) => setProductionDateEnd(e.target.value)}
              title="做货开始日期（止）"
              className="flex-1 min-w-0 px-1 py-1 text-sm text-gray-700 outline-none bg-transparent"
            />
            {hasActiveFilters && (
              <button
                onClick={() => { setSearchTerm(''); setCustomerFilters([]); setStyleFilters([]); setProductionDateStart(''); setProductionDateEnd('') }}
                className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                title="清除全部查询条件"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 min-h-[calc(100vh-3.5rem)]">
      {/* 页头 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Scale className="text-primary-600" size={22} />
            订单对账管理
          </h1>
          <p className="text-gray-500 mt-1 text-sm">订单成本与实际支出的核对：已发货已收款订单录入工艺成本并确认对账</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-600 bg-white rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {actionError && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* 查询栏：搜索词 + 客户多选 + 款式 + 做货日期区间（同时作用于上下两个列表） */}
      {renderFilterBar}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-16 text-center text-gray-400">
          <Loader2 size={24} className="animate-spin mx-auto mb-3" />
          加载中...
        </div>
      ) : (
        <div className="space-y-5">
          {/* 上：已发货已收款订单（待对账）——订单管理列表格式 */}
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <h2 className="text-sm font-semibold text-gray-800">已发货已收款订单</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">
                待对账 {pendingCount} 单
              </span>
            </div>
            {renderQuoteTable(pendingGroups, 'pending')}
          </section>

          {/* 下：已对账订单——订单管理列表格式 */}
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500" />
              <h2 className="text-sm font-semibold text-gray-800">已对账订单</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium">
                已对账 {reconciledCount} 单
              </span>
            </div>
            {renderQuoteTable(reconciledGroups, 'reconciled')}
          </section>
        </div>
      )}

      {/* 退回确认弹窗 */}
      {confirmQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !unreconciling && setConfirmQuote(null)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-5">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-800">退回对账确认</h3>
              <button
                onClick={() => setConfirmQuote(null)}
                disabled={unreconciling}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              确定将订单 <span className="font-mono text-gray-800">{confirmQuote.quote_number}</span>（客户：{confirmQuote.customerName}）
              退回至「已发货已收款」状态吗？
            </p>
            <p className="text-xs text-gray-400 mt-2">退回后已录入的工艺成本明细会保留，可调整后重新确认对账。</p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmQuote(null)}
                disabled={unreconciling}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleUnreconcile}
                disabled={unreconciling}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                {unreconciling ? <Loader2 size={15} className="animate-spin" /> : <Undo2 size={15} />}
                确认退回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
