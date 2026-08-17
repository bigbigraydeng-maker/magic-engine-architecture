/**
 * 同步执行器:full(cron/manual 全量对账)与 targeted(webhook 单号码)两种模式。
 *
 * last-known-good 语义:抓取失败/限流未尝试的号码不进 commit 参数(旧行原样保留),
 * 只记 stats.failedItems;限流中止时**已抓到的照常落库**(provider 的限流契约保证
 * 成果不丢),run 标 partial。单调守卫在 RPC 内,这里只汇总 skippedStale。
 *
 * 未分类收编 = 显式确认制:对存量未分类行逐个复核(closed 或已分类才进 resolve
 * 名单),绝不做「本轮没扫到 = 已收编」的反推。
 */

import { buildProductMapSnapshot, EMPTY_EXTERNAL_FACTS, PRODUCT_MAP_COMPONENTS } from '@/lib/product-map'
import { buildPresentation } from '@/lib/product-map/presenter'
import { rowsToExternalFacts } from './facts-adapter'
import { extractComponentMarkers, isUnclassified } from './marker'
import type { GithubReadProvider } from './provider'
import type { ProductMapSyncStore, SummaryWrite } from './store'
import type { SummaryGenerator } from './summary-generator'
import { containsForbiddenStatusWord } from './summary-generator'
import type {
  IssueFactRow,
  PrFactDetail,
  PrFactRow,
  SyncMode,
  SyncRunRow,
  SyncStats,
  SyncTrigger,
} from './types'
import { NotProvisionedError } from './types'

const DELIVERY_RETENTION_DAYS = 90
const UNCLASSIFIED_SCAN_DAYS = 30

// ---------------------------------------------------------------------------
// 摘要生成 + 每日进度快照 —— 都发生在 commitSync 之后,失败不许拖垮 facts 落库
// (子牙 + 魏征设计审共同要求:独立预算、独立 try/catch、结果记账不静默)
// ---------------------------------------------------------------------------

/** 摘要阶段自己的固定预算切片 —— 不看 GitHub 抓取用了多少,直接给保守上限,
 *  远小于 route.ts 的 300s 总预算,不会顶到边界(子牙设计审)。*/
const SUMMARY_PHASE_BUDGET_MS = 60_000
/** 每轮硬顶 —— 注册表一次性大改动导致大量号码涌入时,分多天摊销而不是一次打爆
 *  (子牙设计审「成本/频率」必改项)。 */
const SUMMARY_MAX_ITEMS_PER_RUN = 25

export interface SyncRunResult {
  readonly runId: string
  readonly status: SyncRunRow['status']
  readonly stats: SyncStats
}

interface RunnerDeps {
  readonly provider: GithubReadProvider
  readonly store: ProductMapSyncStore
  readonly newRunId: () => string
  readonly now: () => string
  /** 未提供 = 摘要功能整体跳过(不影响 facts 同步),route 层决定要不要接真实现。 */
  readonly summarizer?: SummaryGenerator
  /** 测试注入用,覆盖 SUMMARY_PHASE_BUDGET_MS(默认 60s,真实场景不用传)。 */
  readonly summaryPhaseBudgetMs?: number
}

function registryPrNumbers(): Set<number> {
  const set = new Set<number>()
  for (const c of PRODUCT_MAP_COMPONENTS) for (const pr of c.linkedPullRequests) set.add(pr.number)
  return set
}

function registryIssueNumbers(): Set<number> {
  const set = new Set<number>()
  for (const c of PRODUCT_MAP_COMPONENTS) for (const n of c.linkedIssues) set.add(n)
  return set
}

function toPrRow(f: PrFactDetail): Omit<PrFactRow, 'sync_run_id' | 'human_summary' | 'human_summary_generated_at'> {
  return {
    pr_number: f.number,
    state: f.state,
    is_draft: f.isDraft,
    base_ref: f.baseRef,
    head_sha: f.headSha,
    merged_commit_sha: f.mergedCommitSha,
    mergeable_state: f.mergeableState,
    unresolved_threads: f.unresolvedThreads,
    checks: { sha: f.headSha, checks: f.checks, truncated: f.checksTruncated },
    changed_files: f.changedFiles,
    changed_files_truncated: f.changedFilesTruncated,
    title: f.title,
    observed_at: f.observedAt,
  }
}

