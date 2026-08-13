/**
 * GET /api/kernel/approvals/[runId]
 *
 * 一条等人点头的动作的详情 —— 人要看清楚了才点。
 *
 * 🔴 鉴权顺序是死的，不许换：
 *
 *      runId → 服务端读这条 run → run.client_id → requirePaidClientAccess(那个 client_id)
 *
 *    调用方声称的 clientId 一个字都不信（这个路由也压根不收）。
 *    先读后鉴权是安全的：读出来的东西在鉴权通过之前**一个字节都不返回**。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { approvalErrorResponse, requireApprovalActor } from '@/lib/kernel-approval/http'
import {
  assertActorMayAuthorize,
  buildApprovalDetail,
  loadRunForApproval,
} from '@/lib/kernel-approval/service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const { runId } = await params

    // ① 客户归属从这条 run 自己身上读出来
    const run = await loadRunForApproval(supabaseAdmin, runId)

    // ② 拿它的 client_id 去做真实鉴权
    const actor = await requireApprovalActor(run.client_id)

    // ③ 档次够不够授权**这一类**动作 —— 不够就连详情也不给，
    //    免得界面画出一个他其实点不了的按钮
    assertActorMayAuthorize(run, actor.tier)

    const detail = await buildApprovalDetail(supabaseAdmin, run)
    return NextResponse.json({ item: detail, actor: { email: actor.email, tier: actor.tier } })
  } catch (err) {
    return approvalErrorResponse(err)
  }
}
