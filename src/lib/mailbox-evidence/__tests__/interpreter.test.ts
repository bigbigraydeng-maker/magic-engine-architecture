import { describe, expect, it } from 'vitest'
import {
  interpretMailboxEvidence,
  type MailboxSignalKind,
  type NormalizedMailboxEvidenceObservation,
} from '..'

const SIGNALS: readonly MailboxSignalKind[] = [
  'payment',
  'booking',
  'passport_receipt',
  'follow_up',
]

function observation(
  signalKind: MailboxSignalKind,
  patch: Partial<NormalizedMailboxEvidenceObservation> = {},
): NormalizedMailboxEvidenceObservation {
  const boundary = {
    tenantId: 'tenant_01',
    clientId: 'client_01',
    provider: 'provider_alpha',
    providerAccountId: 'account_01',
  }
  return {
    signalKind,
    boundary,
    subjectIdentity: { state: 'exact', tenantId: boundary.tenantId, clientId: boundary.clientId },
    businessReference: 'exact',
    sourceAuthority: 'trusted_structured',
    structuredStatus: 'affirmed',
    freshness: 'fresh',
    completeness: 'complete',
    conflict: 'none',
    provenance: [{ ...boundary, opaqueRef: 'opaque_ref_0001' }],
    ...patch,
  }
}

const UNKNOWN_CASES = [
  ['negative', { structuredStatus: 'denied' }, 'STRUCTURED_STATUS_NEGATIVE'],
  ['ambiguous', { businessReference: 'ambiguous' }, 'REFERENCE_AMBIGUOUS'],
  ['stale', { freshness: 'stale' }, 'EVIDENCE_STALE'],
  ['truncated', { completeness: 'truncated' }, 'EVIDENCE_TRUNCATED'],
  ['incomplete', { completeness: 'incomplete' }, 'EVIDENCE_INCOMPLETE'],
  ['conflict', { conflict: 'conflicted' }, 'EVIDENCE_CONFLICTED'],
] as const

describe('interpretMailboxEvidence truth table', () => {
  it.each(SIGNALS)('%s: proves only fresh, complete, exact structured evidence', signalKind => {
    expect(interpretMailboxEvidence(observation(signalKind))).toMatchObject({
      signalKind,
      state: 'PROVEN',
      reasonCodes: expect.arrayContaining(['TRUSTED_STRUCTURED_STATUS']),
    })
  })

  for (const [caseName, patch, reasonCode] of UNKNOWN_CASES) {
    it.each(SIGNALS)(`${caseName} %s evidence is UNKNOWN`, signalKind => {
      const result = interpretMailboxEvidence(observation(signalKind, patch))
      expect(result.state).toBe('UNKNOWN')
      expect(result.reasonCodes).toContain(reasonCode)
    })
  }

  it.each(SIGNALS)('cross-tenant %s identity is UNKNOWN', signalKind => {
    const result = interpretMailboxEvidence(observation(signalKind, {
      subjectIdentity: { state: 'exact', tenantId: 'tenant_02', clientId: 'client_01' },
    }))
    expect(result).toMatchObject({ state: 'UNKNOWN' })
    expect(result.reasonCodes).toContain('CROSS_BOUNDARY_IDENTITY')
  })

  it.each(SIGNALS)('cross-account %s provenance is UNKNOWN', signalKind => {
    const base = observation(signalKind)
    const result = interpretMailboxEvidence({
      ...base,
      provenance: [{ ...base.boundary, providerAccountId: 'account_02', opaqueRef: 'opaque_ref_0002' }],
    })
    expect(result).toMatchObject({ state: 'UNKNOWN' })
    expect(result.reasonCodes).toContain('CROSS_BOUNDARY_PROVENANCE')
    expect(result.provenance).toEqual([])
  })
})

describe('conservative semantics', () => {
  it.each(['payment', 'booking'] as const)('%s assertion cannot be PROVEN', signalKind => {
    const result = interpretMailboxEvidence(observation(signalKind, {
      sourceAuthority: 'weak_assertion',
    }))
    expect(result).toMatchObject({ state: 'INFERRED', reasonCodes: ['WEAK_SOURCE_ASSERTION'] })
  })

  it('conflicting strong evidence degrades to UNKNOWN', () => {
    const result = interpretMailboxEvidence(observation('payment', { conflict: 'conflicted' }))
    expect(result).toMatchObject({ state: 'UNKNOWN' })
    expect(result.reasonCodes).toContain('EVIDENCE_CONFLICTED')
  })

  it('passport is scoped to a metadata-level mailbox receipt observation', () => {
    const result = interpretMailboxEvidence(observation('passport_receipt'))
    expect(result).toMatchObject({
      state: 'PROVEN',
      claim: 'PASSPORT_RECEIPT_OBSERVED',
    })
    expect(result.reasonCodes).toContain('PASSPORT_RECEIPT_OBSERVATION_ONLY')
    expect(JSON.stringify(result)).not.toMatch(/valid|owner|filename|attachment|content/i)
  })

  it('follow-up is never PROVEN when the sync is incomplete', () => {
    const result = interpretMailboxEvidence(observation('follow_up', {
      completeness: 'incomplete',
    }))
    expect(result.state).toBe('UNKNOWN')
  })
})

describe('provider neutrality, provenance and purity', () => {
  it('synthetic provider fixtures produce the same provider-neutral result', () => {
    const microsoftLike = providerFixture('synthetic_microsoft_mail')
    const gmailLike = providerFixture('synthetic_gmail_mail')
    const first = interpretMailboxEvidence(microsoftLike)
    const second = interpretMailboxEvidence(gmailLike)
    expect({ ...first, provenance: [] }).toEqual({ ...second, provenance: [] })
  })

  it('preserves only opaque, boundary-scoped provenance', () => {
    const result = interpretMailboxEvidence(observation('payment'))
    expect(result.provenance).toEqual([{
      tenantId: 'tenant_01',
      clientId: 'client_01',
      provider: 'provider_alpha',
      providerAccountId: 'account_01',
      opaqueRef: 'opaque_ref_0001',
    }])
    expect(JSON.stringify(result.provenance)).not.toMatch(/@|https?:|\s/)
  })

  it('rejects provenance that is not structurally opaque', () => {
    const base = observation('payment')
    const result = interpretMailboxEvidence({
      ...base,
      provenance: [{ ...base.boundary, opaqueRef: 'person@example.test' }],
    })
    expect(result).toMatchObject({ state: 'UNKNOWN' })
    expect(result.reasonCodes).toContain('PROVENANCE_NOT_OPAQUE')
    expect(result.provenance).toEqual([])
  })

  it('is deterministic, does not mutate input and emits no mutation instruction', () => {
    const input = observation('follow_up')
    const snapshot = structuredClone(input)
    const first = interpretMailboxEvidence(input)
    const second = interpretMailboxEvidence(input)
    expect(first).toEqual(second)
    expect(input).toEqual(snapshot)
    expect(Object.keys(first)).not.toEqual(expect.arrayContaining([
      'action', 'instruction', 'mutation', 'nextAction', 'write',
    ]))
  })
})

function providerFixture(provider: string): NormalizedMailboxEvidenceObservation {
  const base = observation('booking')
  return {
    ...base,
    boundary: { ...base.boundary, provider },
    provenance: base.provenance.map(reference => ({ ...reference, provider })),
  }
}