/**
 * 摘要生成阶段:补齐 human_summary 为 null 的行,独立预算+硬顶,失败绝不外抛。
 * 🔴 判定集合从**重新查库**取(不是本轮刚抓到的那批)—— 覆盖两类来源:
 *    今天新出现的号码,以及之前某轮因预算耗尽/失败而留下的陈年 null 行,
 *    两者都满足同一个"IS NULL 就该补"的幂等判据,不需要分开处理。
 */
async function generateMissingSummaries(
  deps: RunnerDeps,
): Promise<{ generated: number; failed: number; rejected: number; skippedBudget: number }> {
  const empty = { generated: 0, failed: 0, rejected: 0, skippedBudget: 0 }
  if (!deps.summarizer) return empty // 未接大模型 = 功能整体跳过,不算失败

  const [prRows, issueRows] = await Promise.all([deps.store.readPrFacts(), deps.store.readIssueFacts()])
  const candidates: { kind: 'pr' | 'issue'; number: number; title: string }[] = [
    ...prRows.filter((r) => r.human_summary === null).map((r) => ({ kind: 'pr' as const, number: r.pr_number, title: r.title })),
    ...issueRows.filter((r) => r.human_summary === null).map((r) => ({ kind: 'issue' as const, number: r.issue_number, title: r.title })),
  ]
  if (candidates.length === 0) return empty

  const budgetMs = deps.summaryPhaseBudgetMs ?? SUMMARY_PHASE_BUDGET_MS
  const phaseStart = Date.now()
  const capped = candidates.slice(0, SUMMARY_MAX_ITEMS_PER_RUN)
  const skippedBudget = candidates.length - capped.length // 硬顶砍掉的部分,同样算"留给下一轮"

  const writes: SummaryWrite[] = []
  let generated = 0
  let failed = 0
  let rejected = 0
  let budgetExhausted = false

  for (const c of capped) {
    if (Date.now() - phaseStart > budgetMs) {
      budgetExhausted = true
      break
    }
    const summary = await deps.summarizer.summarize(c.kind, c.title)
    if (summary === null) {
      failed++
      continue
    }
    if (containsForbiddenStatusWord(summary)) {
      rejected++ // 护栏生效,不是调用失败 —— 单独计数,留 null 等下轮重试
      continue
    }
    writes.push({ kind: c.kind, number: c.number, summary, generatedAt: deps.now() })
    generated++
  }

  if (writes.length > 0) {
    try {
      await deps.store.writeSummaries(writes)
    } catch {
      // 生成成功但落库失败 —— 这批全部退回"失败",不装懂已经写成功了多少
      return { generated: 0, failed: failed + generated, rejected, skippedBudget }
    }
  }

  const budgetSkipped = budgetExhausted ? capped.length - generated - failed - rejected : 0
  return { generated, failed, rejected, skippedBudget: skippedBudget + budgetSkipped }
}

/**
 * 每日进度快照:复用 buildPresentation 算出的 buckets/成熟度分布(不另开推导),
 * 用 run_started_at 做并发护栏(魏征设计审)。只在 full 轮调用,失败不外抛。
 */
async function writeProgressSnapshot(
  deps: RunnerDeps,
  runId: string,
  startedAt: string,
): Promise<boolean> {
  const freshPrRows = await deps.store.readPrFacts()
  const synced = rowsToExternalFacts(freshPrRows, null)
  const facts = synced?.facts ?? EMPTY_EXTERNAL_FACTS
  const snapshot = buildProductMapSnapshot(facts)
  const presentation = buildPresentation({
    snapshot,
    loadOutcome: 'ok',
    latestRun: null,
    lastFullRunAt: null,
    prFacts: [],
    issueFacts: [],
    unclassified: [],
    oldestObservedAt: null,
    now: new Date(deps.now()),
    // 这里只是借 buildPresentation 算 buckets/maturity,不需要趋势/最近动态那两块
    progressSnapshots: [],
  })
  const maturityCounts: Record<string, number> = {}
  for (const c of presentation.components) {
    maturityCounts[c.maturityCode] = (maturityCounts[c.maturityCode] ?? 0) + 1
  }
  const { written } = await deps.store.upsertProgressSnapshot({
    snapshotDate: startedAt.slice(0, 10),
    totalComponents: presentation.totalComponents,
    operatingCount: presentation.buckets.operating,
    builtNotLiveCount: presentation.buckets.built_not_live,
    buildingCount: presentation.buckets.building,
    maturityCounts,
    syncRunId: runId,
    runStartedAt: startedAt,
  })
  return written
}

