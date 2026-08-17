/**
 * 往来记录里，**系统做过的判决必须看得见**。
 *
 * 背景（PM 2026-08-17）：`do_not_contact` 一旦成立，电话 / 邮件 / 私信全停，
 * 解闸只能靠人明确说「判错了」。可在这之前，这条判决在时间线上跟一条普通电话
 * 记录长得一模一样 —— 接口早就把 `outcome` 送到前端了，组件却一个字都没渲染。
 *
 * 于是最该被复核的那一刻恰恰最看不见：销售翻记录只看到一句话，看不到
 * 「就是这一句让系统把他全渠道停了」。而早前的词表确实把「我不打算去」
 * 当成过「别再联系」—— 被误判的人收不到我们任何消息。
 *
 * 🔴 原话必须留在判决旁边：判断是不是判错了，全靠原话。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ContactTimeline, type TimelineEntry } from '../ContactTimeline'

const touch = (over: Partial<TimelineEntry> = {}): TimelineEntry => ({
  kind: 'touch',
  at: '2026-08-10T00:00:00Z',
  channel: 'phone',
  direction: 'outbound',
  summary: '打过去聊了两句',
  ...over,
})

function mockTimeline(timeline: TimelineEntry[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      contact: { name: 'Sue', phone: null, email: null, stageLabel: null },
      timeline,
    }),
  }) as unknown as typeof fetch
}

const draw = () => render(<ContactTimeline clientId="cts" contactId="c1" />)

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('系统给他上了闸 —— 必须一眼看见', () => {
  it('🔒「别再联系」那条写明后果，不是只写个结论名', async () => {
    mockTimeline([touch({ summary: '客户说别再打给我了', outcome: 'do_not_contact' })])
    draw()
    // 说的是「所以现在怎么样」，销售不用去猜 do_not_contact 是什么意思
    await waitFor(() =>
      expect(screen.getByText(/电话 \/ 邮件 \/ 私信全都不再发给他/)).toBeTruthy(),
    )
  })

  it('🔴 原话还在判决旁边 —— 判断是不是判错了全靠它', async () => {
    mockTimeline([touch({ summary: '客户说别再打给我了', outcome: 'do_not_contact' })])
    draw()
    await waitFor(() => expect(screen.getByText('客户说别再打给我了')).toBeTruthy())
  })

  it('🔓 有人判错解了闸，也要看得见（否则销售不知道现在到底能不能联系）', async () => {
    mockTimeline([touch({ summary: '这条判错了', outcome: 'dnc_cleared' })])
    draw()
    await waitFor(() => expect(screen.getByText(/放回了名单/)).toBeTruthy())
  })
})

describe('其余结论只挑影响下一步动作的', () => {
  it('打不通 / 没人接 / 不买了 显示成人话', async () => {
    mockTimeline([
      touch({ summary: 'a', outcome: 'bad_number' }),
      touch({ summary: 'b', outcome: 'no_answer' }),
      touch({ summary: 'c', outcome: 'not_interested' }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText('这个号打不通')).toBeTruthy())
    expect(screen.getByText('打了没人接')).toBeTruthy()
    expect(screen.getByText('他说不买了')).toBeTruthy()
  })

  /**
   * `spoke` 是**兜底值** —— 任何没命中规则的普通备注都会落成它
   * （见 `note-parser` 的 `classifyNote` 结尾）。标出来等于满屏噪音，
   * 而噪音会把上面那条真正的「闸」一起淹掉。
   */
  it('🔴 兜底值 spoke 不显示 —— 否则满屏噪音会淹掉真正的闸', async () => {
    mockTimeline([touch({ summary: '随便聊了聊', outcome: 'spoke' })])
    draw()
    await waitFor(() => expect(screen.getByText('随便聊了聊')).toBeTruthy())
    expect(screen.queryByText(/聊过/)).toBeNull()
  })
})

/**
 * 「他是从哪来的」这一行的价值全在**可信**。说错了还不如不说 ——
 * 销售会照着一个错的来源定开场白。所以两道闸：必须是客人来的、渠道必须认得出。
 * （Codex 复审 PR #1038，2026-08-17）
 */
