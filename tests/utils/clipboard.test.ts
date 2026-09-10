/**
 * 剪贴板复制工具 单元测试
 * 测试目标：src/utils/clipboard.ts 的 copyText
 *   - 安全上下文（HTTPS）优先使用 navigator.clipboard
 *   - 安全上下文写入失败 / 非安全上下文（HTTP）降级 execCommand
 *   - 降级路径的异常与失败返回值
 *   - 临时 textarea 的创建与清理
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { copyText } from '../../src/utils/clipboard'

type FetchLike = (text: string) => Promise<void>

/** 显式控制 navigator.clipboard 与 isSecureContext（jsdom 默认值不受控） */
function stubClipboard(writeText: FetchLike | undefined, secure: boolean): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText === undefined ? undefined : { writeText },
    configurable: true,
  })
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true })
}

/** 替换 document.execCommand（jsdom 未实现） */
function stubExecCommand(impl: () => boolean | (() => boolean)): void {
  Object.defineProperty(document, 'execCommand', { value: impl, configurable: true, writable: true })
}

beforeEach(() => {
  stubExecCommand(vi.fn(() => true))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('copyText - 安全上下文（HTTPS）', () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined), true)
  })

  it('优先使用 navigator.clipboard.writeText 并返回 true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText, true)
    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('clipboard.writeText 失败时降级到 execCommand 并成功', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('not allowed'))
    stubClipboard(writeText, true)
    const exec = vi.fn(() => true)
    stubExecCommand(exec)
    await expect(copyText('hello')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })
})

describe('copyText - 非安全上下文（HTTP 生产环境）', () => {
  beforeEach(() => {
    // 生产 HTTP 访问时 navigator.clipboard 为 undefined
    stubClipboard(undefined, false)
  })

  it('降级方案：创建临时 textarea + execCommand 并返回 true', async () => {
    const exec = vi.fn(() => true)
    stubExecCommand(exec)
    await expect(copyText('hello')).resolves.toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('textarea 值已设置并在复制后从 DOM 移除', async () => {
    stubExecCommand(() => true)
    await copyText('内容文本')
    // 同步执行完毕后临时节点已移除
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('execCommand 返回 false 时返回 false', async () => {
    stubExecCommand(() => false)
    await expect(copyText('hello')).resolves.toBe(false)
  })

  it('execCommand 抛错时返回 false（不抛出异常）', async () => {
    stubExecCommand(() => {
      throw new Error('execCommand failed')
    })
    await expect(copyText('hello')).resolves.toBe(false)
  })
})

describe('copyText - navigator.clipboard 存在但非安全上下文', () => {
  it('不使用现代 API，直接走 execCommand 降级', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText, false)
    const exec = vi.fn(() => true)
    stubExecCommand(exec)
    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).not.toHaveBeenCalled()
    expect(exec).toHaveBeenCalledWith('copy')
  })
})
