// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest'
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/competitors/resolver', () => ({ normaliseDomain: (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0], getClientCompetitors: vi.fn() }))
vi.mock('@/lib/anthropic/client', () => ({ MODEL_SONNET: 'test-model', callClaudeChat: vi.fn(), parseJsonResponse: JSON.parse }))
import { canonicalDomain, approvedUrl } from '../targets'
import { allowedClient, settingsSchema, metadataSchema, periodKey, type Signal, type Evidence } from '../contracts'
import { interpretationPrompt, validateInterpretation, changedWindow } from '../interpret'
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
  it('round-trips settings read from database without metadata columns', () => {
    const read = settingsSchema.strip().parse({ ...settings, client_id: a, updated_at: '2026-09-09' })
    expect(settingsSchema.parse(read)).toEqual(settings)
  })
  it('requires evidence to belong to the same client', () => expect(() => interpretationPrompt(signal, evidence.map(e => ({ ...e, client_id: b })), '')).toThrow('identity'))
  it('rejects invented citations', () => expect(() => validateInterpretation(JSON.stringify({ classification: 'threat', summary: 'Changed', confidence: 0.4, evidence_ids: [a, b], recommended_action: 'Review evidence' }), signal)).toThrow('invented'))
  it.each(['threat', 'opportunity', 'ignore'])('validates grounded %s recommendation', classification => expect(validateInterpretation(JSON.stringify({ classification, summary: 'Observed a change', confidence: 0.5, evidence_ids: [b, c], recommended_action: 'Review the offer' }), signal).classification).toBe(classification))
})
