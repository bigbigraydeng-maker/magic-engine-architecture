import { describe, it, expect } from 'vitest'
import {
  partnerComplianceFooter,
  validatePersonalizationJson,
  buildPersonalizationPrompt,
  assemblePartnerEnquiryEmail,
} from './outreach'

describe('partnerComplianceFooter', () => {
  it('includes sender identity and the given reason, never the prospecting "Google Business listing" wording', () => {
    const footer = partnerComplianceFooter('We found you via the Google Partner directory.')
    expect(footer).toContain('Magic Engine')
    expect(footer).toContain('We found you via the Google Partner directory.')
    expect(footer).not.toContain('Google Business listing')
  })
})

describe('validatePersonalizationJson', () => {
  it('accepts a well-formed object', () => {
    const result = validatePersonalizationJson({
      qualification_sentence: 'You are listed as a Google Premier Partner.',
      possible_fit_sentence: 'This looks relevant to our partner search.',
    })
    expect(result.qualification_sentence).toContain('Google Premier Partner')
  })

  it('rejects a missing qualification_sentence', () => {
    expect(() => validatePersonalizationJson({ possible_fit_sentence: 'x' })).toThrow()
  })

  it('rejects a missing possible_fit_sentence', () => {
    expect(() => validatePersonalizationJson({ qualification_sentence: 'x' })).toThrow()
  })

  it('rejects a non-object', () => {
    expect(() => validatePersonalizationJson(null)).toThrow()
    expect(() => validatePersonalizationJson('x')).toThrow()
  })
})

describe('buildPersonalizationPrompt', () => {
  it('includes the company name and every evidence line', () => {
    const prompt = buildPersonalizationPrompt({
      company_name: 'Acme Digital',
      evidence: ['Google Premier Partner per Google partner directory', 'AU-based, Sydney office'],
    })
    expect(prompt).toContain('Acme Digital')
    expect(prompt).toContain('Google Premier Partner per Google partner directory')
    expect(prompt).toContain('AU-based, Sydney office')
  })
})

describe('assemblePartnerEnquiryEmail', () => {
  it('uses the approved subject line format', () => {
    const email = assemblePartnerEnquiryEmail({
      companyName: 'Acme Digital',
      personalization: {
        qualification_sentence: 'You are a verified Google Premier Partner.',
        possible_fit_sentence: 'This is directly relevant to our search.',
      },
    })
    expect(email.subject).toBe('Partnership enquiry — Magic Engine / Acme Digital')
  })

  it('body contains the personalization, the standard questions, and the footer', () => {
    const email = assemblePartnerEnquiryEmail({
      companyName: 'Acme Digital',
      personalization: {
        qualification_sentence: 'You are a verified Google Premier Partner.',
        possible_fit_sentence: 'This is directly relevant to our search.',
      },
    })
    expect(email.body).toContain('You are a verified Google Premier Partner.')
    expect(email.body).toContain('agency-to-agency, reseller, sub-agency, white-label')
    expect(email.body).toContain('Magic Engine')
    expect(email.body).not.toContain('Google Business listing')
  })

  it('never claims prior contact or borrowed credentials (forbidden phrases from spec §12)', () => {
    const email = assemblePartnerEnquiryEmail({
      companyName: 'Acme Digital',
      personalization: {
        qualification_sentence: 'You are a verified Google Premier Partner.',
        possible_fit_sentence: 'This is directly relevant to our search.',
      },
    })
    expect(email.body.toLowerCase()).not.toContain('borrow your credentials')
    expect(email.body.toLowerCase()).not.toContain('use your meta partner badge')
  })
})
