/**
 * 从 info@ 邮箱的往来里读出「这个人的钱到账了没有」。
 *
 * ## 为什么需要它（PM 2026-09-02 拍板）
 *
 * CTS 的付款事实只存在于 info@ 邮箱：客人转账后发一封回单，Baker 收到钱后回一封
 * 确认。Mailchimp 那边**一个自动化都没有**，`paid_customer` 那 19 个标签是
 * 2026-08-30 有人翻邮箱手工打上去的。手工的代价当天就付了 —— 9/1 那次 192 人的
 * 群发里混进了 2 个已付款客户，其中 Nikki Smith 是 Baker 亲口回过
 * 「your payment has been received in full」的人。
 *
 * ## 唯一可靠的信号是「我们自己说收到了」
 *
 * 这个邮箱里有两种长得几乎一样的邮件：
 *
 *   催款  `Payment of Invoice - Best of China Tour`
 *         "Please find the credit card payment link below: https://..."
 *   收款  `Fw: New Reborn Lead: Nikki Smith`
 *         "Hi Nikki Your payment has been received in full."
 *
 * 两封都含 payment，都由 CTS 发出，都在 Sent Items。**按关键词匹配 `payment`
 * 就打标签，会把正在催款的客人标成付费客户，然后停掉他所有跟进邮件 —— 这单就
 * 丢了。** 所以判据不是「提到钱」，是「我们自己确认钱到账了」。
 *
 * 这跟 `crm/stage-from-conversation` 里那条已经写死的红线是同一条：
 * 一封写着「I'll transfer tomorrow」的邮件不等于钱到账，**看账不看话**。
 * 那个文件因此拒绝判定 deposit_paid / paid_full；这里之所以敢判，是因为只认
 * **我们自己发出去的确认句**，不认客人的任何声明。客人发来的回单截图一律降级成
 * `needs_review`，交给人点一下 —— 宁可多问一句，不可错停一单。
 *
 * ## 三条不许破的线
 *
 * 1. **只认 outbound 的确认句**。inbound 里客人说什么都只到 `needs_review`。
 * 2. **必须交回逐字原话**（铁律 8：绝不凭空注入客户业务数据）。调用方拿 evidence
 *    回原文里核对，对不上就整条丢掉。
 * 3. **只给已经在 Mailchimp 名单里的人打标签**（同 `mailchimp/sync` 的护栏）。
 *    本文件只判「这封信说了什么」，不判「这个人是谁」—— 身份归属在调用方，
 *    因为一封 outbound 的收件人可能是同事、供应商或一封转发。
 *
 * 本文件只有判断，不碰网络、不碰数据库 —— 每条判断都能被单测钉住。
 */

/** 判定结果。`evidence` 一律是原文里逐字截出来的那一句。 */
export type PaidSignal =
  | {
      /** 我们自己确认过钱到账 —— 可以自动打 `paid_customer`。 */
      kind: 'confirmed'
      evidence: string
    }
  | {
      /** 有付款的意思，但不是我们确认的 —— 下发给人点一下，不自动打。 */
      kind: 'needs_review'
      evidence: string
      reason: 'inbound_claim' | 'attachment_only'
    }
  | {
      /** 明确是在催款 —— 这个人**还没付**，碰都不要碰。 */
      kind: 'chasing'
      evidence: string
    }
  | { kind: 'not_payment' }

/**
 * 「我们收到钱了」的确认句。
 *
 * 全部要求出现在 **outbound** 邮件里。措辞取自 info@ 已发送里的真实句子
 * （2026-09-02 抽样）：Baker 写确认时稳定用 received / thank you for the payment
 * 这两类，不用 "got your money" 之类的口语。
 *
 * 刻意**不收**这些看起来也像的：
 *   · "booking is confirmed"  —— 行程确认 ≠ 钱到账，CTS 会先确认位子再收款
 *   · "we have your deposit"  —— 没在真实语料里出现过，凭空加等于放宽判据
 */
