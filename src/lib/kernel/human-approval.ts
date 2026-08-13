/**
 * 人工审批 —— 人点「同意」/「不做」的那一段。
 *
 * 🔴 **从 `authorize.ts` 拆出来的**（Codex P1：那个文件已经 894 行，
 *    越过了仓库铁律的「文件 < 800 行」）。安全核心同时装着自动授权、
 *    授权复用、人工审批和错误翻译四件事，后续改动很难被完整审查。
 *
 * 🔴 拆的是**代码位置，不是判据**：人工批准仍然跟自动放行走**同一个**
 *    `preflight`（见 `authorize.ts`）—— 那正是 P1-1 的核心，一个字都没松。
 *
 * 依赖方向：`human-approval → authorize`，单向，没有回边。
 */

import type { ActionRun } from './types'
import type { KernelDeps } from './deps'
import { getDecision, resolvePendingApproval } from './store'
import { KernelError } from './errors'
import {
  mintContext,
  preflight,
  recordDeny,
  snapshotOf,
  type AuthorizationOutcome,
} from './authorize'

/**
 * 人工决定的可选参数。
 *
 * 🔴 `expectedDecisionId` = **审批人当时在页面上真正看到的那份审批请求的 id**。
 *
 *    没有它的时候，服务端是这么干的：拿 runId 去库里重读一遍
 *    `run.authorization_decision_id`，读到什么就批什么。于是这条时间线是通的：
 *
 *      10:00  人打开审批页，看到「花 $2 发这条」
 *      10:05  政策改了 / 系统重新排了一次 → run 换上了**另一份**审批请求（$40）
 *      10:06  人点「同意」——服务端重读到的是新那份，**照批不误**
 *
 *    人点头点的是他看见的那一份，不是「这条 run 此刻恰好挂着的任意一份」。
 *    所以这个 id 由调用方带上来，并且**一路传到数据库**当作
 *    `p_pending_decision_id` —— 数据库拿到 run 行锁之后会再比对一次
 *    （`kernel_resolve_pending_approval` 第 ③ 步）。
 *
 *    两层缺一不可：
 *      · 应用层这一道让「明显过期」当场失败，**一个字都不写库**，并给人话；
 *      · 数据库那一道守的是「比完到提交之间」的那个窗口 —— 那里有行锁，是真原子。
 *
 *    不传 = 保持老行为（服务端重读）。**新的审批 API 一律必须传**；
 *    保留可选是为了不改动现有那些非 HTTP 调用方（测试、恢复路径）。
 */
export interface HumanDecisionOptions {
  readonly expectedDecisionId?: string
  /**
   * 🔴 批准时人写的备注（可选）。跟 `rejectRun` 的 `reason` 一样要落进
   *    append-only 的决策记录 —— 不落的话，接口按契约收下了这段话，
   *    审计表里却只剩一句自动生成的通用理由，人写的备注被**静默丢弃**。
   */
  readonly reason?: string
}

/**
 * 应用层的过期审批闸。
 *
 * 🔴 命中就抛，**在任何写入之前**。不落决策、不动 run —— 因为这次操作
 *    从一开始就不该发生：人批的是另一份东西。
 */
function assertDecisionStillCurrent(
  run: ActionRun,
  expectedDecisionId: string | undefined,
  actor: string,
): void {
  if (expectedDecisionId === undefined) return
  if (run.authorization_decision_id === expectedDecisionId) return
  throw new KernelError(
    'STALE_DECISION',
    `${actor} 看到的那份审批请求已经不是最新的了（这条动作期间被重新排过或规则改过）——` +
      '这次操作没有生效，也没有改动任何东西。刷新一下再决定',
    {
      detail: {
        runId: run.id,
        expectedDecisionId,
        currentDecisionId: run.authorization_decision_id,
      },
    },
  )
}

/**
 * RPC 在锁内发现「政策变了」的那几个原因。
 *
 * 🔴 它们的共同点是：**只读返回，一个字都没写**，run 仍然停在 `pending_approval`。
 *    判据来自迁移里 `kernel_resolve_pending_approval` 的政策三连
 *    （见 20260813000000 那条前向迁移）—— 两边不许分家。
 */
const POLICY_RACE_REASONS: ReadonlySet<string> = new Set([
  'no_active_policy',
  'policy_identity_changed',
  'stale_policy_version',
  'policy_mode_changed',
])

/**
 * RPC 在锁内发现「这份审批请求本身对不上」的那几个原因。
 *
 * 🔴 跟政策竞态同一个道理：**只读返回、一个字都没写**，run 仍然停在
 *    `pending_approval`。区别只在于这些是**库里的数据不一致**（指针挂歪了、
 *    请求被删了、身份对不上），刷新救不了，得有人去把那条记录理顺 ——
 *    但它**绝不是**「已经有结论了」。报成终态的话，界面会把一条
 *    既没结论、又还没人能处理的 run 从列表里抹掉，从此没人看得见它。
 */
