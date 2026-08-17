/**
 * 「在投广告却没登记月预算」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是 —— 该报的报了、不该报的不刷屏、金额没被重复计算、
 * 以及那两条最容易被写错的口径：「没填 ≠ 填 0」「不知道币种就不比大小」。
 */

import { describe, it, expect } from 'vitest'
import {
  EXPLORATION_BUDGET_SHARE,
  explorationPool,
  fetchAdsAngleTestTodos,
  formatSpend,
  loadMonthSpendByClient,
} from '../ads-angle-test-items'
import { toRealAmount } from '@/lib/ads-strategy/config'

const NOW = new Date('2026-08-17T09:00:00Z')

interface InsightRow {
  client_id: string
  level: string
  spend: unknown
}
interface ConfigRow {
  client_id: string
  monthly_ad_budget: unknown
  monthly_ad_budget_currency: unknown
}

function fakeSupabase(opts: {
  insights?: InsightRow[]
  insightsError?: string
  configs?: ConfigRow[]
  configsError?: string
}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.gte = () => chain
      chain.in = () => {
        if (table === 'ad_daily_insights') {
          return Promise.resolve(
            opts.insightsError
              ? { data: null, error: { message: opts.insightsError } }
              : { data: opts.insights ?? [], error: null },
          )
        }
        if (table === 'ad_strategy_configs') {
          return Promise.resolve(
            opts.configsError
              ? { data: null, error: { message: opts.configsError } }
              : { data: opts.configs ?? [], error: null },
          )
        }
        throw new Error(`fake supabase: table '${table}' is not modelled`)
      }
      return chain
    },
  } as never
}

describe('toRealAmount —— 「没填」和「填了 0」必须分得开', () => {
  it('🔴 空值一律是 null，不是 0', () => {
    expect(toRealAmount(null)).toBeNull()
    expect(toRealAmount(undefined)).toBeNull()
    expect(toRealAmount('')).toBeNull()
    expect(toRealAmount('   ')).toBeNull()
  })

  it('🔴 0 和负数不算金额 —— 0 会让探索池算出 0，看起来像「算过了，结论是别测」', () => {
    expect(toRealAmount(0)).toBeNull()
    expect(toRealAmount('0')).toBeNull()
    expect(toRealAmount(-100)).toBeNull()
  })

  it('🔴 NaN / Infinity 拦住 —— 跟库里 CHECK 同一套判据', () => {
    expect(toRealAmount(NaN)).toBeNull()
    expect(toRealAmount('NaN')).toBeNull()
    expect(toRealAmount(Infinity)).toBeNull()
    expect(toRealAmount('Infinity')).toBeNull()
  })

  it('数字和字符串都收（numeric 经 PostgREST 两种都可能）', () => {
    expect(toRealAmount(2000)).toBe(2000)
    expect(toRealAmount('1234.56')).toBe(1234.56)
  })
})

describe('explorationPool', () => {
  it('探索池 = 月预算 × 20%（PO 2026-08-15 决议）', () => {
    expect(EXPLORATION_BUDGET_SHARE).toBe(0.2)
    expect(explorationPool(2000)).toBe(400)
    expect(explorationPool(747.5)).toBeCloseTo(149.5)
  })
})

describe('formatSpend', () => {
  it('两位小数 + 千分位，不带币种符号（这张表没有币种列）', () => {
    expect(formatSpend(957.65)).toBe('957.65')
    expect(formatSpend(3608.27)).toBe('3,608.27')
    expect(formatSpend(1000)).toBe('1,000.00')
  })
})

