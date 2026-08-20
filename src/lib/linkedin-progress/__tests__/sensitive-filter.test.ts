import { describe, it, expect } from 'vitest'
import { findSensitiveMatches } from '../sensitive-filter'

describe('findSensitiveMatches', () => {
  it('flags a real client name mentioned in text', () => {
    const matches = findSensitiveMatches('CTS 实测，358 个人只被机器回过', ['CTS', 'Oztop'])
    expect(matches.some((m) => m.kind === 'client' && m.term === 'CTS')).toBe(true)
  })

  it('flags an internal agent codename', () => {
    const matches = findSensitiveMatches('子牙决定了这次的架构方案', [])
    expect(matches.some((m) => m.kind === 'internal_codename' && m.term === '子牙')).toBe(true)
  })

  it('flags internal jargon like "migration" and "RLS"', () => {
    const matches = findSensitiveMatches('We shipped a new migration with an RLS policy fix', [])
    expect(matches.some((m) => m.term.toLowerCase() === 'migration')).toBe(true)
    expect(matches.some((m) => m.term === 'RLS')).toBe(true)
  })

  it('flags a Phase-ID tag like P21.J.M1', () => {
    const matches = findSensitiveMatches('shipped under P21.J.M1 this week', [])
    expect(matches.some((m) => m.term === 'P21.J.M1')).toBe(true)
  })

  it('does NOT false-positive on short ASCII jargon terms inside unrelated words (word-boundary match)', () => {
    // "cron" is banned jargon, but "acronym" contains "cron" as a substring —
    // a naive .includes() check would wrongly flag this clean sentence.
    const matches = findSensitiveMatches('We fixed an acronym in the onboarding copy', [])
    expect(matches.some((m) => m.term === 'cron')).toBe(false)
  })

  it('does not flag clean, generic text with no client keywords configured', () => {
    const matches = findSensitiveMatches(
      'This week we shipped a smarter way to catch stale leads before they go cold.',
      ['CTS', 'Oztop'],
    )
    expect(matches).toHaveLength(0)
  })

  it('client keyword matching is case-insensitive', () => {
    const matches = findSensitiveMatches('a note about cts operations', ['CTS'])
    expect(matches.some((m) => m.kind === 'client')).toBe(true)
  })

  it('CJK client names match as plain substrings (no word-boundary requirement)', () => {
    const matches = findSensitiveMatches('这周帮陶瓷世界优化了页面', ['陶瓷世界'])
    expect(matches.some((m) => m.kind === 'client' && m.term === '陶瓷世界')).toBe(true)
  })
})
