/**
 * Authorization —— DAPE 的 A(uthorization) 段。
 *
 * 🔴 这一段的目标是**减少**审批，不是制造审批（ADR-001）：
 *    低风险 + 已预批准 → 自动跑；超阈值或中高风险 → 等人点；
 *    未注册 / 禁止 → 拒绝。**默认 deny**。
 *
 * 🔴 「默认 deny」的实现是「查不到政策行 = 拒绝」，不是给 mode 一个默认值。
 *    默认值会让「忘了配」和「明确配成自动」在库里长得一模一样。
 *
 * 这个文件是**唯一**能造出 `AuthorizedExecutionContext` 的地方。
 * 但它造出来的东西也不是通行证 —— Gateway 会把每一条授权事实
 * 从 append-only 的决策表里重读一遍再比对（见 gateway.ts）。
 */

import type {
  ActionDefinition,
  ActionRun,
  AuthorizationDecision,
  AuthorizedExecutionContext,
  ClientAutomationPolicy,
  DenyCode,
  Verdict,
} from './types'
import type { KernelDeps } from './deps'
import { validateAgainstSchema } from './registry'
import { getActivePolicy, insertDecision, updateRun } from './store'

export interface AuthorizationOutcome {
  verdict: Verdict
  decision: AuthorizationDecision
  run: ActionRun
  /** 只有 verdict === 'allow' 时才有。其余情况拿不到执行凭证。 */
  ctx: AuthorizedExecutionContext | null
}

/** 政策快照 —— 判定当时的样子。政策后来改了也能复盘「当时凭什么放行」。 */
function snapshotOf(
  policy: ClientAutomationPolicy | null,
  definition: ActionDefinition | null,
): Record<string, unknown> {
  return {
    policy: policy
      ? {
          id: policy.id,
          mode: policy.mode,
          policy_version: policy.policy_version,
          spend_cap_per_run_usd: policy.spend_cap_per_run_usd,
          spend_cap_per_period_usd: policy.spend_cap_per_period_usd,
          spend_cap_period: policy.spend_cap_period,
          decision_ttl_seconds: policy.decision_ttl_seconds,
          effective_from: policy.effective_from,
        }
      : null,
    definition: definition
      ? {
          action_key: definition.actionKey,
          version: definition.version,
          risk: definition.risk,
          side_effect: definition.sideEffect,
          reversible: definition.reversible,
          capability: definition.capability,
          required_tier: definition.requiredCapabilityTier,
        }
      : null,
  }
}

/**
 * 🔴 全仓唯一一处把普通对象抬成 `AuthorizedExecutionContext` 的地方。
 *
 * 架构测试 `no forged authorized contexts` 会扫全仓，
 * 除本文件外任何地方出现同形状的类型断言都直接判失败。
 */
function mintContext(
  decision: AuthorizationDecision,
  costCapUsd: number | null,
): AuthorizedExecutionContext {
  return {
    decisionId: decision.id,
    runId: decision.action_run_id,
    clientId: decision.client_id,
    actionKey: decision.action_key,
    actionVersion: decision.action_version,
    policyVersion: decision.policy_version,
    costCapUsd,
    idempotencyKey: decision.idempotency_key,
    expiresAt: decision.expires_at,
  } as unknown as AuthorizedExecutionContext
}

interface DenyArgs {
  run: ActionRun
  definition: ActionDefinition | null
  policy: ClientAutomationPolicy | null
  code: DenyCode
  reason: string
  costEstimate: number | null
}

async function recordDeny(deps: KernelDeps, args: DenyArgs): Promise<AuthorizationOutcome> {
  const decision = await insertDecision(deps.supabase, {
    action_run_id: args.run.id,
    client_id: args.run.client_id,
    action_key: args.run.action_key,
    action_version: args.run.action_version,
    verdict: 'deny',
    deny_code: args.code,
    reason: args.reason,
    policy_snapshot: snapshotOf(args.policy, args.definition),
    policy_version: args.policy?.policy_version ?? null,
    decided_by: 'policy',
    decided_by_user: null,
    cost_cap_usd: args.policy?.spend_cap_per_run_usd ?? null,
    cost_estimate_usd: args.costEstimate,
    idempotency_key: args.run.idempotency_key,
    expires_at: null,
  })

  const run = await updateRun(deps.supabase, args.run.id, {
    status: 'denied',
    authorization_decision_id: decision.id,
    // 🔴 被拒绝也要有人看见。拒绝只写进日志 = 发现死在日志里。
    needs_human: true,
    last_error: args.reason,
    finished_at: deps.now().toISOString(),
  })

  return { verdict: 'deny', decision, run, ctx: null }
}

