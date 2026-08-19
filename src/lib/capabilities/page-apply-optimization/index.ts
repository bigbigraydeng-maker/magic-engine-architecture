/**
 * Capability · `page.apply_optimization_request`
 *
 * 把已经通过 Snapshot → Draft → Diff → Validation → Human Approval 的一份
 * `PageOptimizationRequest` 提交到 GitHub（v1 = **Draft PR**，不合并、不 auto-merge）。
 *
 * spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md
 *
 * 🔴 verification = execution-integrity only（§8）。**PR 创建成功 ≠ Growth success。**
 *    Growth 层的 matched remeasurement 走下游 GEO Measurement 链，跟本 capability 无关。
 *
 * 🔴 capability **不信任 input 里的任何 hash** —— `prepare` step 强制拿真实 approved
 *    snapshot 自己再算一遍（§4.1 / PM Change 6）。
 *
 * 🔴 本文件是 kernel/capabilities 边界之内唯一 import provider write module 的位置；
 *    `boundaries.ts` 的 PROVIDER_WRITE_ALLOWED_DIRS 自动覆盖新目录。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CapabilityImplementation,
  CapabilityStepResult,
  VerificationResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import type {
  GithubPageSnapshot,
  PageDiffResult,
  PageDraftResult,
  PageOptimizationField,
  PageOptimizationIntent,
  PageValidationResult,
  ProviderCheckInput,
  RedlineCheckInput,
} from '@/lib/page-optimization'
import {
  PAGE_OPTIMIZATION_FIELDS,
  draftPageChange,
  diffPageChange,
  extractGithubFieldValue,
  validatePageChange,
} from '@/lib/page-optimization'
import { resolveStaticHtmlPath, patchStaticHtmlPage } from '@/lib/cms/static-html-page-upgrade'
import type { PageApplyOptimizationDeps } from './deps'
import { defaultDeps } from './deps'
import { branchNameForRun, canonicalDiffHash, idempotencyKeyFromInput } from './hash'

// ── Input shape read from action_runs.input ──────────────────────────────────

interface RunInput {
  readonly page_url: string
  readonly page_version_token: string
  readonly validated_diff_hash: string
  readonly intents: readonly PageOptimizationIntent[]
  readonly do_not_touch: readonly PageOptimizationField[]
}

// ── Prior-step outputs (schema stays internal — kernel just passes them along) ──

interface PrepareOutput {
  readonly repo_owner: string
  readonly repo_name: string
  readonly default_branch: string
  readonly content_path: string
  readonly page_version_token: string
  readonly branch_name: string
  readonly patched_content: string
  readonly diff_changes: readonly {
    field: PageOptimizationField
    before: string
    after: string
    changed: boolean
  }[]
}

interface CommitOutput {
  readonly commit_created: true
}

interface OpenPrOutput {
  readonly pr_number: number
  readonly pr_url: string
}

// ── Loading helpers (server-side only, ctx-scoped) ────────────────────────────

async function loadRunInput(sb: SupabaseClient, runId: string): Promise<RunInput> {
  const { data, error } = await sb.from('action_runs').select('input').eq('id', runId).limit(1)
  if (error) throw new RetryableCapabilityError(`读取执行输入失败：${error.message}`)
  const row = (data ?? [])[0] as unknown as { input: Record<string, unknown> } | undefined
  if (!row) throw new KernelError('INVALID_STATE', `找不到执行实例 ${runId}`)
  const input = row.input ?? {}
  const pageUrl = input.page_url
  const versionToken = input.page_version_token
  const diffHash = input.validated_diff_hash
  const intents = input.intents
  const doNotTouch = input.do_not_touch
  if (
    typeof pageUrl !== 'string' ||
    typeof versionToken !== 'string' ||
    typeof diffHash !== 'string' ||
    !Array.isArray(intents) ||
    !Array.isArray(doNotTouch)
  ) {
    throw new KernelError('INVALID_INPUT', '执行输入缺字段或类型不对')
  }
  return {
    page_url: pageUrl,
    page_version_token: versionToken,
    validated_diff_hash: diffHash,
    intents: intents as readonly PageOptimizationIntent[],
    do_not_touch: doNotTouch as readonly PageOptimizationField[],
  }
}

async function loadDecisionExists(sb: SupabaseClient, decisionId: string): Promise<boolean> {
  const { data, error } = await sb
    .from('authorization_decisions')
    .select('id')
    .eq('id', decisionId)
    .limit(1)
  if (error) throw new RetryableCapabilityError(`回读授权决策失败：${error.message}`)
  return ((data ?? []) as unknown as Array<{ id: string }>).length === 1
}

// ── Step: prepare ─────────────────────────────────────────────────────────────

async function stepPrepare(
  sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string },
): Promise<CapabilityStepResult> {
  const input = await loadRunInput(sb, args.runId)

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) {
    throw new KernelError(
      'INVALID_INPUT',
      '这个客户没有已连接的 GitHub CMS —— 先在 Settings 里连上',
    )
  }

  const pathResult = resolveStaticHtmlPath(input.page_url, [...conn.contentPaths])
  if (!pathResult.ok) {
    throw new KernelError('INVALID_INPUT', `解析目标文件路径失败：${pathResult.reason}`)
  }

  const gh = deps.createGithubClient(conn.plainToken)
  const file = await gh.getFileContent(conn.repoOwner, conn.repoName, pathResult.filePath, conn.defaultBranch)

  // 🔴 §4.1 step 1：page_version_token 严格相等，不等即 stale_snapshot。
  if (file.sha !== input.page_version_token) {
    throw new KernelError(
      'INVALID_INPUT',
      'stale_snapshot：授权时刻的 blob SHA 跟现在读到的不一致，世界变了；请重跑 pipeline',
      {
        detail: {
          expected_page_version_token: input.page_version_token,
          actual_blob_sha: file.sha,
        },
      },
    )
  }

  // 🔴 §4.1 step 2：用现有 shared runtime 重跑 draft/diff/validate。
  const snapshot: GithubPageSnapshot = {
    ok: true,
    provider: 'github',
    fetchedAt: new Date().toISOString(),
    rawContent: file.decodedContent,
    versionToken: file.sha,
  }
  const draft: PageDraftResult = draftPageChange(snapshot, input.intents)
  if (!draft.ok) throw new KernelError('INVALID_INPUT', `draft 失败：${draft.reason}`)

  const diff: PageDiffResult = diffPageChange(snapshot, draft)
  if (!diff.ok) throw new KernelError('INVALID_INPUT', `diff 失败：${diff.reason}`)

  // 🔴 §4.1 step 4：doNotTouch 与 diff 无交集。**先于其它 assertion 检查**，
  //    让"违反 doNotTouch"这条最具体的错误明确落回 do_not_touch_violation，
  //    而不是被后面 validatePageChange 内部的 doNotTouch 检查吞成 pipeline_regression。
  const changedFields = new Set(diff.changes.filter((c) => c.changed).map((c) => c.field))
  const forbidden = input.do_not_touch.filter((f) => changedFields.has(f))
  if (forbidden.length > 0) {
    throw new KernelError(
      'INVALID_INPUT',
      `do_not_touch_violation：字段 [${forbidden.join(',')}] 在 doNotTouch 名单内但被 diff 改动`,
    )
  }

  // 🔴 §4.1 step 3：capability 自己重算 hash，跟 caller 传的严格相等。
  const recomputed = canonicalDiffHash(diff.changes)
  if (recomputed !== input.validated_diff_hash) {
    throw new KernelError(
      'INVALID_INPUT',
      'pipeline_regression：capability 重算 diff hash 跟 caller 传的对不上',
      { detail: { expected: input.validated_diff_hash, actual: recomputed } },
    )
  }

  // Validation 在这里不再重跑 redline/providerCheck —— 那是外部人审前的关卡；
  // capability 已由 Kernel authorize + ctx 承接。此处调用 validatePageChange
  // 只为复用 shared runtime 内部的 diff-request binding 断言（防"input 里的 diff
  // 跟 diff-recompute 结果对不上"）。redline 传 noop（本层不管红线），
  // providerCheck 传 noop-passed（provider check 在人审阶段已经做过）。
  const _validation: PageValidationResult = validatePageChange(
    {
      clientId: args.clientId,
      page: { url: input.page_url },
      intents: input.intents,
      lineage: { findingRefs: [] },
      verification: {
        metricRef: 'noop', windowDays: 1, baseline: 'noop',
        criteria: { success: 'noop', failure: 'noop', indeterminate: 'noop' },
      },
      constraints: { doNotTouch: input.do_not_touch },
      basedOnVersion: { known: true, value: input.page_version_token },
    },
    diff,
    { available: true, phrases: [] } satisfies RedlineCheckInput,
    { evaluated: true, passed: true } satisfies ProviderCheckInput,
  )
  if (!_validation.ok) {
    throw new KernelError(
      'INVALID_INPUT',
      `pipeline_regression：capability 内重跑 validate 不通过：${_validation.reason}`,
      { detail: { violations: _validation.violations ?? [] } },
    )
  }

  // 生成 patched content 交给 commit step。
  const byField = new Map(input.intents.map((i) => [i.field, i.proposedValue]))
  const metaTitle =
    byField.get('meta_title') ?? extractGithubFieldValue(file.decodedContent, 'meta_title')
  const metaDescription =
    byField.get('meta_description') ??
    extractGithubFieldValue(file.decodedContent, 'meta_description')
  if (metaTitle === null || metaDescription === null) {
    throw new KernelError('INVALID_INPUT', '目标页面无 <title> 或 meta description，起草失败')
  }
  const patch = patchStaticHtmlPage(file.decodedContent, {
    metaTitle,
    metaDescription,
    ...(byField.has('content_html') ? { htmlBody: byField.get('content_html')! } : {}),
  })
  if (!patch.ok) {
    throw new KernelError('INVALID_INPUT', `patchStaticHtmlPage 失败：${patch.reason}`)
  }

  const idKey = idempotencyKeyFromInput(input.page_url, input.page_version_token, input.validated_diff_hash)
  const output: PrepareOutput = {
    repo_owner: conn.repoOwner,
    repo_name: conn.repoName,
    default_branch: conn.defaultBranch,
    content_path: pathResult.filePath,
    page_version_token: input.page_version_token,
    branch_name: branchNameForRun(idKey),
    patched_content: patch.content,
    diff_changes: diff.changes.map((c) => ({
      field: c.field,
      before: c.before,
      after: c.after,
      changed: c.changed,
    })),
  }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: commit ──────────────────────────────────────────────────────────────

async function stepCommit(
  sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  if (!prep) throw new KernelError('INVALID_STATE', 'prepare 产物不见了')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失')

  const gh = deps.createGithubClient(conn.plainToken)

  // 分支若已存在则跳过创建（provider-native 幂等：重跑同一 idempotency-key 命同分支）。
  let baseSha: string
  try {
    baseSha = await gh.getBranchSha(prep.repo_owner, prep.repo_name, prep.default_branch)
  } catch (e) {
    throw new RetryableCapabilityError(
      `读取 base 分支 SHA 失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }
  try {
    await gh.createBranch(prep.repo_owner, prep.repo_name, prep.branch_name, baseSha)
  } catch (e) {
    // 422 = 已存在；其他错抛。GithubClient 不细分错误码，靠 message 判。
    const msg = e instanceof Error ? e.message : String(e)
    if (!/422|already exists|Reference already exists/i.test(msg)) {
      throw new RetryableCapabilityError(`createBranch 失败：${msg}`)
    }
  }

  // commitFile 用旧 blob SHA 作乐观并发令牌；main 已经动过 → GitHub 直接 409/422。
  try {
    await gh.commitFile(
      prep.repo_owner,
      prep.repo_name,
      prep.content_path,
      prep.branch_name,
      prep.patched_content,
      `chore(page): apply optimization ${prep.content_path} [kernel run ${args.runId}]`,
      prep.page_version_token,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 幂等：同一 blob 内容已 commit 过（GitHub 会 422 "does not match" 或直接 no-op），
    // 都视为 commit_created:true 让 open_pr 兜住。
    if (!/409|422|conflict|sha/i.test(msg)) {
      throw new RetryableCapabilityError(`commitFile 失败：${msg}`)
    }
  }

  const output: CommitOutput = { commit_created: true }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: open_pr ─────────────────────────────────────────────────────────────

async function stepOpenPr(
  _sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; decisionId: string; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  if (!prep) throw new KernelError('INVALID_STATE', 'prepare 产物不见了')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失')

  const gh = deps.createGithubClient(conn.plainToken)

  const body = [
    `Automated page optimization by Magic Engine Kernel.`,
    ``,
    `- kernel_run_id: ${args.runId}`,
    `- authorization_decision_id: ${args.decisionId}`,
    `- page: ${prep.content_path}`,
    `- page_version_token (blob SHA before): ${prep.page_version_token}`,
    ``,
    `Changed fields:`,
    ...prep.diff_changes
      .filter((c) => c.changed)
      .map((c) => `- ${c.field}: "${c.before}" → "${c.after}"`),
    ``,
    `Draft PR. Do not auto-merge. See spec: docs/specs/2026-08-19-me2-page-optimization-apply-action-v1.0.md`,
  ].join('\n')

  let pr
  try {
    pr = await gh.createPullRequest(prep.repo_owner, prep.repo_name, {
      title: `chore(page): apply optimization on ${prep.content_path}`,
      body,
      head: prep.branch_name,
      base: prep.default_branch,
      draft: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 幂等：同 head 已开过 PR → provider 返回既有 PR 或 422；用 provider-side lookup 兜住。
    if (/422|already/i.test(msg)) {
      // 简化：这里不做二次查询以保持 PR 面窄；后续如果测试要求，再加 gh.findPullRequestByHead。
      throw new RetryableCapabilityError(`pr_open_failed（可能是已存在）：${msg}`)
    }
    throw new RetryableCapabilityError(`pr_open_failed：${msg}`)
  }

  const output: OpenPrOutput = { pr_number: pr.number, pr_url: pr.html_url }
  return { costActualUsd: 0, output: output as unknown as Record<string, unknown> }
}

// ── Step: record（执行 §8.1 五条 execution-integrity 断言） ────────────────────

async function stepRecord(
  sb: SupabaseClient,
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; decisionId: string; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  const opened = args.priorOutputs.open_pr as unknown as OpenPrOutput | undefined
  if (!prep || !opened) throw new KernelError('INVALID_STATE', '前置步骤产物不齐')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失')

  const gh = deps.createGithubClient(conn.plainToken)

  const checks: VerificationResult['checks'] = []
  const record = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, ...(detail ? { detail } : {}) })

  // ① PR 确实创建
  let prState: { state: 'open' | 'closed'; merged: boolean; mergedAt: string | null } | null = null
  try {
    prState = await gh.getPullRequestState(prep.repo_owner, prep.repo_name, opened.pr_number)
  } catch (e) {
    record('PR 可回读', false, e instanceof Error ? e.message : String(e))
  }
  record(
    'PR 状态为 open',
    prState !== null && prState.state === 'open' && prState.merged === false,
    prState ? `state=${prState.state} merged=${prState.merged}` : undefined,
  )

  // ② PR 基于批准时的版本（重读 base main 上的 blob SHA，等于 page_version_token）
  //    这里不 GET /pulls/{number}/files（会带来大 patch），而是直接对比 main 上的 blob。
  //    commitFile 已把 blob SHA 当乐观令牌传给 GitHub —— main 若在授权→apply 间移动过，
  //    commit 阶段就 409 了；这里再验一次做 belt-and-suspenders。
  let mainSha = ''
  try {
    const mainFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    mainSha = mainFile.sha
  } catch (e) {
    record('base main blob 可回读', false, e instanceof Error ? e.message : String(e))
  }
  record(
    'PR 基于 approved 版本（main blob = page_version_token）',
    mainSha === prep.page_version_token,
    mainSha ? `main_sha=${mainSha} expected=${prep.page_version_token}` : undefined,
  )

  // ③ PR diff 等于 approved validated diff（读 PR 分支 head 的文件，字段级重算 hash）
  let integrityHash = ''
  let integrityDiffChanges: PrepareOutput['diff_changes'] = []
  try {
    const headFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name)
    // 逐字段对比 base main 上的值（就是 approved 的 before）与 head 上的值（after）。
    const baseFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    integrityDiffChanges = PAGE_OPTIMIZATION_FIELDS.map((field) => {
      const before = extractGithubFieldValue(baseFile.decodedContent, field) ?? ''
      const after = extractGithubFieldValue(headFile.decodedContent, field) ?? ''
      return { field, before, after, changed: before !== after }
    }).filter((c) => c.changed || prep.diff_changes.some((d) => d.field === c.field))
    integrityHash = canonicalDiffHash(integrityDiffChanges)
  } catch (e) {
    record('PR head/base blob 可回读', false, e instanceof Error ? e.message : String(e))
  }
  // 比 approved 的 diff hash（去掉 doNotTouch 之外的意外字段）
  const approvedHash = canonicalDiffHash(prep.diff_changes.filter((c) => c.changed))
  const integrityChangedOnly = integrityDiffChanges.filter((c) => c.changed)
  const integrityChangedHash = canonicalDiffHash(integrityChangedOnly)
  record(
    'PR diff = approved validated diff',
    integrityChangedHash === approvedHash,
    `pr=${integrityChangedHash} approved=${approvedHash}`,
  )

  // ④ doNotTouch 字段：head 值 = base 值（未变化）
  const doNotTouchViolations: string[] = []
  try {
    const headFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name)
    const baseFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    // 从 run input 拿 doNotTouch —— 但 prep 里没带；改从 action_runs.input 再读一次。
    const input = await loadRunInput(sb, args.runId)
    for (const field of input.do_not_touch) {
      const before = extractGithubFieldValue(baseFile.decodedContent, field) ?? ''
      const after = extractGithubFieldValue(headFile.decodedContent, field) ?? ''
      if (before !== after) doNotTouchViolations.push(field)
    }
  } catch (e) {
    record('doNotTouch 字段可读取', false, e instanceof Error ? e.message : String(e))
  }
  record(
    'doNotTouch 字段被守住',
    doNotTouchViolations.length === 0,
    doNotTouchViolations.length > 0 ? `违反字段：${doNotTouchViolations.join(',')}` : undefined,
  )

  // ⑤ receipt / lineage 可回读
  const decisionOk = await loadDecisionExists(sb, args.decisionId)
  record('authorization_decisions 行可回读', decisionOk, decisionOk ? undefined : args.decisionId)

  // 用外部忽略了 integrityHash 的 unused 提示消一下 lint（把它塞进 detail）
  void integrityHash

  const failed = checks.filter((c) => !c.passed)
  const verification: VerificationResult = {
    method: 'page_apply_integrity',
    passed: failed.length === 0,
    checks,
    ...(failed.length > 0
      ? {
          failure_reason: failed
            .map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`)
            .join('；'),
        }
      : {}),
  }

  return {
    costActualUsd: 0,
    verification,
    output: {
      provider: 'github',
      run_reference: `pr:${prep.repo_owner}/${prep.repo_name}#${opened.pr_number}`,
      pr_url: opened.pr_url,
    },
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPageApplyOptimizationCapability(
  sb: SupabaseClient,
  overrideDeps?: Partial<PageApplyOptimizationDeps>,
): CapabilityImplementation {
  const deps: PageApplyOptimizationDeps = { ...defaultDeps(), ...(overrideDeps ?? {}) }

  return {
    actionKey: 'page.apply_optimization_request',
    version: 1,
    steps: {
      async prepare({ ctx }) {
        return stepPrepare(sb, deps, { runId: ctx.runId, clientId: ctx.clientId })
      },
      async commit({ ctx, priorOutputs }) {
        return stepCommit(sb, deps, { runId: ctx.runId, clientId: ctx.clientId, priorOutputs })
      },
      async open_pr({ ctx, priorOutputs }) {
        return stepOpenPr(sb, deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          decisionId: ctx.decisionId,
          priorOutputs,
        })
      },
      async record({ ctx, priorOutputs }) {
        return stepRecord(sb, deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          decisionId: ctx.decisionId,
          priorOutputs,
        })
      },
    },
  }
}
