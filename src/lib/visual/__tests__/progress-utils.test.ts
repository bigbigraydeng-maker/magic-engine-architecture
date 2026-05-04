import {
  getProgressPercent,
  formatCountdown,
  getStageKey,
  shouldEnableCancelButton,
} from '../progress-utils'
import { GENERATION_STAGES } from '../generation-config'

describe('progress-utils', () => {
  describe('getProgressPercent', () => {
    it('should return 0% at start (0ms elapsed)', () => {
      const percent = getProgressPercent(0, 180000) // 3 min expected
      expect(percent).toBe(0)
    })

    it('should return proportional progress based on elapsed time', () => {
      const percent = getProgressPercent(90000, 180000) // 1.5 min / 3 min
      expect(percent).toBeCloseTo(50, 1)
    })

    it('should cap at 95% to avoid showing 100% while still processing', () => {
      const percent = getProgressPercent(180000, 180000) // elapsed = expected
      expect(percent).toBeLessThanOrEqual(95)
      expect(percent).toBeGreaterThan(90)
    })

    it('should cap at 95% even when elapsed exceeds expected time', () => {
      const percent = getProgressPercent(240000, 180000) // 4 min / 3 min expected
      expect(percent).toBeLessThanOrEqual(95)
    })

    it('should return 0% for negative elapsed time (edge case)', () => {
      const percent = getProgressPercent(-1000, 180000)
      expect(percent).toBe(0)
    })
  })

  describe('formatCountdown', () => {
    it('should format seconds correctly', () => {
      const result = formatCountdown(45000) // 45 seconds
      expect(result).toBe('45s')
    })

    it('should format minutes and seconds', () => {
      const result = formatCountdown(125000) // 2 min 5 sec
      expect(result).toMatch(/^[0-9]+m [0-9]+s$/)
    })

    it('should handle 1 minute exactly', () => {
      const result = formatCountdown(60000)
      expect(result).toBe('1m 0s')
    })

    it('should handle very small values', () => {
      const result = formatCountdown(1000) // 1 second
      expect(result).toBe('1s')
    })

    it('should handle zero milliseconds', () => {
      const result = formatCountdown(0)
      expect(result).toBe('0s')
    })

    it('should handle large durations (hours)', () => {
      const result = formatCountdown(7200000) // 2 hours
      expect(result).toMatch(/^\d+m \d+s$/)
    })
  })

  describe('getStageKey', () => {
    it('should return first stage at 0-29 seconds', () => {
      const key = getStageKey(0)
      expect(key).toBe('initializing')

      const key15 = getStageKey(15)
      expect(key15).toBe('initializing')

      const key29 = getStageKey(29)
      expect(key29).toBe('initializing')
    })

    it('should progress through stages every 30 seconds', () => {
      const key0 = getStageKey(0)
      const key30 = getStageKey(30)
      const key60 = getStageKey(60)
      const key90 = getStageKey(90)

      expect(key0).not.toBe(key30)
      expect(key30).not.toBe(key60)
      expect(key60).not.toBe(key90)
    })

    it('should cycle back to first stage after all stages', () => {
      const lastStageTime = (GENERATION_STAGES.length - 1) * 30
      const nextCycleTime = lastStageTime + 30

      const lastKey = getStageKey(lastStageTime)
      const nextKey = getStageKey(nextCycleTime)

      expect(nextKey).toBe(getStageKey(0)) // Should cycle back
    })
  })

  describe('shouldEnableCancelButton', () => {
    it('should return false before 1.5x expected time (image: 3 min)', () => {
      const shouldEnable = shouldEnableCancelButton(
        200000, // 200 sec elapsed
        180000, // 180 sec (3 min) expected
      )
      expect(shouldEnable).toBe(false) // 200 < 270 (1.5 * 180)
    })

    it('should return true at 1.5x expected time', () => {
      const shouldEnable = shouldEnableCancelButton(
        270000, // 270 sec = exactly 1.5x
        180000, // 180 sec expected
      )
      expect(shouldEnable).toBe(true)
    })

    it('should return true after 1.5x expected time', () => {
      const shouldEnable = shouldEnableCancelButton(
        300000, // 300 sec (well over 1.5x)
        180000, // 180 sec expected
      )
      expect(shouldEnable).toBe(true)
    })

    it('should handle video (4 min expected)', () => {
      const videoExpected = 240000
      const beforeThreshold = shouldEnableCancelButton(359999, videoExpected) // < 1.5x
      const atThreshold = shouldEnableCancelButton(360000, videoExpected) // = 1.5x

      expect(beforeThreshold).toBe(false)
      expect(atThreshold).toBe(true)
    })

    it('should handle avatar (2 min expected)', () => {
      const avatarExpected = 120000
      const beforeThreshold = shouldEnableCancelButton(179999, avatarExpected)
      const atThreshold = shouldEnableCancelButton(180000, avatarExpected)

      expect(beforeThreshold).toBe(false)
      expect(atThreshold).toBe(true)
    })
  })
})
