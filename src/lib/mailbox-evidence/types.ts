export const MAILBOX_EVIDENCE_RULE_ID = 'mailbox.business-evidence'
export const MAILBOX_EVIDENCE_RULE_VERSION = '1.0.0'

export type MailboxSignalKind =
  | 'payment'
  | 'booking'
  | 'passport_receipt'
  | 'follow_up'

export type EvidenceAssessmentState = 'PROVEN' | 'INFERRED' | 'UNKNOWN'

export type EvidenceReasonCode =
  | 'INVALID_OBSERVATION'
  | 'MISSING_SCOPE_BINDING'
  | 'ACCOUNT_REFERENCE_NOT_OPAQUE'
  | 'CROSS_BOUNDARY_IDENTITY'
  | 'CROSS_BOUNDARY_PROVENANCE'
  | 'IDENTITY_AMBIGUOUS'
  | 'IDENTITY_UNRESOLVED'
  | 'REFERENCE_AMBIGUOUS'
  | 'REFERENCE_MISSING'
  | 'REFERENCE_CROSS_BOUNDARY'
  | 'SOURCE_MISSING'
  | 'STRUCTURED_STATUS_NEGATIVE'
  | 'STRUCTURED_STATUS_UNKNOWN'
  | 'EVIDENCE_STALE'
  | 'EVIDENCE_INCOMPLETE'
  | 'EVIDENCE_TRUNCATED'
  | 'EVIDENCE_CONFLICTED'
  | 'PROVENANCE_MISSING'
  | 'PROVENANCE_NOT_OPAQUE'
  | 'TRUSTED_STRUCTURED_STATUS'
  | 'WEAK_SOURCE_ASSERTION'
  | 'NON_AUTHORITATIVE_OBSERVATION'
  | 'PASSPORT_RECEIPT_OBSERVATION_ONLY'

export type MailboxEvidenceClaim =
  | 'PAYMENT_CONFIRMATION_OBSERVED'
  | 'BOOKING_CONFIRMATION_OBSERVED'
  | 'PASSPORT_RECEIPT_OBSERVED'
  | 'FOLLOW_UP_STATE_OBSERVED'
  | 'UNKNOWN_OBSERVATION'

export interface EvidenceBoundary {
  readonly tenantId: string
  readonly clientId: string
  readonly provider: string
  /** SHA-256 digest reference only; never a mailbox address or provider payload. */
  readonly providerAccountRef: string
}

export interface ResolvedSubjectIdentity {
  readonly state: 'exact' | 'ambiguous' | 'unresolved' | 'cross_boundary'
  readonly tenantId: string
  readonly clientId: string
}

export interface OpaqueProvenanceReference extends EvidenceBoundary {
  readonly opaqueRef: string
}

export interface NormalizedMailboxEvidenceObservation {
  readonly signalKind: MailboxSignalKind
  readonly boundary: EvidenceBoundary
  readonly subjectIdentity: ResolvedSubjectIdentity
  readonly businessReference: 'exact' | 'ambiguous' | 'missing' | 'cross_boundary'
  readonly sourceAuthority:
    | 'trusted_structured'
    | 'weak_assertion'
    | 'safe_non_authoritative_observation'
    | 'missing'
  readonly structuredStatus: 'affirmed' | 'denied' | 'unknown'
  readonly freshness: 'fresh' | 'stale'
  readonly completeness: 'complete' | 'incomplete' | 'truncated'
  readonly conflict: 'none' | 'conflicted'
  readonly provenance: readonly OpaqueProvenanceReference[]
}

export interface MailboxEvidenceAssessment {
  readonly signalKind: MailboxSignalKind | 'unknown'
  readonly claim: MailboxEvidenceClaim
  readonly state: EvidenceAssessmentState
  readonly reasonCodes: readonly EvidenceReasonCode[]
  readonly provenance: readonly OpaqueProvenanceReference[]
  readonly ruleId: typeof MAILBOX_EVIDENCE_RULE_ID
  readonly ruleVersion: typeof MAILBOX_EVIDENCE_RULE_VERSION
}
