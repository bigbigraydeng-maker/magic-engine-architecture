/**
 * POST /api/clients/[id]/crm/touchpoints/batch
 *
 * 「这一批我群发过邮件了，帮我记一笔。」
 *
 * 没有这个端点，「打过没人接」那一桶（CTS 108 人）复制完邮箱发出去之后，
 * 桶上的数字还是 108，明天打开还是 108 —— 销售会认定这页记不住他做过什么，
 * 于是回去用 Excel。这正是 PM 那句「不好用」的另一面。
 *
 * 复用单条写入的全部保证：每个人各写一条自己的触点（不是一条大记录），
 * 所以时间线、冷热分级、「别再联系」全都照常工作。
 *
 * 幂等：整批共用一个 clientRef，每个人的 source_ref = `${clientRef}:${contactId}`。
 * 重复提交同一批不会重复记；同一批里的人各自独立，不会互相顶掉。
 *
 * Body: { contactIds: string[], note?, channel?, clientRef }
 * Responses: 200 { recorded, skipped, failed } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { recordManualTouchpoint } from '@/lib/crm/touchpoints'
import { classifyNote, reclassifyStoredOutcome, type NoteParse } from '@/lib/crm/note-parser'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { fetchAll } from '@/lib/supabase-paginate'

/** 一次最多记这么多，防手滑把整库刷一遍。CTS 最大的桶 108 人，够用。 */
const MAX_BATCH = 500

