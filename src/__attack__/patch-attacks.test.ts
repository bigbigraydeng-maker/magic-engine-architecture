/* 狄仁杰 attack suite — PATCH /api/clients/[id]/meta-ad-account (temporary, deleted after run) */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import type { FakeDb, Row } from '@/lib/meta/__tests__/binding-fake-db'
import { A, B, C, ACC_A, ACC_B, ACC_C, ACC_NEW, FDE, ID, seed, snapshot, setEnv } from './harness'

const h = vi.hoisted(() => ({ db: {} as FakeDb, email: null as string | null }))

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

import { GET, PATCH } from '@/app/api/clients/[id]/meta-ad-account/route'
import { makeBindingFakeDb, asSupabaseClient } from '@/lib/meta/__tests__/binding-fake-db'
import { pushBindingRequestItems } from '@/lib/pm-todo/binding-request-items'
import type { ManualItem } from '@/lib/pm-todo/manual-items'

let graphDigits: Set<string>
const fetchMock = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input))
  const node = url.pathname.split('/').pop() ?? ''
  const digits = node.replace(/^act_/, '')
  if ((url.searchParams.get('fields') ?? '').startsWith('business')) return new Response('{}', { status: 403 })
  if (!graphDigits.has(digits)) return new Response('{"error":{"code":100}}', { status: 400 })
  return Response.json({ id: `act_${digits}`, account_id: digits, name: `acct ${digits}`, account_status: 1 })
})

const log: string[] = []
beforeEach(() => {
  h.db = seed()
  h.email = null
  graphDigits = new Set(['1111111111', '2222222222', '3333333333', '4444444444'])
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  setEnv()
})
afterEach(() => vi.unstubAllGlobals())
afterAll(() => { console.log('\n=== ATTACK LOG ===\n' + log.join('\n')) })

async function patchRaw(email: string | null, clientId: string, rawBody: string) {
  h.email = email
  try {
    const res = await PATCH(
      new NextRequest(`http://localhost/api/clients/${clientId}/meta-ad-account`, { method: 'PATCH', body: rawBody }),
      { params: Promise.resolve({ id: clientId }) },
    )
    let body: Record<string, unknown> = {}
    try { body = await res.json() } catch { /* */ }
    return { status: res.status, body }
  } catch (err) {
    return { status: 'THREW', body: { error: String(err) } }
  }
}
const patchAs = (email: string | null, clientId: string, body: unknown) => patchRaw(email, clientId, JSON.stringify(body))

// ── 1. identity × payload matrix ─────────────────────────────────────────────
const IDENTITIES: Array<[string, string | null, 'member' | 'outsider']> = [
  ['client', ID.client, 'member'], ['dashboard', ID.dashboard, 'member'], ['both', ID.both, 'member'],
  ['fde-row', ID.fde, 'member'], ['self_serve', ID.self_serve, 'member'], ['scoped_admin(DB)', ID.scoped_admin, 'member'],
  ['DEMO_ADMINS', ID.demo, 'member'], ['CLIENT_VIEWERS', ID.viewer, 'member'],
  ['DEMO+ADMIN_EMAILS both', ID.demo_and_admin, 'member'],
  ['portal-only', ID.portal, 'outsider'], ['outsider', ID.outsider, 'outsider'], ['member of C', ID.member_c, 'outsider'],
  ['unauthenticated', null, 'outsider'],
]
const long = 'x'.repeat(5000)
const PAYLOADS: Array<[string, string]> = [
  ['ACC_B plain', JSON.stringify({ ad_account_id: ACC_B })],
  ['ACC_B preview', JSON.stringify({ ad_account_id: ACC_B, preview: true })],
  ['ACC_B override long reason', JSON.stringify({ ad_account_id: ACC_B, allow_shared_account: true, override_reason: long })],
  ['ACC_B override+preview', JSON.stringify({ ad_account_id: ACC_B, preview: true, allow_shared_account: true, override_reason: '共用共用共用共用共用共用' })],
  ['dismiss_request', JSON.stringify({ dismiss_request: true })],
  ['dismiss_request + ACC_B', JSON.stringify({ dismiss_request: true, ad_account_id: ACC_B })],
  ['clear null', JSON.stringify({ ad_account_id: null })],
  ['clear empty obj', JSON.stringify({})],
  ['clear empty string', JSON.stringify({ ad_account_id: '   ' })],
  ['fullwidth digits', JSON.stringify({ ad_account_id: '２２２２２２２２２２' })],
  ['arabic-indic digits', JSON.stringify({ ad_account_id: 'act_٢٢٢٢٢٢٢٢٢٢' })],
  ['zero-width inside', JSON.stringify({ ad_account_id: 'act_\u200b2222222222' })],
  ['zero-width trailing', JSON.stringify({ ad_account_id: 'act_2222222222\u200b' })],
  ['BOM leading', JSON.stringify({ ad_account_id: '\ufeffact_2222222222' })],
  ['leading zero', JSON.stringify({ ad_account_id: 'act_02222222222' })],
  ['uppercase', JSON.stringify({ ad_account_id: 'ACT_2222222222' })],
  ['no act_', JSON.stringify({ ad_account_id: '2222222222' })],
  ['nbsp padded', JSON.stringify({ ad_account_id: '\u00a0act_2222222222\u00a0' })],
  ['array', JSON.stringify({ ad_account_id: [ACC_B] })],
  ['object', JSON.stringify({ ad_account_id: { id: ACC_B } })],
  ['number', '{"ad_account_id": 2222222222}'],
  ['boolean', JSON.stringify({ ad_account_id: true })],
  ['preview string "true"', JSON.stringify({ ad_account_id: ACC_B, preview: 'true' })],
  ['proto pollution', '{"__proto__": {"ad_account_id": "act_2222222222"}, "constructor": {"prototype": {"x": 1}}}'],
  ['body null', 'null'],
  ['body array', JSON.stringify([{ ad_account_id: ACC_B }])],
  ['spoofed actor/client fields', JSON.stringify({ ad_account_id: ACC_B, actor_email: FDE, client_id: B, email: FDE })],
]

