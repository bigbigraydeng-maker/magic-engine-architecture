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

/**
 * 🔴 **孤儿 artefact 提示（fail-closed 兜底文案）。**
 *
 * Kernel Outward Hardening (#1108) 已把 provider-native rollback dispatch 落到 gateway；
 * 本 capability 也已注册 rollback handler（见文件下方 `rollbackHandler`）—— 正常路径下
 * dead_letter 会**自动**触发 close PR + delete branch。
 *
 * 但 rollback handler 本身可能因 provider 网络故障 / 权限撤销 / 契约违约而返回 ok:false；
 * 此时 gateway 会落 rollback lineage=failed。为让 PM 也能看到「哪个 PR / branch 悬着」，
 * capability 在抛错时仍在 humanReason / failure_reason 里带**直达链接**，作为
 * rollback failed 场景下的人工兜底。
 *
 * 🔴 **禁止把这段变成通用工具或迁到 kernel。** 通用 rollback 已由 #1108 承接，
 *    本函数只服务本 capability 的 human-visible fail-closed 兜底。
 */
function orphanArtefactHint(args: {
  repoOwner: string
  repoName: string
  branchName: string
  prNumber?: number
  prUrl?: string
}): string {
  // 🔴 防御：owner / repo / branch 必须命中 GitHub slug 合法字符集，否则拒绝
  //    渲染孤儿链接（改回一段无 URL 的告警）。这样即便 cms_connections 里塞了
  //    带斜杠的攻击性 owner（e.g. `attacker/repo`），也不会拼出一条指向攻击者
  //    仓库的可点链接。handoff.ts 里那道 URL 抽取器也严格校验一次，
  //    双保险。
  const OWNER_OK = /^[A-Za-z0-9-]{1,39}$/
  const REPO_OK = /^[A-Za-z0-9._-]{1,100}$/
  const BRANCH_OK = /^[A-Za-z0-9._/-]{1,255}$/
  if (
    !OWNER_OK.test(args.repoOwner) ||
    !REPO_OK.test(args.repoName) ||
    !BRANCH_OK.test(args.branchName)
  ) {
    return (
      '\n⚠️ 客户 GitHub 仓库可能残留孤儿 artefact（v1 不自动撤回，需手工清理）；' +
      '仓库标识含非法字符，未渲染直达链接 —— 请查 client cms_connections 配置。'
    )
  }
  const branchUrl =
    `https://github.com/${args.repoOwner}/${args.repoName}/tree/${args.branchName}`
  const lines = [
    '',
    '⚠️ 客户 GitHub 仓库残留孤儿 artefact（v1 不自动撤回，需手工清理）：',
  ]
  if (args.prNumber !== undefined && args.prUrl) {
    lines.push(`  - Close 掉 Draft PR #${args.prNumber}：${args.prUrl}`)
  }
  lines.push(`  - 删除分支：${branchUrl}`)
  return lines.join('\n')
}

// ── Input shape (populated from ctx.runInput —— deep-frozen by Gateway hash-check) ──
//
// 🔴 **不许**从 `action_runs.input` 回读。#1108 Kernel Outward Hardening 把
//    执行输入沉进 `CapabilityStepContext.runInput`，Gateway 已按授权时的 hash
//    校验过一次并深冻结。capability 再走 supabase 读 `input` 就是 TOCTOU 漏洞
//    （Gateway 通过后 attacker UPDATE input → capability 读到污染值）。
//    见 `src/lib/kernel/types.ts::CapabilityStepContext.runInput`。
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

// ── Run receipt markers（写进 commit message / PR body，用于**所有权证明**） ──
//
// 🔴 复审 2026-08-20 P0（review block）：branch 名按 input 派生是**必要非充分**的
//    所有权证明 —— 客户仓库里恰好有个同前缀分支就会被 422 幂等接管；同 head 上
//    别人恰好开了个 PR 就会被 open_pr 422 fallback 采用。
//
//    真正的**所有权凭据** = 我们在 commit message 与 PR body 里写的 run receipt
//    marker（`kernel_run_id: <runId>` + `authorization_decision_id: <decisionId>`）。
//    任何 close/adopt/delete 路径都必须**先证明目标 artefact 带着我们的 marker**，
//    否则一律 fail-closed。
function commitMessageMarker(runId: string): string {
  return `[kernel run ${runId}]`
}

