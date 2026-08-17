/**
 * 控制台数据载入 —— 四态判定住在这里(不在 page.tsx),因为它最容易写错
 * 却最没人测(子牙设计审 M7)。page 只负责调它 + 渲染。
 *
 * 四态互斥且穷尽:
 *   ok             同步表在、有数据
 *   not_provisioned 表还没建(合并 ≠ 上线,这是常态,不是故障)
 *   sync_error      读库炸了 —— **不吞**,摘要带出去显示
 *   never_synced    表在但零行(绝不显示成「同步结果为空」)
 *
 * 🔴 位置:住在 **sync(接线层)**而不是 product-map(纯层)——
 *    依赖方向只有一条:product-map(纯) ← product-map-sync(接线) ← page。
 *    反过来放就是目录成环(子牙设计审 M1)。
 */

import { buildProductMapSnapshot, MANUAL_FACTS_SNAPSHOT } from '@/lib/product-map'
import type { ExternalFacts } from '@/lib/product-map'
import { buildPresentation } from '@/lib/product-map/presenter'
import type {
  ConsolePresentation,
  IssueFactView,
  LoadOutcome,
  PrFactView,
  ProgressSnapshotView,
  SyncRunView,
  UnclassifiedItemView,
} from '@/lib/product-map/presenter'
import { rowsToExternalFacts } from './facts-adapter'
import { NotProvisionedError } from './types'
import type { ProductMapSyncStore } from './store'

/** 错误摘要上限 —— Supabase 原始报错带 schema 细节,没必要印进 HTML(子牙 S4)。 */
const ERROR_SUMMARY_MAX = 200
/** 趋势图回看窗口 —— 一个月足够看出走势,太长了 UI 也画不下。 */
const PROGRESS_TREND_DAYS = 30

export async function loadProductMapConsole(
  store: ProductMapSyncStore,
  now: Date = new Date(),
): Promise<ConsolePresentation> {
  let loadOutcome: LoadOutcome = 'ok'
  let loadErrorSummary: string | undefined
  let facts: ExternalFacts = MANUAL_FACTS_SNAPSHOT
  let latestRun: SyncRunView | null = null
  let lastFullRunAt: string | null = null
  let prFacts: PrFactView[] = []
  let issueFacts: IssueFactView[] = []
  let unclassified: UnclassifiedItemView[] = []
  let oldestObservedAt: string | null = null
  let progressSnapshots: ProgressSnapshotView[] = []

  // 🔴 快照表是本 PR 新加的,跟 PR/issue facts 表**不是同一次 migration**——
  //    代码先部署、这张表的 migration 后 apply 是完全可能出现的窗口期(合并 ≠ 上线)。
  //    这里必须独立 try/catch:新表没建不该把"PR/issue facts 明明读得到"的整页
  //    拖成 not_provisioned,只是趋势图那块暂时没数据(progressSnapshots 留空数组,
  //    presenter 那边 hasEnoughData=false 会显式说"还没有数据",不装懂但也不误伤主页面)。
  try {
    const snapshotRows = await store.readProgressSnapshots(PROGRESS_TREND_DAYS)
    progressSnapshots = snapshotRows.map((s) => ({
      date: s.snapshot_date,
      totalComponents: s.total_components,
      operatingCount: s.operating_count,
      builtNotLiveCount: s.built_not_live_count,
      buildingCount: s.building_count,
    }))
  } catch (err) {
    if (!(err instanceof NotProvisionedError)) throw err // 真的读库炸了要冒泡,不能吞
    progressSnapshots = []
  }

  try {
    const [prRows, issueRows, unclassifiedRows, runRow, fullRunAt] = await Promise.all([
      store.readPrFacts(),
      store.readIssueFacts(),
      store.readUnclassified(),
      store.readLatestRun(),
      store.lastFullRunStartedAt(),
    ])

    // 真判据是「有没有跑过轮」:跑过一轮但零 PR ≠ 从没同步过(子牙二轮 9)
    if (runRow === null) {
      loadOutcome = 'never_synced'
    } else {
      const synced = rowsToExternalFacts(prRows, null)
      if (synced) {
        facts = synced.facts
        oldestObservedAt = synced.freshness.oldestObservedAt
      }
      prFacts = prRows.map((r) => ({
        number: r.pr_number,
        state: r.state,
        isDraft: r.is_draft,
        unresolvedThreads: r.unresolved_threads,
        title: r.title,
        humanSummary: r.human_summary,
        observedAt: r.observed_at,
      }))
    }

    issueFacts = issueRows.map((r) => ({
      number: r.issue_number,
      state: r.state,
      title: r.title,
      humanSummary: r.human_summary,
      observedAt: r.observed_at,
    }))
    unclassified = unclassifiedRows.map((r) => ({
      kind: r.kind,
      number: r.number,
      title: r.title,
      url: r.url,
      firstSeenAt: r.first_seen_at,
    }))
    latestRun = runRow
      ? {
          status: runRow.status,
          mode: runRow.mode,
          startedAt: runRow.started_at,
          finishedAt: runRow.finished_at,
          errorMessage: runRow.error_message,
          failedItems: runRow.stats?.failedItems ?? [],
          truncations: runRow.stats?.truncations ?? [],
          skippedStale: runRow.stats?.skippedStale ?? 0,
        }
      : null
    lastFullRunAt = fullRunAt
  } catch (err) {
    if (err instanceof NotProvisionedError) {
      loadOutcome = 'not_provisioned'
    } else {
      loadOutcome = 'sync_error'
      const raw = err instanceof Error ? err.message : String(err)
      loadErrorSummary = raw.slice(0, ERROR_SUMMARY_MAX)
    }
  }

  return buildPresentation({
    snapshot: buildProductMapSnapshot(facts),
    loadOutcome,
    loadErrorSummary,
    latestRun,
    lastFullRunAt,
    prFacts,
    issueFacts,
    unclassified,
    oldestObservedAt,
    now,
    progressSnapshots,
  })
}
