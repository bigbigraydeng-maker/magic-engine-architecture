/**
 * 验 GithubClient.createPullRequest 请求体真的带 draft:true。
 * 用 global fetch stub，不发真请求。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GithubClient } from '@/lib/cms/github-client'

describe('GithubClient.createPullRequest draft param', () => {
  let originalFetch: typeof globalThis.fetch
  let calls: Array<{ url: string; body: unknown }> = []

  beforeEach(() => {
    originalFetch = globalThis.fetch
    calls = []
    globalThis.fetch = vi.fn(async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      return {
        ok: true,
        status: 201,
        json: async () => ({ number: 42, html_url: 'https://github.com/x/y/pull/42', title: 't' }),
        text: async () => '',
      } as unknown as Response
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('draft:true 传下去', async () => {
    const gh = new GithubClient('pat')
    await gh.createPullRequest('owner', 'repo', {
      title: 't', body: 'b', head: 'src', base: 'main', draft: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.github.com/repos/owner/repo/pulls')
    expect((calls[0].body as { draft?: boolean }).draft).toBe(true)
  })

  it('未传 draft 默认 false（不破坏既有 caller）', async () => {
    const gh = new GithubClient('pat')
    await gh.createPullRequest('owner', 'repo', {
      title: 't', body: 'b', head: 'src', base: 'main',
    })
    expect((calls[0].body as { draft?: boolean }).draft).toBe(false)
  })

  it('draft:false 传下去', async () => {
    const gh = new GithubClient('pat')
    await gh.createPullRequest('owner', 'repo', {
      title: 't', body: 'b', head: 'src', base: 'main', draft: false,
    })
    expect((calls[0].body as { draft?: boolean }).draft).toBe(false)
  })
})
