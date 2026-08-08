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
import {
  findRunByIdempotencyKey,
  getDecision,
  insertRun,
  listSteps,
  updateRun,
  updateStep,
  UniqueViolationError,
} from './store'

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

  // 🔴 C4：Goal 必须属于**同一个客户**。只验证「目标存在」拦不住
  //    「A 客户的 run 挂 B 客户的目标」—— 那会把 lineage 串台到别的客户身上。
  //    数据库还有一道复合外键兜底（fk_action_runs_goal_same_client），
  //    这里先拦是为了把话说人话，而不是抛一条外键约束名。
  if (input.goalId) {
    const { data, error } = await deps.supabase
      .from('goals')
      .select('id, client_id')
      .eq('id', input.goalId)
      .limit(1)
    // 读失败必须炸 —— 当成「目标不存在」会把一次数据库抖动变成一条错误的拒绝
    if (error) throw new Error(`[kernel] 校验目标归属失败：${error.message}`)
    const goal = ((data ?? []) as unknown as Array<{ id: string; client_id: string }>)[0]
    if (!goal) {
      throw new KernelError('INVALID_INPUT', '这条动作挂的目标不存在，可能已经被删了 —— 重新选一个目标')
    }
    if (goal.client_id !== input.clientId) {
      throw new KernelError(
        'CROSS_CLIENT',
        '安全告警：这条动作挂的目标不属于这个客户 —— 已阻止（跨客户的执行记录会把两个客户的数据串在一起）',
        { detail: { goalId: input.goalId, goalClient: goal.client_id, runClient: input.clientId } },
      )
    }
  }

  const definition = deps.registry.get(input.actionKey)

  // 未知动作也要有稳定身份，否则每天会新增一条一模一样的拒绝记录
  const idempotencyKey = definition
    ? computeIdempotencyKey(definition, input.clientId, input.input)
    : computeUnknownActionKey(input.actionKey, input.clientId, input.input)

  const existing = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)
  if (existing) return { run: existing, existing: true }

  const run = await insertRunHandlingRace(deps, input, idempotencyKey, definition?.version ?? 0)
  return run
}

/**
 * 插入 run，并把「唯一约束冲突」当成**正常的并发结果**处理。
 *
 * 🔴 先 SELECT 再 INSERT 不是原子幂等：两个调用方可以同时查到「没有」，
 *    然后同时插。数据库的 `UNIQUE(client_id, idempotency_key)` 会让其中一个赢，
 *    输的那个必须**回头把赢家那行读出来返回** —— 而不是把一次正常竞争抛成 500。
 *    真正保证「只跑一次」的是这条唯一约束 + `kernel_begin_authorized_run`
 *    的原子执行权领取，不是那句 SELECT。
 */
async function insertRunHandlingRace(
  deps: KernelDeps,
  input: SubmitActionInput,
  idempotencyKey: string,
  actionVersion: number,
): Promise<SubmitResult> {
  try {
    const created = await insertRunRow(deps, input, idempotencyKey, actionVersion)
    return { run: created, existing: false }
  } catch (err) {
    if (!(err instanceof UniqueViolationError)) throw err
    const winner = await findRunByIdempotencyKey(deps.supabase, input.clientId, idempotencyKey)
    if (!winner) {
      // 撞了约束却读不到那一行 —— 这不是并发，是数据不一致，必须炸出来。
      throw new KernelError(
        'INVALID_STATE',
        '这件事的提交撞上了重复，但又读不回已有的那一条 —— 库里状态不一致，先别继续',
        { detail: { idempotencyKey } },
      )
    }
    return { run: winner, existing: true }
  }
}

async function insertRunRow(
  deps: KernelDeps,
  input: SubmitActionInput,
  idempotencyKey: string,
  actionVersion: number,
): Promise<ActionRun> {
  return insertRun(deps.supabase, {
    client_id: input.clientId,
    purpose: input.purpose,
    goal_id: input.goalId ?? null,
    execution_item_id: input.executionItemId ?? null,
    triggered_by: input.triggeredBy,
    triggered_by_ref: input.triggeredByRef ?? null,
    action_key: input.actionKey,
    // 未知动作记 0 版 —— 它不会被执行，但拒绝记录里得看得出「当时没有版本」
    action_version: actionVersion,
    input: input.input,
    rationale: input.rationale ?? null,
    evidence: input.evidence ?? {},
    idempotency_key: idempotencyKey,
    status: 'queued',
    ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
  })
}

