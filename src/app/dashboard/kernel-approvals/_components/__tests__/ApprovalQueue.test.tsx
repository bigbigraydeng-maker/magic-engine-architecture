/**
 * ApprovalQueue —— 待审批队列列表侧。
 *
 * 这组测试盯的是**一个特定的说谎方式**：把「内核没启用」「出错了」「真的没活儿」
 * 三件事都渲染成同一个空列表。三者混淆的后果不一样：
 *   - 没启用被画成「都处理完了」→ 没人知道这条线根本没通
 *   - 出错被画成「都处理完了」→ 有动作在等审批，但界面说没有，它永远等下去
 * 所以断言不能只查「列表是空的」，必须查**每种情况各自那句话在、且另外两句不在**。
 *
 * 同理 skippedRunIds / hasMore：服务端专门如实回传，界面藏起来就等于白传。
 */
import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ApprovalQueue from '../ApprovalQueue'

const CLIENTS = [{ id: '11111111-1111-4111-8111-111111111111', name: '测试客户' }]

const EMPTY_OK = { items: [], skippedRunIds: [], hasMore: false, nextCursor: null }

function mockFetch(payload: unknown, opts: { ok?: boolean; status?: number } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => payload,
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('ApprovalQueue —— 三种「没东西看」必须互相区分', () => {
  it('内核没启用时说「还没启用」，不说「都处理完了」', async () => {
    mockFetch(
      { code: 'kernel_not_provisioned', error: '内核审批还没在这个环境启用' },
      { ok: false, status: 503 },
    )
    render(<ApprovalQueue clients={CLIENTS} />)

    await waitFor(() => expect(screen.getByText('内核还没在这个环境启用')).toBeTruthy())
    // 服务端原话也要照登，不能只报一个笼统的「未启用」
    expect(screen.getByText(/服务端原话：内核审批还没在这个环境启用/)).toBeTruthy()
    expect(screen.queryByText(/都处理完了/)).toBeNull()
    expect(screen.queryByText(/读不出来/)).toBeNull()
  })

  it('真的没有待审批时说「都处理完了」，不说「还没启用」', async () => {
    mockFetch(EMPTY_OK)
    render(<ApprovalQueue clients={CLIENTS} />)

    await waitFor(() => expect(screen.getByText(/都处理完了/)).toBeTruthy())
    expect(screen.queryByText('内核还没在这个环境启用')).toBeNull()
    expect(screen.queryByText(/读不出来/)).toBeNull()
  })

  it('出错时把错误摆出来，不伪装成空列表', async () => {
    mockFetch({ code: 'internal_error', error: '审批接口出错了' }, { ok: false, status: 500 })
    render(<ApprovalQueue clients={CLIENTS} />)

    await waitFor(() => expect(screen.getByText(/读不出来/)).toBeTruthy())
    expect(screen.getByText(/审批接口出错了/)).toBeTruthy()
    expect(screen.queryByText(/都处理完了/)).toBeNull()
    expect(screen.queryByText(/还没在这个环境启用/)).toBeNull()
  })
})

describe('ApprovalQueue —— 服务端如实回传的东西不许藏', () => {
  it('读不出来的那几条要显示条数和编号，不能悄悄少给', async () => {
    mockFetch({ ...EMPTY_OK, skippedRunIds: ['run-a', 'run-b'] })
    render(<ApprovalQueue clients={CLIENTS} />)

    await waitFor(() => expect(screen.getByText(/有 2 条读不出来/)).toBeTruthy())
    expect(screen.getByText(/run-a、run-b/)).toBeTruthy()
  })

  it('还有下一页时要显示出来，不能静默截断', async () => {
    mockFetch({
      items: [
        {
          runId: 'run-1',
          clientId: CLIENTS[0].id,
          expectedDecisionId: 'dec-1',
          actionKey: 'seo.publish_page',
          actionVersion: 1,
          title: '发一篇页面',
          risk: 'medium',
          sideEffect: 'outward_write',
          costEstimateUsd: 2,
          costCapUsd: 5,
          rationale: '目标缺一篇落地页',
          requestedAt: '2026-08-16T00:00:00.000Z',
        },
      ],
      skippedRunIds: [],
      hasMore: true,
      nextCursor: 'cursor-2',
    })
    render(<ApprovalQueue clients={CLIENTS} />)

    await waitFor(() => expect(screen.getByText('发一篇页面')).toBeTruthy())
    expect(screen.getByText(/还有更多/)).toBeTruthy()
    expect(screen.getByText(/预计 US\$2、上限 US\$5/)).toBeTruthy()
  })
})
