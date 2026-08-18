import { describe, expect, it } from 'vitest'
import { autoFetchMetricValue } from '../auto-fetch'

/**
 * `ai_visibility_score` auto-fetch was SEVERED (spec
 * 2026-08-19-ai-tracker-decommission-v1.md, 组 R). It previously read
 * industry_ai_visibility_snapshots (system C = industry averages) and presented
 * that as a per-client score in Goals — a masquerade. A client-level source
 * from M1 is P31.X.4. Until then this metric has no auto source: the switch
 * falls through to the default branch and returns ok:false, which is the honest
 * state (Goals' ai_visibility_score stays empty rather than showing an industry
 * average dressed up as a client measurement).
 */
describe('autoFetchMetricValue("ai_visibility_score") — severed (组 R)', () => {
  const supabase = {
    from: () => {
      throw new Error('no table should be queried for ai_visibility_score after SEVER')
    },
  } as any

  it('returns ok:false + severed:true (a removed source, not a fetch failure)', async () => {
    const result = await autoFetchMetricValue(supabase, 'client-1', 'ai_visibility_score')
    expect(result.ok).toBe(false)
    // `severed` lets the refresh cron skip it instead of counting a daily failure,
    // and clear the stale industry-average value (see goal-current-value-refresh).
    expect(result).toMatchObject({ ok: false, severed: true })
    if (!result.ok) expect(result.reason).toMatch(/severed/)
  })

  it('does not read any industry_ai_visibility_* table (no masquerade source)', async () => {
    // If the severed case still queried system C, `from` above would throw and
    // this would reject. A clean ok:false proves the DB is never touched.
    await expect(
      autoFetchMetricValue(supabase, 'client-1', 'ai_visibility_score'),
    ).resolves.toMatchObject({ ok: false })
  })
})
