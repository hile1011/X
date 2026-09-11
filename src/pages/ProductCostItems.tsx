/**
 * 产品成本项配置 - 编辑详情页（/product-cost-items/:id）
 *
 * 从列表查询页（ProductCostItemList）跳转进入，提供完整的成本项配置编辑功能：
 *   - 顶部：返回列表 + 成本项切换器（select，切换时同步 URL，支持前进/后退）
 *   - 成本项名称编辑（内联表单）
 *   - 可选工艺管理：表格 + 新增/编辑表单（名称/成本/公式/特点/备注 + 动态自定义字段）
 *     + 上移/下移手动排序（整表原子重排序号，列表页展示顺序同步跟随）
 *   - 自定义字段配置：表格 + 新增/编辑表单（text/number/date/select、显隐、排序）
 *
 * 与列表页共享权限码 process-costs:*（view 由路由控制，操作按钮按 create/edit/delete 渲染）。
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, Edit2, Trash2, Save, X, ChevronUp, ChevronDown, Eye, EyeOff, Settings2, ArrowLeft } from 'lucide-react'
import { api } from '../api'
import { DeleteConfirmDialog } from '../components/DeleteConfirmDialog'
import { usePermission } from '../hooks/usePermission'
import type { ProductCostItem, ProductCostProcess, ProductCostCustomField, ProductCostFieldType } from '../types'

/** 删除对话框目标（三类实体共用一个对话框） */
interface DeleteTarget {
  kind: 'item' | 'process' | 'field'
  itemId: string
  id: string
}

/** 自定义字段类型中文标签（列表页子表头悬停提示复用） */
export const FIELD_TYPE_LABELS: Record<ProductCostFieldType, string> = {
  text: '文本',
  number: '数字',
  date: '日期',
  select: '下拉选择',
}

const emptyProcessForm = (): {
  name: string
  cost: string
  formula: string
  features: string
  remark: string
  customValues: Record<string, string>
} => ({
  name: '',
  cost: '',
  formula: '',
  features: '',
  remark: '',
  customValues: {},
})

const emptyFieldForm = (): {
  name: string
  fieldType: ProductCostFieldType
  optionsText: string
  visible: boolean
} => ({
  name: '',
  fieldType: 'text',
  optionsText: '',
  visible: true,
})

