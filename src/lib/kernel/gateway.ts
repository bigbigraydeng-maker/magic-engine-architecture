/**
 * Execution Gateway —— **唯一**的执行门面。
 *
 * 一条铁律：业务写能力不许绕过授权层。这个文件是那条铁律的实现。
 *
 * 🔴 Gateway 把传进来的 `AuthorizedExecutionContext` **只当索引用**。
 *    每一个授权事实都从 append-only 的 `authorization_decisions` 里重读一遍
 *    再逐项比对 —— 所以即使有人用 `as unknown as` 伪造了一个字段齐全的 ctx，
 *    也过不了第 ④ 步。编译期的 brand 只是让「忘了授权」变成编译失败；
 *    真正兜底的是这里的重读。
 *
 * 分工（这个划分本身是防御的一部分）：
 *   · **闸门失败 → 抛 KernelError**。调用方本来就不该走到这一步，
 *     不能给它一个「返回值里有个 error 字段」的机会去忽略。
 *   · **执行失败 → 落状态并返回**（failed / dead_letter）。那是业务事实，
 *     要能查、要能下发给人，不是异常。
 */

import type {
  ActionDefinition,
  ActionRun,
  ActionRunStep,
  AuthorizationDecision,
  AuthorizedExecutionContext,
  CapabilityImplementation,
  RunStatus,
  VerificationResult,
} from './types'
import type { KernelDeps } from './deps'
import { KernelError, humanReasonOf, isRetryable } from './errors'
import { validateAgainstSchema } from './registry'
import {
  consumeDecision,
  ensureSteps,
  getActivePolicy,
  getDecision,
  listSteps,
  updateRun,
  updateStep,
} from './store'

export interface ExecutionResult {
  status: Extract<RunStatus, 'succeeded' | 'dead_letter'>
  run: ActionRun
  steps: ActionRunStep[]
  /** 最后一个步骤的产物，已按 output_schema 校验过。dead_letter 时为 null。 */
  output: Record<string, unknown> | null
  /** 通过幂等命中直接返回历史结果时为 true —— capability **一次都没被调用**。 */
  idempotentHit: boolean
  verification: VerificationResult | null
  failure?: { code: string; humanReason: string }
}

// ── ④ 授权重读与逐项比对 ──────────────────────────────────────────────────────

/**
 * 把 ctx 声称的每一件事，拿库里的 append-only 记录去对。
 *
 * 顺序按「错得最离谱的先报」排：跨客户排在最前面，因为它是唯一一种
 * 会**伤到别的客户**的失败，必须当场停手并留下安全告警，
 * 而不是被后面某条更普通的检查（比如过期）先报出来盖掉。
 */
