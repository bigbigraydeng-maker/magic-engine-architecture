/**
 * GET /api/kernel/approvals?clientId=...
 *
 * 某个客户当前**等人点头**的动作清单。
 *
 * 🔴 `clientId` 是一个**客户选择器**，不是权限凭据。
 *    进来第一件事就是拿它去做真实的客户权限校验（`requirePaidClientAccess`），
 *    过了之后这个值再被钉死成数据库侧的过滤条件。
 *    「你说你要看 A 客户」永远不等于「你有权看 A 客户」。
 *
 * 🔴 **`200 []` 只在一种情况下出现：内核已启用、这个客户此刻没有等审批的动作。**
 *    内核的表根本不存在时答 503 `kernel_not_provisioned` —— 因为那时候
 *    「没有待办」是假的：那套东西整个没打开，任何等人点头的动作都永远不会出现在这里。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { ApprovalError } from '@/lib/kernel-approval/errors'
import { approvalErrorResponse, requireApprovalActor } from '@/lib/kernel-approval/http'
import { listPendingApprovals } from '@/lib/kernel-approval/service'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const clientId = (req.nextUrl.searchParams.get('clientId') ?? '').trim()
    if (clientId.length === 0) {
      throw new ApprovalError('invalid_request', '要看哪个客户的待审批？请带上 clientId')
    }

    // ① 先鉴权 —— 过不了就到此为止，一条数据都不查
    await requireApprovalActor(clientId)

    // ② 再查，且客户过滤钉死在数据库侧
    const { items, skippedRunIds } = await listPendingApprovals(supabaseAdmin, clientId)

    return NextResponse.json({
      clientId,
      items,
      // 🔴 数据不一致的那几条如实报出来，不悄悄少给。
      //    少给一条等审批的动作 = 它永远不会被处理，而界面上看不出少了东西。
      skippedRunIds,
    })
  } catch (err) {
    return approvalErrorResponse(err)
  }
}
