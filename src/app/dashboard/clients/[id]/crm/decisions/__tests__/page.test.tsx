/**
 * 今日决策清单（只读）—— CI-WP01（Issue #1009）。
 *
 * 钉住 Build Control 合同里明写的几条：
 *   · 正确 tenant 下能看到 tenant-scoped 的清单，每行有身份 / why now / 建议下一步
 *   · 空、加载中、失败三种状态各自诚实显示，失败不能装成「今天没人需要关注」
 *   · 已处理 / 别再联系的人不会被错误地当成还要关注（即使上游数据带了进来）
 *   · 页面上没有任何写操作入口（打电话 / 发信 / 改状态的按钮）
 */
import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import CrmDecisionsPage from '../page'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cts' }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

const bucket = (people: unknown[]) => ({ layer: 'waiting', label: '客人在等你', people })

const person = (over: Record<string, unknown> = {}) => ({
  contactId: 'c1',
  name: 'Susan',
  phone: '021123456',
  email: 'susan@example.com',
  reason: '客户来消息了，已经等了 3 小时',
  suggestedChannel: 'phone',
  ...over,
})

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, json: async () => body })),
  )
}

describe('正常 tenant：显示身份 / why now / 建议下一步', () => {
  it('每一行都带上原因和建议动作，没有任何可点的写操作按钮', async () => {
    stubFetch(200, {
      buckets: [bucket([person()])],
      totalContacts: 1,
      generatedAt: '2026-08-29T00:00:00.000Z',
    })
    render(<CrmDecisionsPage />)

    await waitFor(() => expect(screen.getByText('Susan')).toBeTruthy())
    expect(screen.getByText('客户来消息了，已经等了 3 小时')).toBeTruthy()
    expect(screen.getByText('→ 建议致电')).toBeTruthy()

    // 只读：页面上除了失败时的「重试」以外，不该有任何 <button>，
    // 也不该有 tel:/mailto: 这类能触发联系动作的可点击链接。
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelector('a[href^="tel:"]')).toBeNull()
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull()
  })
})

describe('诚实的空 / 加载中 / 失败状态', () => {
  it('清单为空但客户有数据 —— 说清是"都处理完了"，不是压根没数据', async () => {
    stubFetch(200, { buckets: [], totalContacts: 42, generatedAt: '2026-08-29T00:00:00.000Z' })
    render(<CrmDecisionsPage />)
    await waitFor(() => expect(screen.getByText(/该处理的都处理了/)).toBeTruthy())
  })

  it('客户压根没有数据 —— 跟"都处理完了"说不同的话', async () => {
    stubFetch(200, { buckets: [], totalContacts: 0, generatedAt: '2026-08-29T00:00:00.000Z' })
    render(<CrmDecisionsPage />)
    await waitFor(() => expect(screen.getByText('这个客户还没有任何客人数据')).toBeTruthy())
  })

  it('接口失败（如跨租户被拒）时明说失败，绝不装成"今天没人需要关注"', async () => {
    stubFetch(403, { error: 'Forbidden' })
    render(<CrmDecisionsPage />)

    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy())
    // 失败态不能同时渲染"都处理完了"这类成功文案。
    expect(screen.queryByText(/该处理的都处理了/)).toBeNull()
    expect(screen.queryByText(/今天有.*位客人需要关注/)).toBeNull()
  })

  it('网络异常时同样明说失败并给出重试入口', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    render(<CrmDecisionsPage />)

    await waitFor(() => expect(screen.getByText('加载失败，检查网络后再试。')).toBeTruthy())
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })
})

describe('已处理 / 别再联系的人不能被错误提升为需要关注', () => {
  it('doneToday=true 的人不出现在清单上', async () => {
    stubFetch(200, {
      buckets: [bucket([person({ contactId: 'done1', name: 'Handled Today', doneToday: true })])],
      totalContacts: 1,
      generatedAt: '2026-08-29T00:00:00.000Z',
    })
    render(<CrmDecisionsPage />)

    await waitFor(() => expect(screen.getByText(/该处理的都处理了/)).toBeTruthy())
    expect(screen.queryByText('Handled Today')).toBeNull()
  })

  it('doNotContact=true 的人即使被上游意外带进桶里也不出现', async () => {
    stubFetch(200, {
      buckets: [bucket([person({ contactId: 'dnc1', name: 'Do Not Contact Me', doNotContact: true })])],
      totalContacts: 1,
      generatedAt: '2026-08-29T00:00:00.000Z',
    })
    render(<CrmDecisionsPage />)

    await waitFor(() => expect(screen.getByText(/该处理的都处理了/)).toBeTruthy())
    expect(screen.queryByText('Do Not Contact Me')).toBeNull()
  })
})
