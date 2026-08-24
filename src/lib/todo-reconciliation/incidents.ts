/**
 * Incident Aggregation — WP3 (#1169).
 *
 * Turns raw cron-failure occurrences into one incident per
 * root-cause × affected-scope, instead of one row per run. Pure and
 * deterministic — no DB read, no provider call, no wall-clock; the caller
 * supplies every timestamp so this stays testable and reproducible
 * (mirrors the WP1 `reconcile()` contract in `./reconcile.ts`).
 *
 * This module prepares the future governed dispatcher's incident truth; it
 * does not execute, retry or heal anything.
 */

/** One raw failed run. `occurredAt` is required — recovery ordering depends on it. */
export interface CronOccurrence {
  id: string
  jobName: string
  occurredAt: string
}

/**
 * Explicit, evidenced correlation between one or more job names and a single
 * underlying incident. This is INPUT evidence, not something the aggregator
 * infers from job-name similarity — every grouping here must be traceable to
 * a real, stated root-cause finding (e.g. the #1169 audit body's own "Cron
 * reconciliation" analysis).
 *
 * Incident identity is `rootCauseId × scopeKey`, not `rootCauseId` alone —
 * the same root cause recurring against a different affected scope is a
 * different incident, never silently merged.
 */
export interface IncidentCorrelationEvidence {
  rootCauseId: string
  rootCause: string
  scopeKey: string
  affectedScope: string
  jobNames: string[]
}

/** A verified check that an incident's underlying cause was fixed. Never fabricated by the aggregator — always supplied by the caller. */
export interface RecoveryReceipt {
  rootCauseId: string
  scopeKey: string
  verifiedAt: string
}

export type IncidentStatus = 'OPEN' | 'RECOVERED' | 'RECOVERY_UNKNOWN'

export interface Incident {
  incidentKey: string
  rootCauseId: string
  rootCause: string
  scopeKey: string
  affectedScope: string
  occurrenceCount: number
  affectedJobs: string[]
  latestFailureAt: string
  status: IncidentStatus
  itemIds: string[]
}

export interface IncidentAggregationResult {
  totalRawOccurrences: number
  incidents: Incident[]
  totalAccountedOccurrences: number
}

// PM-facing fallback text (B1) — every string a reader sees without opening
// the fixture source must already be plain Chinese, never an internal
// diagnostic sentence in English.
const UNCLASSIFIED_ROOT_CAUSE = '未归类故障 — 目前只有这一个任务本身的失败记录，没有证据证明它和别的任务共享同一个根因。'
const CHECK_FAILED_ROOT_CAUSE = '核实失败 — 这条记录缺少任务名称，无法归类，予以保留可见。'
const CONFLICT_ROOT_CAUSE = '证据冲突 — 同一个任务被两条互相矛盾的根因证据同时引用，人工核实前不判定归属，也不会用来关闭任何一边的故障。'
const AFFECTED_SCOPE_UNKNOWN_ZH = '影响范围未知（UNKNOWN）'

// ─── B3 — structurally unambiguous composite identity ───────────────────────
//
// A plain `${rootCauseId}::${scopeKey}` template collides whenever either id
// itself contains "::" — e.g. ('a::b','c') and ('a','b::c') both produce
// "a::b::c". JSON-encoding the tuple keeps string boundaries (quoting +
// escaping) intact, so two different tuples can never serialise the same way.
function incidentKeyOf(rootCauseId: string, scopeKey: string): string {
  return JSON.stringify([rootCauseId, scopeKey])
}

type EvidenceLookup = IncidentCorrelationEvidence | 'CONFLICT'

/**
 * Builds a `jobName -> evidence` lookup — fails closed to `'CONFLICT'` when a
 * job name appears in two evidence rows with a genuinely different
 * (rootCauseId, scopeKey) (B2). Repeated *identical* evidence for the same
 * job is a safe duplicate, not a conflict.
 */
function indexEvidenceByJob(evidence: IncidentCorrelationEvidence[]): Map<string, EvidenceLookup> {
  const byJob = new Map<string, EvidenceLookup>()
  for (const e of evidence) {
    for (const jobName of e.jobNames) {
      const existing = byJob.get(jobName)
      if (existing === 'CONFLICT') continue
      if (existing && (existing.rootCauseId !== e.rootCauseId || existing.scopeKey !== e.scopeKey)) {
        byJob.set(jobName, 'CONFLICT')
      } else {
        byJob.set(jobName, e)
      }
    }
  }
  return byJob
}

// ─── B5 — parse timestamps before comparing; never trust raw string order ───

