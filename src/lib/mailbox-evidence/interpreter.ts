import {
  MAILBOX_EVIDENCE_RULE_ID,
  MAILBOX_EVIDENCE_RULE_VERSION,
  type EvidenceReasonCode,
  type MailboxEvidenceAssessment,
  type MailboxEvidenceClaim,
  type NormalizedMailboxEvidenceObservation,
  type OpaqueProvenanceReference,
} from './types'

const OPAQUE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/

const CLAIM_BY_SIGNAL = {
  payment: 'PAYMENT_CONFIRMATION_OBSERVED',
  booking: 'BOOKING_CONFIRMATION_OBSERVED',
  passport_receipt: 'PASSPORT_RECEIPT_OBSERVED',
  follow_up: 'FOLLOW_UP_STATE_OBSERVED',
} as const satisfies Record<string, MailboxEvidenceClaim>

export function interpretMailboxEvidence(
  input: unknown,
): MailboxEvidenceAssessment {
  if (!isObservation(input)) return invalidAssessment(input)
  const observation = input
  const unknownReasons = collectUnknownReasons(observation)
  const state = unknownReasons.length > 0
    ? 'UNKNOWN'
    : assessmentStateFor(observation)
  const reasonCodes = unknownReasons.length > 0
    ? unknownReasons
    : assessmentReasonsFor(observation)

  return {
    signalKind: observation.signalKind,
    claim: CLAIM_BY_SIGNAL[observation.signalKind],
    state,
    reasonCodes,
    provenance: safeProvenance(observation),
    ruleId: MAILBOX_EVIDENCE_RULE_ID,
    ruleVersion: MAILBOX_EVIDENCE_RULE_VERSION,
  }
}

function collectUnknownReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  return [
    ...scopeReasons(observation),
    ...identityReasons(observation),
    ...referenceReasons(observation),
    ...sourceAndStatusReasons(observation),
    ...qualityReasons(observation),
    ...provenanceReasons(observation),
  ]
}

function scopeReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  const { boundary } = observation
  const required = [boundary.tenantId, boundary.clientId, boundary.provider]
  if (!required.every(value => value.trim().length > 0)) return ['MISSING_SCOPE_BINDING']
  return isOpaqueDigest(boundary.providerAccountRef)
    ? []
    : ['ACCOUNT_REFERENCE_NOT_OPAQUE']
}

function identityReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  const { boundary, subjectIdentity } = observation
  if (subjectIdentity.state === 'ambiguous') return ['IDENTITY_AMBIGUOUS']
  if (subjectIdentity.state === 'unresolved') return ['IDENTITY_UNRESOLVED']
  if (subjectIdentity.state === 'cross_boundary') return ['CROSS_BOUNDARY_IDENTITY']
  return subjectIdentity.tenantId === boundary.tenantId
    && subjectIdentity.clientId === boundary.clientId
    ? []
    : ['CROSS_BOUNDARY_IDENTITY']
}

function referenceReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  switch (observation.businessReference) {
    case 'ambiguous': return ['REFERENCE_AMBIGUOUS']
    case 'missing': return ['REFERENCE_MISSING']
    case 'cross_boundary': return ['REFERENCE_CROSS_BOUNDARY']
    default: return []
  }
}

function sourceAndStatusReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  const reasons: EvidenceReasonCode[] = []
  if (observation.sourceAuthority === 'missing') reasons.push('SOURCE_MISSING')
  if (observation.structuredStatus === 'denied') reasons.push('STRUCTURED_STATUS_NEGATIVE')
  if (observation.structuredStatus === 'unknown') reasons.push('STRUCTURED_STATUS_UNKNOWN')
  return reasons
}

function qualityReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  const reasons: EvidenceReasonCode[] = []
  if (observation.freshness === 'stale') reasons.push('EVIDENCE_STALE')
  if (observation.completeness === 'incomplete') reasons.push('EVIDENCE_INCOMPLETE')
  if (observation.completeness === 'truncated') reasons.push('EVIDENCE_TRUNCATED')
  if (observation.conflict === 'conflicted') reasons.push('EVIDENCE_CONFLICTED')
  return reasons
}

function provenanceReasons(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  if (observation.provenance.length === 0) return ['PROVENANCE_MISSING']
  if (observation.provenance.some(reference => (
    !isOpaqueDigest(reference.opaqueRef)
    || !isOpaqueDigest(reference.providerAccountRef)
  ))) {
    return ['PROVENANCE_NOT_OPAQUE']
  }
  return observation.provenance.every(reference => sameBoundary(observation, reference))
    ? []
    : ['CROSS_BOUNDARY_PROVENANCE']
}

function sameBoundary(
  observation: NormalizedMailboxEvidenceObservation,
  reference: OpaqueProvenanceReference,
): boolean {
  const boundary = observation.boundary
  return reference.tenantId === boundary.tenantId
    && reference.clientId === boundary.clientId
    && reference.provider === boundary.provider
    && reference.providerAccountRef === boundary.providerAccountRef
}

