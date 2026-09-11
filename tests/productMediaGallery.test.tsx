/**
 * 产品图册（ProductMediaGallery）单元测试
 *
 * 测试目标：
 *   1. 纯函数：formatFileSize（B/KB/MB/GB 与边界）、moveItemInArray（移动/越界/原位）
 *   2. 编辑模式：媒体按顺序展示（序号徽标 + 文件名 + 类型/大小）、上传按钮、
 *      删除（确认弹窗 → api 调用 → 刷新）、重排（前移/后移 → reorderMedia 传新顺序、失败回滚）
 *   3. 查看模式（readOnly）：无上传/删除/重排交互，媒体仍可浏览
 *   4. 全屏预览（双击触发）：打开/关闭、放大/缩小/重置、上一个/下一个切换、计数显示
 *   5. 空图册状态与加载失败提示
 *
 * Mock 策略：api（products.media 系列）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import ProductMediaGallery, {
  MediaFullscreenViewer,
  formatFileSize,
  moveItemInArray,
} from '../src/components/ProductMediaGallery'
import type { ProductMedia } from '../src/types'

// ============================ Mock 模块 ============================

const apiMock = vi.hoisted(() => ({
  products: {
    getMedia: vi.fn(),
    uploadMedia: vi.fn(),
    deleteMedia: vi.fn(),
    reorderMedia: vi.fn(),
    getMediaFileUrl: vi.fn((productId: string, mediaId: string) => `/api/products/${productId}/media/${mediaId}/file?token=t`),
  },
}))

vi.mock('../src/api', () => ({ api: apiMock }))

// ============================ 测试数据 ============================

function makeMedia(id: string, overrides: Partial<ProductMedia> = {}): ProductMedia {
  return {
    id,
    product_id: 'prod-1',
    media_type: 'image',
    file_name: `${id}.jpg`,
    file_path: `products/${id}.jpg`,
    file_size: 1024,
    mime_type: 'image/jpeg',
    sort_order: 0,
    created_at: '2026-09-11 08:00:00',
    updated_at: '2026-09-11 08:00:00',
    ...overrides,
  }
}

const mockMedia: ProductMedia[] = [
  makeMedia('m1', { sort_order: 0, file_name: '正面图.jpg' }),
  makeMedia('m2', { sort_order: 1, file_name: '背面图.jpg', file_size: 2048 * 1024 }),
  makeMedia('m3', { sort_order: 2, media_type: 'video' as const, file_name: '工艺演示.mp4', mime_type: 'video/mp4', file_size: 10 * 1024 * 1024 }),
]

// ============================ 渲染辅助 ============================

function renderGallery(props: { productId?: string; readOnly?: boolean } = {}) {
  return render(
    <ProductMediaGallery productId={props.productId || 'prod-1'} readOnly={props.readOnly} />,
  )
}

/** 获取第 index 个媒体卡片 */
const mediaItemAt = (index: number): HTMLElement => {
  const items = document.querySelectorAll('[data-testid="media-item"]')
  return items[index] as HTMLElement
}

/** 获取第 index 个媒体缩略图（双击全屏预览的挂载点） */
const thumbAt = (index: number): HTMLElement => {
  const thumbs = document.querySelectorAll('[data-testid="media-thumb"]')
  return thumbs[index] as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.products.getMedia.mockResolvedValue(mockMedia)
})

afterEach(() => {
  cleanup()
})

// ============================ 纯函数 ============================

describe('formatFileSize - 文件大小格式化', () => {
  it('字节级', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('KB/MB/GB', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(2048 * 1024)).toBe('2 MB')
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe('3 GB')
  })

  it('带一位小数的中间值', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('非法输入返回 0 B', () => {
    expect(formatFileSize(-1)).toBe('0 B')
    expect(formatFileSize(NaN)).toBe('0 B')
  })
})

