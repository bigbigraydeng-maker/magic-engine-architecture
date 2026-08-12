/**
 * 激活闸（Issue #930）。
 *
 * 🔴 每一道闸都**单独**直测：拿一份除了那一项以外完全合法的输入去撞它。
 *    不这么写的话，前一道闸会把后面的闸遮住 —— 一堆全绿的断言其实一道都没盯住
 *    （这个仓库真出过：拆掉某一句原子兑换，18 条测试照样全绿）。
 */

import { describe, expect, it, vi } from 'vitest'
import { activateReviewedPlan } from '../activation'
import { applyReviewDecisions, buildInventoryPlan, computePlanHash } from '../plan'
import { FakeInventoryStore } from './fake-store'
import type { ActivateInput } from '../activation'
import type { ActivationDeps, ReviewedInventoryPlan } from '../types'
import type { CrawlResult } from '../../crawler'
import type { EnrichedPage } from '../../page-enrichment'

const CLIENT = '00000000-0000-0000-0000-0000000000aa'
const DOMAIN = 'example.com'
const HOSTS = ['example.com']
const REVIEW = { reviewedBy: 'product-owner', reviewedAt: '2026-08-12T00:00:00.000Z' }

const ACCEPTED = ['https://example.com/a', 'https://example.com/b']
const REJECTED = 'http://example.com/insecure'
const DEFERRED = 'https://example.com/maybe'

function makeCrawl(url: string, over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    url,
    markdown: `# ${url}\nreal page body`,
    title: `Title ${url}`,
    statusCode: 200,
    crawledAt: new Date('2026-08-12T01:00:00.000Z'),
    ...over,
  }
}

function makeEnriched(over: Partial<EnrichedPage> = {}): EnrichedPage {
  return {
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
    ...over,
  }
}

/** 一份「除了被测那一项以外全部合法」的复核计划。 */
function makeReviewedPlan(over?: { hosts?: readonly string[]; domain?: string; clientId?: string }): ReviewedInventoryPlan {
  const plan = buildInventoryPlan({
    clientId: over?.clientId ?? CLIENT,
    requestedDomain: over?.domain ?? DOMAIN,
    approvedHosts: over?.hosts ?? HOSTS,
    discoveredUrls: [...ACCEPTED, REJECTED, DEFERRED],
  })
  return applyReviewDecisions(plan, {
    decisions: {
      [ACCEPTED[0]]: { decision: 'accepted' },
      [ACCEPTED[1]]: { decision: 'accepted' },
      [DEFERRED]: { decision: 'defer' },
    },
    review: REVIEW,
  })
}

function makeDeps(over: Partial<ActivationDeps> = {}): ActivationDeps & { store: FakeInventoryStore } {
  const store = (over.store as FakeInventoryStore) ?? new FakeInventoryStore()
  return {
    store,
    crawl: over.crawl ?? (async (urls) => urls.map((u) => makeCrawl(u))),
    enrich: over.enrich ?? (async () => makeEnriched()),
    now: over.now ?? (() => '2026-08-12T02:00:00.000Z'),
  }
}

function makeInput(over: Partial<ActivateInput> = {}): ActivateInput {
  return {
    plan: over.plan ?? makeReviewedPlan(),
    expected: over.expected ?? { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
    mode: 'first_activation',
    deps: over.deps ?? makeDeps(),
  }
}

/** 改计划内容后重算哈希 —— 用来构造「内容非法但哈希自洽」的输入，逼每道闸自己说话。 */
function rehash(plan: ReviewedInventoryPlan): ReviewedInventoryPlan {
  const { planHash: _old, ...rest } = plan
  return { ...rest, planHash: computePlanHash(rest) } as ReviewedInventoryPlan
}

describe('顺利通过的基线（不先证明它能过，后面的「拒」就证明不了什么）', () => {
  it('闸门全过 → 抓取 → 写入 → 精确对账 → activated', async () => {
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ deps }))

    expect(audit.status).toBe('activated')
    expect(audit.blockers).toEqual([])
    expect(audit.writtenUrls).toEqual(ACCEPTED)
    expect(audit.counts).toMatchObject({ accepted: 2, written: 2, crawlFailed: 0 })
    expect(audit.inventoryTouched).toBe(true)
  })

  it('🔴 被拒 / 暂缓的候选一条都没到达持久化', async () => {
    const deps = makeDeps()
    await activateReviewedPlan(makeInput({ deps }))
    expect(deps.store.allWrittenUrls()).toEqual(ACCEPTED)
    expect(deps.store.allWrittenUrls()).not.toContain(REJECTED)
    expect(deps.store.allWrittenUrls()).not.toContain(DEFERRED)
  })

  it('审计逐条列出被拒与暂缓，不做汇总即真相', async () => {
    const audit = await activateReviewedPlan(makeInput())
    expect(audit.rejectedUrls.map((r) => r.url)).toContain(REJECTED)
    expect(audit.deferredUrls.map((r) => r.url)).toEqual([DEFERRED])
    expect(audit.deferredUrls[0].reasonCodes).toEqual(['reviewer_deferred'])
  })

  it('不把 Jina 的 200 当页面状态写进台账；重定向证据如实标为不可得', async () => {
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.redirectEvidence).toBe('unavailable')
    const written = deps.store.writes[0].pages[0]
    expect(Object.keys(written)).not.toContain('statusCode')
    expect(Object.keys(written)).not.toContain('status_code')
  })
})

