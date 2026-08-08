import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { ordersRouter } from './routes/orders.js'
import { customersRouter } from './routes/customers.js'
import { productsRouter } from './routes/products.js'
import { tasksRouter } from './routes/tasks.js'
import { uploadRouter } from './routes/upload.js'
import { bagQuoteRouter } from './routes/bagQuote.js'
import { quotesRouter } from './routes/quotes.js'
import { processCostsRouter } from './routes/processCosts.js'
import { exportRouter } from './routes/export.js'
import { operationLogsRouter } from './routes/operationLogs.js'

const envPath = fs.existsSync(path.resolve(process.cwd(), '.env'))
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'api/.env')
dotenv.config({ path: envPath })

const app = express()
const port = Number(process.env.PORT) || 3001
// HOST 环境变量：显式指定绑定的网卡地址。留空（默认）则绑定所有接口（IPv4+IPv6 双栈），
// 支持 IP+端口访问与外部网络访问。可设为 '0.0.0.0'（仅 IPv4）或具体网卡 IP。
const host = process.env.HOST || undefined
const isProd = process.env.NODE_ENV === 'production'

app.use(helmet({
  // 本地开发/局域网调试环境，简化安全头配置
  // 禁用 CSP：避免阻断脚本加载
  contentSecurityPolicy: false,
  // 禁用 HSTS：避免浏览器强制升级到 HTTPS
  hsts: false,
}))
app.use(compression({
  // 压缩响应体，减少网络传输量
  level: 6,
  threshold: 1024, // 超过 1KB 才压缩
}))
app.use(cors())
app.use(express.json({ limit: '50mb' }))

if (isProd) {
  const distPath = path.resolve(process.cwd(), 'dist')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    console.log(`[Server] Serving frontend from: ${distPath}`)
  }
}

app.use('/api/orders', ordersRouter)
app.use('/api/customers', customersRouter)
app.use('/api/products', productsRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/bag-quote', bagQuoteRouter)
app.use('/api/quotes', quotesRouter)
app.use('/api/process-costs', processCostsRouter)
app.use('/api/export', exportRouter)
app.use('/api/operation-logs', operationLogsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

if (isProd && fs.existsSync(path.resolve(process.cwd(), 'dist', 'index.html'))) {
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'))
  })
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server] 路由错误:', err.message)
  res.status(500).json({ error: '服务器内部错误', message: err.message })
})

// 防止未处理的 Promise 拒绝导致进程崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[Server] 未处理的 Promise 拒绝（已拦截，进程不退出）:', reason)
})

const onStart = () => {
  const bindAddr = host || '0.0.0.0/:: (所有接口)'
  console.log(`[Server] 运行于 ${bindAddr}:${port}`)
  console.log(`[Server] 环境: ${process.env.NODE_ENV || 'development'}`)
}
// HOST 未设置时绑定所有接口（IPv4+IPv6 双栈）；设置时绑定到指定地址
const server = host ? app.listen(port, host, onStart) : app.listen(port, onStart)

// 优雅关闭：收到 SIGTERM/SIGINT 时停止接受新连接，等待进行中的请求完成
let shuttingDown = false
const shutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[Server] 收到 ${signal}，开始优雅关闭...`)
  server.close((err) => {
    if (err) {
      console.error('[Server] 关闭出错:', err.message)
      process.exit(1)
    }
    console.log('[Server] 已关闭所有连接，进程退出')
    process.exit(0)
  })
  // 兜底：10 秒后强制退出，避免残留连接卡住关闭流程
  setTimeout(() => {
    console.error('[Server] 优雅关闭超时（10s），强制退出')
    process.exit(1)
  }, 10000)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
