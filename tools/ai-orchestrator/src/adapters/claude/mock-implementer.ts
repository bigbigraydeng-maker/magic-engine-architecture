/**
 * Scripted implementer for tests and dry-runs. Never touches the network and
 * never touches the working tree.
 *
 * `sideEffects` is the positive control for the dry-run tests: a real (non
 * dry-run) pass records simulated commits here, so asserting the list is empty in
 * dry-run distinguishes "the provider was never called" from "the provider was
 * called but happened to do nothing".
 */

import type {
  ImplementerProvider,
  ProviderTurnResult,
  ProviderUsage,
  TurnRequest,
} from '../provider-types'

export interface MockImplementerStep {
  output: unknown
  usage?: Partial<ProviderUsage>
}

export interface SimulatedSideEffect {
  kind: 'commit' | 'push' | 'open_draft_pr'
  ref: string
}

const DEFAULT_USAGE: ProviderUsage = { input_tokens: 4000, output_tokens: 1500, cost_usd: 0.2 }

interface CommitEvidenceShape {
  branch?: unknown
  commit_sha?: unknown
  pr_number?: unknown
}

function readCommitEvidence(output: unknown): CommitEvidenceShape | null {
  if (typeof output !== 'object' || output === null) return null
  const evidence = (output as { commit_evidence?: unknown }).commit_evidence
  if (typeof evidence !== 'object' || evidence === null) return null
  return evidence as CommitEvidenceShape
}

export class MockImplementerProvider implements ImplementerProvider {
  readonly name = 'mock-implementer'
  readonly requests: TurnRequest[] = []
  readonly sideEffects: SimulatedSideEffect[] = []

  callCount = 0

  constructor(private readonly script: readonly MockImplementerStep[]) {}

  async implement(request: TurnRequest): Promise<ProviderTurnResult> {
    this.requests.push(request)
    const step = this.script[Math.min(this.callCount, this.script.length - 1)]
    this.callCount += 1

    if (!step) throw new Error('MockImplementerProvider was called with an empty script')

    this.recordSideEffects(step.output)

    return {
      output: step.output,
      usage: { ...DEFAULT_USAGE, ...step.usage },
      model: 'mock-claude',
      provider: this.name,
    }
  }

  private recordSideEffects(output: unknown): void {
    const evidence = readCommitEvidence(output)
    if (!evidence) return

    if (typeof evidence.commit_sha === 'string') {
      this.sideEffects.push({ kind: 'commit', ref: evidence.commit_sha })
    }
    if (typeof evidence.branch === 'string') {
      this.sideEffects.push({ kind: 'push', ref: evidence.branch })
    }
    if (typeof evidence.pr_number === 'number') {
      this.sideEffects.push({ kind: 'open_draft_pr', ref: String(evidence.pr_number) })
    }
  }
}
