/**
 * Generation Queue & Timeout Configuration
 * Controls concurrent generation limits, polling behavior, timeout protection,
 * and intelligent retry logic for image/video/avatar generation.
 */

export const GENERATION_CONFIG = {
  // Queue settings
  MAX_CONCURRENT_GENERATIONS: 2, // Maximum concurrent generation jobs
  POLLING_INTERVAL_MS: 5000, // Poll provider status every 5 seconds

  // Timeout settings
  POLLING_TIMEOUT_MS: 60 * 60 * 1000, // 60 minutes timeout for polling
  WARNING_TIMEOUT_MS: 45 * 60 * 1000, // 45 minutes warning threshold
  PROVIDER_HARD_TIMEOUT_MS: 12 * 60 * 60 * 1000, // 12 hours (matches cron job)

  // Retry settings
  AUTO_RETRY_ENABLED: true,
  MAX_AUTO_RETRIES: 3,
  RETRY_DELAYS_MS: [
    1 * 60 * 1000, // 1 minute delay for first retry
    5 * 60 * 1000, // 5 minutes delay for second retry
    15 * 60 * 1000, // 15 minutes delay for third retry
  ],

  // Cost limits (for future billing controls)
  MAX_COST_PER_GENERATION_USD: 0.50,
} as const

/**
 * Represents a single item in the generation queue
 */
export interface GenerationQueueItem {
  postId: string
  assetId: string
  assetType: 'image' | 'video' | 'avatar_video'
  startedAt: number // Timestamp when generation started
  retryCount: number // Number of retry attempts
  status: 'queued' | 'generating' | 'ready' | 'failed' | 'timeout'
  errorMessage?: string
  errorCode?: string
  costUsd?: number
  stage?: string // Current generation stage (e.g., "Initialising...")
  elapsed?: number // Seconds elapsed since start
  estimatedRemainingMs?: number // Estimated time remaining
}

/**
 * Complete state of the generation queue
 */
export interface GenerationQueueState {
  queue: GenerationQueueItem[] // Pending items waiting to start
  activeGenerations: Record<string, GenerationQueueItem> // Currently generating items
}

/**
 * Callbacks for queue state changes
 */
export interface GenerationQueueCallbacks {
  onStatusChange?: (postId: string, state: GenerationQueueItem) => void
  onQueueChange?: (queue: GenerationQueueState) => void
  onTimeout?: (postId: string, elapsedMs: number) => void
  onAutoRetry?: (postId: string, retryCount: number, delayMs: number) => void
}

/**
 * Error response from generation API
 */
export interface GenerationErrorResponse {
  code:
    | 'provider_error'
    | 'timeout'
    | 'invalid_input'
    | 'quota_exceeded'
    | 'auth_failed'
    | 'network_error'
  message: string
  retryEligible: boolean
  suggestedAction?: string
}

/**
 * Get the next retry delay based on retry count
 */
export function getRetryDelay(retryCount: number): number {
  if (retryCount >= GENERATION_CONFIG.RETRY_DELAYS_MS.length) {
    return GENERATION_CONFIG.RETRY_DELAYS_MS[
      GENERATION_CONFIG.RETRY_DELAYS_MS.length - 1
    ]
  }
  return GENERATION_CONFIG.RETRY_DELAYS_MS[retryCount]
}

/**
 * Check if a generation can be automatically retried
 */
export function canAutoRetry(retryCount: number): boolean {
  return (
    GENERATION_CONFIG.AUTO_RETRY_ENABLED &&
    retryCount < GENERATION_CONFIG.MAX_AUTO_RETRIES
  )
}

/**
 * Format elapsed time for display
 */
export function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Get stages for generation progress display
 */
export const GENERATION_STAGES = [
  'Initialising…',
  'Generating concept…',
  'Rendering pixels…',
  'Finalising…',
] as const

/**
 * Get current stage based on elapsed time
 */
export function getCurrentStage(elapsedSeconds: number): string {
  const stageIndex = Math.floor(elapsedSeconds / 30) % GENERATION_STAGES.length
  return GENERATION_STAGES[stageIndex]
}

/**
 * Get estimated remaining time (heuristic based on provider)
 */
export function getEstimatedRemainingMs(
  elapsedMs: number,
  provider: 'wavespeed' | 'seedance' | 'heygen'
): number | undefined {
  // Typical generation times (in milliseconds)
  const typicalDurations = {
    wavespeed: 180 * 1000, // ~3 minutes for Flux-dev
    seedance: 240 * 1000, // ~4 minutes for Seedance
    heygen: 120 * 1000, // ~2 minutes for HeyGen
  }

  const typicalMs = typicalDurations[provider]
  const remaining = Math.max(0, typicalMs - elapsedMs)
  return remaining > 0 ? remaining : undefined
}
