import { describe, expect, it, vi } from 'vitest'

const { runActorAndGetResults } = vi.hoisted(() => ({ runActorAndGetResults: vi.fn() }))
vi.mock('@/lib/apify/client', () => ({ runActorAndGetResults }))

import { collectApifyExternalObservations } from '../apify-external'

const clientId = '00000000-0000-0000-0000-000000000001'

describe('Apify external observation adapter', () => {
  it('reuses the shared Apify runner and normalizes common article fields', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'run-1', data: [{
      url: 'https://travel.example/story?utm_source=x', title: 'New route', description: 'Operator announced a new route.',
      publishedAt: '2026-09-11T00:00:00Z', domain: 'travel.example',
    }] })
    const result = await collectApifyExternalObservations({
      actorId: 'actor/news', actorInput: { startUrls: [] }, sourceId: 'travel-today', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })
    expect(runActorAndGetResults).toHaveBeenCalledWith('actor/news', { startUrls: [] }, undefined)
    expect(result).toMatchObject({ runId: 'run-1', rejected: 0 })
    expect(result.observations[0]).toMatchObject({ source_type: 'industry_media', source_name: 'Travel Today', title: 'New route', published_at: '2026-09-11T00:00:00.000Z' })
  })

  it('rejects rows without a public URL or useful text', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'run-2', data: [
      { title: 'No URL', description: 'text' }, { url: 'https://example.com/no-text', title: 'No text' },
    ] })
    const result = await collectApifyExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })
    expect(result).toMatchObject({ runId: 'run-2', rejected: 2, observations: [] })
  })

  it('fails closed for unauthorized Facebook rows', async () => {
    runActorAndGetResults.mockResolvedValue({ success: true, runId: 'run-3', data: [{
      url: 'https://facebook.com/groups/example/posts/1', text: 'Discussion',
    }] })
    const result = await collectApifyExternalObservations({
      actorId: 'actor/group', actorInput: {}, sourceId: 'facebook-group-authorized', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })
    expect(result).toMatchObject({ runId: 'run-3', rejected: 1, observations: [] })
  })

  it('returns actor failures without manufacturing observations', async () => {
    runActorAndGetResults.mockResolvedValue({ success: false, runId: 'run-4', data: [], error: 'Actor timed out' })
    await expect(collectApifyExternalObservations({
      actorId: 'actor/news', actorInput: {}, sourceId: 'travel-today', clientId,
      observedAt: '2026-09-11T01:00:00Z',
    })).resolves.toMatchObject({ runId: 'run-4', observations: [], error: 'Actor timed out' })
  })
})
