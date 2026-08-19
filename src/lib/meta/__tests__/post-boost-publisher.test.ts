/**
 * Day 1 骨架测试。
 *
 * 现在 publisher 只是 mock（返固定字符串 id），所以这里只测：
 *   1. kind 不对时不被误调
 *   2. 缺 objectStoryId 时不被误调
 *   3. deterministicTag 一定是 `ME-SANDBOX-<runId>` 形式
 *   4. findByTag 骨架返空四态结构
 *
 * 真实 Graph API 行为的测试在 Day 2 补齐（含幂等：同 runId 重跑不重建）。
 */

import { describe, it, expect } from 'vitest'
import type { AdDraft } from '../../ads-strategy/ad-draft'
import { createBoostAdPaused, activateBoostAd, findByTag } from '../post-boost-publisher'

function boostDraft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'boost_existing_post',
    clientId: 'c-cts',
    campaignName: 'ME-Sandbox-test',
    adSetName: 'NZ 55+',
    dailyBudget: 20,
    durationDays: 5,
    geoCountries: ['NZ'],
    ageMin: 55,
    ageMax: 65,
    pageId: '1234567890',
    creatives: [],
    objectStoryId: '1234567890_9876543210',
    publisherPlatforms: ['facebook', 'instagram'],
    advantageAudience: 0,
    destinationUrl: 'https://www.ctstours.co.nz/china-tours',
    ...over,
  }
}

describe('createBoostAdPaused —— Day 1 骨架', () => {
  it('kind 不对时不做 Meta 调用', async () => {
    const wrongKind = boostDraft({ kind: 'video_thruplay' })
    const r = await createBoostAdPaused(wrongKind, 'act_123', 'token', 'run-x')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('boost_existing_post')
      // 就算失败也带 tag —— 便于事后按 tag 反查是否有残留
      expect(r.deterministicTag).toBe('ME-SANDBOX-run-x')
    }
  })

  it('缺 objectStoryId 时不做 Meta 调用', async () => {
    const missingStoryId = boostDraft({ objectStoryId: undefined })
    const r = await createBoostAdPaused(missingStoryId, 'act_123', 'token', 'run-y')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.step).toBe('creative')
  })

  it('happy path 返齐全的四层 id + deterministicTag', async () => {
    const r = await createBoostAdPaused(boostDraft(), 'act_123', 'token', 'run-happy')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.campaignId).toBeTruthy()
      expect(r.adSetId).toBeTruthy()
      expect(r.creativeId).toBeTruthy()
      expect(r.adId).toBeTruthy()
      expect(r.deterministicTag).toBe('ME-SANDBOX-run-happy')
    }
  })

  it('deterministicTag 严格是 ME-SANDBOX-<runId>（Day 2 findByTag 反查靠它）', async () => {
    const r = await createBoostAdPaused(boostDraft(), 'act_123', 'token', 'run-tag-format')
    if (r.ok) expect(r.deterministicTag).toMatch(/^ME-SANDBOX-run-tag-format$/)
  })
})

describe('activateBoostAd —— Day 1 骨架', () => {
  it('骨架返 ok（Day 2 换真实 activate）', async () => {
    const r = await activateBoostAd(
      { campaignId: 'c1', adSetId: 'a1', adId: 'ad1' },
      'token',
    )
    expect(r.ok).toBe(true)
  })
})

describe('findByTag —— Day 1 骨架', () => {
  it('骨架返空四态结构（Day 2 换真实 Graph filtering 查询）', async () => {
    const r = await findByTag('act_123', 'token', 'ME-SANDBOX-run-empty')
    expect(r).toEqual({ campaigns: [], adSets: [], creatives: [], ads: [] })
  })
})
