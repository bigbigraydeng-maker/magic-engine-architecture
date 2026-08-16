/**
 * 群发记一笔。
 *
 * 🔴 这条路径最容易一次伤到一大片：一次调用最多 500 人，而取消「别再联系」
 * 是**一次一个人**的，没有批量入口。所以两件事必须钉死：
 *   · 群发的备注永远推不出「别再联系」
 *   · 说过别再联系的人，即使前端传进来也绝不记
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  from: vi.fn(),
  recordManualTouchpoint: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: mocks.requirePaidClientAccess,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/crm/touchpoints', () => ({ recordManualTouchpoint: mocks.recordManualTouchpoint }))

import { POST } from '../route'

const CLIENT_ID = 'client-abc'
const ctx = { params: { id: CLIENT_ID } }

function req(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3001/api/clients/${CLIENT_ID}/crm/touchpoints/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRef: 'ref-1', ...body }),
  })
}

/** @param touches 这些人的触点（拒联判据的真相源） */
function stubDb(
  contacts: { id: string; do_not_contact?: boolean }[],
  touches: Record<string, unknown>[] = [],
) {
  mocks.from.mockImplementation((table: string) => {
    if (table === 'contacts') {
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: contacts.map((c) => ({
                id: c.id,
                last_seen_at: null,
                do_not_contact: c.do_not_contact === true,
              })),
              error: null,
            }),
          }),
        }),
      }
    }
    return {
      select: () => ({
        eq: () => ({
          in: () => ({
            order: () => ({
              order: () => ({ range: async () => ({ data: touches, error: null }) }),
            }),
          }),
        }),
      }),
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
  mocks.recordManualTouchpoint.mockResolvedValue({ created: true })
})

describe('群发的备注永远推不出「别再联系」', () => {
  it('🔴 备注里带着退订页脚 → 一个人都不许被标成拒联', async () => {
    stubDb([{ id: 'c1' }, { id: 'c2' }])
    const res = await POST(
      req({
        contactIds: ['c1', 'c2'],
        note: 'Sent newsletter; you can unsubscribe from the list at any time',
      }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(mocks.recordManualTouchpoint).toHaveBeenCalledTimes(2)
    for (const call of mocks.recordManualTouchpoint.mock.calls) {
      expect(call[0].parsed.do_not_contact).toBe(false)
    }
  })

  it('🔴 就算备注直接写「客户说别再联系」也不行 —— 那不是这批人说的话', async () => {
    stubDb([{ id: 'c1' }])
    await POST(req({ contactIds: ['c1'], note: '客户说别再联系' }), ctx)
    expect(mocks.recordManualTouchpoint.mock.calls[0][0].parsed.do_not_contact).toBe(false)
  })
})

describe('说过别再联系的人，群发时绝不记', () => {
  it('镜像列说是 → 跳过', async () => {
    stubDb([{ id: 'c1', do_not_contact: true }, { id: 'c2' }])
    const res = await POST(req({ contactIds: ['c1', 'c2'], note: '群发了一封邮件' }), ctx)

    expect(mocks.recordManualTouchpoint).toHaveBeenCalledTimes(1)
    expect(mocks.recordManualTouchpoint.mock.calls[0][0].contactId).toBe('c2')
    expect((await res.json()).skipped).toBe(1)
  })

  it('只有触点说过（镜像列没写上）→ 一样跳过', async () => {
    stubDb(
      [{ id: 'c1' }],
      [
        {
          id: 't1',
          contact_id: 'c1',
          metadata: { outcome: 'do_not_contact' },
          occurred_at: '2026-07-01T00:00:00Z',
          raw: null,
          direction: 'outbound',
          source: 'me_manual',
        },
      ],
    )
    await POST(req({ contactIds: ['c1'], note: '群发了一封邮件' }), ctx)
    expect(mocks.recordManualTouchpoint).not.toHaveBeenCalled()
  })
})
