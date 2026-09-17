/**
 * 订单批次号服务（v36）
 *
 * 格式：PN-YYYYMMDDHHmmss（秒级时间戳，北京时间 UTC+8）
 * 生成与校验前后端共用同一规则；批次号由后端批量设批次端点统一生成，
 * 同一请求内所有订单写入同一批次号，保证同批次一致性。
 */

/** 生成批次号：PN-秒级时间戳（显式 UTC+8，不受服务器时区影响） */
export function generateBatchNumber(now: Date = new Date()): string {
  const t = new Date(now.getTime() + 8 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  const ts = `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}` +
    `${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}`
  return `PN-${ts}`
}

/** 校验批次号格式：严格 PN-14 位数字（秒级时间戳） */
export function isValidBatchNumber(v: unknown): v is string {
  return typeof v === 'string' && /^PN-\d{14}$/.test(v)
}
