import type { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * 包装 async 路由处理函数，自动捕获 Promise 拒绝并传递给 Express 错误处理中间件。
 * 防止未处理的 Promise 拒绝导致 Node.js 进程崩溃。
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