export async function runFullSync(
  deps: RunnerDeps,
  trigger: Extract<SyncTrigger, 'cron' | 'manual'>,
): Promise<SyncRunResult> {
  const runId = deps.newRunId()
  const startedAt = deps.now()
  const failedItems: string[] = []
  const truncations: string[] = []
  let partial = false

  // 已 merged 且有 merged_commit_sha 的 PR 事实不可变 —— 不重抓,省限流配额
  const existing = await deps.store.readPrFacts()
  const immutable = new Set(
    existing.filter((r) => r.state === 'merged' && r.merged_commit_sha).map((r) => r.pr_number),
  )
  const prNumbers = Array.from(registryPrNumbers()).filter((n) => !immutable.has(n))
  const issueNumbers = Array.from(registryIssueNumbers())

  let mainHeadSha: string | null = null
  let prFacts: PrFactDetail[] = []
  let issueRows: Omit<IssueFactRow, 'sync_run_id' | 'human_summary' | 'human_summary_generated_at'>[] = []
  const unclassified: { kind: 'pr' | 'issue'; number: number; title: string; url: string; opened_at: string }[] = []
  const resolve: { kind: 'pr' | 'issue'; number: number }[] = []

  try {
    mainHeadSha = (await deps.provider.getMainHead()).sha

    const prResult = await deps.provider.getPullRequestFacts(prNumbers)
    prFacts = prResult.facts
    for (const f of prResult.failed) failedItems.push(`pr#${f.number}: ${f.reason}`)
    if (prResult.rateLimited) partial = true
    if (prFacts.some((f) => f.unresolvedThreads === null)) partial = true
    for (const f of prFacts.filter((x) => x.changedFilesTruncated)) {
      truncations.push(`pr#${f.number}: changed_files 截断至上限`)
    }
    for (const f of prFacts.filter((x) => x.checksTruncated)) {
      truncations.push(`pr#${f.number}: checks 只取第一页`)
    }

    const issueResult = await deps.provider.getIssueFacts(issueNumbers)
    issueRows = issueResult.facts.map((f) => ({
      issue_number: f.number,
      state: f.state,
      title: f.title,
      updated_at: f.updatedAt,
      observed_at: f.observedAt,
    }))
    for (const f of issueResult.failed) failedItems.push(`issue#${f.number}: ${f.reason}`)
    if (issueResult.rateLimited) partial = true

    // 未分类发现(只在 full 轮):确定性关联,不猜
    const since = new Date(Date.now() - UNCLASSIFIED_SCAN_DAYS * 24 * 3600_000).toISOString()
    const recent = await deps.provider.listRecentWork(since)
    if (recent.truncated) truncations.push('listRecentWork: 分页截断')
    const componentIds = new Set(PRODUCT_MAP_COMPONENTS.map((c) => c.id))
    const linkedPrs = registryPrNumbers()
    const linkedIssues = registryIssueNumbers()
    for (const item of recent.items) {
      const un = isUnclassified({
        kind: item.kind,
        number: item.number,
        body: item.body,
        registryComponentIds: componentIds,
        linkedPrNumbers: linkedPrs,
        linkedIssueNumbers: linkedIssues,
      })
      if (un) {
        unclassified.push({
          kind: item.kind,
          number: item.number,
          title: item.title,
          url: item.url,
          opened_at: item.openedAt,
        })
      }
    }

    // 存量未分类复核 → 收编名单(显式确认制)。复核本身限流 → 本轮不收编,不误消。
    const backlog = (await deps.store.readUnclassified()).filter(
      (row) => !unclassified.some((u) => u.kind === row.kind && u.number === row.number),
    )
    if (backlog.length > 0) {
      const states = await deps.provider.getWorkItemStates(backlog.map((b) => b.number))
      if (states.rateLimited) partial = true
      for (const b of backlog) {
        const state = states.facts.find((s) => s.number === b.number)
        if (!state) continue // 复核失败/未尝试 → 留在队列,下轮再看
        const nowLinked =
          (b.kind === 'pr' ? linkedPrs.has(b.number) : linkedIssues.has(b.number)) ||
          extractComponentMarkers(state.body).some((id) => componentIds.has(id))
        if (state.state === 'closed' || nowLinked) {
          resolve.push({ kind: b.kind, number: b.number })
        }
      }
    }
  } catch (err) {
    // 到这里的只剩「批量契约之外」的失败(getMainHead / store 读)—— 整轮 error
    return commitErrorRun(deps, runId, trigger, 'full', startedAt, err, {
      failedItems,
      truncations,
    })
  }

  if (failedItems.length > 0) partial = true

  // webhook error 汇总窗口 = 上一次 full 轮以来(不是今天零点 —— 那会留永久盲区)
  const lastFull = await deps.store.lastFullRunStartedAt()
  const since = lastFull ?? new Date(Date.now() - 24 * 3600_000).toISOString()
  const webhookErrorRuns = await deps.store.countWebhookErrorRunsSince(since)
  const pruned = await deps.store.pruneDeliveriesBefore(
    new Date(Date.now() - DELIVERY_RETENTION_DAYS * 24 * 3600_000).toISOString(),
  )

  const stats: SyncStats = {
    prsSynced: prFacts.length,
    issuesSynced: issueRows.length,
    unclassifiedSeen: unclassified.length,
    failedItems,
    skippedStale: 0,
    truncations,
    webhookErrorRunsSinceLastFull: webhookErrorRuns,
    deliveriesPruned: pruned,
  }
  const status = partial ? 'partial' : 'ok'
  const { skippedStale } = await deps.store.commitSync({
    run: {
      id: runId,
      trigger,
      mode: 'full',
      status,
      main_head_sha: mainHeadSha,
      started_at: startedAt,
      finished_at: deps.now(),
      stats,
      error_message: null,
    },
    prFacts: prFacts.map(toPrRow),
    issueFacts: issueRows,
    unclassified,
    resolve,
    mode: 'full',
  })

  // 🔴 以下两阶段发生在 facts 已经落库**之后**——任何异常都必须留在这两个
  //    独立 try/catch 里,绝不能让摘要/快照的问题把一次本该是 ok/partial 的
  //    同步拖成 error(子牙 + 魏征设计审共同要求)。
  let summaryStats = { generated: 0, failed: 0, rejected: 0, skippedBudget: 0 }
  try {
    summaryStats = await generateMissingSummaries(deps)
  } catch {
    // 阶段本身炸了(比如 store 读取失败)—— 全部记未完成,留给下一轮
    summaryStats = { generated: 0, failed: 0, rejected: 0, skippedBudget: -1 }
  }

  let progressSnapshotWritten = false
  try {
    progressSnapshotWritten = await writeProgressSnapshot(deps, runId, startedAt)
  } catch {
    progressSnapshotWritten = false
  }

  const extraStats: Partial<SyncStats> = {
    summariesGenerated: summaryStats.generated,
    summariesFailed: summaryStats.failed,
    summariesRejected: summaryStats.rejected,
    summariesSkippedBudget: summaryStats.skippedBudget,
    progressSnapshotWritten,
  }
  try {
    await deps.store.patchRunStats(runId, extraStats)
  } catch {
    // patch 本身失败 —— run 行的 stats 里看不到这几个数字,但 facts/快照该落的已经落了,
    // 不影响本轮 status。巡检工具后续可以用「有没有这几个字段」间接发现这类 patch 失败。
  }

  return { runId, status, stats: { ...stats, skippedStale, ...extraStats } }
}

