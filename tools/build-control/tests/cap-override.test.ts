import { describe, expect, it } from 'vitest'
import { MAX_OVERRIDE_WINDOW_MS, buildCapOverrideMarker, selectCapOverride } from '../src/cap-override.mjs'

const NOW = '2026-08-29T12:00:00Z'
const NOW_MS = Date.parse(NOW)
const iso = (ms: number) => new Date(ms).toISOString()

function comment(author: string, record: Record<string, unknown>) {
  return { author, body: `recovery override\n\n${buildCapOverrideMarker(record as never)}` }
}

const valid = {
  primary_issue: 1249,
  granted_by: 'owner',
  reason: 'recovery control-plane must land while the backlog is still over cap',
  expires_at: iso(NOW_MS + 60 * 60 * 1000),
}

const base = { allowlist: ['owner'], issueNumber: 1249, now: NOW }

describe('selectCapOverride', () => {
  it('grants for a fully valid, in-window override from an allow-listed author', () => {
    const result = selectCapOverride({ ...base, comments: [comment('owner', valid)] })
    expect(result.granted).toBe(true)
    expect(result.granted && result.record.reason).toBe(valid.reason)
  })

  it('refuses an override from an author who is not allow-listed', () => {
    const result = selectCapOverride({
      ...base,
      comments: [comment('attacker', { ...valid, granted_by: 'attacker' })],
    })
    expect(result.granted).toBe(false)
    expect(result.granted === false && result.reason).toContain('allowlist')
  })

  it('refuses when granted_by does not match the actual comment author', () => {
    // An attacker quoting the owner's marker back into their own comment.
    const result = selectCapOverride({ ...base, comments: [comment('attacker', valid)] })
    expect(result.granted).toBe(false)
  })

  it('refuses an override granted for a different Primary Issue', () => {
    const result = selectCapOverride({ ...base, comments: [comment('owner', { ...valid, primary_issue: 999 })] })
    expect(result.granted).toBe(false)
    expect(result.granted === false && result.reason).toContain('#999')
  })

  it('refuses an override with no reason', () => {
    const result = selectCapOverride({ ...base, comments: [comment('owner', { ...valid, reason: '   ' })] })
    expect(result.granted).toBe(false)
    expect(result.granted === false && result.reason).toContain('no reason')
  })

  it('refuses an expired override', () => {
    const expired = { ...valid, expires_at: iso(NOW_MS - 1000) }
    const result = selectCapOverride({ ...base, comments: [comment('owner', expired)] })
    expect(result.granted).toBe(false)
    expect(result.granted === false && result.reason).toContain('expired')
  })

  it('refuses an unbounded expiry beyond the maximum window', () => {
    const forever = { ...valid, expires_at: iso(NOW_MS + MAX_OVERRIDE_WINDOW_MS + 1000) }
    const result = selectCapOverride({ ...base, comments: [comment('owner', forever)] })
    expect(result.granted).toBe(false)
  })

  it.each([['expires_at', 'never'], ['expires_at', 42]])('refuses an unreadable %s of %j', (field, value) => {
    const result = selectCapOverride({ ...base, comments: [comment('owner', { ...valid, [field]: value })] })
    expect(result.granted).toBe(false)
  })

  it('refuses when there is no override at all', () => {
    const result = selectCapOverride({ ...base, comments: [{ author: 'owner', body: 'looks fine to me' }] })
    expect(result.granted).toBe(false)
    expect(result.granted === false && result.reason).toContain('no ME_CAP_OVERRIDE_V1')
  })

  it('takes the latest expiry when several valid overrides exist', () => {
    const later = { ...valid, expires_at: iso(NOW_MS + 2 * 60 * 60 * 1000) }
    const result = selectCapOverride({ ...base, comments: [comment('owner', valid), comment('owner', later)] })
    expect(result.granted && result.record.expires_at).toBe(later.expires_at)
  })
})
