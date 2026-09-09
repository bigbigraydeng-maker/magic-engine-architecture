// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/competitors/resolver', () => ({ normaliseDomain: (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0], getClientCompetitors: vi.fn() }))
vi.mock('@/lib/anthropic/client', () => ({ MODEL_SONNET: 'test-model', callClaudeChat: vi.fn(), parseJsonResponse: JSON.parse }))
import { canonicalDomain, approvedUrl } from '../targets'
import { allowedClient, requestSchema, settingsSchema, metadataSchema, periodKey, type Signal, type Evidence } from '../contracts'
import { interpretationPrompt, validateInterpretation, changedWindow } from '../interpret'
import { classifyBusinessPage, projectBusinessContent } from '../content-projection'
import { TRAVEL_BUSINESS_PROFILE, profileForTags } from '../profiles/travel'
const a = '00000000-0000-4000-8000-000000000001'
const b = '00000000-0000-4000-8000-000000000002'
const c = '00000000-0000-4000-8000-000000000003'
const signal = { client_id: a, before_evidence_id: b, after_evidence_id: c } as Signal
const evidence = [b, c].map(id => ({ id, client_id: a, source_url: 'https://example.com/', excerpt: 'Observed marketing content', observed_at: '2026-09-09T00:00:00Z' })) as Evidence[]
const settings = { enabled: false, entitled: false, entitlement_price: 499, entitlement_currency: null, target_nzd: 30, hard_stop_nzd: 50, usd_to_nzd: 1.7, fx_as_of: '2026-09-09', actor_build: '1.2.3', capture_limit_usd: 0.1, overhead_nzd: 0.02, context: '' }
describe('Website scope, budget and evidence contracts', () => {
  beforeEach(() => vi.unstubAllEnvs())
  it('is disabled without explicit rollout config', () => { vi.stubEnv('WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS', ''); expect(allowedClient(a)).toBe(false) })
  it('matches exact client identity only', () => { vi.stubEnv('WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS', a); expect(allowedClient(a)).toBe(true); expect(allowedClient(b)).toBe(false) })
  it('aligns www and bare domain identities', () => expect(canonicalDomain('https://WWW.Example.com/path')).toBe('example.com'))
  it.each(['localhost', '127.0.0.1', '[::1]', 'user:pass@example.com', 'foo.local:80'])('rejects nonpublic identity %s', raw => expect(() => canonicalDomain(raw)).toThrow())
  it.each(['http://example.com/', 'https://example.com:3000/', 'https://user:pass@example.com/', 'https://evil.com/', 'https://example.com/#secret'])('rejects URL outside configured scope %s', url => expect(() => approvedUrl(url, 'example.com')).toThrow())
  it('accepts public https www alias', () => expect(approvedUrl('https://www.example.com/prices', 'example.com')).toBe('https://www.example.com/prices'))
  it('applies Auckland month boundary', () => expect(periodKey(new Date('2026-08-31T12:30:00Z'))).toBe('2026-09'))
  it.each([{ hard_stop_nzd: 51 }, { target_nzd: 31 }, { usd_to_nzd: Infinity }, { capture_limit_usd: -1 }, { actor_build: 'latest' }, { overhead_nzd: 0 }])('rejects unsafe settings %j', patch => expect(settingsSchema.safeParse({ ...settings, ...patch }).success).toBe(false))
  it('retains unknown subscription currency without inventing a price currency', () => expect(settingsSchema.parse(settings).entitlement_currency).toBeNull())
  it('keeps archive and tier separate with multi-source provenance', () => expect(metadataSchema.parse({ domain: 'example.com', tier: 'core', status: 'archive', sources: ['manual', 'google_serp'], tags: [], urls: [], interval_hours: 24 }).sources).toHaveLength(2))
  it('extracts a price change beyond the first 8000 characters', () => {
    const prefix = 'Unchanged introduction '.repeat(1000)
    const change = changedWindow(prefix + 'Price $499' + ' same ending'.repeat(100), prefix + 'Price $599' + ' same ending'.repeat(100))
    expect(change.before).toContain('$499'); expect(change.after).toContain('$599')
    expect(change.before.length).toBeLessThan(1000); expect(change.partial).toBe(false)
  })
  it('marks omitted regions of a large diff explicitly', () => {
    const change = changedWindow('A'.repeat(10000), 'B'.repeat(10000))
    expect(change.partial).toBe(true); expect(change.before).toContain('omitted')
  })
  it('keeps a middle price change when framework lines also change', () => {
    const unchanged = Array.from({ length: 900 }, (_, i) => `Tour detail ${i}`)
    const before = ['Navigation old', ...unchanged.slice(0, 450), 'From NZ$5,000', ...unchanged.slice(450), 'Pixel old'].join('\n')
    const after = ['Navigation new', ...unchanged.slice(0, 450), 'From NZ$5,500', ...unchanged.slice(450), 'Pixel new'].join('\n')
    const change = changedWindow(before, after)
    expect(change.before).toContain('NZ$5,000'); expect(change.after).toContain('NZ$5,500')
  })
  it('keeps product-price association when two prices swap', () => {
    const change = changedWindow(
      'Tour A\nNZ$5,000\nTour B\nNZ$6,000',
      'Tour A\nNZ$6,000\nTour B\nNZ$5,000',
    )
    expect(change.before).toContain('Tour A\nNZ$5,000')
    expect(change.after).toContain('Tour A\nNZ$6,000')
  })
  it('keeps a price change inside a very long changed line', () => {
    const prefix = 'Long product description '.repeat(400)
    const change = changedWindow(`Product A\n${prefix}Price NZ$5,000`, `Product A\n${prefix}Price NZ$4,500`)
    expect(change.before).toContain('NZ$5,000'); expect(change.after).toContain('NZ$4,500')
    expect(change.partial).toBe(true)
  })
  it('projects business facts while removing image and tracker noise', () => {
    const projected = projectBusinessContent(`
      # China Tours
      ![destination](https://cdn.example.com/a.jpg)
      [Wonders of China](https://example.com/tours/wonders?utm_source=ad)
      From NZ$9,030pp
      https://bat.bing.com/action/0?ti=123
      China Tours
    `)
    expect(projected).toBe('China Tours\nWonders of China\nFrom NZ$9,030pp\nChina Tours')
  })
  it('collapses only adjacent duplicates so repeated prices keep their product context', () => {
    expect(projectBusinessContent('Tour A\nNZ$5,000\nNZ$5,000\nTour B\nNZ$5,000')).toBe('Tour A\nNZ$5,000\nTour B\nNZ$5,000')
  })
  it('keeps price, availability and dates in the comparison projection', () => {
    expect(projectBusinessContent('Depart NZ 5 Oct 2026\nOnly 3 Spaces Left\nPrice NZ$15,380')).toContain('Only 3 Spaces Left')
  })
  it('preserves product and price association when values swap', () => {
    const before = projectBusinessContent('Tour A\nNZ$5,000\nTour B\nNZ$6,000')
    const after = projectBusinessContent('Tour A\nNZ$6,000\nTour B\nNZ$5,000')
    expect(before).not.toBe(after)
  })
  it('loads travel semantics only from an industry profile tag', () => {
    expect(profileForTags([])).toBeUndefined()
    expect(profileForTags(['industry:travel'])).toBe(TRAVEL_BUSINESS_PROFILE)
    expect(classifyBusinessPage('https://example.com/china/tours/', TRAVEL_BUSINESS_PROFILE)).toBe('product_listing')
    expect(classifyBusinessPage('https://example.com/china/tours/classic-china.htm', TRAVEL_BUSINESS_PROFILE)).toBe('product_detail')
    expect(classifyBusinessPage('https://example.com/new-tours/', TRAVEL_BUSINESS_PROFILE)).toBe('product_listing')
  })
  it('round-trips settings read from database without metadata columns', () => {
    const read = settingsSchema.strip().parse({ ...settings, client_id: a, updated_at: '2026-09-09' })
    expect(settingsSchema.parse(read)).toEqual(settings)
  })
  it('requires evidence to belong to the same client', () => expect(() => interpretationPrompt(signal, evidence.map(e => ({ ...e, client_id: b })), '')).toThrow('identity'))
  it('rejects invented citations', () => expect(() => validateInterpretation(JSON.stringify({ classification: 'threat', summary: 'Changed', confidence: 0.4, evidence_ids: [a, b], recommended_action: 'Review evidence' }), signal)).toThrow('invented'))
  it.each(['threat', 'opportunity', 'ignore'])('validates grounded %s recommendation', classification => expect(validateInterpretation(JSON.stringify({ classification, summary: 'Observed a change', confidence: 0.5, evidence_ids: [b, c], recommended_action: 'Review the offer' }), signal).classification).toBe(classification))
})

describe('existing database client identifiers', () => {
  const request = { client_id: 'c0000000-0000-0000-0000-000000000000', request_id: a, domain: 'example.com', url: 'https://example.com/' }
  it('accepts an existing PostgreSQL UUID without RFC version/variant bits', () => {
    expect(requestSchema.parse(request).client_id).toBe(request.client_id)
  })
  it('still rejects malformed identifiers and non-generated request identities', () => {
    expect(requestSchema.safeParse({ ...request, client_id: 'not-a-client-id' }).success).toBe(false)
    expect(requestSchema.safeParse({ ...request, request_id: request.client_id }).success).toBe(false)
  })
})
