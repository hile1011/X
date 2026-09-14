/**
 * 拖拽图片多路提取单元测试（src/utils/dropImageExtract.ts）
 *
 * 覆盖：
 *   - dataUrlToFile：合法/非法 dataURL 转 File
 *   - extractImgSrcs：html img src 提取（http/data 分流、无 src 跳过、解析失败安全）
 *   - extractUrlsFromText：uri-list（注释行）与纯文本 URL 提取
 *   - fetchImageAsFile：浏览器直连成功 / 直连失败走后端代理 / 代理失败抛错
 *   - extractImageFilesFromDataTransfer：files 优先、html data: 本地解码、
 *     http URL 下载、去重与上限、getData 异常兜底
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock 前端 api 客户端：只用到 upload.fetchImage（后端代理兜底）
const fetchImageMock = vi.fn()
vi.mock('../src/api', () => ({
  api: { upload: { fetchImage: (...args: unknown[]) => fetchImageMock(...args) } },
}))

import {
  dataUrlToFile,
  extractImgSrcs,
  extractUrlsFromText,
  fetchImageAsFile,
  extractImageFilesFromDataTransfer,
  MAX_URLS_PER_DROP,
} from '../src/utils/dropImageExtract'

/** 最小 PNG 文件头（magic bytes） */
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

/** 伪造 drop 事件的 DataTransfer（jsdom 无 DataTransfer 构造器） */
function fakeDataTransfer(opts: {
  files?: File[]
  html?: string
  uriList?: string
  plain?: string
  throwOnGetData?: boolean
}): DataTransfer {
  const data: Record<string, string> = {
    'text/html': opts.html ?? '',
    'text/uri-list': opts.uriList ?? '',
    'text/plain': opts.plain ?? '',
  }
  return {
    files: (opts.files ?? []) as unknown as FileList,
    getData: (type: string) => {
      if (opts.throwOnGetData) throw new Error('detached')
      return data[type] ?? ''
    },
  } as unknown as DataTransfer
}

