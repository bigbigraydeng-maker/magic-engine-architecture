/**
 * Kernel 审批应用层 —— 判定与编排。
 *
 * 🔴 **这一层只审批，不执行。**
 *
 *    批准的终点是 `authorized`：一条已经签好人签放行、但**还没有人去跑**的动作。
 *    真正把它跑掉（领执行权 → 调 capability → 落步骤 → 回执）是 WP07 的事。
 *    所以本文件只 import 授权段的 `approveRun` / `rejectRun`，
 *    **绝不 import** `approveAndRun` / `rejectPendingRun` / `executeAuthorizedRun` /
 *    `@/lib/capabilities` / `@/lib/kernel` 门面 —— 有架构测试盯着这条边界，
 *    也有行为测试盯着「批准之后一步都没跑」。
 *
 * 🔴 **身份一律来自服务端。** 操作者邮箱来自登录会话，客户归属来自
 *    `run.client_id`（从库里读出来的），动作的授权门槛来自 `ACTION_REGISTRY`。
 *    请求体里能带的只有三样：approve/reject、看到的那份审批请求的 id、原因。
 *    多一个字段就当伪造拒掉。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessTier } from '@/lib/auth/access-types'
import type { ActionDefinition, ActionRun } from '@/lib/kernel/types'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { approveRun, rejectRun } from '@/lib/kernel/authorize'
import { KernelError } from '@/lib/kernel/errors'
import { createKernelDeps, type KernelDeps } from '@/lib/kernel/deps'
import { isUuid } from '@/lib/validation-utils'
import { ApprovalError, isKernelNotProvisioned } from './errors'
import {
  getDecisionForApproval,
  getDecisionsByIds,
  getRunForApproval,
  listPendingRunsForClient,
} from './queries'
import type {
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  PendingApprovalDetail,
  PendingApprovalSummary,
} from './types'

// ── Capability tier 闸 ────────────────────────────────────────────────────────

/**
 * 这个档次的人能不能授权门槛为 `required` 的动作。
 *
 * 🔴 **冻结判定，白名单式，认不出一律 false。**
 *    · `admin`       —— 内部人员，可以授权任何动作；
 *    · `paid_client` —— 付费客户 / 代其操作的 FDE，可以授权门槛**不是 admin** 的动作；
 *    · `self_serve`  —— 自助免费档，一律不许授权（它连付费功能都进不去）；
 *    · `portal_only` —— 老门户，一律不许；
 *    · 认不出的档次 —— 一律不许（新加一档如果忘了在这里分类，默认是「不许」，
 *      不是「放行」。反过来写的话，加一个枚举值就等于悄悄开一道门）。
 *
 * 🔴 这道闸**必须自己站得住**，不能靠「反正 requirePaidClientAccess 已经把
 *    self_serve 挡掉了」。前面那道闸是按客户归属判的，将来它一放宽，
 *    这里就成了唯一一道 —— 所以它有自己的直测用例，不靠前一道闸遮着。
 */
export function canAuthorizeAction(actorTier: string, requiredTier: string): boolean {
  if (actorTier === 'admin') return true
  if (actorTier === 'paid_client') return requiredTier !== 'admin'
  return false
}

/**
 * 找出这条 run 对应的动作定义 —— **必须是同一个 key 且同一版**。
 *
 * 🔴 注册表认不出 = **不许授权**，不是「先批了再说」。
 *    认不出就说明没有人给它定过风险、副作用和授权门槛 ——
 *    那么「谁有资格点这个头」这个问题在系统里根本没有答案，只能 fail closed。
 *
 * 🔴 **版本对不上也算认不出。**（Codex P2）
 *    注册表只存**当前**这一版。契约升过版之后，库里那些按旧版排的
 *    `pending_approval` 拿 `action_key` 是查得到定义的 —— 查到的是**新版**。
 *    后果有两层，都不能接受：
 *      · **权限**：`requiredCapabilityTier` 会按新版判。旧版要 admin、新版
 *        降成 paid_client 的话，一条本该只有内部人能批的旧动作，就对付费客户开了；
 *      · **展示**：列表和详情会把新版的标题 / 风险 / 副作用贴在一条旧请求上，
 *        人看着 A 点的头，实际那条 run 记的是 B。
 *
 *    Kernel 的 `preflight` 早就在判这一条（版本对不上 → `unknown_action_version`
 *    直接 deny）。审批的读 / 鉴权路径没理由比执行路径松 ——
 *    跟 `decisionBelongsToRun` 是同一个道理。
 */
