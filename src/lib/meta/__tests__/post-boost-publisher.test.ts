/**
 * post-boost-publisher 的测试（M1：真实 Meta API 调用序列，非 mock）。
 *
 * 守的第一条、跟 ad-publisher.test.ts 一样：**建出来的一律是暂停的**。
 * 第二条是本文件独有的：**用的是 object_story_id，不是新建 creative**——
 * 这是 boost_existing_post 存在的全部意义（保留原帖社交证明）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBoostAdPaused, activateBoostAd, findByTag } from '../post-boost-publisher'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

function boostDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'boost_existing_post',
    clientId: 'c-cts',
    campaignName: 'ME-Sandbox-2026-08-20-reel-abc',
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

interface Call { url: string; method: string; body: URLSearchParams }
let calls: Call[] = []

function mockGraph(fail?: { onPath: string }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ''))
    calls.push({ url, method: init?.method ?? 'GET', body })
    if (fail && url.includes(fail.onPath) && init?.method === 'POST') {
      return { ok: false, status: 400, text: async () => '{"error":{"message":"nope"}}' } as Response
    }
    if (init?.method === 'DELETE') return { ok: true, status: 200, text: async () => '{}' } as Response
    if (!init || init.method === undefined) {
      // GET（findByTag 用）
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) } as Response
    }
    const id = url.includes('/campaigns') ? 'camp1'
      : url.includes('/adsets') ? 'as1'
      : url.includes('/adcreatives') ? 'cr1'
      : 'ad1'
    return { ok: true, status: 200, text: async () => JSON.stringify({ id }) } as Response
  })
}

beforeEach(() => { calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('createBoostAdPaused — 前置校验（不做 Meta 调用）', () => {
  it('kind 不对 → 不发任何请求', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await createBoostAdPaused(boostDraft({ kind: 'video_thruplay' }), 'act_1', 'tok', 'run-x')
    expect(r.ok).toBe(false)
    expect(calls.length).toBe(0)
    if (!r.ok) expect(r.deterministicTag).toBe('ME-SANDBOX-run-x')
  })

  it('缺 objectStoryId → 不发任何请求', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await createBoostAdPaused(boostDraft({ objectStoryId: undefined }), 'act_1', 'tok', 'run-y')
    expect(r.ok).toBe(false)
    expect(calls.length).toBe(0)
  })
})

describe('createBoostAdPaused — 建出来的一律暂停', () => {
  it('系列 / 组 / 广告三层的 status 全是 PAUSED', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await createBoostAdPaused(boostDraft(), 'act_1', 'tok', 'run-happy')
    expect(r.ok).toBe(true)

    const statuses = calls
      .filter((c) => c.method === 'POST' && c.body.has('status'))
      .map((c) => c.body.get('status'))
    expect(statuses.length).toBeGreaterThanOrEqual(3)
    expect(statuses.every((s) => s === 'PAUSED')).toBe(true)
  })

  it('creative 请求用 object_story_id，不是 video_data/link_data（保留原帖社交证明）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await createBoostAdPaused(boostDraft(), 'act_1', 'tok', 'run-story')
    const creativeCall = calls.find((c) => c.url.includes('/adcreatives'))
    expect(creativeCall).toBeDefined()
    expect(creativeCall!.body.get('object_story_id')).toBe('1234567890_9876543210')
    expect(creativeCall!.body.has('video_data')).toBe(false)
    expect(creativeCall!.body.has('link_data')).toBe(false)
  })

  it('objective 三件套用 OUTCOME_TRAFFIC/LINK_CLICKS/WEBSITE', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await createBoostAdPaused(boostDraft(), 'act_1', 'tok', 'run-triplet')
    const campaignCall = calls.find((c) => c.url.includes('/campaigns'))
    const adsetCall = calls.find((c) => c.url.includes('/adsets'))
    expect(campaignCall!.body.get('objective')).toBe('OUTCOME_TRAFFIC')
    expect(adsetCall!.body.get('optimization_goal')).toBe('LINK_CLICKS')
    expect(adsetCall!.body.get('destination_type')).toBe('WEBSITE')
  })

  it('targeting 里 advantage_audience 显式为 0（不留隐式默认值的空子）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await createBoostAdPaused(boostDraft(), 'act_1', 'tok', 'run-adv')
    const adsetCall = calls.find((c) => c.url.includes('/adsets'))
    const targeting = JSON.parse(adsetCall!.body.get('targeting') ?? '{}')
    expect(targeting.targeting_automation.advantage_audience).toBe(0)
  })

  it('单平台 facebook → facebook_positions=[facebook_reels]', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await createBoostAdPaused(boostDraft({ publisherPlatforms: ['facebook'] }), 'act_1', 'tok', 'run-fb')
    const adsetCall = calls.find((c) => c.url.includes('/adsets'))
    const targeting = JSON.parse(adsetCall!.body.get('targeting') ?? '{}')
    expect(targeting.publisher_platforms).toEqual(['facebook'])
    expect(targeting.facebook_positions).toEqual(['facebook_reels'])
    expect(targeting.instagram_positions).toBeUndefined()
  })

  it('单平台 instagram → instagram_positions=[reels,profile_reels]', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await createBoostAdPaused(boostDraft({ publisherPlatforms: ['instagram'] }), 'act_1', 'tok', 'run-ig')
    const adsetCall = calls.find((c) => c.url.includes('/adsets'))
    const targeting = JSON.parse(adsetCall!.body.get('targeting') ?? '{}')
    expect(targeting.publisher_platforms).toEqual(['instagram'])
    expect(targeting.instagram_positions).toEqual(['reels', 'profile_reels'])
    expect(targeting.facebook_positions).toBeUndefined()
  })

  it('deterministicTag 出现在四层对象的 name 里（findByTag 反查靠它）', async () => {
    vi.stubGlobal('fetch', mockGraph())
    await createBoostAdPaused(boostDraft(), 'act_1', 'tok', 'run-tag')
    const named = calls.filter((c) => c.method === 'POST' && c.body.has('name'))
    expect(named.length).toBeGreaterThanOrEqual(2) // campaign + adset 至少两层有 name
    for (const c of named) {
      expect(c.body.get('name')).toContain('ME-SANDBOX-run-tag')
    }
  })

  it('adset 失败 → 回滚 campaign，返回 orphans（删不掉才非空）', async () => {
    vi.stubGlobal('fetch', mockGraph({ onPath: '/adsets' }))
    const r = await createBoostAdPaused(boostDraft(), 'act_1', 'tok', 'run-fail')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.step).toBe('adset')
      expect(r.orphans).toEqual([]) // mock 里 DELETE 总成功，orphans 应该是空
      const deleteCalls = calls.filter((c) => c.method === 'DELETE')
      expect(deleteCalls.length).toBe(1) // 删回刚建的 campaign
    }
  })
})

describe('activateBoostAd — 从下往上开，部分成功要收拾', () => {
  it('三层依次改成 ACTIVE，顺序是 ad → adset → campaign', async () => {
    vi.stubGlobal('fetch', mockGraph())
    const r = await activateBoostAd({ campaignId: 'camp1', adSetId: 'as1', adId: 'ad1' }, 'tok')
    expect(r.ok).toBe(true)
    const activateCalls = calls.filter((c) => c.body.get('status') === 'ACTIVE')
    expect(activateCalls.map((c) => c.url)).toEqual(['ad1', 'as1', 'camp1'].map((id) => expect.stringContaining(id)))
  })

  it('adset 层激活失败 → 已激活的 ad 层被重新 pause 回去', async () => {
    vi.stubGlobal('fetch', mockGraph({ onPath: 'as1' }))
    const r = await activateBoostAd({ campaignId: 'camp1', adSetId: 'as1', adId: 'ad1' }, 'tok')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.partiallyActivated).toEqual(['ad1'])
      const pauseBack = calls.filter((c) => c.url.includes('ad1') && c.body.get('status') === 'PAUSED')
      expect(pauseBack.length).toBe(1)
    }
  })
})

describe('findByTag — 三态反查', () => {
  it('查询失败 → 抛错，不返回空数组（"查不到"和"查炸了"必须分开）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as Response))
    await expect(findByTag('act_1', 'tok', 'ME-SANDBOX-run-1')).rejects.toThrow()
  })

  it('全 0 → 四个数组都是空（真的没建过）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) }) as Response))
    const r = await findByTag('act_1', 'tok', 'ME-SANDBOX-run-none')
    expect(r).toEqual({ campaigns: [], adSets: [], creatives: [], ads: [] })
  })

  it('每层恰好 1 个 → 全建成', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'x1', name: 'tagged' }] }) }) as Response),
    )
    const r = await findByTag('act_1', 'tok', 'ME-SANDBOX-run-one')
    expect(r.campaigns).toEqual(['x1'])
    expect(r.adSets).toEqual(['x1'])
    expect(r.creatives).toEqual(['x1'])
    expect(r.ads).toEqual(['x1'])
  })
})
