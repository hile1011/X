/**
 * 客户标签工具 单元测试
 * 测试目标：src/utils/customerTags.ts
 *   - parseCustomerTags：JSON 数组字符串解析 + 非法输入防御
 *   - serializeCustomerTags：数组序列化 + 空数组语义
 */
import { describe, it, expect } from 'vitest'
import { parseCustomerTags, serializeCustomerTags } from '../../src/utils/customerTags'

describe('parseCustomerTags - 标签解析', () => {
  it('合法 JSON 数组解析为字符串数组', () => {
    expect(parseCustomerTags('["重点客户","老客户"]')).toEqual(['重点客户', '老客户'])
  })

  it('单标签数组', () => {
    expect(parseCustomerTags('["VIP"]')).toEqual(['VIP'])
  })

  it('空数组字符串返回空数组', () => {
    expect(parseCustomerTags('[]')).toEqual([])
  })

  it('空字符串 / null / undefined 返回空数组', () => {
    expect(parseCustomerTags('')).toEqual([])
    expect(parseCustomerTags(null)).toEqual([])
    expect(parseCustomerTags(undefined)).toEqual([])
  })

  it('非法 JSON 抛错被捕获，返回空数组', () => {
    expect(parseCustomerTags('not json')).toEqual([])
    expect(parseCustomerTags('{"a":1}')).toEqual([])
  })

  it('JSON 非数组（对象/字符串/数字）返回空数组', () => {
    expect(parseCustomerTags('{"tag":"x"}')).toEqual([])
    expect(parseCustomerTags('"标签"')).toEqual([])
    expect(parseCustomerTags('42')).toEqual([])
  })

  it('过滤非字符串元素与空字符串元素', () => {
    expect(parseCustomerTags('["A", 1, null, true, "", "B"]')).toEqual(['A', 'B'])
  })
})

describe('serializeCustomerTags - 标签序列化', () => {
  it('非空数组序列化为 JSON 字符串', () => {
    expect(serializeCustomerTags(['重点客户', '老客户'])).toBe('["重点客户","老客户"]')
  })

  it('单元素', () => {
    expect(serializeCustomerTags(['VIP'])).toBe('["VIP"]')
  })

  it('空数组返回空字符串（数据库以空字符串表示无标签）', () => {
    expect(serializeCustomerTags([])).toBe('')
  })
})

describe('parse / serialize 往返一致性', () => {
  it('序列化后解析还原原数组', () => {
    const tags = ['重点客户', '老客户', 'VIP']
    expect(parseCustomerTags(serializeCustomerTags(tags))).toEqual(tags)
  })

  it('空数组序列化为空字符串，再解析回空数组', () => {
    expect(parseCustomerTags(serializeCustomerTags([]))).toEqual([])
  })
})
