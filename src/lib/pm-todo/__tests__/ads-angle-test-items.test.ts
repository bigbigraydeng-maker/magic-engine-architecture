/**
 * 「在投广告却没登记月预算」这条待办。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是 —— 该报的报了、不该报的不刷屏、金额没被重复计算，
 * 以及四条最容易写错的口径：
 *   ① 预算按月失效（上个月填的不算这个月填过）
 *   ② 月份边界按 NZ 本地时间，不按 UTC
 *   ③ 只给活跃客户下发
 *   ④ 混账户下的金额只敢说「账户口径」，不敢说成「这个客户花的」
 */

import { describe, it, expect } from 'vitest'
import {
  EXPLORATION_BUDGET_SHARE,
  businessMonth,
  businessMonthStart,
  explorationPool,
  fetchAdsAngleTestTodos,
  formatSpend,
  loadBudgetStateByClient,
  loadMonthSpendByClient,
} from '../ads-angle-test-items'
import { toRealAmount } from '@/lib/ads-strategy/config'

const NOW = new Date('2026-08-17T09:00:00Z') // NZ: 2026-08-17 21:00 → 业务月 2026-08
const ACTIVE = ['oztop', 'cts', 'roman']

interface InsightRow {
  client_id: string
  level: string
  spend: unknown
}
interface ConfigRow {
  client_id: string
  monthly_ad_budget: unknown
  monthly_ad_budget_currency: unknown
  monthly_ad_budget_updated_at?: unknown
}

/** 记录假件被怎么调用的 —— 用来证明「真的走了分页」，而不是只看结果对不对。 */
const calls = { ranged: false }

/** 空的一页：`fetchAll` 见到它就停。 */
function emptyPage() {
  return Promise.resolve({ data: [], error: null })
}