type DefinitionLookup =
  | { readonly ok: true; readonly definition: ActionDefinition }
  | { readonly ok: false; readonly reason: 'unknown_action' | 'unknown_action_version' }

function lookupDefinition(run: ActionRun): DefinitionLookup {
  const definition = ACTION_REGISTRY.get(run.action_key)
  if (!definition) return { ok: false, reason: 'unknown_action' }
  if (definition.version !== run.action_version) {
    return { ok: false, reason: 'unknown_action_version' }
  }
  return { ok: true, definition }
}

/** 只在 key 和版本都对得上时给定义；否则 null（**不拿新版顶替旧版**）。 */
function definitionFor(run: ActionRun): ActionDefinition | null {
  const found = lookupDefinition(run)
  return found.ok ? found.definition : null
}

/**
 * 这个操作者对这条 run **能做什么**。
 *
 * 🔴 **门槛只管「批准」，不管「说不做」。**（Codex P2）
 *
 *    上一轮补版本核对时，我把这道闸挂在了详情和决定两条路的最前面 ——
 *    于是契约一升版，那些按旧版排的 `pending_approval` 就**连拒绝都做不了**：
 *    详情打不开、reject 也是 403，连 admin 都没辙。没有别的重排 / 清理入口，
 *    这些记录会**永久卡在那儿**。那正是铁律「管道不许断头」要防的东西 ——
 *    一条谁都处理不了的待办，比没有待办更糟。
 *
 *    正确的不对称是：
 *      · **批准**要过版本 + 档次 —— 它是「让这件事发生」的那一下；
 *      · **拒绝**不过 —— 它只是「别做」，不授权任何执行，
 *        而且 `rejectRun` 本来就允许 `definition` 为 null（不查注册表、不跑 preflight）。
 *
 *    客户归属和付费轨仍然是硬前提（`requireApprovalActor` 已经挡过一道）——
 *    放宽的只有「谁能说不做」，不是「谁能进来」。
 */
export interface ApprovalPermissions {
  readonly canApprove: boolean
  /** 🔴 拒绝永远允许 —— 留成字段是为了让界面读到的是**事实**，不是一句约定。 */
  readonly canReject: true
  /** 批不了的原因；能批时是 null。给界面用来说人话，不是让它自己判。 */
  readonly approveBlockedReason:
    | 'unknown_action'
    | 'unknown_action_version'
    | 'insufficient_tier'
    | null
}

export function approvalPermissionsFor(
  run: ActionRun,
  actorTier: AccessTier,
): ApprovalPermissions {
  const found = lookupDefinition(run)
  if (!found.ok) {
    return { canApprove: false, canReject: true, approveBlockedReason: found.reason }
  }
  if (!canAuthorizeAction(actorTier, found.definition.requiredCapabilityTier)) {
    return { canApprove: false, canReject: true, approveBlockedReason: 'insufficient_tier' }
  }
  return { canApprove: true, canReject: true, approveBlockedReason: null }
}

/**
 * 批准前的硬闸。**只在 `resolution === 'approve'` 时调**（见 `approvalPermissionsFor`）。
 */
export function assertActorMayApprove(run: ActionRun, actorTier: AccessTier): void {
  const perms = approvalPermissionsFor(run, actorTier)
  if (perms.canApprove) return

  const detail = {
    runId: run.id,
    actionKey: run.action_key,
    actionVersion: run.action_version,
    actorTier,
    reason: perms.approveBlockedReason,
  }
  if (perms.approveBlockedReason === 'unknown_action_version') {
    throw new ApprovalError(
      'forbidden_tier',
      `这条动作是按第 ${run.action_version} 版契约排的，系统现在跑的是另一版 ——` +
        '契约变过，不能拿新版的规则来批一条旧请求。' +
        '**你仍然可以点「不做」把它清掉**，或者请人重新排一次',
      detail,
    )
  }
  if (perms.approveBlockedReason === 'unknown_action') {
    throw new ApprovalError(
      'forbidden_tier',
      `系统认不出「${run.action_key}」这个动作 —— 没有人给它定过谁有资格授权它，所以批不了。` +
        '**你仍然可以点「不做」把它清掉**。这条不会自动执行',
      detail,
    )
  }
  throw new ApprovalError(
    'forbidden_tier',
    '这个动作需要更高的权限才能批准 —— 你的账号档次不够。请让有权限的同事来点。' +
      '**你仍然可以点「不做」**',
    detail,
  )
}