/** 构造 png dataURL */
function pngDataUrl(bytes: Uint8Array = PNG_HEADER): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(bin)}`
}

/** 伪造直连 fetch 响应 */
function okImageResponse(type = 'image/png', bytes: Uint8Array = PNG_HEADER) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': type }),
    blob: async () => new Blob([bytes as BlobPart], { type }),
    arrayBuffer: async () => bytes.buffer,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  fetchImageMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ============================================================
// dataUrlToFile
// ============================================================
describe('dataUrlToFile', () => {
  it('合法图片 dataURL 转 File（类型/文件名/内容）', () => {
    const file = dataUrlToFile(pngDataUrl(), 'photo.png')
    expect(file.type).toBe('image/png')
    expect(file.name).toBe('photo.png')
    expect(file.size).toBe(PNG_HEADER.length)
  })

  it('无扩展名文件名自动补全扩展名', () => {
    const file = dataUrlToFile(pngDataUrl(), 'dropped-1')
    expect(file.name).toBe('dropped-1.png')
  })

  it('非 dataURL / 非图片类型抛错', () => {
    expect(() => dataUrlToFile('https://example.com/a.png')).toThrow()
    const textDataUrl = `data:text/plain;base64,${btoa('hi')}`
    expect(() => dataUrlToFile(textDataUrl)).toThrow()
  })
})

// ============================================================
// extractImgSrcs
// ============================================================
describe('extractImgSrcs', () => {
  it('提取 http 与 data: 图片 src 并分流，跳过无 src', () => {
    const html = `
      <meta charset="utf-8">
      <img src="https://cbu01.alicdn.com/img/ibank/a.jpg">
      <img src="${pngDataUrl()}">
      <img data-lazy="x">
      <img src="javascript:alert(1)">
    `
    const { httpUrls, dataUrls } = extractImgSrcs(html)
    expect(httpUrls).toEqual(['https://cbu01.alicdn.com/img/ibank/a.jpg'])
    expect(dataUrls).toHaveLength(1)
    expect(dataUrls[0].startsWith('data:image/png;base64,')).toBe(true)
  })

  it('空 html / 非 html 内容返回空数组', () => {
    expect(extractImgSrcs('')).toEqual({ httpUrls: [], dataUrls: [] })
    expect(extractImgSrcs('普通文字')).toEqual({ httpUrls: [], dataUrls: [] })
  })
})

// ============================================================
// extractUrlsFromText
// ============================================================
describe('extractUrlsFromText', () => {
  it('uri-list：多 URL + 注释行 + 非 http 忽略', () => {
    const uriList = [
      '#comment line',
      'https://img.example.com/1.jpg',
      'https://img.example.com/2.png',
      'ftp://x/y',
    ].join('\r\n')
    expect(extractUrlsFromText(uriList, '')).toEqual([
      'https://img.example.com/1.jpg',
      'https://img.example.com/2.png',
    ])
  })

  it('plain：单个 URL 采纳，含空格的文本不采纳', () => {
    expect(extractUrlsFromText('', 'https://a.com/x.jpg')).toEqual(['https://a.com/x.jpg'])
    expect(extractUrlsFromText('', '看这个 https://a.com/x.jpg 好看')).toEqual([])
    expect(extractUrlsFromText('', '普通描述文字')).toEqual([])
  })
})

// ============================================================
// fetchImageAsFile：直连 → 代理兜底
// ============================================================
describe('fetchImageAsFile', () => {
  it('浏览器直连成功：不调后端代理', async () => {
    fetchMock.mockResolvedValue(okImageResponse())
    const file = await fetchImageAsFile('https://cbu01.alicdn.com/img/ibank/123.jpg')
    expect(file.type).toBe('image/png')
    expect(file.name).toBe('123.jpg')
    expect(fetchImageMock).not.toHaveBeenCalled()
  })

  it('直连返回非图片（如防盗链 HTML 页）：走后端代理', async () => {
    fetchMock.mockResolvedValue(okImageResponse('text/html'))
    fetchImageMock.mockResolvedValue({ dataUrl: pngDataUrl(), contentType: 'image/png' })
    const file = await fetchImageAsFile('https://img.example.com/a.jpg')
    expect(fetchImageMock).toHaveBeenCalledWith('https://img.example.com/a.jpg')
    expect(file.type).toBe('image/png')
  })

  it('直连 CORS 抛错：走后端代理', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    fetchImageMock.mockResolvedValue({ dataUrl: pngDataUrl(), contentType: 'image/png' })
    const file = await fetchImageAsFile('https://img.example.com/a.jpg')
    expect(file.type).toBe('image/png')
  })

  it('直连 403：走后端代理', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, headers: new Headers() })
    fetchImageMock.mockResolvedValue({ dataUrl: pngDataUrl() })
    const file = await fetchImageAsFile('https://img.example.com/a.jpg')
    expect(file.type).toBe('image/png')
  })

  it('代理也失败：抛错（由上层捕获跳过）', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    fetchImageMock.mockRejectedValue(new Error('图片源响应 403'))
    await expect(fetchImageAsFile('https://img.example.com/a.jpg')).rejects.toThrow('403')
  })
})

// ============================================================
// extractImageFilesFromDataTransfer：drop 事件多路提取
// ============================================================
describe('extractImageFilesFromDataTransfer', () => {
  it('files 有图片：直接返回，不发任何网络请求（微信/本地场景）', async () => {
    const imgFile = new File([PNG_HEADER], 'wx.png', { type: 'image/png' })
    const zipFile = new File([new ArrayBuffer(4)], 'a.zip', { type: 'application/zip' })
    const files = await extractImageFilesFromDataTransfer(
      fakeDataTransfer({ files: [imgFile, zipFile], html: '<img src="https://x/1.jpg">' }),
    )
    expect(files).toEqual([imgFile]) // 非图片文件被过滤，html 里的 URL 不再处理
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fetchImageMock).not.toHaveBeenCalled()
  })

  it('网页图片（1688 场景）：html img src → 直连下载为 File', async () => {
    fetchMock.mockResolvedValue(okImageResponse())
    const dt = fakeDataTransfer({
      html: '<img src="https://cbu01.alicdn.com/img/ibank/abc.jpg">',
    })
    const files = await extractImageFilesFromDataTransfer(dt)
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('abc.jpg')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cbu01.alicdn.com/img/ibank/abc.jpg',
      expect.objectContaining({ referrerPolicy: 'no-referrer' }),
    )
  })

  it('uri-list / plain 中的 URL 也被提取', async () => {
    fetchMock.mockResolvedValue(okImageResponse())
    const files = await extractImageFilesFromDataTransfer(fakeDataTransfer({
      uriList: 'https://a.example.com/u1.jpg',
      plain: 'https://b.example.com/u2.png',
    }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(files).toHaveLength(2)
  })

  it('html 内嵌 data: 图片本地解码，不发网络请求', async () => {
    const files = await extractImageFilesFromDataTransfer(fakeDataTransfer({
      html: `<img src="${pngDataUrl()}">`,
    }))
    expect(files).toHaveLength(1)
    expect(files[0].type).toBe('image/png')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('html 与 uri-list 重复 URL 去重', async () => {
    fetchMock.mockResolvedValue(okImageResponse())
    const url = 'https://img.example.com/dup.jpg'
    const files = await extractImageFilesFromDataTransfer(fakeDataTransfer({
      html: `<img src="${url}">`,
      uriList: url,
      plain: url,
    }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(files).toHaveLength(1)
  })

  it('URL 数量超过上限时截断', async () => {
    fetchMock.mockResolvedValue(okImageResponse())
    const urls = Array.from({ length: MAX_URLS_PER_DROP + 5 }, (_, i) => `https://x.example.com/${i}.jpg`)
    const files = await extractImageFilesFromDataTransfer(fakeDataTransfer({
      uriList: urls.join('\n'),
    }))
    expect(fetchMock).toHaveBeenCalledTimes(MAX_URLS_PER_DROP)
    expect(files).toHaveLength(MAX_URLS_PER_DROP)
  })

  it('单个 URL 下载失败不影响其余', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers() })
      .mockResolvedValueOnce(okImageResponse())
    fetchImageMock.mockRejectedValue(new Error('代理也失败'))
    const files = await extractImageFilesFromDataTransfer(fakeDataTransfer({
      uriList: 'https://a.example.com/1.jpg\nhttps://b.example.com/2.jpg',
    }))
    expect(files).toHaveLength(1)
  })

  it('无任何图片数据（纯文字拖拽）返回空数组', async () => {
    const files = await extractImageFilesFromDataTransfer(fakeDataTransfer({
      plain: '随便一段文字',
    }))
    expect(files).toEqual([])
  })

  it('getData 抛错（dataTransfer 已分离）：仍能返回 files', async () => {
    const imgFile = new File([PNG_HEADER], 'x.png', { type: 'image/png' })
    const files = await extractImageFilesFromDataTransfer(
      fakeDataTransfer({ files: [imgFile], throwOnGetData: true }),
    )
    expect(files).toEqual([imgFile])
  })

  it('dt 为 null 返回空数组', async () => {
    expect(await extractImageFilesFromDataTransfer(null)).toEqual([])
  })
})
