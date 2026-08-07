/**
 * One agent turn, from prompt construction to ledger record.
 *
 * The ordering inside `runImplementerTurn` is the interesting part: telemetry,
 * then the independent workspace read, then policy, then integrity — all before
 * the model's own output is even parsed. Nothing the model says can change what
 * those four steps conclude.
 */

import { hasTurnBeenProcessed } from './adapters/github/ledger'
import type { LedgerEvent } from './domain/schema'
import type { ProviderTurnResult, TurnRequest } from './adapters/provider-types'
import { TELEMETRY_UNAVAILABLE } from './adapters/provider-types'
import { computeBudgetLedger } from './domain/budget'
import { digest, turnIdempotencyKey } from './domain/digest'
import { nextStateForVerdict } from './domain/state-machine'
import type {
  Actor,
  AuthoritativeTurnFacts,
  ImplementerTurnOutput,
  ReviewerTurnOutput,
  RunState,
  StopReason,
  TurnRejectionReason,
} from './domain/schema'
import { implementerTurnOutputSchema, reviewerTurnOutputSchema } from './domain/schema'
import {
  compareSelfReport,
  enforceToolUse,
  evaluateImplementerTurn,
} from './policy/policy'
import { buildPromptEnvelope } from './policy/untrusted'
import { IMPLEMENTER_PROMPT_VERSION, IMPLEMENTER_SYSTEM_POLICY } from './prompts/implementer-system.v1'
import { REVIEWER_PROMPT_VERSION, REVIEWER_SYSTEM_POLICY } from './prompts/reviewer-system.v1'
import { applyTurnState, baseEvent, record } from './runner-context'
import type { Clock, RunnerContext } from './runner-types'

// ─────────────────────────────────────────────────────────────────────────────
// Turn construction
// ─────────────────────────────────────────────────────────────────────────────

export function buildTurnRequest(
  ctx: RunnerContext,
  actor: Actor,
  round: number,
  reservedCostUsd: number
): TurnRequest {
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
    run_id: ctx.run.run_id,
    round,
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
    timeout_ms: ctx.input.limits.provider_timeout_ms,
    max_output_tokens: ctx.input.limits.max_output_tokens,
    reserved_cost_usd: reservedCostUsd,
  }
}

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
    reserved_cost_usd: args.request.reserved_cost_usd,
    cost_usd: args.costUsd,
    next_state: nextState,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider invocation
// ─────────────────────────────────────────────────────────────────────────────

class ProviderTimeoutError extends Error {
  constructor(ms: number) {
    super(`provider call exceeded its ${ms}ms hard timeout`)
    this.name = 'ProviderTimeoutError'
  }
}

/**
 * Runs a provider call under a hard wall.
 *
 * The timeout is not politeness — it is what keeps a call strictly inside the
 * lease. `checkTimingInvariant` has already refused to start the run unless the
 * lease outlives this by a margin.
 */
async function callWithTimeout(
  call: Promise<ProviderTurnResult>,
  timeoutMs: number,
  clock: Clock
): Promise<ProviderTurnResult> {
  void clock
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      call,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError(timeoutMs)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
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

// ─────────────────────────────────────────────────────────────────────────────
// Turn execution
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
  const claimedByUs = ctx.events.some(
    (event: LedgerEvent) => event.event === 'turn_started' && event.idempotency_key === request.idempotency_key
  )
  const settledElsewhere = hasTurnBeenProcessed(fresh.events, request.idempotency_key)
  if (!settledElsewhere) return false
  void claimedByUs
  ctx.events = [...fresh.events]
  ctx.budget = computeBudgetLedger(ctx.events, ctx.run.run_id, ctx.clock.now())
  return true
}

export async function runReviewerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest
): Promise<TurnOutcome> {
  const result = await invokeProvider(ctx, () => ctx.deps.reviewer.review(request), request)
  if ('failed' in result) {
    return handleProviderFailure(ctx, 'gpt_reviewer', round, request, result.failed)
  }

  if (await turnClaimedElsewhere(ctx, request)) {
    return recordDuplicateSpend(ctx, 'gpt_reviewer', round, request, result.ok.usage.cost_usd)
  }

  const telemetryProblem = checkTelemetry(result.ok)
  if (telemetryProblem) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'missing_telemetry',
      detail: [telemetryProblem],
      nextState: 'WAITING_HUMAN',
      costUsd: Math.max(result.ok.usage.cost_usd, request.reserved_cost_usd),
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
  request: TurnRequest
): Promise<TurnOutcome> {
  const result = await invokeProvider(ctx, () => ctx.deps.implementer.implement(request), request)
  if ('failed' in result) {
    return handleProviderFailure(ctx, 'claude_implementer', round, request, result.failed)
  }

  if (await turnClaimedElsewhere(ctx, request)) {
    return recordDuplicateSpend(ctx, 'claude_implementer', round, request, result.ok.usage.cost_usd)
  }

  const telemetryProblem = checkTelemetry(result.ok)
  if (telemetryProblem) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'missing_telemetry',
      detail: [telemetryProblem],
      nextState: 'WAITING_HUMAN',
      costUsd: Math.max(result.ok.usage.cost_usd, request.reserved_cost_usd),
    })
    return { kind: 'halted', stop_reason: 'policy_violation', message: telemetryProblem }
  }

  // Independent reads, before the model's output is even parsed.
  const snapshot = await ctx.deps.workspace.inspect()
  const facts: AuthoritativeTurnFacts = {
    files_changed: [...snapshot.changed_files],
    tools_used: [...result.ok.telemetry.tools_used],
    commit: snapshot.commit,
    pull_request: snapshot.pull_request,
    sources: { workspace: snapshot.source, telemetry: result.ok.telemetry.source },
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
    output_digest: digest(output),
    authoritative: facts,
    self_report_mismatches: [],
    next_state: nextState,
  })

  return { kind: 'advanced' }
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
    note: 'another runner recorded this turn first; our result was discarded',
  })
  return {
    kind: 'conflict',
    message: `turn ${request.idempotency_key} was recorded by another runner`,
  }
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
  ctx: RunnerContext,
  call: () => Promise<ProviderTurnResult>,
  request: TurnRequest
): Promise<InvokeOutcome> {
  try {
    const result = await callWithTimeout(call(), request.timeout_ms, ctx.clock)
    return { ok: result }
  } catch (error) {
    const timedOut = error instanceof ProviderTimeoutError
    return {
      failed: { timedOut, message: error instanceof Error ? error.message : String(error) },
    }
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
  await rejectTurn(ctx, {
    actor,
    round,
    request,
    reason: failure.timedOut ? 'provider_timeout' : 'provider_error',
    detail: [failure.message, 'reservation settled in full: billing status unknown'],
    nextState: 'WAITING_HUMAN',
    costUsd: request.reserved_cost_usd,
  })
  return {
    kind: 'halted',
    stop_reason: failure.timedOut ? 'wall_clock_exceeded' : 'provider_error',
    message: failure.message,
  }
}
