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

    const byRootCause = new Map(result.incidents.map((i) => [i.rootCauseId, i]))

    const meta = byRootCause.get('meta-credential-token')
    expect(meta?.occurrenceCount).toBe(72) // 48 + 24
    expect(meta?.affectedJobs.sort()).toEqual(['meta-leads-sync', 'social-comment-autoreply'])

    const marketIntel = byRootCause.get('market-intel-feed-403')
    expect(marketIntel?.occurrenceCount).toBe(1)

    const cms = byRootCause.get('cms-cross-client-connector')
    expect(cms?.occurrenceCount).toBe(1)

    // Not named in the audit body's 3 categories -> each is its own
    // self-evidenced, single-job incident, not merged or invented.
    for (const job of ['winner-reel-sync-daily', 'ad-readback-sweep', 'google-data-pullback-daily']) {
      const standalone = byRootCause.get(`job:${job}`)
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

  // B1 — PM-facing text must be Chinese, not an internal English diagnostic sentence.
  it('every incident\'s PM-facing rootCause is Chinese, and the payload still says fixture/non-live', () => {
    const occurrences = buildAudited77CronOccurrences()
    const result = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)
    const CJK = /[一-鿿]/
    for (const incident of result.incidents) {
      expect(incident.rootCause).toMatch(CJK)
      expect(incident.affectedScope).toMatch(CJK)
    }
  })

  // B4 — the audit body proves a shared cause across jobs, not a specific
  // affected-customer set; the fixture must never claim a universal scope.
  it('named incidents never claim a specific/universal affected-customer set the audit did not prove', () => {
    const occurrences = buildAudited77CronOccurrences()
    const result = aggregateIncidents(occurrences, AUDITED_77_CORRELATION_EVIDENCE)
    const overclaimPatterns = [/every client/i, /所有客户/, /全部客户/, /每一个/, /every .* connected/i]
    for (const incident of result.incidents) {
      for (const pattern of overclaimPatterns) {
        expect(incident.affectedScope).not.toMatch(pattern)
      }
      expect(incident.affectedScope).toMatch(/UNKNOWN|未知/)
    }
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
    expect(new Set(result.incidents.map((i) => i.incidentKey)).size).toBe(2)
    expect(result.incidents.every((i) => i.rootCauseId === 'shared-cause')).toBe(true)
    expect(result.incidents.map((i) => i.scopeKey).sort()).toEqual(['scope-a', 'scope-b'])
  })
})

// ─── Test B3: composite key must not collide when an id contains "::" ───────

describe('aggregateIncidents — incident key cannot collide across "::"-containing ids (B3)', () => {
  it('keeps ("a::b","c") and ("a","b::c") as two distinct incidents, not one merged incident', () => {
    const evidence: IncidentCorrelationEvidence[] = [
      { rootCauseId: 'a::b', rootCause: 'X', scopeKey: 'c', affectedScope: 'A', jobNames: ['job-x'] },
      { rootCauseId: 'a', rootCause: 'Y', scopeKey: 'b::c', affectedScope: 'B', jobNames: ['job-y'] },
    ]
    const occurrences: CronOccurrence[] = [
      { id: '1', jobName: 'job-x', occurredAt: '2026-08-24T00:00:00.000Z' },
      { id: '2', jobName: 'job-y', occurredAt: '2026-08-24T00:00:00.000Z' },
    ]
    const result = aggregateIncidents(occurrences, evidence)

    expect(result.incidents).toHaveLength(2)
    const keys = new Set(result.incidents.map((i) => i.incidentKey))
    expect(keys.size).toBe(2) // the two composite tuples must not serialise to the same key
    expect(result.incidents.find((i) => i.rootCauseId === 'a::b')?.occurrenceCount).toBe(1)
    expect(result.incidents.find((i) => i.rootCauseId === 'a' && i.scopeKey === 'b::c')?.occurrenceCount).toBe(1)
  })
})

// ─── Test B2: conflicting evidence for the same job must fail closed ────────

