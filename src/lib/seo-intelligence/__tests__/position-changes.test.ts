import { describe, expect, it } from 'vitest'
import {
  calculatePositionChanges,
  type KeywordSnapshotForChange,
} from '../position-changes'

function row(
  keyword: string,
  position: number | null,
  snapshotDate: string,
  overrides: Partial<KeywordSnapshotForChange> = {},
): KeywordSnapshotForChange {
  return {
    keyword,
    position,
    snapshot_date: snapshotDate,
    search_volume: 100,
    keyword_difficulty: 25,
    intent: 'commercial',
    ...overrides,
  }
}

describe('calculatePositionChanges', () => {
  it('classifies new, lost, improved, and declined keywords', () => {
    const result = calculatePositionChanges([
      row('new tours', 8, '2026-05-23'),
      row('better tours', 3, '2026-05-23'),
      row('worse tours', 15, '2026-05-23'),
      row('same tours', 9, '2026-05-23'),
    ], [
      row('lost tours', 12, '2026-05-16'),
      row('better tours', 10, '2026-05-16'),
      row('worse tours', 6, '2026-05-16'),
      row('same tours', 9, '2026-05-16'),
    ])

    expect(result.current_date).toBe('2026-05-23')
    expect(result.previous_date).toBe('2026-05-16')
    expect(result.summary).toEqual({
      new: 1,
      lost: 1,
      improved: 1,
      declined: 1,
    })
    expect(result.changes.map(change => change.change_type)).toEqual([
      'new',
      'improved',
      'declined',
      'lost',
    ])
  })

  it('uses positive position_delta for improvements and negative for declines', () => {
    const result = calculatePositionChanges([
      row('improved keyword', 4, '2026-05-23'),
      row('declined keyword', 11, '2026-05-23'),
    ], [
      row('improved keyword', 9, '2026-05-16'),
      row('declined keyword', 7, '2026-05-16'),
    ])

    expect(result.changes.find(c => c.keyword === 'improved keyword')).toMatchObject({
      change_type: 'improved',
      previous_position: 9,
      current_position: 4,
      position_delta: 5,
    })
    expect(result.changes.find(c => c.keyword === 'declined keyword')).toMatchObject({
      change_type: 'declined',
      previous_position: 7,
      current_position: 11,
      position_delta: -4,
    })
  })

  it('ignores unchanged or unknown-position rows', () => {
    const result = calculatePositionChanges([
      row('same keyword', 5, '2026-05-23'),
      row('unknown keyword', null, '2026-05-23'),
    ], [
      row('same keyword', 5, '2026-05-16'),
      row('unknown keyword', 8, '2026-05-16'),
    ])

    expect(result.summary).toEqual({
      new: 0,
      lost: 0,
      improved: 0,
      declined: 0,
    })
    expect(result.changes).toEqual([])
  })

  it('sorts changes by actionability and movement size', () => {
    const result = calculatePositionChanges([
      row('small improvement', 8, '2026-05-23', { search_volume: 900 }),
      row('big improvement', 2, '2026-05-23', { search_volume: 50 }),
    ], [
      row('small improvement', 10, '2026-05-16', { search_volume: 900 }),
      row('big improvement', 20, '2026-05-16', { search_volume: 50 }),
    ])

    expect(result.changes.map(change => change.keyword)).toEqual([
      'big improvement',
      'small improvement',
    ])
  })
})