function parseInstant(iso: string): number | null {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * Verified recovery closes an incident only when the LATEST valid receipt
 * for its rootCauseId×scopeKey is at or after the incident's latest valid
 * failure. A receipt older than the latest failure is stale and cannot close
 * it. A new failure after a closing receipt makes that receipt stale again —
 * the incident reopens automatically, with no separate "reopen" branch
 * needed.
 *
 * Any invalid timestamp — the incident's own latest-failure instant, or a
 * candidate receipt's `verifiedAt` — is excluded before comparison rather
 * than compared as a raw string; an unparseable instant can never produce a
 * false RECOVERED.
 */
function deriveStatus(
  rootCauseId: string,
  scopeKey: string,
  latestFailureAt: string,
  receipts: RecoveryReceipt[],
): IncidentStatus {
  const latestFailureInstant = parseInstant(latestFailureAt)
  if (latestFailureInstant === null) return 'RECOVERY_UNKNOWN' // cannot safely order failures — never claim RECOVERED

  const validReceipts = receipts
    .filter((r) => r.rootCauseId === rootCauseId && r.scopeKey === scopeKey)
    .map((r) => ({ receipt: r, instant: parseInstant(r.verifiedAt) }))
    .filter((x): x is { receipt: RecoveryReceipt; instant: number } => x.instant !== null)

  if (validReceipts.length === 0) return 'RECOVERY_UNKNOWN'

  const latest = validReceipts.reduce((a, b) => (a.instant >= b.instant ? a : b))
  return latest.instant >= latestFailureInstant ? 'RECOVERED' : 'OPEN'
}

export function aggregateIncidents(
  occurrences: CronOccurrence[],
  evidence: IncidentCorrelationEvidence[],
  receipts: RecoveryReceipt[] = [],
): IncidentAggregationResult {
  const evidenceByJob = indexEvidenceByJob(evidence)

  const groups = new Map<
    string,
    { rootCauseId: string; rootCause: string; scopeKey: string; affectedScope: string; occ: CronOccurrence[] }
  >()

  for (const occ of occurrences) {
    let rootCauseId: string
    let rootCause: string
    let scopeKey: string
    let affectedScope: string

    if (!occ.jobName) {
      // Missing evidence must fail closed and stay visible — never silently
      // dropped, never merged with another malformed occurrence.
      rootCauseId = `invalid:${occ.id}`
      rootCause = CHECK_FAILED_ROOT_CAUSE
      scopeKey = 'UNKNOWN'
      affectedScope = AFFECTED_SCOPE_UNKNOWN_ZH
    } else {
      const matched = evidenceByJob.get(occ.jobName)
      if (matched === 'CONFLICT') {
        // Keyed per job name (not per raw evidence row), so every occurrence
        // of this job's conflict merges into one incident — and because its
        // rootCauseId/scopeKey match neither of the two real evidence rows,
        // no recovery receipt for either mapping can ever close it.
        rootCauseId = `conflict:${occ.jobName}`
        rootCause = CONFLICT_ROOT_CAUSE
        scopeKey = 'UNKNOWN'
        affectedScope = AFFECTED_SCOPE_UNKNOWN_ZH
      } else if (matched) {
        rootCauseId = matched.rootCauseId
        rootCause = matched.rootCause
        scopeKey = matched.scopeKey
        affectedScope = matched.affectedScope
      } else {
        // No explicit correlation evidence beyond this job's own failures —
        // a legitimate, fully-evidenced single-job incident, not a guess.
        rootCauseId = `job:${occ.jobName}`
        rootCause = UNCLASSIFIED_ROOT_CAUSE
        scopeKey = `job:${occ.jobName}`
        affectedScope = AFFECTED_SCOPE_UNKNOWN_ZH
      }
    }

    const key = incidentKeyOf(rootCauseId, scopeKey)
    const existing = groups.get(key)
    if (existing) {
      existing.occ.push(occ)
    } else {
      groups.set(key, { rootCauseId, rootCause, scopeKey, affectedScope, occ: [occ] })
    }
  }

  const incidents: Incident[] = Array.from(groups.entries())
    .map(([incidentKey, g]) => {
      const withInstant = g.occ.map((o) => ({ o, instant: parseInstant(o.occurredAt) }))
      const validInstant = withInstant.filter(
        (x): x is { o: CronOccurrence; instant: number } => x.instant !== null,
      )
      // If nothing parses, fall back to the first raw value purely for
      // display — deriveStatus() independently re-parses it and fails closed
      // to RECOVERY_UNKNOWN, so this never contributes to a false RECOVERED.
      const latestFailureAt =
        validInstant.length > 0
          ? validInstant.reduce((a, b) => (a.instant >= b.instant ? a : b)).o.occurredAt
          : g.occ[0].occurredAt

      return {
        incidentKey,
        rootCauseId: g.rootCauseId,
        rootCause: g.rootCause,
        scopeKey: g.scopeKey,
        affectedScope: g.affectedScope,
        occurrenceCount: g.occ.length,
        affectedJobs: Array.from(new Set(g.occ.map((o) => o.jobName || '(missing job name)'))),
        latestFailureAt,
        status: deriveStatus(g.rootCauseId, g.scopeKey, latestFailureAt, receipts),
        itemIds: g.occ.map((o) => o.id),
      }
    })
    .sort((a, b) => a.incidentKey.localeCompare(b.incidentKey))

  return {
    totalRawOccurrences: occurrences.length,
    incidents,
    totalAccountedOccurrences: incidents.reduce((s, i) => s + i.occurrenceCount, 0),
  }
}