function fakeSupabase(opts: {
  insights?: InsightRow[]
  insightsError?: string
  configs?: ConfigRow[]
  configsError?: string
}) {
  calls.ranged = false
  return {
    from(table: string) {
      // 🔴 假件必须真的执行 `.in('client_id', …)` 过滤。
      //    不执行的话，「只给活跃客户下发」这条测试永远是绿的 ——
      //    测了个寂寞，而那正是这次要修的缺陷之一。
      const filters: Record<string, string[]> = {}

      const settle = () => {
        const keep = <T extends { client_id: string }>(rows: T[]) =>
          filters.client_id ? rows.filter((r) => filters.client_id.includes(r.client_id)) : rows

        if (table === 'ad_daily_insights') {
          return Promise.resolve(
            opts.insightsError
              ? { data: null, error: { message: opts.insightsError } }
              : { data: keep(opts.insights ?? []), error: null },
          )
        }
        if (table === 'ad_strategy_configs') {
          return Promise.resolve(
            opts.configsError
              ? { data: null, error: { message: opts.configsError } }
              : { data: keep(opts.configs ?? []), error: null },
          )
        }
        throw new Error(`fake supabase: table '${table}' is not modelled`)
      }

      // 可在任意一环 await —— 查询链的长度不该让假件跟着改
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.gte = () => chain
      chain.order = () => chain
      chain.range = (from: number) => {
        calls.ranged = true
        // 只有第一页有数据：fetchAll 见到不满一页就收工
        return from === 0 ? chain : emptyPage()
      }
      chain.in = (col: string, vals: string[]) => {
        filters[col] = vals
        return chain
      }
      chain.then = (res: unknown, rej: unknown) =>
        settle().then(res as never, rej as never)
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

  it('🔴 只认数字和数字字符串 —— Number() 会把 true 变成 1、[2000] 变成 2000', () => {
    // 不卡类型的话，一个坏掉的调用方能把「预算 1 元」写进库，
    // 而库里的 > 0 约束对这种「转换出来的合法值」完全无感
    expect(toRealAmount(true)).toBeNull()
    expect(toRealAmount([2000])).toBeNull()
    expect(toRealAmount({ amount: 2000 })).toBeNull()
    expect(toRealAmount(() => 2000)).toBeNull()
  })
})

describe('explorationPool', () => {
  it('探索池 = 月预算 × 20%（PO 2026-08-15 决议）', () => {
    expect(EXPLORATION_BUDGET_SHARE).toBe(0.2)
    expect(explorationPool(2000)).toBe(400)
    expect(explorationPool(747.5)).toBeCloseTo(149.5)
  })
})

describe('业务月份按 NZ 本地时间算', () => {
  it('🔴 UTC 还在 8 月 31 日、NZ 已进入 9 月时，月初必须是 9 月 1 日', () => {
    // 今日待办 cron 固定 19:00 UTC 跑；这一刻 NZ 是 9 月 1 日早上 7 点。
    // 按 UTC 算会从 8 月 1 日起算，把上个月一整月的花费当成「这个月」。
    const atCron = new Date('2026-08-31T19:00:00Z')
    expect(businessMonth(atCron)).toBe('2026-09')
    expect(businessMonthStart(atCron)).toBe('2026-09-01')
  })

  it('月中不受影响', () => {
    expect(businessMonthStart(NOW)).toBe('2026-08-01')
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
      ACTIVE,
    )
    expect(rows).toHaveLength(1)
    // 相加会得到 1915.30 —— 那是个假金额，会让人以为花了两倍
    expect(rows[0].spend).toBeCloseTo(957.65)
  })

  it('只有 ad 层数据的客户不会被漏掉（退回 ad 层求和）', async () => {
    const rows = await loadMonthSpendByClient(
      fakeSupabase({ insights: [{ client_id: 'roman', level: 'ad', spend: 292.42 }] }),
      NOW,
      ACTIVE,
    )
    expect(rows).toEqual([{ clientId: 'roman', spend: 292.42 }])
  })

  it('有行但一分没花的不算在投 —— 广告挂着没花钱，还没到要定预算的时候', async () => {
    const rows = await loadMonthSpendByClient(
      fakeSupabase({ insights: [{ client_id: 'idle', level: 'campaign', spend: 0 }] }),
      NOW,
      ACTIVE,
    )
    expect(rows).toEqual([])
  })

  it('🔴 没有活跃客户就直接不查 —— 别为已停用客户的历史花费行造待办', async () => {
    expect(await loadMonthSpendByClient(fakeSupabase({}), NOW, [])).toEqual([])
  })

  it('🔴 必须走分页读全 —— PostgREST 硬顶 1000 行且不报错，截断后分组会让排在后面的客户整个消失', async () => {
    await loadMonthSpendByClient(
      fakeSupabase({ insights: [{ client_id: 'oztop', level: 'campaign', spend: 10 }] }),
      NOW,
      ACTIVE,
    )
    expect(calls.ranged).toBe(true)
  })

  it('读不到就当没有，不炸（不阻塞其他待办）', async () => {
    expect(
      await loadMonthSpendByClient(fakeSupabase({ insightsError: 'boom' }), NOW, ACTIVE),
    ).toEqual([])
  })
})