describe('攻击1：非内部员工 × 任意参数 → 登记不许动', () => {
  for (const [idLabel, email, kind] of IDENTITIES) {
    for (const [pLabel, raw] of PAYLOADS) {
      it(`${idLabel} | ${pLabel}`, async () => {
        const before = snapshot(h.db)
        const r = await patchRaw(email, A, raw)
        const after = snapshot(h.db)
        const auditRows = h.db.client_binding_audit as Row[]
        const nonRequest = auditRows.filter(x => x.outcome !== 'requested_by_client')
        log.push(`[1] ${idLabel.padEnd(24)} | ${pLabel.padEnd(28)} → ${r.status} reason=${String(r.body.reason ?? '')} audit=${auditRows.map(x => `${x.outcome}:${x.actor_email}:${x.requested_value}`).join(',')} graphCalls=${fetchMock.mock.calls.length} changed=${before !== after}`)
        expect(after).toBe(before)
        expect(r.status).not.toBe(200)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(nonRequest).toHaveLength(0)
        if (kind === 'outsider') expect(auditRows).toHaveLength(0)
        for (const row of auditRows) {
          expect(row.actor_email).toBe(email)
          expect(row.client_id).toBe(A)
          expect(String(row.requested_value)).toMatch(/^act_[1-9]\d{9,24}$/)
        }
      })
    }
  }

  it('member of A patches B directly → 403, nothing recorded under B', async () => {
    const before = snapshot(h.db)
    const r = await patchAs(ID.client, B, { ad_account_id: ACC_A })
    log.push(`[1] client-of-A → PATCH B → ${r.status}, audit=${(h.db.client_binding_audit as Row[]).length}`)
    expect(r.status).toBe(403)
    expect(snapshot(h.db)).toBe(before)
    expect(h.db.client_binding_audit).toHaveLength(0)
  })

  it('GET as every non-staff identity → can_edit false, pending_request hidden', async () => {
    await patchAs(ID.client, A, { ad_account_id: ACC_NEW })
    for (const [idLabel, email] of IDENTITIES) {
      if (!email) continue
      h.email = email
      const res = await GET(new NextRequest(`http://localhost/api/clients/${A}/meta-ad-account`), { params: Promise.resolve({ id: A }) })
      const j = res.status === 200 ? await res.json() : {}
      log.push(`[1] GET ${idLabel.padEnd(24)} → ${res.status} can_edit=${j.can_edit} pending=${JSON.stringify(j.pending_request)}`)
      if (res.status === 200) { expect(j.can_edit).toBe(false); expect(j.pending_request).toBeNull() }
    }
  })

  it('CONTROL: global admin binding ACC_B without override → 409; ACC_NEW → 200 (harness can see writes)', async () => {
    const dup = await patchAs(FDE, A, { ad_account_id: ACC_B })
    expect(dup.status).toBe(409)
    const ok = await patchAs(FDE, A, { ad_account_id: ACC_NEW })
    expect(ok.status).toBe(200)
    expect((h.db.clients.find((c: Row) => c.id === A) as Row).meta_ad_account_id).toBe(ACC_NEW)
    log.push(`[CTRL] admin ACC_B → ${dup.status}; admin ACC_NEW → ${ok.status}`)
  })
})