const RECEIVED_PATTERNS: readonly RegExp[] = [
  /\b(?:your |the )?(?:payment|deposit|balance)\s+(?:has\s+been|is|was)\s+received\b[^.!\n]*/i,
  /\bwe(?:'ve| have)\s+received\s+(?:your|the)\s+(?:payment|deposit|balance|funds)\b[^.!\n]*/i,
  /\breceived\s+(?:your|the)\s+(?:payment|deposit|balance)\s+(?:in\s+full|today|yesterday)?\b[^.!\n]*/i,
  /\bthank\s+you\s+(?:so\s+much\s+|very\s+much\s+|again\s+)?for\s+(?:your|the)\s+(?:payment|deposit)\b[^.!\n]*/i,
  /\b(?:payment|deposit)\s+received\b[^.!\n]*/i,
]

/**
 * 催款句 —— 命中这些说明**钱还没到**。
 *
 * 只在没有任何确认句时才判 `chasing`：一封「定金收到了，尾款请点这个链接」
 * 两种句子都有，那个人**确实付过定金**，该算 confirmed。所以顺序是
 * 先找确认句，找不到才看催款句（见 `readPaidSignal`）。
 */
const CHASING_PATTERNS: readonly RegExp[] = [
  /\b(?:credit\s+card\s+)?payment\s+link\b[^.!\n]*/i,
  /\bplease\s+(?:find|use|click)[^.!\n]*\bpayment\b[^.!\n]*/i,
  /\bplease\s+(?:make|complete|arrange)\s+(?:the\s+|your\s+|a\s+)?payment\b[^.!\n]*/i,
  /\b(?:awaiting|pending|outstanding)\s+payment\b[^.!\n]*/i,
  /\bpayment\s+is\s+(?:due|required|outstanding)\b[^.!\n]*/i,
]

/**
 * 客人自己说付了 —— 只到 `needs_review`。
 *
 * 「I'll transfer tomorrow」这种未来式故意**不收**：它连声明都算不上。
 * 收进来的都是已完成时态，人工确认的成本才划算。
 */
const INBOUND_CLAIM_PATTERNS: readonly RegExp[] = [
  /\bproof\s+of\s+(?:payment|account)\b[^.!\n]*/i,
  /\bpayment\s+confirmation\b[^.!\n]*/i,
  /\bi(?:'ve| have)\s+(?:just\s+)?(?:made|paid|transferred|sent)\s+(?:the|your|a)?\s*(?:payment|deposit|money|funds)\b[^.!\n]*/i,
  /\b(?:payment|deposit|money)\s+(?:has\s+been\s+)?transferred\b[^.!\n]*/i,
  /\bpaid\s+the\s+(?:deposit|balance|invoice)\b[^.!\n]*/i,
]

/**
 * 客人回一句「附件里」就不写别的 —— 付款截图 / 银行回单本身，正文只字不提。
 *
 * 单看 `hasAttachment` 什么都证明不了：一封带附件的询价信（行程单、护照照片）
 * 一样会有附件。只有正文本身**已经在谈付款**（`payment` / `deposit` /
 * `invoice` / `receipt` / `balance` 这类词），证据却止步于文字、真正的凭证
 * 藏在附件里没法读的时候，才够格降级成 `needs_review`。
 */
const ATTACHMENT_PAYMENT_CONTEXT_PATTERNS: readonly RegExp[] = [
  /\b(?:payment|deposit|balance|invoice|receipt)\b[^.!\n]*/i,
]

/** 逐字截出命中的那一句，供调用方回原文核对。截断只是为了日志好读。 */
const EVIDENCE_MAX = 200

/**
 * 「一旦 / 当 / 如果」收到钱 —— 这是**还没发生的事**，不是确认句。
 *
 * 真实语料里就有这种写法：`Once your payment is received, we will send the
 * invoice.` / `Once we have received your payment, ...`。它们跟
 * `Your payment has been received` 长得几乎一样（都含 `payment ... received`），
 * 但语义完全相反 —— 前者还在等钱，后者钱已经到账。判断依据是**整个分句**开头
 * 是不是条件词，而不是只看紧贴在命中短语前面的那几个字：「Once we have
 * received your payment」里，条件词 `once` 隔着 `we have` 才挨到
 * `received your payment`，只看紧邻前缀会漏掉它。命中 RECEIVED_PATTERNS 后
 * 必须回头看它所在分句开头，不然就是把「还没付」判成「已付」，比催款误判更隐蔽。
 */
const CONDITIONAL_CLAUSE_START = /^\s*(?:once|when|if|after|upon|as\s+soon\s+as|provided\s+that|assuming)\b/i

/** 分句边界：句号/问号/感叹号/换行/逗号 —— 条件从句常见的收尾都在这几个字符上。 */
function clauseStart(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (/[.!?\n,]/.test(text[i])) return i + 1
  }
  return 0
}

function hasConditionalPrefix(text: string, matchIndex: number): boolean {
  const clause = text.slice(clauseStart(text, matchIndex), matchIndex)
  return CONDITIONAL_CLAUSE_START.test(clause)
}

/** 命中就返回逐字原句；跳过被「once/when/if」等条件句管辖的假命中，继续往后找。 */
function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const re of patterns) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    let m: RegExpExecArray | null
    while ((m = global.exec(text))) {
      if (!hasConditionalPrefix(text, m.index)) return m[0].trim().slice(0, EVIDENCE_MAX)
      if (global.lastIndex === m.index) global.lastIndex += 1
    }
  }
  return null
}

