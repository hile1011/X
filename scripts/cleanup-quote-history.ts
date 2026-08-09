/**
 * 订单数据修改历史记录定时清理脚本
 *
 * 清理 quote_history 表中超过保留期限的历史记录（默认保留最近 1 个月）。
 * 由 quotes 表的 INSERT/UPDATE/DELETE 触发器自动写入，数据增长较快，需定期清理。
 *
 * 用法：
 *   npx tsx scripts/cleanup-quote-history.ts              # 清理 1 个月前的记录
 *   npx tsx scripts/cleanup-quote-history.ts --dry-run     # 仅统计不删除
 *   npx tsx scripts/cleanup-quote-history.ts --retain 90   # 自定义保留 90 天
 *   npm run db:cleanup-history                             # 等价于第一条
 *   npm run db:cleanup-history:dry                         # 等价于 dry-run
 *
 * 定时任务（crontab -e）：
 *   # 每天凌晨 3:17 执行清理
 *   17 3 * * * cd /path/to/project && bash scripts/cleanup-quote-history.sh >> logs/cleanup.log 2>&1
 *
 * 环境变量（读取 api/.env）：
 *   MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *   QUOTE_HISTORY_RETAIN_DAYS  保留天数（默认 30），命令行 --retain 优先
 */
import dotenv from 'dotenv'
import path from 'path'
import { closePool } from '../api/dbClient.js'
import { cleanupOldHistory } from '../api/services/quoteHistory.js'

// 加载环境变量（与后端一致的查找顺序）
const envPath = path.resolve(process.cwd(), 'api/.env')
dotenv.config({ path: envPath })

/** 解析命令行参数 */
function parseArgs(): { dryRun: boolean; retainDays: number } {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  let retainDays = Number(process.env.QUOTE_HISTORY_RETAIN_DAYS) || 30
  const retainIdx = args.indexOf('--retain')
  if (retainIdx !== -1 && args[retainIdx + 1]) {
    const n = Number(args[retainIdx + 1])
    if (!Number.isNaN(n) && n >= 0) retainDays = n
  }
  return { dryRun, retainDays }
}

async function main(): Promise<void> {
  const { dryRun, retainDays } = parseArgs()
  const db = process.env.MYSQL_DATABASE || 'quote_system'

  console.log(`[Cleanup] 数据库: ${db}`)
  console.log(`[Cleanup] 保留天数: ${retainDays} 天`)
  console.log(`[Cleanup] 模式: ${dryRun ? '预览（dry-run，不删除）' : '执行删除'}`)

  const result = await cleanupOldHistory(retainDays, dryRun)

  console.log(`[Cleanup] 过期记录数（> ${retainDays} 天）: ${result.expired}`)
  if (dryRun) {
    console.log('[Cleanup] dry-run 模式，未执行删除')
  } else if (result.expired === 0) {
    console.log('[Cleanup] 无过期记录，跳过')
  } else {
    console.log(`[Cleanup] 完成，共删除 ${result.deleted} 行过期记录`)
  }
}

main()
  .catch((err) => {
    console.error('[Cleanup] 失败:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closePool()
  })
