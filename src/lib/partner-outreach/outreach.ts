/**
 * Platform Partner Outreach — enquiry email drafting.
 *
 * Mirrors the shape of src/lib/prospecting/outreach.ts (fixed compliance
 * footer as code, AI only fills the evidence-grounded personalization,
 * draft never auto-sent — a human approves every send) but is a SEPARATE
 * footer/template: prospecting's footer says "we came across {business}
 * through your public Google Business listing", which would be a false
 * provenance claim for a partner found via an official Meta/Google/TikTok
 * partner directory (子牙/魏征 review 2026-09-02). Deliberately does not
 * import src/lib/email/sender.ts — this module only produces a draft row;
 * nothing in this package can place an outbound send.
 */

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import type { PartnerCandidate } from './types'

export interface PartnerOutreachEmail {
  subject: string
  /** Full body INCLUDING the compliance footer — single source of truth. */
  body: string
  generated_at: string
}

// ─── Sender identity + footer (fixed, never AI-generated) ─────────────────

export function partnerSenderIdentity(): { name: string; company: string; region: string } {
  return {
    name: process.env.OUTREACH_SENDER_NAME ?? 'Big Ray Deng',
    company: 'Magic Engine',
    region: 'Australia & New Zealand',
  }
}

/**
 * Identity + genuine reason for contact + a plain-language "let us know if
 * this isn't relevant" line. Not a bulk-marketing footer (this is a one-off
 * B2B partnership enquiry to a business contact, not a consumer/SMB cold
 * list), but keeps the same honesty discipline as the client-prospecting
 * footer: real sender name, real reason, and an easy way to decline.
 */
export function partnerComplianceFooter(reasonForContact: string): string {
  const { name, company, region } = partnerSenderIdentity()
  return [
    'Best regards,',
    name,
    company,
    region,
    '',
    `${reasonForContact} If this isn't the right fit or the right contact, just let us know and we won't follow up further.`,
  ].join('\n')
}

// ─── Evidence-grounded personalization (AI, tightly constrained) ──────────

const SYSTEM_PROMPT = `You write the two personalization sentences for a B2B partnership enquiry email from Magic Engine (an AI-powered growth platform serving SMEs across Australia and New Zealand) to a company that holds an official Meta, Google, and/or TikTok partner status.

Rules:
- Output EXACTLY two sentences: (A) a qualification sentence naming a specific, real fact about the recipient company from the EVIDENCE section (e.g. their partner status, program, or public offering) — never invent a credential not present in EVIDENCE. (B) a possible-fit sentence connecting that fact to why an upstream platform-partner relationship with Magic Engine could be relevant.
- Never claim prior contact, a meeting, or that Magic Engine has used their services. Never write empty flattery ("we love your work"). Never claim ME already qualifies for a partner status it does not hold.
- Plain, professional, factual tone. No exclamation marks, no emoji, no marketing buzzwords.
- Respond with a single JSON object, no markdown: {"qualification_sentence": string, "possible_fit_sentence": string}`

export interface PersonalizationInput {
  company_name: string
  /** Concrete, sourced facts only — e.g. "Google Premier Partner per Google's public partner directory". */
  evidence: string[]
}

export interface PersonalizationLines {
  qualification_sentence: string
  possible_fit_sentence: string
}

/** Exported for tests. */
export function validatePersonalizationJson(raw: unknown): PersonalizationLines {
  const obj = raw as Partial<PersonalizationLines> | null
  if (!obj || typeof obj !== 'object') throw new Error('partner-outreach: not an object')
  if (typeof obj.qualification_sentence !== 'string' || !obj.qualification_sentence.trim())
    throw new Error('partner-outreach: qualification_sentence missing')
  if (typeof obj.possible_fit_sentence !== 'string' || !obj.possible_fit_sentence.trim())
    throw new Error('partner-outreach: possible_fit_sentence missing')
  return {
    qualification_sentence: obj.qualification_sentence.trim(),
    possible_fit_sentence: obj.possible_fit_sentence.trim(),
  }
}

/** Exported for tests. */
export function buildPersonalizationPrompt(input: PersonalizationInput): string {
  return [
    `COMPANY: ${input.company_name}`,
    'EVIDENCE (use only these facts, keep names and program names exact):',
    ...input.evidence.map(e => `- ${e}`),
  ].join('\n')
}

/**
 * Generate the two personalization sentences. Throws if there is no
 * evidence to ground them in — an ungrounded partner email is exactly what
 * spec §11 forbids, so this refuses to produce one rather than let the AI
 * improvise.
 */
export async function generatePersonalizationLines(input: PersonalizationInput): Promise<PersonalizationLines> {
  if (input.evidence.length === 0) {
    throw new Error('partner-outreach: cannot personalize without evidence')
  }
  const result = await callClaudeChat({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPersonalizationPrompt(input) }],
    maxOutputTokens: 400,
  })
  return validatePersonalizationJson(parseJsonResponse<unknown>(result.text))
}

// ─── Template assembly (fixed, code not AI) ────────────────────────────────

const STANDARD_BODY_QUESTIONS = [
  'Could you please let us know whether you offer an agency-to-agency, reseller, sub-agency, white-label or similar partner arrangement?',
  '',
  'We would also be interested to understand:',
  '- which Meta, Google and/or TikTok partner programs you currently participate in;',
  '- what platform support or escalation capabilities may extend to your downstream partners;',
  '- whether our team could access partner training or events;',
  '- how Magic Engine would be permitted to describe the relationship publicly; and',
  '- the commercial requirements, including any fees, minimum spend, account minimums or contract terms.',
  '',
  'We would be happy to arrange a short introductory call if this is something your team supports.',
].join('\n')

/**
 * Assemble the full enquiry email from the approved template (spec §10) +
 * evidence-grounded personalization + fixed footer. Single source of truth
 * so every draft follows the same approved structure — personalization is
 * the only variable part.
 */
export function assemblePartnerEnquiryEmail(params: {
  companyName: string
  personalization: PersonalizationLines
}): PartnerOutreachEmail {
  const subject = `Partnership enquiry — Magic Engine / ${params.companyName}`
  const body = [
    `Hi team,`,
    '',
    `I'm reaching out from Magic Engine, an AI-powered growth platform serving SMEs across Australia and New Zealand. ` +
    `We are currently building our upstream platform partner ecosystem across Meta, Google and TikTok.`,
    '',
    params.personalization.qualification_sentence,
    params.personalization.possible_fit_sentence,
    '',
    `We are not looking to outsource media buying, campaign management or advertising strategy. Our client strategy, ` +
    `technology and day-to-day execution remain in-house. Instead, we are looking for a long-term B2B platform partner ` +
    `that may be able to provide some combination of: platform escalation and support; partner education and training; ` +
    `access to relevant workshops, webinars or platform events; product and policy updates; partner resources; and a ` +
    `clearly defined and compliant partnership relationship.`,
    '',
    STANDARD_BODY_QUESTIONS,
    '',
    partnerComplianceFooter(
      `We came across ${params.companyName} while researching upstream platform partners in AU/NZ.`,
    ),
  ].join('\n')
  return { subject, body, generated_at: new Date().toISOString() }
}
