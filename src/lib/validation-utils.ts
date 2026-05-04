/**
 * Shared validation utility functions for API routes.
 *
 * Extracted to avoid duplication across blog, opportunities, and other
 * internal API endpoints.
 *
 * Security contract:
 * - requireBearerToken: constant-time comparison to prevent timing attacks
 * - validateEnvVar: throws descriptive error naming the variable, never its value
 * - clampLimit: prevents unbounded DB queries (DoS mitigation)
 *
 * Reference: Phase 7.3 security fix (CRITICAL-1, CRITICAL-2, HIGH-1)
 */

// ─── Bearer Token Auth ────────────────────────────────────────────────────────

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string }

/**
 * Validate the Authorization header against INTERNAL_API_KEY.
 *
 * @param authHeader  The raw value of the Authorization header (may be undefined).
 * @returns           { ok: true } on success, or { ok: false, status, error } on failure.
 *
 * Returns 500 (not 401) when INTERNAL_API_KEY is not configured so that
 * a misconfigured environment is clearly distinguishable from an auth failure.
 * This prevents silent "open door" behaviour when the env var is missing.
 */
export function requireBearerToken(authHeader: string | undefined): AuthResult {
  const configuredKey = process.env.INTERNAL_API_KEY

  if (!configuredKey) {
    return {
      ok: false,
      status: 500,
      error: 'Server configuration error: authentication not available',
    }
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const providedToken = authHeader.slice('Bearer '.length)

  if (!providedToken) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  // Constant-time comparison to prevent timing attacks.
  // timingSafeEqual requires equal-length buffers.
  if (!timingSafeEqual(providedToken, configuredKey)) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  return { ok: true }
}

/**
 * Constant-time string comparison that does not short-circuit on length
 * mismatch (prevents timing oracle on token length).
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Pad the shorter string to equal length so we always do the same work.
  const maxLen = Math.max(a.length, b.length)
  let result = a.length === b.length ? 0 : 1

  for (let i = 0; i < maxLen; i++) {
    const ca = a.charCodeAt(i) || 0
    const cb = b.charCodeAt(i) || 0
    result |= ca ^ cb
  }

  return result === 0
}

// ─── Environment Variable Validation ─────────────────────────────────────────

/**
 * Retrieve a required environment variable, throwing a descriptive error if
 * it is absent or empty. The error message names the variable but never
 * exposes its value.
 *
 * @param name  Environment variable name (e.g. 'SEMRUSH_API_KEY')
 * @returns     The non-empty string value.
 * @throws      Error with message containing the variable name.
 */
export function validateEnvVar(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      'Please configure this variable before starting the server.'
    )
  }

  return value
}

// ─── Query Parameter Clamping ─────────────────────────────────────────────────

export interface ClampLimitOptions {
  /** Value to use when input is absent, zero, or negative. Default: 20. */
  defaultValue?: number
  /** Maximum allowed value. Default: 100. */
  max?: number
}

/**
 * Parse and clamp the ?limit= query parameter to a safe range.
 *
 * Rules:
 * - Missing / empty / NaN / negative / zero → defaultValue (20)
 * - Exceeds max → max (100)
 * - Decimal strings are floored (parseInt behaviour)
 *
 * @param raw     The raw string value from URLSearchParams (may be null/undefined).
 * @param options Override default (20) or max (100).
 * @returns       A positive integer in [1, max].
 */
export function clampLimit(
  raw: string | null | undefined,
  options: ClampLimitOptions = {}
): number {
  const defaultValue = options.defaultValue ?? 20
  const max = options.max ?? 100

  if (raw === null || raw === undefined || raw.trim() === '') {
    return defaultValue
  }

  const parsed = parseInt(raw, 10)

  if (isNaN(parsed) || parsed <= 0) {
    return defaultValue
  }

  return Math.min(parsed, max)
}
