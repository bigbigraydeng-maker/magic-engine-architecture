/**
 * One agent turn, from cost quote to ledger record.
 *
 * The ordering is the safety property:
 *
 *   quote worst-case cost -> reserve -> capture workspace BEFORE
 *   -> call under AbortSignal -> capture workspace AFTER -> diff
 *   -> telemetry -> policy (on the delta) -> integrity -> reconcile cost
 *   -> only now parse and compare what the model said
 *
 * Nothing the model writes can change what the first seven steps conclude.
 */

import { hasTurnBeenProcessed } from './adapters/github/ledger'
import type { CostEstimate, ProviderTurnResult, TurnRequest } from './adapters/provider-types'
import { TELEMETRY_UNAVAILABLE } from './adapters/provider-types'
import { diffWorkspaceStates } from './adapters/workspace/inspector'
import type { TurnDelta, WorkspaceState } from './adapters/workspace/inspector'
import { computeBudgetLedger } from './domain/budget'
import { digest, turnIdempotencyKey } from './domain/digest'
import { nextStateForVerdict } from './domain/state-machine'
import type {
  Actor,
  AuthoritativeTurnFacts,
  ImplementerTurnOutput,
  LedgerEvent,
  ReviewerTurnOutput,
  RunState,
  StopReason,
  TurnRejectionReason,
  WaitDescriptor,
} from './domain/schema'
import { implementerTurnOutputSchema, reviewerTurnOutputSchema } from './domain/schema'
import { compareSelfReport, enforceToolUse, evaluateImplementerTurn } from './policy/policy'
import { buildPromptEnvelope } from './policy/untrusted'
import { IMPLEMENTER_PROMPT_VERSION, IMPLEMENTER_SYSTEM_POLICY } from './prompts/implementer-system.v1'
import { REVIEWER_PROMPT_VERSION, REVIEWER_SYSTEM_POLICY } from './prompts/reviewer-system.v1'
import { applyTurnState, baseEvent, nextWaitId, record } from './runner-context'
import type { RunnerContext } from './runner-types'

// ─────────────────────────────────────────────────────────────────────────────
// Prompt and quote
// ─────────────────────────────────────────────────────────────────────────────

export interface PromptDraft {
  system: string
  user: string
  untrusted_sources: readonly string[]
  input_digest: string
  idempotency_key: string
  max_output_tokens: number
}

/** Everything about a turn that is known before its price is quoted. */
export function draftTurn(ctx: RunnerContext, actor: Actor, round: number): PromptDraft {
  const systemPolicy = actor === 'gpt_reviewer' ? REVIEWER_SYSTEM_POLICY : IMPLEMENTER_SYSTEM_POLICY
  const promptVersion =
    actor === 'gpt_reviewer' ? REVIEWER_PROMPT_VERSION : IMPLEMENTER_PROMPT_VERSION

  const envelope = buildPromptEnvelope({
    systemPolicy,
    task: [
      `Run: ${ctx.run.run_id} · mode ${ctx.run.mode} · round ${round}/${ctx.run.max_rounds}`,
      `Work package: ${ctx.input.authorization.work_package_id}`,
      `Prompt version: ${promptVersion}`,
      '',
      ctx.input.taskBrief,
    ].join('\n'),
    untrusted: ctx.input.untrusted,
  })

  const inputDigest = digest([envelope.system, envelope.user])

  return {
    system: envelope.system,
    user: envelope.user,
    untrusted_sources: envelope.untrusted_sources,
    input_digest: inputDigest,
    idempotency_key: turnIdempotencyKey({
      runId: ctx.run.run_id,
      round,
      actor,
      inputDigest,
    }),
    max_output_tokens: ctx.input.limits.max_output_tokens,
  }
}

export function providerFor(ctx: RunnerContext, actor: Actor) {
  return actor === 'gpt_reviewer' ? ctx.deps.reviewer : ctx.deps.implementer
}

/**
 * How long the provider may still be running and billing after we stop waiting.
 *
 * When the adapter cannot prove it cancels, our timeout bounds nothing, so the
 * claim and the lease have to cover the provider's server-side maximum instead.
 */
export function inFlightWindowMs(ctx: RunnerContext, actor: Actor): number {
  const provider = providerFor(ctx, actor)
  return provider.cancellation.supported
    ? ctx.input.limits.provider_timeout_ms
    : provider.cancellation.server_max_timeout_ms
}