// ── 读 ────────────────────────────────────────────────────────────────────────

function toSummary(run: ActionRun, expectedDecisionId: string): PendingApprovalSummary {
  const definition = definitionFor(run)
  return {
    runId: run.id,
    clientId: run.client_id,
    expectedDecisionId,
    actionKey: run.action_key,
    actionVersion: run.action_version,
    purpose: run.purpose,
    goalId: run.goal_id,
    // 🔴 注册表认不出就是 null —— 不拿 action_key 当标题糊弄过去
    title: definition?.title ?? null,
    risk: definition?.risk ?? null,
    sideEffect: definition?.sideEffect ?? null,
    requiredCapabilityTier: definition?.requiredCapabilityTier ?? null,
    costEstimateUsd: run.cost_estimate_usd,
    costCapUsd: run.cost_cap_usd,
    rationale: run.rationale,
    requestedAt: run.updated_at,
  }
}

/**
 * 这份审批请求**真的**是这条 run 的那一份吗。
 *
 * 🔴 光看 `verdict === 'require_approval'` 不够。（Codex P2）
 *    `action_runs.authorization_decision_id` 是个外键，数据库只保证这个 id
 *    **存在**，不保证它指着的那条决策属于这条 run、属于这个客户。
 *    库里一次错挂（并发写、恢复路径写歪、手工改数据）就会让详情接口
 *    把**另一个客户**那条决策的 `reason` / `policyId` / 政策版本
 *    原样返回给当前这个客户 —— 一次错挂变成一次跨客户元数据泄露。
 *
 *    Kernel 的 `reuseLiveAuthorization` 早就在做同一组核对
 *    （`decision.client_id` + `decision.action_run_id`，对不上抛 `CROSS_CLIENT`）。
 *    审批的**读**路径没理由比执行路径松。
 */
function decisionBelongsToRun(
  decision: { id: string; action_run_id: string; client_id: string; verdict: string },
  run: ActionRun,
): boolean {
  if (decision.verdict !== 'require_approval') return false
  if (decision.action_run_id !== run.id) return false
  if (decision.client_id !== run.client_id) return false
  return true
}

/**
 * 这个客户当前等人点头的动作。
 *
 * 🔴 指针为空、或指着的那份审批请求读不回来的 run **不进列表**：
 *    没有 `expectedDecisionId` 就没法安全地提交决定（人点头点的是哪一份说不清），
 *    而随便给一个 id 让人点，比不显示危险得多。这类数据不一致会被记进
 *    `skipped`，由调用方决定要不要报出去 —— 但绝不会被悄悄当成「正常的一条」。
 */
