import { describe, it, expect } from 'vitest'
import {
  isNotIndexed,
  classifyNotIndexed,
  THIN_WORD_COUNT_THRESHOLD,
  UNKNOWN_TO_GOOGLE,
} from '../index-status'

describe('isNotIndexed — first_not_indexed_at 非空即未收录', () => {
  it('非空时间戳 → true', () => {
    expect(isNotIndexed('2026-08-01T00:00:00Z')).toBe(true)
  })
  it('null / undefined / 空串 → false', () => {
    expect(isNotIndexed(null)).toBe(false)
    expect(isNotIndexed(undefined)).toBe(false)
    expect(isNotIndexed('')).toBe(false)
  })
})

describe('classifyNotIndexed — 未收录页面的本地三分类', () => {
  it('index_verdict = "URL is unknown to Google" → unknown（即使字数也很少，优先判 unknown）', () => {
    expect(classifyNotIndexed({ index_verdict: UNKNOWN_TO_GOOGLE, word_count: 50 })).toBe('unknown')
  })

  it('爬过、字数低于阈值 → thin', () => {
    expect(
      classifyNotIndexed({ index_verdict: 'Crawled - currently not indexed', word_count: 120 }),
    ).toBe('thin')
  })

  it('字数为 null 当作 0 → thin', () => {
    expect(classifyNotIndexed({ index_verdict: 'Crawled - currently not indexed', word_count: null })).toBe('thin')
  })

  it('爬过、字数达标却仍没收录 → declined', () => {
    expect(
      classifyNotIndexed({ index_verdict: 'Crawled - currently not indexed', word_count: 800 }),
    ).toBe('declined')
  })

  it('恰好等于阈值 → declined（< 才算太薄）', () => {
    expect(
      classifyNotIndexed({ index_verdict: 'Discovered - currently not indexed', word_count: THIN_WORD_COUNT_THRESHOLD }),
    ).toBe('declined')
  })

  it('阈值下一位 → thin', () => {
    expect(
      classifyNotIndexed({ index_verdict: 'Discovered - currently not indexed', word_count: THIN_WORD_COUNT_THRESHOLD - 1 }),
    ).toBe('thin')
  })
})
