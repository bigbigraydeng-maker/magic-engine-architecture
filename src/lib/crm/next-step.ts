/**
 * 「你刚才说的下一步，排在哪天了」—— 一句给销售看的确认。
 *
 * ## 为什么这句话是整个功能的关键
 *
 * PM 2026-08-15 要的功能是：打电话时在卡上敲一行「三月两个人去南岛，周五给
 * 报价」，回车，**系统自己在周五那天的名单上生成一张卡**。
 *
 * 排程那一半早就通了（`segmentContact` 规则 3 读 `callbackAt`，到点把人捞回
 * 名单）。但如果敲完只回一句「✓ 记好了」，销售**无法确认那个「周五」被读懂了
 * 没有** —— 而它有可能没读懂（说得含糊、解析器返回 null）。
 *
 * 他只有两个选择：要么自己另外记一遍（那这个功能白做），要么信了、而周五
 * 其实没人提醒他（那比白做更糟 —— 他答应了客人的事没兑现）。
 *
 * 所以这句话必须**分得清三种结局**：
 *   · 读懂了      → 说出**具体哪天**，他能当场核对
 *   · 没说下一步   → 不提这茬，别弄出「没排」的焦虑
 *   · 说了但没读懂 → **明说没排上**，让他自己去设 —— 绝不假装排好了
 *
 * 判断层不知道「说没说下一步」，只知道「解析出日期没有」。所以第三种结局
 * 要靠调用方把「原话里像是提了时间」这个信号传进来，见 `mentionsTime`。
 */

/** 一句话里像不像提到了「下次什么时候」。宁可多报 —— 多问一句好过静悄悄漏掉。 */
const TIME_HINTS = [
  // 中文：周几 / 明后天 / 下周 / 几号 / 月份 / 再联系类
  /周[一二三四五六日天末]/,
  /礼拜[一二三四五六日天]/,
  /星期[一二三四五六日天]/,
  /明天|后天|大后天|今晚|下周|下星期|下个?月|月底|月初/,
  /\d{1,2}\s*[月号日]/,
  /再(打|联系|说|聊|谈|发|问)/,
  /回头(打|联系|说|再)/,
  // 英文
  /\b(mon|tue|wed|thu|fri|sat|sun)(day|s)?\b/i,
  /\b(tomorrow|tonight|next week|next month|later this week)\b/i,
  /\bcall (him|her|them|back)\b/i,
  /\bfollow[- ]?up\b/i,
]

export function mentionsTime(note: string): boolean {
  const t = note.trim()
  if (!t) return false
  return TIME_HINTS.some((p) => p.test(t))
}

/**
 * 把 ISO 时间说成销售看得懂的那种日期。
 *
 * **必须带星期几**：他嘴里说的是「周五」，确认里只写「8月21日」他还得自己
 * 数一遍那是不是周五 —— 而这句话存在的全部意义就是让他一眼核对。
 *
 * 按客户所在地算：服务器在世界标准时间，比新西兰晚 12 小时，
 * 直接格式化会把晚上的约定显示成前一天。
 */
export function nextStepDate(iso: string, timeZone = 'Pacific/Auckland'): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }).format(d)
  } catch {
    return null
  }
}

export interface NoteOutcome {
  /** 解析出来的下次联系时间（ISO），没有就是 null。 */
  callbackAt?: string | null
  /** 读出「别再联系」了。 */
  doNotContact?: boolean
}

/**
 * 记完一笔之后，回给销售的那一句话。
 *
 * @param note      他刚才打的原话 —— 用来判断「他到底说没说下一步」
 * @param outcome   服务端解析出来的结果
 * @param timeZone  客户所在地时区
 */
export function noteConfirmation(
  note: string,
  outcome: NoteOutcome,
  timeZone = 'Pacific/Auckland',
): string {
  // 「别再联系」优先说 —— 这一条人会立刻从名单上消失，不说清楚他会以为自己删错了。
  // （消失本身是刻意的，理由见 lib/crm/day-list 的 withoutOurActionsSince。）
  if (outcome.doNotContact) {
    return '✓ 记好了 —— 读出他说「别再联系」，他不会再进「今天要联系」的名单。档案还在，「全部客人」里随时翻得到'
  }

  const when = outcome.callbackAt ? nextStepDate(outcome.callbackAt, timeZone) : null
  if (when) {
    return `✓ 记好了 —— ${when} 会把他放回今天的名单，到时候提醒你`
  }

  // 他明明提了时间，却没解析出来 —— **必须说**。
  // 不说的话他会以为排好了，到那天没人提醒，答应客人的事就砸了。
  if (mentionsTime(note)) {
    return '✓ 记好了。但没读懂你说的下次时间 —— 想让系统到时候提醒你，用「推迟」挑个日子'
  }

  return '✓ 记好了'
}
