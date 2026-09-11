/**
 * 产品图册（v32）：
 *   - 上传产品图片/视频（原文件存储，不压缩；后端保留原始质量与分辨率）
 *   - 按上传顺序或自定义排序展示（sort_order，支持前移/后移重排）
 *   - 媒体的预览（双击全屏）、删除、重新排序
 *   - readOnly（产品详情查看模式）：隐藏全部编辑交互，仅保留浏览与双击全屏预览
 *
 * 全屏预览器 MediaFullscreenViewer：
 *   - 双击媒体触发；图片支持放大/缩小（按钮/滚轮/双击切换）、拖拽平移、重置
 *   - 视频原生 controls 播放（支持进度拖动）
 *   - 左右切换（按钮/键盘方向键）、Esc 关闭、计数显示
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Upload, Trash2, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Maximize2,
  ImageIcon, Film, Loader2,
} from 'lucide-react'
import { api } from '../api'
import type { ProductMedia } from '../types'

/** 格式化文件大小（整数值不带小数，如 1 KB / 1.5 KB / 10 MB） */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const text = unit === 0 || value >= 100
    ? String(Math.round(value))
    : value.toFixed(1).replace(/\.0$/, '')
  return `${text} ${units[unit]}`
}

/** 数组内移动元素（重排的纯操作） */
export function moveItemInArray<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return arr
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

interface GalleryProps {
  productId: string
  /** 查看模式：隐藏上传/删除/重排等编辑交互 */
  readOnly?: boolean
}

