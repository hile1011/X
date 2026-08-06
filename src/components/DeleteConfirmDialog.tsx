/**
 * 通用删除确认对话框
 *
 * 功能：
 *   1. 展示待删除数据的关键信息（ID、名称、详情）
 *   2. 自动调用 delete-check API 检测关联关系
 *   3. 若存在阻断性关联，阻止删除并展示具体关联信息
 *   4. 提供"确认删除"和"取消"按钮
 *   5. 删除操作有 loading 状态，防止重复提交
 *
 * 用法：
 *   <DeleteConfirmDialog
 *     entityType="customer"
 *     entityId={id}
 *     entityLabel="客户"
 *     deleteFn={(id) => api.customers.delete(id)}
 *     deleteCheckFn={(id) => api.customers.deleteCheck(id)}
 *     onDeleted={() => refreshList()}
 *     onClose={() => setShowDialog(null)}
 *   />
 */
import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, Trash2, X, Loader2, ShieldAlert, Link2 } from 'lucide-react'

export interface DeleteCheckResult {
  canDelete: boolean
  entityInfo: {
    id: string
    name: string
    type: string
    details: string
  }
  relationships: Array<{
    table: string
    description: string
    count: number
    samples: Array<Record<string, any>>
  }>
}

interface DeleteConfirmDialogProps {
  entityId: string
  entityLabel: string              // 实体显示名称（如"客户"、"产品"、"报价"）
  deleteFn: (id: string) => Promise<any>
  deleteCheckFn: (id: string) => Promise<DeleteCheckResult>
  onDeleted: () => void
  onClose: () => void
}

export function DeleteConfirmDialog({
  entityId,
  entityLabel,
  deleteFn,
  deleteCheckFn,
  onDeleted,
  onClose,
}: DeleteConfirmDialogProps) {
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [checkResult, setCheckResult] = useState<DeleteCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 加载删除检查结果
  const loadCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await deleteCheckFn(entityId)
      setCheckResult(result)
    } catch (err: any) {
      setError(err.message || '检查关联关系失败')
    } finally {
      setLoading(false)
    }
  }, [entityId, deleteCheckFn])

  useEffect(() => {
    loadCheck()
  }, [loadCheck])

  // 执行删除
  const handleConfirmDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteFn(entityId)
      onDeleted()
      onClose()
    } catch (err: any) {
      setError(err.message || '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const canDelete = checkResult?.canDelete ?? false

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${canDelete ? 'bg-red-50' : 'bg-amber-50'}`}>
              {canDelete ? (
                <AlertTriangle className="h-5 w-5 text-red-600" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-amber-600" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-800">
              {canDelete ? '确认删除' : '无法删除'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">正在检查关联关系...</span>
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
              {error}
            </div>
          ) : checkResult ? (
            <>
              {/* 实体信息 */}
              <div className="mb-4 rounded-lg bg-gray-50 p-4">
                <div className="text-sm text-gray-500 mb-1">{entityLabel}名称</div>
                <div className="text-base font-semibold text-gray-800">
                  {checkResult.entityInfo.name}
                </div>
                {checkResult.entityInfo.details && (
                  <div className="mt-2 text-xs text-gray-500">
                    {checkResult.entityInfo.details}
                  </div>
                )}
                <div className="mt-2 text-xs text-gray-400">
                  ID: {checkResult.entityInfo.id}
                </div>
              </div>

              {/* 关联关系信息 */}
              {checkResult.relationships.length > 0 ? (
                <div>
                  <div className={`mb-3 flex items-start gap-2 rounded-lg p-3 ${canDelete ? 'bg-blue-50' : 'bg-amber-50'}`}>
                    <Link2 className={`mt-0.5 h-4 w-4 flex-shrink-0 ${canDelete ? 'text-blue-600' : 'text-amber-600'}`} />
                    <div className="text-sm">
                      {canDelete ? (
                        <span className="text-blue-700">该数据存在以下关联信息，删除后请留意影响：</span>
                      ) : (
                        <span className="text-amber-700">该数据存在以下关联关系，<strong>无法删除</strong>。请先解除关联后再尝试：</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {checkResult.relationships.map((rel, idx) => (
                      <div key={idx} className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{rel.table}</span>
                          <span>{rel.description}</span>
                        </div>
                        {rel.samples.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {rel.samples.map((sample, sIdx) => (
                              <div key={sIdx} className="text-xs text-gray-500 pl-4">
                                {Object.entries(sample)
                                  .filter(([k]) => !['created_at', 'updated_at'].includes(k))
                                  .slice(0, 4)
                                  .map(([k, v]) => `${k}: ${v ?? '-'}`)
                                  .join(' | ')}
                              </div>
                            ))}
                            {rel.count > rel.samples.length && (
                              <div className="text-xs text-gray-400 pl-4">
                                ...等共 {rel.count} 条
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : canDelete ? (
                <div className="rounded-lg bg-red-50 p-4">
                  <p className="text-sm text-red-700">
                    确定要删除此{entityLabel}吗？此操作不可撤销，删除后数据将无法恢复。
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirmDelete}
            disabled={!canDelete || deleting || loading}
            className={`flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors ${
              canDelete && !deleting
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                删除中...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                确认删除
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
