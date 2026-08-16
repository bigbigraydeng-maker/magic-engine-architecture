/**
 * GithubRestProvider 的 hermetic 测试 —— fetchImpl 注入,零真实网络。
 * 盯:仓库越界 fail-closed / REST 限流地板 / 分页截断记账 / checks 按 sha /
 * GraphQL RATE_LIMITED → threads null(不拖垮整轮)。
 */

import { describe, expect, it } from 'vitest'
import { APPROVED_REPO } from '@/lib/product-map/types'
import { GithubRestProvider } from '../github-rest-provider'
import { RateLimitedError } from '../types'

type Route = (url: string, init?: RequestInit) => { status?: number; headers?: Record<string, string>; body: unknown }

function fakeFetch(routes: Route): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const r = routes(url, init)
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '5000', ...(r.headers ?? {}) },
    })
  }) as typeof fetch
}

function prPayload(number: number, overrides: Record<string, unknown> = {}) {
  return {
    number,
    state: 'open',
    draft: false,
    merged: false,
    merge_commit_sha: null,
    mergeable_state: 'clean',
    base: { ref: 'main', repo: { full_name: APPROVED_REPO } },
    head: { sha: `sha-${number}` },
    title: `PR ${number}`,
    body: '',
    updated_at: '2026-08-15T00:00:00Z',
    ...overrides,
  }
}

const graphqlOk = {
  data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } } } },
}

function standardRoutes(overrides: Partial<Record<string, Route>> = {}): Route {
  return (url, init) => {
    if (url.endsWith('/graphql')) return (overrides.graphql ?? (() => ({ body: graphqlOk })))(url, init)
    if (url.includes('/pulls/') && url.includes('/files')) {
      return (overrides.files ?? (() => ({ body: [{ filename: 'a.ts' }] })))(url, init)
    }
    if (url.includes('/check-runs')) {
      return (overrides.checks ?? (() => ({ body: { check_runs: [{ name: 'build', status: 'completed', conclusion: 'success' }] } })))(url, init)
    }
    if (url.includes('/pulls/')) return (overrides.pr ?? (() => ({ body: prPayload(7) })))(url, init)
    if (url.includes('/branches/main')) return { body: { name: 'main', commit: { sha: 'head-sha' } } }
    return { body: {} }
  }
}