function assessmentStateFor(
  observation: NormalizedMailboxEvidenceObservation,
): 'PROVEN' | 'INFERRED' {
  return observation.sourceAuthority === 'trusted_structured'
    ? 'PROVEN'
    : 'INFERRED'
}

function assessmentReasonsFor(
  observation: NormalizedMailboxEvidenceObservation,
): EvidenceReasonCode[] {
  const sourceReason: EvidenceReasonCode = observation.sourceAuthority === 'trusted_structured'
    ? 'TRUSTED_STRUCTURED_STATUS'
    : observation.sourceAuthority === 'weak_assertion'
      ? 'WEAK_SOURCE_ASSERTION'
      : 'NON_AUTHORITATIVE_OBSERVATION'
  return observation.signalKind === 'passport_receipt'
    ? [sourceReason, 'PASSPORT_RECEIPT_OBSERVATION_ONLY']
    : [sourceReason]
}

function safeProvenance(
  observation: NormalizedMailboxEvidenceObservation,
): OpaqueProvenanceReference[] {
  if (scopeReasons(observation).length > 0) return []
  if (identityReasons(observation).includes('CROSS_BOUNDARY_IDENTITY')) return []
  if (referenceReasons(observation).includes('REFERENCE_CROSS_BOUNDARY')) return []
  if (provenanceReasons(observation).length > 0) return []
  const unique = new Map<string, OpaqueProvenanceReference>()
  for (const reference of observation.provenance) {
    unique.set(provenanceKey(reference), { ...reference })
  }
  return Array.from(unique.entries())
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, reference]) => reference)
}

function provenanceKey(reference: OpaqueProvenanceReference): string {
  return [reference.tenantId, reference.clientId, reference.provider,
    reference.providerAccountRef, reference.opaqueRef].join('\u0000')
}

function invalidAssessment(input: unknown): MailboxEvidenceAssessment {
  const signalKind = isRecord(input) && SIGNAL_KINDS.has(input.signalKind as string)
    ? input.signalKind as NormalizedMailboxEvidenceObservation['signalKind']
    : 'unknown'
  return {
    signalKind,
    claim: signalKind === 'unknown' ? 'UNKNOWN_OBSERVATION' : CLAIM_BY_SIGNAL[signalKind],
    state: 'UNKNOWN',
    reasonCodes: ['INVALID_OBSERVATION'],
    provenance: [],
    ruleId: MAILBOX_EVIDENCE_RULE_ID,
    ruleVersion: MAILBOX_EVIDENCE_RULE_VERSION,
  }
}

const SIGNAL_KINDS = new Set(['payment', 'booking', 'passport_receipt', 'follow_up'])
const IDENTITY_STATES = new Set(['exact', 'ambiguous', 'unresolved', 'cross_boundary'])
const REFERENCE_STATES = new Set(['exact', 'ambiguous', 'missing', 'cross_boundary'])
const SOURCE_AUTHORITIES = new Set([
  'trusted_structured', 'weak_assertion', 'safe_non_authoritative_observation', 'missing',
])
const STRUCTURED_STATUSES = new Set(['affirmed', 'denied', 'unknown'])
const FRESHNESS_STATES = new Set(['fresh', 'stale'])
const COMPLETENESS_STATES = new Set(['complete', 'incomplete', 'truncated'])
const CONFLICT_STATES = new Set(['none', 'conflicted'])

function isObservation(value: unknown): value is NormalizedMailboxEvidenceObservation {
  if (!isRecord(value) || !SIGNAL_KINDS.has(value.signalKind as string)) return false
  if (!isBoundary(value.boundary) || !isIdentity(value.subjectIdentity)) return false
  if (!REFERENCE_STATES.has(value.businessReference as string)) return false
  if (!SOURCE_AUTHORITIES.has(value.sourceAuthority as string)) return false
  if (!STRUCTURED_STATUSES.has(value.structuredStatus as string)) return false
  if (!FRESHNESS_STATES.has(value.freshness as string)) return false
  if (!COMPLETENESS_STATES.has(value.completeness as string)) return false
  if (!CONFLICT_STATES.has(value.conflict as string)) return false
  return Array.isArray(value.provenance) && value.provenance.every(isProvenance)
}

function isBoundary(value: unknown): value is NormalizedMailboxEvidenceObservation['boundary'] {
  return isRecord(value)
    && ['tenantId', 'clientId', 'provider', 'providerAccountRef']
      .every(field => typeof value[field] === 'string')
}

function isIdentity(value: unknown): value is NormalizedMailboxEvidenceObservation['subjectIdentity'] {
  return isRecord(value)
    && IDENTITY_STATES.has(value.state as string)
    && typeof value.tenantId === 'string'
    && typeof value.clientId === 'string'
}

function isProvenance(value: unknown): value is OpaqueProvenanceReference {
  return isRecord(value) && isBoundary(value) && typeof value.opaqueRef === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOpaqueDigest(value: string): boolean {
  return OPAQUE_DIGEST_PATTERN.test(value)
}
