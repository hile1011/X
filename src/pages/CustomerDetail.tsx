import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, Building2, User, Phone, Mail, MapPin, Briefcase, ShoppingCart, Tag, StickyNote } from 'lucide-react'
import { parseCustomerTags } from '../utils/customerTags'
import type { Customer, Quote } from '../types'

export default function CustomerDetail() {
  const { id } = useParams()
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    setLoading(true)
    const [customerData, quotesData] = await Promise.all([
      api.customers.getById(id || '') as Promise<Customer>,
      api.quotes.getAll() as Promise<Quote[]>,
    ])
    setCustomer(customerData)
    // 根据客户名称筛选报价单
    setQuotes(quotesData.filter((q) => q.customerName === customerData.name))
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/customers')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">客户详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/customers')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">客户详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <p className="text-gray-500">客户不存在</p>
        </div>
      </div>
    )
  }

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button
              onClick={() => navigate('/customers')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800">客户详情</h1>
              <p className="text-gray-500 mt-1 truncate">{(customer as { name: string }).name}</p>
            </div>
          </div>
          <button
            onClick={() => navigate(`/customers/${customer.id}/edit`)}
            className="text-primary-600 hover:text-primary-700 font-medium min-h-[44px] px-3 py-2 rounded-lg hover:bg-primary-50 transition-colors shrink-0"
          >
            编辑客户
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="text-primary-600" size={20} />
                <h2 className="text-base sm:text-lg font-semibold text-gray-800">基本信息</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <User className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">联系人</label>
                    <p className="text-gray-900 truncate">{(customer as { contact_person: string }).contact_person || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Phone className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">电话</label>
                    <p className="text-gray-900 truncate">{(customer as { phone: string }).phone || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Mail className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">邮箱</label>
                    <p className="text-gray-900 truncate">{(customer as { email: string }).email || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Briefcase className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">行业</label>
                    <p className="text-gray-900 truncate">{(customer as { industry: string }).industry || '-'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:col-span-2 min-w-0">
                  <MapPin className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">地址</label>
                    <p className="text-gray-900">{(customer as { address: string }).address || '-'}</p>
                  </div>
                </div>
                {parseCustomerTags((customer as { tags?: string }).tags).length > 0 && (
                  <div className="flex items-start gap-3 sm:col-span-2 min-w-0">
                    <Tag className="text-gray-400 shrink-0 mt-0.5" size={20} />
                    <div className="min-w-0">
                      <label className="block text-sm text-gray-500">标签</label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {parseCustomerTags((customer as { tags?: string }).tags).map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 bg-primary-50 text-primary-600 text-xs rounded-full border border-primary-100"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {(customer as { remark?: string }).remark && (
                  <div className="flex items-start gap-3 sm:col-span-2 min-w-0">
                    <StickyNote className="text-gray-400 shrink-0 mt-0.5" size={20} />
                    <div className="min-w-0">
                      <label className="block text-sm text-gray-500">备注</label>
                      <p className="text-gray-900 whitespace-pre-wrap break-words">{(customer as { remark?: string }).remark}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingCart className="text-primary-600" size={20} />
                <h2 className="text-base sm:text-lg font-semibold text-gray-800">历史订单</h2>
              </div>
              {quotes.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无订单记录</p>
              ) : (
                <div className="space-y-3">
                  {quotes.map((quote) => (
                    <div
                      key={quote.id}
                      className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors gap-3"
                      onClick={() => navigate(`/quotes/${quote.id}`)}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-800 truncate">{quote.quote_number}</p>
                        <p className="text-sm text-gray-500">{new Date(quote.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-medium text-gray-800">¥{quote.sellPriceWithTax.toFixed(2)}</p>
                        <span className={`text-xs ${quote.status === 6 ? 'text-green-600' : quote.status === 5 ? 'text-blue-600' : quote.status === 7 ? 'text-cyan-600' : 'text-gray-600'}`}>
                          {quote.status === 6 ? '已结束' : quote.status === 5 ? '已收款' : quote.status === 7 ? '打样完成' : quote.status === 4 ? '已发货' : quote.status === 3 ? '做货中' : quote.status === 2 ? '打样中' : '报价中'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 sm:space-y-6">
            <div className="bg-gradient-to-br from-primary-500 to-blue-600 rounded-xl p-4 sm:p-6 text-white">
              <h3 className="text-sm font-medium text-blue-100 mb-2">客户统计</h3>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-xl sm:text-2xl font-bold">{quotes.length}</p>
                  <p className="text-blue-100 text-sm">订单数量</p>
                </div>
                <div>
                  <p className="text-xl sm:text-2xl font-bold">¥{quotes.reduce((sum, q) => sum + q.sellPriceWithTax, 0).toLocaleString()}</p>
                  <p className="text-blue-100 text-sm">订单总额</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <h3 className="font-semibold text-gray-800 mb-4">快捷操作</h3>
              <div className="space-y-2">
                <button
                  onClick={() => navigate(`/quotes/new?customerId=${customer.id}`)}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors min-h-[44px]"
                >
                  <Briefcase size={18} />
                  创建报价
                </button>
                <button
                  onClick={() => navigate(`/customers/${customer.id}/edit`)}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors min-h-[44px]"
                >
                  <Building2 size={18} />
                  编辑客户
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
  )
}
