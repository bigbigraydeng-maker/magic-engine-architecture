/**
 * PATCH /api/clients/[id]/meta-ad-account — 2026-09-13 新增行为：
 * 写 clients.meta_ad_account_id 的同时，把 client_meta_ad_accounts 的主账户
 * 行也镜像更新，防止多账户读路径（getClientAdAccounts）看到过期数据。
 *
 * 只测这一次新加的行为，不重新测这个路由本来就有、之前也没测过的
 * 校验/清空/鉴权逻辑（那些不在本次改动范围内）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { clientsUpdate, accountsUpdateEq2, accountsUpsert, accountsSelectMaybeSingle } = vi.hoisted(() => ({
  clientsUpdate: vi.fn(),
  accountsUpdateEq2: vi.fn(),
  accountsUpsert: vi.fn(),
  accountsSelectMaybeSingle: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'clients') {
        return { update: () => ({ eq: clientsUpdate }) }
      }
      if (table === 'client_meta_ad_accounts') {
        return {
          // 降级旧主账户：.update({is_primary:false}).eq('client_id',x).eq('is_primary',true)
          update: () => ({ eq: () => ({ eq: accountsUpdateEq2 }) }),
          upsert: accountsUpsert,
          // 提升前先读一次已有 label：.select('label').eq('client_id',x).eq('ad_account_id',y).maybeSingle()
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: accountsSelectMaybeSingle }) }) }),
        }
      }
      return {}
    },
  },
}))

import { PATCH } from './route'

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/clients/c1/meta-ad-account', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
const params = Promise.resolve({ id: 'c1' })

beforeEach(() => {
  vi.clearAllMocks()
  clientsUpdate.mockResolvedValue({ error: null })
  accountsUpdateEq2.mockResolvedValue({ error: null })
  accountsUpsert.mockResolvedValue({ error: null })
  accountsSelectMaybeSingle.mockResolvedValue({ data: null, error: null })
})

describe('PATCH meta-ad-account — 镜像写 client_meta_ad_accounts', () => {
  it('设置新的主账户 → 先降级旧主账户，再 upsert 新的 is_primary=true 行', async () => {
    const res = await PATCH(makeReq({ ad_account_id: 'act_2202695063810470' }), { params })
    expect(res.status).toBe(200)

    expect(accountsUpdateEq2).toHaveBeenCalledWith('is_primary', true)
    expect(accountsUpsert).toHaveBeenCalledWith(
      { client_id: 'c1', ad_account_id: 'act_2202695063810470', is_primary: true, label: '主账户' },
      { onConflict: 'client_id,ad_account_id' },
    )
  })

  it('已注册过、带自定义标签的账户被设为主账户 → 保留原有标签，不覆盖成默认值', async () => {
    accountsSelectMaybeSingle.mockResolvedValue({ data: { label: 'CTStours 官方账户（ThruPlay）' }, error: null })

    const res = await PATCH(makeReq({ ad_account_id: 'act_2202695063810470' }), { params })
    expect(res.status).toBe(200)

    expect(accountsUpsert).toHaveBeenCalledWith(
      { client_id: 'c1', ad_account_id: 'act_2202695063810470', is_primary: true, label: 'CTStours 官方账户（ThruPlay）' },
      { onConflict: 'client_id,ad_account_id' },
    )
  })

  it('清空主账户（ad_account_id: null）→ 只降级旧主账户，不 upsert 新行', async () => {
    const res = await PATCH(makeReq({ ad_account_id: null }), { params })
    expect(res.status).toBe(200)

    expect(accountsUpdateEq2).toHaveBeenCalledWith('is_primary', true)
    expect(accountsUpsert).not.toHaveBeenCalled()
  })

  it('镜像写失败不影响主流程 —— clients.meta_ad_account_id 已经更新成功就返回 200', async () => {
    accountsUpsert.mockResolvedValue({ error: { message: 'timeout' } })

    const res = await PATCH(makeReq({ ad_account_id: 'act_123456789012' }), { params })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('clients 表更新本身失败 → 仍然 500，且不去动 client_meta_ad_accounts', async () => {
    clientsUpdate.mockResolvedValue({ error: { message: 'db down' } })

    const res = await PATCH(makeReq({ ad_account_id: 'act_123456789012' }), { params })
    expect(res.status).toBe(500)
    expect(accountsUpdateEq2).not.toHaveBeenCalled()
    expect(accountsUpsert).not.toHaveBeenCalled()
  })
})
