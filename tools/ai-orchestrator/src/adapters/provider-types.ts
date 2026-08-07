/**
 * Provider contracts.
 *
 * Both providers return `unknown`. That is deliberate: the runner is the only
 * place that validates a provider's output against its schema, so the check
 * cannot be short-circuited by an adapter that types its own return value.
 */

export interface ProviderUsage {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface ProviderTurnResult {
  /** Unvalidated. The runner parses this with the actor's zod schema. */
  output: unknown
  usage: ProviderUsage
  model: string
  provider: string
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