export function finalizeRequest(
  ctx: RunnerContext,
  draft: PromptDraft,
  round: number,
  estimate: CostEstimate,
  signal: AbortSignal
): TurnRequest {
  return {
    run_id: ctx.run.run_id,
    round,
    system: draft.system,
    user: draft.user,
    untrusted_sources: draft.untrusted_sources,
    input_digest: draft.input_digest,
    idempotency_key: draft.idempotency_key,
    timeout_ms: ctx.input.limits.provider_timeout_ms,
    signal,
    max_output_tokens: draft.max_output_tokens,
    reserved_cost_usd: estimate.max_cost_usd,
    cost_estimate: estimate,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rejection
// ─────────────────────────────────────────────────────────────────────────────

async function rejectTurn(
  ctx: RunnerContext,
  args: {
    actor: Actor
    round: number
    request: TurnRequest
    reason: TurnRejectionReason
    detail: string[]
    /** Where the run lands. Same state means "try again"; WAITING_HUMAN means stop. */
    nextState: RunState
    /** What this rejection settles. A timeout settles at the full reservation. */
    costUsd: number
  }
): Promise<void> {
  // Landing on WAITING_HUMAN opens a *named* block. The human authorization that
  // releases it must name this id, so an approval given for an earlier gate
  // cannot silently clear this one.
  const wait: WaitDescriptor | null =
    args.nextState === 'WAITING_HUMAN'
      ? { id: nextWaitId(ctx), blocking_reason: args.reason }
      : null

  ctx.run = {
    ...ctx.run,
    current_round: args.round,
    invalid_output_count:
      ctx.run.invalid_output_count + (args.reason === 'invalid_output' ? 1 : 0),
  }
  const nextState = applyTurnState(ctx, args.nextState)
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_rejected',
    actor: args.actor,
    round: args.round,
    idempotency_key: args.request.idempotency_key,
    input_digest: args.request.input_digest,
    reason: args.reason,
    detail: args.detail,
    wait,
    reserved_cost_usd: args.request.reserved_cost_usd,
    cost_usd: args.costUsd,
    next_state: nextState,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider invocation
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderTimeoutError extends Error {
  constructor(ms: number) {
    super(`provider call exceeded its ${ms}ms timeout and was aborted`)
    this.name = 'ProviderTimeoutError'
  }
}

/**
 * Runs a provider call with a real cancellation signal.
 *
 * v0.2 used `Promise.race` alone and called it a hard timeout. It was not: losing
 * the race only abandons the local `await`, while the HTTP request keeps running
 * and keeps billing. Now an `AbortController` fires, the adapter is contractually
 * required to pass the signal down, and `cancellation.supported` says whether that
 * is actually believed — the runner sizes its lease on the answer.
 */
async function callWithAbort(
  call: (signal: AbortSignal) => Promise<ProviderTurnResult>,
  timeoutMs: number
): Promise<ProviderTurnResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await call(controller.signal)
  } catch (error) {
    if (timedOut) throw new ProviderTimeoutError(timeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Telemetry an adapter could not actually observe is not evidence of compliance. */
function telemetryUsable(result: ProviderTurnResult): boolean {
  return (
    !!result.telemetry &&
    typeof result.telemetry.source === 'string' &&
    result.telemetry.source.length > 0 &&
    result.telemetry.source !== TELEMETRY_UNAVAILABLE &&
    Array.isArray(result.telemetry.tools_used)
  )
}

function checkTelemetry(result: ProviderTurnResult): string | null {
  if (telemetryUsable(result)) return null
  return `provider "${result.provider}" returned no usable execution telemetry (source: ${
    result.telemetry?.source ?? 'absent'
  }); tool use cannot be verified`
}

type InvokeOutcome =
  | { ok: ProviderTurnResult }
  | { failed: { timedOut: boolean; message: string } }

async function invokeProvider(
  call: (signal: AbortSignal) => Promise<ProviderTurnResult>,
  request: TurnRequest
): Promise<InvokeOutcome> {
  try {
    const result = await callWithAbort(call, request.timeout_ms)
    return { ok: result }
  } catch (error) {
    const timedOut = error instanceof ProviderTimeoutError
    return {
      failed: { timedOut, message: error instanceof Error ? error.message : String(error) },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────────────────

export type TurnOutcome =
  | { kind: 'advanced' }
  /** The turn already recorded where the run landed; the loop just has to stop. */
  | { kind: 'halted'; stop_reason: StopReason; message: string }
  | { kind: 'retry' }
  /** Another runner recorded this turn while we were waiting on the model. */
  | { kind: 'conflict'; message: string }

/**
 * Compare-and-set before recording a turn.
 *
 * With the reservation claim in place this should be unreachable in practice —
 * the claim is written before the call, so a rival sees it and never starts.
 * It stays as the last net for a ledger read that was already stale when the
 * claim was written.
 */
async function turnClaimedElsewhere(ctx: RunnerContext, request: TurnRequest): Promise<boolean> {
  const fresh = await ctx.ledger.read()
  if (!hasTurnBeenProcessed(fresh.events, request.idempotency_key)) return false
  ctx.events = [...fresh.events]
  ctx.budget = computeBudgetLedger(ctx.events, ctx.run.run_id, ctx.clock.now())
  return true
}

/**
 * We lost the race after paying for the answer.
 *
 * The reservation claim makes this rare — a compliant runner sees the claim and
 * never starts — but it is not impossible, and silently dropping the result would
 * drop the cost with it. The event carries no state, so the winner's transition
 * stands; it exists purely so the money shows up in the ledger and against the cap.
 */
async function recordDuplicateSpend(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  request: TurnRequest,
  costUsd: number
): Promise<TurnOutcome> {
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'duplicate_spend_recorded',
    actor,
    round,
    idempotency_key: request.idempotency_key,
    holder: ctx.input.holder,
    cost_usd: costUsd,
    note: 'another runner recorded this turn first; our result was discarded but the call was billed',
  })
  return {
    kind: 'conflict',
    message: `turn ${request.idempotency_key} was recorded by another runner`,
  }
}

/**
 * A call that timed out or threw still settles at the full reservation: we do not
 * know whether the provider billed us, and guessing in our own favour is how a
 * cap becomes a suggestion.
 */
async function handleProviderFailure(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  request: TurnRequest,
  failure: { timedOut: boolean; message: string }
): Promise<TurnOutcome> {
  const provider = providerFor(ctx, actor)
  const cancellationNote = provider.cancellation.supported
    ? 'abort signal delivered; the underlying call was cancelled'
    : `provider does not support cancellation — it may keep running and billing for up to ${provider.cancellation.server_max_timeout_ms}ms`

  await rejectTurn(ctx, {
    actor,
    round,
    request,
    reason: failure.timedOut ? 'provider_timeout' : 'provider_error',
    detail: [
      failure.message,
      cancellationNote,
      'reservation settled in full: billing status unknown',
    ],
    nextState: 'WAITING_HUMAN',
    costUsd: request.reserved_cost_usd,
  })
  return {
    kind: 'halted',
    stop_reason: failure.timedOut ? 'provider_timeout' : 'provider_error',
    message: failure.message,
  }
}

/**
 * Actual usage above the reservation means the price model is wrong, not that the
 * cap is soft. It stops the run for a human rather than quietly absorbing it.
 */
async function checkCostReconciliation(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  request: TurnRequest,
  actualUsd: number
): Promise<TurnOutcome | null> {
  if (actualUsd <= request.reserved_cost_usd) return null

  await rejectTurn(ctx, {
    actor,
    round,
    request,
    reason: 'cost_overrun',
    detail: [
      `actual $${actualUsd.toFixed(6)} exceeded the reserved $${request.reserved_cost_usd.toFixed(6)}`,
      `pricing_version ${request.cost_estimate.pricing_version} for model ${request.cost_estimate.model}`,
      'the price model is wrong; treat as a pricing/configuration violation',
    ],
    nextState: 'WAITING_HUMAN',
    costUsd: actualUsd,
  })
  return {
    kind: 'halted',
    stop_reason: 'cost_overrun',
    message: `actual cost $${actualUsd.toFixed(6)} exceeded its reservation`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The two turns
// ─────────────────────────────────────────────────────────────────────────────

export async function runReviewerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest
): Promise<TurnOutcome> {
  const result = await invokeProvider(
    (signal) => ctx.deps.reviewer.review({ ...request, signal }),
    request
  )
  if ('failed' in result) {
    return handleProviderFailure(ctx, 'gpt_reviewer', round, request, result.failed)
  }

  if (await turnClaimedElsewhere(ctx, request)) {
    return recordDuplicateSpend(ctx, 'gpt_reviewer', round, request, result.ok.usage.cost_usd)
  }

  const overrun = await checkCostReconciliation(
    ctx,
    'gpt_reviewer',
    round,
    request,
    result.ok.usage.cost_usd
  )
  if (overrun) return overrun

  const telemetryProblem = checkTelemetry(result.ok)
  if (telemetryProblem) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'missing_telemetry',
      detail: [telemetryProblem],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'halted', stop_reason: 'policy_violation', message: telemetryProblem }
  }

  // The reviewer is read-only, so its own tool use is checked against the same
  // allowlist rather than assumed empty.
  const toolDecision = enforceToolUse(ctx.input.authorization.scope, result.ok.telemetry.tools_used)
  if (!toolDecision.allowed) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'policy_violation',
      detail: [toolDecision.code, toolDecision.message, ...toolDecision.offending],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `${toolDecision.code}: ${toolDecision.message}`,
    }
  }

  const parsed = reviewerTurnOutputSchema.safeParse(result.ok.output)
  if (!parsed.success) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'invalid_output',
      detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      nextState: ctx.run.state,
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'retry' }
  }

  const output: ReviewerTurnOutput = parsed.data
  ctx.run = { ...ctx.run, current_round: round }
  const nextState = applyTurnState(ctx, nextStateForVerdict(ctx.run.mode, output.verdict))

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_completed',
    actor: 'gpt_reviewer',
    round,
    idempotency_key: request.idempotency_key,
    input_digest: request.input_digest,
    verdict: output.verdict,
    reserved_cost_usd: request.reserved_cost_usd,
    cost_usd: result.ok.usage.cost_usd,
    pricing_version: request.cost_estimate.pricing_version,
    output_digest: digest(output),
    authoritative: null,
    self_report_mismatches: [],
    next_state: nextState,
  })

  return { kind: 'advanced' }
}

