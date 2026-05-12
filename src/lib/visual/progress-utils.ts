import { GENERATION_STAGES } from './generation-config'

/**
 * Calculate progress percentage (0-95%) based on elapsed time
 * Caps at 95% to avoid showing "complete" while still processing
 */
export function getProgressPercent(
  elapsedMs: number,
  expectedMs: number,
): number {
  if (elapsedMs <= 0) return 0
  if (expectedMs <= 0) return 0

  const rawPercent = (elapsedMs / expectedMs) * 100
  return Math.min(rawPercent, 95)
}

/**
 * Format milliseconds into readable countdown format: "Xm Ys" or "Xs"
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${seconds}s`
}

/**
 * Get current stage key based on elapsed seconds
 * Cycles through GENERATION_STAGES every 30 seconds
 */
export function getStageKey(elapsedSeconds: number): string {
  const stageIndex = Math.floor(elapsedSeconds / 30) % GENERATION_STAGES.length
  return GENERATION_STAGES[stageIndex].key
}

/**
 * Check if cancel button should be enabled
 * Enabled when elapsed time exceeds 1.5x the expected generation time.
 * Returns false conservatively when expectedMs is 0 or negative.
 */
export function shouldEnableCancelButton(
  elapsedMs: number,
  expectedMs: number,
): boolean {
  if (expectedMs <= 0) return false
  const threshold = expectedMs * 1.5
  return elapsedMs >= threshold
}