export default function ProductMediaGallery({ productId, readOnly = false }: GalleryProps) {
  const [media, setMedia] = useState<ProductMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ProductMedia | null>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await api.products.getMedia(id)
      setMedia((data as ProductMedia[]) || [])
      setError('')
    } catch (err) {
      setError((err as Error).message || '加载图册失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    refresh(productId)
  }, [productId, refresh])

  // 预览打开时同步最新媒体列表，删除后索引自动修正
  useEffect(() => {
    if (previewIndex != null && previewIndex >= media.length) {
      setPreviewIndex(media.length > 0 ? media.length - 1 : null)
    }
  }, [media.length, previewIndex])

  const handleSelectFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      await api.products.uploadMedia(productId, Array.from(files))
      await refresh(productId)
    } catch (err) {
      setError((err as Error).message || '上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /** 重排：本地立即生效（乐观更新），失败回滚并提示 */
  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= media.length) return
    const next = moveItemInArray(media, index, target)
    const prev = media
    setMedia(next)
    try {
      const data = await api.products.reorderMedia(productId, next.map((m) => m.id))
      setMedia((data as ProductMedia[]) || next)
    } catch (err) {
      setMedia(prev)
      setError((err as Error).message || '调整顺序失败')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.products.deleteMedia(productId, deleteTarget.id)
      setDeleteTarget(null)
      await refresh(productId)
    } catch (err) {
      setError((err as Error).message || '删除失败')
    }
  }

  const mediaUrl = (m: ProductMedia) => api.products.getMediaFileUrl(productId, m.id)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <ImageIcon size={18} className="text-primary-600" />
            产品图册
            {media.length > 0 && (
              <span className="text-xs font-normal text-gray-500">（{media.length} 个图片/视频）</span>
            )}
          </h3>
          <p className="text-xs text-gray-400 mt-1">
            保留原始文件质量与分辨率（不压缩）；双击图片/视频可全屏预览
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              data-testid="media-file-input"
              onChange={(e) => handleSelectFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 bg-primary-600 text-white px-3 py-2 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px] text-sm"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {uploading ? '上传中...' : '上传图片/视频'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" data-testid="media-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400">
          <Loader2 size={28} className="animate-spin inline-block mb-2" />
          <p className="text-sm">加载图册...</p>
        </div>
      ) : media.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl py-10 text-center">
          <ImageIcon size={40} className="text-gray-300 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">暂无图片/视频</p>
          {!readOnly && <p className="text-gray-400 text-xs mt-1">点击右上方按钮上传，支持多选</p>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {media.map((m, index) => (
            <div
              key={m.id}
              className="group relative bg-gray-50 rounded-lg border border-gray-100 overflow-hidden"
              data-testid="media-item"
              data-media-id={m.id}
              data-media-index={index}
            >
              {/* 缩略图：双击全屏预览（查看/编辑模式均可） */}
              <div
                data-testid="media-thumb"
                className="relative aspect-square bg-white cursor-zoom-in flex items-center justify-center"
                title="双击全屏预览"
                onDoubleClick={() => setPreviewIndex(index)}
              >
                {m.media_type === 'video' ? (
                  <>
                    <video
                      src={mediaUrl(m)}
                      className="w-full h-full object-contain"
                      preload="metadata"
                      muted
                      playsInline
                    />
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="bg-black/50 rounded-full p-2.5">
                        <Film size={20} className="text-white" />
                      </span>
                    </span>
                  </>
                ) : (
                  <img
                    src={mediaUrl(m)}
                    alt={m.file_name}
                    className="w-full h-full object-contain"
                    loading="lazy"
                  />
                )}
                {/* 序号徽标（展示当前排序位置） */}
                <span className="absolute top-1.5 left-1.5 bg-black/55 text-white text-xs px-1.5 py-0.5 rounded">
                  {index + 1}
                </span>
              </div>

              {/* 文件信息 */}
              <div className="px-2 py-1.5">
                <p className="text-xs text-gray-700 truncate" title={m.file_name}>{m.file_name}</p>
                <p className="text-[11px] text-gray-400">
                  {m.media_type === 'video' ? '视频' : '图片'} · {formatFileSize(m.file_size)}
                </p>
              </div>

              {/* 编辑操作（仅编辑模式）：前移/后移/删除 */}
              {!readOnly && (
                <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0}
                    title="前移"
                    className="bg-white/90 hover:bg-white text-gray-600 rounded p-1 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(index, 1)}
                    disabled={index === media.length - 1}
                    title="后移"
                    className="bg-white/90 hover:bg-white text-gray-600 rounded p-1 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(m)}
                    title="删除"
                    className="bg-white/90 hover:bg-red-50 text-red-500 rounded p-1 shadow-sm"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 删除确认 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold text-gray-800 mb-2">删除媒体文件</h4>
            <p className="text-sm text-gray-600 mb-1">确定要删除「{deleteTarget.file_name}」吗？</p>
            <p className="text-xs text-gray-400 mb-4">删除后将从图册移除，且不可恢复。</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
                data-testid="media-delete-confirm"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全屏预览（查看/编辑模式均可双击触发） */}
      {previewIndex != null && media.length > 0 && (
        <MediaFullscreenViewer
          items={media}
          initialIndex={previewIndex}
          getIndexUrl={(m) => mediaUrl(m)}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  )
}

// ============================================================
// 全屏预览器
// ============================================================

interface ViewerProps {
  items: ProductMedia[]
  initialIndex: number
  /** 生成媒体访问 URL（带 token） */
  getIndexUrl: (m: ProductMedia) => string
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 5

export function MediaFullscreenViewer({ items, initialIndex, getIndexUrl, onClose }: ViewerProps) {
  const [index, setIndex] = useState(initialIndex)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  // 缩放当前值镜像（zoomBy 需要读取最新 scale 计算锚点平移，避免在 setState 更新器内做副作用）
  const scaleRef = useRef(1)
  const current = items[index]

  // 切换媒体时重置缩放/位移
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [index])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : i)), [])
  const goNext = useCallback(() => setIndex((i) => (i < items.length - 1 ? i + 1 : i)), [items.length])

  const zoomBy = useCallback((delta: number, anchor?: { x: number; y: number }) => {
    const s = scaleRef.current
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(s + delta).toFixed(2)))
    if (next === s) return
    if (next === MIN_SCALE) {
      setScale(next)
      setOffset({ x: 0, y: 0 })
      return
    }
    if (anchor && delta > 0) {
      // 以指针位置为锚点放大（简单近似：按指针偏移中心的比例平移）
      setOffset((o) => ({
        x: o.x - (anchor.x - window.innerWidth / 2) * (delta / s) * 0.5,
        y: o.y - (anchor.y - window.innerHeight / 2) * (delta / s) * 0.5,
      }))
    }
    setScale(next)
  }, [])

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  // 键盘：Esc 关闭 / 左右切换 / +- 缩放 / 0 重置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
      else if (e.key === '+' || e.key === '=') zoomBy(0.5)
      else if (e.key === '-') zoomBy(-0.5)
      else if (e.key === '0') resetView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, goPrev, goNext, zoomBy, resetView])

  if (!current) return null

  const isImage = current.media_type !== 'video'

  const onPointerDown = (e: React.PointerEvent) => {
    if (!isImage || scale <= MIN_SCALE) return
    dragState.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragState.current
    if (!d) return
    setOffset({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) })
  }
  const onPointerUp = () => { dragState.current = null }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col select-none"
      data-testid="media-fullscreen-viewer"
      role="dialog"
      aria-label="媒体全屏预览"
    >
      {/* 顶部栏：文件名 + 计数 + 关闭 */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-sm truncate" title={current.file_name}>{current.file_name}</p>
          <p className="text-xs text-white/60">{formatFileSize(current.file_size)} · {isImage ? '图片' : '视频'}</p>
        </div>
        <span className="text-sm text-white/80 shrink-0" data-testid="viewer-counter">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="关闭（Esc）"
          className="p-2 hover:bg-white/10 rounded-lg shrink-0"
          data-testid="viewer-close"
        >
          <X size={22} />
        </button>
      </div>

      {/* 中央内容区 */}
      <div className="relative flex-1 overflow-hidden flex items-center justify-center">
        {/* 左右切换 */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              title="上一个（←）"
              className="absolute left-3 z-10 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="viewer-prev"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={index === items.length - 1}
              title="下一个（→）"
              className="absolute right-3 z-10 p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="viewer-next"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}

        {isImage ? (
          <img
            src={getIndexUrl(current)}
            alt={current.file_name}
            className="max-w-full max-h-full object-contain"
            draggable={false}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              cursor: scale > MIN_SCALE ? 'grab' : 'zoom-in',
              transition: dragState.current ? 'none' : 'transform 0.15s ease-out',
            }}
            onWheel={(e) => {
              e.preventDefault()
              zoomBy(e.deltaY < 0 ? 0.25 : -0.25, { x: e.clientX, y: e.clientY })
            }}
            onDoubleClick={() => (scale > MIN_SCALE ? resetView() : setScale(2))}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        ) : (
          <video
            key={current.id}
            src={getIndexUrl(current)}
            controls
            autoPlay
            className="max-w-[92vw] max-h-[82vh]"
          />
        )}
      </div>

      {/* 底部工具栏：缩放控制（图片）/ 提示 */}
      <div className="flex items-center justify-center gap-2 px-4 py-3">
        {isImage && (
          <>
            <button
              type="button"
              onClick={() => zoomBy(-0.5)}
              disabled={scale <= MIN_SCALE}
              title="缩小（-）"
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="viewer-zoom-out"
            >
              <ZoomOut size={20} />
            </button>
            <span className="text-white/80 text-sm min-w-[3.5rem] text-center" data-testid="viewer-scale">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomBy(0.5)}
              disabled={scale >= MAX_SCALE}
              title="放大（+）"
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="viewer-zoom-in"
            >
              <ZoomIn size={20} />
            </button>
            <button
              type="button"
              onClick={resetView}
              disabled={scale === MIN_SCALE && offset.x === 0 && offset.y === 0}
              title="重置（0）"
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="viewer-reset"
            >
              <Maximize2 size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
