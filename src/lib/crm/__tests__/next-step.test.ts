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

/**
 * 🔴 **确认里那个日期，必须跟服务端真正排上的那天是同一天**
 * （Codex 复审 2026-08-15）。
 *
 * 澳洲客户的路由用 `Australia/Sydney` 解析相对时间。如果页面这边按
 * `Pacific/Auckland` 显示，销售说的「周五晚上 11 点」会被排在悉尼周五、
 * 却确认成奥克兰周六 —— **而这句话存在的全部意义就是让他核对**。
 * 差一天的确认比不确认更糟：他会以为自己记错了，或者信了错的那天。
 */
describe('确认用的时区 = 服务端排程用的时区', () => {
  // 悉尼周五 23:00 = UTC 13:00；同一时刻在奥克兰已经是周六 01:00
  const FRI_NIGHT_SYDNEY = '2026-08-21T13:00:00.000Z'

  it('澳洲客户按悉尼说 —— 周五就是周五', () => {
    const s = noteConfirmation('周五晚上给报价', { callbackAt: FRI_NIGHT_SYDNEY }, 'Australia/Sydney')
    expect(s).toContain('周五')
  })

  it('同一时刻按奥克兰说会变成周六 —— 正是要避免的那个结果', () => {
    const s = noteConfirmation('周五晚上给报价', { callbackAt: FRI_NIGHT_SYDNEY }, 'Pacific/Auckland')
    expect(s).toContain('周六')
  })

  /** 服务端没回时区（老部署 / 字段缺失）→ 退回 NZ，不能整句话不显示。 */
  it.each([undefined, null, ''])('时区缺失（%s）→ 退回纽西兰，照常给出日期', (tz) => {
    const s = noteConfirmation('周五给报价', { callbackAt: '2026-08-20T21:00:00.000Z' }, tz)
    expect(s).toContain('周五')
    expect(s).not.toContain('没读懂')
  })
})

/**
 * 🔴 **出行日期 ≠ 下次联系日期**（Codex 复审 2026-08-15）。
 *
 * 旅游生意的笔记里出行日期到处都是：「客户想 8 月 20 日出发」。
 * 那个日期**本来就不该排成回访**，解析器留 null 是对的 —— 但如果这里报
 * 「说了时间」，销售会看到一句「没读懂你说的下次时间」，**一条根本不存在的
 * 失败警告**。
 *
 * 假警报一多，真警报也会被无视 —— 那条护栏（说了时间却没排上必须告诉他）
 * 就彻底废了。而那条护栏正是这个功能最要紧的一半。
 */
describe('出行日期不算「说了下次联系时间」', () => {
  it.each([
    '客户想 8 月 20 日出发',
    '10月3日出发，两个人',
    '想 12 月飞北京',
    '客户 8 月 15 日抵达奥克兰',
    'departing 20 August, two pax',
    'wants to travel next month',
  ])('不误报「%s」', (note) => {
    expect(mentionsTime(note)).toBe(false)
    expect(noteConfirmation(note, { callbackAt: null }, NZ)).toBe('✓ 记好了')
  })

  /** 同一句里既说了出行、又约了下一步 → 照旧要报（下一步是真的）。 */
  it.each([
    '8月20日出发，周五给他报价',
    '10月出发，明天再打给他',
    'departing October, call him back Friday',
  ])('出行 + 明确下一步「%s」→ 照旧报', (note) => {
    expect(mentionsTime(note)).toBe(true)
  })

  /** 只说了个时间、没说要干嘛 —— 宁可多问一句，别静悄悄漏掉。 */
  it.each(['下周二', '周五', '明天上午'])('光说时间「%s」→ 还是报', (note) => {
    expect(mentionsTime(note)).toBe(true)
  })
})
