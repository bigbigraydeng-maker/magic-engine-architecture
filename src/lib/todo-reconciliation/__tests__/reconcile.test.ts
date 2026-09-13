/**
 * Todo Reconciliation Gate — WP1 (#1169) core reconciliation tests.
 */

import { describe, expect, it } from 'vitest'
import { reconcile } from '../reconcile'
import { buildAudited280, AUDITED_280_ASOF } from '../fixtures/audited-280'

describe('audited-280 fixture', () => {
  it('reproduces the exact 280-row composition from the #1169 audit table', () => {
    const items = buildAudited280()
    expect(items).toHaveLength(280)

    const bySource = new Map<string, number>()
    for (const item of items) {
      bySource.set(item.source, (bySource.get(item.source) ?? 0) + 1)
    }
    expect(Object.fromEntries(bySource)).toEqual({
      manual_item: 140,
      cron_failure: 77,
      execution_card: 40,
      reel_review: 14,
      blog_draft: 6,
      gbp_setup: 3,
    })
  })

  it('is deterministic — building it twice yields the same ids and shape', () => {
    const a = buildAudited280()
    const b = buildAudited280()
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id))
    expect(a).toEqual(b)
  })
})

describe('reconcile — root-cause dedupe', () => {
  it('collapses 77 raw cron failures into 7 clusters, one per job name, occurrence counts preserved', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const cronClusters = result.unresolvedClusters.filter((c) => c.source === 'cron_failure')
    expect(cronClusters).toHaveLength(7)
    expect(cronClusters.reduce((s, c) => s + c.occurrenceCount, 0)).toBe(77)

    const byJob = new Map(cronClusters.map((c) => [c.rootCauseKey, c.occurrenceCount]))
    expect(byJob.get('cron:social-comment-autoreply')).toBe(48)
    expect(byJob.get('cron:meta-leads-sync')).toBe(24)
    expect(byJob.get('cron:market-intel-daily')).toBe(1)
  })

  it('never produces a cluster count greater than the raw rows that fed it', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)
    const totalOccurrences = result.unresolvedClusters.reduce((s, c) => s + c.occurrenceCount, 0)
    expect(totalOccurrences).toBeLessThanOrEqual(result.totalRaw)
    expect(totalOccurrences + result.totalSuppressed).toBe(result.totalRaw)
  })
})

describe('reconcile — terminal / intentional / stale suppression', () => {
  it('suppresses reels that already reached a terminal status as TERMINAL_COMPLETED, keeps in_review ones open', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const openReels = result.unresolvedClusters.filter((c) => c.source === 'reel_review')
    expect(openReels).toHaveLength(5)
    expect(openReels.every((c) => c.reason === 'GENUINE_UNRESOLVED')).toBe(true)

    const suppressedReels = result.suppressed.find((g) => g.reason === 'TERMINAL_COMPLETED')
    expect(suppressedReels?.count).toBe(9)
  })

  it('suppresses intentional SEO states (noindex/redirect/canonical) without turning them into human todo items', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const intentional = result.suppressed.find((g) => g.reason === 'INTENTIONAL_STATE')
    // oztop: 10 noindex + 3 redirect + 1 duplicate + 1 alternate = 15, plus CTS's 1 duplicate_canonical = 16
    expect(intentional?.count).toBe(16)

    const seoUnresolved = result.unresolvedClusters.filter((c) => c.category === 'url_indexing')
    const suppressedVerdicts = ['intentional_noindex', 'redirect', 'duplicate_canonical', 'alternate_canonical']
    expect(seoUnresolved.every((c) => suppressedVerdicts.every((v) => !c.rootCauseKey.endsWith(`:${v}`)))).toBe(true)
  })

  it('suppresses same-day "unknown to Google" rows as NOT_YET_DUE but keeps older ones unresolved', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const notYetDue = result.suppressed.find((g) => g.reason === 'NOT_YET_DUE')
    expect(notYetDue?.count).toBe(4) // CTS same-day unknown_to_google

    const oztopUnknown = result.unresolvedClusters.find((c) => c.rootCauseKey === 'url_indexing:oztop:unknown_to_google')
    expect(oztopUnknown?.occurrenceCount).toBe(4)
  })
})

describe('reconcile — check-failed must stay visible, never read as "no problem"', () => {
  it('keeps a metric the system could not verify as CHECK_FAILED_UNRESOLVED, not suppressed', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const untrusted = result.unresolvedClusters.find((c) => c.category === 'leads_metric_untrusted')
    expect(untrusted).toBeDefined()
    expect(untrusted?.reason).toBe('CHECK_FAILED_UNRESOLVED')

    const suppressedAsUntrusted = result.suppressed.find((g) => g.reason === 'CHECK_FAILED_UNRESOLVED')
    expect(suppressedAsUntrusted).toBeUndefined()
  })
})

