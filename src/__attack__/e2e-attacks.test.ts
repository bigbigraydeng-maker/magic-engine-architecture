/* 狄仁杰 attack suite — end-to-end: failed rebind → stop-loss / execute with B's campaign (temporary) */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import type { FakeDb, Row } from '@/lib/meta/__tests__/binding-fake-db'
import { A, ACC_B, FDE, ID, seed, snapshot, setEnv } from './harness'

const h = vi.hoisted(() => ({
  db: {} as FakeDb,
  email: null as string | null,
  writes: [] as string[],
}))

vi.mock('@/lib/supabase', async () => {
  const { makeBindingFakeDb } = await import('@/lib/meta/__tests__/binding-fake-db')
  return { supabaseAdmin: { from: (t: string) => makeBindingFakeDb(h.db).from(t) } }
})
vi.mock('@supabase/supabase-js', async () => {
  const { makeBindingFakeDb } = await import('@/lib/meta/__tests__/binding-fake-db')
  return { createClient: () => ({ from: (t: string) => makeBindingFakeDb(h.db).from(t) }) }
})
vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email ? { ok: true, user: { id: 'u', email: h.email } } : { ok: false, status: 401, error: 'Unauthorized' },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// Real Meta write helpers, wrapped so every write attempt is recorded (they still hit the fetch stub).
vi.mock('@/lib/meta/client', async orig => {
  const real = await orig<typeof import('@/lib/meta/client')>()
  return {
    ...real,
    setCampaignStatus: (id: string, t: string, s: 'ACTIVE' | 'PAUSED') => { h.writes.push(`setCampaignStatus(${id})`); return real.setCampaignStatus(id, t, s) },
    setCampaignDailyBudget: (id: string, t: string, c: number) => { h.writes.push(`setCampaignDailyBudget(${id})`); return real.setCampaignDailyBudget(id, t, c) },
  }
})
vi.mock('@/lib/meta/adsets', async orig => {
  const real = await orig<typeof import('@/lib/meta/adsets')>()
  return {
    ...real,
    setAdSetDailyBudget: (...a: Parameters<typeof real.setAdSetDailyBudget>) => { h.writes.push(`setAdSetDailyBudget(${a[0]})`); return real.setAdSetDailyBudget(...a) },
    setAdSetStatus: (...a: Parameters<typeof real.setAdSetStatus>) => { h.writes.push(`setAdSetStatus(${a[0]})`); return real.setAdSetStatus(...a) },
  }
})

import { PATCH } from '@/app/api/clients/[id]/meta-ad-account/route'
import { POST as STOP_LOSS } from '@/app/api/clients/[id]/ad-health/stop-loss/route'
import { POST as EXECUTE } from '@/app/api/clients/[id]/meta-ads/execute/route'

/** Graph emulation: campaigns camp_a (A's account) / camp_b (B's account), ad accounts, adsets; logs POSTs. */
const posts: string[] = []
const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  const segs = url.pathname.split('/').filter(Boolean)
  const node = segs[1] ?? ''
  const edge = segs[2]
  if ((init?.method ?? 'GET').toUpperCase() !== 'GET') {
    posts.push(url.pathname + url.search)
    return Response.json({ success: true })
  }
  const fields = url.searchParams.get('fields')
  if (node === '' && url.searchParams.get('ids')) return Response.json({ camp_b: { id: 'camp_b', account_id: '2222222222' } })
  const campaigns: Record<string, Row> = {
    camp_a: { id: 'camp_a', name: 'A', status: 'ACTIVE', daily_budget: '10000', objective: 'OUTCOME_LEADS', account_id: '1111111111' },
    camp_b: { id: 'camp_b', name: 'B', status: 'ACTIVE', daily_budget: '10000', objective: 'OUTCOME_LEADS', account_id: '2222222222' },
  }
  if (campaigns[node]) {
    if (edge === 'adsets') return Response.json({ data: [] })
    if (!fields) return Response.json({ id: node, name: campaigns[node].name }) // Graph default fields
    return Response.json(campaigns[node])
  }
  if (/^act_\d+$/.test(node)) {
    const digits = node.slice(4)
    if (edge) return Response.json({ data: [] })
    if (!fields) return Response.json({ id: node, account_id: digits }) // AdAccount default fields
    if (fields.startsWith('business')) return new Response('{}', { status: 403 })
    if (/status,daily_budget|objective/.test(fields))
      return new Response('{"error":{"code":100,"message":"nonexisting field"}}', { status: 400 })
    return Response.json({ id: node, account_id: digits, name: `acct ${digits}`, account_status: 1 })
  }
  return new Response('{"error":{"code":100}}', { status: 400 })
})

