import { describe, it, expect } from 'vitest'
import { getWeakSpotOpportunities } from '../topic-selector'

/**
 * getWeakSpotOpportunities previously derived blog topics from ai-tracker
 * (system B) run history (`ai_visibility_queries` + `ai_visibility_runs`) and
 * enriched them with DataForSEO keyword data. ai-tracker is decommissioned
 * (spec 2026-08-19-ai-tracker-decommission-v1.md, 组 H); with no AI run history
 * there are no weak spots to derive, so the function is a stub returning [] until
 * M1 (geo_*) re-wire (P31.X.4). Callers (weekly-blog, blog/opportunities) treat
 * [] as "skipped_no_topic" — the same as a client with no tracked queries before.
 *
 * The full three-mode classification / SEMrush-enrichment test suite was removed
 * with the logic it covered; P31.X.4 re-introduces tests against the M1 source.
 */
describe('getWeakSpotOpportunities (degraded → [] pending M1, 组 H)', () => {
  it('returns [] for a normal client id', async () => {
    expect(await getWeakSpotOpportunities('client-1')).toEqual([])
  })

  it('returns [] regardless of limit / lookback / includeSemrush args', async () => {
    expect(await getWeakSpotOpportunities('client-1', 20, 10, true)).toEqual([])
    expect(await getWeakSpotOpportunities('client-1', 5, 3, false)).toEqual([])
  })

  it('returns [] for an empty client id (guard preserved)', async () => {
    expect(await getWeakSpotOpportunities('')).toEqual([])
  })

  it('never touches the database (no ai_visibility_* reads)', async () => {
    // Pure stub: no supabase mock is set up, yet the call resolves cleanly.
    await expect(getWeakSpotOpportunities('client-xyz')).resolves.toEqual([])
  })
})
