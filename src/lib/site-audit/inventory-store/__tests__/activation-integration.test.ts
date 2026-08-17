/**
 * 端到端集成：把**真实 store** 插进**真实 `activateReviewedPlan`** 激活闸，
 * 用假 supabase 当库、假抓取/富集当外部依赖。
 *
 * 🔴 这条堵的是「声明了 ≠ 接上了」：单测证明 store 各方法自身对，但只有让激活方真的
 *    通过 `CanonicalInventoryStore` 契约调它、再拿写入结果做精确对账，才证明两边接口真的咬合
 *    （写入返回的 url 集必须让激活方判成 'activated'，且假库里真落了行）。
 */

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { activateReviewedPlan } from '../../canonical-inventory/activation'
import { applyReviewDecisions, buildInventoryPlan } from '../../canonical-inventory/plan'
import type { ActivationDeps, ReviewedInventoryPlan } from '../../canonical-inventory'
import type { CrawlResult } from '../../crawler'
import type { EnrichedPage } from '../../page-enrichment'
import { ClientSitePagesInventoryStore } from '../store'
import { FakeSupabase } from './fake-supabase'

const CLIENT = '33333333-3333-3333-3333-333333333333'
const DOMAIN = 'example.com'
const HOSTS = ['example.com']
const ACCEPTED = ['https://example.com/a', 'https://example.com/b']
const SIGN = (planHash: string): string => `sig:${planHash}`
const VERIFY = (planHash: string, signature: string): boolean => signature === SIGN(planHash)

function makeReviewedPlan(): ReviewedInventoryPlan {
  const plan = buildInventoryPlan({
    clientId: CLIENT,
    requestedDomain: DOMAIN,
    approvedHosts: HOSTS,
    discoveredUrls: [...ACCEPTED],
    discovery: HOSTS.map((host) => ({ host, count: 2, foreignCount: 0, error: null })),
  })
  return applyReviewDecisions(plan, {
    decisions: Object.fromEntries(ACCEPTED.map((url) => [url, { decision: 'accepted' as const }])),
    review: { reviewedBy: 'product-owner', reviewedAt: '2026-08-17T00:00:00.000Z' },
    sign: SIGN,
  })
}

function makeDeps(store: ClientSitePagesInventoryStore): ActivationDeps {
  return {
    store,
    verifyReviewSignature: VERIFY,
    crawl: async (urls) =>
      urls.map(
        (url): CrawlResult => ({
          url,
          markdown: `# ${url}\nbody`,
          title: `Title ${url}`,
          statusCode: 200,
          crawledAt: new Date('2026-08-17T01:00:00.000Z'),
        }),
      ),
    enrich: async (): Promise<EnrichedPage> => ({
      pageType: 'service',
      topics: ['t1'],
      primaryKeyword: 'kw',
      classificationConfidence: 0.9,
      classified: true,
      classificationError: null,
      hasGeoBlock: false,
      geoDetectionMethod: null,
      geoConfidence: 0,
      wordCount: 5,
    }),
    now: () => '2026-08-17T02:00:00.000Z',
  }
}

describe('真实 store × 真实激活闸', () => {
  it('空库首次激活 → activated，假库里落了两条被接受页面', async () => {
    const db = new FakeSupabase()
    const store = new ClientSitePagesInventoryStore({ client: db as unknown as SupabaseClient })
    const audit = await activateReviewedPlan({
      plan: makeReviewedPlan(),
      expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
      mode: 'first_activation',
      deps: makeDeps(store),
    })
    expect(audit.status).toBe('activated')
    expect([...audit.writtenUrls].sort()).toEqual([...ACCEPTED].sort())
    expect(db.rows.map((r) => r.url).sort()).toEqual([...ACCEPTED].sort())
    expect(db.rows.every((r) => r.client_id === CLIENT)).toBe(true)
    expect(db.rows.every((r) => r.crawl_status === 'crawled')).toBe(true)
  })

  it('库里已有行 → 激活闸判 rejected，一行都不写（首次激活要求空库）', async () => {
    const db = new FakeSupabase({ seed: [{ client_id: CLIENT, url: 'https://example.com/pre', crawl_status: 'crawled' }] })
    const store = new ClientSitePagesInventoryStore({ client: db as unknown as SupabaseClient })
    const audit = await activateReviewedPlan({
      plan: makeReviewedPlan(),
      expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
      mode: 'first_activation',
      deps: makeDeps(store),
    })
    expect(audit.status).toBe('rejected')
    expect(audit.inventoryTouched).toBe(false)
    expect(db.rows).toHaveLength(1) // 只有预置那条
  })
})