describe('他是从哪来的', () => {
  it('客人填了表单 → 显示来源', async () => {
    mockTimeline([
      touch({ channel: 'meta_lead_form', direction: 'inbound', summary: '填了表单' }),
      touch({ at: '2026-08-12T00:00:00Z', summary: '回访' }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText('Facebook 表单')).toBeTruthy())
  })

  it('客人主动发的私信 → 按对话真实渠道显示', async () => {
    mockTimeline([
      {
        kind: 'message',
        at: '2026-08-10T00:00:00Z',
        direction: 'inbound',
        body: '你好',
        channel: 'messenger',
      },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('私信')).toBeTruthy())
  })

  /**
   * 🔴 第一条是**我们打出去**的电话时，那说明的是「我们怎么找到他的」，
   * 不是「他从哪来的」。初版会照样写「他是从电话来的」。
   */
  it('🔴 第一条是我们打出去的 → 整行不显示', async () => {
    mockTimeline([touch({ channel: 'phone', direction: 'outbound', summary: '我们打过去' })])
    draw()
    await waitFor(() => expect(screen.getByText('我们打过去')).toBeTruthy())
    expect(screen.queryByText(/他是从/)).toBeNull()
  })

  /**
   * 🔴 对话表里还有 email / whatsapp / voice。初版把所有消息硬编码成「私信」。
   * 渠道认不出来时宁可不说。
   */
  it('🔴 消息没带渠道 → 不猜，整行不显示', async () => {
    mockTimeline([
      { kind: 'message', at: '2026-08-10T00:00:00Z', direction: 'inbound', body: '你好' },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy())
    expect(screen.queryByText(/他是从/)).toBeNull()
  })

  /**
   * 🔴 渠道**有值但我们不认识**（对话表里有 `voice`，中文对照表里没有）时，
   * 不能把英文 key 直接甩给销售看 —— 那既不是人话，也可能根本不是获客来源。
   * 这一条跟上面「没带渠道」不是同一种情况：那条 `channel` 是空的，
   * 兜底成 `channel` 本身也还是空；这条才真的分得出两种写法。
   */
  it('🔴 渠道认得出才说 —— 不认识的英文 key 不甩给销售', async () => {
    mockTimeline([
      {
        kind: 'message',
        at: '2026-08-10T00:00:00Z',
        direction: 'inbound',
        body: '你好',
        channel: 'voice',
      },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy())
    expect(screen.queryByText(/他是从/)).toBeNull()
  })

  it('没有往来记录时不炸', async () => {
    mockTimeline([])
    draw()
    await waitFor(() => expect(screen.getByText('还没有往来记录。')).toBeTruthy())
  })
})

/**
 * 🔴 判决旁边必须是**销售真正敲的那句话**，不是 AI 摘要
 * （Codex 复审 PR #1038，2026-08-17）。
 *
 * `recordManualTouchpoint` 把 AI 摘要存进 `summary`、原话存进 `raw`。
 * 「暂时不去」和「别再联系我」摘要之后可能长得一样，判决却天差地别 ——
 * 拿摘要去复核一个全渠道封锁，等于没复核。
 */
describe('判决旁边的是原话，不是 AI 摘要', () => {
  it('🔴 原话跟摘要不同时，原话要显示出来', async () => {
    mockTimeline([
      touch({
        summary: '客户表示不再需要跟进',
        raw: '这次不去了，明年再说吧，你们别老打了',
        outcome: 'do_not_contact',
      }),
    ])
    draw()
    await waitFor(() =>
      expect(screen.getByText(/这次不去了，明年再说吧/)).toBeTruthy(),
    )
  })

  it('原话跟摘要一样就不重复铺一遍', async () => {
    mockTimeline([touch({ summary: '别再联系我', raw: '别再联系我', outcome: 'do_not_contact' })])
    draw()
    await waitFor(() => expect(screen.getAllByText('别再联系我')).toHaveLength(1))
  })

  it('普通记录不铺原话 —— 摘要更短更好读', async () => {
    mockTimeline([touch({ summary: '聊了两句', raw: '客人问了价格然后说再想想', outcome: 'spoke' })])
    draw()
    await waitFor(() => expect(screen.getByText('聊了两句')).toBeTruthy())
    expect(screen.queryByText(/客人问了价格/)).toBeNull()
  })
})

/**
 * 记录一多就框起来并停在最新那条 —— 微信 / WhatsApp 打开都停在最新一句，
 * 我们原先停在最早一句，销售每天白滚几十次（PM 2026-08-17，CTS 销售视角）。
 */
describe('记录多的时候停在最新一条', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      touch({ at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z`, summary: `第 ${i} 条` }),
    )

  it('记录少 → 不框，整条铺开', async () => {
    mockTimeline(many(3))
    draw()
    await waitFor(() => expect(screen.getByText('第 0 条')).toBeTruthy())
    expect(screen.getByTestId('timeline-list').className).not.toContain('overflow-y-auto')
  })

  /**
   * jsdom 不做排版，`scrollHeight` 恒为 0 —— 直接断言 `scrollTop === scrollHeight`
   * 会**永远通过**，那是个假测试。所以先把 `scrollHeight` 假装成有内容的高度，
   * 再看代码有没有真的把它滚下去。
   */
  it('🔴 记录多 → 框起来，并且滚到底（不是停在三个月前那条）', async () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(2000)
    try {
      mockTimeline(many(12))
      draw()
      const list = await waitFor(() => screen.getByTestId('timeline-list'))
      expect(list.className).toContain('overflow-y-auto')
      await waitFor(() => expect(list.scrollTop).toBe(2000))
    } finally {
      spy.mockRestore()
    }
  })

  it('记录少 → 不去动滚动位置', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
    try {
      mockTimeline(many(3))
      draw()
      const list = await waitFor(() => screen.getByTestId('timeline-list'))
      expect(list.scrollTop).toBe(0)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('摘要回传给抽屉', () => {
  it('把最后一句话和想去哪交出去 —— 抽屉顶上那张卡靠它', async () => {
    mockTimeline([
      touch({ summary: '问了南岛', tour: '南岛 8 日' }),
      touch({ at: '2026-08-12T00:00:00Z', direction: 'inbound', summary: '想三月走' , travelWindow: '三月' }),
    ])
    const onSummary = vi.fn()
    render(<ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />)
    await waitFor(() => expect(onSummary).toHaveBeenCalled())
    const s = onSummary.mock.calls.at(-1)?.[0]
    expect(s.lastText).toBe('想三月走')
    expect(s.lastWho).toBe('客人')
    // 越新的越算数：两条记录各带一个字段，都要留下
    expect(s.tour).toBe('南岛 8 日')
    expect(s.travelWindow).toBe('三月')
  })

  it('🔴 拉失败时把摘要清掉 —— 顶上留着上一个人的话比空着危险', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '炸了' }),
    }) as unknown as typeof fetch
    const onSummary = vi.fn()
    render(<ContactTimeline clientId="cts" contactId="c1" onSummary={onSummary} />)
    await waitFor(() => expect(onSummary).toHaveBeenCalledWith(null))
  })
})
