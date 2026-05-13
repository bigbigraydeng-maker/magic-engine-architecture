/**
 * P9.0.12 — generation-config.test.ts
 * Tests getCancelThresholdMs and getStagesForType.
 * No mocks — imports real implementations.
 */

import { getCancelThresholdMs, getStagesForType } from '../generation-config'

describe('getCancelThresholdMs', () => {
  it('wavespeed image → 270000ms (1.5 × 180s)', () => {
    expect(getCancelThresholdMs('wavespeed', 'image')).toBe(270000)
  })

  it('seedance video → 360000ms (1.5 × 240s)', () => {
    expect(getCancelThresholdMs('seedance', 'video')).toBe(360000)
  })

  it('heygen avatar_video → 180000ms (1.5 × 120s)', () => {
    expect(getCancelThresholdMs('heygen', 'avatar_video')).toBe(180000)
  })
})

describe('getStagesForType', () => {
  it('image type has 4 stages', () => {
    expect(getStagesForType('image')).toHaveLength(4)
  })

  it('image type first stage key is "initializing"', () => {
    expect(getStagesForType('image')[0].key).toBe('initializing')
  })

  it('video type second stage label is "Generating frames…"', () => {
    expect(getStagesForType('video')[1].label).toBe('Generating frames…')
  })

  it('avatar_video type second stage label is "Processing avatar…"', () => {
    expect(getStagesForType('avatar_video')[1].label).toBe('Processing avatar…')
  })
})
