import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, Save, Package, Hash, FileText, DollarSign, Tag, Box } from 'lucide-react'

export default function CreateProduct() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = !!id
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEditMode)
  const navigate = useNavigate()

  // 编辑模式：加载已有产品数据填充表单
  useEffect(() => {
    if (!isEditMode) return
    let cancelled = false
    const fetchProduct = async () => {
      setFetching(true)
      try {
        const data = await api.products.getById(id!)
        if (cancelled) return
        setName(data.name || '')
        setSku(data.sku || '')
        setCode(data.code || '')
        setDescription(data.description || '')
        setPrice(data.price != null ? String(data.price) : '')
        setCategory(data.category || '')
        setStock(data.stock != null ? String(data.stock) : '')
      } catch (error) {
        console.error('加载产品失败:', error)
      } finally {
        if (!cancelled) setFetching(false)
      }
    }
    fetchProduct()
    return () => { cancelled = true }
  }, [isEditMode, id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const payload = {
        name,
        sku,
        code,
        description,
        price: parseFloat(price) || 0,
        category,
        stock: parseInt(stock) || 0,
      }
      if (isEditMode) {
        await api.products.update(id!, payload)
        // 编辑后跳转回详情页，便于确认修改结果
        navigate(`/products/${id}`)
      } else {
        await api.products.create(payload)
        navigate('/products')
      }
    } catch (error) {
      console.error(isEditMode ? '更新产品失败:' : '创建产品失败:', error)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/products')}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">加载中...</h1>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 sm:p-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-500 mt-4">加载产品信息...</p>
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
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{isEditMode ? '编辑产品' : '添加产品'}</h1>
              <p className="text-gray-500 mt-1">{isEditMode ? '修改产品基本信息' : '填写产品基本信息'}</p>
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading || !name || !sku}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] justify-center shrink-0"
          >
            <Save size={20} />
            {loading ? '保存中...' : '保存'}
          </button>
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-2">
                    <Package size={18} />
                    产品名称 <span className="text-red-500">*</span>
                  </span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                  placeholder="请输入产品名称"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Hash size={18} />
                      SKU <span className="text-red-500">*</span>
                    </span>
                  </label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="请输入SKU编码"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Tag size={18} />
                      产品编码
                    </span>
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="款式编码(如1-6)，可关联报价模板"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <DollarSign size={18} />
                      价格 <span className="text-red-500">*</span>
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="请输入价格"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Tag size={18} />
                      分类
                    </span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                  >
                    <option value="">请选择分类</option>
                    <option value="款式">款式</option>
                    <option value="电子产品">电子产品</option>
                    <option value="办公用品">办公用品</option>
                    <option value="服装配饰">服装配饰</option>
                    <option value="家居用品">家居用品</option>
                    <option value="食品饮料">食品饮料</option>
                    <option value="其他">其他</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Box size={18} />
                      库存数量
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px]"
                    placeholder="请输入库存数量"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <span className="flex items-center gap-2">
                    <FileText size={18} />
                    产品描述
                  </span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
                  placeholder="请输入产品描述..."
                />
              </div>

              <div className="flex gap-3 sm:gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/products')}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors min-h-[44px]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading || !name || !sku}
                  className="flex-1 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
  )
}
