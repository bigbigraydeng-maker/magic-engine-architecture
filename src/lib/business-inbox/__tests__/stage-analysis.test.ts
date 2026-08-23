/**
 * 只读阶段分析取数 —— 隔离与「空的两种来路」在这层单独钉死。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { resolveStageAnalysis } from '../stage-analysis'
import { supabaseAdmin } from '@/lib/supabase'

const mockFrom = vi.mocked(supabaseAdmin.from)
const CTS = 'c0000000-0000-0000-0000-000000000000'

interface TableResult {
  data: unknown
  error: unknown
}

function tableStub(result: TableResult) {
  const p = Promise.resolve(result)
  const q: Record<string, unknown> = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    then: (onF: (v: TableResult) => unknown, onR?: (e: unknown) => unknown) => p.then(onF, onR),
  }
  return q
}

function stubTables(map: Record<string, TableResult>) {
  const stubs: Record<string, ReturnType<typeof tableStub>> = {}
  for (const [table, result] of Object.entries(map)) stubs[table] = tableStub(result)
  mockFrom.mockImplementation((table: string) => {
    stubs[table] ??= tableStub({ data: [], error: null })
    return stubs[table] as never
  })
  return stubs
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.clearAllMocks())

describe('resolveStageAnalysis', () => {
  it('never queries when there are no contact ids', async () => {
    const map = await resolveStageAnalysis(CTS, [])
    expect(map.size).toBe(0)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('binds both reads to the given client id', async () => {
    const stubs = stubTables({
      client_pipeline_stages: { data: [], error: null },
      contacts: { data: [], error: null },
    })

    await resolveStageAnalysis(CTS, ['contact-1'])

    expect(stubs.contacts.eq).toHaveBeenCalledWith('client_id', CTS)
    expect(stubs.contacts.in).toHaveBeenCalledWith('id', ['contact-1'])
    expect(stubs.client_pipeline_stages.eq).toHaveBeenCalledWith('client_id', CTS)
  })

  it('maps stage to its label and omits contacts whose stage is empty', async () => {
    stubTables({
      client_pipeline_stages: { data: [{ stage_key: 'quoted', label: '已报价' }], error: null },
      contacts: {
        data: [
          { id: 'staged', stage: 'quoted', stage_updated_at: '2026-08-01T00:00:00Z' },
          { id: 'unstaged', stage: null, stage_updated_at: null },
        ],
        error: null,
      },
    })

    const map = await resolveStageAnalysis(CTS, ['staged', 'unstaged'])

    expect(map.get('staged')).toMatchObject({ stage: 'quoted', stageLabel: '已报价' })
    expect(map.has('unstaged')).toBe(false)
  })

  it('falls back to the raw slug when the pipeline label was removed', async () => {
    stubTables({
      client_pipeline_stages: { data: [], error: null },
      contacts: { data: [{ id: 'c', stage: 'contacted', stage_updated_at: null }], error: null },
    })

    const map = await resolveStageAnalysis(CTS, ['c'])

    expect(map.get('c')).toMatchObject({ stage: 'contacted', stageLabel: 'contacted' })
  })
})
