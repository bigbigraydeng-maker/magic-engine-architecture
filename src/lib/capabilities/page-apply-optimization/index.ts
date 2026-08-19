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
  CapabilityStepContext,
  CapabilityStepResult,
  OutwardRollbackResult,
  VerificationResult,
} from '@/lib/kernel/types'
import { KernelError, RetryableCapabilityError } from '@/lib/kernel/errors'
import { GitHubApiError } from '@/lib/cms/github-client'
import type {
  GithubPageSnapshot,
  PageDiffResult,
  PageDraftResult,
  PageOptimizationField,
  PageOptimizationIntent,
} from '@/lib/page-optimization'
import {
  PAGE_OPTIMIZATION_FIELDS,
  draftPageChange,
  diffPageChange,
  extractGithubFieldValue,
} from '@/lib/page-optimization'
import { resolveStaticHtmlPath, patchStaticHtmlPage } from '@/lib/cms/static-html-page-upgrade'
import type { PageApplyOptimizationDeps } from './deps'
import { defaultDeps } from './deps'
import { branchNameForRun, canonicalDiffHash, idempotencyKeyFromInput } from './hash'

// ── Input shape (populated from ctx.runInput —— deep-frozen by Gateway hash-check) ──
//
// 🔴 **不许**从 `action_runs.input` 回读。#1108 Kernel Outward Hardening 把
//    执行输入沉进 `CapabilityStepContext.runInput`，Gateway 已按授权时的 hash
//    校验过一次并深冻结。capability 再走 supabase 读 `input` 就是 TOCTOU 漏洞
//    （Gateway 通过后 attacker UPDATE input → capability 读到污染值）。
//    见 `docs/specs/2026-08-19-me2-kernel-outward-execution-hardening-v1.0.md`
//    与 `src/lib/kernel/types.ts::CapabilityStepContext.runInput`。
//
//    本文件内**唯一**允许从 `ctx.runInput` 构造 RunInput 的路径 = `parseRunInput()`。
//    architecture-guard.test.ts 会静态扫本目录，禁止再次出现 `select('input')`。

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

/**
 * 🔴 从**已由 Gateway hash-check + 深度冻结**的 `ctx.runInput` 构造 RunInput。
 *
 *   纯函数、不查 DB —— 唯一入口，见上方 architecture-guard 说明。
 *   缺字段或类型不对 → `INVALID_INPUT` fail-closed（不许 RetryableCapabilityError
 *   —— Gateway 已经验过 hash，这里的缺字段是**代码 bug 或 schema 漂移**，重试
 *   永远不会好起来）。
 */
