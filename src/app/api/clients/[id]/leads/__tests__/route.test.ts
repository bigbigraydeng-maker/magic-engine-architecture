/**
 * Tests for POST /api/clients/[id]/leads and OPTIONS preflight.
 *
 * The route is intentionally PUBLIC (no auth). Tests therefore focus on:
 *   1. CORS allowlist derived from clients.domain
 *   2. CLIENT_NOT_FOUND when the client UUID has no row
 *   3. Input validation passthrough from sanitizeLead
 *   4. Honeypot → 200 quiet success, no DB write
 *   5. Rate limit per (client_id, IP) over the recent window
 *   6. Happy-path insert + service-level error mapping
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email-id' }, error: null })
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: (...a: unknown[]) => sendMock(...a) } })),
}))

import { POST, OPTIONS } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'

const mockFrom = vi.mocked(supabaseAdmin.from)
const mockResend = vi.mocked(Resend)

const CLIENT_ID = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'   // oztop
const OZTOP_HOST = 'https://oztopbuildingsupplies.com.au'
const OZTOP_WWW  = 'https://www.oztopbuildingsupplies.com.au'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, opts: { origin?: string; headers?: Record<string, string> } = {}): NextRequest {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.origin ? { Origin: opts.origin } : {}),
    ...opts.headers,
  }
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/leads`,
    { method: 'POST', body: JSON.stringify(body), headers: h },
  )
}

function makeOptions(opts: { origin?: string } = {}): NextRequest {
  return new NextRequest(
    `http://localhost:3001/api/clients/${CLIENT_ID}/leads`,
    { method: 'OPTIONS', headers: opts.origin ? { Origin: opts.origin } : {} },
  )
}

/**
 * Drive the supabaseAdmin.from(...) chain. Maps table name → behaviour.
 * - clients → maybeSingle({ data: { domain: ... } } | null)
 * - leads SELECT (count rate-limit) → returns { count }
 * - leads INSERT → returns inserted row or error
 */
interface LeadsRouteMockOpts {
  clientDomain?:    string | null         // null → CLIENT_NOT_FOUND
  clientName?:      string
  notifyEmails?:    string[]              // leads_config.notify_emails
  recentCount?:     number                // for rate-limit check
  insertResult?:    { data: { id: string } | null; error: { message: string } | null }
  insertCapture?:   (row: Record<string, unknown>) => void
}

function mockSupabaseFor({
  clientDomain,
  clientName,
  notifyEmails,
  recentCount = 0,
  insertResult,
  insertCapture,
}: LeadsRouteMockOpts) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'clients') {
      const chain = {
        select:      vi.fn().mockReturnThis(),
        eq:          vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          clientDomain === null
            ? { data: null, error: null }
            : {
                data: {
                  domain: clientDomain,
                  name: clientName ?? null,
                  leads_config: notifyEmails ? { notify_emails: notifyEmails } : {},
                },
                error: null,
              },
        ),
      }
      return chain as unknown as ReturnType<typeof supabaseAdmin.from>
    }

    if (table === 'leads') {
      const chain = {
        select: vi.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count === 'exact' && opts?.head === true) {
            // Rate-limit count branch.
            return {
              eq:   vi.fn().mockReturnThis(),
              gte:  vi.fn().mockResolvedValue({ count: recentCount, error: null }),
            }
          }
          // After-insert select('id').single() branch.
          return {
            single: vi.fn().mockResolvedValue(
              insertResult ?? { data: { id: 'new-lead-uuid' }, error: null },
            ),
          }
        }),
        eq:     vi.fn().mockReturnThis(),
        gte:    vi.fn().mockReturnThis(),
        insert: vi.fn((row: Record<string, unknown>) => {
          insertCapture?.(row)
          return chain
        }),
      }
      return chain as unknown as ReturnType<typeof supabaseAdmin.from>
    }

    throw new Error(`unexpected table ${table}`)
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIONS — CORS preflight
// ═══════════════════════════════════════════════════════════════════════════════

