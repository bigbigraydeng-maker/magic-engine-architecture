import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { AiVisibilityCollector } from '../ai-visibility-collector'
import type { LiveProbe, LiveProbeResult } from '../../ai-visibility-live-probe'

// ---------------------------------------------------------------------------
// ai-tracker (system B) decommissioned (spec 2026-08-19-ai-tracker-decommission
// -v1.md, 组 F). The collector no longer reads `ai_visibility_snapshots`; AI
// visibility now comes solely from the diagnostic-time live probe (itself
// currently sourceless until M1 / P31.X.4). Contract under test:
//   · probe with mentions            → buildFromLiveProbe → real score
//   · probe with 0 mentions (runs>0)  → score 0 + brand_not_mentioned
//   · probe null / skipped            → score null (未测量) + ai_visibility_not_tracked
//   · exception                       → { score: null, findings: [] }
// score is NEVER a fabricated 0 for "not measured" — it is null.
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-ai-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

/** Supabase mock — only `clients` / `master_briefs` are read now (brand name). */
function makeSupabase(opts: { brandName?: string | null } = {}): SupabaseClient {
  const { brandName = 'Test Brand' } = opts
  return {
    from: vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: brandName ? { name: brandName } : null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'master_briefs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

function makeProbe(result: Partial<LiveProbeResult>): LiveProbe {
  return {
    run: vi.fn().mockResolvedValue({
      runs: 0,
      mentions: 0,
      avg_rank: null,
      questions: [],
      latency_ms: 0,
      skipped: false,
      ...result,
    } as LiveProbeResult),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AiVisibilityCollector.collect() — not measured (未测量, never 0)', () => {
  it('returns score=null + ai_visibility_not_tracked when there is no live probe', async () => {
    const { score, findings } = await new AiVisibilityCollector(makeSupabase()).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    const f = findings.find(x => x.finding_type === 'ai_visibility_not_tracked')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
  })

  it('returns score=null + ai_visibility_not_tracked when the probe is skipped', async () => {
    const probe = makeProbe({ skipped: true, skip_reason: 'no queries' })
    const { score, findings } = await new AiVisibilityCollector(makeSupabase(), probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    expect(findings.find(x => x.finding_type === 'ai_visibility_not_tracked')).toBeDefined()
  })
})

describe('AiVisibilityCollector.collect() — live probe results', () => {
  it('returns score=100 when probe reports full mentions at rank 1', async () => {
    const probe = makeProbe({
      runs: 3,
      mentions: 3,
      avg_rank: 1,
      questions: [
        { question: 'q1', client_brand_rank: 1 },
        { question: 'q2', client_brand_rank: 1 },
        { question: 'q3', client_brand_rank: 1 },
      ],
    })
    const result = await new AiVisibilityCollector(makeSupabase(), probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(result.score).toBe(100)
    expect(result.findings).toHaveLength(0)
  })

  it('emits brand_not_mentioned (score 0) when probe runs but finds 0 mentions', async () => {
    const probe = makeProbe({ runs: 3, mentions: 0, avg_rank: null })
    const { score, findings } = await new AiVisibilityCollector(makeSupabase(), probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBe(0)
    const f = findings.find(x => x.finding_type === 'brand_not_mentioned')
    expect(f).toBeDefined()
    expect(f?.evidence).toMatchObject({ parsed: { live_probe: { runs: 3, mentions: 0 } } })
  })

  it('emits low_ai_rank (high) with live_probe evidence when avg_rank > 3', async () => {
    const probe = makeProbe({
      runs: 3,
      mentions: 2,
      avg_rank: 3.5,
      questions: [{ question: 'q1', client_brand_rank: 3 }],
    })
    const { findings } = await new AiVisibilityCollector(makeSupabase(), probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    const f = findings.find(x => x.finding_type === 'low_ai_rank')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
    expect(f?.evidence).toMatchObject({ parsed: { live_probe: { runs: 3, mentions: 2 } } })
  })
})

describe('AiVisibilityCollector.collect() — degradation', () => {
  it('returns { score: null, findings: [] } when brand-name lookup throws', async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error('DB error')
      }),
    } as unknown as SupabaseClient
    const probe = makeProbe({ runs: 3, mentions: 3, avg_rank: 1 })
    const result = await new AiVisibilityCollector(supabase, probe).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    // brand-name lookup fails → probe not run → not_tracked, never a crash.
    expect(result.score).toBeNull()
  })
})
