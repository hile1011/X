/**
 * Vitest 全局 setup — 在所有测试和模块导入之前 mock canvas 和 DOM API
 * VTable-Sheet 依赖 canvas 渲染和 lottie-web 动画，jsdom 不原生支持 canvas
 *
 * 同时配置 MySQL 测试数据库环境变量。
 * 注意：不在此处关闭连接池 — setupFiles 在每个测试文件前运行，其 afterAll 会在
 * 每个测试文件后运行，导致后续测试文件无法使用已关闭的连接池。
 * 连接池由 tests/globalSetup.ts 的 teardown 函数在所有测试结束后统一关闭。
 */

// 配置 MySQL 测试数据库环境变量（未被外部覆盖时使用默认值）
process.env.MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1'
process.env.MYSQL_PORT = process.env.MYSQL_PORT || '3306'
process.env.MYSQL_USER = process.env.MYSQL_USER || 'root'
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? ''
process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'quote_system_test'

// Mock Canvas getContext — 返回完整的 CanvasRenderingContext2D mock
const createCtxMock = () => {
  const ctx: Record<string, any> = {}
  const noop = () => {}

  // 绘制方法（返回 undefined，与真实 Canvas API 一致）
  ;[
    'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo',
    'arc', 'arcTo', 'rect', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate',
    'scale', 'fillText', 'strokeText', 'setTransform', 'drawImage', 'clip', 'bezierCurveTo',
    'quadraticCurveTo', 'createLinearGradient', 'createRadialGradient', 'createPattern',
    'getImageData', 'putImageData', 'createImageData', 'setLineDash', 'getLineDash',
    'transform', 'resetTransform', 'globalCompositeOperation', 'setTransform',
  ].forEach(m => { ctx[m] = noop })

  // 返回值方法
  ctx.measureText = () => ({ width: 50, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 })
  ctx.isPointInPath = () => false
  ctx.isPointInStroke = () => false
  ctx.getContextAttributes = () => ({ alpha: true })

  // 渐变对象
  ctx.createLinearGradient = () => ({ addColorStop: noop })
  ctx.createRadialGradient = () => ({ addColorStop: noop })
  ctx.createPattern = () => ({})

  // Canvas 引用
  ctx.canvas = {
    width: 800, height: 600,
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    style: {},
    addEventListener: noop,
    removeEventListener: noop,
  }

  // 可读写属性
  ;[
    'fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline',
    'globalAlpha', 'lineCap', 'lineJoin', 'miterLimit', 'shadowBlur', 'shadowColor',
    'shadowOffsetX', 'shadowOffsetY', 'globalCompositeOperation', 'imageSmoothingEnabled',
    'direction', 'filter', 'lineDashOffset', 'fontKerning', 'letterSpacing', 'wordSpacing',
    'textRendering',
  ].forEach(p => {
    let v: any
    Object.defineProperty(ctx, p, { get: () => v, set: (nv: any) => { v = nv }, configurable: true, enumerable: true })
  })

  return ctx
}

// 应用到 HTMLCanvasElement
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => createCtxMock(),
  configurable: true,
  writable: true,
})

// Mock requestAnimationFrame（jsdom pretendToBeVisual 已提供，但确保可用）
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as any
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

// Mock Element.scrollIntoView（jsdom 未实现，VTable sheet-tab 定时器会调用）
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// Mock ResizeObserver
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  } as any
}

// Mock OffscreenCanvas（VTable 可能使用）
if (!(globalThis as any).OffscreenCanvas) {
  ;(globalThis as any).OffscreenCanvas = class {
    constructor(w: number, h: number) {
      this.width = w
      this.height = h
    }
    width: number
    height: number
    getContext() { return createCtxMock() }
  }
}

// Polyfill ClipboardEvent — jsdom 不提供此构造函数，但 VTable 复制增强器
// （src/utils/clipboardCopyEnhancer.ts）在 HTTP 环境下会 new ClipboardEvent('copy')
// 主动派发 copy 事件。测试需要此构造函数才能验证该路径。
// 真实浏览器（含 HTTP 环境）均内置 ClipboardEvent，生产代码无需 polyfill。
if (typeof (globalThis as any).ClipboardEvent === 'undefined') {
  // 简易 DataTransfer mock：收集 setData 写入的数据，供 getData 读取
  const createDataTransfer = () => {
    const store = new Map<string, string>()
    return {
      setData: (mime: string, data: string) => { store.set(mime, String(data)) },
      getData: (mime: string) => store.get(mime) ?? '',
      clearData: (mime?: string) => { if (mime) store.delete(mime); else store.clear() },
      types: () => Array.from(store.keys()),
    }
  }
  class ClipboardEventPolyfill extends Event {
    clipboardData: any
    constructor(type: string, eventInitDict?: EventInit & { clipboardData?: any }) {
      super(type, eventInitDict)
      // 程序化创建的 ClipboardEvent 在真实浏览器中 clipboardData 为 null，
      // 但测试需要 onCopy 能写入数据，所以提供默认 DataTransfer mock。
      this.clipboardData = eventInitDict?.clipboardData ?? createDataTransfer()
    }
  }
  ;(globalThis as any).ClipboardEvent = ClipboardEventPolyfill
}
