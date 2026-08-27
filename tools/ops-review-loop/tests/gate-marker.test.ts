/**
 * The gate marker: the record that says "this level was computed from this
 * exact diff".
 *
 * Two things are being defended here.
 *
 *  1. **Staleness.** A rating that outlives the diff it describes is worse than
 *     no rating, because it looks like due diligence. `isGateCurrent` is the
 *     only thing standing between "Codex approved it" and "Codex approved
 *     something else".
 *  2. **The transport.** The payload is embedded in an HTML comment and carries
 *     file paths taken from the PR. If one of those can contain `-->`, the
 *     marker can be truncated — and a truncated marker either vanishes or, far
 *     worse, leaves an attacker-chosen tail rendered as PR text. So the escape
 *     is tested with a payload that actively tries to close the comment.
 */

import { describe, expect, it } from 'vitest'

import {
  GATE_MARKER_VERSION,
  buildGateMarker,
  findGateFor,
  isGateCurrent,
  parseGateMarkers,
} from '../src/gate-marker.mjs'

const BASE = 'd8ee449d13f7632e2f67234a22d00a1b76175b9b'
const HEAD = '7a1527bc3b2e5a064815d761ecea7e27848c3108'

describe('build and parse round-trip', () => {
  it('carries level, both shas and the reasons', () => {
    const marker = buildGateMarker({
      base: BASE,
      head: HEAD,
      risk: 'A',
      reasons: ['supabase/migrations/x.sql —— A 级（migration）'],
    })
    const [parsed] = parseGateMarkers([marker])
    expect(parsed).toMatchObject({
      v: GATE_MARKER_VERSION,
      base: BASE,
      head: HEAD,
      risk: 'A',
      reasons: ['supabase/migrations/x.sql —— A 级（migration）'],
    })
  })

  it('matches the documented marker shape', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'C', reasons: [] })
    expect(marker.startsWith('<!-- me-dev-gate:{')).toBe(true)
    expect(marker.endsWith('} -->')).toBe(true)
  })

  it('carries the optional score and decision when they exist', () => {
    const marker = buildGateMarker({
      base: BASE,
      head: HEAD,
      risk: 'B',
      score: 88,
      decision: 'READY_FOR_PRODUCT_OWNER',
    })
    const [parsed] = parseGateMarkers([marker])
    expect(parsed.score).toBe(88)
    expect(parsed.decision).toBe('READY_FOR_PRODUCT_OWNER')
  })

  it('omits score entirely when it was not measured — null would read as zero', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'B' })
    const [parsed] = parseGateMarkers([marker])
    expect('score' in parsed).toBe(false)
    expect('decision' in parsed).toBe(false)
  })

  it('finds several markers across several comment bodies, in order', () => {
    const a = buildGateMarker({ base: BASE, head: 'a'.repeat(40), risk: 'C' })
    const b = buildGateMarker({ base: BASE, head: 'b'.repeat(40), risk: 'B' })
    const parsed = parseGateMarkers([`text\n${a}\nmore`, null, `${b}`])
    expect(parsed.map((m: { risk: string }) => m.risk)).toEqual(['C', 'B'])
  })
})

describe('a reason cannot close the HTML comment it lives in', () => {
  const HOSTILE = 'evil--> visible text <!-- me-dev-gate:{"v":1,"base":"x","head":"x","risk":"C"}'

  it('emits no raw comment delimiter anywhere but the ends', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'A', reasons: [HOSTILE] })
    expect(marker.indexOf('-->')).toBe(marker.length - 3)
    expect(marker.indexOf('<!--')).toBe(0)
  })

  it('still parses to exactly one marker with the hostile text intact as data', () => {
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'A', reasons: [HOSTILE] })
    const parsed = parseGateMarkers([marker])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].risk).toBe('A')
    expect(parsed[0].head).toBe(HEAD)
    expect(parsed[0].reasons[0]).toBe(HOSTILE)
  })

  it('is not fooled by a forged marker smuggled through a reason', () => {
    // The forged payload inside HOSTILE claims risk C. If the escape leaked, a
    // second marker would appear and a "last one wins" reader would take it.
    const marker = buildGateMarker({ base: BASE, head: HEAD, risk: 'A', reasons: [HOSTILE] })
    const parsed = parseGateMarkers([marker])
    expect(parsed.map((m: { risk: string }) => m.risk)).toEqual(['A'])
  })
})

