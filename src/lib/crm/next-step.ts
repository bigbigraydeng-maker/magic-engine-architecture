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
 *
 * ## ⚠️ `mentionsTime` 用正则做，已经到头了 —— 再不准就该换做法
 *
 * 2026-08-15 这一天它被改了三轮，而且**其中一轮的修法自己制造了反向的错**：
 *
 *   1. 只看有没有日期 → 「客户想 8 月 20 日出发」被当成约了下一步（**误报**）
 *   2. 整句里有「出发」就排除 → 「客户十月出发，周五联系」里那个真的回访
 *      日期被一起屏蔽（**漏报**，比误报危险）
 *   3. 改成按子句判 —— 现在这版
 *
 * 「这句话里到底有没有约下一步」是**语义判断**，正则只能逼近。真要更准，
 * 正确的做法是让 `note-parser` 的模型**直接回答这个问题**（它本来就在读这句
 * 话、也已经在返回 `callback_at`），多一个 `mentioned_next_step: boolean`
 * 就够 —— 而不是在这里继续堆规则。
 *
 * 线上用起来还是不准的话，从这里下手，别再加正则。
 */

/** 像时间的说法：周几 / 明后天 / 下周 / 几月几号。 */
const TIME_HINTS = [
  /周[一二三四五六日天末]/,
  /礼拜[一二三四五六日天]/,
  /星期[一二三四五六日天]/,
  /明天|后天|大后天|今晚|下周|下星期|下个?月|月底|月初/,
  /\d{1,2}\s*[月号日]/,
  /\b(mon|tue|wed|thu|fri|sat|sun)(day|s)?\b/i,
  /\b(tomorrow|tonight|next week|next month|later this week)\b/i,
]

/**
 * 「我下次要做什么」——**这类说法本身就等于约了下一步**，不用再找时间词。
 */
const FOLLOWUP_HINTS = [
  /再(打|联系|说|聊|谈|发|问|约)/,
  /回头(打|联系|说|发|再)/,
  /(给|发)(他|她|客人|客户)?(报价|方案|行程|资料|价格)/,
  /跟进|回电|回复他|回他/,
  /\bcall (him|her|them|back)\b/i,
  /\bfollow[- ]?up\b/i,
  /\b(send|email|quote)\b.*\b(him|her|them|quote|itinerary)\b/i,
]

/**
 * 这句话里的日期说的是**客人什么时候出行**，不是「我下次什么时候联系他」。
 *
 * 旅游生意的笔记里出行日期到处都是（「客户想 8 月 20 日出发」），
 * 而那种日期**本来就不该排成回访** —— 解析器留 `callback_at: null` 是对的。
 */
const TRAVEL_HINTS = [
  /出发|出行|启程|动身|成行/,
  /(去|飞|到)(中国|北京|上海|南岛|北岛|欧洲|日本)/,
  /入境|落地|抵达|回国/,
  /\b(depart|departure|travel|fly|flying|arrive|arrival|trip)\b/i,
]

/** 一句笔记按标点切成几段 —— 出行和下一步常常各占一段。 */
function clausesOf(note: string): string[] {
  return note
    .split(/[，,。；;、\n]+/)
    .map((c) => c.trim())
    .filter(Boolean)
}

/**
 * 这句话里像不像提到了「**下次什么时候联系他**」。
 *
 * ⚠️ **不能只看有没有日期**（Codex 复审 2026-08-15）。「客户想 8 月 20 日
 * 出发」里那个日期是**出行时间**；解析器正确地不把它排成回访，而这里如果
 * 报 true，销售会看到一句「没读懂你说的下次时间」—— 一条**根本不存在的
 * 失败警告**。CTS 的笔记里出行日期到处都是，假警报一多真警报也会被无视。
 *
 * ⚠️ **但排除必须按「子句」，不能按整句**（同一轮复审的第二条，
 * 而且是上一版修法自己引入的）：「客户十月出发，**周五联系**」——
 * 整句里有「出发」，就把后半句那个**真的回访日期**一起屏蔽掉了 →
 * 静默不提醒 → 销售以为排好了，周五没人叫他。
 *
 * **漏报比误报危险得多**（漏报 = 答应客人的事砸了），所以宁可切细一点。
 *
 * 逐段判断，任一段成立即算：
 *   1. 这段明说了下一步动作（「再打」「给报价」）→ 是
 *   2. 这段有日期、但同一段里在讲出行 → 不是
 *   3. 这段光有日期 → 是（「下周二」这种，宁可多问一句）
 */
export function mentionsTime(note: string): boolean {
  const t = note.trim()
  if (!t) return false

  // 整句先看一遍下一步动作：动作词和时间词可能被标点分在两段
  // （「周五，再打给他」），那种情况整句判定更稳。
  if (FOLLOWUP_HINTS.some((p) => p.test(t))) return true

  return clausesOf(t).some((c) => {
    if (!TIME_HINTS.some((p) => p.test(c))) return false
    // 这一段的日期是在讲出行 —— 那不是「我下次联系他」的时间。
    return !TRAVEL_HINTS.some((p) => p.test(c))
  })
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
  timeZone?: string | null,
): string {
  // 调用方（页面）拿的是服务端回的时区。老部署 / 字段缺失时退回 NZ ——
  // 两个客户目前都在纽西兰，猜错也只差两小时，比整句话不显示强。
  const tz = timeZone || 'Pacific/Auckland'
  // 「别再联系」优先说 —— 这一条人会立刻从名单上消失，不说清楚他会以为自己删错了。
  // （消失本身是刻意的，理由见 lib/crm/day-list 的 withoutOurActionsSince。）
  if (outcome.doNotContact) {
    return '✓ 记好了 —— 读出他说「别再联系」，他不会再进「今天要联系」的名单。档案还在，「全部客人」里随时翻得到'
  }

  const when = outcome.callbackAt ? nextStepDate(outcome.callbackAt, tz) : null
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
