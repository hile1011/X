/**
 * 图片代理抓取服务单元测试（api/services/imageFetch.ts）
 *
 * 覆盖：
 *   - isPrivateHostname：IPv4 各内网段 / IPv6 / localhost / 云元数据域名 / 公网放行
 *   - assertPublicHttpUrl：协议白名单、内网 IP 拒绝、域名 DNS 解析校验（公网/内网）
 *   - sniffImageType：jpg/png/gif/bmp/webp/avif magic bytes、非图片、过短 buffer
 *   - fetchImageBuffer：正常抓取、content-length 预检、非图片内容拒绝、
 *     302 重定向跟随（每跳重新 SSRF 校验）、重定向到内网拒绝、超次数拒绝、源站错误
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock DNS：默认全部解析到公网 IP（被测函数需要域名走 lookup）
const lookupMock = vi.fn(async (host: string) => [{ address: '203.0.113.10', family: 4 }])
vi.mock('node:dns', () => ({
  default: { promises: { lookup: (...args: unknown[]) => lookupMock(...args) } },
}))

import {
  isPrivateHostname,
  assertPublicHttpUrl,
  sniffImageType,
  buildProxyImageHeaders,
  fetchImageBuffer,
  MAX_IMAGE_BYTES,
  MAX_REDIRECT_HOPS,
} from '../api/services/imageFetch'

/** 构造图片 buffer（magic bytes + 填充） */
function imageBytes(header: number[], pad = 32): Buffer {
  return Buffer.from([...header, ...new Array(pad).fill(0)])
}

const PNG_BUF = imageBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 伪造 fetch 响应 */
function fetchResponse(opts: {
  status?: number
  contentType?: string
  contentLength?: number | null
  buffer?: Buffer
  location?: string
}) {
  const headers = new Headers()
  if (opts.contentType) headers.set('content-type', opts.contentType)
  if (opts.contentLength !== null && opts.contentLength !== undefined) {
    headers.set('content-length', String(opts.contentLength))
  }
  if (opts.location) headers.set('location', opts.location)
  const status = opts.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    arrayBuffer: async () => (opts.buffer ?? PNG_BUF).buffer.slice(
      (opts.buffer ?? PNG_BUF).byteOffset,
      (opts.buffer ?? PNG_BUF).byteOffset + (opts.buffer ?? PNG_BUF).byteLength,
    ),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  lookupMock.mockImplementation(async () => [{ address: '203.0.113.10', family: 4 }])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ============================================================
// isPrivateHostname
// ============================================================
describe('isPrivateHostname', () => {
  it('IPv4 内网/回环/链路本地/保留段识别', () => {
    for (const host of [
      '10.0.0.1', '10.255.255.255',          // A 类内网
      '172.16.0.1', '172.31.255.254',        // B 类内网
      '192.168.1.1', '192.168.0.100',        // C 类内网
      '127.0.0.1', '127.1.2.3',              // 回环
      '169.254.169.254',                     // 链路本地（云元数据）
      '100.64.0.1', '100.127.255.255',       // CGNAT
      '0.0.0.0', '224.0.0.1', '255.1.1.1',   // 保留/组播
    ]) {
      expect(isPrivateHostname(host), host).toBe(true)
    }
  })

  it('IPv4 公网地址放行', () => {
    for (const host of ['8.8.8.8', '1.1.1.1', '203.0.113.10', '172.32.0.1', '100.128.0.1']) {
      expect(isPrivateHostname(host), host).toBe(false)
    }
  })

  it('IPv6：回环/ULA/链路本地/组播/IPv4映射识别', () => {
    expect(isPrivateHostname('::1')).toBe(true)
    expect(isPrivateHostname('::')).toBe(true)
    expect(isPrivateHostname('fc00::1')).toBe(true)
    expect(isPrivateHostname('fd12:3456::1')).toBe(true)
    expect(isPrivateHostname('fe80::1')).toBe(true)
    expect(isPrivateHostname('ff02::1')).toBe(true)
    expect(isPrivateHostname('::ffff:10.0.0.1')).toBe(true)
    expect(isPrivateHostname('::ffff:8.8.8.8')).toBe(false)
    expect(isPrivateHostname('2001:db8::1')).toBe(false)
  })

  it('localhost 及常见内网服务名', () => {
    expect(isPrivateHostname('localhost')).toBe(true)
    expect(isPrivateHostname('LOCALHOST')).toBe(true)
    expect(isPrivateHostname('app.local')).toBe(true)
    expect(isPrivateHostname('metadata.google.internal')).toBe(true)
    expect(isPrivateHostname('[::1]')).toBe(true) // 方括号形式
  })
})

// ============================================================
// assertPublicHttpUrl
// ============================================================
describe('assertPublicHttpUrl', () => {
  it('非法 URL / 非 http 协议拒绝', async () => {
    await expect(assertPublicHttpUrl('not-a-url')).rejects.toThrow('无效的图片链接')
    await expect(assertPublicHttpUrl('ftp://example.com/a.jpg')).rejects.toThrow('http/https')
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow('http/https')
  })

  it('内网 IP 字面量拒绝（不触发 DNS）', async () => {
    await expect(assertPublicHttpUrl('http://192.168.1.10/a.jpg')).rejects.toThrow('内网')
    await expect(assertPublicHttpUrl('http://127.0.0.1:3001/api/x')).rejects.toThrow('内网')
    await expect(assertPublicHttpUrl('http://[::1]/a.jpg')).rejects.toThrow('内网')
  })

  it('公网 IP 字面量放行', async () => {
    const url = await assertPublicHttpUrl('https://203.0.113.10/img/a.jpg')
    expect(url.hostname).toBe('203.0.113.10')
  })

  it('域名解析到公网 IP 放行', async () => {
    const url = await assertPublicHttpUrl('https://cbu01.alicdn.com/img/ibank/a.jpg')
    expect(url.hostname).toBe('cbu01.alicdn.com')
    expect(lookupMock).toHaveBeenCalled()
  })

  it('域名解析到内网 IP 拒绝（防 DNS 解析到内网）', async () => {
    lookupMock.mockResolvedValue([{ address: '192.168.0.10', family: 4 }])
    await expect(assertPublicHttpUrl('https://evil.example.com/a.jpg')).rejects.toThrow('内网')
  })

  it('域名解析失败给出可读错误', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertPublicHttpUrl('https://nonexistent.example.com/a.jpg')).rejects.toThrow('解析失败')
  })
})

