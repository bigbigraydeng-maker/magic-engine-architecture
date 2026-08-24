/**
 * Incident Aggregation — WP3 (#1169) tests.
 */

import { describe, expect, it } from 'vitest'
import { aggregateIncidents } from '../incidents'
import type { CronOccurrence, IncidentCorrelationEvidence, RecoveryReceipt } from '../incidents'
import { buildAudited77CronOccurrences, AUDITED_77_CORRELATION_EVIDENCE } from '../incident-fixtures/audited-77-incidents'

describe('audited-77 adapter', () => {
  it('extracts exactly 77 cron occurrences from the unchanged audited-280 fixture', () => {
    expect(buildAudited77CronOccurrences()).toHaveLength(77)
  })
})

// ─── Test 1: frozen 77 -> explicit incident groups, deterministically ────────

describe('aggregateIncidents — frozen audited-77', () => {
  it('accounts for all 77 occurrences across exactly the evidenced + fallback incident groups', () => {
    const occurrences = buildAudited77CronOccurrences()
    const result = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)

    expect(result.totalRawOccurrences).toBe(77)
    expect(result.totalAccountedOccurrences).toBe(77)

    const byId = new Map(result.incidents.map((i) => [i.incidentKey, i]))

    const meta = byId.get('meta-credential-token::cross-client-meta-connected')
    expect(meta?.occurrenceCount).toBe(72) // 48 + 24
    expect(meta?.affectedJobs.sort()).toEqual(['meta-leads-sync', 'social-comment-autoreply'])

    const marketIntel = byId.get('market-intel-feed-403::system-market-intel-feed')
    expect(marketIntel?.occurrenceCount).toBe(1)

    const cms = byId.get('cms-cross-client-connector::cross-client-cms-connected')
    expect(cms?.occurrenceCount).toBe(1)

    // Not named in the audit body's 3 categories -> each is its own
    // self-evidenced, single-job incident, not merged or invented.
    for (const job of ['winner-reel-sync-daily', 'ad-readback-sweep', 'google-data-pullback-daily']) {
      const standalone = byId.get(`job:${job}::job:${job}`)
      expect(standalone?.occurrenceCount).toBe(1)
      expect(standalone?.affectedJobs).toEqual([job])
    }

    // 6 incidents total: 3 named + 3 standalone (down from 7 raw job-name clusters).
    expect(result.incidents).toHaveLength(6)
  })

  it('every audited-77 incident is RECOVERY_UNKNOWN — no recovery receipt was ever fabricated for this frozen preview', () => {
    const occurrences = buildAudited77CronOccurrences()
    const result = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)
    expect(result.incidents.every((i) => i.status === 'RECOVERY_UNKNOWN')).toBe(true)
  })
})

// ─── Test 2: same root cause, different scope -> does not merge ─────────────

describe('aggregateIncidents — identity is rootCause × scope, not rootCause alone', () => {
  it('keeps two incidents with the same rootCauseId but different scopeKey separate', () => {
    const evidence: IncidentCorrelationEvidence[] = [
      { rootCauseId: 'shared-cause', rootCause: 'X', scopeKey: 'scope-a', affectedScope: 'A', jobNames: ['job-a'] },
      { rootCauseId: 'shared-cause', rootCause: 'X', scopeKey: 'scope-b', affectedScope: 'B', jobNames: ['job-b'] },
    ]
    const occurrences: CronOccurrence[] = [
      { id: '1', jobName: 'job-a', occurredAt: '2026-08-24T00:00:00.000Z' },
      { id: '2', jobName: 'job-b', occurredAt: '2026-08-24T00:00:00.000Z' },
    ]
    const result = aggregateIncidents(occurrences, evidence)

    expect(result.incidents).toHaveLength(2)
    expect(result.incidents.map((i) => i.incidentKey).sort()).toEqual([
      'shared-cause::scope-a',
      'shared-cause::scope-b',
    ])
  })
})

// ─── Test 3: same identity combines occurrences, dedupes affected jobs ──────

describe('aggregateIncidents — same identity combines and dedupes', () => {
  it('combines occurrences from multiple jobs sharing one incident, and de-duplicates the affected-job list', () => {
    const evidence: IncidentCorrelationEvidence[] = [
      { rootCauseId: 'c1', rootCause: 'cause', scopeKey: 's1', affectedScope: 'scope', jobNames: ['job-a', 'job-b'] },
    ]
    const occurrences: CronOccurrence[] = [
      { id: '1', jobName: 'job-a', occurredAt: '2026-08-24T00:00:00.000Z' },
      { id: '2', jobName: 'job-a', occurredAt: '2026-08-24T01:00:00.000Z' },
      { id: '3', jobName: 'job-b', occurredAt: '2026-08-24T02:00:00.000Z' },
    ]
    const result = aggregateIncidents(occurrences, evidence)

    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0].occurrenceCount).toBe(3)
    expect(result.incidents[0].affectedJobs.sort()).toEqual(['job-a', 'job-b'])
    expect(result.incidents[0].itemIds.sort()).toEqual(['1', '2', '3'])
  })
})

