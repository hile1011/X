/**
 * 客户标签工具函数
 * 数据库存储格式：JSON 数组字符串，如 '["重点客户","老客户"]'；空字符串表示无标签
 */

/** 解析客户标签（JSON 数组字符串）为字符串数组，空/非法数据返回空数组 */
export function parseCustomerTags(tags: string | undefined | null): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : []
  } catch {
    return []
  }
}

/** 将标签数组序列化为 JSON 字符串（空数组返回空字符串） */
export function serializeCustomerTags(tags: string[]): string {
  return tags.length > 0 ? JSON.stringify(tags) : ''
}
