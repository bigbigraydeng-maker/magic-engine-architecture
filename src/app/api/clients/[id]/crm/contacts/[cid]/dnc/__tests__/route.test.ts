/**
 * 「这条『别再联系』判错了」的取消接口。
 *
 * 两件事必须钉死：
 *
 * 1. **触点先写，那一列后放** —— 判据看的是触点（`lib/crm/dnc`）。顺序反过来，
 *    中间失败会留下「列已经放下、但触点还说别再联系」：页面上看着像取消了，
 *    实际这个人照旧被排除，而没有任何记录说明发生过什么。
 *
 * 2. **只成一半不许报成功**（Codex 复审 2026-08-16）—— 判据虽然以触点为准，
 *    但今日待办的 `pushDncReviewItems()` 和群发接口还直接按
 *    `contacts.do_not_contact = true` 筛人。那一列没放下来却回 200，页面写着
 *    「放回名单了」，实际群发照旧跳过他、那条人工任务第二天又冒出来 ——
 *    FDE 会以为自己点了个假按钮。`clientRef` 是幂等键，报失败让人再点一下，
 *    补的就是这第二步。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { POST } from '../route'

const CLIENT_ID = 'client-abc'
const CONTACT_ID = 'contact-1'

const ctx = { params: { id: CLIENT_ID, cid: CONTACT_ID } }

function req(body: unknown = { clientRef: 'ref-1' }) {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/crm/contacts/${CONTACT_ID}/dnc`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
}

/** 记录调用顺序，用来验「触点先写」。 */
let calls: string[] = []

/**
 * @param contactRow  IDOR 闸那一步查到的 contact（null = 不属于这个客户）
 * @param touchErr    写触点是否失败
 * @param updateErr   放下 contacts.do_not_contact 那一列是否失败
 */
function stubDb(opts: {
  contactRow?: { id: string } | null
  touchErr?: string
  updateErr?: string
} = {}) {
  const { contactRow = { id: CONTACT_ID }, touchErr, updateErr } = opts
  calls = []
  mocks.from.mockImplementation((table: string) => {
    if (table === 'contact_touchpoints') {
      return {
        upsert: () => {
          calls.push('touchpoint')
          return {
            select: () => ({
              maybeSingle: async () =>
                touchErr
                  ? { data: null, error: { message: touchErr } }
                  : { data: { id: 'tp-1' }, error: null },
            }),
          }
        },
      }
    }
    // contacts 表被用两次：先 select 做 IDOR 闸，再 update 放下那一列。
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: contactRow, error: null }) }),
        }),
      }),
      update: () => {
        calls.push('contacts-update')
        return {
          eq: () => ({
            eq: async () => (updateErr ? { error: { message: updateErr } } : { error: null }),
          }),
        }
      },
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePaidClientAccess.mockResolvedValue({
    ok: true,
    user: { email: 'fde@test.com' },
    role: 'admin',
    allowedClientId: null,
  })
})

describe('取消「别再联系」', () => {
  it('两步都成 → 200', async () => {
    stubDb()
    const res = await POST(req(), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('先写触点，再放下那一列 —— 顺序反了中间失败会留下假的「已取消」', async () => {
    stubDb()
    await POST(req(), ctx)
    expect(calls).toEqual(['touchpoint', 'contacts-update'])
  })

  it('那一列没放下来 → 报失败，别宣称已经放回名单', async () => {
    stubDb({ updateErr: 'deadlock detected' })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(500)
  })

  it('触点没写上 → 报失败，而且不去动那一列', async () => {
    stubDb({ touchErr: 'timeout' })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(500)
    expect(calls).toEqual(['touchpoint'])
  })
})

describe('别人的联系人碰不到', () => {
  it('contact 不属于这个客户 → 404，而且一个字都没写', async () => {
    stubDb({ contactRow: null })
    const res = await POST(req(), ctx)
    expect(res.status).toBe(404)
    expect(calls).toEqual([])
  })

  it('没登录 → 401', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({ ok: false, status: 401, error: '未登录' })
    stubDb()
    const res = await POST(req(), ctx)
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })
})

describe('幂等键', () => {
  it('没带 clientRef → 400，双击就会记成两笔纠正', async () => {
    stubDb()
    const res = await POST(req({}), ctx)
    expect(res.status).toBe(400)
    expect(calls).toEqual([])
  })
})
