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

  // commitFile 用旧 blob SHA 作乐观并发令牌。有两条正常路径需要区分：
  //   (a) main 从 prepare 到 commit 之间被别人推动了：blob 不再是 page_version_token，
  //       GitHub 会 409/422 —— 这是**真 stale**，必须 fail-closed，不能被吞成"成功"。
  //   (b) 本 run 的 commit step 之前已经成功过一次，现在是重试：branch 上的 blob
  //       已经是我们的 patched 内容，用 page_version_token 再 commit 也会 409/422 ——
  //       这是**真幂等**，应当当成 commit_created:true。
  //
  // 靠错误消息里有没有 "sha" 或 "conflict" 无法区分两者。唯一可靠的判据是**回读
  // branch 上现在的文件内容**：等于 patched_content 就是 (b) 幂等；否则就是 (a) 真冲突。
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
    // 回读 branch 上现在的内容，判断是 (b) 幂等还是 (a) 真冲突
    let branchContent: string | null = null
    try {
      const now = await gh.getFileContent(
        prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name,
      )
      branchContent = now.decodedContent
    } catch {
      // 回读也失败 → 无法证明是幂等，保守走真冲突路径
    }
    if (branchContent === prep.patched_content) {
      // (b) 幂等：前一次尝试已 commit 成功，本次是 retry，接受为成功
    } else {
      // (a) 真 stale：main 在 prepare 到 commit 之间移动过，OCC 拒绝
      throw new KernelError(
        'INVALID_STATE',
        'commit 冲突：main 在授权与执行之间移动过（stale_snapshot_at_commit），拒绝执行；' +
          '需要重跑 pipeline 从新 snapshot 出发',
        { detail: { commitFileError: msg } },
      )
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
    // 幂等恢复：同 head → base 上 PR 已存在时 GitHub 返回 422，且该状态**永远**不会
    // 随时间改变（这不是可重试错误）。查已有 PR 复用其编号；查不到 = 真失败。
    if (/422|already/i.test(msg)) {
      let existing
      try {
        const list = await gh.listPullRequestsByHead(prep.repo_owner, prep.repo_name, prep.branch_name)
        existing = list.find((p) => p.number) ?? null
      } catch (lookupErr) {
        throw new KernelError(
          'INVALID_STATE',
          `pr_open_failed：createPullRequest 报"已存在"但查询也失败：${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}`,
          { detail: { originalError: msg } },
        )
      }
      if (!existing) {
        throw new KernelError(
          'INVALID_STATE',
          `pr_open_failed：createPullRequest 报"已存在"但按 head=${prep.branch_name} 找不到 —— provider 状态不自洽`,
          { detail: { originalError: msg } },
        )
      }
      pr = existing
    } else {
      throw new RetryableCapabilityError(`pr_open_failed：${msg}`)
    }
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
  //    逐字段对比 base main 上的值（approved before）与 head 上的值（after），
  //    只保留 changed 的条目算 hash —— approved diff 里 changed=true 的正是这些。
  let integrityChangedOnly: PrepareOutput['diff_changes'] = []
  try {
    const headFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.branch_name)
    const baseFile = await gh.getFileContent(prep.repo_owner, prep.repo_name, prep.content_path, prep.default_branch)
    integrityChangedOnly = PAGE_OPTIMIZATION_FIELDS.map((field) => {
      const before = extractGithubFieldValue(baseFile.decodedContent, field) ?? ''
      const after = extractGithubFieldValue(headFile.decodedContent, field) ?? ''
      return { field, before, after, changed: before !== after }
    }).filter((c) => c.changed)
  } catch (e) {
    record('PR head/base blob 可回读', false, e instanceof Error ? e.message : String(e))
  }
  const approvedHash = canonicalDiffHash(prep.diff_changes.filter((c) => c.changed))
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

  // ⑤ receipt / lineage 可回读 —— 两条独立断言：
  //    (5a) `output.run_reference` 能被 provider 反查命中（PR 真实存在，且 output
  //         字符串本身自洽）—— 用 pr_number 独立再取一次 PR，避免依赖 step ①
  //         的结果。
  //    (5b) `authorization_decisions.id` 命中（本 capability 由 Kernel ctx 承接，
  //         正常路径下这条恒真；但把它写下来，让 append-only 表被误删或迁移出问题
  //         时能就地看见）。
  const expectedRunRef = `pr:${prep.repo_owner}/${prep.repo_name}#${opened.pr_number}`
  let runRefResolvable = false
  try {
    // 独立再取一次（跟 step ① 的 getPullRequestState 是不同一次网络往返）
    const again = await gh.getPullRequestState(prep.repo_owner, prep.repo_name, opened.pr_number)
    runRefResolvable = again.state === 'open' || again.state === 'closed'
  } catch (e) {
    // e 落到 detail
    record('output.run_reference 可反查', false, e instanceof Error ? e.message : String(e))
  }
  record('output.run_reference 可反查', runRefResolvable, expectedRunRef)

  const decisionOk = await loadDecisionExists(sb, args.decisionId)
  record('authorization_decisions 行可回读', decisionOk, decisionOk ? undefined : args.decisionId)

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