describe('身份闸：计划与当前上下文对不上就一次抓取都不发', () => {
  const crawlSpy = () => vi.fn(async (urls: readonly string[]) => urls.map((u) => makeCrawl(u)))

  it('租户不符', async () => {
    const crawl = crawlSpy()
    const audit = await activateReviewedPlan(
      makeInput({
        expected: { clientId: 'other-tenant', requestedDomain: DOMAIN, approvedHosts: HOSTS },
        deps: makeDeps({ crawl }),
      }),
    )
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('client_mismatch')
    expect(crawl).not.toHaveBeenCalled()
  })

  it('域名不符', async () => {
    const audit = await activateReviewedPlan(
      makeInput({ expected: { clientId: CLIENT, requestedDomain: 'other.com', approvedHosts: HOSTS } }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('domain_mismatch')
  })

  it('🔴 批准主机清单不符（上下文多批了一个 www，计划里没有）', async () => {
    const audit = await activateReviewedPlan(
      makeInput({
        expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'www.example.com'] },
      }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('approved_hosts_mismatch')
  })

  it('主机清单只是大小写 / 顺序不同 → 不算不符', async () => {
    const audit = await activateReviewedPlan(
      makeInput({ expected: { clientId: CLIENT, requestedDomain: 'Example.com', approvedHosts: ['EXAMPLE.com'] } }),
    )
    expect(audit.status).toBe('activated')
  })

  it('规则版本不符', async () => {
    const plan = rehash({ ...makeReviewedPlan(), normalizationRuleVersion: 'inventory-url-rules@0' })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('rule_version_mismatch')
  })

  it('契约版本不符', async () => {
    const plan = rehash({ ...makeReviewedPlan(), contractVersion: 'canonical-inventory-plan@0' })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('contract_version_mismatch')
  })

  it('哈希对不上（批准之后内容被改过）', async () => {
    const base = makeReviewedPlan()
    const tampered: ReviewedInventoryPlan = {
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === DEFERRED ? { ...c, decision: 'accepted' as const } : c,
      ),
    }
    const audit = await activateReviewedPlan(makeInput({ plan: tampered }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('plan_hash_mismatch')
  })

  it('没有复核签名', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({ ...base, review: { reviewedBy: '', reviewedAt: REVIEW.reviewedAt } })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('plan_not_reviewed')
  })
})

describe('被接受集合闸', () => {
  it('还有 pending 没判 → 拒', async () => {
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: DOMAIN,
      approvedHosts: HOSTS,
      discoveredUrls: ACCEPTED,
    })
    const reviewed = applyReviewDecisions(plan, {
      decisions: { [ACCEPTED[0]]: { decision: 'accepted' } },
      review: REVIEW,
    })
    const audit = await activateReviewedPlan(makeInput({ plan: reviewed }))
    expect(audit.blockers.map((b) => b.code)).toContain('unreviewed_candidates')
  })

  it('被接受集合为空 → 拒（没有可激活的台账）', async () => {
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: DOMAIN,
      approvedHosts: HOSTS,
      discoveredUrls: ACCEPTED,
    })
    const reviewed = applyReviewDecisions(plan, {
      decisions: { [ACCEPTED[0]]: { decision: 'rejected' }, [ACCEPTED[1]]: { decision: 'defer' } },
      review: REVIEW,
    })
    const audit = await activateReviewedPlan(makeInput({ plan: reviewed }))
    expect(audit.blockers.map((b) => b.code)).toContain('empty_accepted_set')
  })

  it('🔴 被接受的 URL 主机被改成未批准的（且哈希已重算）→ 仍然拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: 'https://www.example.com/a' } : c,
      ),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_url_not_canonical')
  })

  it('被接受的 URL 被手改成未归一的串 → 拒（尾斜杠 / 片段 / http 都算）', async () => {
    const base = makeReviewedPlan()
    for (const bad of ['https://example.com/a/', 'https://example.com/a#x', 'http://example.com/a']) {
      const plan = rehash({
        ...base,
        candidates: base.candidates.map((c) =>
          c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: bad } : c,
        ),
      })
      const audit = await activateReviewedPlan(makeInput({ plan }))
      expect(audit.blockers.map((b) => b.code), bad).toContain('accepted_url_not_canonical')
    }
  })

  it('被接受集合里出现重复 canonical → 拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[1] ? { ...c, canonicalUrl: ACCEPTED[0] } : c,
      ),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('duplicate_accepted_target')
  })

  it('被接受但没有 canonical URL → 拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: null } : c,
      ),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_without_canonical')
  })
})

