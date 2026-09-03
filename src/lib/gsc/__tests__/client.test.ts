/**
 * Unit tests for gsc/client.ts's page × query report capability.
 *
 * fetchGscPageQueryReport is deliberately pure: it takes an already-resolved
 * access token and must never touch token-manager / google-oauth (which would
 * mean it resolved, refreshed, or persisted a token itself) or the database.
 * The token-manager and google-oauth mocks below exist only to prove that —
 * every assertion that checks "not touched" would fail loudly if the function
 * secretly called through to them.
 *
 * The last describe block is a regression guard: adding the new function
 * shares no logic with fetchGscSnapshot, so its three-call (totals/queries/
 * pages) behaviour must still work unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getValidToken:       vi.fn(),
  getValidAccessToken: vi.fn(),
}))

vi.mock('@/lib/platform-oauth/token-manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-oauth/token-manager')>()
  return { ...actual, getValidToken: mocks.getValidToken }
})

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: mocks.getValidAccessToken,
}))

import { fetchGscPageQueryReport, fetchGscSnapshot, GscApiError } from '../client'

const SITE = 'sc-domain:ctstours.co.nz'

const baseParams = {
  accessToken: 'test-token',
  siteUrl:     SITE,
  startDate:   '2026-07-23',
  endDate:     '2026-08-20',
  country:     'nzl',
}

function pageQueryResponse(rows: Array<{ keys: string[]; impressions: number; clicks: number; ctr: number; position: number }>) {
  return new Response(JSON.stringify({ rows }), { status: 200 })
}

function requestBody(fetchSpy: { mock: { calls: unknown[][] } }) {
  const [, init] = fetchSpy.mock.calls[0]
  return JSON.parse((init as RequestInit).body as string)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchGscPageQueryReport — request shape', () => {
  it('requests dimensions: [page, query]', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport(baseParams)
    expect(requestBody(fetchSpy).dimensions).toEqual(['page', 'query'])
  })

  it('includes a New Zealand country filter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport(baseParams)
    expect(requestBody(fetchSpy).dimensionFilterGroups).toEqual([
      { filters: [{ dimension: 'country', operator: 'equals', expression: 'nzl' }] },
    ])
  })

  it('uses web search type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport(baseParams)
    expect(requestBody(fetchSpy).type).toBe('web')
  })

  it('passes the exact start/end date through unchanged', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport(baseParams)
    const body = requestBody(fetchSpy)
    expect(body.startDate).toBe('2026-07-23')
    expect(body.endDate).toBe('2026-08-20')
  })

  it('caps rowLimit at 250 even when a larger value is requested', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport({ ...baseParams, rowLimit: 10_000 })
    expect(requestBody(fetchSpy).rowLimit).toBe(250)
  })

  it('defaults rowLimit to 250 when not given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport(baseParams)
    expect(requestBody(fetchSpy).rowLimit).toBe(250)
  })
})

describe('fetchGscPageQueryReport — response mapping', () => {
  it('maps each row to page/query/clicks/impressions/ctr/position', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([
      {
        keys:        ['https://ctstours.co.nz/tours/rotorua', 'rotorua day tour from auckland'],
        impressions: 210,
        clicks:      4,
        ctr:         0.019,
        position:    8.2,
      },
    ]))

    const rows = await fetchGscPageQueryReport(baseParams)

    expect(rows).toEqual([{
      page:        'https://ctstours.co.nz/tours/rotorua',
      query:       'rotorua day tour from auckland',
      clicks:      4,
      impressions: 210,
      ctr:         0.019,
      position:    8.2,
    }])
  })
})

describe('fetchGscPageQueryReport — fail-closed on missing input', () => {
  it('rejects (and never calls fetch) when accessToken is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(fetchGscPageQueryReport({ ...baseParams, accessToken: '' })).rejects.toThrow(GscApiError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects when siteUrl (the property) is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(fetchGscPageQueryReport({ ...baseParams, siteUrl: '' })).rejects.toThrow(GscApiError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects when startDate or endDate is missing', async () => {
    await expect(fetchGscPageQueryReport({ ...baseParams, startDate: '' })).rejects.toThrow(GscApiError)
    await expect(fetchGscPageQueryReport({ ...baseParams, endDate: '' })).rejects.toThrow(GscApiError)
  })

  it('rejects when country is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(fetchGscPageQueryReport({ ...baseParams, country: '' })).rejects.toThrow(GscApiError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('fetchGscPageQueryReport — provider errors do not retry', () => {
  it('throws a GscApiError on a non-ok response, calling fetch exactly once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'nope', errors: [{ reason: 'forbidden' }] } }),
        { status: 403 },
      ),
    )

    await expect(fetchGscPageQueryReport(baseParams)).rejects.toThrow(GscApiError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('throws on a network failure, calling fetch exactly once (no retry)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    await expect(fetchGscPageQueryReport(baseParams)).rejects.toThrow(GscApiError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('fetchGscPageQueryReport — no token resolution, no persistence', () => {
  it('never resolves, refreshes, or persists a token — token-manager/google-oauth are untouched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(pageQueryResponse([]))
    await fetchGscPageQueryReport(baseParams)
    expect(mocks.getValidToken).not.toHaveBeenCalled()
    expect(mocks.getValidAccessToken).not.toHaveBeenCalled()
  })
})

describe('fetchGscSnapshot — unaffected by the new page×query function', () => {
  it('still resolves totals + top queries + top pages via three separate single-dimension calls', async () => {
    mocks.getValidToken.mockResolvedValue('token-abc')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [{ clicks: 10, impressions: 100, ctr: 0.1, position: 5 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [{ keys: ['best tour'], clicks: 4, impressions: 40, ctr: 0.1, position: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rows: [{ keys: ['https://ctstours.co.nz/'], clicks: 6, impressions: 60, ctr: 0.1, position: 4 }] }), { status: 200 }))

    const snap = await fetchGscSnapshot(SITE, 'client-1', 28)

    expect(snap?.total_clicks).toBe(10)
    expect(snap?.top_queries).toEqual([{ query: 'best tour', clicks: 4, impressions: 40, ctr: 0.1, position: 3 }])
    expect(snap?.top_pages).toEqual([{ page: 'https://ctstours.co.nz/', clicks: 6, impressions: 60, ctr: 0.1, position: 4 }])
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
