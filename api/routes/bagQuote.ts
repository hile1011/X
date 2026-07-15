import express from 'express'
import { calculateBagQuote, defaultBagQuoteInput, type BagQuoteInput } from '../services/bagQuoteCalculator'

export const bagQuoteRouter = express.Router()

bagQuoteRouter.post('/calculate', (req, res) => {
  try {
    const input: BagQuoteInput = { ...defaultBagQuoteInput, ...req.body }
    const requiredFields: (keyof BagQuoteInput)[] = ['quantity', 'width', 'height']
    for (const field of requiredFields) {
      if (input[field] === undefined || input[field] === null || isNaN(Number(input[field]))) {
        return res.status(400).json({ error: `参数 ${field} 不能为空` })
      }
    }
    if (!input.frontBackRows || !Array.isArray(input.frontBackRows) || input.frontBackRows.length === 0) {
      return res.status(400).json({ error: 'frontBackRows 不能为空数组' })
    }
    const result = calculateBagQuote(input)
    res.json({ success: true, result })
  } catch (error) {
    console.error('帆布袋报价计算错误:', error)
    res.status(500).json({ error: '计算失败', details: (error as Error).message })
  }
})

bagQuoteRouter.get('/defaults', (_req, res) => {
  res.json({ success: true, defaults: defaultBagQuoteInput })
})