describe('moveItemInArray - 数组元素移动', () => {
  it('后移', () => {
    expect(moveItemInArray(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('前移', () => {
    expect(moveItemInArray(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('相邻交换', () => {
    expect(moveItemInArray(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('越界/原位返回原数组', () => {
    expect(moveItemInArray(['a', 'b'], 0, 0)).toEqual(['a', 'b'])
    expect(moveItemInArray(['a', 'b'], -1, 1)).toEqual(['a', 'b'])
    expect(moveItemInArray(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })

  it('不修改原数组（返回新数组）', () => {
    const arr = ['a', 'b', 'c']
    moveItemInArray(arr, 0, 1)
    expect(arr).toEqual(['a', 'b', 'c'])
  })
})

// ============================ 图册组件 ============================

describe('ProductMediaGallery - 编辑模式', () => {
  it('媒体按接口返回顺序展示，含序号徽标/文件名/类型大小', async () => {
    renderGallery()
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })
    expect(screen.getByText('正面图.jpg')).toBeTruthy()
    expect(screen.getByText('背面图.jpg')).toBeTruthy()
    expect(screen.getByText('工艺演示.mp4')).toBeTruthy()
    // 类型与大小标注
    expect(screen.getByText('图片 · 1 KB')).toBeTruthy()
    expect(screen.getByText('图片 · 2 MB')).toBeTruthy()
    expect(screen.getByText('视频 · 10 MB')).toBeTruthy()
    // 序号徽标 1/2/3
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('显示上传按钮', async () => {
    renderGallery()
    expect(screen.getByText('上传图片/视频')).toBeTruthy()
  })

  it('上传成功后刷新列表', async () => {
    apiMock.products.getMedia.mockResolvedValueOnce([])
    apiMock.products.getMedia.mockResolvedValueOnce(mockMedia)
    apiMock.products.uploadMedia.mockResolvedValue([mockMedia[0]])
    renderGallery()

    await waitFor(() => {
      expect(screen.getByText('暂无图片/视频')).toBeTruthy()
    })

    const input = screen.getByTestId('media-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } })

    await waitFor(() => {
      expect(apiMock.products.uploadMedia).toHaveBeenCalledWith('prod-1', [expect.any(File)])
    })
    await waitFor(() => {
      expect(apiMock.products.getMedia).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByText('正面图.jpg')).toBeTruthy()
    })
  })

  it('上传失败显示错误提示', async () => {
    apiMock.products.getMedia.mockResolvedValueOnce([])
    apiMock.products.uploadMedia.mockRejectedValue(new Error('文件过大（单个文件上限 500MB）'))
    renderGallery()

    await waitFor(() => {
      expect(screen.getByText('暂无图片/视频')).toBeTruthy()
    })
    const input = screen.getByTestId('media-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'big.mp4', { type: 'video/mp4' })] } })

    await waitFor(() => {
      expect(screen.getByTestId('media-error').textContent).toContain('文件过大')
    })
  })

  it('删除：确认弹窗 → 调用 deleteMedia → 刷新', async () => {
    apiMock.products.deleteMedia.mockResolvedValue({ message: '删除成功' })
    apiMock.products.getMedia.mockResolvedValue(mockMedia)
    apiMock.products.getMedia.mockResolvedValueOnce(mockMedia).mockResolvedValueOnce([mockMedia[1], mockMedia[2]])
    renderGallery()

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })

    // 第一个卡片 hover 出现的删除按钮（title=删除）
    const item = mediaItemAt(0)
    const deleteBtn = item.querySelector('button[title="删除"]') as HTMLElement
    expect(deleteBtn).toBeTruthy()
    fireEvent.click(deleteBtn)

    // 确认弹窗
    expect(screen.getByText('删除媒体文件')).toBeTruthy()
    fireEvent.click(screen.getByTestId('media-delete-confirm'))

    await waitFor(() => {
      expect(apiMock.products.deleteMedia).toHaveBeenCalledWith('prod-1', 'm1')
    })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(2)
    })
  })

  it('重排：后移第一个媒体 → reorderMedia 收到新顺序', async () => {
    apiMock.products.reorderMedia.mockResolvedValue([
      mockMedia[1], { ...mockMedia[0], sort_order: 1 }, mockMedia[2],
    ])
    renderGallery()

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })

    const item = mediaItemAt(0)
    // 第一个媒体的前移按钮禁用
    const prevBtn = item.querySelector('button[title="前移"]') as HTMLButtonElement
    expect(prevBtn.disabled).toBe(true)
    const nextBtn = item.querySelector('button[title="后移"]') as HTMLElement
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(apiMock.products.reorderMedia).toHaveBeenCalledWith('prod-1', ['m2', 'm1', 'm3'])
    })
  })

  it('重排失败回滚本地顺序', async () => {
    apiMock.products.reorderMedia.mockRejectedValue(new Error('媒体排序列表必须与现有媒体完全一致'))
    renderGallery()

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })

    // 倒数第二个媒体后移（乐观更新为 m1,m3,m2，失败后回滚为 m1,m2,m3）
    const item = mediaItemAt(1)
    const nextBtn = item.querySelector('button[title="后移"]') as HTMLElement
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(apiMock.products.reorderMedia).toHaveBeenCalled()
    })
    // 回滚后顺序恢复 + 错误提示
    await waitFor(() => {
      expect(mediaItemAt(0).getAttribute('data-media-id')).toBe('m1')
      expect(mediaItemAt(1).getAttribute('data-media-id')).toBe('m2')
      expect(mediaItemAt(2).getAttribute('data-media-id')).toBe('m3')
    })
    await waitFor(() => {
      // 展示后端返回的错误信息（优于通用文案）
      expect(screen.getByTestId('media-error').textContent).toContain('媒体排序列表必须与现有媒体完全一致')
    })
  })

  it('空图册显示空状态', async () => {
    apiMock.products.getMedia.mockResolvedValue([])
    renderGallery()
    await waitFor(() => {
      expect(screen.getByText('暂无图片/视频')).toBeTruthy()
      expect(screen.getByText('点击右上方按钮上传，支持多选')).toBeTruthy()
    })
  })

  it('加载失败显示错误提示', async () => {
    apiMock.products.getMedia.mockRejectedValue(new Error('网络错误'))
    renderGallery()
    await waitFor(() => {
      expect(screen.getByTestId('media-error').textContent).toContain('网络错误')
    })
  })
})

describe('ProductMediaGallery - 查看模式（readOnly）', () => {
  it('媒体仍展示，但无上传/删除/重排交互', async () => {
    renderGallery({ readOnly: true })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })
    // 无上传按钮
    expect(screen.queryByText('上传图片/视频')).toBeNull()
    expect(screen.queryByTestId('media-file-input')).toBeNull()
    // 无删除/重排按钮
    expect(document.querySelectorAll('button[title="删除"]').length).toBe(0)
    expect(document.querySelectorAll('button[title="前移"]').length).toBe(0)
    expect(document.querySelectorAll('button[title="后移"]').length).toBe(0)
  })

  it('查看模式双击媒体仍可全屏预览', async () => {
    renderGallery({ readOnly: true })
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })
    fireEvent.dblClick(thumbAt(0))
    await waitFor(() => {
      expect(screen.getByTestId('media-fullscreen-viewer')).toBeTruthy()
    })
  })
})

