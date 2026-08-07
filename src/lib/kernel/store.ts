/**
 * Kernel 的唯一数据访问层。
 *
 * 🔴 这个文件**不 import supabaseAdmin**。客户端由调用方注入。
 *    理由不是洁癖：Kernel 一旦自己抓着 service-role 客户端，
 *    「谁在什么授权下写了什么」就退化成「进程里任何地方都能写」。
 *    注入还让全部授权/幂等/重试逻辑能在内存里跑真实测试，
 *    不用把「授权闸有没有生效」寄托在生产库上。
 *
 * 🔴 **查询失败一律抛错，绝不 `return []`。**
 *    「查不到」和「查炸了」返回同一个值，是这个仓库反复踩的那个坑
 *    （静默失效 + 被 catch 吞掉 + 测试假件配合着一直绿）。
 *    授权层尤其不能这样：读不到 decision 就当没授权是对的，
 *    但读**炸了**也当没授权，会把一次数据库抖动变成一次静默的「什么都没做」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActionRun,
  ActionRunStep,
  AuthorizationDecision,
  ClientAutomationPolicy,
  RunStatus,
  StepStatus,
  VerificationResult,
} from './types'

export const TABLE_RUNS = 'action_runs'
export const TABLE_STEPS = 'action_run_steps'
export const TABLE_DECISIONS = 'authorization_decisions'
export const TABLE_POLICIES = 'client_automation_policies'

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`[kernel/store] ${op} 失败：${error?.message ?? '未知错误'}`)
}

// ── 政策 ──────────────────────────────────────────────────────────────────────

/**
 * 拿这个客户对这个动作现在生效的政策。
 *
 * 没有行 = 没有政策 = **deny**（调用方负责把这一点变成一条 deny 决策）。
 * 注意「没有行」和「读失败」在这里被严格分开：后者抛。
 */
export async function getActivePolicy(
  sb: SupabaseClient,
  clientId: string,
  actionKey: string,
  now: Date,
): Promise<ClientAutomationPolicy | null> {
  const { data, error } = await sb
    .from(TABLE_POLICIES)
    .select(
      'id, client_id, action_key, mode, policy_version, spend_cap_per_run_usd, ' +
        'spend_cap_per_period_usd, spend_cap_period, decision_ttl_seconds, ' +
        'effective_from, effective_to, updated_by',
    )
    .eq('client_id', clientId)
    .eq('action_key', actionKey)
    .is('effective_to', null)
    .limit(1)
  if (error) fail('读取客户自动化政策', error)

  const row = (data ?? [])[0] as unknown as ClientAutomationPolicy | undefined
  if (!row) return null

  // 还没生效的政策不算数 —— 提前配好的下周政策不能今天就放行
  if (Date.parse(row.effective_from) > now.getTime()) return null
  return row
}

// ── Run ───────────────────────────────────────────────────────────────────────

const RUN_COLUMNS =
  'id, client_id, purpose, goal_id, execution_item_id, triggered_by, triggered_by_ref, ' +
  'action_key, action_version, input, rationale, evidence, idempotency_key, status, ' +
  'authorization_decision_id, correlation_id, cost_cap_usd, cost_estimate_usd, ' +
  'needs_human, last_error, created_at, updated_at, started_at, finished_at'