// ============================================================
// sniffImageType
// ============================================================
describe('sniffImageType', () => {
  it('各格式 magic bytes 识别', () => {
    expect(sniffImageType(imageBytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageType(imageBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImageType(imageBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
    expect(sniffImageType(imageBytes([0x42, 0x4d]))).toBe('image/bmp')
    expect(sniffImageType(imageBytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    expect(sniffImageType(imageBytes([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))).toBe('image/avif')
  })

  it('非图片内容 / 过短 buffer 返回 null', () => {
    expect(sniffImageType(Buffer.from('<html>not an image</html>'))).toBeNull()
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull()
  })

  it('不信任 HTML 伪装的 Content-Type 场景（防盗链返回的网页）', () => {
    // 防盗链常见返回 HTML 错误页——magic bytes 判定非图片
    const htmlPage = Buffer.from(`<!DOCTYPE html><html><body>403 Forbidden</body></html>`)
    expect(sniffImageType(htmlPage)).toBeNull()
  })
})

// ============================================================
// buildProxyImageHeaders
// ============================================================
describe('buildProxyImageHeaders', () => {
  it('伪装来源站点 Referer 与浏览器 UA', () => {
    const headers = buildProxyImageHeaders(new URL('https://cbu01.alicdn.com/img/a.jpg'))
    expect(headers['Referer']).toBe('https://cbu01.alicdn.com/')
    expect(headers['Accept']).toContain('image/')
    expect(headers['User-Agent']).toContain('Mozilla')
  })
})

// ============================================================
// fetchImageBuffer
// ============================================================
describe('fetchImageBuffer', () => {
  it('正常抓取：返回 buffer 与嗅探出的 mime', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ contentType: 'image/png', buffer: PNG_BUF }))
    const { buffer, mime } = await fetchImageBuffer(new URL('https://img.example.com/a.png'))
    expect(mime).toBe('image/png')
    expect(buffer.equals(PNG_BUF)).toBe(true)
    // 请求头带伪装 Referer + 手动重定向（不自动跟随）
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['Referer']).toBe('https://img.example.com/')
    expect(init.redirect).toBe('manual')
  })

  it('content-length 声明超限直接拒绝（不下载 body）', async () => {
    fetchMock.mockResolvedValue(fetchResponse({
      contentType: 'image/png',
      contentLength: MAX_IMAGE_BYTES + 1,
      buffer: PNG_BUF,
    }))
    await expect(fetchImageBuffer(new URL('https://img.example.com/big.png')))
      .rejects.toThrow('20MB')
    expect(fetchMock.mock.calls[0][1].arrayBuffer).toBeUndefined() // 未调用
  })

  it('实际内容超限拒绝', async () => {
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1024)
    huge[0] = 0xff; huge[1] = 0xd8; huge[2] = 0xff // JPEG 头
    fetchMock.mockResolvedValue(fetchResponse({ contentType: 'image/jpeg', contentLength: null, buffer: huge }))
    await expect(fetchImageBuffer(new URL('https://img.example.com/big.jpg')))
      .rejects.toThrow('20MB')
  })

  it('内容为空拒绝', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ contentType: 'image/png', buffer: Buffer.alloc(0) }))
    await expect(fetchImageBuffer(new URL('https://img.example.com/empty.png')))
      .rejects.toThrow('为空')
  })

  it('内容非图片拒绝（如防盗链 HTML 错误页）', async () => {
    const html = Buffer.from('<html>403</html>')
    fetchMock.mockResolvedValue(fetchResponse({ contentType: 'image/jpeg', buffer: html }))
    await expect(fetchImageBuffer(new URL('https://img.example.com/fake.jpg')))
      .rejects.toThrow('不是支持的图片格式')
  })

  it('源站非 2xx 拒绝', async () => {
    fetchMock.mockResolvedValue(fetchResponse({ status: 403, contentType: 'image/png' }))
    await expect(fetchImageBuffer(new URL('https://img.example.com/a.jpg')))
      .rejects.toThrow('403')
  })

  it('302 重定向跟随：每跳重新校验后正常抓取', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ status: 302, location: 'https://cdn.example.com/real.png' }))
      .mockResolvedValueOnce(fetchResponse({ contentType: 'image/png', buffer: PNG_BUF }))
    const { mime } = await fetchImageBuffer(new URL('https://img.example.com/a.png'))
    expect(mime).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0].href).toBe('https://cdn.example.com/real.png')
  })

  it('302 到内网地址拒绝（防重定向 SSRF）', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({ status: 302, location: 'http://192.168.0.5/x.jpg' }))
    await expect(fetchImageBuffer(new URL('https://img.example.com/a.png')))
      .rejects.toThrow('内网')
    expect(fetchMock).toHaveBeenCalledTimes(1) // 未发起第二跳请求
  })

  it('重定向次数超上限拒绝', async () => {
    // 每次都 302 到新 URL，超过 MAX_REDIRECT_HOPS
    for (let i = 0; i <= MAX_REDIRECT_HOPS; i++) {
      fetchMock.mockResolvedValueOnce(fetchResponse({ status: 302, location: `https://h${i}.example.com/a.png` }))
    }
    await expect(fetchImageBuffer(new URL('https://img.example.com/a.png')))
      .rejects.toThrow('重定向次数过多')
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REDIRECT_HOPS + 1)
  })

  it('相对路径重定向规范化为绝对 URL 并校验', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ status: 302, location: '/img/real.png' }))
      .mockResolvedValueOnce(fetchResponse({ contentType: 'image/png', buffer: PNG_BUF }))
    const { mime } = await fetchImageBuffer(new URL('https://img.example.com/a.png'))
    expect(mime).toBe('image/png')
    expect(fetchMock.mock.calls[1][0].href).toBe('https://img.example.com/img/real.png')
  })
})
