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
import { getActivePolicy, getDecision, hasExpiredPolicy, insertDecision, updateRun } from './store'

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
    policy_id: args.policy?.id ?? null,
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

// ── 授权前置校验（authorizeRun 与 approveRun 共用同一套） ────────────────────

/**
 * 🔴 这一段是 P1-1 的核心：**人工批准和自动放行必须过同一套闸。**
 *
 * 早先 `approveRun` 只检查「run 是不是在等审批」，于是等审批期间：
 * 政策被删掉 / 政策从「要审批」改成「禁止」/ 契约升版 / 输入已不合法 /
 * 动作被改成对外副作用 —— 人一点同意，全都被绕过去了。
 * 最阴的一种是政策被删：签出来的决策 `policy_version = null`，
 * Gateway 重读也拿到 null，`null === null` 直接放行。
 *
 * 所以两条路走同一个 `preflight`，谁都不能少判一项。
 */
type PreflightResult =
  | {
      ok: true
      definition: ActionDefinition
      policy: ClientAutomationPolicy
      costEstimate: number
      costCap: number
    }
  | {
      ok: false
      code: DenyCode
      reason: string
      definition: ActionDefinition | null
      policy: ClientAutomationPolicy | null
      costEstimate: number | null
    }

async function preflight(deps: KernelDeps, run: ActionRun, now: Date): Promise<PreflightResult> {
  const bad = (
    code: DenyCode,
    reason: string,
    definition: ActionDefinition | null = null,
    policy: ClientAutomationPolicy | null = null,
    costEstimate: number | null = null,
  ): PreflightResult => ({ ok: false, code, reason, definition, policy, costEstimate })

  // ① 认不认识这个动作。认不出 → deny，且必须留痕。
  const definition = deps.registry.get(run.action_key)
  if (!definition) {
    return bad(
      'unknown_action',
      `「${run.action_key}」不是系统认识的动作 —— 没有人给它定过风险、幂等和验证方式，所以不能跑。要么它该被实现，要么这条建议本身提错了`,
    )
  }

  // ② 版本。授权是给「这个版本的契约」签的，不能拿旧版授权跑新版实现。
  if (definition.version !== run.action_version) {
    return bad(
      'unknown_action_version',
      `这条动作是按第 ${run.action_version} 版契约排的，系统现在跑的是第 ${definition.version} 版 —— 契约变过，得重新排一次`,
      definition,
    )
  }

  // ③ 输入结构。
  const schemaCheck = validateAgainstSchema(definition.inputSchema, run.input)
  if (!schemaCheck.ok) {
    return bad('invalid_input', `这条动作的参数不对：${schemaCheck.reason}`, definition)
  }

  // ④ purpose。同一个动作不许一会儿算增长、一会儿算维护。
  if (!definition.allowedPurposes.includes(run.purpose)) {
    return bad(
      'purpose_not_allowed',
      `这个动作只能作为「${definition.allowedPurposes.join('/')}」类任务提交，这条提交的是「${run.purpose}」`,
      definition,
    )
  }

  // ⑤ 🔴 v1 硬闸：任何对外副作用一律拒绝，不看政策、不看角色、**人也批不了**。
  if (definition.sideEffect === 'outward') {
    return bad(
      'outward_side_effect_blocked',
      '这个动作会作用到客户自己的资产之外，当前版本的执行内核一律不放行 —— 这条不是「等你点头」，是根本不做',
      definition,
    )
  }

  // ⑥ 客户政策。**查不到 = 拒绝。**
  const policy = await getActivePolicy(deps.supabase, run.client_id, run.action_key, now)
  const costEstimate = definition.costModel.estimate(run.input)
  if (!policy) {
    // getActivePolicy 已按时间窗过滤（C5）—— 走到这里就是真没有生效的规则。
    // 但「规则到期了」和「从来没配过」要分开说：前者该续一条，后者该新配一条。
    const expired = await hasExpiredPolicy(deps.supabase, run.client_id, run.action_key, now)
    if (expired) {
      return bad('policy_expired', '这个客户的自动化规则已经过期了，需要重新设一条', definition, null, costEstimate)
    }
    return bad(
      'no_policy',
      `这个客户还没有为「${definition.title}」设过自动化规则（也可能是刚被删掉了）—— 没有规则就是不许做，需要先在设置里给它一个规则`,
      definition,
      null,
      costEstimate,
    )
  }
  if (policy.mode === 'deny') {
    return bad(
      'policy_deny',
      `这个客户明确关掉了「${definition.title}」的自动执行`,
      definition,
      policy,
      costEstimate,
    )
  }

  // ⑦ 钱。上限没写 = 0，不是「不限」。
  const costCap = policy.spend_cap_per_run_usd ?? 0
  if (costEstimate > costCap) {
    return bad(
      'over_cost_cap',
      `这次预计要花 $${costEstimate.toFixed(2)}，超过了这个客户给这类动作设的单次上限 $${costCap.toFixed(2)}`,
      definition,
      policy,
      costEstimate,
    )
  }

  return { ok: true, definition, policy, costEstimate, costCap }
}

