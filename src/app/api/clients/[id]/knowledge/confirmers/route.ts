/**
 * Client Knowledge Base — confirmer registry admin API (issue #1669).
 *
 * 只有全局管理员（`isGlobalAdminEmail`）能登记/撤销一个客户的知识库确认
 * 人。路由层先做一次快速拒绝（清楚的 403，不用等到库函数抛异常），
 * `registerConfirmer`/`revokeConfirmer` 内部再独立做一次同样的检查——
 * 不假设调用这两个函数的每一处未来代码都记得先查权限。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import {
  registerConfirmer,
  revokeConfirmer,
  KnowledgeConfirmerAuthorizationError,
  type KnowledgeConfirmerWriteClient,
} from '@/lib/knowledge/confirmers'

type Params = { params: { id: string } }

// 桥接 unknown：supabaseAdmin 是真实 supabase-js 客户端，泛型链太深 tsc 结构
// 比对会报 "excessively deep"（跟 read.ts/mining.ts 的 defaultSupabase() 同一
// 限制）。实测：本机 PG 沙盘对着真实 client_knowledge_confirmers /
// client_portal_users 两张表跑过跟 confirmers.ts 里完全一样的 select/insert/
// update 调用链，方法名和参数形状逐一核对一致，不是凭空假设的。
function asConfirmerWriteClient(client: typeof supabaseAdmin): KnowledgeConfirmerWriteClient {
  return client as unknown as KnowledgeConfirmerWriteClient
}

// GET /api/clients/[id]/knowledge/confirmers — list this client's currently
// registered confirmers. Any dashboard user for this client can read the
// list (it's just email addresses, not a sensitive action); only a global
// admin can change it (POST/DELETE below).
export async function GET(_req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('client_knowledge_confirmers')
    .select('id, confirmer_email, registered_by_email, registered_at')
    .eq('client_id', params.id)
    .is('revoked_at', null)
    .order('registered_at', { ascending: true })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, confirmers: data ?? [] })
}

// POST /api/clients/[id]/knowledge/confirmers — register a confirmer.
// Global-admin only.
export async function POST(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }
  const actorEmail = access.user.email ?? ''
  if (!isGlobalAdminEmail(actorEmail)) {
    return NextResponse.json({ success: false, error: '只有全局管理员能登记客户确认人' }, { status: 403 })
  }

  const body = await req.json()
  const confirmerEmail: string = (body.confirmer_email ?? '').trim()
  if (!confirmerEmail) {
    return NextResponse.json({ success: false, error: '确认人邮箱不能为空' }, { status: 400 })
  }

  try {
    const result = await registerConfirmer(asConfirmerWriteClient(supabaseAdmin), {
      clientId: params.id,
      confirmerEmail,
      actorEmail,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    if (err instanceof KnowledgeConfirmerAuthorizationError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 403 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}

// DELETE /api/clients/[id]/knowledge/confirmers — revoke a confirmer.
// Global-admin only.
export async function DELETE(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }
  const actorEmail = access.user.email ?? ''
  if (!isGlobalAdminEmail(actorEmail)) {
    return NextResponse.json({ success: false, error: '只有全局管理员能撤销客户确认人' }, { status: 403 })
  }

  const body = await req.json()
  const confirmerEmail: string = (body.confirmer_email ?? '').trim()
  if (!confirmerEmail) {
    return NextResponse.json({ success: false, error: '确认人邮箱不能为空' }, { status: 400 })
  }

  try {
    await revokeConfirmer(asConfirmerWriteClient(supabaseAdmin), {
      clientId: params.id,
      confirmerEmail,
      actorEmail,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof KnowledgeConfirmerAuthorizationError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 403 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