describe('aggregateIncidents — conflicting correlation evidence fails closed (B2)', () => {
  it('does not silently pick the last mapping when the same job appears in two contradictory evidence rows', () => {
    const evidence: IncidentCorrelationEvidence[] = [
      { rootCauseId: 'cause-1', rootCause: 'X', scopeKey: 's1', affectedScope: 'A', jobNames: ['job-a'] },
      { rootCauseId: 'cause-2', rootCause: 'Y', scopeKey: 's2', affectedScope: 'B', jobNames: ['job-a'] },
    ]
    const occurrences: CronOccurrence[] = [
      { id: '1', jobName: 'job-a', occurredAt: '2026-08-24T00:00:00.000Z' },
      { id: '2', jobName: 'job-a', occurredAt: '2026-08-24T01:00:00.000Z' },
    ]
    const result = aggregateIncidents(occurrences, evidence)

    expect(result.incidents).toHaveLength(1)
    const incident = result.incidents[0]
    expect(incident.rootCauseId).not.toBe('cause-1')
    expect(incident.rootCauseId).not.toBe('cause-2')
    expect(incident.affectedScope).toContain('UNKNOWN')
    expect(incident.occurrenceCount).toBe(2) // both occurrences of the conflicted job still accounted for, together
  })

  it('a conflicted job cannot consume a recovery receipt aimed at either of the contradictory mappings', () => {
    const evidence: IncidentCorrelationEvidence[] = [
      { rootCauseId: 'cause-1', rootCause: 'X', scopeKey: 's1', affectedScope: 'A', jobNames: ['job-a'] },
      { rootCauseId: 'cause-2', rootCause: 'Y', scopeKey: 's2', affectedScope: 'B', jobNames: ['job-a'] },
    ]
    const occurrences: CronOccurrence[] = [{ id: '1', jobName: 'job-a', occurredAt: '2026-08-24T00:00:00.000Z' }]
    const receipts: RecoveryReceipt[] = [
      { rootCauseId: 'cause-1', scopeKey: 's1', verifiedAt: '2026-08-24T01:00:00.000Z' },
      { rootCauseId: 'cause-2', scopeKey: 's2', verifiedAt: '2026-08-24T01:00:00.000Z' },
    ]
    const result = aggregateIncidents(occurrences, evidence, receipts)
    expect(result.incidents[0].status).toBe('RECOVERY_UNKNOWN')
  })

  it('does not treat identical duplicate evidence for the same job as a conflict', () => {
    const evidence: IncidentCorrelationEvidence[] = [
      { rootCauseId: 'cause-1', rootCause: 'X', scopeKey: 's1', affectedScope: 'A', jobNames: ['job-a'] },
      { rootCauseId: 'cause-1', rootCause: 'X', scopeKey: 's1', affectedScope: 'A', jobNames: ['job-a'] },
    ]
    const occurrences: CronOccurrence[] = [{ id: '1', jobName: 'job-a', occurredAt: '2026-08-24T00:00:00.000Z' }]
    const result = aggregateIncidents(occurrences, evidence)

    expect(result.incidents).toHaveLength(1)
    expect(result.incidents[0].rootCauseId).toBe('cause-1')
  })
})

// ─── Test B5: malformed timestamps must never produce a false RECOVERED ─────

describe('aggregateIncidents — malformed timestamps fail closed, never RECOVERED (B5)', () => {
  const evidence: IncidentCorrelationEvidence[] = [
    { rootCauseId: 'c1', rootCause: 'cause', scopeKey: 's1', affectedScope: 'scope', jobNames: ['job-a'] },
  ]

  it('an invalid occurrence timestamp keeps the incident RECOVERY_UNKNOWN even with a receipt that would otherwise close it', () => {
    const occurrences: CronOccurrence[] = [{ id: '1', jobName: 'job-a', occurredAt: 'not-a-real-timestamp' }]
    const receipts: RecoveryReceipt[] = [
      { rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T23:59:59.000Z' },
    ]
    const result = aggregateIncidents(occurrences, evidence, receipts)
    expect(result.incidents[0].status).toBe('RECOVERY_UNKNOWN')
  })

  it('an invalid receipt verifiedAt is ignored, not treated as a closing recovery', () => {
    const occurrences: CronOccurrence[] = [{ id: '1', jobName: 'job-a', occurredAt: '2026-08-24T10:00:00.000Z' }]
    const receipts: RecoveryReceipt[] = [{ rootCauseId: 'c1', scopeKey: 's1', verifiedAt: 'also-not-a-timestamp' }]
    const result = aggregateIncidents(occurrences, evidence, receipts)
    expect(result.incidents[0].status).toBe('RECOVERY_UNKNOWN')
  })

  it('a valid stale receipt still leaves the incident OPEN, and a valid at/after receipt still closes it (unaffected by the parsing change)', () => {
    const occurrences: CronOccurrence[] = [{ id: '1', jobName: 'job-a', occurredAt: '2026-08-24T10:00:00.000Z' }]
    const stale: RecoveryReceipt[] = [{ rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T05:00:00.000Z' }]
    expect(aggregateIncidents(occurrences, evidence, stale).incidents[0].status).toBe('OPEN')

    const valid: RecoveryReceipt[] = [{ rootCauseId: 'c1', scopeKey: 's1', verifiedAt: '2026-08-24T10:00:00.000Z' }]
    expect(aggregateIncidents(occurrences, evidence, valid).incidents[0].status).toBe('RECOVERED')
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
    expect(result.incidents[0].rootCause).toContain('核实失败')
    expect(result.incidents[0].affectedScope).toContain('UNKNOWN')
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