/**
 * 判定一个 run 能不能跑。
 *
 * 顺序有讲究：先判**认不认识这个动作**（认不出的连政策都不用查），
 * 再判输入合不合法，再判客户政策，最后才判钱。
 * 每一道闸失败都落一条 append-only 的决策记录 —— 包括未知动作。
 */
export async function authorizeRun(deps: KernelDeps, input: ActionRun): Promise<AuthorizationOutcome> {
  const now = deps.now()
  const run = await updateRun(deps.supabase, input.id, { status: 'authorizing' })

  // ① 认不认识这个动作。认不出 → deny，且必须留痕。
  const definition = deps.registry.get(run.action_key)
  if (!definition) {
    return recordDeny(deps, {
      run,
      definition: null,
      policy: null,
      code: 'unknown_action',
      reason: `「${run.action_key}」不是系统认识的动作 —— 没有人给它定过风险、幂等和验证方式，所以不能跑。要么它该被实现，要么这条建议本身提错了`,
      costEstimate: null,
    })
  }

  // ② 版本。授权是给「这个版本的契约」签的，不能拿旧版授权跑新版实现。
  if (definition.version !== run.action_version) {
    return recordDeny(deps, {
      run,
      definition,
      policy: null,
      code: 'unknown_action_version',
      reason: `这条动作是按第 ${run.action_version} 版契约排的，系统现在跑的是第 ${definition.version} 版 —— 契约变过，得重新排一次`,
      costEstimate: null,
    })
  }

  // ③ 输入结构。
  const schemaCheck = validateAgainstSchema(definition.inputSchema, run.input)
  if (!schemaCheck.ok) {
    return recordDeny(deps, {
      run,
      definition,
      policy: null,
      code: 'invalid_input',
      reason: `这条动作的参数不对：${schemaCheck.reason}`,
      costEstimate: null,
    })
  }

  // ④ purpose。同一个动作不许一会儿算增长、一会儿算维护 —— 那会让「要不要挂目标」失去意义。
  if (!definition.allowedPurposes.includes(run.purpose)) {
    return recordDeny(deps, {
      run,
      definition,
      policy: null,
      code: 'purpose_not_allowed',
      reason: `这个动作只能作为「${definition.allowedPurposes.join('/')}」类任务提交，这条提交的是「${run.purpose}」`,
      costEstimate: null,
    })
  }

  // ⑤ 🔴 v1 硬闸：任何对外副作用一律拒绝，不看政策、不看角色。
  //    这不是保守，是 ADR-004 定的交付边界 —— v1 只验证内核机制，
  //    「敢不敢对外发布」是另一个独立风险，不许被内核的进度压力推着走。
  if (definition.sideEffect === 'outward') {
    return recordDeny(deps, {
      run,
      definition,
      policy: null,
      code: 'outward_side_effect_blocked',
      reason: '这个动作会作用到客户自己的资产之外，当前版本的执行内核一律不放行',
      costEstimate: null,
    })
  }

  // ⑥ 客户政策。**查不到 = 拒绝。**
  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  if (!policy) {
    return recordDeny(deps, {
      run,
      definition,
      policy: null,
      code: 'no_policy',
      reason: `这个客户还没有为「${definition.title}」设过自动化规则 —— 没设就是不许自动做，需要先在设置里给它一个规则`,
      costEstimate: definition.costModel.estimate(run.input),
    })
  }
  if (policy.effective_to && Date.parse(policy.effective_to) <= now.getTime()) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_expired',
      reason: '这个客户的自动化规则已经过期了，需要重新设一条',
      costEstimate: definition.costModel.estimate(run.input),
    })
  }
  if (policy.mode === 'deny') {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_deny',
      reason: `这个客户明确关掉了「${definition.title}」的自动执行`,
      costEstimate: definition.costModel.estimate(run.input),
    })
  }

  // ⑦ 钱。上限没写 = 0，不是「不限」—— 不限必须显式写一个数。
  const costEstimate = definition.costModel.estimate(run.input)
  const costCap = policy.spend_cap_per_run_usd ?? 0
  if (costEstimate > costCap) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'over_cost_cap',
      reason: `这次预计要花 $${costEstimate.toFixed(2)}，超过了这个客户给这类动作设的单次上限 $${costCap.toFixed(2)}`,
      costEstimate,
    })
  }

  const expiresAt = new Date(now.getTime() + policy.decision_ttl_seconds * 1000).toISOString()

  // ⑧ 要人点头。
  if (policy.mode === 'require_approval') {
    const decision = await insertDecision(deps.supabase, {
      action_run_id: run.id,
      client_id: run.client_id,
      action_key: run.action_key,
      action_version: run.action_version,
      verdict: 'require_approval',
      deny_code: null,
      reason: `按这个客户的规则，「${definition.title}」要你点头才做`,
      policy_snapshot: snapshotOf(policy, definition),
      policy_version: policy.policy_version,
      decided_by: 'policy',
      decided_by_user: null,
      cost_cap_usd: costCap,
      cost_estimate_usd: costEstimate,
      idempotency_key: run.idempotency_key,
      expires_at: null,
    })
    const updated = await updateRun(deps.supabase, run.id, {
      status: 'pending_approval',
      authorization_decision_id: decision.id,
      cost_cap_usd: costCap,
      cost_estimate_usd: costEstimate,
      needs_human: true,
    })
    return { verdict: 'require_approval', decision, run: updated, ctx: null }
  }

  // ⑨ 放行。
  const decision = await insertDecision(deps.supabase, {
    action_run_id: run.id,
    client_id: run.client_id,
    action_key: run.action_key,
    action_version: run.action_version,
    verdict: 'allow',
    deny_code: null,
    reason: `这个客户已经允许系统自己做「${definition.title}」，且这次不花钱、不对外`,
    policy_snapshot: snapshotOf(policy, definition),
    policy_version: policy.policy_version,
    decided_by: 'policy',
    decided_by_user: null,
    cost_cap_usd: costCap,
    cost_estimate_usd: costEstimate,
    idempotency_key: run.idempotency_key,
    expires_at: expiresAt,
  })
  const updated = await updateRun(deps.supabase, run.id, {
    status: 'authorized',
    authorization_decision_id: decision.id,
    cost_cap_usd: costCap,
    cost_estimate_usd: costEstimate,
    needs_human: false,
  })

  return { verdict: 'allow', decision, run: updated, ctx: mintContext(decision, costCap) }
}