function assertDecisionMatches(args: {
  ctx: AuthorizedExecutionContext
  run: ActionRun
  decision: AuthorizationDecision
  definition: ActionDefinition
  currentPolicyVersion: number | null
  now: Date
}): void {
  const { ctx, run, decision, definition, currentPolicyVersion, now } = args

  // 🔴 跨客户：decision 属于 A 客户却拿来对 B 客户执行。
  //    三方（ctx / run / decision）必须完全一致，任意两方对上而第三方对不上都算越界。
  if (decision.client_id !== ctx.clientId || decision.client_id !== run.client_id) {
    throw new KernelError(
      'CROSS_CLIENT',
      `安全告警：这条授权是给客户 ${decision.client_id} 的，却被拿来对客户 ${run.client_id} 执行 —— 已阻止`,
      { detail: { decisionClient: decision.client_id, runClient: run.client_id, ctxClient: ctx.clientId } },
    )
  }

  if (decision.verdict !== 'allow') {
    throw new KernelError(
      'NOT_AUTHORIZED',
      `这条动作没有被放行（当时的判定是「${decision.verdict}」），不能执行`,
      { detail: { verdict: decision.verdict, denyCode: decision.deny_code } },
    )
  }

  if (decision.action_key !== ctx.actionKey || decision.action_key !== run.action_key) {
    throw new KernelError(
      'NOT_AUTHORIZED',
      `授权签的是「${decision.action_key}」，要执行的却是「${run.action_key}」`,
    )
  }

  if (
    decision.action_version !== ctx.actionVersion ||
    decision.action_version !== definition.version
  ) {
    throw new KernelError(
      'ACTION_VERSION_MISMATCH',
      `授权签的是第 ${decision.action_version} 版契约，现在跑的实现是第 ${definition.version} 版 —— 得重新授权`,
    )
  }

  if (decision.idempotency_key !== run.idempotency_key) {
    throw new KernelError(
      'NOT_AUTHORIZED',
      '这条授权对应的不是这次提交（幂等键对不上）',
    )
  }

  if (decision.consumed_at) {
    throw new KernelError(
      'DECISION_ALREADY_CONSUMED',
      `这条授权已经在 ${decision.consumed_at} 被用掉了 —— 一次授权只能换一次执行`,
    )
  }

  if (decision.expires_at && Date.parse(decision.expires_at) <= now.getTime()) {
    throw new KernelError(
      'DECISION_EXPIRED',
      '这条授权已经过期了，要重新走一次授权',
    )
  }

  // 政策改了 → 版本变了 → 旧授权立即失效。
  // 「授权时是自动、现在客户改成了要审批」必须当场停手，不能按旧授权跑完。
  if (decision.policy_version !== currentPolicyVersion) {
    throw new KernelError(
      'STALE_POLICY_VERSION',
      `这条授权是按第 ${decision.policy_version} 版客户规则签的，规则后来改过了（现在是第 ${currentPolicyVersion} 版），得重新授权`,
    )
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────

export async function executeAuthorizedRun(
  deps: KernelDeps,
  ctx: AuthorizedExecutionContext,
): Promise<ExecutionResult> {
  const now = deps.now()

  // ① run 必须存在
  const run = await deps.requireRun(ctx.runId)

  // ② 动作必须认识
  const definition = deps.registry.get(ctx.actionKey)
  if (!definition) {
    throw new KernelError('UNKNOWN_ACTION', `「${ctx.actionKey}」不是系统认识的动作，不能执行`)
  }

  // ③ v1 硬闸：对外副作用一律不放行（授权层已经挡过一次，这里再挡一次）
  if (definition.sideEffect === 'outward') {
    throw new KernelError(
      'OUTWARD_SIDE_EFFECT_BLOCKED',
      '这个动作会作用到客户自己的资产之外，当前版本的执行内核一律不放行',
    )
  }

  // ④ 从库里重读授权，逐项比对。ctx 只是索引。
  const decision = await getDecision(deps.supabase, ctx.decisionId)
  if (!decision) {
    throw new KernelError(
      'NOT_AUTHORIZED',
      '查不到这次执行对应的授权记录 —— 没有授权就不执行',
    )
  }
  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  assertDecisionMatches({
    ctx,
    run,
    decision,
    definition,
    currentPolicyVersion: policy?.policy_version ?? null,
    now,
  })

  // ⑤ run 的状态得允许执行
  if (run.status !== 'authorized' && run.status !== 'running') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是等着跑的状态`,
      { detail: { status: run.status } },
    )
  }

  // ⑥ 原子兑换授权。拿不到行 = 别人先兑换了 = 一次重放。
  //    （幂等命中在提交阶段就拦掉了，见 runner.ts —— 那里连授权都不会重签。）
  const consumed = await consumeDecision(deps.supabase, decision.id, deps.workerId, now)
  if (!consumed) {
    throw new KernelError(
      'DECISION_ALREADY_CONSUMED',
      '这条授权刚刚已经被另一次执行用掉了 —— 一次授权只能换一次执行',
    )
  }

  // ⑦ capability 必须有实现。没有 ≠ 跳过。
  const capability = deps.capabilities[ctx.actionKey] as CapabilityImplementation | undefined
  if (!capability) {
    return failRun(deps, run, [], new KernelError(
      'CAPABILITY_NOT_IMPLEMENTED',
      `「${definition.title}」这个动作还没有实现，跑不了`,
    ))
  }

  const steps = await ensureSteps(deps.supabase, run.id, run.client_id, definition.steps)
  const running = await updateRun(deps.supabase, run.id, {
    status: 'running',
    started_at: run.started_at ?? now.toISOString(),
    last_error: null,
  })

  return runSteps(deps, { ctx, run: running, definition, capability, steps })
}

// ── 步骤循环 ──────────────────────────────────────────────────────────────────

async function runSteps(
  deps: KernelDeps,
  args: {
    ctx: AuthorizedExecutionContext
    run: ActionRun
    definition: ActionDefinition
    capability: CapabilityImplementation
    steps: ActionRunStep[]
  },
): Promise<ExecutionResult> {
  const { ctx, definition, capability } = args
  let steps = args.steps
  const byKey = () => new Map(steps.map((s) => [s.step_key, s]))

  // 断点续跑：已经成功的步骤带着 output 直接进上下文，不重跑
  const priorOutputs: Record<string, Record<string, unknown>> = {}
  for (const s of steps) {
    if (s.status === 'succeeded') priorOutputs[s.step_key] = s.output ?? {}
  }

  // 成本口径：run 的信封 vs 各步骤实际花费之和（含之前已完成的步骤）
  let spent = steps.reduce((sum, s) => sum + Number(s.cost_actual_usd ?? 0), 0)

  for (const stepKey of definition.steps) {
    const step = byKey().get(stepKey)
    if (!step) {
      return failRun(deps, args.run, steps, new KernelError(
        'INVALID_STATE',
        `执行步骤「${stepKey}」的记录不见了`,
      ))
    }
    if (step.status === 'succeeded') continue

    const handler = capability.steps[stepKey]
    if (!handler) {
      return failRun(deps, args.run, steps, new KernelError(
        'CAPABILITY_NOT_IMPLEMENTED',
        `「${definition.title}」缺少「${stepKey}」这一步的实现`,
      ))
    }

    let attempt = step.attempt
    let lastError: unknown = null

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1
      const startedAt = deps.now().toISOString()
      await updateStep(deps.supabase, step.id, {
        status: 'running',
        attempt,
        started_at: step.started_at ?? startedAt,
        heartbeat_at: startedAt,
        next_attempt_at: null,
      })

      try {
        const result = await handler({ ctx, stepKey, attempt, priorOutputs })

        // 钱：run 层是信封，step 层是实际。超了当场停手，且**不重试** ——
        // 重试只会再花一次。
        const cost = Number(result.costActualUsd ?? 0)
        spent += cost
        if (ctx.costCapUsd !== null && spent > ctx.costCapUsd) {
          throw new KernelError(
            'COST_CAP_EXCEEDED',
            `这次执行已经花到 $${spent.toFixed(2)}，超过了授权时定的上限 $${ctx.costCapUsd.toFixed(2)} —— 已停手`,
            { detail: { spent, cap: ctx.costCapUsd, stepKey } },
          )
        }

        // 验证：**验证不过就是没做成**，不是日志里一条 warn，且不重试
        if (result.verification && !result.verification.passed) {
          throw new KernelError(
            'VERIFICATION_FAILED',
            `这一步写完之后回头验，没验过：${result.verification.failure_reason ?? '未说明原因'}`,
            { detail: { stepKey, checks: result.verification.checks } },
          )
        }

        const finished = deps.now().toISOString()
        await updateStep(deps.supabase, step.id, {
          status: 'succeeded',
          output: result.output,
          verification: result.verification ?? null,
          cost_actual_usd: cost,
          heartbeat_at: finished,
          finished_at: finished,
          last_error: null,
        })
        priorOutputs[stepKey] = result.output
        lastError = null
        break
      } catch (err) {
        lastError = err
        const canRetry = isRetryable(err) && attempt < definition.retryPolicy.maxAttempts
        if (!canRetry) {
          await updateStep(deps.supabase, step.id, {
            status: 'dead_letter',
            attempt,
            last_error: humanReasonOf(err),
            finished_at: deps.now().toISOString(),
          })
          steps = await listSteps(deps.supabase, args.run.id)
          return failRun(deps, args.run, steps, err)
        }

        const delay =
          definition.retryPolicy.backoff === 'exponential'
            ? definition.retryPolicy.baseMs * 2 ** (attempt - 1)
            : definition.retryPolicy.baseMs
        await updateStep(deps.supabase, step.id, {
          status: 'pending',
          attempt,
          last_error: humanReasonOf(err),
          next_attempt_at: new Date(deps.now().getTime() + delay).toISOString(),
        })
        await deps.sleep(delay)
      }
    }

    if (lastError) {
      steps = await listSteps(deps.supabase, args.run.id)
      return failRun(deps, args.run, steps, lastError)
    }
    steps = await listSteps(deps.supabase, args.run.id)
  }

  steps = await listSteps(deps.supabase, args.run.id)

  // 🔴 声明了验证方式的动作，没有一条通过的验证记录就不许算成功。
  //    否则一个「忘了验证」的 capability 会安安静静地产出 succeeded。
  if (definition.verification) {
    const v = verificationOf(steps)
    if (!v || !v.passed || v.method !== definition.verification.method) {
      return failRun(deps, args.run, steps, new KernelError(
        'VERIFICATION_FAILED',
        `这个动作要求做「${definition.verification.method}」验证，但整轮跑下来没有一条通过的验证记录 —— 不能算做成了`,
      ))
    }
  }

  const output = lastOutputOf(definition, steps)
  const outCheck = validateAgainstSchema(definition.outputSchema, output ?? {})
  if (!outCheck.ok) {
    return failRun(deps, args.run, steps, new KernelError(
      'INVALID_OUTPUT',
      `这个动作的产物不符合它自己的契约：${outCheck.reason}`,
    ))
  }

  const finishedRun = await updateRun(deps.supabase, args.run.id, {
    status: 'succeeded',
    finished_at: deps.now().toISOString(),
    needs_human: false,
    last_error: null,
  })

  return {
    status: 'succeeded',
    run: finishedRun,
    steps,
    output,
    idempotentHit: false,
    verification: verificationOf(steps),
  }
}

// ── 失败落地 ──────────────────────────────────────────────────────────────────

/**
 * 把一次失败落成 `dead_letter` 并**标记需要人处理**。
 *
 * 🔴 `needs_human = true` 不是装饰：`kernel/handoff.ts` 靠它把死信捞进今日待办。
 *    进了死信而没人知道 = 又一次「发现死在日志里」。
 */
async function failRun(
  deps: KernelDeps,
  run: ActionRun,
  steps: ActionRunStep[],
  err: unknown,
): Promise<ExecutionResult> {
  const code = err instanceof KernelError ? err.code : 'EXECUTION_FAILED'
  const humanReason = humanReasonOf(err)
  const failed = await updateRun(deps.supabase, run.id, {
    status: 'dead_letter',
    needs_human: true,
    last_error: humanReason,
    finished_at: deps.now().toISOString(),
  })
  return {
    status: 'dead_letter',
    run: failed,
    steps,
    output: null,
    idempotentHit: false,
    verification: verificationOf(steps),
    failure: { code, humanReason },
  }
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

function lastOutputOf(
  definition: ActionDefinition,
  steps: ActionRunStep[],
): Record<string, unknown> | null {
  // 产物口径 = 最后一个成功步骤的 output。
  // 按 definition.steps 的顺序倒着找，而不是按库里的 step_index 排序 ——
  // 契约的顺序是权威，库里的索引只是它的一份拷贝。
  for (let i = definition.steps.length - 1; i >= 0; i -= 1) {
    const s = steps.find((x) => x.step_key === definition.steps[i])
    if (s && s.status === 'succeeded') return s.output ?? {}
  }
  return null
}

function verificationOf(steps: ActionRunStep[]): VerificationResult | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].verification) return steps[i].verification
  }
  return null
}