const log: string[] = []
beforeEach(() => {
  h.db = seed()
  posts.length = 0
  h.writes.length = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  setEnv()
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => { console.log('\n=== E2E ATTACK LOG ===\n' + log.join('\n')) })

function req(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/clients/${A}/${path}`, { method: 'POST', body: JSON.stringify(body) })
}
async function call(fn: () => Promise<Response>) {
  try { const r = await fn(); let j: Record<string, unknown> = {}; try { j = await r.json() } catch { /* */ } return { status: r.status, body: j } }
  catch (e) { return { status: 'THREW', body: { error: String(e) } } }
}
const patchA = (b: unknown) =>
  call(() => PATCH(new NextRequest(`http://localhost/api/clients/${A}/meta-ad-account`, { method: 'PATCH', body: JSON.stringify(b) }), { params: Promise.resolve({ id: A }) }))

const ATTACKERS: Array<[string, string | null]> = [
  ['client', ID.client], ['dashboard', ID.dashboard], ['both', ID.both], ['fde-row', ID.fde],
  ['self_serve', ID.self_serve], ['scoped_admin(DB)', ID.scoped_admin], ['DEMO_ADMINS', ID.demo],
  ['CLIENT_VIEWERS', ID.viewer], ['outsider', ID.outsider], ['unauthenticated', null],
]
const ACTIONS: Array<[string, string, (cid: unknown) => unknown]> = [
  ['stop-loss pause', 'ad-health/stop-loss', cid => ({ campaign_id: cid, action: 'pause' })],
  ['stop-loss cut', 'ad-health/stop-loss', cid => ({ campaign_id: cid, action: 'cut' })],
  ['execute pause', 'meta-ads/execute', cid => ({ action_type: 'ads.pause_campaign', campaign_id: cid })],
  ['execute adjust_bid', 'meta-ads/execute', cid => ({ action_type: 'ads.adjust_bid', campaign_id: cid, params: { new_daily_budget: 110 } })],
  ['execute reactivate', 'meta-ads/execute', cid => ({ action_type: 'ads.reactivate_campaign', campaign_id: cid })],
]
const run = (path: string, body: unknown) =>
  path === 'ad-health/stop-loss'
    ? call(() => STOP_LOSS(req(path, body), { params: { id: A } }))
    : call(() => EXECUTE(req(path, body), { params: { id: A } }))

describe('攻击4：改绑失败后拿 B 的 campaign 打 stop-loss / execute', () => {
  for (const [who, email] of ATTACKERS) {
    for (const [label, path, mk] of ACTIONS) {
      it(`${who} | ${label} | camp_b`, async () => {
        h.email = email
        const rebinds = []
        for (const b of [
          { ad_account_id: ACC_B },
          { ad_account_id: ACC_B, allow_shared_account: true, override_reason: '共用账户共用账户共用账户' },
          { ad_account_id: 'ACT_2222222222', preview: true },
        ]) rebinds.push((await patchA(b)).status)
        const r = await run(path, mk('camp_b'))
        log.push(`[4] ${who.padEnd(18)} | ${label.padEnd(20)} rebind=${JSON.stringify(rebinds)} → ${r.status} writes=${JSON.stringify(h.writes)} posts=${JSON.stringify(posts)} flywheel=${(h.db.flywheel_actions as Row[]).length}`)
        expect(rebinds.every(s => s !== 200)).toBe(true)
        expect([401, 403]).toContain(r.status)
        expect(h.writes).toEqual([])
        expect(posts).toEqual([])
        expect(h.db.flywheel_actions).toHaveLength(0)
      })
    }
  }

  // Crafted campaign_id strings: can the ownership READ resolve to A's node while the WRITE hits B's?
  const CRAFTED: unknown[] = [
    'camp_b?x=', 'camp_b#', 'camp_b/', ' camp_b', 'camp_b/../act_1111111111', 'act_1111111111/../camp_b',
    'act_1111111111?x=', 'act_1111111111%2F..%2Fcamp_b', '?ids=camp_b&x=', ['camp_b'], 'camp_a/../camp_b', 'camp_a?x=/../../camp_b',
  ]
  for (const cid of CRAFTED) {
    for (const [label, path, mk] of ACTIONS) {
      it(`client | ${label} | crafted ${JSON.stringify(cid)}`, async () => {
        h.email = ID.client
        const r = await run(path, mk(cid))
        const hitB = posts.some(p => p.split('?')[0].split('/').includes('camp_b'))
        log.push(`[4x] ${label.padEnd(20)} cid=${JSON.stringify(cid).padEnd(34)} → ${r.status} posts=${JSON.stringify(posts)} hitB=${hitB}`)
        expect(hitB).toBe(false)
      })
    }
  }

  it('CONTROL: client staff on A own campaign camp_a → execute pause really writes (harness sees writes)', async () => {
    h.email = ID.client
    const r = await run('meta-ads/execute', { action_type: 'ads.pause_campaign', campaign_id: 'camp_a' })
    log.push(`[CTRL] camp_a execute pause → ${r.status} writes=${JSON.stringify(h.writes)}`)
    expect(r.status).toBe(200)
    expect(h.writes).toEqual(['setCampaignStatus(camp_a)'])
  })

  it('CONTROL: global admin override binds A→ACC_B, then camp_b passes (registry is the only gate)', async () => {
    h.email = FDE
    const before = snapshot(h.db)
    const b = await patchA({ ad_account_id: ACC_B, allow_shared_account: true, override_reason: '确认共用账户确认共用账户' })
    h.email = ID.client
    const r = await run('meta-ads/execute', { action_type: 'ads.pause_campaign', campaign_id: 'camp_b' })
    log.push(`[CTRL] admin override bind → ${b.status} (changed=${before !== snapshot(h.db)}); then client camp_b → ${r.status}`)
    expect(b.status).toBe(200)
    expect(r.status).toBe(200)
  })
})