describe('GithubRestProvider', () => {
  it('正常抓取:state/checks(带 headSha 键控)/threads 齐全', async () => {
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(standardRoutes()) })
    const { facts, failed } = await p.getPullRequestFacts([7])
    expect(failed).toEqual([])
    expect(facts[0].headSha).toBe('sha-7')
    expect(facts[0].checks[0].name).toBe('build')
    expect(facts[0].unresolvedThreads).toBe(1)
  })

  it('响应里的仓库不是获准仓库 → 该号码 fail-closed,绝不产出事实', async () => {
    const routes = standardRoutes({
      pr: () => ({ body: prPayload(7, { base: { ref: 'main', repo: { full_name: 'evil/repo' } } }) }),
    })
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts, failed } = await p.getPullRequestFacts([7])
    expect(facts).toEqual([])
    expect(failed[0].reason).toContain('越界')
  })

  it('REST remaining 低于地板 → RateLimitedError 让本轮止步', async () => {
    const routes: Route = () => ({ body: {}, headers: { 'x-ratelimit-remaining': '3' } })
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    await expect(p.getMainHead()).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('GraphQL 打爆(200 + errors RATE_LIMITED)→ threads=null,不炸整个 PR', async () => {
    const routes = standardRoutes({
      graphql: () => ({ body: { errors: [{ type: 'RATE_LIMITED', message: 'slow down' }] } }),
    })
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts } = await p.getPullRequestFacts([7])
    expect(facts[0].unresolvedThreads).toBeNull()
  })

  it('changed files 超上限 → 截断并打 truncated 标(silent cap 禁令)', async () => {
    const routes = standardRoutes({
      files: (url) => ({
        body: Array.from({ length: 100 }, (_, i) => ({ filename: `f${url.includes('page=2') ? 'b' : 'a'}${i}.ts` })),
        headers: { link: '<next>; rel="next"' },
      }),
    })
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts } = await p.getPullRequestFacts([7])
    expect(facts[0].changedFiles.length).toBe(100)
    expect(facts[0].changedFilesTruncated).toBe(true)
  })

  it('恰好 100 个文件且无下一页 → 不算截断(不许误报)', async () => {
    const routes = standardRoutes({
      files: () => ({ body: Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts` })) }),
    })
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts } = await p.getPullRequestFacts([7])
    expect(facts[0].changedFilesTruncated).toBe(false)
  })

  it('批量中途限流 → 已抓的保留、没轮到的进 failed、rateLimited=true(成果不丢)', async () => {
    let prCalls = 0
    const routes = standardRoutes({
      pr: (url) => {
        prCalls++
        if (prCalls > 1) return { body: {}, headers: { 'x-ratelimit-remaining': '3' } }
        return { body: prPayload(Number(url.split('/pulls/')[1])) }
      },
    })
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts, failed, rateLimited } = await p.getPullRequestFacts([7, 8, 9])
    expect(facts.map((f) => f.number)).toEqual([7])
    expect(failed.map((f) => f.number)).toEqual([8, 9])
    expect(failed.every((f) => f.reason.includes('未尝试') || f.reason.includes('限流'))).toBe(true)
    expect(rateLimited).toBe(true)
  })

  it('issue 号码指向 PR → fail-closed,不冒充 issue', async () => {
    const routes: Route = (url) => {
      if (url.includes('/issues/7')) {
        return {
          body: {
            number: 7,
            state: 'open',
            title: 'x',
            body: '',
            updated_at: '2026-08-15T00:00:00Z',
            repository_url: `https://api.github.com/repos/${APPROVED_REPO}`,
            pull_request: {},
          },
        }
      }
      return { body: {} }
    }
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts, failed } = await p.getIssueFacts([7])
    expect(facts).toEqual([])
    expect(failed[0].reason).toContain('PR')
  })

  it('getWorkItemStates 对 PR 与 issue 通吃(收编复核用)', async () => {
    const routes: Route = (url) => {
      if (url.includes('/issues/7')) {
        return {
          body: {
            number: 7,
            state: 'closed',
            title: 'x',
            body: 'b',
            updated_at: '2026-08-15T00:00:00Z',
            repository_url: `https://api.github.com/repos/${APPROVED_REPO}`,
            pull_request: {},
          },
        }
      }
      return { body: {} }
    }
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { facts } = await p.getWorkItemStates([7])
    expect(facts[0].state).toBe('closed')
  })

  it('错误信息绝不携带 token', async () => {
    const routes: Route = () => ({ status: 500, body: { message: 'oops' } })
    const p = new GithubRestProvider({ token: 'super-secret-token', fetchImpl: fakeFetch(routes) })
    const { failed } = await p.getPullRequestFacts([7])
    expect(JSON.stringify(failed)).not.toContain('super-secret-token')
  })

  it('listRecentWork 区分 pr/issue 并跟随分页', async () => {
    let page = 0
    const routes: Route = (url) => {
      if (url.includes('/issues?')) {
        page++
        const headers: Record<string, string> = page === 1 ? { link: '<next>; rel="next"' } : {}
        return {
          body: [
            { number: 9000 + page, title: 't', body: null, html_url: 'u', created_at: '2026-08-14T00:00:00Z', ...(page === 1 ? { pull_request: {} } : {}) },
          ],
          headers,
        }
      }
      return { body: {} }
    }
    const p = new GithubRestProvider({ token: 't', fetchImpl: fakeFetch(routes) })
    const { items } = await p.listRecentWork('2026-08-01T00:00:00Z')
    expect(items.map((i) => i.kind)).toEqual(['pr', 'issue'])
  })
})
