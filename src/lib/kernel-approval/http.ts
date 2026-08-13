/**
 * 审批层的 HTTP 边界件 —— 鉴权顺序与错误映射各**只有一份**。
 *
 * 🔴 三个路由各写一遍的话必然分家，而分家的那一处就是被绕过去的那一处。
 *    路由文件里只剩「取参数 → 调这里 → 调 service → 返回」。
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import type { AccessTier } from '@/lib/auth/access-types'
import { ApprovalError } from './errors'

export interface ApprovalActor {
  readonly email: string
  readonly tier: AccessTier
}

/** 统一的失败返回体。`code` 给界面分派用，`error` 给人看。 */
export function approvalErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApprovalError) {
    return NextResponse.json(
      { error: err.humanReason, code: err.code, detail: err.detail },
      { status: err.status },
    )
  }
  // 🔴 认不出来的一律 500 并原样记日志。**绝不降级成 200 或空结果** ——
  //    「查炸了」被答成「没有待办」是这条路上最危险的一种谎。
  console.error('[kernel-approval] 未预期的失败：', err)
  return NextResponse.json(
    { error: '审批接口出错了，这次操作没有生效', code: 'internal_error' },
    { status: 500 },
  )
}

/**
 * 对某个客户做**真实**的付费客户权限校验，并把**会话里的**操作者身份取出来。
 *
 * `requirePaidClientAccess` 负责：没登录 → 401；不属于这个客户 → 403；
 * self_serve / portal_only → 403。这里补两条：
 *
 * 🔴 **「没权限」和「查不了权限」必须分开。**（Codex P2）
 *    `requirePaidClientAccess` 在 `client_portal_users` 查询失败时返回
 *    `500 / lookup_failed` —— 那是**系统故障**，不是「这个人没权限」。
 *    早先这里把所有非 401 都压成 403，于是一次数据库抖动会被答成
 *    「你无权访问」：界面会当成永久的权限问题引导人去找管理员，
 *    而服务端监控收不到任何 5xx，故障就此隐形。
 *    认不出的状态一律按内部故障抛（→ 500），**不许猜成某个权限结论**。
 *
 * 🔴 **会话里没有邮箱的一律不许操作。** 人签的决策必须记得下是谁签的，
 *    记不下就不该发生 —— 一条 `decided_by_user` 为空的人工授权，
 *    等于审计表里写着「有人批了」但说不出是谁。
 */
export async function requireApprovalActor(clientId: string): Promise<ApprovalActor> {
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    if (access.status === 401) {
      throw new ApprovalError('unauthorized', access.error, { reason: access.reason ?? null })
    }
    if (access.status === 403 || access.status === 402) {
      throw new ApprovalError('forbidden_client', access.error, { reason: access.reason ?? null })
    }
    // 500 lookup_failed 以及将来任何新增的状态：**查不了 ≠ 没权限**。
    // 原样抛成内部故障，由 approvalErrorResponse 答 500 并记日志。
    throw new Error(
      `[kernel-approval] 权限校验没能完成（status=${access.status}, reason=${access.reason ?? '未说明'}）：${access.error}`,
    )
  }

  const email = (access.user.email ?? '').trim().toLowerCase()
  if (email.length === 0) {
    throw new ApprovalError(
      'forbidden_client',
      '这个登录会话没有邮箱 —— 人工审批必须记下是谁批的，记不下就不能批',
      { clientId },
    )
  }

  return { email, tier: access.tier }
}
