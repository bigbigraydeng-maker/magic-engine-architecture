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

/**
 * 🔴 **排除出行日期必须按「子句」，不能按整句**
 * （Codex 复审 2026-08-15 第二条 —— 上一版修法自己引入的漏洞）。
 *
 * 「客户十月出发，周五联系」：整句里有「出发」，按整句排除就把后半句那个
 * **真的回访日期**一起屏蔽了 → 静默不提醒 → 销售以为排好了，周五没人叫他。
 *
 * 漏报比误报危险得多（漏报 = 答应客人的事砸了），所以宁可切细一点。
 */
describe('出行和下一步写在同一句里，各算各的', () => {
  it.each([
    '客户十月出发，周五联系',
    '10月3日出发，周五给个价',
    '想 12 月飞北京，下周二再确认',
    '客户 8 月抵达，明天上午联络',
  ])('「%s」→ 后半句那个日期照旧算数', (note) => {
    expect(mentionsTime(note)).toBe(true)
  })

  it.each([
    '客户想 8 月 20 日出发',
    '10月3日出发，两个人，预算充足',
    '12 月飞北京，全家一起',
  ])('整段都在讲出行「%s」→ 照旧不误报', (note) => {
    expect(mentionsTime(note)).toBe(false)
  })

  /** 动作词和时间词被标点分开时，整句那一遍兜住。 */
  it('「周五，再打给他」—— 动作和时间分在两段也算', () => {
    expect(mentionsTime('周五，再打给他')).toBe(true)
  })
})

/**
 * 🔴 **确认只能说「那天会提醒你」，不能暗示这几天他会消失**
 * （Codex 复审 2026-08-15，P1）。
 *
 * `segmentContact` 的规则 3 只在**约定时间已经到了**（`callbackAt <= now`）
 * 时才认。未到期的约定**不改变任何事** —— 这个人第二天起照旧每天出现在名单上。
 *
 * 原话「周五会把他放回今天的名单」里那个「放回」，暗示他这几天不在名单上。
 * 销售照着理解成「周五之前不用管他」，明天却又看见他 —— 要么困惑，
 * 要么提前又打一次。**说了会消失却没消失，比不说更糟。**
 *
 * （「说好周五，那这几天他还该不该出现」是产品决策，已上抛 PM。）
 */
describe('确认不许暗示这几天他会从名单上消失', () => {
  const msg = () =>
    noteConfirmation('周五给报价', { callbackAt: '2026-08-20T21:00:00.000Z' }, NZ)

  it.each(['放回', '收起', '不会出现', '暂时不用管'])('不出现「%s」这种说法', (word) => {
    expect(msg()).not.toContain(word)
  })

  it('说的是那天会把他排到最前面提醒你 —— 那是真会发生的事', () => {
    expect(msg()).toContain('最前面')
  })
})
