/**
 * Vitest 全局 setup — 在所有测试和模块导入之前 mock canvas 和 DOM API
 * VTable-Sheet 依赖 canvas 渲染和 lottie-web 动画，jsdom 不原生支持 canvas
 */

// Mock Canvas getContext — 返回完整的 CanvasRenderingContext2D mock
const createCtxMock = () => {
  const ctx: Record<string, any> = {}
  const noop = () => {}
  const chainable = () => ctx

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