describe('loadMonthSpendByClient', () => {
  it('🔴 同一笔钱在 campaign 和 ad 两层各有一行 —— 只能算一次，不能相加', async () => {
    // 实测形状：两层各自加总都等于同一个数（Oztop 本月 957.65）
    const rows = await loadMonthSpendByClient(
      fakeSupabase({
        insights: [
          { client_id: 'oztop', level: 'campaign', spend: 900 },
          { client_id: 'oztop', level: 'campaign', spend: 57.65 },
          { client_id: 'oztop', level: 'ad', spend: 900 },
          { client_id: 'oztop', level: 'ad', spend: 57.65 },
        ],
      }),
      NOW,
    )
    expect(rows).toHaveLength(1)
    // 相加会得到 1915.30 —— 那是个假金额，会让人以为花了两倍
    expect(rows[0].spend).toBeCloseTo(957.65)
  })

  it('只有 ad 层数据的客户不会被漏掉（退回 ad 层求和）', async () => {
    const rows = await loadMonthSpendByClient(
      fakeSupabase({ insights: [{ client_id: 'roman', level: 'ad', spend: 292.42 }] }),
      NOW,
    )
    expect(rows).toEqual([{ clientId: 'roman', spend: 292.42 }])
  })

  it('有行但一分没花的不算在投 —— 广告挂着没花钱，还没到要定预算的时候', async () => {
    const rows = await loadMonthSpendByClient(
      fakeSupabase({ insights: [{ client_id: 'idle', level: 'campaign', spend: 0 }] }),
      NOW,
    )
    expect(rows).toEqual([])
  })

  it('读不到就当没有，不炸（不阻塞其他待办）', async () => {
    expect(
      await loadMonthSpendByClient(fakeSupabase({ insightsError: 'boom' }), NOW),
    ).toEqual([])
  })
})

describe('fetchAdsAngleTestTodos', () => {
  const spending: InsightRow[] = [
    { client_id: 'oztop', level: 'campaign', spend: 957.65 },
    { client_id: 'cts', level: 'campaign', spend: 292.99 },
  ]

  it('在投广告 + 没填预算 → 每个客户一条', async () => {
    const todos = await fetchAdsAngleTestTodos(fakeSupabase({ insights: spending }), NOW)
    expect(todos.map((t) => t.client_id).sort()).toEqual(['cts', 'oztop'])
  })

  it('🔴 what 要说清已花多少、以及卡住了什么', async () => {
    const [t] = await fetchAdsAngleTestTodos(
      fakeSupabase({ insights: [spending[0]] }),
      NOW,
    )
    expect(t.what).toContain('957.65')
    expect(t.what).toContain('账户币种') // 没有币种列，不许假装知道是 AUD 还是 NZD
    expect(t.what).toContain('20%')
    expect(t.what).toContain('没登记他的月广告预算')
  })

  it('🔴 how 要拦住「拿已花金额倒推预算」—— SOP 初稿正是这么算错的', async () => {
    const [t] = await fetchAdsAngleTestTodos(fakeSupabase({ insights: [spending[0]] }), NOW)
    expect(t.how).toContain('别拿上面那个已花金额倒推')
    expect(t.how).toContain('币种')
    expect(t.how).toContain('留空') // 这个月不投的正确表达是留空，不是填 0
  })

  it('🔴 href 必须是绝对网址且直达设置页 —— 相对路径会被链接闸判成坏链整条丢掉', async () => {
    const [t] = await fetchAdsAngleTestTodos(fakeSupabase({ insights: [spending[0]] }), NOW)
    expect(t.href).toBe('https://app.magicengine.com.au/dashboard/clients/oztop/settings')
  })

  it('填好了就不再打扰', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: spending,
        configs: [
          { client_id: 'oztop', monthly_ad_budget: 2000, monthly_ad_budget_currency: 'AUD' },
          { client_id: 'cts', monthly_ad_budget: '2400', monthly_ad_budget_currency: 'NZD' },
        ],
      }),
      NOW,
    )
    expect(todos).toEqual([])
  })

  it('🔴 只填了金额没填币种 = 没填完 —— 不许当成填好了（AD-CUR-1 的同一个洞）', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: [spending[0]],
        configs: [{ client_id: 'oztop', monthly_ad_budget: 2000, monthly_ad_budget_currency: null }],
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
  })

  it('🔴 填了 0 不算填 —— 0 会让探索池算出 0，看起来像「算过了，结论是别测」', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: [spending[0]],
        configs: [{ client_id: 'oztop', monthly_ad_budget: 0, monthly_ad_budget_currency: 'AUD' }],
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
  })

  it('没在投广告的客户不打扰 —— 没投就还不需要定预算', async () => {
    expect(await fetchAdsAngleTestTodos(fakeSupabase({ insights: [] }), NOW)).toEqual([])
  })

  it('🔴 配置表读不到时整轮不下发 —— 迁移没 apply 的环境会每个客户推一条谁也处理不了的噪音', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({ insights: spending, configsError: 'column does not exist' }),
      NOW,
    )
    expect(todos).toEqual([])
  })
})