function parseRunInput(runInput: Readonly<Record<string, unknown>>): RunInput {
  const pageUrl = runInput.page_url
  const versionToken = runInput.page_version_token
  const diffHash = runInput.validated_diff_hash
  const intents = runInput.intents
  const doNotTouch = runInput.do_not_touch
  if (
    typeof pageUrl !== 'string' ||
    typeof versionToken !== 'string' ||
    typeof diffHash !== 'string' ||
    !Array.isArray(intents) ||
    !Array.isArray(doNotTouch)
  ) {
    throw new KernelError('INVALID_INPUT', '执行输入缺字段或类型不对（ctx.runInput）')
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
  deps: PageApplyOptimizationDeps,
  args: { runId: string; clientId: string; input: RunInput },
): Promise<CapabilityStepResult> {
  const input = args.input

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
      // (a) 真 stale：main 在 prepare 到 commit 之间移动过，OCC 拒绝。
      // branch 已经在上一步被创建（或以 idempotent 422 命中同名分支），是**孤儿**。
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
  if (!conn) {
    throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失（open_pr 阶段）')
  }

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
  args: { runId: string; clientId: string; decisionId: string; input: RunInput; priorOutputs: Readonly<Record<string, Record<string, unknown>>> },
): Promise<CapabilityStepResult> {
  const prep = args.priorOutputs.prepare as unknown as PrepareOutput | undefined
  const opened = args.priorOutputs.open_pr as unknown as OpenPrOutput | undefined
  if (!prep || !opened) throw new KernelError('INVALID_STATE', '前置步骤产物不齐')

  const conn = await deps.resolveGithubConnection(args.clientId)
  if (!conn) {
    throw new KernelError('INVALID_INPUT', '客户 GitHub 连接消失（record 阶段）')
  }

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
    // 🔴 do_not_touch 从 ctx.runInput（Gateway 已 hash-check + 深冻结）读，
    //    **绝不**回查 action_runs.input（TOCTOU；见文件顶部说明）。
    for (const field of args.input.do_not_touch) {
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

  // 🔴 子牙复审 (2026-08-19) 修正：loadDecisionExists 抛错时**不**外抛
  //    RetryableCapabilityError（会跳过 verification 汇总），改成落一条
  //    failed check。这样一来无论 Supabase 瞬时错还是 decision 行真丢，
  //    都走 verification failed 路径。
  let decisionOk = false
  try {
    decisionOk = await loadDecisionExists(sb, args.decisionId)
    record('authorization_decisions 行可回读', decisionOk, decisionOk ? undefined : args.decisionId)
  } catch (e) {
    record(
      'authorization_decisions 行可回读',
      false,
      `回读授权决策失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }

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

// ── Rollback handler (provider_native · GitHub Draft PR close + branch delete) ─
//
// 🔴 契约（`OutwardRollbackHandler`）由 #1108 Kernel Outward Hardening 冻结：
//    - 三态返回（provider_native ok=true/false、noop）
//    - Gateway 已在调本 handler **之前**查 `action_run_steps(step_key='rollback')` lineage；
//      命中即跳过 handler → 本 handler **只**处理"第一次真调用"和"崩溃后接管重调"
//    - 幂等义务：同 run 多次调用不许把 provider 弄坏
//    - 抛异常 = failed（Gateway 会 catch 并落 lineage）；handler **禁抛** RetryableCapabilityError
//
// 🔴 Rollback 目标 identity **只**来自：
//    (a) 上游 step 的 priorOutputs（deterministic branchName + pr_number/url）
//    (b) `ctx.runInput`（deep-frozen；用于 branch prefix 校验的 idempotency 派生）
//    绝不从任何外部/caller-provided 数字读 PR number 或 branch name。
//
// 🔴 v1 只处理 GitHub。不建 provider abstraction —— 未来 WordPress 走**另一个**
//    action + 另一个 capability + 另一个 rollback handler，不是把本函数扩泛型。

async function rollbackHandler(
  deps: PageApplyOptimizationDeps,
  step: CapabilityStepContext,
  priorOutputs: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  const prep = priorOutputs.prepare as unknown as PrepareOutput | undefined
  const opened = priorOutputs.open_pr as unknown as OpenPrOutput | undefined
  const commit = priorOutputs.commit as unknown as CommitOutput | undefined

  // ── noop 快速路径：从没跑到会产生 provider 副作用的位置 ─────────────────────
  //    (a) 连 prepare 都没成 → 分支肯定没建
  //    (b) prepare 成了但 commit 也没成（i.e. stepCommit 抛错的位置在 createBranch
  //        之前）→ 分支未建。但 stepCommit 里 createBranch 是在 commit_created:true
  //        之前的**必经步骤**，只要 commit 没成，branch 可能已建或未建 —— 保守起见：
  //        没有 commit 记录 = 不去删可能不存在的分支（noop 更安全）。
  //    这两条都对应 provider 实际零副作用；返回 noop 让 Gateway 落一行明确 lineage。
  if (!prep) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: 'prepare 未完成，provider 零副作用' },
    }
  }
  if (!commit) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: {
        reason: 'commit step 未完成，无法确认是否已创建 branch；保守 noop',
        branch_name: prep.branch_name,
      },
    }
  }

  // ── 身份自检：防止 caller/attacker 塞入不属于本 run 的 branch/PR ───────────
  //
  // (1) branchName 必须是 `me/page-apply/<24-hex>` 形状。
  //     branchNameForRun() 用 sha256(page_url|page_version_token|validated_diff_hash) 前 24 位派生 ——
  //     可从 runInput 再算一次做严格自检。
  const OWNED_BRANCH_RE = /^me\/page-apply\/[0-9a-f]{24}$/
  if (!OWNED_BRANCH_RE.test(prep.branch_name)) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { branch_name: prep.branch_name },
      failure_reason:
        `拒绝 rollback：branch_name 不符合 me/page-apply/<24hex> —— ` +
        `不属于本 capability owned 前缀，可能是 priorOutputs 被污染`,
    }
  }
  // (2) branchName 派生必须与 ctx.runInput 重算一致（TOCTOU 二次防线）
  let expectedBranch: string
  try {
    const ri = parseRunInput(step.runInput)
    const idKey = idempotencyKeyFromInput(ri.page_url, ri.page_version_token, ri.validated_diff_hash)
    expectedBranch = branchNameForRun(idKey)
  } catch (e) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { thrown: e instanceof Error ? e.message : String(e) },
      failure_reason: `拒绝 rollback：ctx.runInput 形状不对，无法自检 branch identity`,
    }
  }
  if (expectedBranch !== prep.branch_name) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { prior_branch: prep.branch_name, expected: expectedBranch },
      failure_reason:
        `拒绝 rollback：prep.branch_name 跟 ctx.runInput 重算不一致 —— 不属于本 run`,
    }
  }
  // (3) 绝不能删默认分支
  if (prep.branch_name === prep.default_branch) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { branch_name: prep.branch_name, default_branch: prep.default_branch },
      failure_reason: `拒绝 rollback：branch_name === default_branch，绝不能删`,
    }
  }

  // ── 拿 provider client ──────────────────────────────────────────────────
  const conn = await deps.resolveGithubConnection(step.ctx.clientId)
  if (!conn) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { clientId: step.ctx.clientId },
      failure_reason: `拒绝 rollback：客户 GitHub 连接消失，无法执行 provider-native rollback`,
    }
  }
  const gh = deps.createGithubClient(conn.plainToken)

  const detail: Record<string, unknown> = {
    branch_name: prep.branch_name,
    repo: `${prep.repo_owner}/${prep.repo_name}`,
  }

  // ── (A) 如果有 PR：先 verify state → 未 merged 才可 close；merged 直接 fail-closed ──
  let prClosed = false
  if (opened) {
    detail.pr_number = opened.pr_number
    detail.pr_url = opened.pr_url

    let prState: { state: 'open' | 'closed'; merged: boolean; mergedAt: string | null } | null = null
    try {
      prState = await gh.getPullRequestState(prep.repo_owner, prep.repo_name, opened.pr_number)
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        // PR 已不存在 —— 视为已撤，走 branch 清理
        detail.pr_state = '404_not_found'
        prClosed = true
      } else {
        return {
          ok: false,
          rollbackKind: 'provider_native',
          detail,
          failure_reason: `getPullRequestState 失败：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }

    if (prState) {
      // 🔴 关键 fail-closed：PR 已 merge → 绝不 close、绝不 delete branch
      if (prState.merged === true) {
        return {
          ok: false,
          rollbackKind: 'provider_native',
          detail: { ...detail, pr_state: 'merged', merged_at: prState.mergedAt },
          failure_reason:
            `拒绝 rollback：Draft PR #${opened.pr_number} 已被合并，v1 不做 post-merge revert；` +
            `分支也**不**删（避免破坏 main 上已合的历史）；请人工判断`,
        }
      }
      // 已 closed 且未 merge → 幂等成功；否则 close 掉
      if (prState.state === 'closed') {
        detail.pr_state = 'already_closed'
        prClosed = true
      } else {
        try {
          await gh.closePullRequest(prep.repo_owner, prep.repo_name, opened.pr_number)
          detail.pr_state = 'closed_by_rollback'
          prClosed = true
        } catch (e) {
          if (e instanceof GitHubApiError && e.status === 404) {
            detail.pr_state = '404_on_close'
            prClosed = true
          } else {
            return {
              ok: false,
              rollbackKind: 'provider_native',
              detail,
              failure_reason: `closePullRequest 失败：${e instanceof Error ? e.message : String(e)}`,
            }
          }
        }
      }
    }
  } else {
    // 没有 open_pr priorOutput → 但 commit 已成 → 只需删分支
    detail.pr_state = 'never_opened'
  }

  // ── (B) 删分支：404 视为幂等成功；其它错误 fail ──────────────────────────
  try {
    await gh.deleteBranch(prep.repo_owner, prep.repo_name, prep.branch_name)
    detail.branch_state = 'deleted_by_rollback'
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) {
      detail.branch_state = '404_not_found'
    } else {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { ...detail, pr_closed: prClosed },
        failure_reason: `deleteBranch 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  return { ok: true, rollbackKind: 'provider_native', detail }
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
      async prepare({ ctx, runInput }) {
        return stepPrepare(deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          input: parseRunInput(runInput),
        })
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
      async record({ ctx, runInput, priorOutputs }) {
        return stepRecord(sb, deps, {
          runId: ctx.runId,
          clientId: ctx.clientId,
          decisionId: ctx.decisionId,
          input: parseRunInput(runInput),
          priorOutputs,
        })
      },
    },
    rollback: (step, priorOutputs) => rollbackHandler(deps, step, priorOutputs),
  }
}