describe('loadBudgetStateByClient —— 预算按月失效', () => {
  const row = (over: Partial<ConfigRow> = {}): ConfigRow => ({
    client_id: 'oztop',
    monthly_ad_budget: 2000,
    monthly_ad_budget_currency: 'AUD',
    monthly_ad_budget_updated_at: '2026-08-05T00:00:00Z',
    ...over,
  })

  it('这个月填的 → filled', async () => {
    const m = await loadBudgetStateByClient(fakeSupabase({ configs: [row()] }), ['oztop'], NOW)
    expect(m!.get('oztop')!.status).toBe('filled')
  })

  it('🔴 上个月填的 → stale，不是 filled —— 否则这个月的待办永远不出现', async () => {
    const m = await loadBudgetStateByClient(
      fakeSupabase({ configs: [row({ monthly_ad_budget_updated_at: '2026-07-20T00:00:00Z' })] }),
      ['oztop'],
      NOW,
    )
    const s = m!.get('oztop')!
    expect(s.status).toBe('stale')
    expect(s.amount).toBe(2000) // 上次填的值要带出来，好在待办里说清
    expect(s.currency).toBe('AUD')
  })

  it('🔴 时间戳缺失或解析不出来 → 按 stale 处理（方向安全：多问一次好过用来路不明的数字算钱）', async () => {
    for (const bad of [null, '', 'not-a-date']) {
      const m = await loadBudgetStateByClient(
        fakeSupabase({ configs: [row({ monthly_ad_budget_updated_at: bad })] }),
        ['oztop'],
        NOW,
      )
      expect(m!.get('oztop')!.status).toBe('stale')
    }
  })

  it('时间戳落在 NZ 的本月内就算新 —— 边界按 NZ 切，不按 UTC', async () => {
    // UTC 还是 7-31，NZ 已是 8-01 → 属于本业务月
    const m = await loadBudgetStateByClient(
      fakeSupabase({ configs: [row({ monthly_ad_budget_updated_at: '2026-07-31T13:00:00Z' })] }),
      ['oztop'],
      NOW,
    )
    expect(m!.get('oztop')!.status).toBe('filled')
  })

  it('只填金额没填币种 → missing（AD-CUR-1 的同一个洞）', async () => {
    const m = await loadBudgetStateByClient(
      fakeSupabase({ configs: [row({ monthly_ad_budget_currency: null })] }),
      ['oztop'],
      NOW,
    )
    expect(m!.get('oztop')!.status).toBe('missing')
  })

  it('🔴 这个月清空过 → declined（本月确认不投），不是 missing', async () => {
    const m = await loadBudgetStateByClient(
      fakeSupabase({
        configs: [
          row({
            monthly_ad_budget: null,
            monthly_ad_budget_currency: null,
            monthly_ad_budget_updated_at: '2026-08-11T00:00:00Z',
          }),
        ],
      }),
      ['oztop'],
      NOW,
    )
    expect(m!.get('oztop')!.status).toBe('declined')
  })

  it('🔴 上个月清空的不算数 → missing —— 上个月不投不代表这个月也不投', async () => {
    const m = await loadBudgetStateByClient(
      fakeSupabase({
        configs: [
          row({
            monthly_ad_budget: null,
            monthly_ad_budget_currency: null,
            monthly_ad_budget_updated_at: '2026-07-11T00:00:00Z',
          }),
        ],
      }),
      ['oztop'],
      NOW,
    )
    expect(m!.get('oztop')!.status).toBe('missing')
  })

  it('填 0 → missing', async () => {
    const m = await loadBudgetStateByClient(
      fakeSupabase({ configs: [row({ monthly_ad_budget: 0 })] }),
      ['oztop'],
      NOW,
    )
    expect(m!.get('oztop')!.status).toBe('missing')
  })

  it('🔴 读不到时返回 null，交给调用方整轮不下发', async () => {
    expect(
      await loadBudgetStateByClient(fakeSupabase({ configsError: 'column does not exist' }), ['oztop'], NOW),
    ).toBeNull()
  })
})