describe('OPTIONS /api/clients/[id]/leads', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(()  => { vi.resetAllMocks()  })

  it('mirrors apex origin from clients.domain in Access-Control-Allow-Origin', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(makeOptions({ origin: OZTOP_HOST }), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(OZTOP_HOST)
    expect(res.headers.get('Access-Control-Allow-Methods')).toMatch(/POST/)
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it('allows the www subdomain on the same apex', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(makeOptions({ origin: OZTOP_WWW }), { params: { id: CLIENT_ID } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(OZTOP_WWW)
  })

  it('does NOT echo back a foreign origin', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(makeOptions({ origin: 'https://evil.example' }), { params: { id: CLIENT_ID } })
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  // 魏征 P0.1 — normalise BOTH sides + ECHO the normalised value, so future
  // logic that compares ACAO to the allowlist cannot get tripped by a
  // funky-cased attacker Origin.
  it('echoes Origin in lowercase even when the request used a weird case', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(
      makeOptions({ origin: 'HTTPS://OZTOPBUILDINGSUPPLIES.COM.AU' }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://oztopbuildingsupplies.com.au')
  })

  // 魏征 P1.7 — HTTP (non-SSL) origins are intentionally NOT in the allowlist;
  // ME's client LPs must be served over HTTPS. A no-ACAO response surfaces the
  // missing-SSL configuration to the FDE instead of silently working.
  it('rejects an http:// origin (apex without SSL)', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(
      makeOptions({ origin: 'http://oztopbuildingsupplies.com.au' }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  // 魏征 P1.7 — non-apex/non-www subdomain not in allowlist. If a client moves
  // the LP under a different subdomain we add it explicitly; we don't open
  // wildcard subdomain match as that's a much bigger attack surface.
  it('rejects a non-apex / non-www subdomain', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(
      makeOptions({ origin: 'https://shop.oztopbuildingsupplies.com.au' }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('handles OPTIONS without Origin (server-side / non-browser caller)', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await OPTIONS(makeOptions(), { params: { id: CLIENT_ID } })
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Vary')).toBe('Origin')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST — happy path
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/clients/[id]/leads — happy path', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(()  => { vi.resetAllMocks()  })

  it('writes the lead and returns 200 with lead_id + CORS header', async () => {
    let captured: Record<string, unknown> | undefined
    mockSupabaseFor({
      clientDomain:  'oztopbuildingsupplies.com.au',
      recentCount:   0,
      insertResult:  { data: { id: 'lead-abc' }, error: null },
      insertCapture: (row) => { captured = row },
    })

    const res = await POST(
      makeRequest(
        {
          name:         'Sarah Hopkins',
          phone:        '0412 345 678',
          email:        'sarah@example.com',
          project_type: 'tiles',
          suburb:       'Slacks Creek 4127',
          timeline:     'this_month',
          message:      'Bathroom reno — about 12 m² of tiles + vanity.',
          source_url:   'https://oztopbuildingsupplies.com.au/quote/',
        },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.10' } },
      ),
      { params: { id: CLIENT_ID } },
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.lead_id).toBe('lead-abc')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(OZTOP_HOST)

    // Captured insert payload — every key wired correctly
    expect(captured).toMatchObject({
      client_id:    CLIENT_ID,
      name:         'Sarah Hopkins',
      phone:        '0412 345 678',
      email:        'sarah@example.com',
      project_type: 'tiles',
      suburb:       'Slacks Creek 4127',
      timeline:     'this_month',
      source_url:   'https://oztopbuildingsupplies.com.au/quote/',
      client_ip:    '203.0.113.10',
    })
  })

  it('still inserts when Origin is missing (e.g. server-side relay) BUT supplies XFF', async () => {
    let captured: Record<string, unknown> | undefined
    mockSupabaseFor({
      clientDomain:  'oztopbuildingsupplies.com.au',
      insertCapture: (row) => { captured = row },
    })
    const res = await POST(
      makeRequest({ name: 'Sarah', phone: '0412345678' }, { headers: { 'x-forwarded-for': '203.0.113.10' } }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    expect(captured?.name).toBe('Sarah')
  })

  // 魏征 P0.3 — without an IP we can rate-limit-key on, refuse to insert so
  // a single attacker cannot starve the shared 'unknown' bucket.
  it('rejects requests with no XFF / X-Real-IP (cannot determine source)', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await POST(
      makeRequest({ name: 'Ghost', phone: '0412345678' }, { origin: OZTOP_HOST }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_INPUT')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST — client_not_found, validation, honeypot
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST — client lookup + input validation', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(()  => { vi.resetAllMocks()  })

  it('returns 404 CLIENT_NOT_FOUND when the UUID has no clients row', async () => {
    mockSupabaseFor({ clientDomain: null })
    const res = await POST(
      makeRequest({ name: 'Sarah', phone: '0412345678' }, { origin: OZTOP_HOST }),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('CLIENT_NOT_FOUND')
  })

  it('returns 400 INVALID_INPUT when name is missing', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const res = await POST(
      makeRequest(
        { phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.10' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('INVALID_INPUT')
    // Make sure we're hitting the sanitizer's required-field guard, NOT the
    // IP-required guard (which has its own dedicated test above).
    expect(body.error).toMatch(/name/i)
  })

  it('returns 400 INVALID_INPUT when body is not JSON', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au' })
    const req = new NextRequest(
      `http://localhost:3001/api/clients/${CLIENT_ID}/leads`,
      { method: 'POST', body: 'not-json', headers: { 'Content-Type': 'application/json' } },
    )
    const res = await POST(req, { params: { id: CLIENT_ID } })
    expect(res.status).toBe(400)
  })

  it('honeypot → 200 success with lead_id=null + DB never gets an insert call', async () => {
    let inserted = false
    mockSupabaseFor({
      clientDomain:  'oztopbuildingsupplies.com.au',
      insertCapture: () => { inserted = true },
    })
    const res = await POST(
      makeRequest(
        { name: 'Bot', phone: '0412345678', company_hp: 'http://spam.example' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.10' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.lead_id).toBeNull()
    expect(inserted).toBe(false)
  })

  // 魏征 P0.2 — honeypot ALSO consumes the rate-limit bucket so a determined
  // spammer cannot use the trap field as a free pass to burst requests.
  it('honeypot path is itself rate-limited (cannot be used to burst)', async () => {
    mockSupabaseFor({
      clientDomain: 'oztopbuildingsupplies.com.au',
      recentCount:  5,    // already at the limit for this (client, ip)
    })
    const res = await POST(
      makeRequest(
        { name: 'Bot', phone: '0412345678', company_hp: 'gotcha' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.99' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('RATE_LIMITED')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST — rate limit
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST — rate limit', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(()  => { vi.resetAllMocks()  })

  it('returns 429 RATE_LIMITED when recent count >= 5', async () => {
    mockSupabaseFor({
      clientDomain: 'oztopbuildingsupplies.com.au',
      recentCount:  5,
    })
    const res = await POST(
      makeRequest(
        { name: 'Spammer', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.99' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('RATE_LIMITED')
  })

  it('lets the 5th submission through (limit is "below 5")', async () => {
    mockSupabaseFor({
      clientDomain: 'oztopbuildingsupplies.com.au',
      recentCount:  4,
    })
    const res = await POST(
      makeRequest(
        { name: 'Edge', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.50' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
  })

  // 魏征 P1.6 — fail-OPEN explicit test. When the rate-limit count query
  // throws (Supabase blip), we must still let a real lead through rather than
  // 429-failing a paying customer.
  it('fails OPEN when the rate-limit count query errors out', async () => {
    let inserted = false
    mockFrom.mockImplementation((table: string) => {
      if (table === 'clients') {
        return {
          select:      vi.fn().mockReturnThis(),
          eq:          vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { domain: 'oztopbuildingsupplies.com.au' }, error: null }),
        } as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      if (table === 'leads') {
        const chain = {
          select: vi.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === 'exact' && opts?.head === true) {
              // Simulate Supabase coughing on the rate-limit count.
              return {
                eq:  vi.fn().mockReturnThis(),
                gte: vi.fn().mockResolvedValue({ count: null, error: { message: 'supabase blip' } }),
              }
            }
            // After-insert .select('id').single() — still succeeds.
            return { single: vi.fn().mockResolvedValue({ data: { id: 'lead-rl-open' }, error: null }) }
          }),
          eq:     vi.fn().mockReturnThis(),
          gte:    vi.fn().mockReturnThis(),
          insert: vi.fn(() => { inserted = true; return chain }),
        }
        return chain as unknown as ReturnType<typeof supabaseAdmin.from>
      }
      throw new Error(`unexpected ${table}`)
    })

    const res = await POST(
      makeRequest(
        { name: 'Sarah', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.77' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).lead_id).toBe('lead-rl-open')
    expect(inserted).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// POST — leads_config.notify_emails → best-effort client email notification
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST — notify_emails email notification', () => {
  const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockClear()
    sendMock.mockResolvedValue({ data: { id: 'email-id' }, error: null })
    // Earlier describe blocks in this file call vi.resetAllMocks() in their own
    // afterEach, which wipes the `Resend` mock's implementation set once at
    // module load in the vi.mock('resend', ...) factory above — re-establish it
    // here so this block doesn't depend on running before any prior resetAllMocks.
    mockResend.mockImplementation(() => ({
      emails: { send: (...a: unknown[]) => sendMock(...a) },
    } as unknown as InstanceType<typeof Resend>))
    process.env.RESEND_API_KEY = 'test-resend-key'
  })
  afterEach(() => {
    vi.resetAllMocks()
    process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY
  })

  it('emails every configured recipient with the lead details when notify_emails is set', async () => {
    mockSupabaseFor({
      clientDomain: 'oztopbuildingsupplies.com.au',
      clientName:   'Oztop',
      notifyEmails: ['owner@example.com', 'sales@example.com'],
    })
    const res = await POST(
      makeRequest(
        { name: 'Sarah Lee', phone: '0412345678', email: 'sarah@example.com', message: 'Need a quote' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.10' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toEqual(['owner@example.com', 'sales@example.com'])
    expect(call.replyTo).toBe('sarah@example.com')
    expect(call.subject).toContain('Sarah Lee')
    expect(call.html).toContain('Sarah Lee')
  })

  it('does not call Resend when notify_emails is empty', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au', notifyEmails: [] })
    const res = await POST(
      makeRequest(
        { name: 'No Notify', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.11' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('does not call Resend, and still succeeds, when RESEND_API_KEY is not configured', async () => {
    delete process.env.RESEND_API_KEY
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au', notifyEmails: ['owner@example.com'] })
    const res = await POST(
      makeRequest(
        { name: 'No Key', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.12' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('still returns success when the Resend call itself throws', async () => {
    sendMock.mockRejectedValueOnce(new Error('Resend is down'))
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au', notifyEmails: ['owner@example.com'] })
    const res = await POST(
      makeRequest(
        { name: 'Resend Down', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.13' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
  })

  it('omits replyTo when the lead did not supply an email', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au', notifyEmails: ['owner@example.com'] })
    await POST(
      makeRequest(
        { name: 'No Email', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.14' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0].replyTo).toBeUndefined()
  })

  it('strips CR/LF from the lead name before it reaches the email subject', async () => {
    mockSupabaseFor({ clientDomain: 'oztopbuildingsupplies.com.au', notifyEmails: ['owner@example.com'] })
    await POST(
      makeRequest(
        { name: 'Foo\r\nBcc: evil@example.com', phone: '0412345678' },
        { origin: OZTOP_HOST, headers: { 'x-forwarded-for': '203.0.113.15' } },
      ),
      { params: { id: CLIENT_ID } },
    )
    expect(sendMock).toHaveBeenCalledTimes(1)
    const subject = sendMock.mock.calls[0][0].subject as string
    expect(subject).not.toMatch(/[\r\n]/)
  })
})
