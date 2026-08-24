/**
 * Todo Reconciliation Gate — WP1 (#1169).
 *
 * Pure, deterministic: same `items` + same `asOf` always produce the same
 * result. No DB read, no provider call, no wall-clock — the caller supplies
 * `asOf` so this stays testable and reproducible.
 *
 * Classifies every raw work row into exactly one reason code, then collapses
 * kept rows sharing a `rootCauseKey` into a single cluster with an
 * `occurrenceCount` — so 48 repeated failures of the same cron job become
 * one reviewable line, not 48 duplicate rows and not a silently dropped
 * count (CLAUDE.md §3: 发现不许死在日志里).
 */

import type {
  RawWorkItem,
  ReasonCode,
  ReconciledCluster,
  ReconciliationResult,
  SuppressedGroup,
} from './types'
import { KEPT_REASON_CODES } from './types'

/** Renders an ISO instant as its Pacific/Auckland calendar date (YYYY-MM-DD). */
function nzCalendarDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function isSameNzCalendarDay(fromIso: string, toIso: string): boolean {
  // AU/NZ target market — a "same day" boundary crossed in UTC (NZST is
  // UTC+12/+13) must not silently shift a same-day discovery into GENUINE_UNRESOLVED
  // a day early/late. Compare actual Auckland calendar dates, not UTC substrings.
  return nzCalendarDate(fromIso) === nzCalendarDate(toIso)
}

/** Reel statuses that mean "a human still needs to look at this" (mirrors REEL_REVIEW_STATUSES in src/lib/pm-todo/daily-todo.ts). */
const OPEN_REEL_STATUSES = new Set(['video_ready', 'images_ready', 'in_review'])

/**
 * Reel statuses this fixture/current source is known to actually emit for
 * "already done" — an explicit allowlist, not an else-branch. A missing,
 * malformed or unrecognised status must never fall through to "done" by
 * default; that is exactly the false-suppression bug this fixes.
 */
const TERMINAL_REEL_STATUSES = new Set(['published', 'approved', 'rejected'])

interface Verdict {
  reason: ReasonCode
}

function classify(item: RawWorkItem, asOf: string, blogDraftClientNames: ReadonlySet<string>): Verdict {
  switch (item.source) {
    case 'cron_failure':
      // Every occurrence of the same job name is the same unresolved
      // incident; it stays GENUINE_UNRESOLVED and collapses via rootCauseKey.
      return { reason: 'GENUINE_UNRESOLVED' }

    case 'gbp_setup':
      return item.category === 'already_connected'
        ? { reason: 'CONNECTOR_ALREADY_CONNECTED' }
        : { reason: 'HUMAN_DECISION_REQUIRED' }

    case 'blog_draft':
      return { reason: 'GENUINE_UNRESOLVED' }

    case 'reel_review':
      if (item.reelStatus && OPEN_REEL_STATUSES.has(item.reelStatus)) {
        return { reason: 'GENUINE_UNRESOLVED' }
      }
      if (item.reelStatus && TERMINAL_REEL_STATUSES.has(item.reelStatus)) {
        return { reason: 'TERMINAL_COMPLETED' }
      }
      // Missing, malformed, or a status this source has never been vetted to
      // emit — never assume "done"; a reviewer must look at it.
      return { reason: 'CHECK_FAILED_UNRESOLVED' }

    case 'execution_card':
      // me_auto cards describe machine-executable work — they belong to the
      // WP2 dispatcher, not a human's todo count.
      return item.fixType === 'me_auto'
        ? { reason: 'AUTO_EXECUTABLE_NOT_HUMAN_WORK' }
        : { reason: 'GENUINE_UNRESOLVED' }

    case 'manual_item':
      return classifyManualItem(item, asOf, blogDraftClientNames)

    default:
      return { reason: 'GENUINE_UNRESOLVED' }
  }
}

