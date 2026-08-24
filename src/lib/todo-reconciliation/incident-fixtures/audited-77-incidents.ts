/**
 * Frozen adapter — WP3 (#1169). Converts the existing audited-280 fixture's
 * 77 `cron_failure` rows (from `buildAudited280()`, unchanged) into
 * `CronOccurrence[]`, plus the explicit root-cause × scope correlation
 * evidence for `aggregateIncidents()`.
 *
 * The three named groupings below are NOT inferred from job-name similarity
 * — the fact that these particular jobs share one cause is copied from the
 * #1169 issue body's own "Cron reconciliation" finding ("They collapse
 * mainly to: 1. one Meta credential/page-token incident … 2. one
 * market-intelligence feed 403/source incident … 3. one CMS cross-client
 * connector incident."). Any job not named there gets no fabricated
 * correlation — `aggregateIncidents()` falls back to a single-job,
 * self-evidenced incident for it.
 *
 * `affectedScope` deliberately does NOT name a specific customer set. The
 * audit body proves "these jobs share one root cause" — it does not prove
 * which exact customers are affected, so claiming e.g. "every Meta-connected
 * client" would be an invented fact the source evidence never established
 * (Build Control finding, B4). Every scope here reads UNKNOWN with only the
 * category of evidence that IS proven.
 *
 * All PM-facing text (rootCause / affectedScope) is plain Chinese — this
 * fixture feeds directly into the /dashboard/today card Ray reads, and the
 * house rule is zero-jargon PM-readable text, not internal English
 * diagnostic sentences (Build Control finding, B1).
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
    rootCause: 'Meta 凭证 / Page Token 故障 — 多个任务共享同一个根因',
    scopeKey: 'meta-shared-cause-jobs',
    affectedScope: '受影响客户范围未知（UNKNOWN）——审计只证明这几个任务共享同一根因，未证明具体受影响的客户名单',
    jobNames: ['social-comment-autoreply', 'meta-leads-sync'],
  },
  {
    rootCauseId: 'market-intel-feed-403',
    rootCause: '市场情报数据源 403 / 拉取故障',
    scopeKey: 'market-intel-feed-cause',
    affectedScope: '受影响客户范围未知（UNKNOWN）——这是系统级数据源故障，审计未证明具体受影响的客户名单',
    jobNames: ['market-intel-daily'],
  },
  {
    rootCauseId: 'cms-cross-client-connector',
    rootCause: 'CMS 跨客户连接器故障',
    scopeKey: 'cms-connector-cause',
    affectedScope: '受影响客户范围未知（UNKNOWN）——审计只证明这是跨客户类别的故障，未证明具体受影响的客户名单',
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
