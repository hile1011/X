/**
 * 图片代理抓取服务（拖拽网页图片上传支持）
 *
 * 场景：订单编辑页拖拽产品图——从 1688/淘宝等网页拖出的图片只有 URL
 * （dataTransfer.files 为空），浏览器直连受 CORS/防盗链限制，由后端代理抓取。
 *
 * 安全（SSRF 防护）：
 *   - 仅允许 http/https 协议
 *   - hostname 为 IP 字面量时拒绝内网/回环/链路本地地址
 *   - 域名经 DNS 解析后逐地址校验（防解析到内网）
 *   - 重定向手动跟随（默认跟随不经过校验，可被 302 到内网），每跳重新校验
 *
 * 内容校验：
 *   - magic bytes 嗅探图片格式（不信任 Content-Type 响应头）
 *   - 大小上限（声明值 + 实际值双重校验）
 */
import dns from 'node:dns'

/** 代理抓取的图片大小上限（与前端压缩链路匹配，原图 ≤ 20MB） */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 单次代理抓取超时（含重定向各跳） */
export const FETCH_IMAGE_TIMEOUT_MS = 15_000
/** 重定向最大跟随次数（每跳均重新做 SSRF 校验） */
export const MAX_REDIRECT_HOPS = 3

/** 判断主机名/IP 是否为内网、回环或链路本地地址 */
export function isPrivateHostname(host: string): boolean {
  // 统一小写并去掉 IPv6 方括号
  const h = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  // 云厂商元数据服务等常见内网服务名
  if (h === 'metadata.google.internal' || h === 'instance-data') return true

  // IPv4 字面量
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true                    // 本机/内网A/回环
    if (a === 172 && b >= 16 && b <= 31) return true                     // 内网B
    if (a === 192 && b === 168) return true                              // 内网C
    if (a === 169 && b === 254) return true                              // 链路本地
    if (a === 100 && b >= 64 && b <= 127) return true                    // CGNAT
    if (a >= 224) return true                                            // 组播/保留段
    return false
  }

  // IPv6 字面量（常见形态）
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true                           // 未指定/回环
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true                        // fc00::/7 ULA
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true                        // fe80::/10 链路本地
    if (/^ff/.test(h)) return true                                       // 组播
    // IPv4 映射地址 ::ffff:10.0.0.1
    const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isPrivateHostname(mapped[1])
    return false
  }
  return false
}

/**
 * 校验并规范化图片抓取目标 URL：
 *   1. 可解析为 URL 且协议为 http/https
 *   2. hostname 非内网地址（IP 字面量直接判，域名 DNS 解析后逐地址判）
 * 抛出带用户可读信息的 Error，由路由层转为 4xx/5xx。
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('无效的图片链接')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 图片链接')
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (isPrivateHostname(host)) {
    throw new Error('不允许访问内网地址')
  }
  // 域名（非 IP 字面量）解析后校验，防止域名解析到内网 IP
  const isIpv4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  const isIpv6Literal = host.includes(':')
  if (!isIpv4Literal && !isIpv6Literal) {
    let addrs: { address: string }[]
    try {
      addrs = await dns.promises.lookup(host, { all: true })
    } catch {
      throw new Error('图片域名解析失败')
    }
    if (addrs.length === 0) throw new Error('图片域名解析失败')
    if (addrs.some((a) => isPrivateHostname(a.address))) {
      throw new Error('不允许访问内网地址')
    }
  }
  return url
}

/**
 * magic bytes 图片格式嗅探（不信任响应 Content-Type）。
 * 返回 MIME 类型；无法识别返回 null。
 */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png'
  // GIF: 47 49 46 38 (GIF8)
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // BMP: 42 4D
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  // WEBP: RIFF .... WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp'
  // AVIF/HEIC: ....ftyp 且 major brand 以 avif/heic/hevc/mif1 开头
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = buf.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc' || brand === 'mif1') return 'image/heic'
  }
  return null
}

/** 构造代理抓取请求头：伪装来源站点 Referer（绕过基础防盗链）与常见浏览器 UA */
export function buildProxyImageHeaders(url: URL): Record<string, string> {
  return {
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': `${url.origin}/`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }
}

/**
 * 抓取图片并手动跟随重定向（每跳重新做 SSRF 校验）。
 * 返回 { buffer, mime }；失败抛 Error（消息用户可读）。
 */
export async function fetchImageBuffer(entryUrl: URL): Promise<{ buffer: Buffer; mime: string }> {
  let current = entryUrl
  let resp: Response
  for (let hop = 0; ; hop++) {
    resp = await fetch(current, {
      headers: buildProxyImageHeaders(current),
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_IMAGE_TIMEOUT_MS),
    })
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (hop >= MAX_REDIRECT_HOPS || !location) {
        throw new Error('图片源重定向次数过多')
      }
      // 相对/绝对 Location 均规范化为绝对 URL 后重新校验（防 302 跳内网）
      current = await assertPublicHttpUrl(new URL(location, current).href)
      continue
    }
    break
  }
  if (!resp.ok) {
    throw new Error(`图片源响应 ${resp.status}（可能被防盗链拦截）`)
  }
  const declaredSize = Number(resp.headers.get('content-length') || 0)
  if (declaredSize > MAX_IMAGE_BYTES) {
    throw new Error('图片超过 20MB 大小限制')
  }
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (buffer.byteLength === 0) throw new Error('图片内容为空')
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB 大小限制')
  const mime = sniffImageType(buffer)
  if (!mime) throw new Error('链接内容不是支持的图片格式（jpg/png/gif/webp/bmp/avif/heic）')
  return { buffer, mime }
}