export async function listPendingApprovals(
  sb: SupabaseClient,
  clientId: string,
  page: { limit?: number; cursor?: unknown } = {},
): Promise<{
  items: PendingApprovalSummary[]
  skippedRunIds: string[]
  hasMore: boolean
  limit: number
  nextCursor: string | null
}> {
  const { runs, hasMore, limit, nextCursor } = await listPendingRunsForClient(sb, clientId, page)
  if (runs.length === 0) return { items: [], skippedRunIds: [], hasMore, limit, nextCursor }

  const decisionIds = runs
    .map((run) => run.authorization_decision_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  const decisions = await getDecisionsByIds(sb, decisionIds)

  const items: PendingApprovalSummary[] = []
  const skippedRunIds: string[] = []
  for (const run of runs) {
    const decisionId = run.authorization_decision_id
    const decision = decisionId ? decisions.get(decisionId) : undefined
    // 🔴 不只是「读得回来」—— 还必须真的是这条 run、这个客户的那一份
    if (!decisionId || !decision || !decisionBelongsToRun(decision, run)) {
      skippedRunIds.push(run.id)
      continue
    }
    items.push(toSummary(run, decisionId))
  }
  return { items, skippedRunIds, hasMore, limit, nextCursor }
}

/**
 * 按 runId 读一条 run —— **鉴权之前**要用它把 `client_id` 读出来。
 *
 * 🔴 客户归属只能这么来。调用方声称的 clientId 一个字都不信。
 */
export async function loadRunForApproval(
  sb: SupabaseClient,
  runId: string,
): Promise<ActionRun> {
  const run = await getRunForApproval(sb, runId)
  if (!run) {
    throw new ApprovalError('not_found', '找不到这条动作 —— 它可能从来没存在过，或者已经被清理掉了', {
      runId,
    })
  }
  return run
}

/** 详情。run 必须已经过客户归属与档次校验。 */
export async function buildApprovalDetail(
  sb: SupabaseClient,
  run: ActionRun,
): Promise<PendingApprovalDetail> {
  if (run.status !== 'pending_approval') {
    throw new ApprovalError(
      'not_pending',
      `这条动作现在的状态是「${run.status}」，已经不在等人点头了 —— 它已经有结论了，刷新看看`,
      { runId: run.id, status: run.status },
    )
  }
  const decisionId = run.authorization_decision_id
  const decision = decisionId ? await getDecisionForApproval(sb, decisionId) : null
  if (!decisionId || !decision || !decisionBelongsToRun(decision, run)) {
    // 🔴 不编一份审批请求出来，也**不把一份不属于这条 run 的决策原样吐出去**
    //    —— 后者会把另一个客户的理由和政策版本泄露给当前这个客户。
    //    没有锚就没法安全地点头（Kernel 那边也会拒）。
    throw new ApprovalError(
      'not_pending',
      '这条动作标着「等人点头」，但当初那份审批请求对不上 —— 库里状态不一致，先别点，请重新排一次',
      { runId: run.id, decisionId },
    )
  }
  return {
    ...toSummary(run, decisionId),
    input: run.input,
    evidence: run.evidence,
    status: run.status,
    decision: {
      id: decision.id,
      reason: decision.reason,
      policyId: decision.policy_id,
      policyVersion: decision.policy_version,
      createdAt: decision.created_at,
    },
  }
}

// ── 请求体 ────────────────────────────────────────────────────────────────────

/** 拒绝原因的长度上限。够写清楚为什么不做，又不至于让人往里塞一整篇东西。 */
export const MAX_REASON_LENGTH = 500

/** 请求体里**唯一**允许出现的三个字段。多一个就当伪造。 */
const ALLOWED_BODY_KEYS = new Set(['resolution', 'expectedDecisionId', 'reason'])

/**
 * 把请求体读成一个决定。
 *
 * 🔴 **严格模式：出现任何别的字段一律 400。**
 *    不是「读不到就忽略」—— 忽略的话，一个带着 `actorEmail` / `clientId` /
 *    `requiredCapabilityTier` 的请求会**安静地成功**，提交的人以为自己那些字段
 *    起作用了，而将来某个人顺手加一句 `body.actorEmail ??` 就把身份闸拆了。
 *    当场拒掉，这条路从一开始就走不通。
 */
export function parseDecisionInput(body: unknown): ApprovalDecisionInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApprovalError('invalid_request', '请求内容不对：需要一个 JSON 对象')
  }
  const record = body as Record<string, unknown>

  const unexpected = Object.keys(record).filter((key) => !ALLOWED_BODY_KEYS.has(key))
  if (unexpected.length > 0) {
    throw new ApprovalError(
      'invalid_request',
      `请求里带了不该有的字段（${unexpected.join('、')}）—— 操作者身份、客户、动作、` +
        '权限档次一律由服务端从登录会话和库里取，请求体说了不算',
      { unexpected },
    )
  }

  const resolution = record.resolution
  if (resolution !== 'approve' && resolution !== 'reject') {
    throw new ApprovalError('invalid_request', 'resolution 只能是 approve 或 reject')
  }

  const expectedDecisionId = record.expectedDecisionId
  if (typeof expectedDecisionId !== 'string' || expectedDecisionId.trim().length === 0) {
    throw new ApprovalError(
      'invalid_request',
      '缺少 expectedDecisionId —— 必须带上你页面上看到的那份审批请求的 id，' +
        '否则没法确认你批的是不是你看见的那一件事',
    )
  }
  // 🔴 它最终会作为 `p_pending_decision_id`（uuid）进 RPC，所以语法必须先过。
  //    畸形值不判的话，Postgres 抛 22P02，接口答 500 —— 一个客户端问题被记成
  //    服务端故障。判在这里（请求体解析阶段）= 在读库、鉴权和任何写入之前。
  if (!isUuid(expectedDecisionId.trim())) {
    throw new ApprovalError(
      'invalid_request',
      'expectedDecisionId 不是一个合法的 id（应该长成 8-4-4-4-12 的那种）——' +
        '多半是页面上那份数据不完整，刷新一下再点',
      { field: 'expectedDecisionId' },
    )
  }

  const rawReason = record.reason
  if (rawReason !== undefined && typeof rawReason !== 'string') {
    throw new ApprovalError('invalid_request', 'reason 必须是一段文字')
  }
  const reason = rawReason?.trim() ?? ''

  // 🔴 拒绝必须说明原因：被拒的那条会进「可恢复」判定和今日待办，
  //    没有原因的话，下一个看到它的人不知道是「这次不合适」还是「永远别做」。
  if (resolution === 'reject' && reason.length === 0) {
    throw new ApprovalError('invalid_request', '点「不做」必须写一句为什么 —— 不然下一个人看不懂这条为什么被挡下来')
  }
  if (reason.length > MAX_REASON_LENGTH) {
    throw new ApprovalError(
      'invalid_request',
      `原因太长了（${reason.length} 字，最多 ${MAX_REASON_LENGTH} 字）`,
    )
  }

  return {
    resolution,
    // 🔴 **归一成小写。**（Codex P2）
    //    UUID 的大小写不影响它是哪一个值，所以上面那道校验刻意收大写 ——
    //    但 `expectedDecisionId` 后面要跟**从库里读出来的** `authorization_decision_id`
    //    做**字符串**比较，而 Postgres 吐出来的永远是小写。
    //    不归一的话，提交大写形式会被判成 STALE_DECISION：
    //    一个合法的批准 / 拒绝**永远提交不上去**，而且报的还是「你看到的不是最新的」
    //    这种完全指错方向的话。
    expectedDecisionId: expectedDecisionId.trim().toLowerCase(),
    ...(reason.length > 0 ? { reason } : {}),
  }
}