export async function findRunByIdempotencyKey(
  sb: SupabaseClient,
  clientId: string,
  idempotencyKey: string,
): Promise<ActionRun | null> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .select(RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
  if (error) fail('按幂等键查已有执行', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

export async function getRun(sb: SupabaseClient, runId: string): Promise<ActionRun | null> {
  const { data, error } = await sb.from(TABLE_RUNS).select(RUN_COLUMNS).eq('id', runId).limit(1)
  if (error) fail('读取执行实例', error)
  return ((data ?? [])[0] as unknown as ActionRun | undefined) ?? null
}

export async function insertRun(
  sb: SupabaseClient,
  row: Partial<ActionRun> & Pick<ActionRun, 'client_id' | 'purpose' | 'action_key'>,
): Promise<ActionRun> {
  const { data, error } = await sb.from(TABLE_RUNS).insert(row).select(RUN_COLUMNS)
  if (error) fail('创建执行实例', error)
  const created = (data ?? [])[0] as unknown as ActionRun | undefined
  if (!created) fail('创建执行实例', { message: '插入成功但没拿回行' })
  return created
}

export async function updateRun(
  sb: SupabaseClient,
  runId: string,
  patch: Partial<ActionRun> & { status?: RunStatus },
): Promise<ActionRun> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .select(RUN_COLUMNS)
  if (error) fail('更新执行实例', error)
  const updated = (data ?? [])[0] as unknown as ActionRun | undefined
  if (!updated) fail('更新执行实例', { message: `没有匹配到 run ${runId}` })
  return updated
}

// ── 授权决策（append-only） ───────────────────────────────────────────────────

const DECISION_COLUMNS =
  'id, action_run_id, client_id, action_key, action_version, verdict, deny_code, reason, ' +
  'policy_snapshot, policy_version, decided_by, decided_by_user, cost_cap_usd, ' +
  'cost_estimate_usd, idempotency_key, expires_at, consumed_at, consumed_by, created_at'

export async function insertDecision(
  sb: SupabaseClient,
  row: Omit<AuthorizationDecision, 'id' | 'created_at' | 'consumed_at' | 'consumed_by'> &
    Partial<Pick<AuthorizationDecision, 'id' | 'created_at'>>,
): Promise<AuthorizationDecision> {
  const { data, error } = await sb.from(TABLE_DECISIONS).insert(row).select(DECISION_COLUMNS)
  if (error) fail('写入授权决策', error)
  const created = (data ?? [])[0] as unknown as AuthorizationDecision | undefined
  if (!created) fail('写入授权决策', { message: '插入成功但没拿回行' })
  return created
}

export async function getDecision(
  sb: SupabaseClient,
  decisionId: string,
): Promise<AuthorizationDecision | null> {
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .select(DECISION_COLUMNS)
    .eq('id', decisionId)
    .limit(1)
  if (error) fail('读取授权决策', error)
  return ((data ?? [])[0] as unknown as AuthorizationDecision | undefined) ?? null
}

/**
 * 原子兑换一次授权。
 *
 * `WHERE id = ? AND consumed_at IS NULL` + 回读 —— 拿不到行就是**别人先兑换了**，
 * 也就是一次重放。这一步必须是一条语句，不能「先查 consumed_at 再更新」。
 */
export async function consumeDecision(
  sb: SupabaseClient,
  decisionId: string,
  consumedBy: string,
  now: Date,
): Promise<AuthorizationDecision | null> {
  const { data, error } = await sb
    .from(TABLE_DECISIONS)
    .update({ consumed_at: now.toISOString(), consumed_by: consumedBy })
    .eq('id', decisionId)
    .is('consumed_at', null)
    .select(DECISION_COLUMNS)
  if (error) fail('兑换授权决策', error)
  return ((data ?? [])[0] as unknown as AuthorizationDecision | undefined) ?? null
}

// ── Step ──────────────────────────────────────────────────────────────────────

const STEP_COLUMNS =
  'id, run_id, client_id, step_key, step_index, status, claimed_by, claimed_at, heartbeat_at, ' +
  'attempt, reclaim_count, next_attempt_at, output, verification, cost_actual_usd, last_error, ' +
  'created_at, updated_at, started_at, finished_at'

export async function listSteps(sb: SupabaseClient, runId: string): Promise<ActionRunStep[]> {
  const { data, error } = await sb
    .from(TABLE_STEPS)
    .select(STEP_COLUMNS)
    .eq('run_id', runId)
    .order('step_index', { ascending: true })
  if (error) fail('读取执行步骤', error)
  return (data ?? []) as unknown as ActionRunStep[]
}

/**
 * 把这个 run 的步骤行补齐（已存在的不动）。
 *
 * 断点续跑靠的就是这个：步骤行是**一个 run 一份**，重跑时已完成的行还在，
 * 带着它们的 output —— 不是「重新建一批然后跳过前几个」。
 */
export async function ensureSteps(
  sb: SupabaseClient,
  runId: string,
  clientId: string,
  stepKeys: readonly string[],
): Promise<ActionRunStep[]> {
  const existing = await listSteps(sb, runId)
  const have = new Set(existing.map((s) => s.step_key))
  const missing = stepKeys
    .map((key, idx) => ({ key, idx }))
    .filter(({ key }) => !have.has(key))

  if (missing.length > 0) {
    const { error } = await sb.from(TABLE_STEPS).insert(
      missing.map(({ key, idx }) => ({
        run_id: runId,
        client_id: clientId,
        step_key: key,
        step_index: idx,
        status: 'pending' as StepStatus,
      })),
    )
    if (error) fail('创建执行步骤', error)
    return listSteps(sb, runId)
  }
  return existing
}

export async function updateStep(
  sb: SupabaseClient,
  stepId: string,
  patch: Partial<Omit<ActionRunStep, 'verification'>> & {
    status?: StepStatus
    verification?: VerificationResult | null
  },
): Promise<ActionRunStep> {
  const { data, error } = await sb
    .from(TABLE_STEPS)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', stepId)
    .select(STEP_COLUMNS)
  if (error) fail('更新执行步骤', error)
  const updated = (data ?? [])[0] as unknown as ActionRunStep | undefined
  if (!updated) fail('更新执行步骤', { message: `没有匹配到 step ${stepId}` })
  return updated
}

/**
 * 原子认领一个待跑步骤（走 `kernel_claim_run_step` RPC）。
 *
 * 形状原样提取自 `factory_claim_work_order` —— `FOR UPDATE SKIP LOCKED`，
 * 全仓唯一并发正确的认领实现。`clientIds` 白名单本身是一个授权维度。
 */
export interface ClaimedStep {
  step_id: string
  run_id: string
  client_id: string
  step_key: string
  attempt: number
}

export async function claimNextStep(
  sb: SupabaseClient,
  workerId: string,
  clientIds: string[] | null,
): Promise<ClaimedStep | null> {
  const { data, error } = await sb.rpc('kernel_claim_run_step', {
    p_worker_id: workerId,
    p_client_ids: clientIds,
  })
  if (error) fail('认领执行步骤', error)
  const row = (data ?? [])[0] as
    | { ok: boolean; step_id: string; run_id: string; client_id: string; step_key: string; attempt: number }
    | undefined
  if (!row || !row.ok) return null
  return {
    step_id: row.step_id,
    run_id: row.run_id,
    client_id: row.client_id,
    step_key: row.step_key,
    attempt: row.attempt,
  }
}

// ── 死信（下发给人的入口） ────────────────────────────────────────────────────

export async function listDeadLetterRuns(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<ActionRun[]> {
  const { data, error } = await sb
    .from(TABLE_RUNS)
    .select(RUN_COLUMNS)
    .in('status', ['dead_letter', 'pending_approval', 'denied'])
    .eq('needs_human', true)
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) fail('读取需要人处理的执行', error)
  return (data ?? []) as unknown as ActionRun[]
}
