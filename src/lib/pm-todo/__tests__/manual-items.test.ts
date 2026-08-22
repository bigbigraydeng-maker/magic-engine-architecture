/**
 * Unit tests for the pure helpers of the manual handoff lane, plus the
 * to-do email's rendering of it (PM 拍板 2026-08-01: 管道不许断头).
 */

import { describe, it, expect } from 'vitest'
import {
  gscInspectUrl,
  daysAgo,
  loadManualItems,
  publerTokenSetupItem,
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
 * #1149 P1（frozen HEAD 9d905e5 上 Codex 新提）：Publer 自动发布鉴权密钥
 * （PUBLER_CREATE_POST_TOKEN）的外部配置依赖必须进人工任务管道，
 * 不能只写在 PR / env 文档里等人翻，否则一次漏配就让发布管道静默断头。
 */
describe('publerTokenSetupItem — 外部密钥配置进人工任务管道', () => {
  const SECRET = 'super-long-random-production-secret-value'

  it('密钥未配置（undefined）→ 下发一条 infra 级人工任务，what/how/href 三件套齐全', () => {
    const item = publerTokenSetupItem(undefined)
    expect(item).not.toBeNull()
    expect(item!.kind).toBe('publer_token_unset')
    // infra 级：系统配置，与具体客户无关
    expect(item!.client_id).toBe('infra')
    expect(item!.client_name).toBe('Magic Engine 后台')
    // 三件套都不能为空 —— 缺一条就是「没下发好」
    expect(item!.what.trim().length).toBeGreaterThan(0)
    expect(item!.how.trim().length).toBeGreaterThan(0)
    expect(item!.href.trim().length).toBeGreaterThan(0)
  })

  it('what 说清问题和影响；how 给出可照做的两步；href 是可点的绝对链接', () => {
    const item = publerTokenSetupItem(undefined)!
    // what 必须说清「会怎样」——审批过的帖子会卡住发不出去
    expect(item.what).toContain('已审批')
    // how 必须具体到点哪里、按什么顺序，FDE 不用问第二遍
    expect(item.how).toContain('PUBLER_CREATE_POST_TOKEN')
    expect(item.how).toContain('Render')
    expect(item.how).toContain('Zapier')
    expect(item.how).toContain('Bearer')
    expect(item.how).toContain('顺序不能反')
    // href 必须是能过链接闸的绝对网址（相对路径会被判 broken 整条丢掉）
    expect(() => new URL(item.href)).not.toThrow()
    expect(item.href.startsWith('https://')).toBe(true)
  })

  it('密钥为空串 / 纯空白 → 视作未配置，照常下发', () => {
    expect(publerTokenSetupItem('')).not.toBeNull()
    expect(publerTokenSetupItem('   ')).not.toBeNull()
  })

  it('密钥已配置 → 不下发（这条自己消失，不刷屏）', () => {
    expect(publerTokenSetupItem(SECRET)).toBeNull()
  })

  it('绝不把密钥值印进待办（配置好就返回 null，天然不泄露）', () => {
    // 已配置 → null，无任何文本承载密钥
    expect(publerTokenSetupItem(SECRET)).toBeNull()
    // 未配置时下发的文本里也不该出现任何真实密钥值
    const item = publerTokenSetupItem(undefined)!
    expect(`${item.what}${item.how}${item.href}`).not.toContain(SECRET)
  })

  it('能被日报的人工栏正常渲染（what/how 都出现在 HTML 里）', () => {
    const EMPTY: TodoCounts = {
      draftsByClient: [],
      findingsByClient: [],
      recentCardsByClient: [],
      reelsByClient: [],
      manualItems: [],
      setupTasks: [],
      cronFailures24h: 0,
    }
    const item = publerTokenSetupItem(undefined)!
    const { html } = buildTodoEmail(3, { ...EMPTY, manualItems: [item] }, '22 Aug')
    expect(html).toContain('需要你动手')
    expect(html).toContain('自动发布通道的鉴权密钥还没配')
    expect(html).toContain('PUBLER_CREATE_POST_TOKEN')
  })
})
