import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkConfirmerEligibility, isGlobalKnowledgeAdmin, isMeIdentityEmail } from '../identity'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  delete process.env.ADMIN_EMAILS
  delete process.env.ADMIN_EMAIL_DOMAIN
  delete process.env.DEMO_ADMINS
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('isGlobalKnowledgeAdmin', () => {
  it('matches an exact ADMIN_EMAILS entry, case-insensitively', () => {
    process.env.ADMIN_EMAILS = 'ray@magicengine.com.au, pm@magicengine.com.au'
    expect(isGlobalKnowledgeAdmin('RAY@magicengine.com.au')).toBe(true)
    expect(isGlobalKnowledgeAdmin('pm@magicengine.com.au')).toBe(true)
  })

  it('does NOT accept an ADMIN_EMAIL_DOMAIN match — only exact ADMIN_EMAILS', () => {
    process.env.ADMIN_EMAILS = 'ray@magicengine.com.au'
    process.env.ADMIN_EMAIL_DOMAIN = 'magicengine.com.au'
    expect(isGlobalKnowledgeAdmin('someone-else@magicengine.com.au')).toBe(false)
  })

  it('returns false with no ADMIN_EMAILS configured (fail-closed)', () => {
    expect(isGlobalKnowledgeAdmin('anyone@example.com')).toBe(false)
  })
})

describe('isMeIdentityEmail', () => {
  it('flags ADMIN_EMAILS entries', () => {
    process.env.ADMIN_EMAILS = 'ray@magicengine.com.au'
    expect(isMeIdentityEmail('ray@magicengine.com.au')).toBe(true)
  })

  it('flags known ME company domains even without ADMIN_EMAIL_DOMAIN configured', () => {
    expect(isMeIdentityEmail('fde@magicengine.com.au')).toBe(true)
    expect(isMeIdentityEmail('hello@magicengine.cloud')).toBe(true)
  })

  it('flags an ADMIN_EMAIL_DOMAIN match', () => {
    process.env.ADMIN_EMAIL_DOMAIN = 'contractor-agency.example'
    expect(isMeIdentityEmail('someone@contractor-agency.example')).toBe(true)
  })

  it('flags a DEMO_ADMINS scoped account', () => {
    process.env.DEMO_ADMINS = 'demo@magicengine.com.au:c0000000-0000-0000-0000-000000000000'
    expect(isMeIdentityEmail('demo@magicengine.com.au')).toBe(true)
  })

  it('does NOT flag a genuine client-side email', () => {
    expect(isMeIdentityEmail('boss@nal.co.nz')).toBe(false)
  })
})

describe('checkConfirmerEligibility', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAILS = 'admin@magicengine.com.au'
  })

  it('allows a global admin to register a genuine client contact', () => {
    expect(checkConfirmerEligibility('admin@magicengine.com.au', 'boss@nal.co.nz')).toEqual({ ok: true })
  })

  it('rejects when the registrant is not a global admin (e.g. a domain-matched FDE, not exact-listed)', () => {
    process.env.ADMIN_EMAIL_DOMAIN = 'magicengine.com.au'
    expect(checkConfirmerEligibility('fde@magicengine.com.au', 'boss@nal.co.nz')).toEqual({
      ok: false,
      reason: 'not_global_admin',
    })
  })

  it('rejects registering an ME identity as the confirmer', () => {
    expect(checkConfirmerEligibility('admin@magicengine.com.au', 'someone@magicengine.cloud')).toEqual({
      ok: false,
      reason: 'confirmer_is_me_identity',
    })
  })

  it('rejects the registrant registering themselves (caught as an ME identity, same as any other ME email)', () => {
    expect(checkConfirmerEligibility('admin@magicengine.com.au', 'ADMIN@magicengine.com.au')).toEqual({
      ok: false,
      reason: 'confirmer_is_me_identity',
    })
  })
})