describe('fetchAdsAngleTestTodos', () => {
  const spending: InsightRow[] = [
    { client_id: 'oztop', level: 'campaign', spend: 957.65 },
    { client_id: 'cts', level: 'campaign', spend: 292.99 },
  ]

  it('在投广告 + 没填预算 → 每个客户一条', async () => {
    const todos = await fetchAdsAngleTestTodos(fakeSupabase({ insights: spending }), NOW, ACTIVE)
    expect(todos.map((t) => t.client_id).sort()).toEqual(['cts', 'oztop'])
  })

  it('🔴 金额只说「账户口径」，不许说成这个客户花的 —— 混账户下这一列证明不了归属', async () => {
    const [t] = await fetchAdsAngleTestTodos(
      fakeSupabase({ insights: [spending[0]] }),
      NOW,
      ACTIVE,
    )
    expect(t.what).toContain('957.65')
    expect(t.what).toContain('账户口径')
    expect(t.what).toContain('可能含别家 campaign')
    // 审计 §3.1 与 SOP §9 都为这个口径更正过，不许第三次重犯
    expect(t.what).not.toContain('他花掉')
  })

  it('🔴 what 要说清卡住了什么', async () => {
    const [t] = await fetchAdsAngleTestTodos(fakeSupabase({ insights: [spending[0]] }), NOW, ACTIVE)
    expect(t.what).toContain('20%')
    expect(t.what).toContain('没登记他的月广告预算')
  })

  it('🔴 how 要拦住「拿已花金额倒推预算」—— SOP 初稿正是这么算错的', async () => {
    const [t] = await fetchAdsAngleTestTodos(fakeSupabase({ insights: [spending[0]] }), NOW, ACTIVE)
    expect(t.how).toContain('别拿上面那个已花金额倒推')
    expect(t.how).toContain('币种')
    expect(t.how).toContain('留空')
  })

  it('🔴 href 必须是绝对网址且直达设置页 —— 相对路径会被链接闸判成坏链整条丢掉', async () => {
    const [t] = await fetchAdsAngleTestTodos(fakeSupabase({ insights: [spending[0]] }), NOW, ACTIVE)
    expect(t.href).toBe('https://app.magicengine.com.au/dashboard/clients/oztop/settings')
  })

  it('这个月填好了就不再打扰', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: spending,
        configs: [
          {
            client_id: 'oztop',
            monthly_ad_budget: 2000,
            monthly_ad_budget_currency: 'AUD',
            monthly_ad_budget_updated_at: '2026-08-02T00:00:00Z',
          },
          {
            client_id: 'cts',
            monthly_ad_budget: '2400',
            monthly_ad_budget_currency: 'NZD',
            monthly_ad_budget_updated_at: '2026-08-16T00:00:00Z',
          },
        ],
      }),
      NOW,
      ACTIVE,
    )
    expect(todos).toEqual([])
  })

  it('🔴 上个月填的要单独出一条「重新确认」，话要跟「没填过」区分开', async () => {
    const [t] = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: [spending[0]],
        configs: [
          {
            client_id: 'oztop',
            monthly_ad_budget: 2000,
            monthly_ad_budget_currency: 'AUD',
            monthly_ad_budget_updated_at: '2026-07-03T00:00:00Z',
          },
        ],
      }),
      NOW,
      ACTIVE,
    )
    expect(t.what).toContain('2026-07-03')
    expect(t.what).toContain('AUD 2,000')
    expect(t.what).toContain('预算是按月确认的')
    // 上次填过的人不该被当成从没填过
    expect(t.what).not.toContain('没登记他的月广告预算')
    expect(t.how).toContain('重新保存一次')
  })

  it('🔴 只填了金额没填币种 = 没填完', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: [spending[0]],
        configs: [
          { client_id: 'oztop', monthly_ad_budget: 2000, monthly_ad_budget_currency: null },
        ],
      }),
      NOW,
      ACTIVE,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].what).toContain('没登记他的月广告预算')
  })

  it('🔴 只给活跃客户下发 —— 停用客户的历史花费不该天天催人', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({ insights: spending }),
      NOW,
      ['cts'], // oztop 已停用
    )
    expect(todos.map((t) => t.client_id)).toEqual(['cts'])
  })

  it('🔴 本月确认不投的客户不再被催 —— 否则「留空」就是一个做了也没用的指示', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({
        insights: [spending[0]], // 月初花过钱，之后确认本月停投
        configs: [
          {
            client_id: 'oztop',
            monthly_ad_budget: null,
            monthly_ad_budget_currency: null,
            monthly_ad_budget_updated_at: '2026-08-11T00:00:00Z',
          },
        ],
      }),
      NOW,
      ACTIVE,
    )
    expect(todos).toEqual([])
  })

  it('没在投广告的客户不打扰 —— 没投就还不需要定预算', async () => {
    expect(await fetchAdsAngleTestTodos(fakeSupabase({ insights: [] }), NOW, ACTIVE)).toEqual([])
  })

  it('🔴 配置表读不到时整轮不下发 —— 迁移没 apply 的环境会每个客户推一条谁也处理不了的噪音', async () => {
    const todos = await fetchAdsAngleTestTodos(
      fakeSupabase({ insights: spending, configsError: 'column does not exist' }),
      NOW,
      ACTIVE,
    )
    expect(todos).toEqual([])
  })
})
