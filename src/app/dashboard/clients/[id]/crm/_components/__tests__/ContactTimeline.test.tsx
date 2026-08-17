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

describe('他是从哪来的', () => {
  it('第一条就是来源 —— 单独提一行，别埋在小字里', async () => {
    mockTimeline([
      touch({ channel: 'meta_lead_form', direction: 'inbound', summary: '填了表单' }),
      touch({ at: '2026-08-12T00:00:00Z', summary: '回访' }),
    ])
    draw()
    await waitFor(() => expect(screen.getByText('Facebook 表单')).toBeTruthy())
  })

  it('第一条是私信也认', async () => {
    mockTimeline([
      { kind: 'message', at: '2026-08-10T00:00:00Z', direction: 'inbound', body: '你好' },
    ])
    draw()
    await waitFor(() => expect(screen.getByText('私信')).toBeTruthy())
  })

  it('没有往来记录时不炸', async () => {
    mockTimeline([])
    draw()
    await waitFor(() => expect(screen.getByText('还没有往来记录。')).toBeTruthy())
  })
})