// ── 自动授权 ──────────────────────────────────────────────────────────────────

/**
 * 判定一个 run 能不能跑。
 *
 * 每一道闸失败都落一条 append-only 的决策记录 —— 包括未知动作。
 */
export async function authorizeRun(deps: KernelDeps, input: ActionRun): Promise<AuthorizationOutcome> {
  const now = deps.now()
  const run = await updateRun(deps.supabase, input.id, { status: 'authorizing' })

  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: pf.reason,
      costEstimate: pf.costEstimate,
    })
  }

  const { definition, policy, costEstimate, costCap } = pf
  const expiresAt = new Date(now.getTime() + policy.decision_ttl_seconds * 1000).toISOString()

  // 要人点头。
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
      policy_id: policy.id,
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

  // 放行。
  const decision = await insertDecision(deps.supabase, {
    action_run_id: run.id,
    client_id: run.client_id,
    action_key: run.action_key,
    action_version: run.action_version,
    verdict: 'allow',
    deny_code: null,
    reason: `这个客户已经允许系统自己做「${definition.title}」，且这次不花钱、不对外`,
    policy_snapshot: snapshotOf(policy, definition),
    policy_id: policy.id,
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

// ── 人工批准 ──────────────────────────────────────────────────────────────────

/**
 * 人点了「同意」。
 *
 * 🔴 人工批准能做的**只有一件事**：把「当前仍然是 require_approval、
 *    而且跟当初挂起时是同一版」的那条政策，从「等你点头」变成「可以做」。
 *
 *    它**不能**覆盖：没有政策 / 政策改成禁止 / 政策换了版本 / 契约升版 /
 *    输入已不合法 / purpose 不符 / 对外副作用 / 超预算。
 *    任何一项变了 —— 一律 fail closed，并落一条拒绝记录说清楚变了什么。
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

  // ① 当初挂起时那条 require_approval 决策必须还在 —— 它是「同一版政策」的锚。
  const pending = run.authorization_decision_id
    ? await getDecision(deps.supabase, run.authorization_decision_id)
    : null
  if (!pending || pending.verdict !== 'require_approval') {
    return recordDeny(deps, {
      run,
      definition: deps.registry.get(run.action_key),
      policy: null,
      code: 'approval_context_lost',
      reason: `${approvedByUser} 点了同意，但找不到当初挂起这条动作的那份审批请求了 —— 不能凭空签一份放行，请重新排一次`,
      costEstimate: null,
    })
  }

  // ② 全套授权不变量重跑一遍（跟自动放行同一套闸）
  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: `${approvedByUser} 点了同意，但这条现在已经不能做了：${pf.reason}`,
      costEstimate: pf.costEstimate,
    })
  }

  const { definition, policy, costEstimate, costCap } = pf

  // ③ 当前政策必须**仍然**是「要审批」。
  //    改成了自动，说明规则已经变了，这条该重新走一次授权，而不是靠人补签。
  if (policy.mode !== 'require_approval') {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后被改成了「${policy.mode === 'auto_approve' ? '自动执行' : policy.mode}」—— 规则变了就不能按旧的审批请求放行，请重新排一次`,
      costEstimate,
    })
  }

  // ④ 而且必须是**同一行**政策（C2）。「删掉重建」的新行版本号可能跟旧行一样，
  //    但行身份（uuid）造不出第二个 —— 你在待办里看到的是旧规则下的请求。
  if (policy.id !== pending.policy_id) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后被删掉重建过 —— 你看到的还是旧规则下的请求，请重新排一次`,
      costEstimate,
    })
  }

  // ⑤ 而且必须是**同一版**。版本变了 = 上限 / 有效期 / 模式动过。
  if (policy.policy_version !== pending.policy_version) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后改过（第 ${pending.policy_version} 版 → 第 ${policy.policy_version} 版）—— 你看到的还是旧规则下的请求，请重新排一次`,
      costEstimate,
    })
  }

  const decision = await insertDecision(deps.supabase, {
    action_run_id: run.id,
    client_id: run.client_id,
    action_key: run.action_key,
    action_version: run.action_version,
    verdict: 'allow',
    deny_code: null,
    reason: `${approvedByUser} 点了同意（规则自挂起以来没变过，仍是第 ${policy.policy_version} 版）`,
    policy_snapshot: snapshotOf(policy, definition),
    policy_id: policy.id,
    policy_version: policy.policy_version,
    decided_by: 'human',
    decided_by_user: approvedByUser,
    cost_cap_usd: costCap,
    cost_estimate_usd: costEstimate,
    idempotency_key: run.idempotency_key,
    expires_at: new Date(now.getTime() + policy.decision_ttl_seconds * 1000).toISOString(),
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
    policy_id: null,
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
