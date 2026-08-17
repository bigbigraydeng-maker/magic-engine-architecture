/**
 * Tests for per-client config resolution — P21.K.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}))

import {
  currencyForCountry,
  defaultConfig,
  resolveDigestRecipients,
  loadAdStrategyConfigWithSource,
} from '../config'

describe('loadAdStrategyConfigWithSource — asymmetric fail-open', () => {
  beforeEach(() => { maybeSingle.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('marks a read error as fallback (so the caller can skip emailing)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const { config, source } = await loadAdStrategyConfigWithSource('c1')
    // Still enabled for data collection, but flagged as a guess.
    expect(config.enabled).toBe(true)
    expect(source).toBe('fallback')
  })

  it('marks a missing row as default (a fresh client, legitimately on)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const { config, source } = await loadAdStrategyConfigWithSource('c1')
    expect(config.enabled).toBe(true)
    expect(source).toBe('default')
  })

  it('passes a real row through as source row', async () => {
    maybeSingle.mockResolvedValue({ data: { client_id: 'c1', enabled: false, digest_recipients: ['a@b.com'] }, error: null })
    const { config, source } = await loadAdStrategyConfigWithSource('c1')
    expect(config.enabled).toBe(false)
    expect(config.digest_recipients).toEqual(['a@b.com'])
    expect(source).toBe('row')
  })
})

describe('defaultConfig', () => {
  it('defaults a client with no row to enabled, global recipient', () => {
    const c = defaultConfig('client-1')
    expect(c.enabled).toBe(true)
    expect(c.digest_recipients).toEqual([])
  })

  it('🔴 币种按客户所在国推荐，判断不出来就返回 null（不给默认币种）', () => {
    // 写死一个默认币种会让 AU 客户（Oztop）的预算被默默存成纽币 —— AD-CUR-1 的新入口
    expect(currencyForCountry('AU')).toBe('AUD')
    expect(currencyForCountry('au')).toBe('AUD')
    expect(currencyForCountry(' Australia ')).toBe('AUD')
    expect(currencyForCountry('NZ')).toBe('NZD')
    expect(currencyForCountry('New Zealand')).toBe('NZD')
    // 拿不准一律 null，让界面强制人选一次
    expect(currencyForCountry(null)).toBeNull()
    expect(currencyForCountry('')).toBeNull()
    expect(currencyForCountry('US')).toBeNull()
    expect(currencyForCountry(42)).toBeNull()
  })

  it('🔴 月预算默认是 null，不给任何猜测值 —— 猜出来的池子是真要花出去的钱', () => {
    const c = defaultConfig('client-1')
    expect(c.monthly_ad_budget).toBeNull()
    expect(c.monthly_ad_budget_currency).toBeNull()
    expect(c.monthly_ad_budget_updated_at).toBeNull()
  })
})

describe('resolveDigestRecipients', () => {
  const OLD = process.env.AD_HEALTH_DIGEST_TO
  beforeEach(() => { delete process.env.AD_HEALTH_DIGEST_TO })
  afterEach(() => { if (OLD) process.env.AD_HEALTH_DIGEST_TO = OLD; else delete process.env.AD_HEALTH_DIGEST_TO })

  it('uses the client list when set', () => {
    expect(resolveDigestRecipients({ digest_recipients: ['a@b.com', 'c@d.com'] }))
      .toEqual(['a@b.com', 'c@d.com'])
  })

  it('falls back to the env inbox when the client list is empty', () => {
    process.env.AD_HEALTH_DIGEST_TO = 'ops@magicengine.com.au'
    expect(resolveDigestRecipients({ digest_recipients: [] }))
      .toEqual(['ops@magicengine.com.au'])
  })

  it('falls back to the shared verified-domain ME inbox when no env is set', () => {
    expect(resolveDigestRecipients({ digest_recipients: [] }))
      .toEqual(['hello@magicengine.cloud'])
  })
})
