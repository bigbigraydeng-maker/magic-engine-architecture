/**
 * POST /api/clients/[id]/crm/contacts/[cid]/dnc
 *
 * 「这条『别再联系』判错了」—— **人明确纠正**。
 *
 * ## 为什么必须有这个接口（PM 2026-08-16）
 *
 * 早前的判词把「not intending to go」（我不打算去）当成了「别再联系我」，
 * 有人因此被永久静默排除 —— 收不到我们任何消息。词表已经改好，但存量那些人
 * **回不来**：判据看的是**触点**（`lib/crm/dnc` 里写了为什么），而系统里
 * 原本**没有任何取消入口**。
 *
 * 在这个接口存在之前，「这个人被误判了」是一件**没人做得到**的事 ——
 * 下发一条「去把勾取消掉」的人工任务，FDE 照做也不会有任何变化。
 *
 * ## 只做「纠正」这一个方向
 *
 * 这里**不提供反向**（把人标成别再联系）：那件事已经有路了 —— 销售在卡片上
 * 记一笔「客户说别再联系」，解析器会认出来。多一个直接置位的入口只会多一个
 * 误伤客户的按钮。
 *
 * ## 留痕，不是抹掉
 *
 * 纠正写成**一条新触点**（`outcome: 'dnc_cleared'`），不去删那条误判的记录 ——
 * 真相源不可变是这套系统的地基。谁在什么时候纠正的、写了什么理由，全都留着。
 * 顺带把 `contacts.do_not_contact` 一起放下来（那一列是反规范化的镜像）。
 *
 * Body: { note?: string, clientRef: string }
 * Responses: 200 { ok, touchpointId } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { DNC_CLEARED_OUTCOME } from '@/lib/crm/dnc'
import { isMarketingAction, stageSuppressesWorklist } from '@/lib/crm/pipeline'

interface Body {
  note?: unknown
  clientRef?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const contactId = params.cid
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

  // 幂等键：双击不该记成两笔纠正。
  const clientRef = typeof body.clientRef === 'string' ? body.clientRef.trim() : ''
  if (!clientRef) {
    return NextResponse.json({ error: '缺少 clientRef(幂等键)' }, { status: 400 })
  }

  const note =
    typeof body.note === 'string' && body.note.trim()
      ? body.note.replace(/\u0000/g, '').trim().slice(0, 2000)
      : '人工复核：这条「别再联系」判错了'

  // ── IDOR 闸：contact 必须属于 path 上的 client ──
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, stage')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const occurredAt = new Date().toISOString()

  /**
   * 🔴 **先写触点，再放下那一列**。
   *
   * 判据看的是触点（见 `lib/crm/dnc`）。反过来的话，中间失败会留下
   * 「列已经放下、但触点还说别再联系」—— 页面上看着像取消了，实际这个人
   * 照旧被排除，而没有任何记录说明发生过什么。
   */
  const { data: inserted, error: tErr } = await supabaseAdmin
    .from('contact_touchpoints')
    .upsert(
      {
        client_id: clientId,
        contact_id: contactId,
        channel: 'phone',
        direction: 'outbound',
        occurred_at: occurredAt,
        summary: note.slice(0, 120),
        raw: note,
        metadata: {
          outcome: DNC_CLEARED_OUTCOME,
          do_not_contact: false,
          // 谁纠正的 —— 这是一次覆盖系统判断的人工动作，必须留名。
          logged_by: access.user?.email ?? null,
        },
        source: 'me_manual',
        source_ref: clientRef,
      },
      { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const { error: uErr } = await supabaseAdmin
    .from('contacts')
    .update({ do_not_contact: false })
    .eq('id', contactId)
    .eq('client_id', clientId)

  /**
   * 🔴 那一列没放下就是**没成**（Codex 复审 2026-08-16）。
   *
   * 判据（`lib/crm/dnc`）确实以触点为准，但**不是所有消费方都走判据**：
   * 今日待办的 `pushDncReviewItems()` 和群发接口都还直接按
   * `contacts.do_not_contact = true` 筛人。这一列没放下来，页面上写着
   * 「放回名单了」，实际这个人照旧被群发跳过，那条人工任务第二天又冒出来 ——
   * FDE 会以为自己点了个假按钮。
   *
   * 所以报失败，让人再点一下：`clientRef` 是幂等键，重试不会记成两笔纠正，
   * 触点已经写好了，重试补的就是这第二步。跟 `recordManualTouchpoint()`
   * 遇到同类镜像更新失败时的做法一致。
   */
  if (uErr) {
    console.warn('[crm/dnc] 触点已写，contacts 列没更新上:', uErr.message)
    return NextResponse.json({ error: '只改了一半，再点一下' }, { status: 500 })
  }

  /**
   * 🔴 **还差一步的话，必须当面说**（Codex 复审 2026-08-16）。
   *
   * 当初这条误判往往还带来了第二个后果：有人接受了系统「改到停止营销」的建议。
   * 那一档会让他照旧被排除在名单外 —— 于是黄条消失了、人工任务也不再冒出来，
   * 人却还是不回来，而且再没有入口。
   *
   * 这里**不替他改阶段**：那一档是**人**手动确认过的，比这次纠正更该由人来定
   * （万一他当时另有理由呢）。但也绝不能默不作声 —— 把还挡着的那一档的名字
   * 告诉界面，界面直接说「还得把『XX』这一档改掉」，改阶段的按钮就在同一屏上。
   */
  let blockingStageLabel: string | null = null
  if (contact.stage) {
    const { data: stageRow } = await supabaseAdmin
      .from('client_pipeline_stages')
      .select('label, marketing_action, is_terminal')
      .eq('client_id', clientId)
      .eq('stage_key', contact.stage)
      .maybeSingle()
    const row = stageRow as {
      label: string
      marketing_action: string | null
      is_terminal: boolean | null
    } | null
    if (
      row &&
      stageSuppressesWorklist(
        isMarketingAction(row.marketing_action) ? row.marketing_action : null,
        row.is_terminal,
      )
    ) {
      blockingStageLabel = row.label
    }
  }

  return NextResponse.json({
    ok: true,
    touchpointId: inserted?.id ?? null,
    blockingStageLabel,
  })
}
