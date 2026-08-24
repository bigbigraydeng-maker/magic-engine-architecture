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

const UNCLASSIFIED_ROOT_CAUSE =
  "No cross-job correlation evidence — this job's own failures are the entire evidenced incident."
const CHECK_FAILED_ROOT_CAUSE = 'CHECK_FAILED — occurrence is missing a job name and cannot be classified.'

function incidentKeyOf(rootCauseId: string, scopeKey: string): string {
  return `${rootCauseId}::${scopeKey}`
}

/** Builds a `jobName -> evidence` lookup; fails closed (undefined) for anything not explicitly evidenced. */
function indexEvidenceByJob(
  evidence: IncidentCorrelationEvidence[],
): Map<string, IncidentCorrelationEvidence> {
  const byJob = new Map<string, IncidentCorrelationEvidence>()
  for (const e of evidence) {
    for (const jobName of e.jobNames) byJob.set(jobName, e)
  }
  return byJob
}

/**
 * Verified recovery closes an incident only when the LATEST receipt for its
 * rootCauseId×scopeKey is at or after the incident's latest failure. A
 * receipt older than the latest failure is stale and cannot close it. A new
 * failure after a closing receipt makes that receipt stale again — the
 * incident reopens automatically, with no separate "reopen" branch needed.
 */
function deriveStatus(
  rootCauseId: string,
  scopeKey: string,
  latestFailureAt: string,
  receipts: RecoveryReceipt[],
): IncidentStatus {
  const matching = receipts.filter((r) => r.rootCauseId === rootCauseId && r.scopeKey === scopeKey)
  if (matching.length === 0) return 'RECOVERY_UNKNOWN'

  const latestReceipt = matching.reduce((a, b) => (a.verifiedAt > b.verifiedAt ? a : b))
  return latestReceipt.verifiedAt >= latestFailureAt ? 'RECOVERED' : 'OPEN'
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
      // Missing/invalid evidence must fail closed and stay visible — never
      // silently dropped, never merged with another malformed occurrence.
      rootCauseId = `invalid:${occ.id}`
      rootCause = CHECK_FAILED_ROOT_CAUSE
      scopeKey = 'UNKNOWN'
      affectedScope = 'UNKNOWN'
    } else {
      const matched = evidenceByJob.get(occ.jobName)
      if (matched) {
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
        affectedScope = 'UNKNOWN'
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
      const latestFailureAt = g.occ.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b)).occurredAt
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