function classifyManualItem(
  item: RawWorkItem,
  asOf: string,
  blogDraftClientNames: ReadonlySet<string>,
): Verdict {
  switch (item.category) {
    case 'url_indexing':
      return classifyUrlIndexing(item, asOf)

    // Same content already appears as a real blog-draft row (source:
    // 'blog_draft') — this manual-lane summary of it is a second count of
    // the same work. Only suppress when THIS input actually contains that
    // proof (a blog_draft row for the same client); otherwise we cannot
    // tell duplicate from genuinely-unresolved and must not guess.
    case 'blog_draft_summary':
      return item.clientName && blogDraftClientNames.has(item.clientName)
        ? { reason: 'DUPLICATE_WORK_ITEM' }
        : { reason: 'CHECK_FAILED_UNRESOLVED' }

    case 'dnc_ambiguity':
      return { reason: 'HUMAN_DECISION_REQUIRED' }

    // A metric the system could not itself verify must stay visibly
    // unresolved — "could not check" is never allowed to read as "no
    // problem" (CLAUDE.md 铁律 §3).
    case 'leads_metric_untrusted':
      return { reason: 'CHECK_FAILED_UNRESOLVED' }

    default:
      return { reason: 'GENUINE_UNRESOLVED' }
  }
}

function classifyUrlIndexing(item: RawWorkItem, asOf: string): Verdict {
  switch (item.verdict) {
    case 'intentional_noindex':
    case 'redirect':
    case 'duplicate_canonical':
    case 'alternate_canonical':
      // Deliberate SEO states the site owner (or a prior ME action) chose —
      // not a defect to hand to a human.
      return { reason: 'INTENTIONAL_STATE' }

    case 'unknown_to_google':
      // A URL discovered the same day has not had time to be crawled —
      // flagging it now would be a false "problem" every single morning.
      return item.createdAt && isSameNzCalendarDay(item.createdAt, asOf)
        ? { reason: 'NOT_YET_DUE' }
        : { reason: 'GENUINE_UNRESOLVED' }

    case 'crawled_not_indexed':
    case 'discovered_not_indexed':
    default:
      return { reason: 'GENUINE_UNRESOLVED' }
  }
}

export function reconcile(items: RawWorkItem[], asOf: string): ReconciliationResult {
  const clusterMap = new Map<string, { items: RawWorkItem[]; reason: ReasonCode }>()
  const suppressedMap = new Map<ReasonCode, RawWorkItem[]>()

  // Same-input proof set for the blog_draft_summary dedupe check above —
  // deliberately just client names actually present as real blog_draft rows
  // in THIS call's items, not a persistent identity/lookup framework.
  const blogDraftClientNames = new Set(
    items
      .filter((i): i is RawWorkItem & { clientName: string } => i.source === 'blog_draft' && !!i.clientName)
      .map((i) => i.clientName),
  )

  for (const item of items) {
    const verdict = classify(item, asOf, blogDraftClientNames)

    if (!KEPT_REASON_CODES.has(verdict.reason)) {
      const bucket = suppressedMap.get(verdict.reason) ?? []
      bucket.push(item)
      suppressedMap.set(verdict.reason, bucket)
      continue
    }

    const existing = clusterMap.get(item.rootCauseKey)
    if (existing) {
      existing.items.push(item)
    } else {
      clusterMap.set(item.rootCauseKey, { items: [item], reason: verdict.reason })
    }
  }

  const unresolvedClusters: ReconciledCluster[] = Array.from(clusterMap.entries())
    .map(([rootCauseKey, { items: clusterItems, reason }]) => {
      const first = clusterItems[0]
      return {
        rootCauseKey,
        source: first.source,
        category: first.category,
        clientName: first.clientName,
        label: first.label,
        occurrenceCount: clusterItems.length,
        reason,
        itemIds: clusterItems.map((i) => i.id),
      }
    })
    .sort((a, b) => a.rootCauseKey.localeCompare(b.rootCauseKey))

  const suppressed: SuppressedGroup[] = Array.from(suppressedMap.entries())
    .map(([reason, group]) => ({
      reason,
      count: group.length,
      itemIds: group.map((i) => i.id),
      sample: group[0]?.label ?? '',
    }))
    .sort((a, b) => a.reason.localeCompare(b.reason))

  return {
    asOf,
    totalRaw: items.length,
    unresolvedClusters,
    totalUnresolvedOccurrences: unresolvedClusters.reduce((s, c) => s + c.occurrenceCount, 0),
    suppressed,
    totalSuppressed: suppressed.reduce((s, g) => s + g.count, 0),
  }
}
