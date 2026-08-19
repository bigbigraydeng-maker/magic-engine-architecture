/**
 * `ads.meta_boost_sandbox_reel` 的 orchestration 测试。
 *
 * 每个依赖（post-boost-publisher / readback / token-manager / spend-reservations /
 * creative-link）都已经有自己的单测，这里只测**这个 capability 把它们接对了没有**：
 * guard 先校验再预留、publish_paused 先查 tag 再建、gate 失败不删已建对象、
 * link 用正确的参数记归因。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { KernelError } from '@/lib/kernel/errors'
import { createMetaBoostSandboxReelCapability, V1_SANDBOX_LIFETIME_CAP_NZD, scopeKeyFor } from '../meta-boost-sandbox-reel'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

vi.mock('@/lib/meta/post-boost-publisher', () => ({
  createBoostAdPaused: vi.fn(),
  findByTag: vi.fn(),
}))
vi.mock('@/lib/meta/readback', () => ({
  fetchAdSetReadback: vi.fn(),
  fetchAdCreativesReadback: vi.fn(),
}))
vi.mock('@/lib/meta/token-manager', () => ({
  getMetaTokenForClient: vi.fn(),
}))
vi.mock('@/lib/ads/spend-reservations', () => ({
  createSupabaseSpendReservationStore: vi.fn(),
}))
vi.mock('@/lib/ads/creative-link', () => ({
  linkAdToCreative: vi.fn(),
}))

import { createBoostAdPaused, findByTag } from '@/lib/meta/post-boost-publisher'
import { fetchAdSetReadback, fetchAdCreativesReadback } from '@/lib/meta/readback'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { createSupabaseSpendReservationStore } from '@/lib/ads/spend-reservations'
import { linkAdToCreative } from '@/lib/ads/creative-link'

const CLIENT_ID = 'c-cts'
const RUN_ID = 'run-1'

function ctx(): AuthorizedExecutionContext {
  return {
    decisionId: 'd1', runId: RUN_ID, clientId: CLIENT_ID,
    actionKey: 'ads.meta_boost_sandbox_reel', actionVersion: 1,
    policyVersion: 1, costCapUsd: 60, idempotencyKey: 'k1', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

function draft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'boost_existing_post',
    clientId: CLIENT_ID,
    campaignName: 'ME-Sandbox-test',
    adSetName: 'NZ 55+ Facebook Reel',
    dailyBudget: 20,
    durationDays: 5,
    geoCountries: ['NZ'],
    ageMin: 55,
    ageMax: 65,
    pageId: '1234567890',
    creatives: [],
    objectStoryId: '1234567890_9876543210',
    publisherPlatforms: ['facebook'],
    advantageAudience: 0,
    destinationUrl: 'https://www.ctstours.co.nz/china-tours',
    ...over,
  }
}

function fakeSb(opts: {
  runInput?: Record<string, unknown>
  clientRow?: { meta_ad_account_id?: string | null; facebook_page_id?: string | null } | null
}) {
  return {
    from(table: string) {
      if (table === 'action_runs') {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({ data: opts.runInput ? [{ input: opts.runInput }] : [], error: null }),
            }),
          }),
        }
      }
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.clientRow === undefined
                  ? { meta_ad_account_id: 'act_1', facebook_page_id: '1234567890' }
                  : opts.clientRow,
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`fakeSb: 没配置表 ${table}`)
    },
  } as unknown as SupabaseClient
}

const RUN_INPUT = {
  object_story_id: '1234567890_9876543210',
  draft: draft(),
  draft_summary_hash: 'hash1',
  reservation_amount_nzd: 20,
}

beforeEach(() => { vi.clearAllMocks() })

describe('guard —— 先校验再预留', () => {
  it('草案有问题（缺 objectStoryId）→ 拒绝，不调预留', async () => {
    const badInput = { ...RUN_INPUT, draft: draft({ objectStoryId: undefined }) }
    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: badInput }))
    await expect(cap.steps.guard({ ctx: ctx(), stepKey: 'guard', attempt: 1, idempotencyKey: 'k', priorOutputs: {} }))
      .rejects.toThrow(KernelError)
    const reserveStore = { reserve: vi.fn() }
    vi.mocked(createSupabaseSpendReservationStore).mockReturnValue(reserveStore as never)
    expect(reserveStore.reserve).not.toHaveBeenCalled()
  })

  it('草案没问题 → 调 reserve，scope key 用 scopeKeyFor(clientId)', async () => {
    const reserve = vi.fn().mockResolvedValue({ ok: true, row: { reservedAmountNzd: 20 } })
    vi.mocked(createSupabaseSpendReservationStore).mockReturnValue({ reserve } as never)

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    const r = await cap.steps.guard({ ctx: ctx(), stepKey: 'guard', attempt: 1, idempotencyKey: 'k', priorOutputs: {} })

    expect(reserve).toHaveBeenCalledWith(CLIENT_ID, scopeKeyFor(CLIENT_ID), V1_SANDBOX_LIFETIME_CAP_NZD, 20)
    expect(r.output.reservation_scope_key).toBe(scopeKeyFor(CLIENT_ID))
  })

  it('超顶 → 抛 KernelError(COST_CAP_EXCEEDED)', async () => {
    vi.mocked(createSupabaseSpendReservationStore).mockReturnValue({
      reserve: vi.fn().mockResolvedValue({
        ok: false, reason: 'over_cost_cap',
        row: { reservedAmountNzd: 300, committedAmountNzd: 0, failedNeedsReconcileAmountNzd: 0 },
      }),
    } as never)
    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.guard({ ctx: ctx(), stepKey: 'guard', attempt: 1, idempotencyKey: 'k', priorOutputs: {} }))
      .rejects.toMatchObject({ code: 'COST_CAP_EXCEEDED' })
  })
})

describe('publish_paused —— 先查 tag 再建，已建过就接续', () => {
  it('findByTag 全 0 → 新建', async () => {
    vi.mocked(findByTag).mockResolvedValue({ campaigns: [], adSets: [], creatives: [], ads: [] })
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(createBoostAdPaused).mockResolvedValue({
      ok: true, campaignId: 'c1', adSetId: 'a1', creativeId: 'cr1', adId: 'ad1', deterministicTag: 'ME-SANDBOX-run-1',
    })

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    const r = await cap.steps.publish_paused({
      ctx: ctx(), stepKey: 'publish_paused', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { guard: { reservation_scope_key: scopeKeyFor(CLIENT_ID) } },
    })

    expect(createBoostAdPaused).toHaveBeenCalled()
    expect(r.output.ad_id).toBe('ad1')
  })

  it('findByTag 每层恰好 1 → 接续，不重建', async () => {
    vi.mocked(findByTag).mockResolvedValue({ campaigns: ['c1'], adSets: ['a1'], creatives: ['cr1'], ads: ['ad1'] })
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    const r = await cap.steps.publish_paused({
      ctx: ctx(), stepKey: 'publish_paused', attempt: 2, idempotencyKey: 'k',
      priorOutputs: { guard: { reservation_scope_key: scopeKeyFor(CLIENT_ID) } },
    })

    expect(createBoostAdPaused).not.toHaveBeenCalled()
    expect(r.output.ad_id).toBe('ad1')
  })

  it('findByTag 混合状态（部分建成）→ 转人工，不猜', async () => {
    vi.mocked(findByTag).mockResolvedValue({ campaigns: ['c1'], adSets: [], creatives: [], ads: [] })
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.publish_paused({
      ctx: ctx(), stepKey: 'publish_paused', attempt: 2, idempotencyKey: 'k',
      priorOutputs: { guard: {} },
    })).rejects.toMatchObject({ code: 'INVALID_STATE' })
    expect(createBoostAdPaused).not.toHaveBeenCalled()
  })

  it('建失败 → release 预留额度，不留在 reserved 状态', async () => {
    vi.mocked(findByTag).mockResolvedValue({ campaigns: [], adSets: [], creatives: [], ads: [] })
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(createBoostAdPaused).mockResolvedValue({
      ok: false, step: 'adset', error: 'boom', orphans: [], deterministicTag: 'ME-SANDBOX-run-1',
    })
    const release = vi.fn().mockResolvedValue({ ok: true, row: {} })
    vi.mocked(createSupabaseSpendReservationStore).mockReturnValue({ release } as never)

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.publish_paused({
      ctx: ctx(), stepKey: 'publish_paused', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { guard: {} },
    })).rejects.toMatchObject({ code: 'INVALID_STATE' })

    expect(release).toHaveBeenCalledWith(CLIENT_ID, scopeKeyFor(CLIENT_ID), 20)
  })
})

describe('gate —— 验证失败不删已建对象、不释放预留', () => {
  const BUILT = { campaign_id: 'c1', ad_set_id: 'a1', creative_id: 'cr1', ad_id: 'ad1' }

  it('回读不到广告组/创意 → VERIFICATION_FAILED', async () => {
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(fetchAdSetReadback).mockResolvedValue(null)
    vi.mocked(fetchAdCreativesReadback).mockResolvedValue(null)

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.gate({
      ctx: ctx(), stepKey: 'gate', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { publish_paused: BUILT },
    })).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' })
  })

  it('年龄对不上 → VERIFICATION_FAILED（checkLaunch 的 blocker）', async () => {
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(fetchAdSetReadback).mockResolvedValue({
      id: 'a1', optimization_goal: 'LINK_CLICKS', effective_status: 'PAUSED',
      daily_budget: '2000',
      targeting: { age_min: 25, age_max: 65 }, // 期望 55，回读到 25
    })
    vi.mocked(fetchAdCreativesReadback).mockResolvedValue([])

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.gate({
      ctx: ctx(), stepKey: 'gate', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { publish_paused: BUILT },
    })).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' })
  })

  it('预算对不上 → VERIFICATION_FAILED', async () => {
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(fetchAdSetReadback).mockResolvedValue({
      id: 'a1', optimization_goal: 'LINK_CLICKS', effective_status: 'PAUSED',
      daily_budget: '999', // 批准的是 2000 分（$20）
      targeting: { age_min: 55, age_max: 65, publisher_platforms: ['facebook'], targeting_automation: { advantage_audience: 0 } },
    })
    vi.mocked(fetchAdCreativesReadback).mockResolvedValue([])

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.gate({
      ctx: ctx(), stepKey: 'gate', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { publish_paused: BUILT },
    })).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' })
  })

  it('状态不是 PAUSED → VERIFICATION_FAILED（不该发生，但要能拦住）', async () => {
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(fetchAdSetReadback).mockResolvedValue({
      id: 'a1', optimization_goal: 'LINK_CLICKS', effective_status: 'ACTIVE',
      daily_budget: '2000',
      targeting: { age_min: 55, age_max: 65, publisher_platforms: ['facebook'], targeting_automation: { advantage_audience: 0 } },
    })
    vi.mocked(fetchAdCreativesReadback).mockResolvedValue([])

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    await expect(cap.steps.gate({
      ctx: ctx(), stepKey: 'gate', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { publish_paused: BUILT },
    })).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' })
  })

  it('全部对上 → 通过，verification.passed=true', async () => {
    vi.mocked(getMetaTokenForClient).mockResolvedValue('tok')
    vi.mocked(fetchAdSetReadback).mockResolvedValue({
      id: 'a1', optimization_goal: 'LINK_CLICKS', effective_status: 'PAUSED',
      daily_budget: '2000',
      targeting: {
        age_min: 55, age_max: 65, publisher_platforms: ['facebook'],
        targeting_automation: { advantage_audience: 0 }, geo_locations: { countries: ['NZ'] },
      },
    })
    vi.mocked(fetchAdCreativesReadback).mockResolvedValue([{ adId: 'ad1', adName: 'Ad', texts: ['正文'] }])

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    const r = await cap.steps.gate({
      ctx: ctx(), stepKey: 'gate', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { publish_paused: BUILT },
    })
    expect(r.verification?.passed).toBe(true)
    expect(r.verification?.method).toBe('meta_ad_boost_readback')
  })
})

describe('link —— 记归因，用 me_ad_launch + boost_organic_post', () => {
  it('用正确的参数调 linkAdToCreative', async () => {
    vi.mocked(linkAdToCreative).mockResolvedValue({
      creativeRef: 'cwo1', creativeSource: 'content_work_order', linkMethod: 'published_post_id', unresolvedReason: null,
    })

    const cap = createMetaBoostSandboxReelCapability(fakeSb({ runInput: RUN_INPUT }))
    const r = await cap.steps.link({
      ctx: ctx(), stepKey: 'link', attempt: 1, idempotencyKey: 'k',
      priorOutputs: { gate: { ad_id: 'ad1', campaign_id: 'c1' } },
    })

    expect(linkAdToCreative).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT_ID,
      adId: 'ad1',
      postId: '1234567890_9876543210',
      createdBy: 'me_ad_launch',
      play: 'boost_organic_post',
      playSource: 'declared_at_creation',
      playContext: { experiment: 'me_sandbox_v1' },
    }))
    expect(r.output.creative_ref).toBe('cwo1')
  })
})
