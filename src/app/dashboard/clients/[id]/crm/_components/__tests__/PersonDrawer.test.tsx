/**
 * 抽屉里的联系方式。
 *
 * 🔴 **抽屉必须跟卡片说同一件事**（Codex 复审 2026-08-16）。
 *
 * 号码打不通的人只要还有邮箱或 Messenger，就会留在名单上（见
 * `lib/crm/segments` 的「号码打不通 ≠ 这个人不要了」）。卡片已经把拨号动作换成
 * 一句「这个号打不通」；但抽屉原先只看有没有号码就无条件渲染一个 `tel:` 链接
 * —— 销售点开卡片，照样一点就拨那个**已知打不通**的号。
 *
 * 一半修好一半没修，比两半都没修更危险：他会以为卡片上那句提醒是过时的。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'

const row = (over: Partial<DrawerRow> = {}): DrawerRow => ({
  contactId: 'c1',
  name: 'Sue Masson',
  phone: '+64211234567',
  email: 'sue@example.com',
  stage: null,
  stageLabel: null,
  ...over,
})

const draw = (over: Partial<DrawerRow> = {}) =>
  render(
    <PersonDrawer
      clientId="cts"
      row={row(over)}
      stages={[]}
      viewerEmail="fde@example.com"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />,
  )

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })))
afterEach(() => vi.unstubAllGlobals())

/** 号码是不是被做成了可以点的拨号链接。 */
const dialLink = () =>
  Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href')?.startsWith('tel:'))

describe('号码打不通的人，抽屉里不许还能一点就拨', () => {
  it('打不通 → 没有拨号链接', () => {
    draw({ phoneUnusable: true })
    expect(dialLink()).toBeUndefined()
  })

  it('号码本身还得看得见 —— 要改号先得知道原来是什么', () => {
    draw({ phoneUnusable: true })
    expect(screen.getByText(/\+64211234567/)).toBeTruthy()
  })

  it('说清该做什么，别只是把按钮拿掉', () => {
    draw({ phoneUnusable: true })
    expect(screen.getByText(/这个号打不通/)).toBeTruthy()
    expect(screen.getByText(/要个新号/)).toBeTruthy()
  })

  it('邮箱照旧能点 —— 这正是他还留在名单上的原因', () => {
    draw({ phoneUnusable: true })
    const mail = Array.from(document.querySelectorAll('a')).find((a) =>
      a.getAttribute('href')?.startsWith('mailto:'),
    )
    expect(mail).toBeTruthy()
  })
})

describe('号码好好的人，一个字都不该变', () => {
  it('照旧是可以点的拨号链接', () => {
    draw()
    expect(dialLink()?.getAttribute('href')).toBe('tel:+64211234567')
  })

  it('不出现那句「打不通」的提醒', () => {
    draw()
    expect(screen.queryByText(/这个号打不通/)).toBeNull()
  })
})

/**
 * 🔴 **说了不联系，就别把联系按钮摆在手边**（狄仁杰复审 2026-08-16）。
 *
 * 原先这一屏同时出现「我们任何渠道都不会再联系他」和三个能点的入口 ——
 * 拨号、邮箱、以及紧挨着黄条下方一个**功能完整**的私信输入框。
 * 一句话和三个按钮打架，销售顺手一点就是一次骚扰。
 */
describe('拒联的人，一个能点的联系入口都不给', () => {
  it('不给拨号链接', () => {
    draw({ doNotContact: true })
    expect(dialLink()).toBeUndefined()
  })

  it('不给邮件链接', () => {
    draw({ doNotContact: true })
    expect(
      Array.from(document.querySelectorAll('a')).find((a) =>
        a.getAttribute('href')?.startsWith('mailto:'),
      ),
    ).toBeUndefined()
  })

  it('号码和邮箱本身还看得见 —— 要核对得先看得到', () => {
    draw({ doNotContact: true })
    expect(screen.getByText(/\+64211234567/)).toBeTruthy()
    expect(screen.getByText(/sue@example\.com/)).toBeTruthy()
  })

  it('没标拒联的人照常能点', () => {
    draw()
    expect(dialLink()).toBeTruthy()
  })
})

/**
 * 🔴 抽屉拿的是**打开那一刻的快照**（Codex 复审 2026-08-16）。父页面重拉列表
 * 不会更新它 —— 点完「放回名单」，黄条还在、电话邮箱还是点不动、私信框还是
 * 不显示，人得关掉抽屉再点开一次才联系得上刚放回来的人。
 */
describe('点完「放回名单」，这一屏当场就该能联系他', () => {
  it('点确认之后，黄条消失、拨号链接回来', async () => {
    // 抽屉里同时有时间线在拉数据 —— 按 URL 分流，否则时间线拿到 dnc 的响应会崩。
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('/dnc') ? { blockingStageLabel: null } : { timeline: [], omittedMessages: 0 },
      })),
    )
    draw({ doNotContact: true })

    expect(dialLink()).toBeUndefined()
    fireEvent.click(screen.getByText(/判错了？点这里放回名单/))
    fireEvent.click(screen.getByText('确认放回名单'))

    await waitFor(() => expect(screen.queryByText(/判错了？点这里放回名单/)).toBeNull())
    expect(dialLink()).toBeTruthy()
  })
})