export async function runImplementerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest,
  before: WorkspaceState
): Promise<TurnOutcome> {
  const result = await invokeProvider(
    (signal) => ctx.deps.implementer.implement({ ...request, signal }),
    request
  )
  if ('failed' in result) {
    return handleProviderFailure(ctx, 'claude_implementer', round, request, result.failed)
  }

  if (await turnClaimedElsewhere(ctx, request)) {
    return recordDuplicateSpend(ctx, 'claude_implementer', round, request, result.ok.usage.cost_usd)
  }

  const overrun = await checkCostReconciliation(
    ctx,
    'claude_implementer',
    round,
    request,
    result.ok.usage.cost_usd
  )
  if (overrun) return overrun

  const telemetryProblem = checkTelemetry(result.ok)
  if (telemetryProblem) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'missing_telemetry',
      detail: [telemetryProblem],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'halted', stop_reason: 'policy_violation', message: telemetryProblem }
  }

  // The second half of the snapshot pair. What this turn did is after − before;
  // what the branch holds in total is after.
  const after = await ctx.deps.workspace.capture()
  const delta: TurnDelta = diffWorkspaceStates(before, after)

  const facts: AuthoritativeTurnFacts = {
    files_changed: [...delta.files_changed],
    cumulative_files_changed: [...delta.cumulative_files_changed],
    tools_used: [...result.ok.telemetry.tools_used],
    commit: delta.commit,
    pull_request: delta.pull_request,
    pull_request_opened_this_turn: delta.pull_request_opened_this_turn,
    pushed_this_turn: delta.pushed_this_turn,
    remote_head_delta: delta.remote_head_delta,
    remote_facts_available: delta.remote_facts_available,
    sources: { workspace: delta.source, telemetry: result.ok.telemetry.source },
  }

  const policy = evaluateImplementerTurn(ctx.input.authorization, facts)
  if (!policy.allowed) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'policy_violation',
      detail: [policy.code, policy.message, ...policy.offending, `evidence: ${facts.sources.workspace}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `${policy.code}: ${policy.message}`,
    }
  }

  const drift = await ctx.deps.integrity.drift()
  if (drift.length > 0) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'policy_integrity_drift',
      detail: [...drift, `evidence: ${ctx.deps.integrity.name}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `control-plane files changed during the turn: ${drift.join(', ')}`,
    }
  }

  const parsed = implementerTurnOutputSchema.safeParse(result.ok.output)
  if (!parsed.success) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'invalid_output',
      detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      nextState: ctx.run.state,
      costUsd: result.ok.usage.cost_usd,
    })
    return { kind: 'retry' }
  }

  const output: ImplementerTurnOutput = parsed.data
  const mismatches = compareSelfReport(output, facts)
  if (mismatches.length > 0) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'self_report_mismatch',
      detail: [...mismatches, `evidence: ${facts.sources.workspace} + ${facts.sources.telemetry}`],
      nextState: 'WAITING_HUMAN',
      costUsd: result.ok.usage.cost_usd,
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `implementer self-report does not match the record: ${mismatches[0]}`,
    }
  }

  ctx.run = {
    ...ctx.run,
    current_round: round,
    target_branch: facts.commit?.branch ?? ctx.run.target_branch,
    pr_number: facts.pull_request?.number ?? ctx.run.pr_number,
  }

  const nextState = applyTurnState(ctx, 'GPT_TURN')

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_completed',
    actor: 'claude_implementer',
    round,
    idempotency_key: request.idempotency_key,
    input_digest: request.input_digest,
    verdict: null,
    reserved_cost_usd: request.reserved_cost_usd,
    cost_usd: result.ok.usage.cost_usd,
    pricing_version: request.cost_estimate.pricing_version,
    output_digest: digest(output),
    authoritative: facts,
    self_report_mismatches: [],
    next_state: nextState,
  })

  return { kind: 'advanced' }
}

/** Re-exported so the runner can type its own local variables. */
export type { LedgerEvent }
