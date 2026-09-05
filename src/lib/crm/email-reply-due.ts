/**
 * 客人来信超过一天还没人回 —— 挑出来**提醒销售**。
 *
 * ## 为什么要有这个文件
 *
 * 邮件线程早就同步进 `conversations` 了，`last_message_from` 也一直在写，
 * 但**没有任何一处去看「客人最后说话、然后就没下文了」这件事**。
 * 结果是：一封询价信躺在收件箱里，谁都以为别人回过了，三天后客人去了别家。
 *
 * ## 为什么只提示、不自动回信
 *
 * 跟 `messenger-stop-signal` 同一条纪律：**这个文件一行写操作都没有**。
 * 判中了只是让销售多看一眼；判错了代价是浪费他 10 秒，不是替他发一封错信。
 * 改它之前先想清楚这一行。
 *
 * ## 哪些「没回」不算没回
 *
 * 判据宁可**少报**也不要让销售对提醒失去信任 —— 一旦出现一批明显不该提醒的
 * 条目（自动回执、同事之间的转发、已经说过别再联系的人），这一栏就会被整体
 * 忽略，那比没有这一栏更糟。所以下面每一条排除都要单独成立：
 *
 *   1. 最后说话的是我们（`last_message_from = 'page'`）→ 球不在我们这
 *   2. 主题是自动回执（`isAutoReply`）→ 那不是客人在等回信
 *   3. 这个人是自己人 / 同行（`contactKindOf`）→ 不属于「客人在等」
 *   4. 已经算拒联了（`isDoNotContact`）→ 不该再联系，谈不上欠他一封信
 *   5. 那封信**之后**有人手工记过一笔（`source = 'me_manual'`）→ 有人处理过了
 *
 * 时间窗（默认 30 天）兜底，免得一条谁都不打算处理的旧线程天天冒出来。
 * ⚠️ 代价要认：**窗口外的线程不会再被提起**。要做到「一条都不漏」得加一列
 * 「已复核」，那是另一件事。
 *
 * ## 为什么按自然小时算，周末不豁免（PM 2026-09-03 拍板）
 *
 * 旅游生意周末照样进单，客人不会因为今天是周六就多等两天。工作日历一旦引进来，
 * 还要处理公众假期、时区、客户各自的营业时间 —— 那是一整套东西，而它换来的
 * 只是把周末的提醒推迟。先用最简单也最保守的口径：**自然小时数**。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { contactKindOf, readDomainRules, EMPTY_RULES, type DomainRules } from '@/lib/crm/contact-kind'
import { isAutoReply } from '@/lib/microsoft/mail-ingest'
import { fetchAll } from '@/lib/supabase-paginate'

/** 客人来信之后多少小时还没回，就算欠着。PM 2026-09-03 拍板 24 小时。 */
export const REPLY_SLA_HOURS = 24

/** 只看最近这些天的线程。见文件头「哪些『没回』不算没回」。 */
export const REPLY_DUE_WINDOW_DAYS = 30

/**
 * 今日待办那一页一个客户最多列多少条。
 *
 * 🔴 这是**渲染层**的密度预算，不是判据的一部分，所以**不是默认值** ——
 *    今日待办是一页要逐条看完的清单，一次塞 200 条等于一条都不会被看；
 *    而汇总邮件是另一个消费方，一封信列 25 条没有任何问题。
 *    早先把它写死成 `pickReplyDue` 的默认上限，结果汇总邮件也被静默压到 10 条，
 *    还把压过的数字当成事实报给销售（「有 10 封在等」，实际 25 封）——
 *    销售照着处理完以为清空了。**上限只能由消费方显式传，判据本身不封顶。**
 */
export const MAX_PER_CLIENT = 10

/**
 * `.in()` 一次最多塞多少个 id。
 *
 * 🔴 不是性能优化，是能不能跑起来：PostgREST 的 `.in()` 走 URL 查询串，
 * 几百个 UUID 就能把请求撑到过长而在到数据库之前失败，而这条通道的异常会被
 * 上层 catch 吞掉 —— 结果是整条通道一条待办都不下发。同仓
 * `messenger-stop-signal.ts` / `qualified-buyer-autotag.ts` 都按 100 分批。
 */
const IN_CHUNK = 100

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 一条邮件线程的判据材料，字段跟 `conversations` 那几列一一对应。 */
export interface EmailThread {
  /** `conversations.id` */
  conversationId: string
  clientId: string
  contactId: string
  /** `conversations.subject`，用来判自动回执。 */
  subject: string | null
  /** `conversations.last_message_at` —— 客人最后说话的时间。 */
  lastMessageAt: string
  /** `conversations.last_message_from` */
  lastMessageFrom: 'customer' | 'page' | null
}

