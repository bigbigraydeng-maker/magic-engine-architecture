/**
 * 审批层的读取 —— **只读**。这个文件里一句写入都没有。
 *
 * 🔴 三条硬规矩：
 *
 *    ① **「查不到」「表不存在」「查炸了」是三件事，返回值必须能分开。**
 *       返回 `[]` 表示真的没有等审批的动作；表不存在抛 `kernel_not_provisioned`；
 *       其余错误原样抛出去（500）。把后两者压成 `[]` 是这个仓库反复踩过的坑：
 *       界面显示「一切正常」，而实际上整套东西没启用 / 库在报错。
 *
 *    ② **列表查询的客户过滤钉死在数据库侧**，不在内存里挑。调用方给的
 *       `clientId` 在进来之前**必须**已经过真实的客户权限校验（见路由）。
 *
 *    ③ 详情 / 决定路径**不接受**调用方声称的 clientId —— 一律 `runId → getRun →
 *       run.client_id`，再拿那个 client_id 去鉴权。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun, AuthorizationDecision } from '@/lib/kernel/types'
import { TABLE_RUNS, TABLE_DECISIONS } from '@/lib/kernel/store'
import { translateQueryError } from './errors'

/**
 * 🔴 只取审批界面真正要用的列。
 *    `SELECT *` 会把将来新加的列一起带出去 —— 审批接口是给人看的，
 *    多带出去的东西没人审过。
 */
const RUN_COLUMNS =
  'id, client_id, purpose, goal_id, action_key, action_version, input, rationale, evidence, ' +
  'status, authorization_decision_id, cost_cap_usd, cost_estimate_usd, updated_at, created_at'

const DECISION_COLUMNS =
  'id, action_run_id, client_id, verdict, reason, policy_id, policy_version, created_at'

/** 一页默认多少条。审批是人一条条看的，不做无上限列表。 */
export const PENDING_APPROVAL_PAGE_SIZE = 50
/** 一页最多多少条。再大就不是「给人看的一页」了。 */
export const PENDING_APPROVAL_MAX_PAGE_SIZE = 200

export interface PendingRunsPage {
  runs: ActionRun[]
  /** 🔴 后面还有没有。**截断绝不许是静默的。** */
  hasMore: boolean
  limit: number
  offset: number
}

/**
 * 这个客户当前等人点头的动作，**一页**。
 *
 * `clientId` 由调用方给，但**必须**是已经过 `requirePaidClientAccess` 的那一个 ——
 * 这里只负责把它当成数据库侧的硬过滤条件用。
 *
 * 🔴 **等得最久的排最前（`updated_at` 升序），不是最新的排最前。**（Codex P2）
 *
 *    这不是审美问题。待审批是一条**要被排空的队列**：新的一直在进来，
 *    如果按「最新优先」截断，最老那几条会被永远挤在第 101 名开外 ——
 *    产生速度只要高于处理速度，它们就再也不会出现在任何一页上，
 *    而界面看起来完全正常。倒过来排之后，排最前的永远是等得最久的那一条。
 *
 * 🔴 **截断必须说出来。** 多取一条来判断「后面还有没有」，用 `hasMore` 如实报，
 *    并且给 `offset` 让调用方能翻到后面去。一个静默截断的列表长得跟
 *    「就这么多」一模一样 —— 这个仓库为这种事故写过好几条铁律。
 */
export async function listPendingRunsForClient(
  sb: SupabaseClient,
  clientId: string,
  page: { limit?: number; offset?: number } = {},
): Promise<PendingRunsPage> {
  const limit = clampPageSize(page.limit)
  const offset = Math.max(0, Math.trunc(page.offset ?? 0))

  // 多取一条 —— 拿回来的比 limit 多，就说明后面还有
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .select(RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('status', 'pending_approval')
    .order('updated_at', { ascending: true })
    // 🔴 `updated_at` 会撞（同一批被一起挂起的 run 时间戳一样），
    //    没有第二个排序键的话翻页会跳条 / 重条。`id` 是稳定的总序。
    .order('id', { ascending: true })
    .range(offset, offset + limit)

  if (error) translateQueryError('读取等待审批的动作', error)
  const rows = (data ?? []) as unknown as ActionRun[]
  const hasMore = rows.length > limit
  return { runs: hasMore ? rows.slice(0, limit) : rows, hasMore, limit, offset }
}

/** 页大小夹到 [1, MAX]；给的不是个正整数就用默认值（**不报错，也不当成无上限**）。 */
export function clampPageSize(requested: unknown): number {
  const n = typeof requested === 'number' ? requested : Number(requested)
  if (!Number.isFinite(n) || n < 1) return PENDING_APPROVAL_PAGE_SIZE
  return Math.min(Math.trunc(n), PENDING_APPROVAL_MAX_PAGE_SIZE)
}

/**
 * 按 runId 读一条 run。**不带任何 clientId 过滤** ——
 * 客户归属是从这一行**读出来**的，不是调用方说了算。
 */
export async function getRunForApproval(
  sb: SupabaseClient,
  runId: string,
): Promise<ActionRun | null> {
  const { data, error } = await sb.from(TABLE_RUNS).select(RUN_COLUMNS).eq('id', runId).limit(1)
  if (error) translateQueryError('读取这条动作', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

/** 读一条授权决策。查不到返回 null（那是真的没有），查炸了抛。 */
export async function getDecisionForApproval(
  sb: SupabaseClient,
  decisionId: string,
): Promise<AuthorizationDecision | null> {
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .select(DECISION_COLUMNS)
    .eq('id', decisionId)
    .limit(1)
  if (error) translateQueryError('读取这份审批请求', error)
  return ((data ?? [])[0] as unknown as AuthorizationDecision | undefined) ?? null
}

/**
 * 一次把一批 run 对应的审批请求读回来（列表用，避免 N+1）。
 *
 * 🔴 读不到的那些**不补默认值**：调用方拿不到就照实说这条数据不完整，
 *    不能凭空造一份「审批请求」出来给人点。
 */
export async function getDecisionsByIds(
  sb: SupabaseClient,
  decisionIds: readonly string[],
): Promise<Map<string, AuthorizationDecision>> {
  if (decisionIds.length === 0) return new Map()
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .select(DECISION_COLUMNS)
    .in('id', decisionIds as string[])
  if (error) translateQueryError('读取这批审批请求', error)
  const rows = (data ?? []) as unknown as AuthorizationDecision[]
  return new Map(rows.map((row) => [row.id, row]))
}
