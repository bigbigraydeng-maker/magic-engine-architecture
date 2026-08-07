/**
 * Scripted reviewer for tests and dry-runs. Never touches the network.
 *
 * Outputs are `unknown` on purpose so a test can feed schema-invalid data and
 * prove the runner refuses to advance on it. `telemetry` is scripted separately
 * from `output` for the same reason the real adapter keeps them apart: a test
 * must be able to make the model claim one thing while the record says another.
 */

import type {
  ProviderTelemetry,
  ProviderTurnResult,
  ProviderUsage,
  ReviewerProvider,
  TurnRequest,
} from '../provider-types'

export interface MockReviewerStep {
  output: unknown
  usage?: Partial<ProviderUsage>
  telemetry?: Partial<ProviderTelemetry>
  /** Milliseconds to "spend" before returning. Used to exercise the hard timeout. */
  delayMs?: number
  /** Throw instead of returning, to exercise the provider-error path. */
  throws?: string
}

const DEFAULT_USAGE: ProviderUsage = { input_tokens: 1200, output_tokens: 400, cost_usd: 0.05 }
const DEFAULT_TELEMETRY: ProviderTelemetry = { tools_used: [], source: 'mock:scripted' }

export class MockReviewerProvider implements ReviewerProvider {
  readonly name = 'mock-reviewer'
  readonly requests: TurnRequest[] = []

  callCount = 0

  constructor(private readonly script: readonly MockReviewerStep[]) {}

  async review(request: TurnRequest): Promise<ProviderTurnResult> {
    this.requests.push(request)
    const step = this.script[Math.min(this.callCount, this.script.length - 1)]
    this.callCount += 1

    if (!step) throw new Error('MockReviewerProvider was called with an empty script')
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs))
    if (step.throws) throw new Error(step.throws)

    return {
      output: step.output,
      usage: { ...DEFAULT_USAGE, ...step.usage },
      model: 'mock-gpt',
      provider: this.name,
      telemetry: { ...DEFAULT_TELEMETRY, ...step.telemetry },
    }
  }
}