/** 挑出来的一条「欠着一封回信」。 */
export interface ReplyDueItem {
  /** 哪个客户（ME 的客户，不是客人）。 */
  clientId: string
  /** 欠谁的回信 —— `contacts.id`。 */
  contactId: string
  /** 哪条线程 —— `conversations.id`，用来拼直达链接。 */
  conversationId: string
  /** 客人叫什么（`contacts.display_name`）。查不到就是 null。 */
  displayName: string | null
  /** 邮件主题，销售一眼认出是哪封信。 */
  subject: string | null
  /** 客人最后说话的时间（ISO）。 */
  lastMessageAt: string
  /** 已经等了多少个自然小时（向下取整）。排序和文案都用它。 */
  waitingHours: number
}

export interface ReplyDueInput {
  threads: EmailThread[]
  /** contactId → 这个人的拒联判决材料。查不到的人按「没被标过」处理。 */
  dnc: Map<string, { flag: boolean; touches: DncTouch[] }>
  /** contactId → 最后一次**人工**触点的时间。晚于来信 = 有人处理过了。 */
  lastHumanTouchAt: Map<string, string>
  /** contactId → 这个人的全部邮箱，判自己人 / 同行用。 */
  emails: Map<string, string[]>
  /** contactId → `contacts.display_name`。 */
  names: Map<string, string | null>
  /** clientId → 这个客户登记的域名清单。查不到按「没登记」处理。 */
  rules: Map<string, DomainRules>
  now: Date
  slaHours?: number
  windowDays?: number
  /** 每客户最多留几条。**不传 = 不封顶**，理由见 `MAX_PER_CLIENT`。 */
  maxPerClient?: number
}

export interface ReplyDueResult {
  items: ReplyDueItem[]
  /** 因为每客户上限被压下去的条数 —— 不许静默丢。 */
  dropped: number
  /**
   * clientId → 这个客户被压掉几条。
   *
   * 光有一个总数没法下发：待办和汇总信都要说「**这个客户**还有几封没列出来」，
   * 说不出是谁的就只能写进日志，等于没说（铁律 3：发现不许死在日志里）。
   */
  droppedByClient: Record<string, number>
}

interface Ctx {
  input: ReplyDueInput
  nowMs: number
  slaMs: number
  windowMs: number
}

/**
 * 这条线程现在是不是「欠着一封回信」。
 *
 * 每一条排除都对应文件头列的一条，改任何一条前先回去看它为什么在那儿。
 */
function isDue(t: EmailThread, ctx: Ctx): boolean {
  // 1) 球不在我们这
  if (t.lastMessageFrom !== 'customer') return false

  const waited = ctx.nowMs - ts(t.lastMessageAt)
  // 还没到点 / 已经出了时间窗
  if (waited < ctx.slaMs) return false
  if (waited > ctx.windowMs) return false

  // 2) 自动回执不是客人在等回信。词表复用 mail-ingest，不另起一份。
  if (isAutoReply(t.subject)) return false

  // 3) 自己人 / 同行不算「客人在等」
  const rules = ctx.input.rules.get(t.clientId) ?? EMPTY_RULES
  if (contactKindOf(ctx.input.emails.get(t.contactId) ?? [], rules) !== 'retail') return false

  // 4) 已经算拒联了。查不到材料就按「没被标过」办。
  const d = ctx.input.dnc.get(t.contactId)
  if (d && isDoNotContact(d.flag, d.touches)) return false

  // 5) 这封信之后有人手工记过一笔 = 有人处理过了
  if (ts(ctx.input.lastHumanTouchAt.get(t.contactId)) >= ts(t.lastMessageAt)) return false

  return true
}

/** 每客户封顶，被压掉的算进 `dropped`。等最久的排前面，压掉的是等得最短的。 */
function capPerClient(all: ReplyDueItem[], maxPerClient: number): ReplyDueResult {
  const perClient = new Map<string, number>()
  const items: ReplyDueItem[] = []
  const droppedByClient: Record<string, number> = {}
  let dropped = 0
  for (const item of all) {
    const n = perClient.get(item.clientId) ?? 0
    if (n >= maxPerClient) {
      dropped++
      droppedByClient[item.clientId] = (droppedByClient[item.clientId] ?? 0) + 1
      continue
    }
    perClient.set(item.clientId, n + 1)
    items.push(item)
  }
  return { items, dropped, droppedByClient }
}

/**
 * 纯判据：哪些线程欠着一封回信。**不碰数据库。**
 *
 * 拆成纯函数是为了能把每一条规矩单独钉住 —— IO 那半边
 * （`findEmailRepliesDue`）只负责把行取出来喂进来。
 */