/**
 * webhook 触发:单号码硬预算。
 * 非登记册号码返回 null(不建 run、不落 facts)—— 孤儿行会把快照的 min 鲜度
 * 钉死在远古,而且 full 轮永远不会刷新它们;未分类发现是 cron 的活。
 */
export async function runTargetedSync(
  deps: RunnerDeps,
  target: { kind: 'pr' | 'issue'; number: number },
): Promise<SyncRunResult | null> {
  const linked =
    target.kind === 'pr'
      ? registryPrNumbers().has(target.number)
      : registryIssueNumbers().has(target.number)
  if (!linked) return null

  const runId = deps.newRunId()
  const startedAt = deps.now()

  try {
    let prRows: Omit<PrFactRow, 'sync_run_id' | 'human_summary' | 'human_summary_generated_at'>[] = []
    let issueRows: Omit<IssueFactRow, 'sync_run_id' | 'human_summary' | 'human_summary_generated_at'>[] = []
    const failedItems: string[] = []
    let partial = false

    if (target.kind === 'pr') {
      const r = await deps.provider.getPullRequestFacts([target.number])
      prRows = r.facts.map(toPrRow)
      for (const f of r.failed) failedItems.push(`pr#${f.number}: ${f.reason}`)
      // GraphQL 失败(threads null)同 full 轮口径 → partial
      if (r.rateLimited || r.facts.some((f) => f.unresolvedThreads === null)) partial = true
    } else {
      const r = await deps.provider.getIssueFacts([target.number])
      issueRows = r.facts.map((f) => ({
        issue_number: f.number,
        state: f.state,
        title: f.title,
        updated_at: f.updatedAt,
        observed_at: f.observedAt,
      }))
      for (const f of r.failed) failedItems.push(`issue#${f.number}: ${f.reason}`)
      if (r.rateLimited) partial = true
    }

    const status = failedItems.length > 0 || partial ? 'partial' : 'ok'
    const stats: SyncStats = {
      prsSynced: prRows.length,
      issuesSynced: issueRows.length,
      unclassifiedSeen: 0,
      failedItems,
      skippedStale: 0,
      truncations: [],
    }
    const { skippedStale } = await deps.store.commitSync({
      run: {
        id: runId,
        trigger: 'webhook',
        mode: 'targeted',
        status,
        main_head_sha: null,
        started_at: startedAt,
        finished_at: deps.now(),
        stats,
        error_message: null,
      },
      prFacts: prRows,
      issueFacts: issueRows,
      unclassified: [],
      resolve: [],
      mode: 'targeted',
    })
    return { runId, status, stats: { ...stats, skippedStale } }
  } catch (err) {
    return commitErrorRun(deps, runId, 'webhook', 'targeted', startedAt, err, {
      failedItems: [],
      truncations: [],
    })
  }
}

