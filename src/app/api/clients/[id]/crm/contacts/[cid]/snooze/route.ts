import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { parseSnoozeDays } from '@/lib/crm/snooze'
import { recordManualTouchpoint } from '@/lib/crm/touchpoints'

/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/snooze
 *
 * 「这人先放一放」。到期自动回名单 —— 没有任何人需要记得去解除。
 *
 * 为什么是这个而不是「手动改分组」（PM 2026-08-03 问的就是后者）：
 * 手动维护的状态列必烂。推迟改变的是**系统看到的事实**（这人现在不该联系），
 * 分批照旧自己算；到期那条判断不成立了，他自然回来。
 *
 * **同时记一条触点**：三个月后有人翻这个人的记录，要看得见「7 月 3 日 Amy
 * 把他推迟到 10 月」。只改一个列不留痕，等于把一次真实的销售判断丢掉了。
 *
 * IDOR：contact 必须属于 path 上的 client，否则 404。
 * 幂等：重复推迟只是把时间改成新的；取消推迟对没推迟的人也返回 200。
 *
 * Body: { days: number | null }   —— null / 0 = 取消推迟。时间由服务端算，
 *        前端不传时间点（这一页同时给 NZ 和 AU 用，时区算错就是差一天）。
 * Responses: 200 { snoozeUntil } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { days?: unknown; clientRef?: unknown }
  try {
    body = (await req.json()) as { days?: unknown; clientRef?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const parsed = parseSnoozeDays(body.days, new Date())
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 必须带 client_id 一起查，否则换个 cid 就能改到别家客户的联系人。
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('contacts')
    .select('id, last_seen_at')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (findErr) {
    console.error('[crm/snooze] 查联系人失败:', findErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  /**
   * ⚠️ **先写这一笔，再改 snooze_until —— 顺序不能倒过来**
   * （Codex 复审 2026-08-15）。
   *
   * 这一笔以前只是「留痕」，失败了无所谓，所以包在一个吞异常的 try 里。
   * 现在不一样了：`withoutOurActionsSince` 靠它上面的 `action:'snooze'` 认出
   * 「这个人是**今天**被推迟的」，从而把冻结副本上的 snooze 清掉、让卡片留在
   * 原位变灰。**名单对不对，现在要靠这一笔。**
   *
   * 两条路都想过了：
   *   · 沿用「先改库、再尽力留痕」→ 留痕失败时 snooze_until 已经生效、
   *     标记却没有 → 冻结副本清不掉 → **卡片当天直接消失**，
   *     而接口还返回成功。正是这次要修的那个毛病，换了个触发条件。
   *   · 改成「先留痕、再改库」→ 两种失败都安全：
   *       留痕失败   → 500，两边都没动，重试（同 clientRef 幂等）即可
   *       改库失败   → 500，留下一笔孤立的记录，但人**没被推迟、留在名单上**，
   *                    冻结副本清一个 null 是空操作。重试会收敛。
   *
   * 两张表没法在一个事务里提交（走的是 REST），所以取「失败时偏向让人留在
   * 名单上」的那个顺序 —— 名单上多一个人是噪音，少一个人是丢单。
   *
   * ⚠️ **标记分 snooze / unsnooze 两个值**（Codex 第四轮）。取消推迟时若第二步
   * 失败，旧的 `snooze_until` **依然有效**；这时留下一个 `'snooze'` 标记，
   * 读路径会拿它去清冻结副本上那个真实的旧推迟 —— 一次失败的「叫回来」，
   * 刷新后反而把人挪进今天的名单还标成灰的。`'unsnooze'` 不清任何东西。
   *
   * （前端每次点击都新生成 `clientRef`，所以重试**不会**命中幂等键、
   * 会多留一笔记录。这里不假装它会收敛：多一笔「取消推迟」的记录是噪音，
   * 而上面那个方向错的清除是会骗人的，两害相权取前者。）
   */
  const when = parsed.until
    ? new Date(parsed.until).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
    : null

  try {
    await recordManualTouchpoint({
      clientId,
      contactId: cid,
      direction: 'outbound',
      note: when ? `先放一放，${when} 再联系` : '取消推迟，放回今天的名单',
      occurredAt: new Date().toISOString(),
      clientRef: typeof body.clientRef === 'string' && body.clientRef ? body.clientRef : crypto.randomUUID(),
      loggedByEmail: access.user?.email ?? null,
      currentLastSeenAt: (existing.last_seen_at as string | null) ?? null,
      // 推迟 → 冻结副本靠它认出「今天推的」，没有它人会凭空消失。
      // 取消推迟 → 只标「这一笔不是联系」，绝不能用 'snooze'（见上面的说明）。
      action: parsed.until ? 'snooze' : 'unsnooze',
      // 这句话是系统生成的固定文案，不含任何客户信息 —— 送去 AI 解析既慢又白花钱。
      parsed: {
        summary: when ? `推迟到 ${when}` : '取消推迟',
        // 推迟不是一次通话结果 —— 不能记成「没打通」或「聊过了」，
        // 那会污染分批（DEAD_OUTCOMES / retry_channel 都看这个字段）。
        outcome: 'unknown',
        do_not_contact: false,
        travel_window: null,
        tour_interest: null,
        competitor: null,
        callback_at: null,
      },
    })
  } catch (err) {
    console.error('[crm/snooze] 写留痕失败，推迟未生效:', err)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  const { error: updateErr } = await supabaseAdmin
    .from('contacts')
    .update({ snooze_until: parsed.until, updated_at: new Date().toISOString() })
    .eq('id', cid)
    .eq('client_id', clientId)

  if (updateErr) {
    console.error('[crm/snooze] 更新失败:', updateErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({ snoozeUntil: parsed.until })
}
