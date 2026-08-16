/**
 * 「别再联系」到底成不成立。
 *
 * 🔴 这是系统里最重的一个标记：成立 = **任何渠道都不许再发**。
 *
 * 早前的判词把「not intending to go」（我不打算去）当成了「别再联系我」，
 * 被误判的人从此收不到我们任何消息。而在这份判据存在之前，取消客户档案上
 * 那个勾**没有用**（判据看的是触点），系统里也没有取消入口 ——
 * 「这个人判错了」是一件没人做得到的事。
 */

import { describe, expect, it } from 'vitest'
import { isDoNotContact, DNC_CLEARED_OUTCOME } from '../dnc'

const at = (d: string) => `2026-08-${d}T00:00:00Z`

describe('说过别再联系的，一条都不许漏', () => {
  it('触点里说过 → 算', () => {
    expect(isDoNotContact(false, [{ outcome: 'do_not_contact', occurredAt: at('01') }])).toBe(true)
  })

  it('历史导入只写了 metadata.do_not_contact → 也算', () => {
    expect(isDoNotContact(false, [{ flagged: true, occurredAt: at('01') }])).toBe(true)
  })

  /** contacts 那一列是反规范化的镜像，写失败过 —— 但说是就得认。 */
  it('只有 contacts 那一列说是 → 也算', () => {
    expect(isDoNotContact(true, [])).toBe(true)
  })

  it('谁都没说过 → 不算', () => {
    expect(isDoNotContact(false, [{ outcome: 'spoke', occurredAt: at('01') }])).toBe(false)
  })
})

describe('人明确纠正过「这条判错了」', () => {
  const cleared = (d: string) => ({ outcome: DNC_CLEARED_OUTCOME, occurredAt: at(d) })

  it('纠正晚于那条误判 → 这个人回到名单上', () => {
    expect(
      isDoNotContact(false, [{ outcome: 'do_not_contact', occurredAt: at('01') }, cleared('02')]),
    ).toBe(false)
  })

  /**
   * 🔴 连 contacts 那一列都不算数 —— 纠正的人看过原话，
   * 而那一列很可能正是当初被误判时写上去的。不这样的话「取消」按钮点了没用。
   */
  it('纠正之后，contacts 那一列说是也不算数', () => {
    expect(
      isDoNotContact(true, [{ outcome: 'do_not_contact', occurredAt: at('01') }, cleared('02')]),
    ).toBe(false)
  })

  /** 纠正之后客人**又**说了别再联系 —— 以最后一次为准，重新算数。 */
  it('纠正之后他又说了别再联系 → 重新算数', () => {
    expect(
      isDoNotContact(false, [
        { outcome: 'do_not_contact', occurredAt: at('01') },
        cleared('02'),
        { outcome: 'do_not_contact', occurredAt: at('03') },
      ]),
    ).toBe(true)
  })

  /** 纠正**早于**那条拒联 —— 说明后来他真的说了，不许放回来。 */
  it('纠正早于那条拒联 → 仍然算数', () => {
    expect(
      isDoNotContact(false, [cleared('01'), { outcome: 'do_not_contact', occurredAt: at('02') }]),
    ).toBe(true)
  })
})
