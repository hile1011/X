import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Plus, Search, Eye, Edit, Trash2, Package, Tag, DollarSign } from 'lucide-react'
import { isDefaultStyleProduct } from '../services/productStyles'
import type { Product } from '../types'

export default function Products() {
  const [products, setProducts] = useState<Product[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchProducts()
  }, [])

  const fetchProducts = async () => {
    setLoading(true)
    try {
      const data = await api.products.getAll()
      setProducts(data)
    } catch (error) {
      console.error('加载产品列表失败:', error)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (window.confirm('确定要删除这个产品吗？')) {
      try {
        await api.products.delete(id)
        fetchProducts()
      } catch (error) {
        alert((error as Error).message || '删除失败')
      }
    }
  }

  const categories = ['all', ...new Set(products.map((p) => p.category).filter(Boolean))]

  const filteredProducts = products.filter((product) => {
    const search = searchTerm.toLowerCase()
    const matchesSearch = product.name.toLowerCase().includes(search) || product.sku.toLowerCase().includes(search)
    const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  return (
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">产品管理</h1>
            <p className="text-gray-500 mt-1">管理所有产品信息</p>
          </div>
          <button
            onClick={() => navigate('/products/new')}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors min-h-[44px] justify-center"
          >
            <Plus size={20} />
            添加产品
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100">
          <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索产品名称或SKU..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <Tag className="text-gray-400" size={20} />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category === 'all' ? '全部分类' : category}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="p-6 sm:p-8 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-4">
              {filteredProducts.map((product: { id: string; name: string; sku: string; code: string; price: number; category: string; stock: number }) => (
                <div
                  key={product.id}
                  className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors"
                >
                  <div className="w-full h-32 bg-white rounded-lg flex items-center justify-center mb-4 border border-gray-200">
                    <Package className="text-gray-300" size={48} />
                  </div>

                  <h3 className="font-semibold text-gray-800 truncate mb-1">{product.name}</h3>
                  <p className="text-sm text-gray-500 mb-2">{product.sku}</p>

                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg font-bold text-primary-600">¥{product.price.toLocaleString()}</span>
                    <div className="flex items-center gap-1">
                      {product.code && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded">
                          编码:{product.code}
                        </span>
                      )}
                      <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                        {product.category || '未分类'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
                    <DollarSign size={14} />
                    <span>库存: {product.stock}</span>
                  </div>

                  <div className="flex items-center justify-end gap-1 sm:gap-2">
                    <button
                      onClick={() => navigate(`/products/${product.id}`)}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="查看详情"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      onClick={() => navigate(`/products/${product.id}/edit`)}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                      title="编辑"
                    >
                      <Edit size={18} />
                    </button>
                    {!isDefaultStyleProduct(product.id) && (
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                        title="删除"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {filteredProducts.length === 0 && (
                <div className="col-span-full p-8 text-center">
                  <p className="text-gray-500">暂无产品记录</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
  )
}