describe('malformed input is skipped, not thrown on', () => {
  it.each([
    ['not JSON', '<!-- me-dev-gate:{nope} -->'],
    ['wrong version', '<!-- me-dev-gate:{"v":99,"base":"a","head":"b","risk":"A"} -->'],
    ['missing head', '<!-- me-dev-gate:{"v":1,"base":"a","risk":"A"} -->'],
    ['risk not a string', '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":3} -->'],
    ['a different marker family', '<!-- ops-codex-loop:stage=ready pr=1 sha=abcdef1 -->'],
  ])('%s yields nothing', (_label, body) => {
    expect(parseGateMarkers([body])).toEqual([])
  })

  it('does not let one corrupted comment hide a valid marker', () => {
    const good = buildGateMarker({ base: BASE, head: HEAD, risk: 'B' })
    expect(parseGateMarkers(['<!-- me-dev-gate:{broken -->', good])).toHaveLength(1)
  })

  it('tolerates junk input types', () => {
    expect(parseGateMarkers(undefined)).toEqual([])
    expect(parseGateMarkers([undefined, null, 42])).toEqual([])
  })

  it('drops non-string reasons rather than carrying them forward', () => {
    const parsed = parseGateMarkers([
      '<!-- me-dev-gate:{"v":1,"base":"a","head":"b","risk":"A","reasons":["ok",7,null]} -->',
    ])
    expect(parsed[0].reasons).toEqual(['ok'])
  })
})

describe('the rating dies when the diff moves', () => {
  const gate = { base: BASE, head: HEAD }

  it('is current for the exact pair it was computed from', () => {
    expect(isGateCurrent(gate, { base: BASE, head: HEAD })).toBe(true)
  })

  it('is stale the moment the head moves — this is the "旧批准立即失效" rule', () => {
    expect(isGateCurrent(gate, { base: BASE, head: 'f'.repeat(40) })).toBe(false)
  })

  it('is stale when the base moves, even if the head did not', () => {
    // A base-branch merge changes what base..head contains without touching the
    // head sha. Binding only the head would call that rating still valid.
    expect(isGateCurrent(gate, { base: 'e'.repeat(40), head: HEAD })).toBe(false)
  })

  it('is stale against nothing at all', () => {
    expect(isGateCurrent(null, { base: BASE, head: HEAD })).toBe(false)
    expect(isGateCurrent(gate, undefined)).toBe(false)
  })
})

describe('findGateFor', () => {
  it('returns null when no rating covers this diff', () => {
    const markers = parseGateMarkers([buildGateMarker({ base: BASE, head: 'a'.repeat(40), risk: 'C' })])
    expect(findGateFor({ markers, base: BASE, head: HEAD })).toBeNull()
  })

  it('takes the most recent rating for the pair, so a re-run supersedes', () => {
    const markers = parseGateMarkers([
      buildGateMarker({ base: BASE, head: HEAD, risk: 'C' }),
      buildGateMarker({ base: BASE, head: HEAD, risk: 'A' }),
    ])
    expect(findGateFor({ markers, base: BASE, head: HEAD })?.risk).toBe('A')
  })

  it('ignores ratings for other shas entirely', () => {
    const markers = parseGateMarkers([
      buildGateMarker({ base: BASE, head: 'a'.repeat(40), risk: 'A' }),
      buildGateMarker({ base: BASE, head: HEAD, risk: 'C' }),
      buildGateMarker({ base: BASE, head: 'b'.repeat(40), risk: 'A' }),
    ])
    expect(findGateFor({ markers, base: BASE, head: HEAD })?.risk).toBe('C')
  })

  it('tolerates junk input', () => {
    expect(findGateFor({ markers: undefined, base: BASE, head: HEAD })).toBeNull()
  })
})
