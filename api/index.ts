import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { ordersRouter } from './routes/orders'
import { customersRouter } from './routes/customers'
import { productsRouter } from './routes/products'
import { tasksRouter } from './routes/tasks'
import { uploadRouter } from './routes/upload'
import { bagQuoteRouter } from './routes/bagQuote'

dotenv.config()

const app = express()
const port = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.use('/api/orders', ordersRouter)
app.use('/api/customers', customersRouter)
app.use('/api/products', productsRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/bag-quote', bagQuoteRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