function commitMessageOwnedByRun(message: string, runId: string): boolean {
  return message.includes(commitMessageMarker(runId))
}

function prReceiptMarkers(runId: string, decisionId: string): { runIdLine: string; decisionIdLine: string } {
  return {
    runIdLine: `- kernel_run_id: ${runId}`,
    decisionIdLine: `- authorization_decision_id: ${decisionId}`,
  }
}

function prBodyOwnedByRun(body: string, runId: string, decisionId: string): boolean {
  const { runIdLine, decisionIdLine } = prReceiptMarkers(runId, decisionId)
  return body.includes(runIdLine) && body.includes(decisionIdLine)
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

    // 🔴 复审 2026-08-20 P0：existing-ref 422 必须证明分支**属于本 run**，不能
    //    因为「同名分支存在」就默认幂等接管。合法只有两种情形：
    //      (i)  分支已经在本 run 的**上一次尝试**中被创建但 commit 前挂了 →
    //           分支 tip commit SHA === 本次刚读到的 baseSha（无提交，纯 branch）。
    //      (ii) 分支已经在本 run 的**上一次尝试**中被创建并已成功 commit →
    //           分支 tip commit message 里带 `[kernel run <runId>]` marker。
    //    其余（包括「攻击者预先建了同名分支，指向别的 base」/「客户手工建的同名
    //    分支」）→ 视为 not-owned，抛 INVALID_STATE fail-closed，绝不 adopt。
    let existingTipSha = ''
    try {
      existingTipSha = await gh.getBranchSha(prep.repo_owner, prep.repo_name, prep.branch_name)
    } catch (readErr) {
      // 读不到（比如 race deleted）→ 保守视为无法证明，fail-closed
      throw new KernelError(
        'INVALID_STATE',
        `createBranch 报"已存在"但回读 branch SHA 失败：${readErr instanceof Error ? readErr.message : String(readErr)}` +
          orphanArtefactHint({
            repoOwner: prep.repo_owner,
            repoName: prep.repo_name,
            branchName: prep.branch_name,
          }),
        {
          detail: {
            reason: 'existing_branch_ownership_indeterminate',
            createBranchError: msg,
            orphanBranch: prep.branch_name,
            orphanBranchUrl:
              `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
          },
        },
      )
    }

    const isFreshFromBase = existingTipSha === baseSha
    let hasOurCommitMarker = false
    if (!isFreshFromBase) {
      try {
        const tip = await gh.getCommit(prep.repo_owner, prep.repo_name, existingTipSha)
        hasOurCommitMarker = commitMessageOwnedByRun(tip.message, args.runId)
      } catch {
        // 读不到 commit → 保守视为不属于我们
        hasOurCommitMarker = false
      }
    }
    if (!isFreshFromBase && !hasOurCommitMarker) {
      throw new KernelError(
        'INVALID_STATE',
        `existing_branch_not_owned_by_run：branch ${prep.branch_name} 已存在但 tip commit ` +
          `既不是 base HEAD 也不带本 run marker —— 不 adopt，避免破坏客户已有分支` +
          orphanArtefactHint({
            repoOwner: prep.repo_owner,
            repoName: prep.repo_name,
            branchName: prep.branch_name,
          }),
        {
          detail: {
            reason: 'existing_branch_not_owned_by_run',
            branchTipSha: existingTipSha,
            baseSha,
            orphanBranch: prep.branch_name,
            orphanBranchUrl:
              `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
          },
        },
      )
    }
    // isFreshFromBase → 本 run 上次 createBranch 成功但 commit 前挂了 → 可以 commit
    // hasOurCommitMarker → 本 run 上次已 commit → commitFile 会走幂等或真 stale 判据
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
          '需要重跑 pipeline 从新 snapshot 出发' +
          orphanArtefactHint({
            repoOwner: prep.repo_owner,
            repoName: prep.repo_name,
            branchName: prep.branch_name,
          }),
        {
          detail: {
            commitFileError: msg,
            orphanBranch: prep.branch_name,
            orphanBranchUrl:
              `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
          },
        },
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
    // 🔴 到 open_pr 时 commit_created:true 已成立 → branch 一定在客户仓库
    //    存在。conn 中途消失（token 被吊销 / cms_connections 被删）也必须带
    //    orphan hint 让 PM 手工去关。
    throw new KernelError(
      'INVALID_INPUT',
      '客户 GitHub 连接消失（open_pr 阶段）' +
        orphanArtefactHint({
          repoOwner: prep.repo_owner,
          repoName: prep.repo_name,
          branchName: prep.branch_name,
        }),
      {
        detail: {
          orphanBranch: prep.branch_name,
          orphanBranchUrl:
            `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
        },
      },
    )
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

  // 🔴 复审 2026-08-20 P0：不再"list open PRs by head 取第一个"。
  //    每一条路径（happy path 与 422 recovery）都必须通过 getPullRequestDetail
  //    验证 draft/state/head/base/body receipt 全部符合本 run。
  let prNumber: number
  let prUrl: string
  try {
    const created = await gh.createPullRequest(prep.repo_owner, prep.repo_name, {
      title: `chore(page): apply optimization on ${prep.content_path}`,
      body,
      head: prep.branch_name,
      base: prep.default_branch,
      draft: true,
    })
    prNumber = created.number
    prUrl = created.html_url
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 幂等恢复：同 head → base 上 PR 已存在时 GitHub 返回 422，且该状态**永远**不会
    // 随时间改变（这不是可重试错误）。查已有 PR **并逐项核对 receipt**；不符 = fail-closed。
    if (/422|already/i.test(msg)) {
      let candidates: Array<{ number: number; html_url: string }>
      try {
        candidates = await gh.listPullRequestsByHead(prep.repo_owner, prep.repo_name, prep.branch_name)
      } catch (lookupErr) {
        throw new KernelError(
          'INVALID_STATE',
          `pr_open_failed：createPullRequest 报"已存在"但查询也失败：${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}` +
            orphanArtefactHint({
              repoOwner: prep.repo_owner,
              repoName: prep.repo_name,
              branchName: prep.branch_name,
            }),
          {
            detail: {
              originalError: msg,
              orphanBranch: prep.branch_name,
              orphanBranchUrl:
                `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
            },
          },
        )
      }

      // 逐个候选调 getPullRequestDetail 核对 draft/open/head/base/body 全部符合。
      // 只有全部命中的才被 adopt；一个都不命中 → fail-closed（**绝不**默认取第一个）。
      let adopted: { number: number; html_url: string } | null = null
      for (const cand of candidates) {
        let detail
        try {
          detail = await gh.getPullRequestDetail(prep.repo_owner, prep.repo_name, cand.number)
        } catch {
          continue
        }
        if (
          detail.draft === true &&
          detail.state === 'open' &&
          detail.merged === false &&
          detail.headRef === prep.branch_name &&
          detail.baseRef === prep.default_branch &&
          prBodyOwnedByRun(detail.body, args.runId, args.decisionId)
        ) {
          adopted = { number: detail.number, html_url: detail.htmlUrl }
          break
        }
      }

      if (!adopted) {
        throw new KernelError(
          'INVALID_STATE',
          `pr_open_failed：createPullRequest 报"已存在"但按 head=${prep.branch_name} ` +
            `找不到 draft+open+head+base+receipt 全对的 PR —— **拒绝 adopt 不属于本 run 的 PR**` +
            orphanArtefactHint({
              repoOwner: prep.repo_owner,
              repoName: prep.repo_name,
              branchName: prep.branch_name,
            }),
          {
            detail: {
              originalError: msg,
              reason: 'existing_pr_not_owned_by_run',
              candidatesInspected: candidates.length,
              orphanBranch: prep.branch_name,
              orphanBranchUrl:
                `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
            },
          },
        )
      }
      prNumber = adopted.number
      prUrl = adopted.html_url
    } else {
      throw new RetryableCapabilityError(
        `pr_open_failed：${msg}` +
          orphanArtefactHint({
            repoOwner: prep.repo_owner,
            repoName: prep.repo_name,
            branchName: prep.branch_name,
          }),
      )
    }
  }

  // 🔴 happy-path 也再回读一次 detail 做**创建后自检**：draft/head/base/body 全部
  //    符合本 run。这一次读同时挡住"createPullRequest 网络模糊成功但实际返回了
  //    错误对象"或"GitHub 返回了别的 PR"的 provider 契约违约。
  let detail
  try {
    detail = await gh.getPullRequestDetail(prep.repo_owner, prep.repo_name, prNumber)
  } catch (readErr) {
    // 读不到 → 可能 PR 其实没建成功；保守走 retryable
    throw new RetryableCapabilityError(
      `pr_open_readback_failed：${readErr instanceof Error ? readErr.message : String(readErr)}` +
        orphanArtefactHint({
          repoOwner: prep.repo_owner,
          repoName: prep.repo_name,
          branchName: prep.branch_name,
        }),
    )
  }
  const receiptOk =
    detail.draft === true &&
    detail.state === 'open' &&
    detail.merged === false &&
    detail.headRef === prep.branch_name &&
    detail.baseRef === prep.default_branch &&
    prBodyOwnedByRun(detail.body, args.runId, args.decisionId)
  if (!receiptOk) {
    throw new KernelError(
      'INVALID_STATE',
      `pr_open_receipt_mismatch：新开或 adopt 的 PR #${prNumber} receipt 不符（` +
        `draft=${detail.draft} state=${detail.state} merged=${detail.merged} ` +
        `head=${detail.headRef} base=${detail.baseRef}）—— 拒绝把它当成本 run 的产出` +
        orphanArtefactHint({
          repoOwner: prep.repo_owner,
          repoName: prep.repo_name,
          branchName: prep.branch_name,
          prNumber,
          prUrl,
        }),
      {
        detail: {
          reason: 'pr_receipt_mismatch',
          prNumber,
          prUrl,
          expectedHead: prep.branch_name,
          expectedBase: prep.default_branch,
          actualHead: detail.headRef,
          actualBase: detail.baseRef,
          actualDraft: detail.draft,
          actualState: detail.state,
          orphanBranch: prep.branch_name,
          orphanBranchUrl:
            `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
        },
      },
    )
  }

  const output: OpenPrOutput = { pr_number: prNumber, pr_url: prUrl }
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
    // 🔴 到 record 时 prep + opened 都成立 → branch + Draft PR 都在客户仓库。
    //    conn 消失也要让 PM 收到 orphan 直达链接。
    throw new KernelError(
      'INVALID_INPUT',
      '客户 GitHub 连接消失（record 阶段）' +
        orphanArtefactHint({
          repoOwner: prep.repo_owner,
          repoName: prep.repo_name,
          branchName: prep.branch_name,
          prNumber: opened.pr_number,
          prUrl: opened.pr_url,
        }),
      {
        detail: {
          orphanBranch: prep.branch_name,
          orphanBranchUrl:
            `https://github.com/${prep.repo_owner}/${prep.repo_name}/tree/${prep.branch_name}`,
          orphanPrNumber: opened.pr_number,
          orphanPrUrl: opened.pr_url,
        },
      },
    )
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
  //    RetryableCapabilityError（会跳过 verification 汇总 + orphan hint），
  //    改成落一条 failed check。这样一来无论 Supabase 瞬时错还是 decision
  //    行真丢，都走 verification failed 路径，failure_reason 里带 orphan URL。
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
          // 🔴 record 阶段失败时，PR + branch 都已经存在于客户仓库。
          //    gateway.ts:886 会把这段 failure_reason 包进 VERIFICATION_FAILED 的
          //    humanReason，进 run.last_error，进今日待办 —— 必须带直达链接。
          failure_reason:
            failed
              .map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`)
              .join('；') +
            orphanArtefactHint({
              repoOwner: prep.repo_owner,
              repoName: prep.repo_name,
              branchName: prep.branch_name,
              prNumber: opened.pr_number,
              prUrl: opened.pr_url,
            }),
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
  _priorOutputsArg: Readonly<Record<string, Record<string, unknown>>>,
): Promise<OutwardRollbackResult> {
  // 🔴 Gateway 传两次 priorOutputs（`rollbackStepContext.priorOutputs` 与 second arg）——
  //    两个值相同，但**永远**以 `step.priorOutputs` 为准（跟 CapabilityStepHandler
  //    的读法一致，避免"读了 second arg 但没读 step 里的"这类不一致隐 bug）。
  const priorOutputs = step.priorOutputs
  const prep = priorOutputs.prepare as unknown as PrepareOutput | undefined
  const opened = priorOutputs.open_pr as unknown as OpenPrOutput | undefined
  const commit = priorOutputs.commit as unknown as CommitOutput | undefined

  const runId = step.ctx.runId
  const decisionId = step.ctx.decisionId

  // ── prepare 都没跑 → provider 零副作用 → 真 noop ────────────────────────────
  if (!prep) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { reason: 'prepare 未完成，provider 零副作用' },
    }
  }
  // ── 身份三闸（在任何 live 调用之前，先挡住 priorOutputs 被污染的场景）────
  const OWNED_BRANCH_RE = /^me\/page-apply\/[0-9a-f]{24}$/
  if (!OWNED_BRANCH_RE.test(prep.branch_name)) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { branch_name: prep.branch_name, reason: 'branch_prefix_not_owned' },
      failure_reason:
        `拒绝 rollback：branch_name 不符合 me/page-apply/<24hex> —— ` +
        `不属于本 capability owned 前缀，可能是 priorOutputs 被污染`,
    }
  }
  let expectedBranch: string
  try {
    const ri = parseRunInput(step.runInput)
    const idKey = idempotencyKeyFromInput(ri.page_url, ri.page_version_token, ri.validated_diff_hash)
    expectedBranch = branchNameForRun(idKey)
  } catch (e) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { thrown: e instanceof Error ? e.message : String(e), reason: 'run_input_shape_invalid' },
      failure_reason: `拒绝 rollback：ctx.runInput 形状不对，无法自检 branch identity`,
    }
  }
  if (expectedBranch !== prep.branch_name) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { prior_branch: prep.branch_name, expected: expectedBranch, reason: 'branch_not_derived_from_runinput' },
      failure_reason:
        `拒绝 rollback：prep.branch_name 跟 ctx.runInput 重算不一致 —— 不属于本 run`,
    }
  }

  // ── 拿 provider client ─────────────────────────────────────────────────
  const conn = await deps.resolveGithubConnection(step.ctx.clientId)
  if (!conn) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { clientId: step.ctx.clientId, reason: 'connection_missing' },
      failure_reason: `拒绝 rollback：客户 GitHub 连接消失，无法执行 provider-native rollback`,
    }
  }
  const gh = deps.createGithubClient(conn.plainToken)

  const detail: Record<string, unknown> = {
    branch_name: prep.branch_name,
    repo: `${prep.repo_owner}/${prep.repo_name}`,
    kernel_run_id: runId,
  }

  // ── 🔴 (LIVE-1) 拉 live default_branch。绝不信 prep.default_branch（可能污染）──
  let liveDefaultBranch: string
  try {
    const repoInfo = await gh.getRepo(prep.repo_owner, prep.repo_name)
    liveDefaultBranch = repoInfo.default_branch
    detail.live_default_branch = liveDefaultBranch
  } catch (e) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'live_default_read_failed' },
      failure_reason: `拒绝 rollback：无法读 live default_branch：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (prep.branch_name === liveDefaultBranch) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'branch_equals_live_default' },
      failure_reason: `拒绝 rollback：branch_name === live default_branch (${liveDefaultBranch})，绝不能删`,
    }
  }

  // ── 🔴 (LIVE-2) 真的看 provider 端到底有没有 artefact 悬着 —— 不信 priorOutputs
  //    是否完整就报 noop。这挡"prepare-only / commit-only / network-fuzzy-success
  //    → 报告 noop 但实际留了资源"的 P0。
  //
  //    先看 branch 存不存在（getBranchSha 404 = 不存在）。不在 → 顺便看看有没有
  //    以本 head 名的 PR 也悬着（残留 PR 但 branch 已删的病态）。
  let branchTipSha: string | null = null
  try {
    branchTipSha = await gh.getBranchSha(prep.repo_owner, prep.repo_name, prep.branch_name)
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) {
      branchTipSha = null
    } else {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'live_branch_read_failed' },
        failure_reason: `拒绝 rollback：读 live branch SHA 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
  detail.live_branch_present = branchTipSha !== null

  // ── 🔴 (LIVE-3) branch 若存在，验它是不是本 run 拥有的
  //    合法：tip 是当初 stepPrepare 拿到的 page_version_token（fresh branch，未 commit）
  //    合法：tip commit message 含 `[kernel run <runId>]` marker（本 run 已 commit）
  //    否则：不 delete，fail-closed。
  let branchOwnedByThisRun = false
  if (branchTipSha !== null) {
    if (branchTipSha === prep.page_version_token) {
      branchOwnedByThisRun = true
      detail.branch_ownership = 'tip_equals_page_version_token'
    } else {
      try {
        const tip = await gh.getCommit(prep.repo_owner, prep.repo_name, branchTipSha)
        if (commitMessageOwnedByRun(tip.message, runId)) {
          branchOwnedByThisRun = true
          detail.branch_ownership = 'tip_has_run_marker'
        } else {
          detail.branch_ownership = 'tip_missing_run_marker'
        }
      } catch {
        detail.branch_ownership = 'tip_commit_read_failed'
      }
    }
  }

  // ── 🔴 (LIVE-4) PR receipt 校验。分两种输入：
  //    (a) opened priorOutput 存在（happy path 或崩溃恢复知道 pr_number）
  //    (b) opened 不存在但 branch live → 也查 head 上是否有孤儿 PR 挂着
  interface PrCandidate { number: number; htmlUrl: string; state: 'open' | 'closed'; merged: boolean; mergedAt: string | null; draft: boolean; headRef: string; baseRef: string; body: string }
  const prsToClose: PrCandidate[] = []
  const mergedBlockers: PrCandidate[] = []

  const inspectPr = async (prNumber: number): Promise<PrCandidate | 'notfound' | 'skip'> => {
    let pd
    try {
      pd = await gh.getPullRequestDetail(prep.repo_owner, prep.repo_name, prNumber)
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) return 'notfound'
      throw e
    }
    return {
      number: pd.number, htmlUrl: pd.htmlUrl, state: pd.state, merged: pd.merged,
      mergedAt: pd.mergedAt, draft: pd.draft, headRef: pd.headRef, baseRef: pd.baseRef, body: pd.body,
    }
  }

  const classifyOwned = (pd: PrCandidate): 'owned_open' | 'owned_closed' | 'merged' | 'not_owned' => {
    if (pd.merged === true) return 'merged'
    const receiptOk =
      pd.headRef === prep.branch_name &&
      pd.baseRef === liveDefaultBranch &&
      prBodyOwnedByRun(pd.body, runId, decisionId)
    if (!receiptOk) return 'not_owned'
    return pd.state === 'closed' ? 'owned_closed' : 'owned_open'
  }

  if (opened) {
    detail.pr_number = opened.pr_number
    detail.pr_url = opened.pr_url
    let pd
    try {
      pd = await inspectPr(opened.pr_number)
    } catch (e) {
      return {
        ok: false,
        rollbackKind: 'provider_native',
        detail: { ...detail, reason: 'live_pr_read_failed' },
        failure_reason: `拒绝 rollback：读 PR #${opened.pr_number} 失败：${e instanceof Error ? e.message : String(e)}`,
      }
    }
    if (pd === 'notfound') {
      detail.pr_state_by_opened = '404_not_found'
    } else if (pd !== 'skip') {
      const cls = classifyOwned(pd)
      detail.pr_receipt_classification = cls
      if (cls === 'merged') mergedBlockers.push(pd)
      else if (cls === 'owned_open') prsToClose.push(pd)
      else if (cls === 'owned_closed') detail.pr_state_by_opened = 'already_closed_ok'
      else /* not_owned */ {
        return {
          ok: false,
          rollbackKind: 'provider_native',
          detail: {
            ...detail,
            reason: 'pr_not_owned_by_run',
            pr_head: pd.headRef, pr_base: pd.baseRef, expected_head: prep.branch_name,
            expected_base: liveDefaultBranch,
          },
          failure_reason:
            `拒绝 rollback：PR #${opened.pr_number} 存在但 head/base/body receipt 不符本 run —— ` +
            `绝不 close 不属于本 run 的 PR`,
        }
      }
    }
  }

  // 无论 opened 是否给了 pr_number，都去 head 上再列一次；处理"opened 缺失但网络
  // 模糊成功已经开了 PR"或"opened 里的 pr_number 已经 404 但同 head 又开了新 PR"
  // 等真实场景。
  let candidates: Array<{ number: number; html_url: string }> = []
  try {
    candidates = await gh.listPullRequestsByHead(prep.repo_owner, prep.repo_name, prep.branch_name)
  } catch (e) {
    // list 失败不算 fatal（可能 rate limit）；标记 detail 让 PM 兜底
    detail.list_head_prs = `failed: ${e instanceof Error ? e.message : String(e)}`
  }
  for (const cand of candidates) {
    if (opened && cand.number === opened.pr_number) continue // 已在上面查过
    let pd
    try {
      pd = await inspectPr(cand.number)
    } catch (e) {
      // 单条读失败不阻断整体，记 detail
      detail[`pr_${cand.number}_read`] = `failed: ${e instanceof Error ? e.message : String(e)}`
      continue
    }
    if (pd === 'notfound' || pd === 'skip') continue
    const cls = classifyOwned(pd)
    if (cls === 'merged') mergedBlockers.push(pd)
    else if (cls === 'owned_open') prsToClose.push(pd)
    // owned_closed / not_owned → 不动
  }

  // ── 有 merged PR 撞到本 run 的 head → 硬拒 close & 拒删分支 ─────────────
  if (mergedBlockers.length > 0) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: {
        ...detail, reason: 'merged_pr_on_owned_head',
        merged_prs: mergedBlockers.map((p) => ({ number: p.number, mergedAt: p.mergedAt })),
      },
      failure_reason:
        `拒绝 rollback：本 run 的 head=${prep.branch_name} 上挂着已 merge 的 PR ` +
        `(${mergedBlockers.map((p) => `#${p.number}`).join(',')})，v1 不做 post-merge revert；分支也不删`,
    }
  }

  // ── 若 branch 存在但被别人 commit（不带 marker），既不 delete 也不算 noop：
  //    这是"我们造了 branch → 客户 / 别人接手推了 commit"的场景。fail-closed。
  if (branchTipSha !== null && !branchOwnedByThisRun) {
    return {
      ok: false,
      rollbackKind: 'provider_native',
      detail: { ...detail, reason: 'branch_tampered_not_owned', branch_tip: branchTipSha },
      failure_reason:
        `拒绝 rollback：branch ${prep.branch_name} 存在，但 tip 既非 page_version_token ` +
        `也不带本 run marker —— 有第三方推过 commit，不 delete`,
    }
  }

  // ── 无 provider 副作用（branch 不在 且 无本 run 相关的 PR）→ 真 noop ───
  if (branchTipSha === null && prsToClose.length === 0 && (!opened || detail.pr_state_by_opened === '404_not_found')) {
    return {
      ok: true,
      rollbackKind: 'noop',
      detail: { ...detail, reason: 'live_check_shows_zero_side_effect' },
    }
  }

  // ── 至此：有需要撤的资源。close 所有本 run 拥有的 open PR；然后 delete branch ──
  const closedPrs: number[] = []
  for (const p of prsToClose) {
    try {
      await gh.closePullRequest(prep.repo_owner, prep.repo_name, p.number)
      closedPrs.push(p.number)
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        closedPrs.push(p.number) // 404 视为已撤
      } else {
        return {
          ok: false,
          rollbackKind: 'provider_native',
          detail: { ...detail, reason: 'close_pr_failed', pr_number: p.number, closed_so_far: closedPrs },
          failure_reason: `closePullRequest #${p.number} 失败：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  }
  detail.closed_prs = closedPrs

  // Delete branch —— 只在 branch **live 存在** 且 owned 时才调 deleteBranch。
  //   - branchTipSha === null（confirmed 404）→ 已经不存在，跳过（幂等）
  //   - branchOwnedByThisRun === true → 我们的分支，可删
  //   - 其他 tampered 场景已在上面 return 掉
  if (branchTipSha !== null && branchOwnedByThisRun) {
    try {
      await gh.deleteBranch(prep.repo_owner, prep.repo_name, prep.branch_name)
      detail.branch_state = 'deleted_by_rollback'
    } catch (e) {
      if (e instanceof GitHubApiError && e.status === 404) {
        // 竞态：读到 tip 时存在，delete 时已消失 —— 幂等 ok
        detail.branch_state = '404_at_delete'
      } else {
        return {
          ok: false,
          rollbackKind: 'provider_native',
          detail: { ...detail, reason: 'delete_branch_failed' },
          failure_reason: `deleteBranch 失败：${e instanceof Error ? e.message : String(e)}`,
        }
      }
    }
  } else if (branchTipSha === null) {
    detail.branch_state = 'already_absent'
  } else {
    // branchTipSha !== null 但 !branchOwnedByThisRun —— 上面 tampered 分支已 return，
    // 这条不会执行；保险处理。
    detail.branch_state = 'not_owned_not_deleted'
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
