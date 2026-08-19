import { describe, it, expect } from 'vitest'
import { checkGrounding, extractLatinEntities, extractNumbers } from '../grounding'

describe('extractLatinEntities', () => {
  it('pulls English proper nouns out of a Chinese summary', () => {
    expect(extractLatinEntities('OpenAI 发布了新模型 GPT-5，价格下调')).toEqual(
      expect.arrayContaining(['OpenAI', 'GPT-5']),
    )
  })
})

describe('extractNumbers', () => {
  it('ignores single digits (too generic to check)', () => {
    expect(extractNumbers('公司融资 3 轮')).toEqual([])
  })

  it('keeps multi-digit numbers', () => {
    expect(extractNumbers('融资 150 万美元')).toContain('150')
  })
})

describe('checkGrounding', () => {
  it('passes when every entity/number in the summary appears in the raw excerpt', () => {
    const raw = 'OpenAI announced GPT-5 today, raising $150 million in the process.'
    const summary = 'OpenAI 发布 GPT-5，同时完成 150 万美元融资。'
    const result = checkGrounding(summary, raw)
    expect(result.passed).toBe(true)
  })

  it('fails when the summary introduces a company name absent from the source', () => {
    const raw = 'OpenAI announced GPT-5 today.'
    const summary = 'OpenAI 与 Anthropic 联合发布 GPT-5。' // "Anthropic" 是编的
    const result = checkGrounding(summary, raw)
    expect(result.passed).toBe(false)
    expect(result.ungroundedEntities).toContain('Anthropic')
  })

  it('fails when the summary introduces a number absent from the source', () => {
    const raw = 'Meta updated its ad targeting policy this week.'
    const summary = 'Meta 本周更新了广告定向政策，预计影响 500 万广告主。' // "500" 是编的
    const result = checkGrounding(summary, raw)
    expect(result.passed).toBe(false)
    expect(result.ungroundedNumbers).toContain('500')
  })
})
