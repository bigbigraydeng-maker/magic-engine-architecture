/**
 * 「客人来信没人回」汇总信这条 cron 路由。
 *
 * 钉的都是「错了会真的伤到人」的四件事，不是 JSON 形状：
 *
 *   1. **同一天不许发第二遍**。这条路由每调一次就发一封新信，运维照着 Render 上
 *      一次显示失败的运行重跑，销售就会同一个早上收到两封一样的「客人在等回复」。
 *   2. **查挂了必须把运行记录收尾**。抛出去的话 `startCronRun` 插的那行永远停在
 *      「在跑」，健康检查分不清「崩了」和「还在跑」——这条通道静默死掉没人知道。
 *   3. **邮箱没同步上的那天不许记成健康**。今天信压根没进来 → 名单是零条 →
 *      在监控上跟平安无事的一天长得一模一样。
 *   4. **压掉的条数要跟着信一起出去**，不是只写日志。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  /** 假的 cron_run_logs 行，`alreadySent` 读的就是它。 */
  cronRows: [] as Array<{ summary: { sent?: number } | null }>,
  finish: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const api: Record<string, unknown> = {}
      const chain = () => api
      api.select = chain
      api.eq = chain
      api.gte = chain
      api.order = chain
      api.limit = () => Promise.resolve({ data: h.cronRows, error: null })
      return api
    },
  },
}))

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRun: vi.fn(async () => ({ finish: h.finish })),
}))

vi.mock('@/lib/pm-todo/client-roster', () => ({
  loadActiveClients: vi.fn(),
}))

vi.mock('@/lib/crm/email-reply-due', () => ({
  findEmailRepliesDue: vi.fn(),
}))

vi.mock('@/lib/crm/email-reply-digest', () => ({
  sendEmailReplyDigest: vi.fn(),
}))

vi.mock('@/lib/crm/mailbox-run', () => ({
  loadMailboxRun: vi.fn(),
}))

import { GET } from '../route'
import { loadActiveClients } from '@/lib/pm-todo/client-roster'
import { findEmailRepliesDue } from '@/lib/crm/email-reply-due'
import { sendEmailReplyDigest } from '@/lib/crm/email-reply-digest'
import { loadMailboxRun } from '@/lib/crm/mailbox-run'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'

const mockClients = vi.mocked(loadActiveClients)
const mockDue = vi.mocked(findEmailRepliesDue)
const mockSend = vi.mocked(sendEmailReplyDigest)
const mockMailbox = vi.mocked(loadMailboxRun)

function req(auth = 'Bearer test-secret'): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/email-reply-digest', {
    method: 'GET',
    headers: { authorization: auth },
  })
}

function dueItem() {
  return {
    clientId: CLIENT,
    contactId: 'p1',
    conversationId: 'conv-1',
    displayName: '王女士',
    subject: '想问 12 月的团',
    lastMessageAt: '2026-09-02T03:00:00Z',
    waitingHours: 30,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  // 发信总闸默认关（2026-09-03 起）。下面这批测试钉的是「闸开着时的行为」，
  // 所以显式打开；「闸关着」本身另有一组测试，见文件末尾。
  process.env.EMAIL_REPLY_DIGEST_ENABLED = 'true'
  h.cronRows.length = 0
  mockClients.mockResolvedValue({
    clients: new Map([[CLIENT, { id: CLIENT, name: 'CTS Tours NZ', domain: 'ctstours.co.nz' }]]),
    error: null,
  })
  mockDue.mockResolvedValue({ items: [dueItem()], dropped: 0, droppedByClient: {} })
  mockSend.mockResolvedValue({ sent: true, recipients: ['me@magicengine.cloud'] })
  mockMailbox.mockResolvedValue({ kind: 'ok', mailbox: { mailboxes: 1, error: null, results: [] } })
})

