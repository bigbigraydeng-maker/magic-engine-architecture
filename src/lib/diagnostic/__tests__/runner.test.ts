import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mocks — before imports (hoisting)
// ---------------------------------------------------------------------------

const mockSeoCollect = vi.fn()

vi.mock('../collectors/seo-collector', () => ({
  SeoCollector: vi.fn(() => ({ collect: mockSeoCollect })),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { runDiagnostic, createDiagnosticRun, executeDiagnosticRun, isValidModule } from '../runner'

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

interface MockOptions {
  runId?: string
  clientDomain?: string
  insertError?: { message: string } | null
  updateError?: { message: string } | null
}

function makeSupabase(opts: MockOptions = {}): SupabaseClient {
  const {
    runId = 'run-test-123',
    clientDomain = 'test.co.nz',
    insertError = null,
    updateError = null,
  } = opts

  const capturedUpdates: unknown[] = []

  const mock = {
    _updates: capturedUpdates,
    from: vi.fn((table: string) => {
      if (table === 'diagnostic_runs') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue(
                insertError
                  ? { data: null, error: insertError }
                  : { data: { id: runId }, error: null },
              ),
            }),
          }),
          update: vi.fn().mockImplementation((data: unknown) => {
            capturedUpdates.push(data)
            return {
              eq: vi.fn().mockResolvedValue(
                updateError ? { error: updateError } : { error: null },
              ),
            }
          }),
        }
      }
      if (table === 'diagnostic_findings') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { domain: clientDomain },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'keywords') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }
      }
      return { insert: vi.fn(), select: vi.fn(), update: vi.fn() }
    }),
  }

  return mock as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockSeoCollect.mockResolvedValue({ score: 75, findings: [] })
})

// ---------------------------------------------------------------------------
// isValidModule
// ---------------------------------------------------------------------------

describe('isValidModule()', () => {
  it('returns true for "seo"', () => expect(isValidModule('seo')).toBe(true))
  it('returns false for unknown modules', () => {
    expect(isValidModule('ads')).toBe(false)
    expect(isValidModule('')).toBe(false)
    expect(isValidModule('SEO')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createDiagnosticRun
// ---------------------------------------------------------------------------

describe('createDiagnosticRun()', () => {
  it('inserts a pending run and returns run_id', async () => {
    const supabase = makeSupabase({ runId: 'run-999' })
    const id = await createDiagnosticRun(supabase, 'client-1', 'seo')
    expect(id).toBe('run-999')
    expect(supabase.from).toHaveBeenCalledWith('diagnostic_runs')
  })

  it('throws when insert fails', async () => {
    const supabase = makeSupabase({ insertError: { message: 'DB down' } })
    await expect(createDiagnosticRun(supabase, 'client-1', 'seo')).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — status transitions
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — happy path', () => {
  it('transitions run from pending → running → completed', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    // Two updates should have occurred: running, then completed
    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(updates[0]).toMatchObject({ status: 'running' })
    expect(updates[updates.length - 1]).toMatchObject({ status: 'completed' })
  })

  it('calls SeoCollector.collect()', async () => {
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')
    expect(mockSeoCollect).toHaveBeenCalledOnce()
  })

  it('overall_score equals seo score when only seo runs (re-normalised weight)', async () => {
    mockSeoCollect.mockResolvedValue({ score: 80, findings: [] })
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    const completedUpdate = updates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'completed',
    )
    expect(completedUpdate?.overall_score).toBe(80)
  })

  it('writes findings to diagnostic_findings table', async () => {
    const finding = {
      client_id: 'client-1', dimension: 'seo' as const,
      finding_type: 'low_domain_rank' as const, severity: 'high' as const,
      title: 'Low DA', description: 'test', evidence: null,
      recommendation: 'fix it', fix_type: 'fde_manual' as const, priority_score: 75,
    }
    mockSeoCollect.mockResolvedValue({ score: 40, findings: [finding] })

    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    expect(supabase.from).toHaveBeenCalledWith('diagnostic_findings')
  })
})

// ---------------------------------------------------------------------------
// executeDiagnosticRun — failure path
// ---------------------------------------------------------------------------

describe('executeDiagnosticRun() — collector failure', () => {
  it('marks run as failed when collector throws', async () => {
    mockSeoCollect.mockRejectedValue(new Error('collector exploded'))
    const supabase = makeSupabase()
    await executeDiagnosticRun(supabase, 'run-test-123', 'client-1', 'seo')

    const updates = (supabase as unknown as { _updates: unknown[] })._updates
    const failedUpdate = updates.find(
      (u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && (u as Record<string, unknown>).status === 'failed',
    )
    expect(failedUpdate).toBeDefined()
    expect(typeof failedUpdate?.error_message).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// runDiagnostic — convenience wrapper
// ---------------------------------------------------------------------------

describe('runDiagnostic()', () => {
  it('creates a run and returns its id', async () => {
    const supabase = makeSupabase({ runId: 'run-xyz' })
    const id = await runDiagnostic(supabase, 'client-1', 'seo')
    expect(id).toBe('run-xyz')
  })

  it('completes without throwing on success', async () => {
    const supabase = makeSupabase()
    await expect(runDiagnostic(supabase, 'client-1', 'seo')).resolves.not.toThrow()
  })
})
