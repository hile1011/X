/**
 * 删除处理辅助函数
 *
 * 为各路由提供统一的删除检查和删除执行逻辑，包含：
 *   - 关联关系检测（deleteGuard）
 *   - 审计日志记录（auditLog）
 *   - 操作人提取（X-Operator 头）
 */
import type { Request, Response } from 'express'
import { checkDelete } from './deleteGuard.js'
import { logOperation } from './auditLog.js'

/**
 * 从请求中提取操作人信息
 */
function getOperator(req: Request): string {
  return (req.headers['x-operator'] as string) || 'unknown'
}

/**
 * 获取客户端 IP 地址
 */
function getIpAddress(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || ''
}

/**
 * 创建删除前检查处理函数（GET /:id/delete-check）
 */
export function createDeleteCheckHandler(entityType: string) {
  return async (req: Request, res: Response) => {
    const { id } = req.params
    const result = await checkDelete(entityType, id)
    res.json(result)
  }
}

/**
 * 创建受保护的删除处理函数（DELETE /:id）
 *
 * 流程：
 *   1. 关联关系检测 → 有阻断性关联则返回 409 + 关联详情
 *   2. 执行删除
 *   3. 记录审计日志（成功/被阻止均记录）
 */
export function createProtectedDeleteHandler(
  entityType: string,
  deleteFn: (id: string) => Promise<boolean>
) {
  return async (req: Request, res: Response) => {
    const { id } = req.params
    const operator = getOperator(req)
    const ipAddress = getIpAddress(req)

    // 1. 关联关系检测
    const checkResult = await checkDelete(entityType, id)

    // 实体不存在
    if (checkResult.entityInfo.name === '(不存在)') {
      await logOperation({
        operationType: 'delete',
        entityType,
        entityId: id,
        entityName: '(不存在)',
        operator,
        result: 'blocked',
        blockedReason: '实体不存在',
        ipAddress,
      })
      return res.status(404).json({ error: '数据不存在' })
    }

    // 存在阻断性关联关系
    if (!checkResult.canDelete) {
      const blockedReason = checkResult.relationships
        .map((r) => r.description)
        .join('; ')
      await logOperation({
        operationType: 'delete',
        entityType,
        entityId: id,
        entityName: checkResult.entityInfo.name,
        operator,
        result: 'blocked',
        blockedReason,
        ipAddress,
      })
      return res.status(409).json({
        error: '存在关联数据，无法删除',
        relationships: checkResult.relationships,
        entityInfo: checkResult.entityInfo,
      })
    }

    // 2. 执行删除
    const success = await deleteFn(id)
    if (!success) {
      await logOperation({
        operationType: 'delete',
        entityType,
        entityId: id,
        entityName: checkResult.entityInfo.name,
        operator,
        result: 'blocked',
        blockedReason: '删除执行失败（数据可能已被删除）',
        ipAddress,
      })
      return res.status(404).json({ error: '数据不存在' })
    }

    // 3. 记录成功日志
    await logOperation({
      operationType: 'delete',
      entityType,
      entityId: id,
      entityName: checkResult.entityInfo.name,
      operator,
      result: 'success',
      ipAddress,
    })

    res.json({ message: '删除成功' })
  }
}
