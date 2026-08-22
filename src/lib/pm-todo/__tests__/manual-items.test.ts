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
  isPublerWebhookCallerConfirmed,
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
 *
 * #1149 SECOND P1（frozen HEAD 2b7e56a 上 Codex 新提）：上线要两端配置——
 * ① Render token ② Zapier caller 的 Bearer。初版只看①，操作员做完①、②还没配时
 * 任务就消失，而路由仍会拒掉 Zapier、帖子继续卡住。修正为 fail-closed：
 * 只有两端都显式确认（token 已配 + PUBLER_WEBHOOK_CALLER_CONFIRMED 置真）才撤任务。
 */
describe('isPublerWebhookCallerConfirmed — ② Zapier caller 确认标记（默认 false）', () => {
  it('未配置 / 空串 / 纯空白 → 未确认（fail-closed 默认）', () => {
    expect(isPublerWebhookCallerConfirmed(undefined)).toBe(false)
    expect(isPublerWebhookCallerConfirmed('')).toBe(false)
    expect(isPublerWebhookCallerConfirmed('   ')).toBe(false)
  })

  it('明确的真值（大小写 / 首尾空白不敏感）→ 已确认', () => {
    for (const v of ['true', 'TRUE', ' True ', '1', 'yes', 'YES', 'on', 'On']) {
      expect(isPublerWebhookCallerConfirmed(v)).toBe(true)
    }
  })

  it('false / 0 / no / 其它任意值 → 未确认（只认白名单，绝不默认放行）', () => {
    for (const v of ['false', 'False', '0', 'no', 'off', 'maybe', 'configured', 'x']) {
      expect(isPublerWebhookCallerConfirmed(v)).toBe(false)
    }
  })
})

describe('publerTokenSetupItem — 两端配置进人工任务管道，未两端确认前持续下发', () => {
  const SECRET = 'super-long-random-production-secret-value'

  it('①②都没配（undefined, false）→ 下发一条 infra 级人工任务，what/how/href 三件套齐全', () => {
    const item = publerTokenSetupItem(undefined, false)
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

  it('①②都没配：what 说清影响；how 给出可照做的两步 + 确认标记；href 是可点的绝对链接', () => {
    const item = publerTokenSetupItem(undefined, false)!
    // what 必须说清「会怎样」——审批过的帖子会卡住发不出去
    expect(item.what).toContain('已审批')
    // how 必须具体到点哪里、按什么顺序，FDE 不用问第二遍
    expect(item.how).toContain('PUBLER_CREATE_POST_TOKEN')
    expect(item.how).toContain('Render')
    expect(item.how).toContain('Zapier')
    expect(item.how).toContain('Bearer')
    expect(item.how).toContain('顺序不能反')
    // 两端确认机制必须写进 how，操作员才知道任务靠什么撤销
    expect(item.how).toContain('PUBLER_WEBHOOK_CALLER_CONFIRMED')
    // href 必须是能过链接闸的绝对网址（相对路径会被判 broken 整条丢掉）
    expect(() => new URL(item.href)).not.toThrow()
    expect(item.href.startsWith('https://')).toBe(true)
  })

  it('token 为空串 / 纯空白（+未确认）→ 视作未配置，照常下发', () => {
    expect(publerTokenSetupItem('', false)).not.toBeNull()
    expect(publerTokenSetupItem('   ', false)).not.toBeNull()
  })

  it('🔴 SECOND P1 正例：token 已配但 caller 未确认 → 仍下发（不能只做一半就撤任务）', () => {
    const item = publerTokenSetupItem(SECRET, false)
    expect(item).not.toBeNull()
    expect(item!.kind).toBe('publer_token_unset')
    // 文案要点出「只配了一半」，并指明差最后的确认步骤
    expect(item!.what).toContain('一半')
    expect(item!.how).toContain('Zapier')
    expect(item!.how).toContain('PUBLER_WEBHOOK_CALLER_CONFIRMED')
    // 仍不泄露密钥值
    expect(`${item!.what}${item!.how}${item!.href}`).not.toContain(SECRET)
  })

  it('token 未配但 caller 已确认（错配的怪状态）→ 仍下发（fail-closed，token 缺了照样断头）', () => {
    const item = publerTokenSetupItem(undefined, true)
    expect(item).not.toBeNull()
    // 这种状态下仍从头指引配 token
    expect(item!.how).toContain('PUBLER_CREATE_POST_TOKEN')
  })

  it('两端都确认（token 已配 + caller 已确认）→ 不下发（这条自己消失，不刷屏）', () => {
    expect(publerTokenSetupItem(SECRET, true)).toBeNull()
  })

  it('绝不把密钥值印进待办（任一可见状态的文本都不承载密钥）', () => {
    // 两端确认 → null，无任何文本承载密钥
    expect(publerTokenSetupItem(SECRET, true)).toBeNull()
    // 各可见状态下的文本里都不该出现任何真实密钥值
    for (const item of [
      publerTokenSetupItem(undefined, false)!,
      publerTokenSetupItem(SECRET, false)!,
      publerTokenSetupItem(undefined, true)!,
    ]) {
      expect(`${item.what}${item.how}${item.href}`).not.toContain(SECRET)
    }
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
    const item = publerTokenSetupItem(undefined, false)!
    const { html } = buildTodoEmail(3, { ...EMPTY, manualItems: [item] }, '22 Aug')
    expect(html).toContain('需要你动手')
    expect(html).toContain('自动发布通道的鉴权密钥还没配')
    expect(html).toContain('PUBLER_CREATE_POST_TOKEN')
  })
})
