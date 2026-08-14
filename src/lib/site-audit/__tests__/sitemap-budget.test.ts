/**
 * sitemap-budget — unit tests for the per-run sitemap request ledger
 * (Codex review on PR #963, P2). Pure state, no fetch, no network.
 */

import { describe, it, expect } from 'vitest'
import { createSitemapFetchBudget, MAX_SITEMAP_FETCHES } from '../sitemap-budget'

describe('createSitemapFetchBudget', () => {
  it('defaults to MAX_SITEMAP_FETCHES = 50', () => {
    expect(MAX_SITEMAP_FETCHES).toBe(50)
    expect(createSitemapFetchBudget().limit).toBe(50)
  })

  it('claims a fresh URL and returns it normalised', () => {
    const budget = createSitemapFetchBudget()
    expect(budget.claim('https://example.com/s.xml')).toEqual({
      fetch: true,
      url: 'https://example.com/s.xml',
    })
    expect(budget.spent()).toBe(1)
  })

  it('refuses the same URL a second time', () => {
    const budget = createSitemapFetchBudget()
    budget.claim('https://example.com/s.xml')
    expect(budget.claim('https://example.com/s.xml')).toEqual({
      fetch: false,
      reason: 'already-fetched',
    })
    expect(budget.spent()).toBe(1)
  })

  it('treats URLs that differ only by fragment, host case or default port as one', () => {
    const budget = createSitemapFetchBudget()
    expect(budget.claim('https://example.com/s.xml').fetch).toBe(true)
    expect(budget.claim('https://example.com/s.xml#part-2').fetch).toBe(false)
    expect(budget.claim('https://EXAMPLE.com/s.xml').fetch).toBe(false)
    expect(budget.claim('https://example.com:443/s.xml').fetch).toBe(false)
    expect(budget.spent()).toBe(1)
  })

  it('keeps genuinely different URLs apart, including query strings', () => {
    const budget = createSitemapFetchBudget()
    expect(budget.claim('https://example.com/s.php?type=post').fetch).toBe(true)
    expect(budget.claim('https://example.com/s.php?type=page').fetch).toBe(true)
    expect(budget.spent()).toBe(2)
  })

  it('de-duplicates unparseable input by its trimmed text without throwing', () => {
    const budget = createSitemapFetchBudget()
    expect(budget.claim('  not-a-url  ')).toEqual({ fetch: true, url: 'not-a-url' })
    expect(budget.claim('not-a-url').fetch).toBe(false)
    expect(budget.spent()).toBe(1)
  })

  it('de-duplicates BEFORE charging the budget, so repeats cannot exhaust it', () => {
    const budget = createSitemapFetchBudget(2)
    budget.claim('https://example.com/a.xml')
    for (let i = 0; i < 20; i++) budget.claim('https://example.com/a.xml')
    // The 20 repeats cost nothing: a second distinct URL still fits.
    expect(budget.claim('https://example.com/b.xml').fetch).toBe(true)
    expect(budget.spent()).toBe(2)
  })

  it('refuses everything once the allowance is spent', () => {
    const budget = createSitemapFetchBudget(2)
    expect(budget.claim('https://example.com/a.xml').fetch).toBe(true)
    expect(budget.claim('https://example.com/b.xml').fetch).toBe(true)
    expect(budget.claim('https://example.com/c.xml')).toEqual({
      fetch: false,
      reason: 'budget-exhausted',
    })
    expect(budget.spent()).toBe(2)
  })

  it('hands out the overrun notice exactly once', () => {
    const budget = createSitemapFetchBudget(1)
    budget.claim('https://example.com/a.xml')
    budget.claim('https://example.com/b.xml')
    budget.claim('https://example.com/c.xml')
    expect(budget.takeOverrunNotice()).toBe(true)
    expect(budget.takeOverrunNotice()).toBe(false)
    expect(budget.takeOverrunNotice()).toBe(false)
  })

  it('gives each instance its own ledger', () => {
    const a = createSitemapFetchBudget(1)
    const b = createSitemapFetchBudget(1)
    expect(a.claim('https://example.com/s.xml').fetch).toBe(true)
    expect(b.claim('https://example.com/s.xml').fetch).toBe(true)
  })
})