/**
 * 人点了「同意」。
 *
 * 走的是**新签一条决策**，不是把原来那条 require_approval 改成 allow ——
 * 决策表是 append-only，改写审计记录等于没有审计。
 */
export async function approveRun(
  deps: KernelDeps,
  runId: string,
  approvedByUser: string,
): Promise<AuthorizationOutcome> {
  const now = deps.now()
  const run = await deps.requireRun(runId)

  if (run.status !== 'pending_approval') {
    throw new Error(
      `[kernel/authorize] 这条动作现在的状态是「${run.status}」，不是在等人点头，不能批准`,
    )
  }

  const definition = deps.registry.get(run.action_key)
  if (!definition) {
    return recordDeny(deps, {
      run,
      definition: null,
      policy: null,
      code: 'unknown_action',
      reason: `「${run.action_key}」已经不在系统认识的动作里了，批准也跑不了`,
      costEstimate: null,
    })
  }

  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  const costCap = run.cost_cap_usd ?? policy?.spend_cap_per_run_usd ?? 0
  const ttl = policy?.decision_ttl_seconds ?? 900

  const decision = await insertDecision(deps.supabase, {
    action_run_id: run.id,
    client_id: run.client_id,
    action_key: run.action_key,
    action_version: run.action_version,
    verdict: 'allow',
    deny_code: null,
    reason: `${approvedByUser} 点了同意`,
    policy_snapshot: snapshotOf(policy, definition),
    policy_version: policy?.policy_version ?? null,
    decided_by: 'human',
    decided_by_user: approvedByUser,
    cost_cap_usd: costCap,
    cost_estimate_usd: run.cost_estimate_usd,
    idempotency_key: run.idempotency_key,
    expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
  })

  const updated = await updateRun(deps.supabase, run.id, {
    status: 'authorized',
    authorization_decision_id: decision.id,
    cost_cap_usd: costCap,
    needs_human: false,
  })

  return { verdict: 'allow', decision, run: updated, ctx: mintContext(decision, costCap) }
}

/** 人点了「不做」。同样是新签一条决策。 */
export async function rejectRun(
  deps: KernelDeps,
  runId: string,
  rejectedByUser: string,
  reason: string,
): Promise<AuthorizationOutcome> {
  const run = await deps.requireRun(runId)
  const definition = deps.registry.get(run.action_key)

  const decision = await insertDecision(deps.supabase, {
    action_run_id: run.id,
    client_id: run.client_id,
    action_key: run.action_key,
    action_version: run.action_version,
    verdict: 'deny',
    deny_code: 'policy_deny',
    reason: `${rejectedByUser} 点了不做：${reason}`,
    policy_snapshot: snapshotOf(null, definition),
    policy_version: null,
    decided_by: 'human',
    decided_by_user: rejectedByUser,
    cost_cap_usd: run.cost_cap_usd,
    cost_estimate_usd: run.cost_estimate_usd,
    idempotency_key: run.idempotency_key,
    expires_at: null,
  })

  const updated = await updateRun(deps.supabase, run.id, {
    status: 'denied',
    authorization_decision_id: decision.id,
    needs_human: false,
    last_error: reason,
    finished_at: deps.now().toISOString(),
  })

  return { verdict: 'deny', decision, run: updated, ctx: null }
}
