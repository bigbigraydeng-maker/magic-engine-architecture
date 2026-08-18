/**
 * Tests for per-client config resolution — P21.K.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const maybeSingle = vi.fn()
/** 每次查询的 select 列清单 —— 测试要能断言「读了哪几列」，不只是「读到了什么」。 */
const selectedColumns: string[] = []
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: (cols: string) => {
        selectedColumns.push(cols)
        return { eq: () => ({ maybeSingle }) }
      },
    }),
  },
}))

import {
  buildConfigUpdate,
  currencyForCountry,
  defaultConfig,
  emptyBudgetFields,
  loadAdBudgetFields,
  normalizeBudgetFields,
  parseBudgetPatch,
  resolveDigestRecipients,
  loadAdStrategyConfigWithSource,
} from '../config'

describe('loadAdStrategyConfigWithSource — asymmetric fail-open', () => {
  beforeEach(() => {
    maybeSingle.mockReset()
    selectedColumns.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
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

describe('🔴 日报那条读路不许 select 新加的列（子牙 2026-08-18 阻止项 1）', () => {
  beforeEach(() => {
    maybeSingle.mockReset()
    selectedColumns.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  /**
   * 这条查询喂的是每日广告体检 cron 的发信闸（`adConfigSource !== 'fallback'`）。
   * PostgREST 对不存在的列是**整个查询报错**（42703），不是把那列返回 null。
   * 所以只要有人往这里加一个还没 apply 到生产的列，日报邮件就会**全客户静默停发**，
   * 日志里只有一行 console.warn —— 已上线功能被一个还没上线的新功能带塌。
   */
  it('只读原有三列，一个预算列都不许出现', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await loadAdStrategyConfigWithSource('c1')
    expect(selectedColumns).toHaveLength(1)
    expect(selectedColumns[0]).toBe('client_id, enabled, digest_recipients')
    expect(selectedColumns[0]).not.toMatch(/monthly_ad_budget/)
  })

  it('预算列另走一条读路，读不到返回 null（不是「都没填」）', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'column does not exist' } })
    // 🔴 null 和 emptyBudgetFields() 必须分得开：前者是「没查到」，后者是「真没填」。
    //    当成后者就会给每个客户推一条谁也处理不了的催办。
    expect(await loadAdBudgetFields('c1')).toBeNull()
    expect(selectedColumns[0]).toMatch(/monthly_ad_budget_month/)
  })

  it('没有配置行 = 真的没填（不是读失败）', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    expect(await loadAdBudgetFields('c1')).toEqual(emptyBudgetFields())
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
    expect(emptyBudgetFields()).toEqual({
      monthly_ad_budget: null,
      monthly_ad_budget_currency: null,
      monthly_ad_budget_updated_at: null,
      monthly_ad_budget_month: null,
    })
  })

  it('🔴 只填一半（有金额没币种）读出来当没填 —— 不猜一个币种出来', () => {
    expect(normalizeBudgetFields({ monthly_ad_budget: 2000, monthly_ad_budget_currency: null }))
      .toMatchObject({ monthly_ad_budget: null, monthly_ad_budget_currency: null })
  })

  it('🔴 月份形状歪了当没有 —— 歪掉的月份永远比不上，会变成「看起来填了、待办天天催」', () => {
    for (const bad of ['2026-13', '2026-1', 'not-a-month', '', 20268, null]) {
      expect(normalizeBudgetFields({ monthly_ad_budget_month: bad }).monthly_ad_budget_month).toBeNull()
    }
    expect(normalizeBudgetFields({ monthly_ad_budget_month: '2026-09' }).monthly_ad_budget_month).toBe('2026-09')
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

describe('buildConfigUpdate — 四态判定的锚点（魏征 2026-08-18 阻止项 B1）', () => {
  /**
   * 整套 filled / stale / declined / missing 判定，唯一的锚点就是这个函数写不写
   * `monthly_ad_budget_month` + `monthly_ad_budget_updated_at`。
   *
   * 这两行原本躺在没有任何测试的路由里 —— 实测把写时间戳那一行整行删掉，
   * 403 个测试全绿。也就是说日后任何一次无关重构删掉它，不会有任何东西响：
   * FDE 清空预算后界面照旧说「还没填」，而今日待办每天继续催到月底。
   */
  const NOW = new Date('2026-08-18T02:00:00Z')

  it('设置预算时必须写下月份、时间戳和操作人', () => {
    const r = buildConfigUpdate({
      clientId: 'c1',
      body: { monthly_ad_budget: 2000, monthly_ad_budget_currency: 'NZD' },
      actorEmail: 'fde@example.com',
      country: 'NZ',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.update.monthly_ad_budget).toBe(2000)
    expect(r.update.monthly_ad_budget_currency).toBe('NZD')
    expect(r.update.monthly_ad_budget_month).toBe('2026-08')
    expect(r.update.monthly_ad_budget_updated_at).toBe(NOW.toISOString())
    expect(r.update.monthly_ad_budget_updated_by).toBe('fde@example.com')
  })

  it('🔴 「清空」也必须写月份和时间戳 —— 那是「本月确认不投」这个决定本身', () => {
    const r = buildConfigUpdate({
      clientId: 'c1',
      body: { monthly_ad_budget: null, monthly_ad_budget_currency: null },
      actorEmail: 'fde@example.com',
      country: 'NZ',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.update.monthly_ad_budget).toBeNull()
    // 不写这两个，「本月确认不投」就跟「从没问过」长得一模一样，待办会一直催到月底
    expect(r.update.monthly_ad_budget_month).toBe('2026-08')
    expect(r.update.monthly_ad_budget_updated_at).toBe(NOW.toISOString())
  })

  it('没提预算就一个预算列都不许动（改收件人不该顺手重置预算月份）', () => {
    const r = buildConfigUpdate({
      clientId: 'c1',
      body: { digest_recipients: ['a@b.com'] },
      actorEmail: null,
      country: 'NZ',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.update).not.toHaveProperty('monthly_ad_budget')
    expect(r.update).not.toHaveProperty('monthly_ad_budget_month')
    expect(r.update).not.toHaveProperty('monthly_ad_budget_updated_at')
    expect(r.update.digest_recipients).toEqual(['a@b.com'])
  })

  it('🔴 悉尼客户 9/30 22:30 存的预算必须记成 9 月（原 C1 的回归测试）', () => {
    // 悉尼 2026-09-30 22:30 AEST(+10) = 12:30 UTC；此刻 NZ 已经是 10/1 00:30。
    // 旧实现固定按 NZ 推月份 → 记成「10 月已确认」→ 整个 10 月不再生成复核待办。
    const sydneyLateSept = new Date('2026-09-30T12:30:00Z')
    const au = buildConfigUpdate({
      clientId: 'oztop',
      body: { monthly_ad_budget: 3000, monthly_ad_budget_currency: 'AUD' },
      actorEmail: null,
      country: 'AU',
      now: sydneyLateSept,
    })
    expect(au.ok).toBe(true)
    if (!au.ok) return
    expect(au.update.monthly_ad_budget_month).toBe('2026-09')

    // 同一时刻的 NZ 客户确实已经进入 10 月 —— 两边**本来就该不一样**
    const nz = buildConfigUpdate({
      clientId: 'cts',
      body: { monthly_ad_budget: 3000, monthly_ad_budget_currency: 'NZD' },
      actorEmail: null,
      country: 'NZ',
      now: sydneyLateSept,
    })
    expect(nz.ok).toBe(true)
    if (!nz.ok) return
    expect(nz.update.monthly_ad_budget_month).toBe('2026-10')
  })

  it('国家判不出来按 NZ 兜底 —— 方向是「多催一次」，不是「整月不催」', () => {
    const r = buildConfigUpdate({
      clientId: 'c1',
      body: { monthly_ad_budget: 100, monthly_ad_budget_currency: 'NZD' },
      actorEmail: null,
      country: null,
      now: new Date('2026-09-30T12:30:00Z'),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.update.monthly_ad_budget_month).toBe('2026-10')
  })

  it('半截预算请求 / 坏邮箱 / 坏开关都被拒，且一列都没写', () => {
    expect(buildConfigUpdate({ clientId: 'c1', body: { monthly_ad_budget: 2000 }, actorEmail: null, country: 'NZ', now: NOW }).ok).toBe(false)
    expect(buildConfigUpdate({ clientId: 'c1', body: { digest_recipients: ['nope'] }, actorEmail: null, country: 'NZ', now: NOW }).ok).toBe(false)
    expect(buildConfigUpdate({ clientId: 'c1', body: { enabled: 'yes' }, actorEmail: null, country: 'NZ', now: NOW }).ok).toBe(false)
  })

  it('client_id 永远来自路由参数，body 里塞别的客户改不动', () => {
    const r = buildConfigUpdate({
      clientId: 'real-client',
      body: { client_id: 'someone-else', enabled: false },
      actorEmail: null,
      country: 'NZ',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.update.client_id).toBe('real-client')
  })
})
