/**
 * 复制文本到剪贴板，兼容 HTTP 环境（非安全上下文）。
 *
 * `navigator.clipboard` 仅在安全上下文（HTTPS 或 localhost）下可用，
 * 生产环境通过 HTTP 访问时该 API 为 undefined，需降级到 execCommand。
 *
 * @returns 是否复制成功
 */
export async function copyText(text: string): Promise<boolean> {
  // 安全上下文优先使用现代 API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限拒绝等失败，继续降级
    }
  }
  // HTTP 降级方案：临时 textarea + execCommand('copy')
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
