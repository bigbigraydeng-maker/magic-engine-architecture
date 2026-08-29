import { describe, expect, it } from 'vitest'
import { extractOutcomeContract } from '../src/outcome-contract.mjs'

const COMPLETE = [
  '## Outcome-Contract',
  '- Proof: GSC clicks for /blog/x up 10% within 30 days',
  '- Verification-Window: 30 days post-merge',
  '- Owner: FDE',
  '- Status: UNKNOWN',
].join('\n')

describe('extractOutcomeContract', () => {
  it('parses a complete section', () => {
    const result = extractOutcomeContract(COMPLETE)
    expect(result).toEqual({
      ok: true,
      fields: {
        Proof: 'GSC clicks for /blog/x up 10% within 30 days',
        'Verification-Window': '30 days post-merge',
        Owner: 'FDE',
        Status: 'UNKNOWN',
      },
    })
  })

  // Fixture #9: UNKNOWN is retained as a legal value.
  it('retains UNKNOWN as a legal field value rather than treating it as missing', () => {
    const result = extractOutcomeContract(
      ['## Outcome-Contract', '- Proof: UNKNOWN', '- Verification-Window: UNKNOWN', '- Owner: UNKNOWN', '- Status: UNKNOWN'].join('\n')
    )
    expect(result).toEqual({ ok: true, fields: { Proof: 'UNKNOWN', 'Verification-Window': 'UNKNOWN', Owner: 'UNKNOWN', Status: 'UNKNOWN' } })
  })

  it('fails when the section is missing entirely', () => {
    expect(extractOutcomeContract('Just a normal PR body with no section.')).toEqual({
      ok: false,
      reason: 'MISSING_SECTION',
    })
  })

  // Fixture #9: omission of a required field fails, even inside a present section.
  it('fails when a required field is omitted from an otherwise-present section', () => {
    const result = extractOutcomeContract(['## Outcome-Contract', '- Proof: UNKNOWN', '- Owner: FDE', '- Status: UNKNOWN'].join('\n'))
    expect(result).toEqual({ ok: false, reason: 'MISSING_FIELDS', missing: ['Verification-Window'] })
  })

  it('stops reading at the next heading, so unrelated section content is not swept in', () => {
    const body = [COMPLETE, '', '## Some Other Section', '- Proof: this must not be read', ''].join('\n')
    const result = extractOutcomeContract(body)
    expect(result).toEqual({
      ok: true,
      fields: {
        Proof: 'GSC clicks for /blog/x up 10% within 30 days',
        'Verification-Window': '30 days post-merge',
        Owner: 'FDE',
        Status: 'UNKNOWN',
      },
    })
  })

  it('treats an empty-string field value as missing, not present-but-blank', () => {
    const result = extractOutcomeContract(['## Outcome-Contract', '- Proof:', '- Verification-Window: UNKNOWN', '- Owner: UNKNOWN', '- Status: UNKNOWN'].join('\n'))
    expect(result.ok).toBe(false)
  })
})
