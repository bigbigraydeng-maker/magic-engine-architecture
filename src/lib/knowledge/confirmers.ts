/**
 * Client Knowledge Base — customer-side confirmer registry (design doc §9.14
 * E.2 step 2: "新增'客户确认人登记'：只有全局管理员能登记，留审计；确认人
 * 必须在草稿批准前登记；登记人 ≠ 批草稿的人").
 *
 * Without this table, `read.ts`'s dual-sign gate only checks "confirmer ≠
 * approver" and "confirmer is not a global admin" — any other email could
 * be written into `client_confirmed_by_email` and pass. This closes that
 * gap: a confirmation only counts if the confirmer's email was registered
 * for that client (by a global admin) BEFORE the confirmation was recorded.
 */

import type { KnowledgeSupabaseClient } from './db-client'
import { KnowledgeReadError } from './errors'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'

interface ConfirmerRow {
  confirmer_email: string
}

/**
 * Registered, non-revoked confirmer emails for `clientId`, lower-cased.
 *
 * 🔴 Fail-closed: a DB error throws (never resolves to "no registered
 * confirmers", which would silently make every customer_reply dual-sign
 * check fail — indistinguishable from "legitimately nobody registered yet"
 * only from the caller's point of view, but the two must not be conflated
 * with an actual read failure).
 */
export async function getRegisteredConfirmerEmails(
  clientId: string,
  sb: KnowledgeSupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await sb
    .from('client_knowledge_confirmers')
    .select('confirmer_email')
    .eq('client_id', clientId)
    .is('revoked_at', null)

  if (error) throw new KnowledgeReadError('读取客户知识库确认人登记（client_knowledge_confirmers）', error)

  // 桥接 unknown：同 entitlement.ts / read.ts 的 defaultSupabase() 深层泛型限制
  // （supabase-js 泛型链过深，tsc 结构比对 "excessively deep"）。实测：本机 PG
  // 沙盘对着真实 client_knowledge_confirmers 表跑过同样的 select，列名
  // confirmer_email 跟 ConfirmerRow 逐一核对一致。
  const rows = (data ?? []) as unknown as ConfirmerRow[]
  // 🔴 魏征复审（2026-09-14）：跟 read.ts 的比较标准对齐——必须 trim 再
  // lower-case，否则登记时留了尾随空格的邮箱会跟 read.ts 里 trim 过的确认人
  // 邮箱对不上，登记形同没登记。
  return new Set(rows.map((r) => r.confirmer_email.trim().toLowerCase()))
}

// ── 登记 / 撤销（issue #1669）───────────────────────────────────────────
//
// client_knowledge_confirmers 的 RLS 只挡到"必须用 service_role 连接"这一
// 层——"只有全局管理员能登记"这条业务规则数据库层面强制不了（判断谁是
// 全局管理员是 env 驱动的判断，见 whitelist.ts），只能在这两个函数里做。
// 任何调用方（API 路由）必须把真实登录邮箱传进 actorEmail，不能自己旁路
// 直接操作这张表。

type ConfirmerQueryResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>

/** `eq`/`is` 可以链多次，`ilike` 收尾执行——用递归类型而不是固定深度，实际调用点链的段数不一样。 */
export interface KnowledgeConfirmerFilterBuilder {
  eq(column: string, value: unknown): KnowledgeConfirmerFilterBuilder
  is(column: string, value: null): KnowledgeConfirmerFilterBuilder
  ilike(column: string, value: string): ConfirmerQueryResult
}

/** 真实 supabase-js 客户端的最小写入面（insert/update + 精确匹配查询），跟 read.ts 的窄接口分开——那个接口是只读面，服务读侧测试。 */
export interface KnowledgeConfirmerWriteClient {
  from(table: string): {
    select(columns: string): KnowledgeConfirmerFilterBuilder
    insert(row: Record<string, unknown>): ConfirmerQueryResult
    update(fields: Record<string, unknown>): {
      eq(column: string, value: unknown): ConfirmerQueryResult
    }
  }
}

export class KnowledgeConfirmerAuthorizationError extends Error {
  constructor(actorEmail: string, action: string) {
    super(`[knowledge] ${actorEmail} 不是全局管理员，无权${action}客户确认人`)
    this.name = 'KnowledgeConfirmerAuthorizationError'
  }
}

export class KnowledgeConfirmerWriteError extends Error {
  constructor(op: string, cause: { message?: string } | null) {
    super(`[knowledge] ${op} 失败：${cause?.message ?? '未知错误'}`)
    this.name = 'KnowledgeConfirmerWriteError'
  }
}

export interface RegisterConfirmerResult {
  id: string
  alreadyActive: boolean
}

/**
 * 桥接 unknown 说明（本文件多处用到，集中写在这里）：register/revoke 两个
 * 函数的查询结果都是 `Record<string, unknown>` 的列表，tsc 结构比对拒绝
 * 直接转成 `{ id: string }[]`。实测：本机 PG 沙盘对着真实
 * client_knowledge_confirmers / client_portal_users 两张表跑过同样形状的
 * select，列名 `id` 在两张表里都存在且是 uuid 转字符串，跟这里的用法
 * 逐一核对一致，不是凭空猜的形状。
 */
function asIdRows(data: unknown): Array<{ id: string }> {
  return (data ?? []) as unknown as Array<{ id: string }>
}