// ── 写（就这一处） ────────────────────────────────────────────────────────────

/**
 * 审批接口专用的 Kernel 依赖包。
 *
 * 🔴 **`capabilities` 是空的 —— 这不是省事，是这一层的安全属性之一。**
 *
 *    审批接口的职责到「签一份授权」为止。万一将来有人在这条路上误接了
 *    执行入口，空的能力表会让它当场 `CAPABILITY_NOT_IMPLEMENTED` 失败，
 *    而不是安静地把客户的东西发出去。
 *    再加上本模块**根本不 import** capability 层（架构测试盯着），
 *    「审批接口能执行」这件事在依赖图上和运行时上各断了一次。
 */
export function createApprovalKernelDeps(sb: SupabaseClient): KernelDeps {
  return createKernelDeps({
    supabase: sb,
    registry: ACTION_REGISTRY,
    capabilities: {},
    workerId: `kernel-approval@${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
  })
}

/**
 * Kernel 抛出来的错误 → 审批层的失败码。
 *
 * 🔴 认不出来的一律**原样抛**（→ 500）。把未知错误映射成某个「像是」的码，
 *    就是拿一句好听的话盖住一个还没被理解的失败。
 */
function translateKernelError(err: unknown): never {
  // 已经是审批层的失败了就别再翻一遍
  if (err instanceof ApprovalError) throw err

  if (err instanceof KernelError) {
    if (err.code === 'STALE_DECISION') {
      throw new ApprovalError('stale_decision', err.humanReason, err.detail)
    }
    if (err.code === 'INVALID_STATE') {
      // Kernel 的 INVALID_STATE 涵盖「已经不在等审批了」和「刚被别人处理掉了」——
      // 两者对提交决定的人来说是同一件事：这条已经有结论了，刷新再看。
      throw new ApprovalError('not_pending', err.humanReason, err.detail)
    }
  }

  // 🔴 **表在、RPC 不在**这一种要单独接住。（Codex P2）
  //
  //    分阶段 apply、或者函数刚建好但 PostgREST 的 schema cache 还没刷新时，
  //    前面的读取全都成功（表是真的在），只有提交决定这一下会炸 ——
  //    而 Kernel 的 store 把它包成一个**普通 Error**（`[kernel/store] … 失败：…`），
  //    错误码在那一层就丢了，只剩下嵌在文案里的那句 `function … does not exist`。
  //    不认它的话，同一件事（内核没配齐）在读路径答 503、在写路径答 500，
  //    接口自己的失败契约就先破了。
  if (isKernelNotProvisioned(err) || isKernelNotProvisioned({ message: messageOf(err) })) {
    throw new ApprovalError(
      'kernel_not_provisioned',
      '执行内核在这个环境里还没配齐（处理审批用的那个数据库函数还不存在）——' +
        '这次操作没有生效，也没有改动任何东西。表已经建好但函数还没建，或者刚建完还没生效',
      { dbMessage: messageOf(err) },
    )
  }

  throw err
}

/** 从任意异常里取一段可读文案。取不到给空串（**不编**）。 */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return ''
}

/**
 * 人点了同意 / 不做。
 *
 * 🔴 **这里只签授权，不跑任何东西。**
 *    · 同意 → `approveRun`  → run 停在 `authorized`
 *    · 不做 → `rejectRun`   → run 停在 `denied`
 *    两条路都只往 append-only 的决策表里加一条，谁批的、什么时候批的有据可查。
 *
 * @param run 已经过客户归属 + 档次校验的那一行（**必须**是服务端读出来的）
 * @param actorEmail 登录会话里的邮箱。**不许**来自请求体
 */
export async function decideApproval(
  deps: KernelDeps,
  args: {
    run: ActionRun
    actorEmail: string
    input: ApprovalDecisionInput
  },
): Promise<ApprovalDecisionResult> {
  const { run, actorEmail, input } = args

  try {
    if (input.resolution === 'reject') {
      // 🔴 拒绝的写路径**也**要过归属核对（错挂到别人的决策不许拒得掉，
      //    否则新签的 deny 会把对方的 policy_id / 版本抄进这个客户的审计记录）——
      //    但那道闸在**数据库里**：`kernel_resolve_pending_approval` 的
      //    `pending_identity_mismatch` 已经从 approve 分支提到了 approve/reject
      //    的公共分支（见 20260813000000 那条前向迁移）。
      //
      //    这里**刻意不再加一道应用层的同判据**：加了也是被数据库那道遮住的死闸 ——
      //    拆掉它测试照样全绿（实测变异探针 MISSED），而它每次还要多读一次库。
      //    真闸在锁里，这是对的地方。
      const outcome = await rejectRun(deps, run.id, actorEmail, input.reason ?? '', {
        expectedDecisionId: input.expectedDecisionId,
      })
      return {
        runId: run.id,
        finalStatus: 'denied',
        decisionId: outcome.decision.id,
        decidedBy: actorEmail,
        reason: outcome.decision.reason,
      }
    }

    const outcome = await approveRun(deps, run.id, actorEmail, {
      expectedDecisionId: input.expectedDecisionId,
      // 🔴 批准时人写的备注也要落库。接口按契约收下了这段话，
      //    不往下传就是静默丢弃 —— 审计表里只剩一句自动生成的通用理由。
      reason: input.reason,
    })

    // 🔴 批准也可能被 fail closed 拒掉（挂起期间政策改了 / 契约升版 / 超预算）——
    //    那时 Kernel 落的是一条 deny，run 进 `denied`。如实照搬，不粉饰成成功。
    if (outcome.verdict !== 'allow') {
      return {
        runId: run.id,
        finalStatus: 'denied',
        decisionId: outcome.decision.id,
        decidedBy: actorEmail,
        reason: outcome.decision.reason,
      }
    }

    return {
      runId: run.id,
      finalStatus: 'authorized',
      decisionId: outcome.decision.id,
      decidedBy: actorEmail,
      reason: outcome.decision.reason,
    }
  } catch (err) {
    translateKernelError(err)
  }
}