const PENDING_INCONSISTENT_REASONS: ReadonlySet<string> = new Set([
  'pending_identity_mismatch',
  'pending_run_mismatch',
  'pending_not_found',
  'not_require_approval',
])

/**
 * 原子 RPC 失败 → Kernel 错误。
 *
 * 🔴 `decision_not_current` 必须保留成 `STALE_DECISION`，不能跟别的失败
 *    一起压成 `INVALID_STATE`。（Codex P2）
 *
 *    这两件事对人的意思完全相反：
 *      · `INVALID_STATE` = 这条已经有结论了（被批了 / 被拒了 / 跑起来了）——**没得再决定**；
 *      · `STALE_DECISION` = run **仍然停在 pending_approval**，只是期间被重新挂到
 *        了另一份待审批请求上 —— **刷新一下还能决定**。
 *    压成前者，界面会告诉人「已经有结论了」，而那件事其实还等着他点。
 */
function resolveFailureToError(
  reason: string,
  runId: string,
  actor: string,
  verb: string,
): never {
  if (reason === 'decision_not_current') {
    throw new KernelError(
      'STALE_DECISION',
      `${actor} 看到的那份审批请求已经不是最新的了（这条动作期间被重新排过）——` +
        `这次${verb}没有生效，也没有改动任何东西。刷新一下再决定`,
      { detail: { runId, reason } },
    )
  }

  // 🔴 政策竞态同样**不是终态**。（Codex P2）
  //    应用层的 preflight 跟 RPC 拿到行锁之间，客户的规则可能被删 / 换 / 升版 /
  //    改模式。RPC 这几条分支都是**只读返回、一个字不写**，run 仍然停在
  //    `pending_approval` —— 那件事还等着人点。
  //    压成 INVALID_STATE（→ 接口的 `not_pending`）等于告诉界面「已经有结论了」，
  //    界面会把一条还活着的待办从列表里抹掉。
  //    刷新之后再来一次，preflight 会如实落一条说清「规则变成什么了」的拒绝 ——
  //    那才是这件事该有的结局，而不是在这里被静静吞掉。
  if (POLICY_RACE_REASONS.has(reason)) {
    throw new KernelError(
      'STALE_DECISION',
      `这个客户的规则在${actor}点下去的这一瞬间被改过了（${reason}）——` +
        `这次${verb}没有生效，也没有改动任何东西。刷新一下再看`,
      { detail: { runId, reason } },
    )
  }

  // 🔴 身份对不上同样**不是终态**（Codex P1）：RPC 这几条也是只读返回，
  //    run 还停在 pending_approval。刷新救不了（是库里的数据不一致），
  //    但报成「已经有结论了」会让界面把它抹掉 —— 那条 run 就此谁都看不见了。
  if (PENDING_INCONSISTENT_REASONS.has(reason)) {
    throw new KernelError(
      'STALE_DECISION',
      `这条动作指着的那份审批请求对不上（${reason}）—— 这次${verb}没有生效，` +
        '也没有改动任何东西。它仍然停在「等人点头」，但库里状态不一致，需要重新排一次',
      { detail: { runId, reason } },
    )
  }
  throw new KernelError(
    'INVALID_STATE',
    `这条动作刚刚已经被别人处理了或状态变了（${reason}），这次${verb}没有生效`,
    { detail: { reason } },
  )
}

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
  options: HumanDecisionOptions = {},
): Promise<AuthorizationOutcome> {
  const now = deps.now()
  const run = await deps.requireRun(runId)

  if (run.status !== 'pending_approval') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是在等人点头，不能批准`,
    )
  }

  // 🔴 在任何写入之前 —— 批的必须是他看见的那一份（见 HumanDecisionOptions）
  assertDecisionStillCurrent(run, options.expectedDecisionId, approvedByUser)

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
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? run.authorization_decision_id ?? null,
    })
  }

  // ② 全套授权不变量重跑一遍（跟自动放行同一套闸）—— 这里说人话；
  //    数据库 RPC 之后还会重查所有「这里和提交之间可能变化」的库内事实。
  const pf = await preflight(deps, run, now)
  if (!pf.ok) {
    return recordDeny(deps, {
      run,
      definition: pf.definition,
      policy: pf.policy,
      code: pf.code,
      reason: `${approvedByUser} 点了同意，但这条现在已经不能做了：${pf.reason}`,
      costEstimate: pf.costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  const { definition, policy, costEstimate } = pf

  // ③ 当前政策必须**仍然**是「要审批」。
  if (policy.mode !== 'require_approval') {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后被改成了「${policy.mode === 'auto_approve' ? '自动执行' : policy.mode}」—— 规则变了就不能按旧的审批请求放行，请重新排一次`,
      costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  // ④ 而且必须是**同一行**政策（C2）。
  if (policy.id !== pending.policy_id) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后被删掉重建过 —— 你看到的还是旧规则下的请求，请重新排一次`,
      costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  // ⑤ 而且必须是**同一版**。
  if (policy.policy_version !== pending.policy_version) {
    return recordDeny(deps, {
      run,
      definition,
      policy,
      code: 'policy_changed_since_request',
      reason: `${approvedByUser} 点了同意，但这个客户的规则在挂起之后改过（第 ${pending.policy_version} 版 → 第 ${policy.policy_version} 版）—— 你看到的还是旧规则下的请求，请重新排一次`,
      costEstimate,
      onlyIfStatus: 'pending_approval',
      expectedDecisionId: options.expectedDecisionId ?? pending.id,
    })
  }

  // ⑥ 🔴 原子转换：签放行 + run → authorized 在数据库同一个事务里完成。
  //    两个人同时批准（或一次双击）时，抢的是同一把 run 行锁 ——
  //    输的一方在这里拿到 not_pending / decision_not_current，绝不覆盖赢家。
  //    RPC 内部会把政策三连（行身份 / 版本 / 模式）再查一遍，
  //    挡住「preflight 和这里之间政策又变了」的窗口。
  //    🔴 交给数据库的是**调用方带上来的那个 id**（没带才退回服务端重读的）。
  //    这一句就是「人批的是他看见的那一份」这条契约在数据库侧的落点。
  const resolved = await resolvePendingApproval(deps.supabase, {
    runId: run.id,
    pendingDecisionId: options.expectedDecisionId ?? pending.id,
    resolution: 'approve',
    resolvedBy: approvedByUser,
    reason:
      `${approvedByUser} 点了同意（规则自挂起以来没变过，仍是第 ${policy.policy_version} 版）` +
      (options.reason ? `：${options.reason}` : ''),
    policySnapshot: snapshotOf(policy, definition),
    costEstimateUsd: costEstimate,
  })
  if (!resolved.ok || !resolved.decisionId) {
    resolveFailureToError(resolved.reason, run.id, approvedByUser, '批准')
  }

  const decision = await getDecision(deps.supabase, resolved.decisionId)
  if (!decision) {
    throw new KernelError('INVALID_STATE', '批准已生效但读不回新签的决策 —— 库状态不一致，先别继续')
  }
  const updated = await deps.requireRun(run.id)

  return { verdict: 'allow', decision, run: updated, ctx: mintContext(decision, decision.cost_cap_usd) }
}

/** 人点了「不做」。同样是新签一条决策。 */
export async function rejectRun(
  deps: KernelDeps,
  runId: string,
  rejectedByUser: string,
  reason: string,
  options: HumanDecisionOptions = {},
): Promise<AuthorizationOutcome> {
  const run = await deps.requireRun(runId)
  const definition = deps.registry.get(run.action_key)

  // 🔴 只能拒绝**仍在等审批**的 run。running / succeeded / denied 一律不许覆盖 ——
  //    「对已过期页面重复点不做」和「拒绝跟批准赛跑」都会走到这里。
  if (run.status !== 'pending_approval') {
    throw new KernelError(
      'INVALID_STATE',
      `这条动作现在的状态是「${run.status}」，不是在等审批，不能拒绝（它可能已经被批准执行了）`,
    )
  }

  // 🔴 拒绝同样只能对「他看见的那一份」生效。人说「不做」说的是那件事，
  //    不是这条 run 此刻恰好挂着的任意一件事 —— 期间换过内容就得重看再决定。
  assertDecisionStillCurrent(run, options.expectedDecisionId, rejectedByUser)

  const pending = run.authorization_decision_id
    ? await getDecision(deps.supabase, run.authorization_decision_id)
    : null
  if (!pending || pending.verdict !== 'require_approval') {
    throw new KernelError(
      'INVALID_STATE',
      '找不到当初挂起这条动作的那份审批请求，不能拒绝 —— 请刷新后重试',
    )
  }

  // 原子转换：跟批准抢同一把 run 行锁，输的一方拿到机器可读原因。
  const resolved = await resolvePendingApproval(deps.supabase, {
    runId: run.id,
    pendingDecisionId: options.expectedDecisionId ?? pending.id,
    resolution: 'reject',
    resolvedBy: rejectedByUser,
    reason: `${rejectedByUser} 点了不做：${reason}`,
    policySnapshot: snapshotOf(null, definition),
    costEstimateUsd: run.cost_estimate_usd,
  })
  if (!resolved.ok || !resolved.decisionId) {
    resolveFailureToError(resolved.reason, run.id, rejectedByUser, '拒绝')
  }

  const decision = await getDecision(deps.supabase, resolved.decisionId)
  if (!decision) {
    throw new KernelError('INVALID_STATE', '拒绝已生效但读不回新签的决策 —— 库状态不一致')
  }
  const updated = await deps.requireRun(run.id)

  return { verdict: 'deny', decision, run: updated, ctx: null }
}
