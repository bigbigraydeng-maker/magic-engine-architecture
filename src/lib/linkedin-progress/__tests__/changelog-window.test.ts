import { describe, it, expect } from 'vitest'
import {
  parseChangelog,
  nzWeekday,
  nzDateString,
  changelogCutoffDate,
  changelogWindowEnd,
  entriesSince,
} from '../changelog-window'

describe('parseChangelog', () => {
  it('parses a single dated entry', () => {
    const raw = '### 2026-08-04（补一层保护）\nsome body text\nmore body\n'
    const entries = parseChangelog(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0].date).toBe('2026-08-04')
    expect(entries[0].heading).toContain('补一层保护')
    expect(entries[0].body).toContain('some body text')
  })

  it('collects ALL entries for the same date, not just the first (real CHANGELOG.md has same-day repeats)', () => {
    const raw = [
      '### 2026-08-03（第一条）',
      'body one',
      '### 2026-08-03（第二条）',
      'body two',
    ].join('\n')
    const entries = parseChangelog(raw)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.heading)).toEqual(
      expect.arrayContaining([expect.stringContaining('第一条'), expect.stringContaining('第二条')]),
    )
  })

  it('handles "（续）" continuation-suffix headings', () => {
    const raw = '### 2026-05-21（续 2）\ncontinuation body\n'
    const entries = parseChangelog(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0].heading).toContain('续 2')
  })

  it('does not rely on file position/order — out-of-order dates still parse correctly', () => {
    const raw = [
      '### 2026-06-01 (earlier in file, later date)',
      'body A',
      '### 2026-04-30 (later in file, earlier date)',
      'body B',
    ].join('\n')
    const entries = parseChangelog(raw)
    const byDate = new Map(entries.map((e) => [e.date, e]))
    expect(byDate.get('2026-06-01')?.body).toBe('body A')
    expect(byDate.get('2026-04-30')?.body).toBe('body B')
  })

  it('skips entries whose body looks corrupted (real mojibake found in CHANGELOG.md history)', () => {
    const corruptBody = 'Website SEO Service Page Map \x93\x94\x92\x91\x90\x8f\x8e\x8d\x8c\x8b\x8a\x89 done'
    const raw = [
      '### 2026-06-01 (corrupted heading text)',
      corruptBody,
      '### 2026-06-02 (clean entry)',
      'this one is fine',
    ].join('\n')
    const entries = parseChangelog(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0].date).toBe('2026-06-02')
  })

  it('drops entries with an empty body (heading with no content)', () => {
    const raw = '### 2026-08-04\n\n### 2026-08-05\nreal content\n'
    const entries = parseChangelog(raw)
    expect(entries).toHaveLength(1)
    expect(entries[0].date).toBe('2026-08-05')
  })
})

describe('nzWeekday / nzDateString — NZ-local time, not server-local', () => {
  it('converts a UTC evening timestamp to the correct NZ-local next day', () => {
    // 2026-08-17T20:30:00Z is a Monday in UTC, but NZ is UTC+12 in August
    // (NZST, no daylight saving) — local NZ time is 2026-08-18 08:30, a Tuesday.
    // A server running in UTC computing "today's weekday" naively would get
    // this wrong; nzWeekday must not.
    const d = new Date('2026-08-17T20:30:00Z')
    expect(nzWeekday(d)).toBe(2) // Tuesday
    expect(nzDateString(d)).toBe('2026-08-18')
  })

  it('a UTC morning timestamp on the same NZ calendar day maps correctly', () => {
    const d = new Date('2026-08-18T01:00:00Z') // 2026-08-18 13:00 NZST
    expect(nzWeekday(d)).toBe(2) // Tuesday
    expect(nzDateString(d)).toBe('2026-08-18')
  })
})

