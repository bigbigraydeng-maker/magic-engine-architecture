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
  parseBudgetPatch,
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

  it('🔴 只传一个预算字段必须被拒 —— 否则一次部分更新会删掉预算并标成「本月不投」', () => {
    // 早先用 `?? null` 取值，「字段没传」和「显式传 null」变成同一件事：
    // 只传金额 null（没提币种）会被判成「完整清空」，
    // 于是删掉已填预算 + 标记本月确认不投 → 整个月不再提醒。
    const onlyAmount = parseBudgetPatch({ monthly_ad_budget: null })
    expect(onlyAmount.ok).toBe(false)
    const onlyCurrency = parseBudgetPatch({ monthly_ad_budget_currency: null })
    expect(onlyCurrency.ok).toBe(false)
    // 带值的半截请求同样拒
    expect(parseBudgetPatch({ monthly_ad_budget: 2000 }).ok).toBe(false)
  })

  it('两个都显式传 null 才是清空', () => {
    expect(
      parseBudgetPatch({ monthly_ad_budget: null, monthly_ad_budget_currency: null }),
    ).toEqual({ ok: true, kind: 'clear', amount: null, currency: null })
  })

  it('压根没提预算 = 这次不动它（不是错误）', () => {
    expect(parseBudgetPatch({ enabled: true })).toEqual({ ok: true, kind: 'untouched' })
  })

  it('正常设置', () => {
    expect(
      parseBudgetPatch({ monthly_ad_budget: 2000, monthly_ad_budget_currency: 'AUD' }),
    ).toEqual({ ok: true, kind: 'set', amount: 2000, currency: 'AUD' })
    // 数字字符串也收（表单传上来常是字符串）
    expect(
      parseBudgetPatch({ monthly_ad_budget: '2400', monthly_ad_budget_currency: 'NZD' }),
    ).toEqual({ ok: true, kind: 'set', amount: 2400, currency: 'NZD' })
  })

  it('🔴 非数值类型被拒 —— Number(true)===1、Number([2000])===2000', () => {
    for (const bad of [true, [2000], { v: 2000 }]) {
      const r = parseBudgetPatch({ monthly_ad_budget: bad, monthly_ad_budget_currency: 'AUD' })
      expect(r.ok).toBe(false)
    }
  })

  it('0 / 负数 / 无效币种被拒', () => {
    expect(parseBudgetPatch({ monthly_ad_budget: 0, monthly_ad_budget_currency: 'AUD' }).ok).toBe(false)
    expect(parseBudgetPatch({ monthly_ad_budget: -5, monthly_ad_budget_currency: 'AUD' }).ok).toBe(false)
    expect(parseBudgetPatch({ monthly_ad_budget: 2000, monthly_ad_budget_currency: 'USD' }).ok).toBe(false)
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