export function pickReplyDue(input: ReplyDueInput): ReplyDueResult {
  const ctx: Ctx = {
    input,
    nowMs: input.now.getTime(),
    slaMs: (input.slaHours ?? REPLY_SLA_HOURS) * HOUR_MS,
    windowMs: (input.windowDays ?? REPLY_DUE_WINDOW_DAYS) * DAY_MS,
  }

  /**
   * contactId → 这个人**等最久**的那条线程。
   * 同一个人开三条线程不该在待办上占三行 —— 销售点开的是这个人，不是线程。
   */
  const oldest = new Map<string, ReplyDueItem>()
  for (const t of input.threads) {
    if (!isDue(t, ctx)) continue
    const prev = oldest.get(t.contactId)
    if (prev && ts(prev.lastMessageAt) <= ts(t.lastMessageAt)) continue
    oldest.set(t.contactId, {
      clientId: t.clientId,
      contactId: t.contactId,
      conversationId: t.conversationId,
      displayName: input.names.get(t.contactId) ?? null,
      subject: t.subject,
      lastMessageAt: t.lastMessageAt,
      waitingHours: Math.floor((ctx.nowMs - ts(t.lastMessageAt)) / HOUR_MS),
    })
  }

  // 等最久的排前面：真被上限压掉，压掉的该是等得最短的那些。
  // 不传上限 = 不封顶。封顶是消费方各自的渲染预算，见 `MAX_PER_CLIENT`。
  const all = Array.from(oldest.values()).sort((a, b) => b.waitingHours - a.waitingHours)
  return capPerClient(all, input.maxPerClient ?? Number.POSITIVE_INFINITY)
}

// ─── 取数 ────────────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string
  client_id: string
  contact_id: string | null
  subject: string | null
  last_message_at: string | null
  last_message_from: string | null
}

interface TouchRow {
  contact_id: string
  occurred_at: string
  source: string | null
  metadata: Record<string, unknown> | null
}

interface ContactRow {
  id: string
  do_not_contact: boolean | null
  display_name: string | null
}

interface IdentityRow {
  contact_id: string
  value: string
}

interface ClientRow {
  id: string
  leads_config: unknown
}

/**
 * 窗口内、客人最后说话、且已经挂上人的邮件线程。
 *
 * 🔴 客户 id 也要分批 —— 跟下面四个 loader 同一个理由（见 `IN_CHUNK`）。
 *    这里是最上游那一处：它整个失败 = 后面四个 loader 一个都不会跑，
 *    整条通道一条都不下发。
 */
