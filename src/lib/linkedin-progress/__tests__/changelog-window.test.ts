import { describe, it, expect } from 'vitest'
import {
  parseChangelog,
  nzWeekday,
  nzDateString,
  changelogCutoffDate,
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

describe('changelogCutoffDate — lookback window keyed by NZ weekday', () => {
  it('Monday NZ looks back 4 days (covers last Thursday through today)', () => {
    // 2026-08-17 08:30 NZST is a Monday (2026-08-16T20:30:00Z in UTC).
    const monday = new Date('2026-08-16T20:30:00Z')
    expect(nzWeekday(monday)).toBe(1)
    expect(changelogCutoffDate(monday)).toBe('2026-08-13') // previous Thursday
  })

  it('Thursday NZ looks back 3 days (covers last Monday through today)', () => {
    const thursday = new Date('2026-08-19T20:30:00Z') // 2026-08-20 08:30 NZST = Thursday
    expect(nzWeekday(thursday)).toBe(4)
    expect(changelogCutoffDate(thursday)).toBe('2026-08-17') // previous Monday
  })
})

describe('entriesSince', () => {
  it('keeps entries strictly after the cutoff and drops the cutoff day itself', () => {
    // The cutoff day was already reported by the run that owned it as "today" —
    // an inclusive >= here would double-report it across two consecutive posts.
    const entries = [
      { date: '2026-08-10', heading: 'a', body: 'a' },
      { date: '2026-08-13', heading: 'b', body: 'b' },
      { date: '2026-08-17', heading: 'c', body: 'c' },
    ]
    const kept = entriesSince(entries, '2026-08-13')
    expect(kept.map((e) => e.date)).toEqual(['2026-08-17'])
  })

  it('regression: consecutive Monday and Thursday windows never share a day', () => {
    // Real bug caught in review: Monday's cutoff is last Thursday, and
    // Thursday's cutoff is this Monday — with an inclusive boundary, the
    // day that is simultaneously "this run's own today" and "the next run's
    // cutoff" would be reported twice. Model the two runs as they'd actually
    // happen: Monday's run only sees entries that exist as of Monday; new
    // entries land in the days between the two runs, same as a real repo.
    const monday = new Date('2026-08-16T20:30:00Z') // NZ Monday 2026-08-17
    const thursday = new Date('2026-08-19T20:30:00Z') // NZ Thursday 2026-08-20

    const mondayCutoff = changelogCutoffDate(monday)
    const thursdayCutoff = changelogCutoffDate(thursday)

    const entriesAsOfMonday = [
      { date: '2026-08-14', heading: 'fri', body: '' },
      { date: '2026-08-17', heading: 'the boundary day (Monday itself)', body: '' },
    ]
    const entriesAsOfThursday = [
      ...entriesAsOfMonday,
      { date: '2026-08-19', heading: 'wed', body: '' },
      { date: '2026-08-20', heading: 'the boundary day (Thursday itself)', body: '' },
    ]

    const mondayWindow = entriesSince(entriesAsOfMonday, mondayCutoff).map((e) => e.date)
    const thursdayWindow = entriesSince(entriesAsOfThursday, thursdayCutoff).map((e) => e.date)

    expect(mondayWindow).toContain('2026-08-17')
    expect(thursdayWindow).not.toContain('2026-08-17') // already reported by Monday's run
    expect(thursdayWindow).toContain('2026-08-20')
    expect(mondayWindow.filter((d) => thursdayWindow.includes(d))).toEqual([])
  })
})
