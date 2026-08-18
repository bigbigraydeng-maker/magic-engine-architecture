/**
 * AD-SEC-1 归属校验的测试。
 *
 * 守的是「campaign_id 来自请求体，必须真的属于这个客户登记的广告账户」——
 * 每一条读不出来的分支都必须 fail closed（拒绝），不能默认放行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock 工厂被提到文件最前面执行，这时候普通 const 还没跑到——用 vi.hoisted
// 把 mock 函数的创建也提到同一个位置，不然会撞 TDZ（引用了还没初始化的变量）。
const { maybeSingle, getCampaignDetails } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  getCampaignDetails: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}))
vi.mock('../client', () => ({ getCampaignDetails }))

import { assertCampaignOwnedByClient } from '../campaign-ownership'

describe('assertCampaignOwnedByClient — 允许路径', () => {
  beforeEach(() => { maybeSingle.mockReset(); getCampaignDetails.mockReset() })

  it('account_id 完全一致 → 放行', async () => {
    maybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_123' }, error: null })
    getCampaignDetails.mockResolvedValue({ id: 'camp1', name: 'x', status: 'ACTIVE', account_id: '123' })
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(true)
  })

  it('一边带 act_ 前缀一边不带 → 归一化后仍算一致', async () => {
    maybeSingle.mockResolvedValue({ data: { meta_ad_account_id: '123' }, error: null })
    getCampaignDetails.mockResolvedValue({ id: 'camp1', name: 'x', status: 'ACTIVE', account_id: 'act_123' })
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(true)
  })
})

describe('assertCampaignOwnedByClient — 拒绝路径（每条都必须 fail closed）', () => {
  beforeEach(() => { maybeSingle.mockReset(); getCampaignDetails.mockReset() })

  it('客户没登记广告账户 → 拒绝，不是放行', async () => {
    maybeSingle.mockResolvedValue({ data: { meta_ad_account_id: null }, error: null })
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(false)
    expect(getCampaignDetails).not.toHaveBeenCalled()
  })

  it('查客户表出错 → 拒绝，不是放行', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(false)
  })

  it('Meta 读不到这条 campaign → 拒绝', async () => {
    maybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_123' }, error: null })
    getCampaignDetails.mockResolvedValue(null)
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(false)
  })

  it('Meta 没返回 account_id → 拒绝（不当成「没问题」）', async () => {
    maybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_123' }, error: null })
    getCampaignDetails.mockResolvedValue({ id: 'camp1', name: 'x', status: 'ACTIVE' })
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(false)
  })

  it('跨客户：campaign 的 account_id 跟这个客户登记的账户对不上 → 拒绝', async () => {
    maybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_111' }, error: null })
    getCampaignDetails.mockResolvedValue({ id: 'camp1', name: 'x', status: 'ACTIVE', account_id: '999' })
    const r = await assertCampaignOwnedByClient('camp1', 'client-a', 'tok')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不属于')
  })
})