// ============================ 全屏预览器 ============================

describe('MediaFullscreenViewer - 全屏预览', () => {
  function renderViewer(initialIndex = 0) {
    return render(
      <MediaFullscreenViewer
        items={mockMedia}
        initialIndex={initialIndex}
        getIndexUrl={(m) => apiMock.products.getMediaFileUrl('prod-1', m.id)}
        onClose={() => {}}
      />,
    )
  }

  it('显示当前文件名与计数', () => {
    renderViewer(0)
    expect(screen.getByTestId('viewer-counter').textContent).toBe('1 / 3')
    expect(screen.getByText('正面图.jpg')).toBeTruthy()
  })

  it('下一个/上一个切换媒体（计数联动）', () => {
    renderViewer(0)
    fireEvent.click(screen.getByTestId('viewer-next'))
    expect(screen.getByTestId('viewer-counter').textContent).toBe('2 / 3')
    expect(screen.getByText('背面图.jpg')).toBeTruthy()
    fireEvent.click(screen.getByTestId('viewer-next'))
    expect(screen.getByTestId('viewer-counter').textContent).toBe('3 / 3')
    // 已是最后一个：next 禁用
    expect((screen.getByTestId('viewer-next') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('viewer-prev'))
    expect(screen.getByTestId('viewer-counter').textContent).toBe('2 / 3')
    // 回到第一个：prev 禁用
    fireEvent.click(screen.getByTestId('viewer-prev'))
    expect((screen.getByTestId('viewer-prev') as HTMLButtonElement).disabled).toBe(true)
  })

  it('图片放大/缩小/重置（按钮）', () => {
    renderViewer(0)
    expect(screen.getByTestId('viewer-scale').textContent).toBe('100%')
    fireEvent.click(screen.getByTestId('viewer-zoom-in'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('150%')
    fireEvent.click(screen.getByTestId('viewer-zoom-in'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('200%')
    fireEvent.click(screen.getByTestId('viewer-zoom-out'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('150%')
    fireEvent.click(screen.getByTestId('viewer-reset'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('100%')
  })

  it('缩放边界：最小 100%、最大 500%', () => {
    renderViewer(0)
    // 缩到最小以下
    fireEvent.click(screen.getByTestId('viewer-zoom-out'))
    fireEvent.click(screen.getByTestId('viewer-zoom-out'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('100%')
    // 放到最大以上
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByTestId('viewer-zoom-in'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('500%')
  })

  it('切换媒体时重置缩放', () => {
    renderViewer(0)
    fireEvent.click(screen.getByTestId('viewer-zoom-in'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('150%')
    fireEvent.click(screen.getByTestId('viewer-next'))
    expect(screen.getByTestId('viewer-scale').textContent).toBe('100%')
  })

  it('视频媒体：不显示缩放工具栏，渲染 video 元素', () => {
    renderViewer(2)
    expect(screen.queryByTestId('viewer-zoom-in')).toBeNull()
    expect(screen.queryByTestId('viewer-zoom-out')).toBeNull()
    expect(document.querySelector('video')).toBeTruthy()
  })

  it('从图册双击打开：关闭后回到图册', async () => {
    renderGallery()
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
    })
    fireEvent.dblClick(thumbAt(1))
    await waitFor(() => {
      expect(screen.getByTestId('media-fullscreen-viewer')).toBeTruthy()
    })
    expect(screen.getByTestId('viewer-counter').textContent).toBe('2 / 3')

    fireEvent.click(screen.getByTestId('viewer-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('media-fullscreen-viewer')).toBeNull()
    })
    // 图册仍在
    expect(document.querySelectorAll('[data-testid="media-item"]').length).toBe(3)
  })

  it('键盘操作：Esc 关闭 / 方向键切换 / +- 缩放', () => {
    const onClose = vi.fn()
    render(
      <MediaFullscreenViewer
        items={mockMedia}
        initialIndex={0}
        getIndexUrl={(m) => `/api/products/prod-1/media/${m.id}/file`}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('viewer-counter').textContent).toBe('2 / 3')
    fireEvent.keyDown(window, { key: '+' })
    expect(screen.getByTestId('viewer-scale').textContent).toBe('150%')
    fireEvent.keyDown(window, { key: '-' })
    expect(screen.getByTestId('viewer-scale').textContent).toBe('100%')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
