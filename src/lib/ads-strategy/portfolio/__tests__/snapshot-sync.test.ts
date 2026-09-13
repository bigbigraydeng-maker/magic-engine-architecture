/**
 * 快照同步：共用账户读侧隔离（§14 M9）、读失败不写、上一行读不到不写。
 * Meta 返回用真实实拉 fixtures；假 supabase 按表建模（不按调用顺序）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import nal from './fixtures/nal-settings.json'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const tableErrors: Record<string, { message: string } | null> = {}
const inserted: Row[] = []

function query(table: string) {
  const filters: Array<[string, unknown]> = []
  const run = () => {
    if (tableErrors[table]) return { data: null, error: tableErrors[table] }
    const rows = (tables[table] ?? []).filter(r => filters.every(([k, v]) => r[k] === v))
    return { data: rows, error: null }
  }
  const builder = {
    select: () => builder,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return builder },
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
    insert: async (rows: Row[]) => {
      if (tableErrors[`${table}:insert`]) return { error: tableErrors[`${table}:insert`] }
      inserted.push(...rows)
      return { error: null }
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (t: string) => query(t) } }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: async () => 'token' }))

const read = { campaigns: vi.fn(), adsets: vi.fn(), ads: vi.fn(), audiences: vi.fn(), account: vi.fn() }
vi.mock('@/lib/meta/entity-settings', () => ({
  fetchAccountSettings: () => read.account(),
  fetchCampaignSettings: () => read.campaigns(),
  fetchAdsetSettings: () => read.adsets(),
  fetchAdSettings: () => read.ads(),
  fetchCustomAudiences: () => read.audiences(),
}))

import { captureClientSnapshots } from '../snapshot-sync'

const ok = <T>(rows: T[]) => ({ rows, complete: true, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(tables)) delete tables[k]
  for (const k of Object.keys(tableErrors)) delete tableErrors[k]
  inserted.length = 0
  read.account.mockResolvedValue(ok([nal.account]))
  read.campaigns.mockResolvedValue(ok(nal.campaigns))
  read.adsets.mockResolvedValue(ok(nal.adsets))
  read.ads.mockResolvedValue(ok(nal.ads))
  read.audiences.mockResolvedValue(ok(nal.audiences))
  tables.client_meta_ad_accounts = [{ client_id: 'client-nal', ad_account_id: 'act_953025114498626' }]
  tables.ad_entity_snapshots = []
})

describe('captureClientSnapshots', () => {
  it('独占账户：五个层级全部写入（NAL 实拉：1 账户 + 5 系列 + 7 广告组 + 10 广告 + 1 受众）', async () => {
    const res = await captureClientSnapshots('client-nal', ['act_953025114498626'])
    expect(res.success).toBe(true)
    const count = (level: string) => inserted.filter(r => r.level === level).length
    expect([count('account'), count('campaign'), count('adset'), count('ad'), count('audience')]).toEqual([1, 5, 7, 10, 1])
    expect(inserted.every(r => r.client_id === 'client-nal' && r.shared_account === false)).toBe(true)
  })

  it('🔴 M9 共用账户（同账户登记给两个客户）：只写账户级并标 shared_account，不读不写任何实体', async () => {
    tables.client_meta_ad_accounts = [
      { client_id: 'client-roman', ad_account_id: 'act_1260456876069575' },
      { client_id: 'client-kiteroa', ad_account_id: '1260456876069575' },
    ]
    const res = await captureClientSnapshots('client-roman', ['act_1260456876069575'])
    expect(res.accounts[0].shared_account).toBe(true)
    expect(inserted.map(r => r.level)).toEqual(['account'])
    expect(inserted[0].shared_account).toBe(true)
    expect(read.campaigns).not.toHaveBeenCalled()
    expect(read.adsets).not.toHaveBeenCalled()
  })

  it('🔴 登记表查询出错 → fail closed：全部当共用处理，只写账户级', async () => {
    tableErrors.client_meta_ad_accounts = { message: 'boom' }
    const res = await captureClientSnapshots('client-nal', ['act_953025114498626'])
    expect(res.success).toBe(false)
    expect(inserted.map(r => r.level)).toEqual(['account'])
    expect(read.adsets).not.toHaveBeenCalled()
  })

  it('某一层读不全（Meta 报错）→ 这一层不写，其它层照写，结果里标出来', async () => {
    read.adsets.mockResolvedValue({ rows: [], complete: false, error: { status: 403, code: 200, message: 'no permission' } })
    const res = await captureClientSnapshots('client-nal', ['act_953025114498626'])
    expect(res.success).toBe(false)
    expect(res.accounts[0].skipped_levels).toEqual([{ level: 'adset', error: 'no permission' }])
    expect(inserted.some(r => r.level === 'adset')).toBe(false)
    expect(inserted.some(r => r.level === 'campaign')).toBe(true)
  })

  it('读不到上一行快照 → 本轮一行都不写（否则全量记成 changed 污染历史）', async () => {
    tableErrors.ad_entity_snapshots = { message: 'relation does not exist' }
    const res = await captureClientSnapshots('client-nal', ['act_953025114498626'])
    expect(res.success).toBe(false)
    expect(inserted).toEqual([])
  })

  it('账户本身读不到 → 整个账户跳过', async () => {
    read.account.mockResolvedValue({ rows: [], complete: false, error: { status: 400, code: 190, message: 'token invalid' } })
    const res = await captureClientSnapshots('client-nal', ['act_953025114498626'])
    expect(res.accounts[0].skipped_levels[0]).toMatchObject({ level: 'account', error: 'token invalid' })
    expect(inserted).toEqual([])
  })
})