describe('鉴权', () => {
  it('密钥不对 → 401，一封信都不发', async () => {
    const res = await GET(req('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('🔴 同一天不许发第二遍', () => {
  it('上一趟已经发出去过信 → 直接跳过，连运行记录都不多插一行', async () => {
    h.cronRows.push({ summary: { sent: 1 } })

    const res = await GET(req())
    const body = await res.json()

    expect(body.skipped).toBeTruthy()
    expect(mockSend).not.toHaveBeenCalled()
    expect(h.finish).not.toHaveBeenCalled()
  })

  it('上一趟一封都没发成 → 允许重跑（这才是该重跑的那种失败）', async () => {
    h.cronRows.push({ summary: { sent: 0 } })

    await GET(req())
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('发出去之后，运行记录里留下 sent —— 幂等闸读的就是它', async () => {
    await GET(req())
    const summary = h.finish.mock.calls[0][0].summary as { sent: number }
    expect(summary.sent).toBe(1)
  })
})

describe('🔴 查挂了也得把运行记录收尾', () => {
  it('findEmailRepliesDue 抛异常 → finish 写 failed + 原因，不留一行永远「在跑」', async () => {
    mockDue.mockRejectedValue(new Error('查询串太长'))

    const res = await GET(req())

    expect(res.status).toBe(500)
    expect(h.finish).toHaveBeenCalledTimes(1)
    expect(h.finish.mock.calls[0][0]).toMatchObject({ failed: 1 })
    expect(String(h.finish.mock.calls[0][0].error)).toContain('查询串太长')
  })
})

describe('🔴 邮箱没同步上的那天不许记成健康', () => {
  it('整趟同步失败 → 运行记录带 error，信里也自报名单不完整', async () => {
    mockMailbox.mockResolvedValue({
      kind: 'ok',
      mailbox: { mailboxes: 1, error: '令牌过期', results: [] },
    })

    await GET(req())

    expect(mockSend.mock.calls[0][2]).toMatchObject({ syncStale: true })
    const finished = h.finish.mock.calls[0][0]
    expect(finished.failed).toBeGreaterThan(0)
    expect(String(finished.error)).toContain('令牌过期')
  })

  it('只有这一个客户的邮箱没读全 → 只有他那封信自报，整趟不算失败', async () => {
    mockMailbox.mockResolvedValue({
      kind: 'ok',
      mailbox: {
        mailboxes: 2,
        error: null,
        results: [{ clientId: CLIENT, mailbox: 'info@ctstours.co.nz', error: '401 授权失效' }],
      },
    })

    await GET(req())

    expect(mockSend.mock.calls[0][2]).toMatchObject({ syncStale: true })
    expect(h.finish.mock.calls[0][0].error).toBeUndefined()
  })

  it('同步卡死了 → 同样算整趟不可信', async () => {
    mockMailbox.mockResolvedValue({
      kind: 'stuck',
      startedAt: '2026-09-03T00:00:00Z',
      hours: 6,
    })

    await GET(req())
    expect(String(h.finish.mock.calls[0][0].error)).toContain('卡住')
  })

  it('同步正常 → 不吓唬人，也不把好日子记成失败', async () => {
    await GET(req())
    expect(mockSend.mock.calls[0][2]).toMatchObject({ syncStale: false })
    expect(h.finish.mock.calls[0][0].error).toBeUndefined()
  })
})

describe('🔴 压掉的条数跟着信一起出去', () => {
  it('这个客户被压掉几条就传几条，不留在日志里', async () => {
    mockDue.mockResolvedValue({
      items: [dueItem()],
      dropped: 4,
      droppedByClient: { [CLIENT]: 4 },
    })

    await GET(req())
    expect(mockSend.mock.calls[0][2]).toMatchObject({ dropped: 4 })
  })
})

/**
 * 发信总闸（2026-09-03 PM 拍板暂停后加的）。
 *
 * 钉的是**失败方向**：这条通道漏配环境变量时必须沉默，不能开着发。
 * 名单里噪音占七成的那个问题修好之前，任何一条路径都不许把信发出去 ——
 * 包括有人拿着正确密钥手动 curl 的情况。
 */
describe('🔴 发信总闸默认关', () => {
  it('没配这个变量 → 一封不发，连运行记录都不插', async () => {
    delete process.env.EMAIL_REPLY_DIGEST_ENABLED

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(mockSend).not.toHaveBeenCalled()
    // 在 startCronRun 之前就返回了 —— 停用期间不该每天多攒一行运行记录
    expect(h.finish).not.toHaveBeenCalled()
  })

  it('配成 false → 一封不发', async () => {
    process.env.EMAIL_REPLY_DIGEST_ENABLED = 'false'

    await GET(req())

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('配成 true 以外的任何值都不发 —— 拼错了也要安全', async () => {
    for (const v of ['TRUE', '1', 'yes', 'ture', '']) {
      vi.clearAllMocks()
      process.env.EMAIL_REPLY_DIGEST_ENABLED = v

      await GET(req())

      expect(mockSend, `值 "${v}" 不该放行`).not.toHaveBeenCalled()
    }
  })

  it('闸关着也不放过没鉴权的请求 —— 401 优先于 200 skipped', async () => {
    delete process.env.EMAIL_REPLY_DIGEST_ENABLED

    const res = await GET(req('Bearer wrong'))

    expect(res.status).toBe(401)
  })
})
