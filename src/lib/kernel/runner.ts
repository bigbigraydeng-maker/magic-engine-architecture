/**
 * 提交 → 授权 → 执行 的编排。
 *
 * 这是 Kernel 对外的**唯一入口**。业务侧要让系统做一件事，只能提交一个
 * action_run；不能自己去调 capability，也不能自己去写业务表。
 *
 * 幂等的判定在**提交阶段**，不在执行阶段：同一把键已经成功跑完过，
 * 连授权都不会重签一次。授权是有审计成本的东西，重复签发会把审计表
 * 变成噪音，也会让「这次执行是谁批的」出现两个答案。
 */

import type {
  ActionPurpose,
  ActionRun,
  AuthorizationDecision,
  TriggeredBy,
} from './types'
import type { KernelDeps } from './deps'
import type { ExecutionResult } from './gateway'
import { KernelError } from './errors'
import { authorizeRun, approveRun, rejectRun } from './authorize'
import { executeAuthorizedRun } from './gateway'
import { computeIdempotencyKey, computeUnknownActionKey } from './idempotency'
import { findRunByIdempotencyKey, insertRun, listSteps, updateRun, updateStep } from './store'

export interface SubmitActionInput {
  clientId: string
  actionKey: string
  purpose: ActionPurpose
  goalId?: string | null
  executionItemId?: string | null
  triggeredBy: TriggeredBy
  triggeredByRef?: string | null
  input: Record<string, unknown>
  /** 为什么做这件事（一句话，人话）。 */
  rationale?: string | null
  /** 依据什么。形状通用，词汇不属于任何域。 */
  evidence?: Record<string, unknown>
  correlationId?: string
}

export interface SubmitResult {
  run: ActionRun
  /** 这次提交撞上了一个已经存在的 run（同客户 + 同幂等键）。 */
  existing: boolean
}

/** 提交一次执行请求。幂等键相同 → 拿回同一个 run，不新建。 */
export async function submitActionRun(
  deps: KernelDeps,
  input: SubmitActionInput,
): Promise<SubmitResult> {
  // growth 必须挂目标；非 growth 挂了目标也拒绝。
  // 数据库有同样的双向 CHECK —— 这里先说人话，别让 PM 看到一条约束名。
  const hasGoal = Boolean(input.goalId)
  if (input.purpose === 'growth' && !hasGoal) {
    throw new KernelError(
      'INVALID_INPUT',
      '这是一件为客户增长做的事，必须说清它服务哪个目标',
    )
  }
  if (input.purpose !== 'growth' && hasGoal) {
    throw new KernelError(
      'INVALID_INPUT',
      `「${input.purpose}」类任务不该挂在某个增长目标下 —— 为了让它挂上而编一个目标，正是我们要防的事`,
    )
  }

  const definition = deps.registry.get(input.actionKey)

  // 未知动作也要有稳定身份，否则每天会新增一条一模一样的拒绝记录
  const idempotencyKey = definition
    ? computeIdempotencyKey(definition, input.clientId, input.input)
    : computeUnknownActionKey(input.actionKey, input.clientId, input.input)

  const existing = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)
  if (existing) return { run: existing, existing: true }

  const run = await insertRun(deps.supabase, {
    client_id: input.clientId,
    purpose: input.purpose,
    goal_id: input.goalId ?? null,
    execution_item_id: input.executionItemId ?? null,
    triggered_by: input.triggeredBy,
    triggered_by_ref: input.triggeredByRef ?? null,
    action_key: input.actionKey,
    // 未知动作记 0 版 —— 它不会被执行，但拒绝记录里得看得出「当时没有版本」
    action_version: definition?.version ?? 0,
    input: input.input,
    rationale: input.rationale ?? null,
    evidence: input.evidence ?? {},
    idempotency_key: idempotencyKey,
    status: 'queued',
    ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
  })

  return { run, existing: false }
}

export type ActionOutcomeKind =
  | 'succeeded'
  | 'idempotent_hit'
  | 'pending_approval'
  | 'denied'
  | 'dead_letter'

export interface ActionRunOutcome {
  kind: ActionOutcomeKind
  run: ActionRun
  decision: AuthorizationDecision | null
  execution: ExecutionResult | null
  /** 给人看的一句话 —— 直接能进今日待办。 */
  humanReason: string | null
}

/**
 * 走完一条动作：提交 → 授权 → （放行才）执行。
 *
 * 🔴 每一个分支都落库、都有人话理由。没有「静默什么都没做」这个出口。
 */