export interface PaidSignalInput {
  /** 主题 + 正文摘要拼起来的可搜文本。 */
  text: string
  /** 这封是我们发出去的还是客人发进来的。 */
  direction: 'inbound' | 'outbound'
  /** 这封带附件吗（客人的回单/截图通常是附件）。 */
  hasAttachment?: boolean
}

/**
 * 读一封邮件，判断它是否证明「这个人的钱到账了」。
 *
 * 判定顺序是有意的，换顺序会出事：
 *
 *   1. 先找**我们自己的确认句** —— 一封「定金收到了，尾款请点链接」两种句子
 *      都有，先看确认句才不会把它误判成催款。
 *   2. 再看**催款句** —— 到这一步说明全文没有任何确认，那就是真的还没付。
 *      单独标出来而不是并进 not_payment，是为了让调用方能把它记成
 *      「这个人被催过款」，将来做跟进用。
 *   3. 最后才看客人的声明 —— 只到 needs_review，永不自动打标签。
 *   4. 声明都没有、但带附件又在谈付款 —— 证据可能就在附件里，同样只到
 *      needs_review，理由标成 `attachment_only` 方便人工核对时先看附件。
 */
export function readPaidSignal(input: PaidSignalInput): PaidSignal {
  const text = (input.text ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return { kind: 'not_payment' }

  // ① 我们自己确认收款 —— 唯一能自动打标签的信号，且只认 outbound。
  if (input.direction === 'outbound') {
    const confirmed = firstMatch(text, RECEIVED_PATTERNS)
    if (confirmed) return { kind: 'confirmed', evidence: confirmed }
  }

  // ② 没有任何确认句，却在催款 —— 这个人还没付，明确标出来别碰。
  const chasing = firstMatch(text, CHASING_PATTERNS)
  if (chasing) return { kind: 'chasing', evidence: chasing }

  // ③ 客人自己说付了 / 甩了张回单 —— 交给人点一下。
  if (input.direction === 'inbound') {
    const claim = firstMatch(text, INBOUND_CLAIM_PATTERNS)
    if (claim) return { kind: 'needs_review', evidence: claim, reason: 'inbound_claim' }

    // ④ 正文没写声明，但带附件、又在谈付款 —— 证据大概率在附件里，别静默丢掉。
    if (input.hasAttachment) {
      const ctx = firstMatch(text, ATTACHMENT_PAYMENT_CONTEXT_PATTERNS)
      if (ctx) return { kind: 'needs_review', evidence: ctx, reason: 'attachment_only' }
    }
  }

  return { kind: 'not_payment' }
}

/**
 * evidence 必须能在原文里逐字找回来 —— 调用方落库前跑一次。
 *
 * 防的是「判定逻辑改了正则、evidence 变成了拼接出来的句子」这种漂移：
 * 一旦 evidence 不再是原话，铁律 8 那条「说不出原话就不算数」就失效了，
 * 而且**不会报错**，只会安静地开始编。
 */
export function evidenceIsVerbatim(evidence: string, sourceText: string): boolean {
  if (!evidence.trim()) return false
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  return norm(sourceText).includes(norm(evidence))
}

/**
 * 这个邮箱能不能当成「客人」。
 *
 * 一封 outbound 的收件人可能是同事、供应商，或者一封内部转发 —— 真实语料里
 * 就有 `Fw: New Reborn Lead: ...` 这种转发后又回给客人的信。把同事的邮箱打上
 * `paid_customer` 不只是脏数据，还会把他从所有营销名单里踢出去。
 *
 * 这里只挡最硬的两类（自己人 / 机器人）。**真正的护栏在调用方**：找不到
 * Mailchimp 名单里已有的这个人就跳过，绝不新建 —— 同 `mailchimp/sync` 的做法。
 */
const OWN_DOMAINS: readonly string[] = ['ctstours.co.nz']
const ROBOT_LOCALPARTS: readonly string[] = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'notifications',
  'bounce',
]

export function looksLikeCustomerAddress(address: string | null | undefined): boolean {
  const email = (address ?? '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false
  const [local, domain] = email.split('@')
  if (OWN_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false
  if (ROBOT_LOCALPARTS.some((r) => local === r || local.startsWith(`${r}+`) || local.startsWith(`${r}-`))) {
    return false
  }
  return true
}
