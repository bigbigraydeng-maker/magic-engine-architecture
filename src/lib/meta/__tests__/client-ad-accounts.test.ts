/**
 * getClientAdAccounts / getClientAdAccountIds — 多账户读取的共享入口。
 *
 * 这是给"查不出来就少扫一点"能接受的调用方用的（同步 cron、每日巡检），
 * 跟 campaign-ownership 那种必须 fail closed 的安全闸不是一回事，所以这里
 * 查询失败会退化成空数组而不是抛错，测试也照这个约定来断言。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { accountsEq, clientMaybeSingle } = vi.hoisted(() => ({
  accountsEq: vi.fn(),
  clientMaybeSingle: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'client_meta_ad_accounts') {
        return { select: () => ({ eq: () => ({ order: accountsEq }) }) }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: clientMaybeSingle }) }) }
    },
  },
}))

import { getClientAdAccounts, getClientAdAccountIds } from '../client-ad-accounts'

function resetAll() {
  accountsEq.mockReset()
  clientMaybeSingle.mockReset()
}

describe('getClientAdAccounts', () => {
  beforeEach(resetAll)

  it('新表有多条记录 → 全部返回，主账户排前面（按查询里的 order 结果原样返回）', async () => {
    accountsEq.mockResolvedValue({
      data: [
        { ad_account_id: 'act_111', label: '主账户', is_primary: true },
        { ad_account_id: 'act_222', label: 'CTStours 官方账户', is_primary: false },
      ],
      error: null,
    })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([
      { adAccountId: 'act_111', label: '主账户', isPrimary: true },
      { adAccountId: 'act_222', label: 'CTStours 官方账户', isPrimary: false },
    ])
    expect(clientMaybeSingle).not.toHaveBeenCalled()
  })

  it('新表 0 行 → 退回老列 meta_ad_account_id', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_123' }, error: null })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([{ adAccountId: 'act_123', label: '主账户', isPrimary: true }])
  })

  it('新表 0 行、老列也是 null → 空数组（不是抛错）', async () => {
    accountsEq.mockResolvedValue({ data: [], error: null })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: null }, error: null })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([])
  })

  it('新表查询出错 → 退化成退回老列（同步类调用方，查不出来就少扫一点，不抛错）', async () => {
    accountsEq.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    clientMaybeSingle.mockResolvedValue({ data: { meta_ad_account_id: 'act_999' }, error: null })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([{ adAccountId: 'act_999', label: '主账户', isPrimary: true }])
  })

  it('两处都出错 → 空数组，不抛异常', async () => {
    accountsEq.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    clientMaybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const accounts = await getClientAdAccounts('client-a')
    expect(accounts).toEqual([])
  })
})

describe('getClientAdAccountIds', () => {
  beforeEach(resetAll)

  it('只取 id 字符串列表', async () => {
    accountsEq.mockResolvedValue({
      data: [
        { ad_account_id: 'act_111', label: '主账户', is_primary: true },
        { ad_account_id: 'act_222', label: null, is_primary: false },
      ],
      error: null,
    })
    const ids = await getClientAdAccountIds('client-a')
    expect(ids).toEqual(['act_111', 'act_222'])
  })
})
