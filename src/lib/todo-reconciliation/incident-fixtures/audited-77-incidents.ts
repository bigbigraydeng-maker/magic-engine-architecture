/**
 * Frozen adapter — WP3 (#1169). Converts the existing audited-280 fixture's
 * 77 `cron_failure` rows (from `buildAudited280()`, unchanged) into
 * `CronOccurrence[]`, plus the explicit root-cause × scope correlation
 * evidence for `aggregateIncidents()`.
 *
 * The three named groupings below are NOT inferred from job-name similarity
 * — they are copied from the #1169 issue body's own "Cron reconciliation"
 * finding ("They collapse mainly to: 1. one Meta credential/page-token
 * incident … 2. one market-intelligence feed 403/source incident …
 * 3. one CMS cross-client connector incident."). Any job not named there
 * gets no fabricated correlation — `aggregateIncidents()` falls back to a
 * single-job, self-evidenced incident for it.
 *
 * No per-occurrence failure timestamp exists in the source fixture (cron
 * rows never set `createdAt`) — every occurrence here is honestly stamped
 * with the instant the whole batch was audited, not a fabricated individual
 * run time. This is display-only: the audited-77 Ray preview passes zero
 * recovery receipts, so every incident's status resolves to
 * RECOVERY_UNKNOWN regardless of this timestamp.
 */

import { buildAudited280, AUDITED_280_ASOF } from '../fixtures/audited-280'
import type { CronOccurrence, IncidentCorrelationEvidence } from '../incidents'

export const AUDITED_77_CORRELATION_EVIDENCE: IncidentCorrelationEvidence[] = [
  {
    rootCauseId: 'meta-credential-token',
    rootCause: 'One Meta credential/page-token incident affecting several jobs',
    scopeKey: 'cross-client-meta-connected',
    affectedScope: 'Cross-client — every client with an active Meta connection',
    jobNames: ['social-comment-autoreply', 'meta-leads-sync'],
  },
  {
    rootCauseId: 'market-intel-feed-403',
    rootCause: 'One market-intelligence feed 403/source incident',
    scopeKey: 'system-market-intel-feed',
    affectedScope: 'System-wide — market intelligence data feed, not client-scoped',
    jobNames: ['market-intel-daily'],
  },
  {
    rootCauseId: 'cms-cross-client-connector',
    rootCause: 'One CMS cross-client connector incident',
    scopeKey: 'cross-client-cms-connected',
    affectedScope: 'Cross-client — every CMS-connected client',
    jobNames: ['cms-connection-retest'],
  },
]

export function buildAudited77CronOccurrences(): CronOccurrence[] {
  return buildAudited280()
    .filter((item) => item.source === 'cron_failure')
    .map((item) => ({
      id: item.id,
      jobName: item.rootCauseKey.replace(/^cron:/, ''),
      occurredAt: AUDITED_280_ASOF,
    }))
}
