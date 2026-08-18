/**
 * AD-SEC-1：`winner_reel_sync_config` 这张表自己没有归属校验。如果一行配错/
 * 串成了别的客户的 ad_account_id / fb_page_id，engine 会往错的客户账户里
 * 建广告、暂停错客户的广告。这里守的是「读到配置之后、碰 Meta 之前」这道闸。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdFromPost = vi.fn()
const pauseAd = vi.fn()

vi.mock('@/lib/meta/ads-manager', () => ({
  pauseAd: (...a: unknown[]) => pauseAd(...a),
  createAdFromPost: (...a: unknown[]) => createAdFromPost(...a),
  listAdsInAdSet: async () => [],
  fetchCTRForAds: async () => ({}),
}))

vi.mock('@/lib/meta/page-posts', () => ({
  getPageAccessToken: async () => 'page-token',
  fetchPagePosts: async () => [{ id: 'p' }],
  rankVideoWinners: () => [],
}))

vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'user-token' }))
vi.mock('@/lib/ads/creative-link', () => ({ linkAdToCreative: async () => ({ creativeRef: null, creativeSource: null, linkMethod: 'unresolved', unresolvedReason: null }) }))

const CONFIG_ROW = {
  client_id: 'client-a',
  fb_page_id: 'page-of-client-a',
  ad_account_id: 'act_111',
  target_adset_id: 'adset1',
  min_active_ads: 1,
  ad_min_age_days: 0,
  max_new_ads_per_run: 3,
  winner_min_score: 0,
  new_ad_default_status: 'PAUSED',
  blacklist_keywords: [],
  slack_webhook_url: null,
}

let clientRow: Record<string, unknown> | null = { meta_ad_account_id: 'act_111', facebook_page_id: 'page-of-client-a' }
let syncLogInserts: Record<string, unknown>[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === 'winner_reel_sync_config'
            ? { data: CONFIG_ROW, error: null }
            : table === 'clients'
              ? { data: clientRow, error: null }
              : { data: null, error: null },
        insert: async (row: Record<string, unknown>) => {
          if (table === 'winner_reel_sync_log') syncLogInserts.push(row)
          return { error: null }
        },
      }
      return builder
    },
  }),
}))

import { syncWinnerReels } from '../engine'

beforeEach(() => {
  vi.clearAllMocks()
  syncLogInserts = []
  clientRow = { meta_ad_account_id: 'act_111', facebook_page_id: 'page-of-client-a' }
})

describe('syncWinnerReels — 配置归属校验', () => {
  it('账户/主页都对得上 → 正常往下走，不被拦', async () => {
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('ok')
  })

  it('配置行的广告账户跟 clients 表登记的不一致 → 拒绝，不碰 Meta', async () => {
    clientRow = { meta_ad_account_id: 'act_999_别家客户', facebook_page_id: 'page-of-client-a' }
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(r.errorMessage).toContain('广告账户')
    expect(createAdFromPost).not.toHaveBeenCalled()
    expect(pauseAd).not.toHaveBeenCalled()
    expect(syncLogInserts[0]).toMatchObject({ status: 'error' })
  })

  it('配置行的主页跟 clients 表登记的不一致 → 拒绝，不碰 Meta', async () => {
    clientRow = { meta_ad_account_id: 'act_111', facebook_page_id: 'page-of-someone-else' }
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(r.errorMessage).toContain('主页')
    expect(createAdFromPost).not.toHaveBeenCalled()
  })

  it('clients 表查不到这个客户 → fail closed，不是默认放行', async () => {
    clientRow = null
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('error')
    expect(createAdFromPost).not.toHaveBeenCalled()
  })

  it('act_ 前缀不一致但数字一样 → 算匹配（归一化比较，不是字符串死板相等）', async () => {
    clientRow = { meta_ad_account_id: '111', facebook_page_id: 'page-of-client-a' } // 无 act_ 前缀
    const r = await syncWinnerReels('client-a')
    expect(r.status).toBe('ok')
  })
})