async function loadThreads(
  supabase: SupabaseClient,
  clientIds: string[],
  cutoff: string,
): Promise<ConversationRow[]> {
  const out: ConversationRow[] = []
  for (const part of chunk(clientIds, IN_CHUNK)) {
    const rows = await fetchAll<ConversationRow>((from, to) =>
      supabase
        .from('conversations')
        .select('id, client_id, contact_id, subject, last_message_at, last_message_from')
        .in('client_id', part)
        .eq('channel', 'email')
        .eq('last_message_from', 'customer')
        .gte('last_message_at', cutoff)
        .not('contact_id', 'is', null)
        // 稳定排序 —— 没有它分页边界上的行会换位，重复或漏行。
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }
  return out
}

/** 触点：既拿来判「已经算拒联了吗」，也拿来判「有人处理过了吗」。 */
async function loadTouchMaps(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<{
  dnc: Map<string, { flag: boolean; touches: DncTouch[] }>
  lastHumanTouchAt: Map<string, string>
}> {
  const dnc = new Map<string, { flag: boolean; touches: DncTouch[] }>()
  const lastHumanTouchAt = new Map<string, string>()

  for (const part of chunk(contactIds, IN_CHUNK)) {
    const rows = await fetchAll<TouchRow>((from, to) =>
      supabase
        .from('contact_touchpoints')
        .select('contact_id, occurred_at, source, metadata')
        .in('contact_id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const t of rows) {
      const meta = (t.metadata ?? {}) as Record<string, unknown>
      const entry = dnc.get(t.contact_id) ?? { flag: false, touches: [] }
      entry.touches.push({
        outcome: (meta.outcome as string) ?? null,
        flagged: meta.do_not_contact === true,
        occurredAt: t.occurred_at,
      })
      dnc.set(t.contact_id, entry)

      if (t.source === 'me_manual') {
        const prev = lastHumanTouchAt.get(t.contact_id)
        if (!prev || ts(t.occurred_at) > ts(prev)) lastHumanTouchAt.set(t.contact_id, t.occurred_at)
      }
    }
  }
  return { dnc, lastHumanTouchAt }
}

/**
 * `contacts` 的拒联镜像列 + 显示名。
 *
 * 镜像列要跟触点一起给 `isDoNotContact` —— 触点是真相源，列是尽力维护的镜像，
 * 但「触点写成功、镜像失败」和「镜像写成功、触点没写」两种半写入状态都出现过。
 */
async function loadContacts(supabase: SupabaseClient, contactIds: string[]): Promise<ContactRow[]> {
  const out: ContactRow[] = []
  for (const part of chunk(contactIds, IN_CHUNK)) {
    const rows = await fetchAll<ContactRow>((from, to) =>
      supabase
        .from('contacts')
        .select('id, do_not_contact, display_name')
        .in('id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }
  return out
}

/** 这批人的邮箱。一个人可能挂多个，只要有一个命中同事/同行域名就算数。 */
async function loadEmails(
  supabase: SupabaseClient,
  contactIds: string[],
): Promise<Map<string, string[]>> {
  const emails = new Map<string, string[]>()
  for (const part of chunk(contactIds, IN_CHUNK)) {
    const rows = await fetchAll<IdentityRow>((from, to) =>
      supabase
        .from('contact_identities')
        .select('contact_id, value')
        .in('contact_id', part)
        .eq('kind', 'email')
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const r of rows) {
      const list = emails.get(r.contact_id) ?? []
      if (!list.includes(r.value)) list.push(r.value)
      emails.set(r.contact_id, list)
    }
  }
  return emails
}

/** 每个客户登记的自己人 / 同行域名清单。 */
async function loadRules(
  supabase: SupabaseClient,
  clientIds: string[],
): Promise<Map<string, DomainRules>> {
  const rules = new Map<string, DomainRules>()
  for (const part of chunk(clientIds, IN_CHUNK)) {
    const rows = await fetchAll<ClientRow>((from, to) =>
      supabase
        .from('clients')
        .select('id, leads_config')
        .in('id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    for (const c of rows) rules.set(c.id, readDomainRules(c.leads_config))
  }
  return rules
}

export interface ReplyDuePolicy {
  slaHours?: number
  windowDays?: number
  maxPerClient?: number
}

/**
 * 把候选线程捞出来喂给 `pickReplyDue`。**只读，一行写操作都没有。**
 *
 * @param now 传进来而不是 `new Date()`：测试要能钉住超时边界和时间窗。
 */
export async function findEmailRepliesDue(
  supabase: SupabaseClient,
  clientIds: string[],
  now: Date,
  policy: ReplyDuePolicy = {},
): Promise<ReplyDueResult> {
  const empty: ReplyDueResult = { items: [], dropped: 0, droppedByClient: {} }
  if (clientIds.length === 0) return empty

  const windowDays = policy.windowDays ?? REPLY_DUE_WINDOW_DAYS
  const cutoff = new Date(now.getTime() - windowDays * DAY_MS).toISOString()

  const convos = await loadThreads(supabase, clientIds, cutoff)
  const threads: EmailThread[] = convos
    .filter((c): c is ConversationRow & { contact_id: string; last_message_at: string } =>
      Boolean(c.contact_id && c.last_message_at),
    )
    .map((c) => ({
      conversationId: c.id,
      clientId: c.client_id,
      contactId: c.contact_id,
      subject: c.subject,
      lastMessageAt: c.last_message_at,
      lastMessageFrom: c.last_message_from === 'page' ? 'page' : 'customer',
    }))
  if (threads.length === 0) return empty

  const contactIds = Array.from(new Set(threads.map((t) => t.contactId)))
  const { dnc, lastHumanTouchAt } = await loadTouchMaps(supabase, contactIds)
  const contacts = await loadContacts(supabase, contactIds)
  const names = new Map<string, string | null>()
  for (const c of contacts) {
    names.set(c.id, c.display_name)
    const entry = dnc.get(c.id) ?? { flag: false, touches: [] }
    entry.flag = c.do_not_contact === true
    dnc.set(c.id, entry)
  }

  const result = pickReplyDue({
    threads,
    dnc,
    lastHumanTouchAt,
    emails: await loadEmails(supabase, contactIds),
    names,
    rules: await loadRules(supabase, clientIds),
    now,
    slaHours: policy.slaHours,
    windowDays,
    maxPerClient: policy.maxPerClient,
  })

  // 被上限压掉的条数不许静默消失。日志只是补充 —— 真正的下发靠 `droppedByClient`
  // 一路传到消费方那一端（铁律 3「发现不许死在日志里」）。只有调用方自己传了
  // 上限才可能出现，判据本身不封顶。
  if (result.dropped > 0) {
    console.warn(
      `[email-reply-due] 每客户上限 ${policy.maxPerClient} 条，` +
        `另有 ${result.dropped} 条超时未回没有下发`,
    )
  }
  return result
}
