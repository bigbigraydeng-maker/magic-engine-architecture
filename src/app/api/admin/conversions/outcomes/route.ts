/**
 * POST /api/admin/conversions/outcomes  —— 录入一条成交 / 咨询事实（Issue #1397 PR1）
 * GET  /api/admin/conversions/outcomes  —— 列出某客户的行（审核页与今日待办用）
 *
 * 录进来的行一律是 `pending_review`，**本 PR 不发任何事件、不碰 Meta**。
 * 审核放行与发送在 PR3；这里只保证"事实进得来、进来的是干净的"。
 *
 * Security: guardAdmin。
 *   不用 guardGlobalAdmin —— 这个接口只写单个客户的数据，
 *   受限管理员（只能看自己那个客户的演示账号）录自己客户的成交是合理的。
 *   但下面仍然按 allowedClientId 做了范围校验，防止越客户写入。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { buildIntakeRow, type IntakeInput } from '@/lib/conversions/intake'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 审计里记请求来源。只有 reviewed_by 邮箱不够 —— 会话被劫也是同一个邮箱。 */
function requestMeta(request: Request) {
  const fwd = request.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0]?.trim() || null
  return { ip, ua: request.headers.get('user-agent') }
}

export async function POST(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const actor = admin.user.email ?? null

  let body: IntakeInput
  try {
    body = (await request.json()) as IntakeInput
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  if (!UUID_RE.test(body?.clientId ?? '')) {
    return NextResponse.json({ error: 'clientId 必须是 uuid' }, { status: 400 })
  }

  // 受限管理员只能录自己那个客户的
  const perms = getUserPermissions(actor ?? '')
  if (perms?.allowedClientId && perms.allowedClientId !== body.clientId) {
    return NextResponse.json({ error: '无权为该客户录入' }, { status: 403 })
  }

  // 电话转国际格式要知道客户所在国。查不到就让 intake 层丢掉本地格式电话
  // （宁可少一个匹配键，也不猜错国家 —— 猜错会匹配到别人）。
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, default_phone_country')
    .eq('id', body.clientId)
    .maybeSingle()

  if (clientErr) {
    return NextResponse.json({ error: `读取客户配置失败: ${clientErr.message}` }, { status: 500 })
  }
  if (!client) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 })
  }

  const built = buildIntakeRow(
    { ...body, createdBy: actor },
    {
      defaultPhoneCountry: (client as { default_phone_country: string | null }).default_phone_country,
      now: new Date(),
    },
  )

  if (!built.ok) {
    return NextResponse.json({ error: '校验未通过', details: built.errors }, { status: 400 })
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('me_sale_outcomes')
    .insert(built.row)
    .select('id, outcome_kind, review_status, occurred_at, amount_minor, currency, order_ref')
    .single()

  if (insertErr) {
    return NextResponse.json({ error: `写入失败: ${insertErr.message}` }, { status: 500 })
  }

  const row = inserted as { id: string; order_ref: string | null }
  const meta = requestMeta(request)

  // 审计写失败不回滚录入 —— 事实本身已经落库，丢一条日志不该把它撤掉。
  // 但要如实告诉调用方（下面 audit_logged 字段），不假装成功。
  const { error: auditErr } = await supabaseAdmin.from('me_conversion_audit').insert({
    outcome_id: row.id,
    action: 'created',
    actor,
    ip: meta.ip,
    ua: meta.ua,
    detail: {
      source_kind: built.row.source_kind,
      source_ref: built.row.source_ref,
      warnings: built.warnings,
    },
  })

  // 同单号提示：幂等键改用行 id 之后，重复录入只能靠这个提醒人
  // （魏征 v3 复审：同单号手工录两次 = Meta 收两笔 Purchase）。
  let duplicateHint: string | null = null
  if (row.order_ref) {
    const { count } = await supabaseAdmin
      .from('me_sale_outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', built.row.client_id)
      .eq('order_ref', row.order_ref)

    if ((count ?? 0) > 1) {
      duplicateHint = `单号 ${row.order_ref} 下已有 ${count} 条记录 —— 审核放行前请确认不是重复录入`
    }
  }

  return NextResponse.json(
    {
      outcome: inserted,
      warnings: built.warnings,
      duplicate_hint: duplicateHint,
      audit_logged: !auditErr,
      ...(auditErr ? { audit_error: auditErr.message } : {}),
      next: '已存为待审核。审核放行与发送在 PR3 上线后可用。',
    },
    { status: 201 },
  )
}

export async function GET(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const status = searchParams.get('review_status')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 200)

  if (!clientId || !UUID_RE.test(clientId)) {
    return NextResponse.json({ error: 'client_id 必填且必须是 uuid' }, { status: 400 })
  }

  const perms = getUserPermissions(admin.user.email ?? '')
  if (perms?.allowedClientId && perms.allowedClientId !== clientId) {
    return NextResponse.json({ error: '无权查看该客户' }, { status: 403 })
  }

  let query = supabaseAdmin
    .from('me_sale_outcomes')
    // 🔴 不返回 customer_email / customer_phone 明文。
    //    列表页展示用打码版，由前端从 masked_* 读；需要看全的走单条详情接口（PR3）。
    .select(
      'id, outcome_kind, order_ref, amount_minor, currency, occurred_at, ' +
        'review_status, reject_reason, redacted_at, dispatched_at, source_kind, created_at',
    )
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('review_status', status)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: `查询失败: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ outcomes: data ?? [], count: data?.length ?? 0 })
}
