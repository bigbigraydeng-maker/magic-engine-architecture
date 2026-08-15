/**
 * webhook 的 product-map 分支(ME2 PR2):仓门分流 / 投递幂等 / targeted sync 派发。
 * 既有 blog/GEO 用例在 route.test.ts,是本次改造的回归锁,不动。
 */

import { createHmac } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))
vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/gsc/indexing-client', () => ({
  requestIndexing: vi.fn().mockResolvedValue({ ok: false, errorMsg: 'not supported' }),
}))
vi.mock('@/lib/gsc/sitemap-ping', () => ({
  pingSitemap: vi.fn().mockResolvedValue({ attempted: false, reason: 'test' }),
  buildSitemapUrlFromDomain: vi.fn().mockReturnValue(null),
}))
vi.mock('@/lib/cms/geo-deployments-store', () => ({
  markMergedByPr: vi.fn().mockResolvedValue(0),
}))

const { claimDelivery, markDelivery, runTargetedSync } = vi.hoisted(() => ({
  claimDelivery: vi.fn(),
  markDelivery: vi.fn(),
  runTargetedSync: vi.fn(),
}))

vi.mock('@/lib/product-map-sync', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/product-map-sync')>()
  return {
    ...original,
    SupabaseSyncStore: class {
      claimDelivery = claimDelivery
      markDelivery = markDelivery
    },
    GithubRestProvider: class {},
    runTargetedSync,
  }
})

import { POST } from '../route'
import { NotProvisionedError } from '@/lib/product-map-sync'

const SECRET = 'test-webhook-secret'
const ME_REPO = 'bigbigraydeng-maker/magic-engine'

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')
}

function makeRequest(
  body: object,
  opts: { event?: string; delivery?: string; badSignature?: boolean } = {},
): NextRequest {
  const raw = JSON.stringify(body)
  return new NextRequest('https://app.magicengine.com.au/api/cms/github/webhook', {
    method: 'POST',
    body: raw,
    headers: {
      'x-hub-signature-256': opts.badSignature ? 'sha256=deadbeef' : sign(raw),
      'x-github-event': opts.event ?? 'pull_request',
      'x-github-delivery': opts.delivery ?? 'guid-test-1',
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
  process.env.GITHUB_TOKEN = 'test-token'
  claimDelivery.mockResolvedValue('claimed')
  markDelivery.mockResolvedValue(undefined)
  runTargetedSync.mockResolvedValue({
    runId: 'run-1',
    status: 'ok',
    stats: { prsSynced: 1, issuesSynced: 0, unclassifiedSeen: 0, failedItems: [], skippedStale: 0, truncations: [] },
  })
})

describe('仓门分流', () => {
  it('本仓 pull_request 事件 → targeted sync(单号码)', async () => {
    const res = await POST(
      makeRequest({ action: 'closed', repository: { full_name: ME_REPO }, pull_request: { number: 976 } }),
    )
    expect(res.status).toBe(200)
    expect(runTargetedSync).toHaveBeenCalledWith(expect.anything(), { kind: 'pr', number: 976 })
    expect(markDelivery).toHaveBeenCalledWith('guid-test-1', 'processed', undefined)
  })

  it('客户仓事件绝不触发 product-map 同步(走既有路径)', async () => {
    const res = await POST(
      makeRequest({ action: 'closed', repository: { full_name: 'client/site' }, pull_request: { number: 5, html_url: 'u', merged: false, merged_at: null } }),
    )
    expect(res.status).toBe(200)
    expect(claimDelivery).not.toHaveBeenCalled()
    expect(runTargetedSync).not.toHaveBeenCalled()
  })

  it('客户仓 push 事件仍然 ignored(既有行为回归)', async () => {
    const res = await POST(
      makeRequest({ repository: { full_name: 'client/site' } }, { event: 'push' }),
    )
    expect(await res.json()).toEqual({ ignored: 'event=push' })
  })

  it('本仓 issues 事件 → targeted issue sync', async () => {
    await POST(
      makeRequest({ action: 'closed', repository: { full_name: ME_REPO }, issue: { number: 879 } }, { event: 'issues' }),
    )
    expect(runTargetedSync).toHaveBeenCalledWith(expect.anything(), { kind: 'issue', number: 879 })
  })

  it('非登记册号码(runTargetedSync 返回 null)→ 登记投递不落 facts', async () => {
    runTargetedSync.mockResolvedValue(null)
    const res = await POST(
      makeRequest({ repository: { full_name: ME_REPO }, pull_request: { number: 55555 } }),
    )
    const json = await res.json()
    expect(json.sync).toBe('not_registry_linked')
    expect(markDelivery).toHaveBeenCalledWith('guid-test-1', 'processed')
  })

  it('本仓 push(无号码)→ 只登记投递,同步留给 cron', async () => {
    const res = await POST(makeRequest({ repository: { full_name: ME_REPO } }, { event: 'push' }))
    const json = await res.json()
    expect(json.sync).toBe('deferred_to_cron')
    expect(runTargetedSync).not.toHaveBeenCalled()
    expect(markDelivery).toHaveBeenCalledWith('guid-test-1', 'processed')
  })
})

describe('验签 fail-closed', () => {
  it('签名无效 → 401,零写入(claim 都不许发生)', async () => {
    const res = await POST(
      makeRequest(
        { repository: { full_name: ME_REPO }, pull_request: { number: 1 } },
        { badSignature: true },
      ),
    )
    expect(res.status).toBe(401)
    expect(claimDelivery).not.toHaveBeenCalled()
    expect(runTargetedSync).not.toHaveBeenCalled()
  })
})

describe('投递幂等', () => {
  it('重放(processed 过)→ skipped_duplicate,不再同步', async () => {
    claimDelivery.mockResolvedValue('duplicate')
    const res = await POST(
      makeRequest({ repository: { full_name: ME_REPO }, pull_request: { number: 976 } }),
    )
    expect((await res.json()).status).toBe('skipped_duplicate')
    expect(runTargetedSync).not.toHaveBeenCalled()
  })

  it('上次处理失败的投递重放 → 允许重试(不永久吞事件)', async () => {
    claimDelivery.mockResolvedValue('retry_failed')
    await POST(makeRequest({ repository: { full_name: ME_REPO }, pull_request: { number: 976 } }))
    expect(runTargetedSync).toHaveBeenCalled()
  })

  it('同步失败 → 投递标 failed 但仍 200(GitHub 禁用保护)', async () => {
    runTargetedSync.mockResolvedValue({
      runId: 'run-2',
      status: 'error',
      stats: { prsSynced: 0, issuesSynced: 0, unclassifiedSeen: 0, failedItems: ['pr#976: boom'], skippedStale: 0, truncations: [] },
    })
    const res = await POST(
      makeRequest({ repository: { full_name: ME_REPO }, pull_request: { number: 976 } }),
    )
    expect(res.status).toBe(200)
    expect(markDelivery).toHaveBeenCalledWith('guid-test-1', 'failed', 'pr#976: boom')
  })
})

describe('未 provision', () => {
  it('表未 apply → 200 not_provisioned(不 5xx,不假装成功)', async () => {
    claimDelivery.mockRejectedValue(new NotProvisionedError('表未 apply'))
    const res = await POST(
      makeRequest({ repository: { full_name: ME_REPO }, pull_request: { number: 976 } }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('not_provisioned')
    expect(runTargetedSync).not.toHaveBeenCalled()
  })
})
