/**
 * 内部版日报：内容用真实回放诊断（CTS 官方账户 2026-09-13、NAL 2026-09-13）生成，不自编诊断形状。
 * 🔴 只发内部：客户邮箱一律丢弃。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ctsSettings from '../../__tests__/fixtures/cts-settings.json'
import nalSettings from '../../__tests__/fixtures/nal-settings.json'
import nalDailyRaw from '../../__tests__/fixtures/nal-daily-adset-2026-08-17_2026-09-13.json'
import nalActivities from './fixtures/nal-activities-budget-create.json'
import ctsDailyRaw from './fixtures/cts-official-daily-adset-2026-09-07_2026-09-14.json'
import ctsHourlyRaw from './fixtures/cts-official-hourly-adset.json'
import ctsActivities from './fixtures/cts-official-activities-budget-create.json'
import { accountInput, dailyRowsFromGraph, hourlyFromGraph, replaySnapshots, settingsFixture, type ActivityRow } from './replay'
import { runDiagnostics } from '../run'
import type { DailyRow, DiagnosisRun } from '../types'
import type { GraphHourlySpendRow } from '@/lib/meta/entity-settings'

const sent: Array<{ to: string[]; subject: string; html: string }> = []
vi.mock('resend', () => ({
  Resend: class { emails = { send: async (m: { to: string[]; subject: string; html: string }) => { sent.push(m); return { error: null } } } },
}))

type Row = Record<string, unknown>
const narratives: Row[] = []
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const filters: Array<[string, unknown, 'eq' | 'lt']> = []
      const match = () => narratives.filter(r => filters.every(([k, v, op]) => (op === 'eq' ? r[k] === v : String(r[k]) < String(v))))
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v, 'eq']); return b },
        lt: (k: string, v: unknown) => { filters.push([k, v, 'lt']); return b },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: match().sort((a, z) => String(z.insight_date).localeCompare(String(a.insight_date)))[0] ?? null, error: null }),
        update: (patch: Row) => ({ eq: (k1: string, v1: unknown) => ({ eq: async (k2: string, v2: unknown) => {
          for (const r of narratives) if (r[k1] === v1 && r[k2] === v2) Object.assign(r, patch)
          return { error: null }
        } }) }),
      }
      return b
    },
  },
}))

import { buildInternalDigest, decideInternalSend, isInternalRecipient, persistAndSendInternalDigest, resolveInternalRecipients } from '../../internal-digest'

let ctsRun: DiagnosisRun
let nalRun: DiagnosisRun
beforeAll(async () => {
  const ctsDaily: DailyRow[] = await dailyRowsFromGraph(ctsDailyRaw)
  const nalDaily: DailyRow[] = await dailyRowsFromGraph(nalDailyRaw)
  const CTS = settingsFixture(ctsSettings)
  const NAL = settingsFixture(nalSettings)
  ctsRun = runDiagnostics({
    clientId: 'cts', date: '2026-09-13', evaluatedAt: '2026-09-14T03:00:00Z',
    outcome: { leading: 'lead', primary: 'lead', targetCostPerPrimary: 40, minPrimaryPerUnit: 5 }, outcomeConfigured: true,
    messagingReferralAvailable: false, digestRecipients: [],
    accounts: [accountInput({ fixture: CTS, snapshots: replaySnapshots({ fixture: CTS, clientId: 'cts', asOfIso: '2026-09-13T11:59:59Z', date: '2026-09-13', daily: ctsDaily, activities: ctsActivities as ActivityRow[] }), daily: ctsDaily, hourly: hourlyFromGraph((ctsHourlyRaw as { days: Record<string, GraphHourlySpendRow[]> }).days), lastInsightDate: '2026-09-13' })],
  })
  nalRun = runDiagnostics({
    clientId: 'nal', date: '2026-09-13', evaluatedAt: '2026-09-13T09:00:00Z',
    outcome: { leading: 'messaging_started', primary: 'qualified_enquiry', targetCostPerPrimary: null, minPrimaryPerUnit: 5 }, outcomeConfigured: true,
    messagingReferralAvailable: false, digestRecipients: [],
    accounts: [accountInput({ fixture: NAL, snapshots: replaySnapshots({ fixture: NAL, clientId: 'nal', asOfIso: '2026-09-13T09:00:00Z', date: '2026-09-13', daily: nalDaily, activities: nalActivities as ActivityRow[] }), daily: nalDaily, lastInsightDate: '2026-09-13' })],
  })
})

beforeEach(() => { sent.length = 0; narratives.length = 0; process.env.RESEND_API_KEY = 'test' })

describe('收件人只留内部', () => {
  it('内部域名放行，客户域名丢弃', () => {
    expect(isInternalRecipient('hello@magicengine.cloud')).toBe(true)
    expect(isInternalRecipient('ops@magiclab.com')).toBe(true)
    expect(isInternalRecipient('owner@nalexpress.com')).toBe(false)
    expect(isInternalRecipient('someone@gmail.com')).toBe(false)
  })

  it('全是客户邮箱 → 发内部默认收件箱，并记下丢了几个', () => {
    const r = resolveInternalRecipients(['owner@nalexpress.com', 'boss@ctstours.co.nz'])
    expect(r.dropped).toBe(2)
    expect(r.to.every(isInternalRecipient)).toBe(true)
  })
})

describe('发不发（防疲劳）', () => {
  it('有命中发；昨天有今天没有发「恢复」；周一发周报；其余不发', () => {
    expect(decideInternalSend(1, 0, false)).toBe('alert')
    expect(decideInternalSend(0, 2, false)).toBe('recovery')
    expect(decideInternalSend(0, 0, true)).toBe('weekly')
    expect(decideInternalSend(0, null, false)).toBe('skip')
  })
})

describe('日报内容（真实回放诊断）', () => {
  it('CTS 9/13：一句结论 + 账户层面「投放卡住」+ 样本量；明说只读、仅限内部', () => {
    const { subject, html } = buildInternalDigest({ clientName: 'CTS Tours NZ', date: '2026-09-13', run: ctsRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(subject).toContain('内部')
    expect(html).toContain('发现 1 件要看的事')
    expect(html).toContain('账户层面')
    expect(html).toContain('投放卡住')
    expect(html).toContain('样本：')
    expect(html).toContain('只读诊断，没有改任何广告和预算')
  })

  it('NAL 9/13：命中按角色分组（破冰下面是攒了人没收割），D8 也在', () => {
    const { html } = buildInternalDigest({ clientName: 'New Asian Logistics', date: '2026-09-13', run: nalRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    const awarenessAt = html.indexOf('破冰（让没见过的人看到）')
    expect(awarenessAt).toBeGreaterThan(-1)
    expect(html.indexOf('攒了人没收割')).toBeGreaterThan(awarenessAt)
    expect(html).toContain('结果真相断层')
  })

  it('不出现任何挪预算 / 改广告的操作指令', () => {
    const { html } = buildInternalDigest({ clientName: 'New Asian Logistics', date: '2026-09-13', run: nalRun, decision: 'alert', legacyNeedsAction: [], droppedRecipients: 0 })
    expect(html).not.toMatch(/挪预算|加预算|减预算|暂停这/)
  })
})

describe('发送与回执', () => {
  it('🔴 配置里只有客户邮箱：邮件只发到内部收件箱，诊断并进当天体检记录，标 sent', async () => {
    narratives.push({ client_id: 'cts', insight_date: '2026-09-13', payload: { overall_verdict: 'healthy', campaigns: [] }, email_status: null })
    const r = await persistAndSendInternalDigest({ clientId: 'cts', clientName: 'CTS Tours NZ', date: '2026-09-13', run: ctsRun, configuredRecipients: ['boss@ctstours.co.nz'] })
    expect(r).toMatchObject({ decision: 'alert', sent: true, recipients_dropped: 1, persisted: true })
    expect(sent).toHaveLength(1)
    expect(sent[0].to.every(isInternalRecipient)).toBe(true)
    expect(sent[0].to).not.toContain('boss@ctstours.co.nz')
    const stored = narratives[0].payload as { portfolio_diagnoses: { hit_count: number } }
    expect(stored.portfolio_diagnoses.hit_count).toBe(1)
    expect(narratives[0].email_status).toBe('sent')
  })

  it('同一天已经发过 → 不重发', async () => {
    narratives.push({ client_id: 'cts', insight_date: '2026-09-13', payload: { campaigns: [] }, email_status: 'sent' })
    const r = await persistAndSendInternalDigest({ clientId: 'cts', clientName: 'CTS', date: '2026-09-13', run: ctsRun, configuredRecipients: [] })
    expect(r.sent).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