describe('reconcile — GBP connector false-positive removal', () => {
  it('suppresses already-connected CTS/oztop GBP setup tasks, keeps the real Roman OAuth gate', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const connected = result.suppressed.find((g) => g.reason === 'CONNECTOR_ALREADY_CONNECTED')
    expect(connected?.count).toBe(2)

    const gbpUnresolved = result.unresolvedClusters.filter((c) => c.source === 'gbp_setup')
    expect(gbpUnresolved).toHaveLength(1)
    expect(gbpUnresolved[0].clientName).toBe('Roman')
    expect(gbpUnresolved[0].reason).toBe('HUMAN_DECISION_REQUIRED')
  })
})

describe('reconcile — dedupe across sources and auto-executable exclusion', () => {
  it('flags the manual-lane blog-draft summary cards as DUPLICATE_WORK_ITEM (same work counted under blog_draft)', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const dup = result.suppressed.find((g) => g.reason === 'DUPLICATE_WORK_ITEM')
    expect(dup?.count).toBe(2)

    const blogDrafts = result.unresolvedClusters.filter((c) => c.source === 'blog_draft')
    expect(blogDrafts).toHaveLength(6) // the real drafts stay, individually
  })

  it('excludes me_auto execution cards from the human-unresolved count; keeps fde_manual ones', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const autoExcluded = result.suppressed.find((g) => g.reason === 'AUTO_EXECUTABLE_NOT_HUMAN_WORK')
    expect(autoExcluded?.count).toBe(25)

    const manualCards = result.unresolvedClusters.filter((c) => c.source === 'execution_card')
    expect(manualCards).toHaveLength(15)
  })
})

describe('reconcile — determinism and idempotency', () => {
  it('produces byte-identical output across repeated runs on the same input', () => {
    const items = buildAudited280()
    const first = reconcile(items, AUDITED_280_ASOF)
    const second = reconcile(items, AUDITED_280_ASOF)
    expect(first).toEqual(second)
  })

  it('every raw item ends up in exactly one place: a cluster or a suppressed group', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    const seen = new Set<string>()
    for (const c of result.unresolvedClusters) for (const id of c.itemIds) seen.add(id)
    for (const g of result.suppressed) for (const id of g.itemIds) seen.add(id)

    expect(seen.size).toBe(items.length)
    for (const item of items) expect(seen.has(item.id)).toBe(true)
  })
})

describe('reconcile — full audited-280 before/after summary', () => {
  it('matches the exact before/after shape Ray reviews', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)

    expect(result.totalRaw).toBe(280)
    // Manual sanity: unresolved clusters must be far fewer than 280 raw rows,
    // and every suppressed row must carry one of the known reason codes.
    expect(result.unresolvedClusters.length).toBeLessThan(60)
    const validReasons = new Set([
      'GENUINE_UNRESOLVED', 'HUMAN_DECISION_REQUIRED', 'CHECK_FAILED_UNRESOLVED',
      'INTENTIONAL_STATE', 'NOT_YET_DUE', 'CONNECTOR_ALREADY_CONNECTED',
      'DUPLICATE_WORK_ITEM', 'TERMINAL_COMPLETED', 'AUTO_EXECUTABLE_NOT_HUMAN_WORK',
    ])
    for (const g of result.suppressed) expect(validReasons.has(g.reason)).toBe(true)
    for (const c of result.unresolvedClusters) expect(validReasons.has(c.reason)).toBe(true)
  })
})

describe('reconcile — empty input', () => {
  it('returns an empty, well-formed result for zero items', () => {
    const result = reconcile([], AUDITED_280_ASOF)
    expect(result.totalRaw).toBe(0)
    expect(result.unresolvedClusters).toEqual([])
    expect(result.suppressed).toEqual([])
  })
})

// ─── Remediation (#1169, Build Control finding 1): Reel status fail-closed ────

describe('reconcile — Reel status must fail closed, not default to "done"', () => {
  function reel(reelStatus: string | undefined): import('../types').RawWorkItem {
    return {
      id: 'reel-x',
      source: 'reel_review',
      category: 'reel_review',
      clientId: null,
      clientName: 'oztop',
      rootCauseKey: 'reel:x',
      label: 'Social reel awaiting review',
      reelStatus,
    }
  }

  it('keeps a reel with a MISSING status visible as CHECK_FAILED_UNRESOLVED, never TERMINAL_COMPLETED', () => {
    const result = reconcile([reel(undefined)], AUDITED_280_ASOF)
    expect(result.suppressed).toEqual([])
    expect(result.unresolvedClusters).toHaveLength(1)
    expect(result.unresolvedClusters[0].reason).toBe('CHECK_FAILED_UNRESOLVED')
  })

  it('keeps a reel with an UNKNOWN/unvetted status visible as CHECK_FAILED_UNRESOLVED, never TERMINAL_COMPLETED', () => {
    const result = reconcile([reel('some_future_status_nobody_vetted')], AUDITED_280_ASOF)
    expect(result.suppressed).toEqual([])
    expect(result.unresolvedClusters).toHaveLength(1)
    expect(result.unresolvedClusters[0].reason).toBe('CHECK_FAILED_UNRESOLVED')
  })

  it('still suppresses the explicit terminal allowlist (published/approved/rejected)', () => {
    for (const status of ['published', 'approved', 'rejected']) {
      const result = reconcile([reel(status)], AUDITED_280_ASOF)
      expect(result.unresolvedClusters).toEqual([])
      expect(result.suppressed[0]?.reason).toBe('TERMINAL_COMPLETED')
    }
  })

  it('still keeps known open statuses GENUINE_UNRESOLVED', () => {
    const result = reconcile([reel('in_review')], AUDITED_280_ASOF)
    expect(result.unresolvedClusters[0].reason).toBe('GENUINE_UNRESOLVED')
  })
})