export type ActionOutcomeKind =
  | 'succeeded'
  | 'idempotent_hit'
  /**
   * 这件事已经有人在做了（另一个并发调用正拿着它）。
   * 🔴 不是错误，也不是「什么都没发生」—— 调用方拿到的是**同一个 run**，
   *    只是这一次不由它来推进。
   */
  | 'in_progress'
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

  // 🔴 已经存在、且还在推进中的 run —— **绝不再签第二份授权。**
  //    两份 allow 决策会让「谁有权执行」出现两个答案，也会让审计表里
  //    同一件事有两个「谁批的」。这条路径返回 in_progress，由抢到的那一方推进。
  //    （执行权本身还有 kernel_begin_authorized_run 那道原子闸兜底。）
  if (submitted.existing) {
    return {
      kind: 'in_progress',
      run,
      decision: null,
      execution: null,
      humanReason: '这件事已经有人在做了，这次不重复做',
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

  // 🔴 重跑走的是**跟第一次完全相同的授权路径**（回到 queued 再重新授权），
  //    不是「人点了同意所以直接放行」。
  //    死信之后世界可能已经变了：客户把规则改成禁止、规则被删、契约升版 ——
  //    重跑必须跟第一次一样重新过全部闸。谁发起的重跑记进 evidence 留痕。
  const resumed = await updateRun(deps.supabase, runId, {
    status: 'queued',
    needs_human: false,
    last_error: null,
    finished_at: null,
    authorization_decision_id: null,
    evidence: {
      ...(run.evidence ?? {}),
      last_resumed_by: resumedByUser,
      last_resumed_at: deps.now().toISOString(),
    },
  })

  const auth = await authorizeRun(deps, resumed)
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
 * 哪些拒绝是**修好条件之后可以重新授权**的（C3）。
 *
 * 🔴 白名单，不是黑名单。判据：拒绝的原因是不是「环境问题」——
 *    政策没配 / 过期 / 改过、预算上限后来被提高 —— 这些修好之后同一件事
 *    理应能做；而「参数不对 / 动作不认识 / 对外副作用 / 用途不符」是
 *    **这次提交本身**的问题，重新授权一万次结论也一样，必须重新排一条新的。
 */
export const RECOVERABLE_DENY_CODES: ReadonlySet<string> = new Set([
  'no_policy',
  'policy_expired',
  'policy_changed_since_request',
  'over_cost_cap',
])

/**
 * 可恢复的 deny → 显式重新授权（C3）。
 *
 * 背景：第一次因「客户没配规则」被拒后，人按待办去把规则配好了 ——
 * 但同样的输入再提交会命中同一把幂等键，直接拿回旧的 denied，永远好不了。
 *
 * 🔴 三条边界，一条都不许松：
 *    ① **普通重复提交不会走到这里** —— runAction 对 denied 仍然只返回旧结果。
 *       恢复必须是一次显式动作，带着是谁、为什么。
 *    ② 旧的 deny 决策**原样保留**（append-only 本来也改不了）——
 *       重新授权是新签一条，不是改写历史。
 *    ③ 只有白名单里的拒绝码能恢复；人明确点过「不做」的（decided_by='human'）
 *       不能被这条路悄悄翻案 —— 那要人自己改主意，不是系统替他改。
 *
 * run id / 幂等键保持不变 —— 恢复的是**同一件事**，不是另一件。
 */
export async function recoverDeniedRun(
  deps: KernelDeps,
  runId: string,
  recoveredByUser: string,
  reason: string,
): Promise<ActionRunOutcome> {
  const run = await deps.requireRun(runId)
  if (run.status !== 'denied') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在是「${run.status}」，不是被拒绝的状态，不用恢复`,
    )
  }

  // 拿当初拒绝它的那条决策 —— 判断这个拒绝可不可以恢复
  const denyDecision = run.authorization_decision_id
    ? await getDecision(deps.supabase, run.authorization_decision_id)
    : null
  if (!denyDecision || denyDecision.verdict !== 'deny') {
    throw new KernelError(
      'INVALID_STATE',
      '找不到当初拒绝这条动作的记录，说不清它为什么被拒 —— 不能凭空恢复，请重新排一条',
    )
  }
  if (denyDecision.decided_by === 'human') {
    throw new KernelError(
      'NOT_AUTHORIZED',
      `这条是 ${denyDecision.decided_by_user} 明确点了「不做」的 —— 系统不替人改主意。要做的话请重新排一条`,
    )
  }
  if (!denyDecision.deny_code || !RECOVERABLE_DENY_CODES.has(denyDecision.deny_code)) {
    throw new KernelError(
      'NOT_AUTHORIZED',
      `这条被拒的原因是「${denyDecision.deny_code ?? '未知'}」—— 那是这次提交本身的问题，改条件救不了它，请修正后重新排一条`,
      { detail: { denyCode: denyDecision.deny_code } },
    )
  }

  // 回到 queued 走**跟第一次完全相同**的授权路径。谁发起的恢复、为什么，记进 evidence。
  const recovered = await updateRun(deps.supabase, runId, {
    status: 'queued',
    needs_human: false,
    last_error: null,
    finished_at: null,
    authorization_decision_id: null,
    evidence: {
      ...(run.evidence ?? {}),
      last_recovered_by: recoveredByUser,
      last_recovered_at: deps.now().toISOString(),
      recovery_reason: reason,
      recovered_from_deny_code: denyDecision.deny_code,
    },
  })

  const auth = await authorizeRun(deps, recovered)
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