// ─── Test 4: missing/invalid evidence fails closed, stays visible ───────────

describe('aggregateIncidents — missing/invalid evidence fails closed', () => {
  it('keeps an occurrence with a missing job name visible as its own CHECK_FAILED incident, never dropped', () => {
    const occurrences: CronOccurrence[] = [{ id: 'bad-1', jobName: '', occurredAt: '2026-08-24T00:00:00.000Z' }]
    const result = aggregateIncidents(occurrences, [])

    expect(result.totalAccountedOccurrences).toBe(1)
    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0].rootCause).toContain('CHECK_FAILED')
    expect(result.incidents[0].affectedScope).toBe('UNKNOWN')
  })

  it('does not merge two different malformed occurrences into one incident', () => {
    const occurrences: CronOccurrence[] = [
      { id: 'bad-1', jobName: '', occurredAt: '2026-08-24T00:00:00.000Z' },
      { id: 'bad-2', jobName: '', occurredAt: '2026-08-24T00:00:00.000Z' },
    ]
    const result = aggregateIncidents(occurrences, [])
    expect(result.incidents).toHaveLength(2)
    expect(result.totalAccountedOccurrences).toBe(2)
  })
})

// ─── Tests 5-7: recovery close/reopen — synthetic fixture only ──────────────

describe('aggregateIncidents — recovery close/reopen (synthetic, separate from the audited-77 Ray display)', () => {
  const evidence: IncidentCorrelationEvidence[] = [
    { rootCauseId: 'c1', rootCause: 'cause', scopeKey: 's1', affectedScope: 'scope', jobNames: ['job-a'] },
  ]

  it('test 5 — stale recovery evidence (before the latest failure) cannot close the incident', () => {
    const occurrences: CronOccurrence[] = [
      { id: '1', jobName: 'job-a', occurredAt: '2026-08-24T10:00:00.000Z' },
    ]
    const receipts: RecoveryReceipt[] = [
      { rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T05:00:00.000Z' }, // before the failure
    ]
    const result = aggregateIncidents(occurrences, evidence, receipts)
    expect(result.incidents[0].status).toBe('OPEN')
  })

  it('test 6 — a verified recovery at/after the latest failure closes the incident', () => {
    const occurrences: CronOccurrence[] = [
      { id: '1', jobName: 'job-a', occurredAt: '2026-08-24T10:00:00.000Z' },
    ]
    const receipts: RecoveryReceipt[] = [
      { rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T10:00:00.000Z' }, // exactly at
    ]
    const result = aggregateIncidents(occurrences, evidence, receipts)
    expect(result.incidents[0].status).toBe('RECOVERED')

    const receiptsAfter: RecoveryReceipt[] = [
      { rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T11:00:00.000Z' }, // after
    ]
    expect(aggregateIncidents(occurrences, evidence, receiptsAfter).incidents[0].status).toBe('RECOVERED')
  })

  it('test 7 — a new failure after a closing receipt reopens the incident', () => {
    const closedOccurrence: CronOccurrence[] = [
      { id: '1', jobName: 'job-a', occurredAt: '2026-08-24T10:00:00.000Z' },
    ]
    const receipts: RecoveryReceipt[] = [
      { rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T10:00:00.000Z' },
    ]
    expect(aggregateIncidents(closedOccurrence, evidence, receipts).incidents[0].status).toBe('RECOVERED')

    const reopenedOccurrences: CronOccurrence[] = [
      ...closedOccurrence,
      { id: '2', jobName: 'job-a', occurredAt: '2026-08-24T12:00:00.000Z' }, // new failure after the receipt
    ]
    const reopened = aggregateIncidents(reopenedOccurrences, evidence, receipts)
    expect(reopened.incidents[0].status).toBe('OPEN')
    expect(reopened.incidents[0].occurrenceCount).toBe(2)
  })
})

// ─── Test 8: determinism ─────────────────────────────────────────────────────

describe('aggregateIncidents — determinism', () => {
  it('same input produces byte-identical output', () => {
    const occurrences = buildAudited77CronOccurrences()
    const a = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)
    const b = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)
    expect(a).toEqual(b)
  })

  it('every occurrence ends up in exactly one incident', () => {
    const occurrences = buildAudited77CronOccurrences()
    const result = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)

    const seen = new Set<string>()
    for (const incident of result.incidents) for (const id of incident.itemIds) seen.add(id)

    expect(seen.size).toBe(occurrences.length)
    for (const occ of occurrences) expect(seen.has(occ.id)).toBe(true)
  })
})