// ─── Remediation (#1169, Build Control finding 2): blog_draft_summary proof ───

describe('reconcile — blog_draft_summary dedupe must be proven by same-input evidence', () => {
  function summary(clientName: string | null): import('../types').RawWorkItem {
    return {
      id: 'summary-x',
      source: 'manual_item',
      category: 'blog_draft_summary',
      clientId: null,
      clientName,
      rootCauseKey: 'manual:blog_draft_summary:x',
      label: 'Blog draft awaiting review (summary card)',
    }
  }
  function blogDraft(clientName: string): import('../types').RawWorkItem {
    return {
      id: 'blog-x',
      source: 'blog_draft',
      category: 'blog_draft',
      clientId: null,
      clientName,
      rootCauseKey: 'blog_draft:x',
      label: `${clientName} blog draft awaiting review`,
    }
  }

  it('suppresses the summary as DUPLICATE_WORK_ITEM when a same-client blog_draft row is present in the same input', () => {
    const result = reconcile([summary('CTS'), blogDraft('CTS')], AUDITED_280_ASOF)
    const dup = result.suppressed.find((g) => g.reason === 'DUPLICATE_WORK_ITEM')
    expect(dup?.count).toBe(1)
    expect(dup?.itemIds).toEqual(['summary-x'])
  })

  it('keeps the summary visible as CHECK_FAILED_UNRESOLVED when no matching blog_draft detail exists in the input', () => {
    const result = reconcile([summary('CTS')], AUDITED_280_ASOF)
    expect(result.suppressed).toEqual([])
    expect(result.unresolvedClusters[0].reason).toBe('CHECK_FAILED_UNRESOLVED')
  })

  it('keeps the summary visible when the only blog_draft evidence present is for a DIFFERENT client', () => {
    const result = reconcile([summary('CTS'), blogDraft('oztop')], AUDITED_280_ASOF)
    expect(result.suppressed).toEqual([])
    const summaryCluster = result.unresolvedClusters.find((c) => c.category === 'blog_draft_summary')
    expect(summaryCluster?.reason).toBe('CHECK_FAILED_UNRESOLVED')
  })

  it('the frozen audited-280 fixture still suppresses both summaries — real evidence exists for both CTS and oztop', () => {
    const items = buildAudited280()
    const result = reconcile(items, AUDITED_280_ASOF)
    const dup = result.suppressed.find((g) => g.reason === 'DUPLICATE_WORK_ITEM')
    expect(dup?.count).toBe(2)
  })
})

// ─── Remediation (#1169, Build Control finding 3): Pacific/Auckland same-day ──

describe('reconcile — same-day check must use Pacific/Auckland, not UTC date slicing', () => {
  function unknownToGoogleRow(createdAt: string): import('../types').RawWorkItem {
    return {
      id: 'url-x',
      source: 'manual_item',
      category: 'url_indexing',
      clientId: null,
      clientName: 'oztop',
      rootCauseKey: 'url_indexing:oztop:unknown_to_google:x',
      label: 'oztop URL indexing verdict: unknown_to_google',
      verdict: 'unknown_to_google',
      createdAt,
    }
  }

  it('treats different UTC dates as the SAME day when they fall on the same Auckland calendar date (August = NZST, UTC+12)', () => {
    // 2026-08-23T13:00:00Z -> 2026-08-24 01:00 NZST (Aug 24 NZ)
    // 2026-08-24T00:00:00Z -> 2026-08-24 12:00 NZST (Aug 24 NZ) — same NZ day, different UTC date
    const result = reconcile([unknownToGoogleRow('2026-08-23T13:00:00.000Z')], '2026-08-24T00:00:00.000Z')
    expect(result.suppressed[0]?.reason).toBe('NOT_YET_DUE')
  })

  it('treats the same UTC date as DIFFERENT days when they fall on different Auckland calendar dates', () => {
    // 2026-08-24T20:00:00Z -> 2026-08-25 08:00 NZST (Aug 25 NZ)
    // 2026-08-24T01:00:00Z -> 2026-08-24 13:00 NZST (Aug 24 NZ) — same UTC date, different NZ day
    const result = reconcile([unknownToGoogleRow('2026-08-24T20:00:00.000Z')], '2026-08-24T01:00:00.000Z')
    expect(result.unresolvedClusters[0]?.reason).toBe('GENUINE_UNRESOLVED')
  })
})
