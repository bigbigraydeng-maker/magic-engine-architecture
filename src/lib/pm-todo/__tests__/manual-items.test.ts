/**
 * Unit tests for the pure helpers of the manual handoff lane, plus the
 * to-do email's rendering of it (PM 拍板 2026-08-01: 管道不许断头).
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushEmailReplyItems } from '../email-reply-items'
import {
  gscInspectUrl,
  daysAgo,
  loadManualItems,
  pushPlatformCandidateReviewItems,
  pushDataForSeoCreditsItem,
  pushLinkedinProgressItems,
  LINKEDIN_PROGRESS_FETCH_LIMIT,
  type ManualItem,
} from '../manual-items'
import { buildTodoEmail, type TodoCounts } from '../daily-todo'

describe('gscInspectUrl', () => {
  it('builds a deep link that opens the exact URL in Search Console', () => {
    const url = gscInspectUrl('sc-domain:oztopbuildingsupplies.com.au', 'https://oztopbuildingsupplies.com.au/spc')
    expect(url).toContain('search.google.com/search-console/inspect')
    // sc-domain: properties must stay encoded or the console 404s
    expect(url).toContain('resource_id=sc-domain%3Aoztopbuildingsupplies.com.au')
    expect(url).toContain('id=https%3A%2F%2Foztopbuildingsupplies.com.au%2Fspc')
  })
})

describe('daysAgo', () => {
  const now = new Date('2026-08-01T12:00:00Z')
  it('counts whole days, tolerates null and junk', () => {
    expect(daysAgo('2026-07-25T12:00:00Z', now)).toBe(7)
    expect(daysAgo(null, now)).toBeNull()
    expect(daysAgo('not-a-date', now)).toBeNull()
  })
})

describe('pushDataForSeoCreditsItem', () => {
  function fakeDiscoveryQuery(rows: unknown[]) {
    let containsFilter: unknown
    const chain = {
      select: () => chain,
      gte: () => chain,
      contains: (_column: string, value: unknown) => {
        containsFilter = value
        return chain
      },
      limit: async () => ({ data: rows, error: null }),
    }
    return {
      supabase: { from: () => chain } as never,
      getContainsFilter: () => containsFilter,
    }
  }

  it('creates one actionable item only for a persisted 40210 warning', async () => {
    const items: ManualItem[] = []
    const query = fakeDiscoveryQuery([{ id: 'discovery-1' }])
    await pushDataForSeoCreditsItem(query.supabase, items, new Date('2026-09-01T00:00:00Z'))

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'dataforseo_credits_out', client_id: 'infra' })
    expect(items[0].how).toContain('Billing')
    expect(query.getContainsFilter()).toEqual({ meta: { warnings: [{ error_code: 40210 }] } })
  })

  it('does not create a recharge task when the exact 40210 query has no match', async () => {
    const items: ManualItem[] = []
    const query = fakeDiscoveryQuery([])
    await pushDataForSeoCreditsItem(query.supabase, items, new Date('2026-09-01T00:00:00Z'))

    expect(items).toEqual([])
  })
})

describe('pushLinkedinProgressItems — 同一类卡点只出一条，别刷屏', () => {
  const NOW = new Date('2026-09-03T09:00:00Z')

  /** 假 content_posts 查询：`.select().eq().eq().in().order().limit()` 后 await。 */
  function fakePostsQuery(rows: unknown[]): SupabaseClient {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows, error: null }),
    }
    return { from: () => chain } as unknown as SupabaseClient
  }

  const draft = (reason: string) => ({
    id: `p-${reason}-${Math.random()}`,
    status: 'draft',
    updated_at: '2026-09-01T00:00:00Z',
    generation_context_snapshot: { reason },
  })

  it('🔴 三条待审草稿 → 只出一条、带「3 条」，不是三行一模一样的重复', async () => {
    const items: ManualItem[] = []
    await pushLinkedinProgressItems(
      fakePostsQuery([
        draft('sensitive_content_flagged'),
        draft('sensitive_content_flagged'),
        draft('sensitive_content_flagged'),
      ]),
      items,
      NOW,
    )

    const review = items.filter((i) => i.kind === 'linkedin_progress_needs_review')
    expect(review).toHaveLength(1)
    expect(review[0].what).toContain('3 条')
    expect(review[0].client_name).toBe('ME 产品动态（LinkedIn）')
  })

  it('一条待审草稿 → 保留原来的单数文案（多轮 review 磨过的话术不回退）', async () => {
    const items: ManualItem[] = []
    await pushLinkedinProgressItems(
      fakePostsQuery([draft('sensitive_content_flagged')]),
      items,
      NOW,
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('linkedin_progress_needs_review')
    expect(items[0].what).toBe(
      '这周的 LinkedIn 进度贴草稿里可能带了客户敏感信息，系统没敢自动发，等你看一眼',
    )
    // 单数不该出现条数噪音
    expect(items[0].what).not.toContain('条')
  })

  it('账号未连的多条草稿 → 只出一条 needs_setup（账号连一次就都能发）', async () => {
    const items: ManualItem[] = []
    await pushLinkedinProgressItems(
      fakePostsQuery([
        draft('linkedin_account_not_configured'),
        draft('linkedin_account_not_configured'),
      ]),
      items,
      NOW,
    )

    const setup = items.filter((i) => i.kind === 'linkedin_progress_needs_setup')
    expect(setup).toHaveLength(1)
    expect(setup[0].what).toContain('2 条')
  })

  it('已发布但回写失败 → 合并成一条，且保住「千万别重发」红线话术', async () => {
    const items: ManualItem[] = []
    await pushLinkedinProgressItems(
      fakePostsQuery([
        {
          id: 'a',
          status: 'approved',
          updated_at: '2026-09-01T00:00:00Z',
          generation_context_snapshot: { reason: 'published_but_db_sync_failed' },
        },
        {
          id: 'b',
          status: 'approved',
          updated_at: '2026-09-01T00:00:00Z',
          generation_context_snapshot: { reason: 'published_but_db_sync_failed' },
        },
      ]),
      items,
      NOW,
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('linkedin_progress_needs_review')
    expect(items[0].what).toContain('2 条')
    expect(items[0].what).toContain('千万别')
    // 绝不能引导去"重试/重新批准"——那会发出重复的公开帖子
    expect(items[0].how).toContain('手动把这几条记录的状态改成')
  })

  it('approved 但还没卡过 2 小时阈值 → 不下发（系统还没试着发）', async () => {
    const items: ManualItem[] = []
    await pushLinkedinProgressItems(
      fakePostsQuery([
        {
          id: 'fresh',
          status: 'approved',
          updated_at: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
          generation_context_snapshot: { reason: 'published' },
        },
      ]),
      items,
      NOW,
    )
    expect(items).toEqual([])
  })

  it('🔴 取满上限（可能还有更旧的没数进来）→ 显示「N+」，绝不把截断数当总数', async () => {
    const items: ManualItem[] = []
    // 假 supabase 的 .limit() 是空操作，会原样返回全部行 —— 给满上限条数
    // 即模拟「数到上限、后面可能还有」这个生产会遇到的截断态。
    const full = Array.from({ length: LINKEDIN_PROGRESS_FETCH_LIMIT }, () =>
      draft('sensitive_content_flagged'),
    )
    await pushLinkedinProgressItems(fakePostsQuery(full), items, NOW)

    const review = items.filter((i) => i.kind === 'linkedin_progress_needs_review')
    expect(review).toHaveLength(1)
    expect(review[0].what).toContain(`${LINKEDIN_PROGRESS_FETCH_LIMIT}+`)
  })

  it('发布失败多条、报错各不相同 → 一条汇总，条数 + 去重后的原因都带上', async () => {
    const items: ManualItem[] = []
    await pushLinkedinProgressItems(
      fakePostsQuery([
        {
          id: 'x',
          status: 'approved',
          updated_at: '2026-09-01T00:00:00Z',
          generation_context_snapshot: { publish_error: '401 授权失效' },
        },
        {
          id: 'y',
          status: 'approved',
          updated_at: '2026-09-01T00:00:00Z',
          generation_context_snapshot: { publish_error: '429 限流' },
        },
      ]),
      items,
      NOW,
    )

    const failed = items.filter((i) => i.kind === 'linkedin_progress_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].what).toContain('2 条')
    expect(failed[0].what).toContain('401 授权失效')
    expect(failed[0].what).toContain('429 限流')
  })
})

describe('buildTodoEmail — manual lane', () => {
  const EMPTY: TodoCounts = {
    draftsByClient: [],
    findingsByClient: [],
    recentCardsByClient: [],
    reelsByClient: [],
    manualItems: [],
    setupTasks: [],
    cronFailures24h: 0,
  }

  const item: ManualItem = {
    kind: 'not_indexed',
    client_id: 'cid-2',
    client_name: 'oztop',
    what: 'https://oztop/x 谷歌爬过但没收录（已 9 天），这个页面拿不到任何谷歌流量',
    how: '打开链接（已定位到这个网址），点页面上的「请求编入索引」，然后就不用管了',
    href: 'https://search.google.com/search-console/inspect?resource_id=x&id=y',
  }

  it('renders what / how / link for each manual item', () => {
    const { html } = buildTodoEmail(3, { ...EMPTY, manualItems: [item] }, '1 Aug')
    expect(html).toContain('需要你动手')
    expect(html).toContain('谷歌爬过但没收录')
    expect(html).toContain('请求编入索引')
    /**
     * `&` 在 HTML 属性里写成 `&amp;` 才是**正确**的（浏览器会还原成 `&`，链接照常能点）。
     * 从 PR #1037 起 `href` 走统一转义 —— 那一刀是为了挡住客人在私信里发的标记
     * 注进我们自己的日报，见 `daily-todo.ts` 的 `esc()`。
     */
    expect(html).toContain('https://search.google.com/search-console/inspect?resource_id=x&amp;id=y')
    expect(html).toContain('去做这件事')
  })

  it('manual items count toward the subject total', () => {
    const email = buildTodoEmail(3, { ...EMPTY, manualItems: [item, { ...item, kind: 'blog_pr_open' }] }, '1 Aug')
    expect(email.totalItems).toBe(2)
    expect(email.subject).toContain('2 件')
  })

  it('the manual lane renders above the routine sections', () => {
    const { html } = buildTodoEmail(3, {
      ...EMPTY,
      manualItems: [item],
      draftsByClient: [{ name: 'CTS Tours NZ', id: 'cid-1', drafts: 2 }],
    }, '1 Aug')
    expect(html.indexOf('需要你动手')).toBeLessThan(html.indexOf('Blog 草稿待审'))
  })

  it('no manual items → section absent, quiet day still says all-clear', () => {
    const email = buildTodoEmail(3, EMPTY, '1 Aug')
    expect(email.html).not.toContain('需要你动手')
    expect(email.html).toContain('今天没有待办')
  })
})

describe('pushPlatformCandidateReviewItems — 平台候选复查不靠日历记忆', () => {
  const now = new Date('2026-09-27T00:00:00Z')

  it('复查日已到 → 下发待办，不用等人记起来', () => {
    const items: ManualItem[] = []
    pushPlatformCandidateReviewItems(items, now, [
      { name: '跨客户舆情监控引擎', reviewDate: '2026-09-27' },
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('platform_candidate_review_due')
    expect(items[0].what).toContain('跨客户舆情监控引擎')
    expect(items[0].href).toContain('platform-candidates.md')
  })

  it('复查日还没到 → 不下发', () => {
    const items: ManualItem[] = []
    pushPlatformCandidateReviewItems(items, now, [
      { name: '还没到期的候选', reviewDate: '2026-10-27' },
    ])
    expect(items).toHaveLength(0)
  })

  it('日期格式坏了 → 跳过而不是抛错（不阻塞其他待办）', () => {
    const items: ManualItem[] = []
    expect(() =>
      pushPlatformCandidateReviewItems(items, now, [{ name: '坏日期', reviewDate: 'not-a-date' }]),
    ).not.toThrow()
    expect(items).toHaveLength(0)
  })
})

describe('daysAgo → 文案年龄', () => {
  it('day 0 不该渲染成「已 0 天」（首日实测的文案瑕疵）', () => {
    const now = new Date('2026-08-01T13:00:00Z')
    expect(daysAgo('2026-08-01T04:00:00Z', now)).toBe(0)
    // 渲染层规则：仅当 > 0 才拼年龄，0 天保持安静
    const age = (d: number | null) => (d !== null && d > 0 ? `（已 ${d} 天）` : '')
    expect(age(0)).toBe('')
    expect(age(9)).toBe('（已 9 天）')
  })
})

/**
 * 客人来信超过一天没人回 —— 这条待办的出口（`email-reply-items.ts`）。
 *
 * 钉的是铁律 3 下半：判据算出来的名单必须**进同一个管道**（今日待办），
 * 而且三件套齐全 —— what 说清是谁和代价、how 具体到点哪里、href 直达。
 *
 * 🔴 href 必须是**绝对网址**：相对路径会被链接闸判成 broken，整条待办被丢掉
 *    （狄仁杰 2026-08-05 实测 kept=0）。这一条单独断言，别跟渲染混在一起。
 */
describe('email_reply_due — 客人来信没人回', () => {
  type Row = Record<string, unknown>

  /** 假 supabase **按表建模**，不按调用次序；没建模的表直接抛，不返回半成品。 */
  function makeFake(tables: Record<string, Row[]>): SupabaseClient {
    const from = (table: string) => {
      if (!(table in tables)) throw new Error(`fake supabase: 表 '${table}' 没建模`)
      const filters: Array<(r: Row) => boolean> = []
      let lo = 0
      let hi = Number.MAX_SAFE_INTEGER
      const api: Record<string, unknown> = {}
      const chain = () => api
      api.select = () => chain()
      api.order = () => chain()
      api.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain())
      api.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), chain())
      api.gte = (c: string, v: unknown) =>
        (filters.push((r) => String(r[c]) >= String(v)), chain())
      // 生产写的是 .not('contact_id', 'is', null) —— 只用来排除空值
      api.not = (c: string) => (filters.push((r) => r[c] !== null && r[c] !== undefined), chain())
      api.range = (a: number, b: number) => ((lo = a), (hi = b), chain())
      api.limit = (n: number) => ((hi = n - 1), chain())
      api.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: tables[table]
            .filter((r) => filters.every((f) => f(r)))
            .slice(lo, hi === Number.MAX_SAFE_INTEGER ? undefined : hi + 1),
          error: null,
        }).then(resolve)
      return api
    }
    return { from } as unknown as SupabaseClient
  }

  const CLIENT = 'c0000000-0000-0000-0000-000000000000'
  const NOW = new Date('2026-09-03T09:00:00Z')
  const nameOf = () => 'CTS Tours NZ'

  /** 客人 30 小时前来过一封信，之后没人做过任何事。 */
  function crmTables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
    return {
      conversations: [
        {
          id: 'conv-1',
          client_id: CLIENT,
          contact_id: 'p1',
          channel: 'email',
          subject: '想问 12 月的团还有没有位',
          last_message_at: '2026-09-02T03:00:00Z',
          last_message_from: 'customer',
        },
      ],
      contacts: [{ id: 'p1', do_not_contact: false, display_name: 'Christine Matehaere' }],
      contact_touchpoints: [],
      contact_identities: [{ contact_id: 'p1', kind: 'email', value: 'christine@gmail.com' }],
      clients: [{ id: CLIENT, leads_config: { own_email_domains: ['ctstours.co.nz'] } }],
      cron_run_logs: [],
      ...over,
    }
  }

  async function run(tables: Record<string, Row[]>): Promise<ManualItem[]> {
    const items: ManualItem[] = []
    await pushEmailReplyItems(makeFake(tables), items, [CLIENT], NOW, nameOf)
    return items
  }

  const EMPTY_COUNTS: TodoCounts = {
    draftsByClient: [],
    findingsByClient: [],
    recentCardsByClient: [],
    reelsByClient: [],
    manualItems: [],
    setupTasks: [],
    cronFailures24h: 0,
  }

  it('三件套齐全，且 href 是绝对网址（相对路径会被整条丢掉）', async () => {
    const [item] = await run(crmTables())

    expect(item.kind).toBe('email_reply_due')
    expect(item.client_name).toBe('CTS Tours NZ')
    // what：是谁、等了多久、代价
    expect(item.what).toContain('Christine Matehaere')
    expect(item.what).toContain('30 小时')
    expect(item.what).toContain('想问 12 月的团还有没有位')
    // how：两条路都要求写一笔，否则这条会一直冒到时间窗到期
    expect(item.how).toContain('写一句话记一笔')
    expect(item.how).toContain('30 天')
    // 🔴 绝对网址，且落点是「全部客人」那一页（`?contact=` 那页真的读）
    expect(item.href.startsWith('https://app.magicengine.com.au/')).toBe(true)
    expect(item.href).toBe(
      `https://app.magicengine.com.au/dashboard/clients/${CLIENT}/crm/all?contact=p1`,
    )
  })

  it('真的渲染进今日待办，并计入主题里的总数', async () => {
    const items = await run(crmTables())
    const email = buildTodoEmail(3, { ...EMPTY_COUNTS, manualItems: items }, '3 Sep')

    expect(email.totalItems).toBe(1)
    expect(email.subject).toContain('1 件')
    expect(email.html).toContain('需要你动手')
    expect(email.html).toContain('Christine Matehaere')
    expect(email.html).toContain('去做这件事')
  })

  it('球在客人那边（最后说话的是我们）→ 一条都不下发，整栏不出现', async () => {
    const answered = crmTables({
      conversations: [
        {
          id: 'conv-1',
          client_id: CLIENT,
          contact_id: 'p1',
          channel: 'email',
          subject: '想问 12 月的团还有没有位',
          last_message_at: '2026-09-02T03:00:00Z',
          last_message_from: 'page',
        },
      ],
    })
    const items = await run(answered)
    expect(items).toEqual([])

    // 空名单不该变成一栏空标题 —— 安静的一天要真的安静
    const email = buildTodoEmail(3, { ...EMPTY_COUNTS, manualItems: items }, '3 Sep')
    expect(email.html).not.toContain('需要你动手')
    expect(email.html).toContain('今天没有待办')
  })

  /**
   * 这条通道查挂了，其它待办必须照常下发。
   *
   * `loadManualItems` 里那一行 `.catch` 就是为这件事存在的：没有它，一次读库
   * 失败会让整份今日待办变成空信，而空信跟「今天没事」长得一模一样。
   */
  it('上游查挂了 → 其他待办照常下发，不把整份清单带崩', async () => {
    const empty = new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(res)
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
        return () => empty
      },
    })
    const clientsQuery = {
      select: () => clientsQuery,
      eq: () => clientsQuery,
      order: () => clientsQuery,
      range: async () => ({
        data: [{ id: CLIENT, name: 'CTS Tours NZ', domain: 'ctstours.co.nz' }],
        error: null,
      }),
    }
    const broken = {
      from: (table: string) => {
        // 邮件那条通道的第一张表 —— 让它当场炸，模拟读库失败
        if (table === 'conversations') throw new Error('conversations 读挂了')
        if (table === 'clients') return clientsQuery
        return empty
      },
    } as unknown as SupabaseClient

    const all = await loadManualItems(broken, NOW)

    expect(all.some((i) => i.kind === 'email_reply_due')).toBe(false)
    // 其它通道照常产出 —— 这才是 .catch 存在的意义
    expect(all.length).toBeGreaterThan(0)
  })

  /**
   * 「今天信压根没进来」必须跟结果并排出现。
   *
   * 邮箱授权掉了 → 一封新信都没同步进来 → 超时未回自然是零条 → 这一栏干干净净。
   * **一个哑掉的通道和一个健康的通道，在待办清单里长得一模一样。**
   */
  const syncRun = (summary: unknown, finishedAt = '2026-09-03T08:10:00Z'): Row => ({
    job_name: 'messenger-sync-hourly',
    status: 'completed',
    started_at: finishedAt,
    finished_at: finishedAt,
    summary,
  })

  /**
   * 一行「开跑了还没写完」的记录 —— `startCronRun` 在任务**开始时**就插这一行，
   * summary 要 finish() 才写。照真形状建模：status='running'、summary=null。
   */
  const runningRun = (startedAt: string): Row => ({
    job_name: 'messenger-sync-hourly',
    status: 'running',
    started_at: startedAt,
    finished_at: null,
    summary: null,
  })

  it('公司邮箱同步整趟挂了 → 单独下发一条，说明那个「零条」是假的', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [syncRun({ mailbox: { mailboxes: 1, error: '令牌过期', results: [] } })],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('email_sync_stale')
    expect(items[0].what).toContain('令牌过期')
    expect(items[0].what).toContain('别把它当成「没人在等」')
    expect(items[0].href.startsWith('https://app.magicengine.com.au/')).toBe(true)
  })

  it('单个邮箱读不进来 → 挂到它自己的客户名下，链接直达那个客户的设置页', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [
          syncRun({
            mailbox: {
              mailboxes: 1,
              error: null,
              results: [{ clientId: CLIENT, mailbox: 'info@ctstours.co.nz', error: '401 授权失效' }],
            },
          }),
        ],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0].client_name).toBe('CTS Tours NZ')
    expect(items[0].what).toContain('info@ctstours.co.nz')
    expect(items[0].how).toContain('重新授权')
    expect(items[0].href).toBe(
      `https://app.magicengine.com.au/dashboard/clients/${CLIENT}/settings`,
    )
  })

  it('运行记录太旧 → 闭嘴（「该跑没跑」有别的通道在管，不重复报）', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [
          syncRun({ mailbox: { mailboxes: 0 } }, '2026-08-20T08:10:00Z'),
        ],
      }),
    )
    expect(items).toEqual([])
  })

  /**
   * 🔴 守卫不许在最需要它的那一刻自己失效。
   *
   * 最新一行随时可能是刚插进去、还没写 summary 的 'running' 行。只看第一行的话，
   * 「邮箱同步挂了」这条通道就在同步刚出事的那一刻静音 —— fail-open。
   * 假件按真形状建模（假 supabase 的 .order() 是空操作，所以这里按
   * started_at 倒序手工摆好，跟生产读到的顺序一致）。
   */
  it('🔴 最新一行还在「在跑」→ 往下找写完的那一轮，不许整条通道闭嘴', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [
          runningRun('2026-09-03T08:50:00Z'),
          syncRun({ mailbox: { mailboxes: 1, error: '令牌过期', results: [] } }),
        ],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('email_sync_stale')
    expect(items[0].what).toContain('令牌过期')
  })

  it('同步开跑 5 小时没写完 → 当卡死单独说，不跟「记录太旧」一起吞掉', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [runningRun('2026-09-03T04:00:00Z')],
      }),
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('email_sync_stale')
    expect(items[0].what).toContain('卡住了')
    expect(items[0].href.startsWith('https://app.magicengine.com.au/')).toBe(true)
  })

  it('刚开跑一个小时 → 那是正常在跑，闭嘴', async () => {
    const items = await run(
      crmTables({
        conversations: [],
        cron_run_logs: [runningRun('2026-09-03T08:00:00Z')],
      }),
    )
    expect(items).toEqual([])
  })

  /**
   * 🔴 一页最多列 10 条，压掉的那些必须自己成为一条待办。
   *
   * 只 console.warn 等于没说：看这一页的人不会去翻 Render 日志，
   * 数完 10 条就以为清空了。
   */
  it('超过一页能列的条数时，剩下几条也要下发，不许只写日志', async () => {
    const convos = Array.from({ length: 13 }, (_, i) => ({
      id: `conv-${i}`,
      client_id: CLIENT,
      contact_id: `p${i}`,
      channel: 'email',
      subject: `问团 ${i}`,
      last_message_at: '2026-09-02T03:00:00Z',
      last_message_from: 'customer',
    }))
    const items = await run(
      crmTables({
        conversations: convos,
        contacts: convos.map((c) => ({
          id: c.contact_id,
          do_not_contact: false,
          display_name: `客人 ${c.contact_id}`,
        })),
        contact_identities: [],
      }),
    )

    expect(items.filter((i) => i.kind === 'email_reply_due')).toHaveLength(11)
    const extra = items[items.length - 1]
    expect(extra.what).toContain('还有 3 封')
    expect(extra.client_name).toBe('CTS Tours NZ')
    expect(extra.href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/crm/all`)
  })
})
