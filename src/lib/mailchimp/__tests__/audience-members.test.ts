import { describe, it, expect, vi } from 'vitest'
import { fetchSubscribedMembers } from '../audience-members'

const CFG = { apiKey: 'key-us19', audienceId: 'dda97b7e61' }

function page(members: unknown[]) {
  return { ok: true, json: async () => ({ members }) } as unknown as Response
}

describe('只拉已订阅成员', () => {
  it('取邮箱/电话/姓名，邮箱转小写', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      page([
        { email_address: 'A@Example.COM', status: 'subscribed', merge_fields: { FNAME: 'Ann', LNAME: 'Lee', PHONE: '+64211' } },
      ]),
    )
    const out = await fetchSubscribedMembers(CFG, { fetcher })
    expect(out).toEqual([{ email: 'a@example.com', phone: '+64211', firstName: 'Ann', lastName: 'Lee' }])
  })

  it('URL 带 status=subscribed（不拉退订/失效）', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(page([]))
    await fetchSubscribedMembers(CFG, { fetcher })
    expect(fetcher.mock.calls[0][0]).toContain('status=subscribed')
    // 打到正确的数据中心（从 key 末尾的 us19 取）
    expect(fetcher.mock.calls[0][0]).toContain('us19.api.mailchimp.com')
    expect(fetcher.mock.calls[0][0]).toContain(`/lists/${CFG.audienceId}/members`)
  })

  it('🔴 双保险：即使 API 混进非 subscribed 也丢掉', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      page([
        { email_address: 'ok@x.com', status: 'subscribed', merge_fields: {} },
        { email_address: 'gone@x.com', status: 'unsubscribed', merge_fields: {} },
      ]),
    )
    const out = await fetchSubscribedMembers(CFG, { fetcher })
    expect(out.map((m) => m.email)).toEqual(['ok@x.com'])
  })

  it('没邮箱的成员跳过', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(page([{ status: 'subscribed', merge_fields: {} }]))
    expect(await fetchSubscribedMembers(CFG, { fetcher })).toEqual([])
  })

  it('分页：满页继续拉，不满页停', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({
      email_address: `u${i}@x.com`,
      status: 'subscribed',
      merge_fields: {},
    }))
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(page(full))
      .mockResolvedValueOnce(page([{ email_address: 'last@x.com', status: 'subscribed', merge_fields: {} }]))
    const out = await fetchSubscribedMembers(CFG, { fetcher })
    expect(out).toHaveLength(1001)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toContain('offset=1000')
  })

  it('缺电话/姓名合并字段 → null，不崩', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      page([{ email_address: 'x@x.com', status: 'subscribed' }]),
    )
    const out = await fetchSubscribedMembers(CFG, { fetcher })
    expect(out[0]).toMatchObject({ email: 'x@x.com', phone: null, firstName: null, lastName: null })
  })

  it('Mailchimp 报错 → 抛出带状态码，不静默给半份', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ title: 'API Key Invalid' }),
    } as unknown as Response)
    await expect(fetchSubscribedMembers(CFG, { fetcher })).rejects.toThrow(/401/)
  })
})