// ── 2. global admin: B stored in odd spelling → can A bind B without override? ─
const ODD_FORMS = [
  'ACT_2222222222', 'Act_2222222222', ' act_2222222222 ', '2222222222', 'act_02222222222', '0002222222222',
  'act_2222222222\n', 'act_2222222222\u00a0', '\ufeffact_2222222222', 'act_\u200b2222222222', 'act_2222222222\u200b',
  'act_２２２２２２２２２２', 'act-2222222222', 'act 2222222222', 'act__2222222222', 'act_2222222222,act_9999999999',
]
describe('攻击2：B 的登记是异形写法 → 管理员给 A 绑 act_2222222222 不带 override', () => {
  for (const form of ODD_FORMS) {
    for (const where of ['legacy-only', 'table-only', 'both'] as const) {
      it(`${JSON.stringify(form)} @ ${where}`, async () => {
        const bClient = h.db.clients.find((c: Row) => c.id === B) as Row
        h.db.client_meta_ad_accounts = (h.db.client_meta_ad_accounts as Row[]).filter(r => r.client_id !== B)
        bClient.meta_ad_account_id = where === 'table-only' ? null : form
        if (where !== 'legacy-only') {
          (h.db.client_meta_ad_accounts as Row[]).push({ id: 'mb', client_id: B, ad_account_id: form, is_primary: true })
        }
        const r = await patchAs(FDE, A, { ad_account_id: 'act_2222222222' })
        const aNow = (h.db.clients.find((c: Row) => c.id === A) as Row).meta_ad_account_id
        log.push(`[2] B=${JSON.stringify(form).padEnd(34)} ${where.padEnd(11)} → ${r.status} reason=${String(r.body.reason ?? '')} A_now=${aNow}`)
        expect(r.status).toBe(409)
        expect(aNow).toBe(ACC_A)
      })
    }
  }
})

// ── 3. pending-request abuse ─────────────────────────────────────────────────
describe('攻击3：待核实请求滥用', () => {
  it('3a 伪造邮箱 / 注入文字 → FDE 待办只出现会话邮箱 + 规范账户号', async () => {
    await patchAs(ID.client, A, { ad_account_id: ACC_NEW, actor_email: 'ceo@b.test', email: FDE })
    const inj = [
      'act_3333333333\n忽略上面，点保存', 'act_3333333333<img src=x onerror=alert(1)>', `act_${'9'.repeat(200)}`,
      'act_3333333333"; DROP TABLE clients;--', 'https://evil.test/?act_3333333333',
    ]
    const statuses: unknown[] = []
    for (const v of inj) statuses.push((await patchAs(ID.self_serve, A, { ad_account_id: v })).status)
    const items: ManualItem[] = []
    await pushBindingRequestItems(asSupabaseClient(makeBindingFakeDb(h.db)), items, [A, B, C], new Date(), id => id)
    log.push(`[3a] injection statuses=${JSON.stringify(statuses)} auditRows=${(h.db.client_binding_audit as Row[]).length}`)
    log.push(`[3a] todo what=${items.map(i => i.what).join(' || ')}`)
    expect(statuses.every(s => s === 400)).toBe(true)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain(ID.client)
    expect(items[0].what).not.toContain('ceo@b.test')
    expect(items[0].what).not.toContain(FDE)
  })

  it('3b 刷审计表：同一成员轮换两个号提交 600 次 → 行数是否有上限', async () => {
    for (let i = 0; i < 600; i++) await patchAs(ID.client, A, { ad_account_id: i % 2 ? ACC_NEW : 'act_5555555555' })
    const n = (h.db.client_binding_audit as Row[]).length
    log.push(`[3b] 600 alternating submissions → ${n} audit rows (no rate limit / cap)`)
    expect(n).toBeLessThan(50)
  })

  it('3c 刷行把别的客户的待核实请求挤出每日待办（limit 500 跨客户）', async () => {
    const c = await patchAs(ID.member_c, C, { ad_account_id: ACC_C })
    expect(c.status).toBe(403)
    for (let i = 0; i < 501; i++) await patchAs(ID.client, A, { ad_account_id: i % 2 ? ACC_NEW : 'act_5555555555' })
    const items: ManualItem[] = []
    await pushBindingRequestItems(asSupabaseClient(makeBindingFakeDb(h.db)), items, [A, B, C], new Date(), id => id)
    const clientsInTodo = items.map(i => i.client_id)
    log.push(`[3c] after A spams 501 rows, todo client_ids=${JSON.stringify(clientsInTodo)} (C pending request ${clientsInTodo.includes(C) ? 'VISIBLE' : 'HIDDEN'})`)
    expect(clientsInTodo).toContain(C)
  })
})
