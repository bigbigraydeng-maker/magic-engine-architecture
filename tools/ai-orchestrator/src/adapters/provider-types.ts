/**
 * Provider contracts.
 *
 * Two rules encoded here:
 *
 * 1. **`output` is `unknown`.** The runner is the only place that validates a
 *    provider's output against its schema, so the check cannot be short-circuited
 *    by an adapter that types its own return value.
 * 2. **`telemetry` is not the model talking.** `tools_used` must come from the
 *    execution record — the Claude Code Action's own log, the API's tool-call
 *    list — never from a field the model wrote. An adapter that cannot produce a
 *    real record must say so via `source: 'unavailable'`, and the runner will
 *    fail the turn closed rather than assume compliance.
 */

export interface ProviderUsage {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

/**
 * Execution facts observed by the harness that ran the model.
 *
 * `source` is provenance and is written to the ledger, so a reviewer can see
 * whether a turn's tool list came from a real execution log or from nowhere.
 */
export interface ProviderTelemetry {
  tools_used: readonly string[]
  /** e.g. `claude-code-action:execution-log`, `openai:responses.tool_calls`, `mock:scripted`. */
  source: string
}

/** Marks telemetry an adapter could not obtain. The runner refuses these turns. */
export const TELEMETRY_UNAVAILABLE = 'unavailable'

export interface ProviderTurnResult {
  /** Unvalidated. The runner parses this with the actor's zod schema. */
  output: unknown
  usage: ProviderUsage
  model: string
  provider: string
  telemetry: ProviderTelemetry
}

export interface TurnRequest {
  run_id: string
  round: number
  /** Built from code constants only — never contains untrusted text. */
  system: string
  user: string
  untrusted_sources: readonly string[]
  idempotency_key: string
  /** Digest of (system, user). Content-addressed half of duplicate detection. */
  input_digest: string
  /**
   * Hard wall for this call. Always shorter than the lease TTL, so a lease can
   * never go stale while a call is still in flight — that gap is what would let a
   * second runner start a second paid call.
   */
  timeout_ms: number
  /**
   * Output-token ceiling derived from the remaining budget. A real adapter must
   * pass this to the API so a single call cannot exceed the reservation.
   */
  max_output_tokens: number
  /** Dollars reserved for this call. Actual usage is reconciled against it. */
  reserved_cost_usd: number
}

export interface ReviewerProvider {
  readonly name: string
  review(request: TurnRequest): Promise<ProviderTurnResult>
}

export interface ImplementerProvider {
  readonly name: string
  implement(request: TurnRequest): Promise<ProviderTurnResult>
}

export const ZERO_USAGE: ProviderUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0 }
