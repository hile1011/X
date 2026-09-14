/**
 * 拖拽图片多路提取（订单编辑页产品图等上传场景）
 *
 * 不同平台拖出的数据形态不同：
 *   - 微信/钉钉/QQ/本地文件/截图：dataTransfer.files 有 File 对象（现有链路，直接可用）
 *   - 1688/淘宝/京东等网页 <img>：files 为空，图片 URL 在 text/html（<img src>）或
 *     text/uri-list / text/plain 中，需经网络下载为 File
 *
 * 提取优先级：files → html 内嵌 data: 图片 → http(s) URL（浏览器直连 → 后端代理兜底）。
 * 注意：dataTransfer 在 drop 事件返回后会被浏览器清空，必须在同步阶段捕获全部数据。
 */
import { api } from '../api'

/** 单次拖拽最多识别的图片 URL 数（防止拖整页相册时请求数失控） */
export const MAX_URLS_PER_DROP = 9
/** 与后端 MAX_IMAGE_BYTES 保持一致的直连大小上限 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** dataURL（data:image/png;base64,...）转 File */
export function dataUrlToFile(dataUrl: string, filename = 'dropped-image'): File {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.*)$/s)
  if (!m) throw new Error('无效的图片 dataURL')
  const mime = m[1]
  if (!mime.startsWith('image/')) throw new Error('dataURL 不是图片类型')
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ext = mime.split('/')[1]?.split('+')[0] || 'png'
  const name = /\.[a-z0-9]{2,5}$/i.test(filename) ? filename : `${filename}.${ext}`
  return new File([bytes], name, { type: mime })
}

/** 从图片 URL 提取文件名（无扩展名时返回空串） */
function filenameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || ''
    return decodeURIComponent(last).slice(0, 80)
  } catch {
    return ''
  }
}

/** 从 text/html 提取图片 src 列表（http(s) 与 data: 分开返回） */
export function extractImgSrcs(html: string): { httpUrls: string[]; dataUrls: string[] } {
  const httpUrls: string[] = []
  const dataUrls: string[] = []
  if (!html) return { httpUrls, dataUrls }
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      const src = (img.getAttribute('src') || '').trim()
      if (!src) continue
      if (/^https?:\/\//i.test(src)) httpUrls.push(src)
      else if (/^data:image\//i.test(src)) dataUrls.push(src)
    }
  } catch {
    // HTML 解析失败：静默忽略（html 内容不受我们控制）
  }
  return { httpUrls, dataUrls }
}

/** 从 text/uri-list 与 text/plain 提取 http(s) URL（uri-list 的 # 行是注释） */
export function extractUrlsFromText(uriList: string, plain: string): string[] {
  const urls: string[] = []
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) {
      const t = line.trim()
      if (t && !t.startsWith('#') && /^https?:\/\//i.test(t)) urls.push(t)
    }
  }
  if (plain) {
    const t = plain.trim()
    // 纯文本里恰好是单个 URL 时采纳（部分平台只写 text/plain）
    if (/^https?:\/\//i.test(t) && !/\s/.test(t)) urls.push(t)
  }
  return urls
}

/**
 * http(s) 图片 URL → File：
 *   1. 浏览器直连（alicdn 等 CORS 友好 CDN 一次成功，最快）
 *   2. 直连失败（CORS/403）→ 后端代理（伪装 Referer 绕过防盗链）
 */
export async function fetchImageAsFile(url: string): Promise<File> {
  const filename = filenameFromUrl(url) || `dropped-${Date.now()}`
  // 1. 浏览器直连：no-referrer 可绕过部分 Referer 防盗链
  try {
    const resp = await fetch(url, { referrerPolicy: 'no-referrer' })
    if (resp.ok) {
      const blob = await resp.blob()
      if (blob.type.startsWith('image/') && blob.size > 0 && blob.size <= MAX_IMAGE_BYTES) {
        return new File([blob], filename, { type: blob.type })
      }
    }
  } catch {
    // CORS 拦截/网络失败 → 走后端代理
  }
  // 2. 后端代理抓取（绕过 CORS 与防盗链）
  const data = (await api.upload.fetchImage(url)) as { dataUrl: string; contentType?: string }
  return dataUrlToFile(data.dataUrl, filename)
}

/**
 * 从 DataTransfer 多路提取图片 File 列表。
 * 必须在 drop 事件同步栈中调用（内部第一步同步捕获 files 与 getData）。
 */
export async function extractImageFilesFromDataTransfer(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return []
  // 同步捕获：drop 事件返回后 dataTransfer 被 Chrome 清空（getData 返回 ''）
  const files = Array.from(dt.files ?? []).filter((f) => f.type.startsWith('image/'))
  let html = ''
  let uriList = ''
  let plain = ''
  try {
    html = dt.getData('text/html')
    uriList = dt.getData('text/uri-list')
    plain = dt.getData('text/plain')
  } catch {
    // getData 在部分浏览器拖拽类型下可能抛错：忽略，继续用 files
  }
  // 优先级 1：文件对象（微信/本地/截图——零网络成本）
  if (files.length > 0) return files

  const { httpUrls: imgHttpUrls, dataUrls } = extractImgSrcs(html)
  const textUrls = extractUrlsFromText(uriList, plain)
  const httpUrls = Array.from(new Set([...imgHttpUrls, ...textUrls])).slice(0, MAX_URLS_PER_DROP)
  if (dataUrls.length === 0 && httpUrls.length === 0) return []

  // 优先级 2：html 内嵌 data: 图片（本地解码，无网络）
  const result: File[] = []
  for (const du of dataUrls) {
    try {
      result.push(dataUrlToFile(du, `dropped-${Date.now()}`))
    } catch {
      // 无效 dataURL 跳过
    }
  }
  // 优先级 3：http(s) URL 逐个下载（单个失败不影响其余）
  for (const u of httpUrls) {
    try {
      result.push(await fetchImageAsFile(u))
    } catch (err) {
      console.error('拖拽图片下载失败:', u, err)
    }
  }
  return result
}
