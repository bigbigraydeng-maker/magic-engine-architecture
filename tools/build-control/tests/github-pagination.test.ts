import { describe, expect, it, vi } from 'vitest'
import { createGitHubClient } from '../src/github.mjs'

function pr(number: number) {
  return { number, body: '', draft: false, state: 'open', created_at: '2026-08-29T00:00:00Z', head: { sha: 'x', ref: 'y' } }
}

const fullPage = Array.from({ length: 100 }, (_unused, i) => pr(i))

function fetchServing(pages: Record<number, unknown[] | 'error'>) {
  return vi.fn(async (url: string | URL) => {
    const href = typeof url === 'string' ? url : url.toString()
    const page = Number(new URL(href).searchParams.get('page') ?? '1')
    const body = pages[page]
    if (body === undefined) return new Response('[]', { status: 200 })
    if (body === 'error') return new Response('upstream failure', { status: 502 })
    return new Response(JSON.stringify(body), { status: 200 })
  })
}

describe('createGitHubClient pagination', () => {
  it('reads past the first page instead of stopping at 100', async () => {
    const fetchImpl = fetchServing({ 1: fullPage, 2: [pr(100)] })
    const client = createGitHubClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch })
    const result = await client.listOpenPullRequests({ owner: 'o', repo: 'r' })
    expect(result).toHaveLength(101)
  })

  // Fixture #4: API pagination failure fails closed (throws) — never a shorter list.
  it('throws when a later page fails, instead of returning a truncated list', async () => {
    const fetchImpl = fetchServing({ 1: fullPage, 2: 'error' })
    const client = createGitHubClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.listOpenPullRequests({ owner: 'o', repo: 'r' })).rejects.toThrow(/502/)
  })

  it('throws on a non-array page body instead of coercing it to empty', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ not: 'an array' }), { status: 200 }))
    const client = createGitHubClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.listOpenPullRequests({ owner: 'o', repo: 'r' })).rejects.toThrow(/did not return an array/)
  })

  it('refuses to construct without a token', () => {
    expect(() => createGitHubClient({ token: '' })).toThrow(/token is required/)
  })

  it('succeeds on a single short page — the positive control', async () => {
    const fetchImpl = fetchServing({ 1: [pr(1)] })
    const client = createGitHubClient({ token: 't', fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.listOpenPullRequests({ owner: 'o', repo: 'r' })).resolves.toHaveLength(1)
  })
})