interface Body {
  contactIds?: unknown
  note?: unknown
  clientRef?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const seen = new Set<string>()
  const ids: string[] = []
  if (Array.isArray(body.contactIds)) {
    for (const v of body.contactIds) {
      if (typeof v !== 'string' || !v.trim()) continue
      const id = v.trim()
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: '没有选中任何人' }, { status: 400 })
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `一次最多记 ${MAX_BATCH} 人` }, { status: 400 })
  }

  const clientRef = typeof body.clientRef === 'string' ? body.clientRef.trim() : ''
  if (!clientRef) {
    return NextResponse.json({ error: '缺少 clientRef(幂等键)' }, { status: 400 })
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : '群发了一封邮件'

  // ── IDOR 闸：一次性筛出真正属于这个客户的人。不属于的直接不写，不报错泄露存在性。 ──
  const { data: owned, error: oErr } = await supabaseAdmin
    .from('contacts')
    .select('id, last_seen_at, do_not_contact')
    .eq('client_id', clientId)
    .in('id', ids)

  if (oErr) {
    return NextResponse.json({ error: oErr.message }, { status: 500 })
  }

  const rows = (owned ?? []) as { id: string; last_seen_at: string | null; do_not_contact: boolean }[]

  /**
   * 说过「别再联系」的人，即使前端传进来也绝不记 —— 群发时最容易误伤的就是他们。
   *
   * 🔴 判据不是那一列，是触点（Codex 复审 2026-08-16）。`contacts.do_not_contact`
   * 是尽力维护的镜像，写失败过；反过来，有人明确纠正过「这条判错了」之后，
   * 只要那次镜像更新没成功，这个人就会被群发**永远跳过**，而界面上已经显示
   * 他回到名单了。判据只有一份，见 `lib/crm/dnc`。
   */
  /**
   * 🔴 **必须分页拉全**（狄仁杰复审 2026-08-16）。
   *
   * Supabase 单次查询硬顶 1000 行，**被砍不报错**（`lib/supabase-paginate` 头注：
   * 2026-07-29 实测 CTS 库里 1271 条只回 1000 条）。一次最多群发 500 人，
   * 按 CTS 约 2.2 触点/人 算就有 1100 行 —— 稳稳超顶。
   *
   * 被砍掉的那些行里只要有某人**唯一那条**拒联触点，他的触点集就成了空，
   * `isDoNotContact` 判 false（镜像列本来就可能没写上），于是**一个明确说过
   * 别再联系的人被记上一笔群发**。下面那道「读不到真相源就整批不写」的闸
   * 拦不住它 —— 截断根本不报错，正好从闸底下钻过去。
   */
  let dncTouches: {
    id: string
    contact_id: string
    metadata: Record<string, unknown> | null
    occurred_at: string
    raw: string | null
    direction: string | null
    source: string | null
  }[]
  try {
    dncTouches = await fetchAll<{
      id: string
      contact_id: string
      metadata: Record<string, unknown> | null
      occurred_at: string
      raw: string | null
      direction: string | null
      source: string | null
    }>((from, to) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('id, contact_id, metadata, occurred_at, raw, direction, source')
        .eq('client_id', clientId)
        .in('contact_id', rows.map((r) => r.id))
        /**
         * 分页必须有**唯一**的排序键（Codex 复审 2026-08-16）。
         * 只按 `occurred_at` 排不够 —— 这个接口自己就会给整批人写同一个
         * `occurredAt`，并列的那一堆在不同 range 请求里可以换顺序，
         * 页与页之间就会重复或漏行。漏掉的若是某人唯一那条拒联触点，
         * 他就被留下、被记成群发过了。补 `id` 做 tie-breaker。
         */
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    )
  } catch (e) {
    /**
     * 读不到真相源就整批不写（Codex 复审 2026-08-16）。把失败当成
     * 「他们都没有拒联触点」，就会给一个明确说过别再联系的人记上一笔群发 ——
     * 这正是这套判据存在的理由。宁可让人重发一次。
     */
    return NextResponse.json({ error: e instanceof Error ? e.message : '读取拒联记录失败' }, { status: 500 })
  }

  const touchesByContact = new Map<string, DncTouch[]>()
  for (const t of dncTouches) {
    const list = touchesByContact.get(t.contact_id) ?? []
    list.push({
      // 存量里「其实是别再联系」的原话，读的时候重判一次（见 reclassifyStoredOutcome）。
      outcome:
        reclassifyStoredOutcome((t.metadata?.outcome as string) ?? null, t.raw, {
          direction: t.direction,
          source: t.source,
        }) ?? null,
      flagged: t.metadata?.do_not_contact === true,
      occurredAt: t.occurred_at,
    })
    touchesByContact.set(t.contact_id, list)
  }

  const targets = rows.filter(
    (r) => !isDoNotContact(r.do_not_contact, touchesByContact.get(r.id) ?? []),
  )

  const occurredAt = new Date().toISOString()

  // 整批共用一份解析结果。这句话是系统自己生成的、不含客户信息，
  // 送去 AI 解析 108 次既慢（整个请求必超时）又白花钱。规则层足够。
  const rules = classifyNote(note)
  const parsed: NoteParse = {
    outcome: rules.outcome,
    /**
     * 🔴 **群发的备注永远推不出「别再联系」**（Codex 复审 2026-08-16）。
     *
     * 这句 `note` 是**我们自己**对这次群发的描述（「群发了一封邮件」，或者
     * 调用方粘进来的发送说明 / 邮件摘要）—— 不是任何一个客人说的话。里面
     * 只要出现一次 `unsubscribe from the list` 这种页脚原文，这一整批
     * **最多 500 个人**就会被同一份判词一起拉黑，而取消是一次一个人的，
     * 没有批量入口。
     *
     * 上一轮给读路径加的「只认代表客人意愿的记录」那道方向闸管不到这里 ——
     * 这是**写**路径。所以在这里写死：群发只记「我们联系过他」，
     * 客人拒不拒联只能来自他自己的话（单条记一笔 / 入站消息）。
     */
    do_not_contact: false,
    travel_window: null,
    tour_interest: null,
    competitor: null,
    callback_at: null,
    summary: note.slice(0, 120),
  }

  let recorded = 0
  let skipped = 0
  let failed = 0

  // 顺序写：108 条对 Supabase 是小事，并发反而容易触发限流。
  for (const t of targets) {
    try {
      const res = await recordManualTouchpoint({
        clientId,
        contactId: t.id,
        direction: 'outbound',
        note,
        occurredAt,
        // 每人一个稳定的幂等键：同一批重复提交不会重复记。
        clientRef: `${clientRef}:${t.id}`,
        currentLastSeenAt: t.last_seen_at,
        parsed,
      })
      if (res.created) recorded++
      else skipped++
    } catch {
      failed++
    }
  }

  return NextResponse.json({
    recorded,
    // 重复提交（已经记过）+ 被挡下的「别再联系」
    skipped: skipped + (rows.length - targets.length),
    failed,
    notOwned: ids.length - rows.length,
  })
}
