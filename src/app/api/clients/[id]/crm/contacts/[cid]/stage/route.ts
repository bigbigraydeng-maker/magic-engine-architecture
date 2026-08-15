/**
 * PATCH /api/clients/[id]/crm/contacts/[cid]/stage
 *
 * 把一个联系人推进 / 改到另一个阶段,并留一条审计(谁、从哪档、改到哪档、为什么)。
 *
 * 安全 / 稳定:
 *   IDOR   contact 必须属于 path client:WHERE id=cid AND client_id=clientId → 404。
 *   合法值  toStage 必须是「本客户」真实存在的 stage_key,否则 400 —— 禁写任意字符串。
 *   幂等    current.stage === toStage → 直接 200,不写重复 event(吸收双击)。
 *
 * Body: { toStage, note? }
 * Responses: 200 { stage } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

interface Body {
  toStage?: unknown
  note?: unknown
}

export async function PATCH(
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

  const toStage = typeof body.toStage === 'string' ? body.toStage.trim() : ''
  if (!toStage) {
    return NextResponse.json({ error: '缺少目标阶段' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim() || null : null

  // ── IDOR 闸:contact 必须属于 path client。同时拿当前 stage 做 from + 幂等判断。 ──
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, stage')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  if (!contact) {
    return NextResponse.json({ error: '联系人不存在' }, { status: 404 })
  }

  // 合法值闸:toStage 必须是本客户真实存在的阶段。
  const { data: stageRow, error: sErr } = await supabaseAdmin
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
    .eq('stage_key', toStage)
    .maybeSingle()

  if (sErr) {
    return NextResponse.json({ error: sErr.message }, { status: 500 })
  }
  if (!stageRow) {
    return NextResponse.json({ error: '这个阶段不存在' }, { status: 400 })
  }

  const fromStage = (contact.stage as string | null) ?? null

  // 幂等:没变就不写 event。
  if (fromStage === toStage) {
    return NextResponse.json({ stage: toStage, changed: false })
  }

  const nowIso = new Date().toISOString()

  /**
   * ⚠️ **先写这条变更记录，再改 contacts.stage —— 顺序不能倒过来**
   * （Codex 复审 2026-08-15）。
   *
   * 这条以前纯粹是审计，「失败也只是少一条历史」，所以放在 UPDATE 之后、
   * 连 error 都不看。现在不一样了：`today` 路由靠它的 `from_stage` 判断
   * 「这个人今天早上本来在不在名单上」，从而决定卡片是留在原位变灰还是消失。
   * **名单对不对，现在要靠这一条。**
   *
   * 写失败而 stage 已经改成「不再联系」时，读路径找不到证据 → 冻结副本不清
   * `stageSuppressed` → **卡片在一句「已改为 XX」的成功提示之后当场消失**。
   *
   * 两张表没法在一个事务里提交（走 REST），所以取「失败时偏向让人留在名单上」
   * 的那个顺序，跟 snooze 路由一致：
   *   · 记录写失败 → 500，两边都没动，重试即可
   *   · 改库失败   → 500，留下一条孤立的记录，但人**没被改阶段、留在名单上**
   *
   * 名单上多一个人是噪音，少一个人是丢单。
   */
  const { data: evt, error: evtErr } = await supabaseAdmin
    .from('contact_stage_events')
    .insert({
      client_id: clientId,
      contact_id: contactId,
      from_stage: fromStage,
      to_stage: toStage,
      changed_by: access.user.email ?? null,
      note,
    })
    .select('id')
    .single()

  if (evtErr) {
    return NextResponse.json({ error: `改阶段失败: ${evtErr.message}` }, { status: 500 })
  }

  const { error: updErr } = await supabaseAdmin
    .from('contacts')
    .update({ stage: toStage, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', contactId)
    .eq('client_id', clientId)

  if (updErr) {
    /**
     * **把刚写的那条记录撤掉**（Codex 复审第四轮）。
     *
     * 这张表已经不只是内部证据了 —— `contacts/[cid]/timeline` 会把它原样铺给
     * 销售看。留一条「新询价 → 已成交」而阶段其实根本没变，等于在客户的往来
     * 记录里写了一件没发生过的事；重试还会再插一条重复的。
     *
     * 撤不掉也只能记日志：残留一条审计噪音，比让请求假装成功好得多。
     */
    const { error: rbErr } = await supabaseAdmin
      .from('contact_stage_events')
      .delete()
      .eq('id', evt.id)
      .eq('client_id', clientId)
    if (rbErr) {
      console.error('[crm/stage] 阶段没改成，撤回那条变更记录也失败了:', rbErr.message)
    }
    return NextResponse.json({ error: `改阶段失败: ${updErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ stage: toStage, changed: true })
}