export async function runAction(
  deps: KernelDeps,
  input: SubmitActionInput,
): Promise<ActionRunOutcome> {
  const submitted = await submitActionRun(deps, input)
  const run = submitted.run

  // 幂等命中：已经做完的事不再做第二遍，capability 一次都不调
  if (submitted.existing && run.status === 'succeeded') {
    return {
      kind: 'idempotent_hit',
      run,
      decision: null,
      execution: {
        status: 'succeeded',
        run,
        steps: await listSteps(deps.supabase, run.id),
        output: null,
        idempotentHit: true,
        verification: null,
      },
      humanReason: '这件事之前已经做过了，没有重复做',
    }
  }

  // 已经在等人点头 / 已经被拒 —— 不重新授权，避免审计表里出现两个答案
  if (submitted.existing && run.status === 'pending_approval') {
    return { kind: 'pending_approval', run, decision: null, execution: null, humanReason: '这条还在等你点头' }
  }
  if (submitted.existing && (run.status === 'denied' || run.status === 'dead_letter')) {
    return {
      kind: run.status === 'denied' ? 'denied' : 'dead_letter',
      run,
      decision: null,
      execution: null,
      humanReason: run.last_error,
    }
  }

  const auth = await authorizeRun(deps, run)

  if (auth.verdict === 'deny') {
    return { kind: 'denied', run: auth.run, decision: auth.decision, execution: null, humanReason: auth.decision.reason }
  }
  if (auth.verdict === 'require_approval' || !auth.ctx) {
    return {
      kind: 'pending_approval',
      run: auth.run,
      decision: auth.decision,
      execution: null,
      humanReason: auth.decision.reason,
    }
  }

  const execution = await executeAuthorizedRun(deps, auth.ctx)
  return {
    kind: execution.status === 'succeeded' ? 'succeeded' : 'dead_letter',
    run: execution.run,
    decision: auth.decision,
    execution,
    humanReason: execution.failure?.humanReason ?? null,
  }
}

/**
 * 人点了同意之后接着跑。
 *
 * 注意这里**重新签了一条决策**（`decided_by='human'`），
 * 而不是把原来那条 require_approval 改成 allow —— 决策表是 append-only。
 */
export async function approveAndRun(
  deps: KernelDeps,
  runId: string,
  approvedByUser: string,
): Promise<ActionRunOutcome> {
  const auth = await approveRun(deps, runId, approvedByUser)
  if (auth.verdict !== 'allow' || !auth.ctx) {
    return {
      kind: 'denied',
      run: auth.run,
      decision: auth.decision,
      execution: null,
      humanReason: auth.decision.reason,
    }
  }
  const execution = await executeAuthorizedRun(deps, auth.ctx)
  return {
    kind: execution.status === 'succeeded' ? 'succeeded' : 'dead_letter',
    run: execution.run,
    decision: auth.decision,
    execution,
    humanReason: execution.failure?.humanReason ?? null,
  }
}

/**
 * 死信重跑 —— **断点续跑**的入口。
 *
 * 🔴 已经成功的步骤原样保留（连同它们的产物），只把没跑成的放回待跑。
 *    这跟「整条重来」是两件事：重来会把已经写出去的东西再写一遍，
 *    而 Kernel 的幂等承诺是「同一件事只做一次」。
 *
 * 重跑必须由人发起并留下是谁发起的 —— 死信意味着系统自己已经放弃过一次，
 * 不该再由系统自己决定要不要再试。
 */
export async function resumeDeadLetterRun(
  deps: KernelDeps,
  runId: string,
  resumedByUser: string,
): Promise<ActionRunOutcome> {
  const run = await deps.requireRun(runId)
  if (run.status !== 'dead_letter') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在是「${run.status}」，不是停手待查的状态，不用重跑`,
    )
  }

  const steps = await listSteps(deps.supabase, runId)
  for (const s of steps) {
    if (s.status === 'succeeded') continue
    await updateStep(deps.supabase, s.id, {
      status: 'pending',
      last_error: null,
      next_attempt_at: null,
      finished_at: null,
    })
  }

  await updateRun(deps.supabase, runId, { status: 'pending_approval', needs_human: true })
  return approveAndRun(deps, runId, resumedByUser)
}

/** 人点了不做。 */
export async function rejectPendingRun(
  deps: KernelDeps,
  runId: string,
  rejectedByUser: string,
  reason: string,
): Promise<ActionRunOutcome> {
  const auth = await rejectRun(deps, runId, rejectedByUser, reason)
  return {
    kind: 'denied',
    run: auth.run,
    decision: auth.decision,
    execution: null,
    humanReason: auth.decision.reason,
  }
}
