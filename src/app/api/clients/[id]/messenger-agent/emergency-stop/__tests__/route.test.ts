/**
 * 门户「紧急全渠道停」路由测试（issue #1589）。
 *
 * 这条路由本身不重新实现开关逻辑——真正的读写在
 * `stopAiRepliesForClient()`（已有独立单测覆盖 kill-switch.test.ts）。
 * 这里只测路由自己的职责：只有内部员工能按、必须带二次确认短语、
 * 把底层结果原样透传给前端。
 */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/knowledge/admin-client', () => ({ knowledgeWriteClient: vi.fn(() => ({})) }))
vi.mock('@/lib/knowledge/kill-switch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/knowledge/kill-switch')>('@/lib/knowledge/kill-switch')
  return { ...actual, stopAiRepliesForClient: vi.fn() }
})

import { POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { stopAiRepliesForClient, KnowledgeKillSwitchError } from '@/lib/knowledge/kill-switch'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockStop = vi.mocked(stopAiRepliesForClient)

const CTS = 'c0000000-0000-0000-0000-000000000000'

function req(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/messenger-agent/emergency-stop`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function params() {
  return { params: { id: CTS } }
}

function allowAdmin(email = 'ray@magicengine.com.au') {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email } as never,
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  })
}

describe('POST /api/clients/[id]/messenger-agent/emergency-stop', () => {
  it('未登录 / 无权限 → 原样透传 requireDashboardClientAccess 的拒绝', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized', reason: 'unauthorized' })
    const res = await POST(req({ confirm: 'STOP-ALL' }), params())
    expect(res.status).toBe(401)
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('客户身份（非内部员工）→ 403，不许碰这个开关', async () => {
    mockAccess.mockResolvedValue({
      ok: true,
      user: { email: 'bdm@ctstours.co.nz' } as never,
      role: 'client-viewer',
      tier: 'paid_client',
      allowedClientId: CTS,
    })
    const res = await POST(req({ confirm: 'STOP-ALL' }), params())
    expect(res.status).toBe(403)
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('缺少二次确认短语 → 400，不调用底层开关', async () => {
    allowAdmin()
    const res = await POST(req({}), params())
    expect(res.status).toBe(400)
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('确认短语打错 → 400，不调用底层开关', async () => {
    allowAdmin()
    const res = await POST(req({ confirm: 'stop-all' }), params())
    expect(res.status).toBe(400)
    expect(mockStop).not.toHaveBeenCalled()
  })

  it('通过校验 → 调用 stopAiRepliesForClient，actorEmail 用登录员工邮箱', async () => {
    allowAdmin('ray@magicengine.com.au')
    mockStop.mockResolvedValue({ stopped: true, auditWarning: null })
    const res = await POST(req({ confirm: 'STOP-ALL', reason: '客户投诉' }), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, stopped: true, auditWarning: null })
    expect(mockStop).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clientId: CTS, actorEmail: 'ray@magicengine.com.au', reason: '客户投诉', source: 'portal_emergency_stop' }),
    )
  })

  it('开关翻了但审计写入失败 → 仍报成功，把警告原样带回前端', async () => {
    allowAdmin()
    mockStop.mockResolvedValue({ stopped: true, auditWarning: '审计表写入失败' })
    const res = await POST(req({ confirm: 'STOP-ALL' }), params())
    const body = await res.json()
    expect(body).toMatchObject({ success: true, stopped: true, auditWarning: '审计表写入失败' })
  })

  it('底层开关抛错 → 500，把 KnowledgeKillSwitchError 的消息带回前端', async () => {
    allowAdmin()
    mockStop.mockRejectedValue(new KnowledgeKillSwitchError('没有找到这个客户，AI 回复开关没有被改动。'))
    const res = await POST(req({ confirm: 'STOP-ALL' }), params())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('没有找到这个客户')
  })
})
