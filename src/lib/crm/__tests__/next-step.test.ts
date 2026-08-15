/**
 * 记完一笔之后回给销售的那一句话。
 *
 * PM 2026-08-15 要的是：打电话时在卡上敲「三月两个人去南岛，周五给报价」，
 * 回车，系统自己在周五那天把人放回名单。
 *
 * 排程那一半早通了。这里钉的是**确认**那一半 —— 没有它，销售无法知道那个
 * 「周五」被读懂了没有，只能自己再记一遍（功能白做），或者信了而周五没人
 * 提醒他（比白做更糟，答应客人的事砸了）。
 */

import { describe, expect, it } from 'vitest'
import { mentionsTime, nextStepDate, noteConfirmation } from '../next-step'

const NZ = 'Pacific/Auckland'

describe('把日期说成他能核对的样子', () => {
  /**
   * **必须带星期几。** 他嘴里说的是「周五」，确认里只写「8月21日」他还得
   * 自己数一遍那是不是周五 —— 而这句话存在的全部意义就是一眼核对。
   */
  it('带星期几', () => {
    // UTC 8/20 21:00 = 新西兰 8/21 09:00，那天是周五
    const s = nextStepDate('2026-08-20T21:00:00.000Z', NZ)
    expect(s).toContain('周五')
  })

  /**
   * 按客户所在地算。服务器在世界标准时间，比新西兰晚 12 小时 ——
   * 直接格式化会把晚上的约定显示成前一天。
   */
  it('按客户所在地算，不按服务器', () => {
    // UTC 8/20 21:00 = 新西兰 8/21 09:00
    const iso = '2026-08-20T21:00:00.000Z'
    expect(nextStepDate(iso, NZ)).toContain('21')
    expect(nextStepDate(iso, 'UTC')).toContain('20')
  })

  it('时间坏掉返回 null，不显示乱码', () => {
    expect(nextStepDate('不是时间', NZ)).toBeNull()
  })
})

describe('三种结局要分得清', () => {
  it('读懂了 → 说出具体哪天', () => {
    const s = noteConfirmation('周五给报价', { callbackAt: '2026-08-20T21:00:00.000Z' }, NZ)
    expect(s).toContain('21')
    expect(s).toContain('周五')
  })

  it('压根没提下一步 → 不提这茬，别弄出「没排」的焦虑', () => {
    expect(noteConfirmation('聊得不错，问了长城那个团', {}, NZ)).toBe('✓ 记好了')
  })

  /**
   * 🔴 **最要紧的一条：他说了时间，但没解析出来 —— 必须说。**
   *
   * 不说的话他会以为排好了，到那天没人提醒，答应客人的事就砸了。
   * 这比「功能没做」更糟：功能没做他还会自己记，假装做了他就不记了。
   */
  it.each([
    '周五给报价',
    '下周二再打给他',
    '明天上午联系',
    '8月20号再问一次',
    'call him Friday',
    'follow up next week',
    '回头再联系',
  ])('说了「%s」却没排上 → 明说没读懂', (note) => {
    const s = noteConfirmation(note, { callbackAt: null }, NZ)
    expect(s).toContain('没读懂')
  })

  it('「别再联系」优先说 —— 这一条人会立刻消失', () => {
    const s = noteConfirmation('客户说别再打了', { doNotContact: true }, NZ)
    expect(s).toContain('别再联系')
  })

  /** 解析出来的时间坏掉 → 退回「没读懂」，绝不假装排好了。 */
  it('解析出来的时间是坏的 → 当没排上处理', () => {
    const s = noteConfirmation('周五给报价', { callbackAt: '坏时间' }, NZ)
    expect(s).toContain('没读懂')
  })
})

describe('像不像提到了下次时间', () => {
  it.each([
    '周五给报价',
    '礼拜三再打',
    '星期一联系',
    '明天上午',
    '下周再说',
    '下个月再问',
    '8月20号',
    '再打给他',
    '回头联系',
    'call him back',
    'follow-up tomorrow',
    'next week',
  ])('认出「%s」', (s) => {
    expect(mentionsTime(s)).toBe(true)
  })

  it.each([
    '聊得不错，问了长城那个团',
    '想明年三月去',
    '价格太贵了',
    '',
  ])('不误报「%s」', (s) => {
    expect(mentionsTime(s)).toBe(false)
  })
})
