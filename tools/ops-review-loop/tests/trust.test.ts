import { describe, expect, it } from 'vitest'

import { TRUSTED_GATE_AUTHORS } from '../src/trust.mjs'

describe('TRUSTED_GATE_AUTHORS', () => {
  it('trusts only the ambient GITHUB_TOKEN identity', () => {
    expect(TRUSTED_GATE_AUTHORS).toEqual(['github-actions[bot]'])
  })

  it('does not trust the OPS_REVIEW_PAT human identity or a PR author placeholder', () => {
    expect(TRUSTED_GATE_AUTHORS).not.toContain('bigbigraydeng-maker')
    expect(TRUSTED_GATE_AUTHORS).not.toContain('chatgpt-codex-connector')
  })
})
