/**
 * 操作日志路由
 *
 * 提供操作日志查询接口，用于审计和追踪删除操作。
 */
import express from 'express'
import { asyncHandler } from '../asyncHandler.js'
import { getOperationLogs } from '../services/auditLog.js'

export const operationLogsRouter = express.Router()

// 查询操作日志
operationLogsRouter.get('/', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50
  const offset = parseInt(req.query.offset as string) || 0
  const entityType = req.query.entityType as string | undefined
  const result = req.query.result as string | undefined

  const data = await getOperationLogs({ limit, offset, entityType, result })
  res.json(data)
}))