/**
 * 登记一个客户确认人。只有全局管理员（`isGlobalAdminEmail(actorEmail)`）能
 * 调用——公司域名账号不算全局管理员，必须精确命中 `ADMIN_EMAILS` 名单
 * （跟 read.ts 双签校验用的是同一条判据，见 whitelist.ts）。
 *
 * 🔴 §9.4 "登记人 ≠ 批草稿的人"：这里只能做到"登记人 ≠ 这条事实的批准人"
 * 这一半——批准人是事实层面的字段（`client_knowledge_facts.approved_by_
 * email`），跟"谁登记了确认人"完全是两个不同时间点的两件事，这个函数天
 * 生看不到"批准人是谁"，所以这条检查实际在 read.ts 的双签校验里已经做了
 * （`approver_confirmer_differ`）。这里额外加一条更弱但仍然有意义的检查：
 * 登记人不能把自己登记成确认人（防止全局管理员既当裁判又当运动员的最
 * 明显情形）。
 *
 * 🔴 issue #1646 "确认人必须是该客户名下 access_type='client' 账号"：查
 * `client_portal_users`（不是 `client_knowledge_confirmers` 自己）核实这
 * 一点——两张表故意分开：一张管"谁是这个客户的真实联系人"（既有账号表），
 * 一张管"这个真实联系人有没有被明确授权确认知识库条目"（本表）。
 */
export async function registerConfirmer(
  sb: KnowledgeConfirmerWriteClient,
  params: { clientId: string; confirmerEmail: string; actorEmail: string },
): Promise<RegisterConfirmerResult> {
  const { clientId, actorEmail } = params
  const confirmerEmail = params.confirmerEmail.trim()

  if (!isGlobalAdminEmail(actorEmail)) {
    throw new KnowledgeConfirmerAuthorizationError(actorEmail, '登记')
  }
  if (confirmerEmail.toLowerCase() === actorEmail.trim().toLowerCase()) {
    throw new Error('[knowledge] 登记人不能把自己登记成客户确认人')
  }
  if (isGlobalAdminEmail(confirmerEmail)) {
    throw new Error('[knowledge] 全局管理员账号不能被登记为客户确认人（不能代客户确认）')
  }

  const accountCheck = await sb
    .from('client_portal_users')
    .select('id')
    .eq('client_id', clientId)
    .eq('access_type', 'client')
    .ilike('email', confirmerEmail)
  if (accountCheck.error) {
    throw new KnowledgeConfirmerWriteError('核实客户账号（client_portal_users）', accountCheck.error)
  }
  if (asIdRows(accountCheck.data).length === 0) {
    throw new Error(
      `[knowledge] ${confirmerEmail} 不是客户 ${clientId} 名下的 access_type='client' 账号，不能登记为确认人`,
    )
  }

  // 只查"当前有效"的登记（revoked_at IS NULL）——局部唯一索引
  // uq_client_knowledge_confirmers_active 本身就只约束这个子集，查全量会
  // 把已撤销的历史行也当成"已登记"，误报成"不用再登记一次"。
  const activeCheck = await sb
    .from('client_knowledge_confirmers')
    .select('id')
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .ilike('confirmer_email', confirmerEmail)
  if (activeCheck.error) {
    throw new KnowledgeConfirmerWriteError('核对既有登记（client_knowledge_confirmers）', activeCheck.error)
  }
  const existingActive = asIdRows(activeCheck.data)
  if (existingActive.length > 0) {
    return { id: existingActive[0].id, alreadyActive: true }
  }

  const insertResult = await sb.from('client_knowledge_confirmers').insert({
    client_id: clientId,
    confirmer_email: confirmerEmail,
    registered_by_email: actorEmail,
  })
  if (insertResult.error) {
    throw new KnowledgeConfirmerWriteError('登记客户确认人（client_knowledge_confirmers）', insertResult.error)
  }
  const inserted = asIdRows(insertResult.data)
  return { id: inserted[0]?.id ?? '', alreadyActive: false }
}

/**
 * 撤销一个客户确认人的登记。同样只有全局管理员能调用。撤销不是删除——
 * `revoked_at`/`revoked_by_email` 成对写入，留审计；局部唯一索引只约束
 * "未撤销"的行，撤销后同一个邮箱可以被重新登记。
 */
export async function revokeConfirmer(
  sb: KnowledgeConfirmerWriteClient,
  params: { clientId: string; confirmerEmail: string; actorEmail: string },
): Promise<void> {
  const { clientId, actorEmail } = params
  const confirmerEmail = params.confirmerEmail.trim()

  if (!isGlobalAdminEmail(actorEmail)) {
    throw new KnowledgeConfirmerAuthorizationError(actorEmail, '撤销')
  }

  const activeCheck = await sb
    .from('client_knowledge_confirmers')
    .select('id')
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .ilike('confirmer_email', confirmerEmail)
  if (activeCheck.error) {
    throw new KnowledgeConfirmerWriteError('核对既有登记（client_knowledge_confirmers）', activeCheck.error)
  }
  const existingActive = asIdRows(activeCheck.data)
  if (existingActive.length === 0) {
    throw new Error(`[knowledge] ${confirmerEmail} 目前不是客户 ${clientId} 的有效登记确认人，无需撤销`)
  }

  const updateResult = await sb
    .from('client_knowledge_confirmers')
    .update({ revoked_at: new Date().toISOString(), revoked_by_email: actorEmail })
    .eq('id', existingActive[0].id)
  if (updateResult.error) {
    throw new KnowledgeConfirmerWriteError('撤销客户确认人登记（client_knowledge_confirmers）', updateResult.error)
  }
}
