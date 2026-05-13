import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { AiVisibilityCollector } from '../ai-visibility-collector'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-ai-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

interface SnapshotRow {
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  week_of: string
}

function makeSupabase(opts: { snapshot?: SnapshotRow | null } = {}): SupabaseClient {
  const { snapshot = null } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'ai_visibility_snapshots') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: snapshot ? [snapshot] : [],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — basic shape', () => {
  it('returns { score, findings } with score in 0–100', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 8, total_runs: 10, week_of: '2026-05-12' },
    })
    const result = await new AiVisibilityCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(Array.isArray(result.findings)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// No snapshot data
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — no data', () => {
  it('returns score=0 and not_mentioned_by_ai finding when no snapshot exists', async () => {
    const supabase = makeSupabase({ snapshot: null })
    const { score, findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(0)
    const f = findings.find(x => x.finding_type === 'brand_not_mentioned')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
  })

  it('returns score=0 and not_mentioned_by_ai when mentions_count=0', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: null, mentions_count: 0, total_runs: 10, week_of: '2026-05-12' },
    })
    const { score, findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(0)
    expect(findings.find(x => x.finding_type === 'brand_not_mentioned')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Good visibility
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — good visibility', () => {
  it('returns score > 50 when avg_rank=2 and 80% mention rate', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 8, total_runs: 10, week_of: '2026-05-12' },
    })
    const { score } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeGreaterThan(50)
  })

  it('returns score=100 when avg_rank=1 and 100% mention rate', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 1, mentions_count: 10, total_runs: 10, week_of: '2026-05-12' },
    })
    const { score } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// low_ai_rank finding
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — low rank', () => {
  it('emits low_ai_rank (high) when avg_rank > 3', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 4, mentions_count: 5, total_runs: 10, week_of: '2026-05-12' },
    })
    const { findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'low_ai_rank')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('does NOT emit low_ai_rank when avg_rank <= 2', async () => {
    const supabase = makeSupabase({
      snapshot: { avg_rank: 2, mentions_count: 6, total_runs: 10, week_of: '2026-05-12' },
    })
    const { findings } = await new AiVisibilityCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(findings.find(x => x.finding_type === 'low_ai_rank')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Supabase failure — graceful degradation
// ---------------------------------------------------------------------------

describe('AiVisibilityCollector.collect() — DB failure', () => {
  it('returns degraded { score: 0, findings: [] } when Supabase throws', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error('DB error')),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const result = await new AiVisibilityCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBe(0)
    expect(result.findings).toHaveLength(0)
  })
})
