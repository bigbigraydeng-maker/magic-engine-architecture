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
  ClientAutomationPolicy,
  RunStatus,
  VerificationResult,
} from './types'
import type { KernelDeps } from './deps'
import { KernelError, humanReasonOf, isRetryable } from './errors'
import { validateAgainstSchema } from './registry'
import {
  beginAuthorizedRun,
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
  currentPolicy: ClientAutomationPolicy | null
  now: Date
}): void {
  const { ctx, run, decision, definition, currentPolicy, now } = args

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

  // ── 政策三连（C2）：行身份 → 版本 → 模式，缺一不可 ────────────────────
  // 🔴 政策被删掉 ≠ 「两边都是 null 所以对得上」。没有生效政策 = 不执行。
  if (!currentPolicy) {
    throw new KernelError(
      'POLICY_CHANGED',
      '这个客户现在没有生效的自动化规则了（可能被删了），不能按旧授权继续跑',
    )
  }

  // 版本号只在同一行政策内有意义：「删掉重建」的新行版本可能跟旧行一样，
  // 但行身份（uuid）造不出第二个。
  if (decision.policy_id !== currentPolicy.id) {
    throw new KernelError(
      'POLICY_CHANGED',
      '这条授权依据的那条客户规则已经被删掉重建过了 —— 新规则说了算，得重新授权',
    )
  }

  // 政策改了 → 版本变了 → 旧授权立即失效。
  // 「授权时是自动、现在客户改成了要审批」必须当场停手，不能按旧授权跑完。
  if (decision.policy_version !== currentPolicy.policy_version) {
    throw new KernelError(
      'STALE_POLICY_VERSION',
      `这条授权是按第 ${decision.policy_version} 版客户规则签的，规则后来改过了（现在是第 ${currentPolicy.policy_version} 版），得重新授权`,
    )
  }

  // 模式复核：机器签的放行只在「现在仍是自动」时有效，
  // 人签的放行只在「现在仍要人审」时有效。这一条是版本触发器失灵时的最后防线。
  if (decision.decided_by === 'policy' && currentPolicy.mode !== 'auto_approve') {
    throw new KernelError(
      'POLICY_CHANGED',
      '这条授权是按「自动执行」的规则签的，但这个客户现在的规则已经不是自动了 —— 得重新走授权',
    )
  }
  if (decision.decided_by === 'human' && currentPolicy.mode !== 'require_approval') {
    throw new KernelError(
      'POLICY_CHANGED',
      '这条授权是人按「要审批」的规则批的，但这个客户现在的规则已经变了 —— 得重新走授权',
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
    currentPolicy: policy,
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

  // ⑤b 🔴 装配校验（运行时，不信 TS 类型）：授权按注册表契约签，
  //    执行的却是 deps.capabilities 里装配的实现 —— 两者是**分开装配**的。
  //    注册表升到 v2 而装配还插着 v1 实现时，授权会按 v2 签、v1 悄悄跑掉。
  //    对不上一律 fail closed，且**不去领执行权**（授权不被消费，修好装配还能跑）。
  const assembled = deps.capabilities[ctx.actionKey] as CapabilityImplementation | undefined
  if (assembled) {
    if (assembled.actionKey !== definition.actionKey || assembled.version !== definition.version) {
      throw new KernelError(
        'ACTION_VERSION_MISMATCH',
        `装配对不上契约：授权按「${definition.actionKey}」第 ${definition.version} 版签，` +
          `装配的实现是「${assembled.actionKey}」第 ${assembled.version} 版 —— 先把装配修对，不执行`,
        { detail: { expectedKey: definition.actionKey, expectedVersion: definition.version, actualKey: assembled.actionKey, actualVersion: assembled.version } },
      )
    }
  }

  // ⑥ 🔴 原子领取「这个 run 的唯一执行权」。
  //
  //    上面第 ④ 步的重读比对是为了**说清楚为什么不让跑**（给人看的理由），
  //    真正的并发正确性在这一句：一个 run 从 authorized 进 running 只可能发生一次，
  //    而且只有 run 当前指着的那条决策能兑换。
  //    不能拆成「先兑换 decision、再把 run 改成 running」—— 那两句之间有窗口，
  //    而且兑换的是决策不是执行权（同一个 run 的两份 allow 决策会各自兑换成功）。
  const begun = await beginAuthorizedRun(deps.supabase, run.id, decision.id, deps.workerId)
  if (!begun.ok) throw beginFailureToError(begun.reason)

  // ⑦ capability 必须有实现。没有 ≠ 跳过。
  const capability = deps.capabilities[ctx.actionKey] as CapabilityImplementation | undefined
  if (!capability) {
    const claimed = await deps.requireRun(run.id)
    return failRun(deps, claimed, [], new KernelError(
      'CAPABILITY_NOT_IMPLEMENTED',
      `「${definition.title}」这个动作还没有实现，跑不了`,
    ))
  }

  const steps = await ensureSteps(deps.supabase, run.id, run.client_id, definition.steps)
  // run 的状态已经由 RPC 原子地推到 running，这里只是把最新一行读回来
  const running = await deps.requireRun(run.id)

  return runSteps(deps, { ctx, run: running, definition, capability, steps })
}

/**
 * 把 RPC 的机器可读原因翻成人话 + 正确的错误类型。
 *
 * 🔴 不许有 `default: 当成成功` 这种分支。认不出的原因一律当失败 ——
 *    「RPC 说了个我不认识的词」和「RPC 说可以」必须是两件事。
 */
function beginFailureToError(reason: string): KernelError {
  const head = reason.split(':')[0]
  switch (head) {
    case 'already_consumed':
      return new KernelError(
        'DECISION_ALREADY_CONSUMED',
        '这条授权刚刚已经被另一次执行用掉了 —— 一次授权只能换一次执行',
      )
    case 'decision_not_current':
      return new KernelError(
        'NOT_AUTHORIZED',
        '这条授权已经不是这件事当前那一份了（期间又签过一次），不能拿它开跑',
      )
    case 'run_not_authorized':
      return new KernelError(
        'INVALID_STATE',
        `这条动作已经不在「等着跑」的状态了（现在是 ${reason.split(':')[1] ?? '未知'}），可能已经有人在跑`,
        { detail: { reason } },
      )
    case 'stale_policy_version':
      return new KernelError(
        'STALE_POLICY_VERSION',
        '这个客户的规则在授权之后改过了，旧授权已失效，要重新走一次授权',
      )
    case 'no_active_policy':
      return new KernelError(
        'POLICY_CHANGED',
        '这个客户现在没有生效的自动化规则了（可能被删了），不能按旧授权继续跑',
      )
    case 'policy_identity_changed':
      return new KernelError(
        'POLICY_CHANGED',
        '这条授权依据的那条客户规则已经被删掉重建过了 —— 新规则说了算，得重新授权',
      )
    case 'policy_mode_changed':
      return new KernelError(
        'POLICY_CHANGED',
        '这个客户的规则模式在授权之后变了（自动↔要审批↔禁止），旧授权作废，得重新走授权',
      )
    case 'expired':
      return new KernelError('DECISION_EXPIRED', '这条授权已经过期了，要重新走一次授权')
    case 'cross_client':
      return new KernelError('CROSS_CLIENT', '安全告警：这条授权不属于这个客户，已阻止')
    case 'action_version_mismatch':
      return new KernelError('ACTION_VERSION_MISMATCH', '授权签的契约版本跟现在要跑的对不上，得重新授权')
    case 'action_key_mismatch':
    case 'idempotency_mismatch':
    case 'decision_run_mismatch':
    case 'decision_not_found':
    case 'run_not_found':
      return new KernelError('NOT_AUTHORIZED', `授权跟这次执行对不上（${head}）`, { detail: { reason } })
    default:
      return new KernelError('NOT_AUTHORIZED', `没能领到这次执行的执行权（${reason}）`, { detail: { reason } })
  }
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

// ── 幂等命中的历史结果重建（P2-3） ────────────────────────────────────────────

/**
 * 同一把幂等键再来一次，必须拿到**跟第一次等价的结果**，只是 capability 不再执行。
 *
 * 🔴 早先这个分支固定返回 `output: null / verification: null` —— 调用方丢了
 *    第一次的响应再重试时，拿到的是一个「成功但什么都没有」的空壳。
 *    步骤表里明明存着第一次的 package_id / output / verification。
 *
 * 重建按 **ActionDefinition.steps 的契约顺序**（不是「数组最后一条」）：
 * 产物 = 契约里最后一个成功步骤的 output（跟当时判成功用的 `lastOutputOf` 同一套）。
 *
 * fail closed：run 明明是 succeeded，历史步骤却缺产物 / 缺验证 / 产物不合契约 ——
 * 那是数据不一致，抛错，**不返回假的 success + null**。
 */
export async function rehydrateSucceededRun(
  deps: KernelDeps,
  run: ActionRun,
): Promise<ExecutionResult> {
  const definition = deps.registry.get(run.action_key)
  // 契约版本变了的话，幂等键也会变（键里带 v<version>），根本不会命中这条 run。
  // 走到这里却对不上 = 数据不一致，不猜。
  if (!definition || definition.version !== run.action_version) {
    throw new KernelError(
      'INVALID_STATE',
      `这条已完成的执行按第 ${run.action_version} 版契约跑，现在的注册表对不上 —— 历史结果无法按当前契约重建`,
      { detail: { runId: run.id, runVersion: run.action_version, registryVersion: definition?.version ?? null } },
    )
  }

  const steps = await listSteps(deps.supabase, run.id)

  // 契约里的每一步都必须真的成功过 —— 缺一步都不是「成功的历史」
  for (const key of definition.steps) {
    const step = steps.find((x) => x.step_key === key)
    if (!step || step.status !== 'succeeded') {
      throw new KernelError(
        'INVALID_STATE',
        `这条执行标着成功，但步骤「${key}」的记录${step ? `是「${step.status}」` : '不见了'} —— 历史数据不一致，不能当成功返回`,
        { detail: { runId: run.id, stepKey: key } },
      )
    }
  }

  const output = lastOutputOf(definition, steps)
  if (!output) {
    throw new KernelError('INVALID_STATE', '这条执行标着成功，但找不到任何步骤产物 —— 历史数据不一致', {
      detail: { runId: run.id },
    })
  }
  const outCheck = validateAgainstSchema(definition.outputSchema, output)
  if (!outCheck.ok) {
    throw new KernelError(
      'INVALID_STATE',
      `这条执行标着成功，但存下来的产物不合它自己的契约（${outCheck.reason}）—— 历史数据不一致`,
      { detail: { runId: run.id } },
    )
  }

  const verification = verificationOf(steps)
  if (definition.verification && (!verification || !verification.passed)) {
    throw new KernelError(
      'INVALID_STATE',
      '这条执行标着成功，但存下来的验证记录缺失或未通过 —— 历史数据不一致',
      { detail: { runId: run.id } },
    )
  }

  return {
    status: 'succeeded',
    run,
    steps,
    output,
    idempotentHit: true,
    verification,
  }
}
