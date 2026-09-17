/**
 * 批次号服务（v36）单元测试
 *
 * - generateBatchNumber：PN-YYYYMMDDHHmmss 格式、北京时间 UTC+8、同一时刻确定性
 * - isValidBatchNumber：严格 PN-14 位数字（秒级时间戳）
 */
import { describe, it, expect } from 'vitest'
import { generateBatchNumber, isValidBatchNumber } from '../api/services/batchNumber.js'

describe('generateBatchNumber', () => {
  it('生成 PN-14位数字 格式', () => {
    expect(generateBatchNumber()).toMatch(/^PN-\d{14}$/)
  })

  it('使用北京时间 UTC+8（2026-09-17T00:00:00Z → 北京 08:00:00）', () => {
    expect(generateBatchNumber(new Date('2026-09-17T00:00:00Z'))).toBe('PN-20260917080000')
  })

  it('UTC+8 跨日边界（UTC 15:59:59 → 北京 23:59:59，不进位）', () => {
    expect(generateBatchNumber(new Date('2026-01-01T15:59:59Z'))).toBe('PN-20260101235959')
  })

  it('UTC+8 跨日进位（UTC 16:00:00 → 北京次日 00:00:00）', () => {
    expect(generateBatchNumber(new Date('2026-01-01T16:00:00Z'))).toBe('PN-20260102000000')
  })

  it('月/日/时/分/秒低位补零', () => {
    expect(generateBatchNumber(new Date('2026-02-03T01:02:03Z'))).toBe('PN-20260203090203')
  })

  it('同一时刻确定性；秒级递进可区分', () => {
    const t = new Date('2026-09-17T07:30:15Z')
    expect(generateBatchNumber(t)).toBe(generateBatchNumber(t))
    expect(generateBatchNumber(new Date(t.getTime() + 1000))).not.toBe(generateBatchNumber(t))
  })
})

describe('isValidBatchNumber', () => {
  it('接受合法批次号', () => {
    expect(isValidBatchNumber('PN-20260917153000')).toBe(true)
    expect(isValidBatchNumber('PN-00000000000000')).toBe(true)
  })

  it('拒绝位数不符 / 前缀不符 / 含非数字', () => {
    expect(isValidBatchNumber('PN-2026091715300')).toBe(false) // 13位
    expect(isValidBatchNumber('PN-202609171530001')).toBe(false) // 15位
    expect(isValidBatchNumber('pn-20260917153000')).toBe(false) // 小写前缀
    expect(isValidBatchNumber('XX-20260917153000')).toBe(false) // 前缀错误
    expect(isValidBatchNumber('PN-2026091715300a')).toBe(false) // 含字母
    expect(isValidBatchNumber('PN-2026-09-17')).toBe(false)
    expect(isValidBatchNumber('PN-')).toBe(false)
    expect(isValidBatchNumber('')).toBe(false)
  })

  it('拒绝非字符串类型', () => {
    expect(isValidBatchNumber(null)).toBe(false)
    expect(isValidBatchNumber(undefined)).toBe(false)
    expect(isValidBatchNumber(123)).toBe(false)
    expect(isValidBatchNumber({})).toBe(false)
  })
})
