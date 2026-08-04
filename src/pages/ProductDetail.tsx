import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, Package, Hash, DollarSign, Tag, Box, Calendar } from 'lucide-react'

export default function ProductDetail() {
  const { id } = useParams()
  const [product, setProduct] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    setLoading(true)
    const data = await api.products.getById(id || '')
    setProduct(data)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/products')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">产品详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/products')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">产品详情</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <p className="text-gray-500">产品不存在</p>
        </div>
      </div>
    )
  }

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <button
              onClick={() => navigate('/products')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800">产品详情</h1>
              <p className="text-gray-500 mt-1 truncate">{(product as { name: string }).name}</p>
            </div>
          </div>
          <button
            onClick={() => navigate(`/products/${id}/edit`)}
            className="text-primary-600 hover:text-primary-700 font-medium min-h-[44px] px-3 py-2 rounded-lg hover:bg-primary-50 transition-colors shrink-0"
          >
            编辑产品
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="w-full h-48 sm:h-64 bg-gray-50 rounded-xl flex items-center justify-center mb-4 sm:mb-6">
              <Package className="text-gray-300" size={96} />
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-2">{(product as { name: string }).name}</h2>
            <p className="text-gray-500 mb-4">{(product as { sku: string }).sku}</p>

            {(product as { description: string }).description && (
              <div className="mb-4 sm:mb-6">
                <h3 className="font-semibold text-gray-700 mb-2">产品描述</h3>
                <p className="text-gray-600">{(product as { description: string }).description}</p>
              </div>
            )}
          </div>

          <div className="space-y-4 sm:space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <h3 className="font-semibold text-gray-800 mb-4">价格信息</h3>
              <div className="flex items-center gap-3 mb-4">
                <DollarSign className="text-primary-600" size={24} />
                <span className="text-2xl sm:text-3xl font-bold text-primary-600">¥{(product as { price: number }).price.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
              <h3 className="font-semibold text-gray-800 mb-4">基本信息</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Hash className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">SKU</label>
                    <p className="text-gray-900 truncate">{(product as { sku: string }).sku}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Tag className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">产品编码</label>
                    <p className="text-gray-900 truncate">{(product as { code: string }).code || '无'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Tag className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">分类</label>
                    <p className="text-gray-900 truncate">{(product as { category: string }).category || '未分类'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Box className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">库存</label>
                    <p className="text-gray-900">{(product as { stock: number }).stock} 件</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <Calendar className="text-gray-400 shrink-0" size={20} />
                  <div className="min-w-0">
                    <label className="block text-sm text-gray-500">创建时间</label>
                    <p className="text-gray-900">{new Date((product as { created_at: string }).created_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-primary-50 to-blue-50 rounded-xl p-4 sm:p-6">
              <h3 className="font-semibold text-gray-800 mb-2">操作提示</h3>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• 点击编辑按钮修改产品信息</li>
                <li>• 库存不足时及时补货</li>
                <li>• 价格变动需同步更新</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
  )
}
