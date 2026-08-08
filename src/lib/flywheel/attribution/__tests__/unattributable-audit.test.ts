/**
 * The stranded-action audit and its handoff — Issue #859, Codex P1 on PR #862.
 *
 * Counting unattributable actions in a cron summary is not reporting them.
 * CLAUDE.md §3: a finding the system cannot fix itself has to reach a human
 * through the same pipeline as everything else, carrying what / how / href.
 */

import { describe, it, expect, vi } from 'vitest'
import { auditUnattributableActions } from '../unattributable-audit'

interface Row {
  id: string
  client_id: string
  flywheel: string
  expected_metric: string
  action_type: string | null
  executed_at: string | null
}

function fakeSupabase(rows: Row[] | null, error: { message: string } | null = null) {
  const inSpy = vi.fn()
  const builder = {
    select: () => builder,
    not: () => builder,
    order: () => builder,
    in: (col: string, vals: unknown[]) => {
      inSpy(col, vals)
      return builder
    },
    then: (res: (v: { data: Row[] | null; error: unknown }) => unknown) =>
      Promise.resolve({ data: rows, error }).then(res),
  }
  return {
    client: { from: () => builder } as never,
    inSpy,
  }
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'a1',
    client_id: 'c1',
    flywheel: 'geo',
    expected_metric: 'seo.gsc.clicks',
    action_type: 'geo.deploy_directive',
    executed_at: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

describe('auditUnattributableActions', () => {
  it('finds an action whose metric owner cannot load its flywheel', async () => {
    const { client } = fakeSupabase([row()])

    const found = await auditUnattributableActions(client)

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      action_id: 'a1',
      client_id: 'c1',
      flywheel: 'geo',
      expected_metric: 'seo.gsc.clicks',
    })
  })

  it('ignores actions the flywheel_metrics evaluator owns', async () => {
    const { client } = fakeSupabase([
      row({ id: 'a2', expected_metric: 'geo.query.mention_rate' }),
      row({ id: 'a3', flywheel: 'ads', expected_metric: 'ads.account.roas' }),
    ])

    expect(await auditUnattributableActions(client)).toEqual([])
  })

  it('ignores a GSC metric on a flywheel the bridge does load', async () => {
    const { client } = fakeSupabase([row({ flywheel: 'seo' })])

    expect(await auditUnattributableActions(client)).toEqual([])
  })

  it('scopes to the given clients when asked', async () => {
    const { client, inSpy } = fakeSupabase([])

    await auditUnattributableActions(client, ['c1', 'c2'])

    expect(inSpy).toHaveBeenCalledWith('client_id', ['c1', 'c2'])
  })

  it('does not filter by client when no ids are given', async () => {
    const { client, inSpy } = fakeSupabase([])

    await auditUnattributableActions(client)

    expect(inSpy).not.toHaveBeenCalled()
  })

  it('throws on a query failure instead of reporting "none found"', async () => {
    // "nothing is stranded" and "we could not check" must not look the same.
    const { client } = fakeSupabase(null, { message: 'connection reset' })

    await expect(auditUnattributableActions(client)).rejects.toThrow(/connection reset/)
  })

  it('uses the same routing rule as the writers, not a copy of it', async () => {
    // Feed it one of each state; only the unattributable one comes back.
    const { client } = fakeSupabase([
      row({ id: 'own', flywheel: 'geo', expected_metric: 'geo.query.mention_rate' }),
      row({ id: 'defer', flywheel: 'seo', expected_metric: 'seo.gsc.clicks' }),
      row({ id: 'stranded', flywheel: 'social', expected_metric: 'seo.gsc.impressions' }),
    ])

    const found = await auditUnattributableActions(client)

    expect(found.map(f => f.action_id)).toEqual(['stranded'])
  })
})