async function commitErrorRun(
  deps: RunnerDeps,
  runId: string,
  trigger: SyncTrigger,
  mode: SyncMode,
  startedAt: string,
  err: unknown,
  partialStats: { failedItems: string[]; truncations: string[] },
): Promise<SyncRunResult> {
  // 环境性错误(表未 apply)原样上抛 —— route 层要据此回 not_provisioned,
  // 包成普通 error run 会把「待 provision」和「同步坏了」混成一种
  if (err instanceof NotProvisionedError) throw err
  const message = err instanceof Error ? err.message : String(err)
  const stats: SyncStats = {
    prsSynced: 0,
    issuesSynced: 0,
    unclassifiedSeen: 0,
    failedItems: partialStats.failedItems,
    skippedStale: 0,
    truncations: partialStats.truncations,
  }
  // error run 也要留痕(空 facts,不清任何旧数据)—— 失败不许静默。
  // store 本身也炸时不许吞掉原始错误:两个都进返回的 stats。
  try {
    await deps.store.commitSync({
      run: {
        id: runId,
        trigger,
        mode,
        status: 'error',
        main_head_sha: null,
        started_at: startedAt,
        finished_at: deps.now(),
        stats,
        error_message: message,
      },
      prFacts: [],
      issueFacts: [],
      unclassified: [],
      resolve: [],
      mode,
    })
  } catch (storeErr) {
    const storeMessage = storeErr instanceof Error ? storeErr.message : String(storeErr)
    return {
      runId,
      status: 'error',
      stats: { ...stats, failedItems: [...stats.failedItems, `原始错误:${message}`, `台账写入也失败:${storeMessage}`] },
    }
  }
  return { runId, status: 'error', stats: { ...stats, failedItems: [...stats.failedItems, message] } }
}
