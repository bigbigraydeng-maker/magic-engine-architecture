import { describe, it, expect } from 'vitest'
import { validateDraftFormat } from '../draft-post'

function filler(length: number): string {
  const base = 'This week we shipped a small improvement to how leads get routed. '
  let text = ''
  while (text.length < length) text += base
  return text.slice(0, length)
}

describe('validateDraftFormat', () => {
  it('passes a clean draft within length, hashtag, and plain-text bounds', () => {
    const text = `${filler(1000)}\n\n#buildinpublic #SaaS`
    expect(validateDraftFormat(text)).toHaveLength(0)
  })

  it('flags text shorter than 800 characters', () => {
    const violations = validateDraftFormat(filler(200))
    expect(violations.some((v) => v.rule === 'length')).toBe(true)
  })

  it('flags text longer than 1300 characters', () => {
    const violations = validateDraftFormat(filler(1500))
    expect(violations.some((v) => v.rule === 'length')).toBe(true)
  })

  it('flags more than 3 hashtags', () => {
    const text = `${filler(1000)}\n\n#one #two #three #four`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'hashtag_count')).toBe(true)
  })

  it('does not flag exactly 3 hashtags', () => {
    const text = `${filler(1000)}\n\n#one #two #three`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'hashtag_count')).toBe(false)
  })

  it('flags markdown headers', () => {
    const text = `## Big update\n\n${filler(1000)}`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'markdown')).toBe(true)
  })

  it('flags markdown bold', () => {
    const text = `${filler(1000)} **huge win** this week`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'markdown')).toBe(true)
  })

  it('flags markdown bullet lists', () => {
    const text = `${filler(1000)}\n- point one\n- point two`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'markdown')).toBe(true)
  })

  it('flags markdown links', () => {
    const text = `${filler(1000)} check [this out](https://example.com)`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'markdown')).toBe(true)
  })

  it('does not false-positive on a plain hashtag line (# with no following space)', () => {
    const text = `${filler(1000)}\n\n#buildinpublic`
    const violations = validateDraftFormat(text)
    expect(violations.some((v) => v.rule === 'markdown')).toBe(false)
  })
})