describe('空库闸（首次激活）', () => {
  it('台账已有行 → 拒，一条都不写', async () => {
    const deps = makeDeps({ store: new FakeInventoryStore({ existingCount: 3 }) })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_not_empty')
    expect(deps.store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('🔴 读不到行数 ≠ 行数为 0 —— 读失败也拒', async () => {
    const deps = makeDeps({ store: new FakeInventoryStore({ countError: 'connection reset' }) })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_count_unavailable')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('身份闸没过时不去打数据库（先拦纯校验，别浪费查询）', async () => {
    const deps = makeDeps()
    await activateReviewedPlan(
      makeInput({ expected: { clientId: 'other', requestedDomain: DOMAIN, approvedHosts: HOSTS }, deps }),
    )
    expect(deps.store.countCalls).toBe(0)
  })
})

describe('执行阶段：一页失败就不许报完成', () => {
  it('抓取失败 → failed，且一行都不写', async () => {
    const deps = makeDeps({
      crawl: async (urls) => urls.map((u, i) => makeCrawl(u, i === 0 ? { error: 'Timeout after 10000ms' } : {})),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.counts.crawlFailed).toBe(1)
    expect(audit.failedUrls[0]).toMatchObject({ url: ACCEPTED[0] })
    expect(deps.store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('反爬挑战页（带 error 的抓取结果）不会被当成真页面写进去', async () => {
    const deps = makeDeps({
      crawl: async (urls) =>
        urls.map((u, i) =>
          makeCrawl(
            u,
            i === 0
              ? { markdown: '', title: '', error: 'antibot_siteground: Robot Challenge Screen', antibot: { kind: 'siteground', evidence: 'Robot Challenge Screen' } }
              : {},
          ),
        ),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('分类失败 → failed（不许拿兜底的 other 蒙混进台账）', async () => {
    const deps = makeDeps({
      enrich: async ({ url }) =>
        url === ACCEPTED[1]
          ? makeEnriched({ classified: false, classificationError: 'openai timeout', pageType: 'other' })
          : makeEnriched(),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls[0].error).toContain('classification failed')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('抓取器少返回一条 → 当失败处理，不当「跳过」', async () => {
    const deps = makeDeps({ crawl: async (urls) => [makeCrawl(urls[0])] })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls.map((f) => f.url)).toEqual([ACCEPTED[1]])
    expect(deps.store.writes).toHaveLength(0)
  })

  it('整批抓取抛错 → 全部计为失败，一行不写', async () => {
    const deps = makeDeps({
      crawl: async () => {
        throw new Error('network down')
      },
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.counts.crawlFailed).toBe(2)
    expect(deps.store.writes).toHaveLength(0)
  })
})

describe('写入对账', () => {
  it('写入方少写一条 → failed 并标明台账已被改动', async () => {
    const deps = makeDeps({
      store: new FakeInventoryStore({ writeResult: (pages) => pages.slice(0, 1).map((p) => p.canonicalUrl) }),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].code).toBe('write_set_mismatch')
    expect(audit.inventoryTouched).toBe(true)
  })

  it('写入方多写一条（写了没被批准的 URL）→ failed', async () => {
    const deps = makeDeps({
      store: new FakeInventoryStore({
        writeResult: (pages) => [...pages.map((p) => p.canonicalUrl), 'https://example.com/sneaky'],
      }),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].message).toContain('https://example.com/sneaky')
  })

  it('写入抛错 → failed 并提示可能已有半截行，别直接重跑', async () => {
    const deps = makeDeps({ store: new FakeInventoryStore({ writeError: 'deadlock detected' }) })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].code).toBe('write_failed')
    expect(audit.inventoryTouched).toBe(true)
  })
})

describe('#930 现场形状：裸域进台账、www 进不去', () => {
  const HOST = 'romanhu.com'

  it('只批准裸域时，www 的页面连候选都过不了，激活后台账里只有裸域页面', async () => {
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: HOST,
      approvedHosts: [HOST],
      discoveredUrls: [`https://${HOST}/about`, `https://www.${HOST}/about`],
    })
    const pendingUrls = plan.candidates.filter((c) => c.decision === 'pending').map((c) => c.originalUrl)
    expect(pendingUrls).toEqual([`https://${HOST}/about`])

    const reviewed = applyReviewDecisions(plan, {
      decisions: { [`https://${HOST}/about`]: { decision: 'accepted' } },
      review: REVIEW,
    })
    const deps = makeDeps()
    const audit = await activateReviewedPlan({
      plan: reviewed,
      expected: { clientId: CLIENT, requestedDomain: HOST, approvedHosts: [HOST] },
      mode: 'first_activation',
      deps,
    })
    expect(audit.status).toBe('activated')
    expect(deps.store.allWrittenUrls()).toEqual([`https://${HOST}/about`])
  })
})
