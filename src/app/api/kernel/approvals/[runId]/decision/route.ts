/**
 * POST /api/kernel/approvals/[runId]/decision
 *
 *   { resolution: 'approve' | 'reject', expectedDecisionId: string, reason?: string }
 *
 * 人点头 / 人否决。**这是审批链路上唯一一个会改状态的接口。**
 *
 * 🔴 它做的是**授权**，不是**执行**：
 *      同意 → run 停在 `authorized`（一条签好了、还没有人去跑的动作）
 *      不做 → run 停在 `denied`
 *    这里不调 capability、不领执行权、不开步骤、不产生任何对客户之外的写入。
 *    把 `authorized` 真正跑掉是 WP07 的事，**不在本接口的职责里**。
 *
 * 🔴 请求体里能带的只有上面三样。操作者身份、客户、动作、权限档次、成本上限、
 *    政策版本一律由服务端从登录会话和库里取 —— 带了别的字段一律 400。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ApprovalError } from '@/lib/kernel-approval/errors'
import { approvalErrorResponse, requireApprovalActor } from '@/lib/kernel-approval/http'
import {
  assertActorMayAuthorize,
  createApprovalKernelDeps,
  decideApproval,
  loadRunForApproval,
  parseDecisionInput,
} from '@/lib/kernel-approval/service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  try {
    const { runId } = await params

    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      throw new ApprovalError('invalid_request', '请求内容不是合法的 JSON')
    }
    const input = parseDecisionInput(rawBody)

    // ① 客户归属从这条 run 自己身上读出来 —— 不信调用方
    const run = await loadRunForApproval(supabaseAdmin, runId)

    // ② 拿它的 client_id 做真实鉴权，操作者身份来自会话
    const actor = await requireApprovalActor(run.client_id)

    // ③ 档次够不够授权这一类动作
    assertActorMayAuthorize(run, actor.tier)

    // ④ 交给 Kernel 的授权段。`expectedDecisionId` 一路传到数据库的行锁那里，
    //    对不上就是 409 stale_decision，且**什么都没被改动**。
    const result = await decideApproval(createApprovalKernelDeps(supabaseAdmin), {
      run,
      actorEmail: actor.email,
      input,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return approvalErrorResponse(err)
  }
}
