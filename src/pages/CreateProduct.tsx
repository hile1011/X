import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { ArrowLeft, Save, Package, Hash, FileText, DollarSign, Tag, Box, Pencil, Calendar } from 'lucide-react'
import { BUILTIN_STYLE_OPTIONS } from '../services/productStyles'
import { SheetTemplateManager } from '../templates/SheetTemplateManager'
import ProductMediaGallery from '../components/ProductMediaGallery'
import { usePermission } from '../hooks/usePermission'

/**
 * 产品新建/编辑/查看三态共用页面：
 *   - /products/new        → 新建（表单可编辑）
 *   - /products/:id/edit   → 编辑模式（表单可编辑，绿色「编辑模式」徽标）
 *   - /products/:id        → 查看模式（viewMode：全部表单控件/交互元素禁用，灰色「查看模式」徽标；
 *                             保留「编辑产品」按钮，仅持有 products:edit 权限时可见）
 *
 * 查看与编辑共用同一界面布局；产品图册在已有产品时展示（查看模式仅浏览 + 双击全屏预览）。
 */
export default function CreateProduct({ viewMode = false }: { viewMode?: boolean }) {
  const { id } = useParams<{ id: string }>()
  const isEditMode = !!id
  const readOnly = viewMode
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEditMode)
  // 数据库模板是否已加载（款式模板关联提示需要在模板列表就绪后展示数据库名）
  const [templatesReady, setTemplatesReady] = useState(false)
  const navigate = useNavigate()
  const { hasPermission } = usePermission()
  const canEdit = hasPermission('products:edit')

  // 同步款式模板逻辑：加载数据库模板（v23 sheet_templates，款式一对多），
  // 与订单页 BagQuote 的款式/模板联动保持一致；失败时静默回退内置模板提示
  useEffect(() => {
    SheetTemplateManager.loadOverrides().finally(() => setTemplatesReady(true))
  }, [])

  // 编辑/查看模式：加载已有产品数据填充表单
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
        setCreatedAt(data.created_at || '')
      } catch (error) {
        console.error('加载产品失败:', error)
      } finally {
        if (!cancelled) setFetching(false)
      }
    }
    fetchProduct()
    return () => { cancelled = true }
  }, [isEditMode, id])

  // 款式模板关联信息（与订单页款式/模板联动逻辑同步）
  const trimmedCode = code.trim()
  const builtinStyle = BUILTIN_STYLE_OPTIONS.find((s) => s.value === trimmedCode)
  // 数据库自定义模板名（templatesReady 后才有；展示顺序与订单页模板下拉一致，按 id 排序）
  // 内置款式（1-6）与自定义编码款式的数据库模板均可关联
  const styleTemplateNames = templatesReady && trimmedCode
    ? SheetTemplateManager.listByStyle(trimmedCode).map((e) => e.name).join('、')
    : ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (readOnly) return
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
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800">
                {readOnly ? '产品详情' : isEditMode ? '编辑产品' : '添加产品'}
              </h1>
              {/* 模式徽标：查看模式灰底 / 编辑模式绿底 */}
              {isEditMode && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    readOnly ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-600'
                  }`}
                  data-testid="mode-badge"
                >
                  {readOnly ? '查看模式' : '编辑模式'}
                </span>
              )}
            </div>
            <p className="text-gray-500 mt-1 truncate">
              {readOnly ? `${name || '产品信息'}` : isEditMode ? '修改产品基本信息与图册' : '填写产品基本信息'}
            </p>
          </div>
        </div>

        {/* 查看模式：编辑按钮（仅编辑权限可见）；编辑/新建模式：保存按钮 */}
        {readOnly ? (
          canEdit && (
            <button
              onClick={() => navigate(`/products/${id}/edit`)}
              className="flex items-center gap-2 text-primary-600 hover:text-primary-700 font-medium min-h-[44px] px-3 py-2 rounded-lg hover:bg-primary-50 transition-colors shrink-0"
              data-testid="edit-product-btn"
            >
              <Pencil size={18} />
              编辑产品
            </button>
          )
        ) : (
          <button
            onClick={handleSubmit}
            disabled={loading || !name || !sku}
            className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] justify-center shrink-0"
          >
            <Save size={20} />
            {loading ? '保存中...' : '保存'}
          </button>
        )}
      </div>

      <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
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
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px] disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                placeholder="请输入产品名称"
                required
                disabled={readOnly}
                data-testid="field-name"
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
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px] disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                  placeholder="请输入SKU编码"
                  required
                  disabled={readOnly}
                  data-testid="field-sku"
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
                  list="builtin-style-codes"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px] disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                  placeholder="输入或选择款式编码（1-6 为内置款式，可自定义）"
                  disabled={readOnly}
                  data-testid="field-code"
                />
                {/* 内置款式快捷选项（datalist）：与订单页款式/模板联动逻辑一致，code 1-6 对应在线表格模板 */}
                <datalist id="builtin-style-codes">
                  {BUILTIN_STYLE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </datalist>
                {/* 款式模板关联提示（与订单页联动逻辑同步）：
                    code 1-6 → 内置款式：内置默认模板 + 数据库自定义模板；
                    自定义编码 → 已有数据库模板时列出，否则引导到模板管理创建；
                    未选模板时订单回退「无底无侧普通袋」内置模板 */}
                {builtinStyle ? (
                  <p className="text-xs text-green-600 mt-1.5">
                    已关联款式「{builtinStyle.label}」模板：内置默认模板{styleTemplateNames ? `、${styleTemplateNames}` : ''}
                  </p>
                ) : trimmedCode ? (
                  styleTemplateNames ? (
                    <p className="text-xs text-green-600 mt-1.5">
                      已关联自定义编码「{trimmedCode}」模板：{styleTemplateNames}；订单未选模板时默认使用「无底无侧普通袋」
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 mt-1.5">
                      自定义编码 {trimmedCode}：可在「款式模板管理」中为该款式创建模板；订单未选模板时默认使用「无底无侧普通袋」
                    </p>
                  )
                ) : (
                  <p className="text-xs text-gray-400 mt-1.5">
                    未填写编码时，订单中该产品默认使用「无底无侧普通袋」模板
                  </p>
                )}
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
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px] disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                  placeholder="请输入价格"
                  required
                  disabled={readOnly}
                  data-testid="field-price"
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
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px] disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                  disabled={readOnly}
                  data-testid="field-category"
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
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none min-h-[44px] disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                  placeholder="请输入库存数量"
                  disabled={readOnly}
                  data-testid="field-stock"
                />
              </div>

              {/* 查看模式：展示创建时间（只读信息） */}
              {readOnly && createdAt && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <span className="flex items-center gap-2">
                      <Calendar size={18} />
                      创建时间
                    </span>
                  </label>
                  <input
                    type="text"
                    value={new Date(createdAt).toLocaleString()}
                    readOnly
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 min-h-[44px]"
                    data-testid="field-created-at"
                  />
                </div>
              )}
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
                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed"
                placeholder="请输入产品描述..."
                disabled={readOnly}
                data-testid="field-description"
              />
            </div>

            {/* 查看模式下隐藏提交操作区（不可编辑状态） */}
            {!readOnly && (
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
            )}
          </form>
        </div>

        {/* 产品图册：查看/编辑模式均展示（查看模式仅浏览 + 双击全屏预览；新建产品时引导先保存） */}
        {isEditMode ? (
          <ProductMediaGallery productId={id!} readOnly={readOnly} />
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6 text-center text-gray-400 text-sm">
            保存产品后即可上传图片/视频，组成产品图册
          </div>
        )}
      </div>
    </div>
  )
}
