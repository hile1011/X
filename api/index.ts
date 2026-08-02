import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
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

const envPath = fs.existsSync(path.resolve(process.cwd(), '.env'))
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'api/.env')
dotenv.config({ path: envPath })

const app = express()
const port = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

app.use(helmet())
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

app.listen(port, () => {
  console.log(`[Server] 运行于端口 ${port}`)
  console.log(`[Server] 环境: ${process.env.NODE_ENV || 'development'}`)
})