describe('changelogCutoffDate / changelogWindowEnd — lookback window keyed by NZ weekday', () => {
  it('Monday NZ: cutoff = last Wednesday, window end = yesterday (Sunday)', () => {
    // 2026-08-17 08:30 NZST is a Monday (2026-08-16T20:30:00Z in UTC).
    const monday = new Date('2026-08-16T20:30:00Z')
    expect(nzWeekday(monday)).toBe(1)
    expect(changelogCutoffDate(monday)).toBe('2026-08-12') // previous Wednesday
    expect(changelogWindowEnd(monday)).toBe('2026-08-16') // yesterday = Sunday
  })

  it('Thursday NZ: cutoff = last Sunday, window end = yesterday (Wednesday)', () => {
    const thursday = new Date('2026-08-19T20:30:00Z') // 2026-08-20 08:30 NZST = Thursday
    expect(nzWeekday(thursday)).toBe(4)
    expect(changelogCutoffDate(thursday)).toBe('2026-08-16') // previous Sunday
    expect(changelogWindowEnd(thursday)).toBe('2026-08-19') // yesterday = Wednesday
  })
})

describe('entriesSince', () => {
  it('keeps entries strictly after the cutoff and on or before the window end', () => {
    const entries = [
      { date: '2026-08-10', heading: 'a', body: 'a' },
      { date: '2026-08-12', heading: 'b', body: 'b' },
      { date: '2026-08-16', heading: 'c', body: 'c' },
      { date: '2026-08-17', heading: 'd (today, not yet over)', body: 'd' },
    ]
    const kept = entriesSince(entries, '2026-08-12', '2026-08-16')
    expect(kept.map((e) => e.date)).toEqual(['2026-08-16'])
  })

  it('regression: consecutive Monday and Thursday windows tile the week exactly — no gaps, no overlaps', () => {
    // Real bug caught in review: with the OLD boundary (window end = today,
    // inclusive), an entry dated the run's own calendar day but added AFTER
    // that run fired would be lost forever — excluded from that run (already
    // ran) and excluded from the next run (its cutoff is keyed to that same
    // date). Model both runs as they'd actually happen, with an entry landing
    // on each run's own day.
    const monday = new Date('2026-08-16T20:30:00Z') // NZ Monday 2026-08-17
    const thursday = new Date('2026-08-19T20:30:00Z') // NZ Thursday 2026-08-20

    const mondayCutoff = changelogCutoffDate(monday)
    const mondayWindowEnd = changelogWindowEnd(monday)
    const thursdayCutoff = changelogCutoffDate(thursday)
    const thursdayWindowEnd = changelogWindowEnd(thursday)

    const entriesAsOfMonday = [
      { date: '2026-08-14', heading: 'fri', body: '' },
      { date: '2026-08-17', heading: 'monday itself, added after the cron fired', body: '' },
    ]
    const entriesAsOfThursday = [
      ...entriesAsOfMonday,
      { date: '2026-08-19', heading: 'wed', body: '' },
      { date: '2026-08-20', heading: 'thursday itself, added after the cron fired', body: '' },
    ]

    const mondayWindow = entriesSince(entriesAsOfMonday, mondayCutoff, mondayWindowEnd).map((e) => e.date)
    const thursdayWindow = entriesSince(entriesAsOfThursday, thursdayCutoff, thursdayWindowEnd).map((e) => e.date)

    // Monday's own date isn't final yet when Monday's cron fires — it rolls
    // to Thursday's run instead of being lost.
    expect(mondayWindow).not.toContain('2026-08-17')
    expect(thursdayWindow).toContain('2026-08-17')
    // Same story one cycle later: Thursday's own date isn't in Thursday's
    // window, but would be picked up by the NEXT Monday run (not modelled
    // here — this test only needs to show it's not silently dropped by
    // Thursday's own run).
    expect(thursdayWindow).not.toContain('2026-08-20')
    // No day is ever claimed by both runs.
    expect(mondayWindow.filter((d) => thursdayWindow.includes(d))).toEqual([])
  })
})