export default function ProductCostItems() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { hasPermission } = usePermission()
  const canCreate = hasPermission('process-costs:create')
  const canEdit = hasPermission('process-costs:edit')
  const canDelete = hasPermission('process-costs:delete')

  const [items, setItems] = useState<ProductCostItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ─── 成本项名称表单 ────────────────────────────────────────
  const [showItemForm, setShowItemForm] = useState(false)
  const [editingItem, setEditingItem] = useState<ProductCostItem | null>(null)
  const [itemForm, setItemForm] = useState({ name: '' })

  // ─── 可选工艺表单 ──────────────────────────────────────────
  const [showProcessForm, setShowProcessForm] = useState(false)
  const [editingProcess, setEditingProcess] = useState<ProductCostProcess | null>(null)
  const [processForm, setProcessForm] = useState(emptyProcessForm)

  // ─── 自定义字段表单 ────────────────────────────────────────
  const [showFieldForm, setShowFieldForm] = useState(false)
  const [editingField, setEditingField] = useState<ProductCostCustomField | null>(null)
  const [fieldForm, setFieldForm] = useState(emptyFieldForm)

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  /** URL 中的成本项 id 在数据中不存在（已删除 / 无效链接） */
  const notFound = !isLoading && !error && id != null && !items.some((i) => i.id === id)

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedItemId) ?? null,
    [items, selectedItemId],
  )
  /** 显示中的自定义字段（visible=true），工艺表格动态列与编辑表单均按此渲染 */
  const visibleFields = useMemo(
    () => selectedItem?.fields.filter((f) => f.visible) ?? [],
    [selectedItem],
  )

  useEffect(() => {
    loadItems()
  }, [])

  const loadItems = async () => {
    setIsLoading(true)
    try {
      const data = await api.productCostItems.getAll()
      setItems(data)
      setError(null)
    } catch (err: any) {
      setError(err.message || '加载产品成本项失败')
    } finally {
      setIsLoading(false)
    }
  }

  /** 选中项跟随 URL id（加载完成 / 前进后退 / 列表页跳转时同步） */
  useEffect(() => {
    if (isLoading || !id) return
    if (items.some((i) => i.id === id)) {
      if (selectedItemId !== id) {
        setSelectedItemId(id)
        // 切换成本项时收起进行中的表单（表单属于上一个成本项）
        setShowProcessForm(false)
        setShowFieldForm(false)
        setError(null)
      }
    } else if (selectedItemId == null && items.length > 0) {
      // 初始无选中（如直接深链且 id 无效被上面 notFound 覆盖前的兜底）
      setSelectedItemId(items[0].id)
    }
  }, [id, isLoading, items, selectedItemId])

  /** 切换成本项（同步 URL，支持浏览器前进/后退） */
  const switchItem = (newId: string) => {
    if (newId === selectedItemId) return
    navigate(`/product-cost-items/${newId}`, { replace: true })
  }

  // ─── 成本项 CRUD ───────────────────────────────────────────

  const handleCreateItem = () => {
    setEditingItem(null)
    setItemForm({ name: '' })
    setShowItemForm(true)
  }

  const handleEditItem = (item: ProductCostItem) => {
    setEditingItem(item)
    setItemForm({ name: item.name })
    setShowItemForm(true)
  }

  const handleSubmitItem = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = itemForm.name.trim()
    if (!name) {
      setError('成本项名称不能为空')
      return
    }
    try {
      if (editingItem) {
        await api.productCostItems.updateItem(editingItem.id, { name })
        setShowItemForm(false)
        setError(null)
        await loadItems()
      } else {
        const created = await api.productCostItems.createItem({ name })
        setShowItemForm(false)
        setError(null)
        // 新建成本项：跳转到其详情页继续配置工艺与字段
        navigate(`/product-cost-items/${created.id}`)
        await loadItems()
      }
    } catch (err: any) {
      setError(err.message || '保存成本项失败')
    }
  }

  // ─── 可选工艺 CRUD ─────────────────────────────────────────

  const handleCreateProcess = () => {
    setEditingProcess(null)
    setProcessForm(emptyProcessForm())
    setShowProcessForm(true)
  }

  const handleEditProcess = (process: ProductCostProcess) => {
    setEditingProcess(process)
    setProcessForm({
      name: process.name,
      cost: process.cost.toString(),
      formula: process.formula,
      features: process.features,
      remark: process.remark,
      customValues: { ...process.customValues },
    })
    setShowProcessForm(true)
  }

  const handleSubmitProcess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return
    const name = processForm.name.trim()
    if (!name) {
      setError('工艺名称不能为空')
      return
    }
    const cost = processForm.cost.trim() === '' ? 0 : Number(processForm.cost)
    if (!Number.isFinite(cost) || cost < 0) {
      setError('工艺成本金额必须为非负数字')
      return
    }
    const data = {
      name,
      cost,
      formula: processForm.formula.trim(),
      features: processForm.features.trim(),
      remark: processForm.remark.trim(),
      customValues: processForm.customValues,
    }
    try {
      if (editingProcess) {
        await api.productCostItems.updateProcess(selectedItem.id, editingProcess.id, data)
      } else {
        await api.productCostItems.createProcess(selectedItem.id, data)
      }
      setShowProcessForm(false)
      setError(null)
      await loadItems()
    } catch (err: any) {
      setError(err.message || '保存可选工艺失败')
    }
  }

  const setCustomValue = (fieldId: string, value: string) => {
    setProcessForm((prev) => ({
      ...prev,
      customValues: { ...prev.customValues, [fieldId]: value },
    }))
  }

  /** 工艺排序：与相邻工艺交换位置后，整表按新顺序原子重排序号（避免逐行改产生重复序号） */
  const moveProcess = async (process: ProductCostProcess, dir: 'up' | 'down') => {
    if (!selectedItem) return
    const list = selectedItem.processes
    const idx = list.findIndex((p) => p.id === process.id)
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || target < 0 || target >= list.length) return
    const newIds = list.map((p) => p.id)
    ;[newIds[idx], newIds[target]] = [newIds[target], newIds[idx]]
    try {
      await api.productCostItems.reorderProcesses(selectedItem.id, newIds)
      await loadItems()
    } catch (err: any) {
      setError(err.message || '调整工艺顺序失败')
    }
  }

  // ─── 自定义字段 CRUD ────────────────────────────────────────

  const handleCreateField = () => {
    setEditingField(null)
    setFieldForm(emptyFieldForm())
    setShowFieldForm(true)
  }

  const handleEditField = (field: ProductCostCustomField) => {
    setEditingField(field)
    setFieldForm({
      name: field.name,
      fieldType: field.fieldType,
      optionsText: field.options.join('\n'),
      visible: field.visible,
    })
    setShowFieldForm(true)
  }

  const handleSubmitField = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedItem) return
    const name = fieldForm.name.trim()
    if (!name) {
      setError('字段名称不能为空')
      return
    }
    const options = fieldForm.optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
    if (fieldForm.fieldType === 'select' && options.length === 0) {
      setError('下拉类型字段至少需要一个选项（每行一个）')
      return
    }
    const data = {
      name,
      fieldType: fieldForm.fieldType,
      options,
      visible: fieldForm.visible,
    }
    try {
      if (editingField) {
        await api.productCostItems.updateField(selectedItem.id, editingField.id, data)
      } else {
        await api.productCostItems.createField(selectedItem.id, data)
      }
      setShowFieldForm(false)
      setError(null)
      await loadItems()
    } catch (err: any) {
      setError(err.message || '保存自定义字段失败')
    }
  }

  /** 切换字段显示/隐藏（隐藏字段不渲染在工艺列表与编辑表单，已录值保留） */
  const toggleFieldVisible = async (field: ProductCostCustomField) => {
    if (!selectedItem) return
    try {
      await api.productCostItems.updateField(selectedItem.id, field.id, { visible: !field.visible })
      await loadItems()
    } catch (err: any) {
      setError(err.message || '切换字段显示状态失败')
    }
  }

  /** 字段排序：与相邻字段交换位置，并整体重排（1-based 连续） */
  const moveField = async (fieldId: string, dir: 'up' | 'down') => {
    if (!selectedItem) return
    const fields = [...selectedItem.fields]
    const idx = fields.findIndex((f) => f.id === fieldId)
    const target = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || target < 0 || target >= fields.length) return
    ;[fields[idx], fields[target]] = [fields[target], fields[idx]]
    try {
      for (let i = 0; i < fields.length; i++) {
        if (fields[i].sortOrder !== i + 1) {
          await api.productCostItems.updateField(selectedItem.id, fields[i].id, { sortOrder: i + 1 })
        }
      }
      await loadItems()
    } catch (err: any) {
      setError(err.message || '调整字段顺序失败')
    }
  }

  // ─── 删除 ───────────────────────────────────────────────────

  const getDeleteHandlers = (target: DeleteTarget) => {
    if (target.kind === 'item') {
      return {
        label: '产品成本项',
        deleteFn: (pid: string) => api.productCostItems.deleteItem(pid),
        deleteCheckFn: (pid: string) => api.productCostItems.deleteItemCheck(pid),
      }
    }
    if (target.kind === 'process') {
      return {
        label: '可选工艺',
        deleteFn: (pid: string) => api.productCostItems.deleteProcess(target.itemId, pid),
        deleteCheckFn: (pid: string) => api.productCostItems.deleteProcessCheck(target.itemId, pid),
      }
    }
    return {
      label: '自定义字段',
      deleteFn: (pid: string) => api.productCostItems.deleteField(target.itemId, pid),
      deleteCheckFn: (pid: string) => api.productCostItems.deleteFieldCheck(target.itemId, pid),
    }
  }

  /** 删除完成：当前展示的成本项被删时返回列表页，其余情况原地刷新 */
  const handleDeleted = async () => {
    if (deleteTarget?.kind === 'item' && deleteTarget.itemId === selectedItemId) {
      navigate('/product-cost-items')
      return
    }
    await loadItems()
  }

  // ─── 渲染 ──────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6">
      {/* ─── 页头 ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 sm:mb-6">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/product-cost-items')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 min-h-[44px] shrink-0"
            title="返回列表查询页"
          >
            <ArrowLeft size={16} />
            返回列表
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">编辑成本项配置</h1>
            <p className="text-gray-500 mt-1 text-sm">
              配置成本项的名称、可选工艺与自定义扩展字段（文本 / 数字 / 日期 / 下拉）
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && selectedItem && (
            <button
              onClick={() => handleEditItem(selectedItem)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 min-h-[44px] justify-center"
            >
              <Edit2 size={16} />
              编辑名称
            </button>
          )}
          {canCreate && (
            <button
              onClick={handleCreateItem}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors min-h-[44px] justify-center"
            >
              <Plus size={18} />
              新增成本项
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600" aria-label="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ─── 无效链接 / 已删除 ──────────────────────────────── */}
      {notFound ? (
        <div className="bg-white rounded-lg shadow-md p-8 sm:p-12 text-center">
          <p className="text-gray-600 mb-1 font-medium">成本项不存在或已被删除</p>
          <p className="text-gray-400 text-sm mb-6">链接可能已失效，请返回列表查看全部成本项</p>
          <button
            onClick={() => navigate('/product-cost-items')}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 min-h-[44px]"
          >
            <ArrowLeft size={16} />
            返回列表
          </button>
        </div>
      ) : (
        <>
          {/* ─── 加载态 ──────────────────────────────────── */}
          {isLoading ? (
            <div className="bg-white rounded-lg shadow-md p-12 text-center text-gray-500">加载中...</div>
          ) : (
            <>
              {/* ─── 成本项切换器 ────────────────────────────── */}
              {items.length > 0 && (
                <div className="bg-white rounded-lg shadow-md px-4 py-3 mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
                  <label htmlFor="cost-item-switcher" className="text-sm font-medium text-gray-700 shrink-0">
                    当前成本项
                  </label>
                  <select
                    id="cost-item-switcher"
                    value={selectedItemId ?? ''}
                    onChange={(e) => switchItem(e.target.value)}
                    disabled={items.length <= 1}
                    className="flex-1 max-w-md px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px] bg-white text-sm"
                  >
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}（{item.processes.length} 工艺 / {item.fields.length} 字段）
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">共 {items.length} 个成本项，切换即时生效</span>
                </div>
              )}

              {/* ─── 成本项名称编辑表单 ──────────────────────── */}
              {showItemForm && (
                <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
                      {editingItem ? '编辑成本项名称' : '新增成本项'}
                    </h2>
                    <button
                      onClick={() => setShowItemForm(false)}
                      className="text-gray-400 hover:text-gray-600 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100"
                      aria-label="关闭"
                    >
                      <X size={24} />
                    </button>
                  </div>
                  <form onSubmit={handleSubmitItem} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">成本项名称 <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        name="name"
                        value={itemForm.name}
                        onChange={(e) => setItemForm({ name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                        placeholder="如：印刷成本、布料成本、包装成本"
                        required
                        autoFocus
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setShowItemForm(false)}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 min-h-[44px]"
                      >
                        取消
                      </button>
                      <button
                        type="submit"
                        className="flex items-center gap-2 justify-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 min-h-[44px]"
                      >
                        <Save size={16} />
                        {editingItem ? '保存修改' : '添加'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* ─── 选中成本项详情 ─────────────────────────── */}
              {selectedItem && (
                <>
                  {/* 可选工艺 */}
                  <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
                          <span className="inline-block w-1 h-4 bg-blue-600 rounded-full" />
                          可选工艺 — {selectedItem.name}
                        </h2>
                        <p className="text-gray-400 text-xs sm:text-sm mt-1">
                          一个成本项可配置多个可选工艺，支持上移/下移手动排序；列顺序与显示跟随下方自定义字段配置
                        </p>
                      </div>
                      {canCreate && (
                        <button
                          onClick={handleCreateProcess}
                          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm min-h-[40px] justify-center"
                        >
                          <Plus size={16} />
                          添加工艺
                        </button>
                      )}
                    </div>

                    {showProcessForm && (
                      <div className="rounded-lg bg-gray-50 p-4 mb-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold text-gray-700">
                            {editingProcess ? `编辑工艺：${editingProcess.name}` : '新增可选工艺'}
                          </h3>
                          <button
                            onClick={() => setShowProcessForm(false)}
                            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"
                            aria-label="关闭"
                          >
                            <X size={20} />
                          </button>
                        </div>
                        <form onSubmit={handleSubmitProcess} className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">工艺名称 <span className="text-red-500">*</span></label>
                              <input
                                type="text"
                                value={processForm.name}
                                onChange={(e) => setProcessForm({ ...processForm, name: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                                placeholder="如：单面数码UV印刷"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">工艺成本金额（元）</label>
                              <input
                                type="number"
                                value={processForm.cost}
                                onChange={(e) => setProcessForm({ ...processForm, cost: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                                placeholder="请输入工艺成本金额"
                                min="0"
                                step="0.01"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">成本计算公式</label>
                            <input
                              type="text"
                              value={processForm.formula}
                              onChange={(e) => setProcessForm({ ...processForm, formula: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                              placeholder="如：印刷面积 × 单价 × 2"
                            />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">工艺特点描述</label>
                              <textarea
                                value={processForm.features}
                                onChange={(e) => setProcessForm({ ...processForm, features: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder="如：色彩还原度高，适合照片级图案"
                                rows={2}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">工艺备注</label>
                              <textarea
                                value={processForm.remark}
                                onChange={(e) => setProcessForm({ ...processForm, remark: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder="其他说明信息"
                                rows={2}
                              />
                            </div>
                          </div>

                          {/* 动态自定义字段（按字段类型渲染输入控件，隐藏字段不显示） */}
                          {visibleFields.length > 0 && (
                            <div className="border-t border-gray-200 pt-4">
                              <p className="text-xs text-gray-400 mb-3">自定义字段（按「自定义字段配置」自动加载，隐藏字段不显示）</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {visibleFields.map((field) => (
                                  <div key={field.id}>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                      {field.name}
                                      <span className="ml-1.5 text-xs text-gray-400">{FIELD_TYPE_LABELS[field.fieldType]}</span>
                                    </label>
                                    {field.fieldType === 'select' ? (
                                      <select
                                        value={processForm.customValues[field.id] ?? ''}
                                        onChange={(e) => setCustomValue(field.id, e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                                      >
                                        <option value="">请选择</option>
                                        {field.options.map((opt) => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type={field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : 'text'}
                                        value={processForm.customValues[field.id] ?? ''}
                                        onChange={(e) => setCustomValue(field.id, e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                                        placeholder={field.fieldType === 'text' ? `请输入${field.name}` : undefined}
                                        step={field.fieldType === 'number' ? 'any' : undefined}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setShowProcessForm(false)}
                              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 min-h-[44px]"
                            >
                              取消
                            </button>
                            <button
                              type="submit"
                              className="flex items-center gap-2 justify-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 min-h-[44px]"
                            >
                              <Save size={16} />
                              {editingProcess ? '保存修改' : '添加'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工艺名称</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">成本金额（元）</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">计算公式</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">特点描述</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">备注</th>
                            {visibleFields.map((field) => (
                              <th key={field.id} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                                {field.name}
                              </th>
                            ))}
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {selectedItem.processes.length === 0 ? (
                            <tr>
                              <td colSpan={6 + visibleFields.length} className="px-4 py-10 text-center text-gray-500">
                                暂无可选工艺{canCreate ? '，点击「添加工艺」开始配置' : ''}
                              </td>
                            </tr>
                          ) : (
                            selectedItem.processes.map((process, idx) => (
                              <tr key={process.id} className="hover:bg-gray-50">
                                <td className="px-4 py-4 text-sm font-medium text-gray-900">{process.name}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">¥{process.cost.toFixed(2)}</td>
                                <td className="px-4 py-4 text-sm text-gray-500">{process.formula || '—'}</td>
                                <td className="px-4 py-4 text-sm text-gray-500">{process.features || '—'}</td>
                                <td className="px-4 py-4 text-sm text-gray-500">{process.remark || '—'}</td>
                                {visibleFields.map((field) => (
                                  <td key={field.id} className="px-4 py-4 text-sm text-gray-500">
                                    {process.customValues[field.id] || '—'}
                                  </td>
                                ))}
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                                  {canEdit && selectedItem.processes.length > 1 && (
                                    <span className="inline-flex items-center gap-0.5 mr-1">
                                      <button
                                        onClick={() => moveProcess(process, 'up')}
                                        disabled={idx === 0}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                                        title="上移工艺"
                                      >
                                        <ChevronUp size={16} />
                                      </button>
                                      <button
                                        onClick={() => moveProcess(process, 'down')}
                                        disabled={idx === selectedItem.processes.length - 1}
                                        className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                                        title="下移工艺"
                                      >
                                        <ChevronDown size={16} />
                                      </button>
                                    </span>
                                  )}
                                  {canEdit && (
                                    <button
                                      onClick={() => handleEditProcess(process)}
                                      className="text-blue-600 hover:text-blue-900 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-blue-50"
                                      title="编辑"
                                    >
                                      <Edit2 size={18} />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      onClick={() => setDeleteTarget({ kind: 'process', itemId: selectedItem.id, id: process.id })}
                                      className="text-red-600 hover:text-red-900 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-50 ml-1"
                                      title="删除"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 自定义字段配置 */}
                  <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                      <div>
                        <h2 className="text-base sm:text-lg font-semibold text-gray-800 flex items-center gap-2">
                          <Settings2 size={18} className="text-gray-500" />
                          自定义字段配置 — {selectedItem.name}
                        </h2>
                        <p className="text-gray-400 text-xs sm:text-sm mt-1">
                          字段对该成本项下所有可选工艺生效；支持文本 / 数字 / 日期 / 下拉四种类型，可配置显示隐藏与排序
                        </p>
                      </div>
                      {canCreate && (
                        <button
                          onClick={handleCreateField}
                          className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm min-h-[40px] justify-center"
                        >
                          <Plus size={16} />
                          添加字段
                        </button>
                      )}
                    </div>

                    {showFieldForm && (
                      <div className="rounded-lg bg-gray-50 p-4 mb-4">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-sm font-semibold text-gray-700">
                            {editingField ? `编辑字段：${editingField.name}` : '新增自定义字段'}
                          </h3>
                          <button
                            onClick={() => setShowFieldForm(false)}
                            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100"
                            aria-label="关闭"
                          >
                            <X size={20} />
                          </button>
                        </div>
                        <form onSubmit={handleSubmitField} className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">字段名称 <span className="text-red-500">*</span></label>
                              <input
                                type="text"
                                value={fieldForm.name}
                                onChange={(e) => setFieldForm({ ...fieldForm, name: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                                placeholder="如：适用数量、最小起订量"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">字段类型</label>
                              <select
                                value={fieldForm.fieldType}
                                onChange={(e) => setFieldForm({ ...fieldForm, fieldType: e.target.value as ProductCostFieldType })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white"
                              >
                                {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {fieldForm.fieldType === 'select' && (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">下拉选项 <span className="text-red-500">*</span>（每行一个）</label>
                              <textarea
                                value={fieldForm.optionsText}
                                onChange={(e) => setFieldForm({ ...fieldForm, optionsText: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                placeholder={'如：\n小批量\n中批量\n大批量'}
                                rows={3}
                              />
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id="field-visible"
                              checked={fieldForm.visible}
                              onChange={(e) => setFieldForm({ ...fieldForm, visible: e.target.checked })}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="field-visible" className="text-sm text-gray-700">
                              显示该字段（隐藏字段不出现在工艺列表与编辑表单，已录入的值保留）
                            </label>
                          </div>
                          <div className="flex flex-col sm:flex-row justify-end gap-3">
                            <button
                              type="button"
                              onClick={() => setShowFieldForm(false)}
                              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 min-h-[44px]"
                            >
                              取消
                            </button>
                            <button
                              type="submit"
                              className="flex items-center gap-2 justify-center bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 min-h-[44px]"
                            >
                              <Save size={16} />
                              {editingField ? '保存修改' : '添加'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">字段名称</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">下拉选项</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">显示状态</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">排序</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {selectedItem.fields.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                                暂无自定义字段{canCreate ? '，点击「添加字段」为该成本项扩展工艺信息' : ''}
                              </td>
                            </tr>
                          ) : (
                            selectedItem.fields.map((field, idx) => (
                              <tr key={field.id} className={`hover:bg-gray-50 ${!field.visible ? 'opacity-60' : ''}`}>
                                <td className="px-4 py-4 text-sm font-medium text-gray-900">{field.name}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{FIELD_TYPE_LABELS[field.fieldType]}</td>
                                <td className="px-4 py-4 text-sm text-gray-500">
                                  {field.fieldType === 'select'
                                    ? (field.options.length > 0 ? field.options.join('、') : '—')
                                    : '—'}
                                </td>
                                <td className="px-4 py-4">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${field.visible ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {field.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                                    {field.visible ? '显示' : '隐藏'}
                                  </span>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-0.5">
                                    <button
                                      onClick={() => moveField(field.id, 'up')}
                                      disabled={idx === 0 || !canEdit}
                                      className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                                      title="上移"
                                    >
                                      <ChevronUp size={16} />
                                    </button>
                                    <button
                                      onClick={() => moveField(field.id, 'down')}
                                      disabled={idx === selectedItem.fields.length - 1 || !canEdit}
                                      className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded"
                                      title="下移"
                                    >
                                      <ChevronDown size={16} />
                                    </button>
                                  </span>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                                  {canEdit && (
                                    <button
                                      onClick={() => toggleFieldVisible(field)}
                                      className="text-amber-600 hover:text-amber-700 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-amber-50"
                                      title={field.visible ? '设为隐藏' : '设为显示'}
                                    >
                                      {field.visible ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                  )}
                                  {canEdit && (
                                    <button
                                      onClick={() => handleEditField(field)}
                                      className="text-blue-600 hover:text-blue-900 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-blue-50"
                                      title="编辑"
                                    >
                                      <Edit2 size={18} />
                                    </button>
                                  )}
                                  {canDelete && (
                                    <button
                                      onClick={() => setDeleteTarget({ kind: 'field', itemId: selectedItem.id, id: field.id })}
                                      className="text-red-600 hover:text-red-900 p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-50 ml-1"
                                      title="删除"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          entityId={deleteTarget.id}
          entityLabel={getDeleteHandlers(deleteTarget).label}
          deleteFn={getDeleteHandlers(deleteTarget).deleteFn}
          deleteCheckFn={getDeleteHandlers(deleteTarget).deleteCheckFn}
          onDeleted={handleDeleted}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
