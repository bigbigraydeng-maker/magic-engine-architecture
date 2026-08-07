/**
 * The orchestration runner.
 *
 * Order of operations is the safety property, so it is written out once here and
 * not rearranged for convenience:
 *
 *   kill switch -> authorization window -> side-effect class -> lease -> ledger
 *   fold -> human-resume gate -> [per turn] budget -> idempotency -> provider ->
 *   schema -> policy -> integrity -> record -> transition
 *
 * Anything that would spend money or write to GitHub happens strictly after every
 * guard above it has passed. In dry-run the runner stops at the end of preflight
 * and reports what it *would* do next.
 */

import { IssueCommentLedger, hasTurnBeenProcessed } from './adapters/github/ledger'
import type { PlannedWrite, RejectedComment } from './adapters/github/ledger'
import type { GitHubClient } from './adapters/github/client'
import type { ImplementerProvider, ReviewerProvider, TurnRequest } from './adapters/provider-types'
import { digest, turnIdempotencyKey } from './domain/digest'
import { foldRun } from './domain/fold'
import { evaluateLeaseAcquisition, leaseKeyFor } from './domain/lease'
import type { LeaseAcquisition } from './domain/lease'
import {
  actorForState,
  assertTransition,
  initialTurnState,
  isTerminal,
  nextStateForVerdict,
  resumeFromWaitingHuman,
} from './domain/state-machine'
import type {
  Actor,
  ImplementerTurnOutput,
  LedgerEvent,
  OrchestrationRun,
  ReviewerTurnOutput,
  RunState,
  SideEffectClass,
  StopReason,
  TurnRejectionReason,
  WorkPackageAuthorization,
} from './domain/schema'
import {
  LEDGER_SCHEMA_VERSION,
  implementerTurnOutputSchema,
  reviewerTurnOutputSchema,
} from './domain/schema'
import type { BudgetResult, KillSwitchResult, OrchestratorLimits, PolicyDecision } from './policy/policy'
import {
  checkBudget,
  enforceAuthorizationWindow,
  enforceSideEffectClass,
  evaluateImplementerTurn,
  evaluateKillSwitch,
} from './policy/policy'
import { comparePolicySnapshots } from './policy/protected-paths'
import type { PolicySnapshot } from './policy/protected-paths'
import { buildPromptEnvelope } from './policy/untrusted'
import type { UntrustedBlock } from './policy/untrusted'
import { IMPLEMENTER_PROMPT_VERSION, IMPLEMENTER_SYSTEM_POLICY } from './prompts/implementer-system.v1'
import { REVIEWER_PROMPT_VERSION, REVIEWER_SYSTEM_POLICY } from './prompts/reviewer-system.v1'

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

export interface RunnerDeps {
  github: GitHubClient
  reviewer: ReviewerProvider
  implementer: ImplementerProvider
  clock?: Clock
  logger?: (line: string) => void
}

export interface RunnerInput {
  run: OrchestrationRun
  authorization: WorkPackageAuthorization
  limits: OrchestratorLimits
  /** True by default at every call site in v0.1. */
  dryRun: boolean
  workflowEnabledInput: boolean
  env: Readonly<Record<string, string | undefined>>
  /** Comment authors whose ledger markers are trusted. */
  trustedAuthors: readonly string[]
  /** Humans who may release a WAITING_HUMAN run. */
  allowedAuthorizers: readonly string[]
  /** Identifies this runner instance, e.g. `gha-run-1234567`. */
  holder: string
  leaseTtlMs: number
  /** Side-effect classes this deployment permits. */
  permittedSideEffectClasses: readonly SideEffectClass[]
  policySnapshot: PolicySnapshot
  /** Re-read of the control-plane files after each turn. Omitted = not checked. */
  readPolicySnapshot?: () => PolicySnapshot
  taskBrief: string
  untrusted: readonly UntrustedBlock[]
}

export interface PreflightReport {
  kill_switch: KillSwitchResult
  authorization: PolicyDecision
  side_effect_class: PolicyDecision
  lease: LeaseAcquisition | null
  budget: BudgetResult | null
  next_actor: Actor | null
  next_idempotency_key: string | null
  next_input_digest: string | null
  policy_integrity: 'checked' | 'not_checked'
  ledger_rejected: readonly RejectedComment[]
}

export interface RunnerResult {
  run: OrchestrationRun
  /** Events this invocation appended (or would have appended in dry-run). */
  appended: readonly LedgerEvent[]
  plannedWrites: readonly PlannedWrite[]
  dryRun: boolean
  preflight: PreflightReport
  stopped_because: string
}

// ─────────────────────────────────────────────────────────────────────────────

interface RunnerContext {
  input: RunnerInput
  deps: RunnerDeps
  clock: Clock
  ledger: IssueCommentLedger
  /** Reassigned when a conflict re-read finds fresher events. */
  events: LedgerEvent[]
  appended: LedgerEvent[]
  run: OrchestrationRun
}

function log(deps: RunnerDeps, line: string): void {
  deps.logger?.(line)
}

async function record(ctx: RunnerContext, event: LedgerEvent): Promise<void> {
  await ctx.ledger.append(event)
  ctx.events.push(event)
  ctx.appended.push(event)
}

function baseEvent(ctx: RunnerContext): {
  schema_version: typeof LEDGER_SCHEMA_VERSION
  run_id: string
  at: string
} {
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    run_id: ctx.run.run_id,
    at: ctx.clock.now().toISOString(),
  }
}

/**
 * Records a state change that is NOT the result of an agent turn: starting the
 * run, a kill switch, a budget stop, a human resume. Turn-driven transitions ride
 * on the turn event itself (see `applyTurnState`).
 */
async function transitionTo(ctx: RunnerContext, to: RunState, reason: string): Promise<void> {
  const from = ctx.run.state
  // A no-op transition is not an error. It happens when a second dispatch hits the
  // same guard that parked the run, and it must not throw.
  if (from === to) return
  assertTransition(from, to)
  ctx.run = { ...ctx.run, state: to, updated_at: ctx.clock.now().toISOString() }
  await record(ctx, { ...baseEvent(ctx), event: 'state_changed', from, to, reason })
}

/** Validates and applies a turn-driven transition without emitting its own event. */
function applyTurnState(ctx: RunnerContext, to: RunState): RunState {
  if (ctx.run.state !== to) assertTransition(ctx.run.state, to)
  ctx.run = { ...ctx.run, state: to, updated_at: ctx.clock.now().toISOString() }
  return to
}

async function finish(ctx: RunnerContext, stopReason: StopReason | null): Promise<void> {
  ctx.run = { ...ctx.run, stop_reason: stopReason }
  await record(ctx, {
    ...baseEvent(ctx),
    event: 'run_finished',
    final_state: ctx.run.state,
    stop_reason: stopReason,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn construction
// ─────────────────────────────────────────────────────────────────────────────

function buildTurnRequest(ctx: RunnerContext, actor: Actor, round: number): TurnRequest {
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
    next_state: nextState,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Turn execution
// ─────────────────────────────────────────────────────────────────────────────

type TurnOutcome =
  | { kind: 'advanced' }
  /** The turn already recorded where the run landed; the loop just has to stop. */
  | { kind: 'halted'; stop_reason: StopReason; message: string }
  | { kind: 'retry' }
  /** Another runner recorded this turn while we were waiting on the model. */
  | { kind: 'conflict'; message: string }

/**
 * Compare-and-set before recording a turn.
 *
 * The lease and the pre-call check together cover the ordinary cases. This covers
 * the one they cannot: a second runner took over a lease that went stale while
 * this runner was still waiting on a slow model call. Re-reading the ledger just
 * before the write is the only point at which that collision is visible.
 */
async function turnClaimedElsewhere(ctx: RunnerContext, request: TurnRequest): Promise<boolean> {
  const fresh = await ctx.ledger.read()
  if (!hasTurnBeenProcessed(fresh.events, request.idempotency_key)) return false
  ctx.events = [...fresh.events]
  return true
}

async function runReviewerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest
): Promise<TurnOutcome> {
  const result = await ctx.deps.reviewer.review(request)
  if (await turnClaimedElsewhere(ctx, request)) {
    return { kind: 'conflict', message: `turn ${request.idempotency_key} was recorded by another runner` }
  }

  const parsed = reviewerTurnOutputSchema.safeParse(result.output)

  if (!parsed.success) {
    await rejectTurn(ctx, {
      actor: 'gpt_reviewer',
      round,
      request,
      reason: 'invalid_output',
      detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      nextState: ctx.run.state,
    })
    return { kind: 'retry' }
  }

  const output: ReviewerTurnOutput = parsed.data
  ctx.run = {
    ...ctx.run,
    current_round: round,
    cumulative_cost_usd: ctx.run.cumulative_cost_usd + result.usage.cost_usd,
  }

  const nextState = applyTurnState(ctx, nextStateForVerdict(ctx.run.mode, output.verdict))

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'turn_completed',
    actor: 'gpt_reviewer',
    round,
    idempotency_key: request.idempotency_key,
    input_digest: request.input_digest,
    verdict: output.verdict,
    cost_usd: result.usage.cost_usd,
    output_digest: digest(output),
    next_state: nextState,
  })

  return { kind: 'advanced' }
}

async function runImplementerTurn(
  ctx: RunnerContext,
  round: number,
  request: TurnRequest
): Promise<TurnOutcome> {
  const result = await ctx.deps.implementer.implement(request)
  if (await turnClaimedElsewhere(ctx, request)) {
    return { kind: 'conflict', message: `turn ${request.idempotency_key} was recorded by another runner` }
  }

  const parsed = implementerTurnOutputSchema.safeParse(result.output)

  if (!parsed.success) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'invalid_output',
      detail: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      nextState: ctx.run.state,
    })
    return { kind: 'retry' }
  }

  const output: ImplementerTurnOutput = parsed.data
  const policy = evaluateImplementerTurn(ctx.input.authorization, output)
  if (!policy.allowed) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'policy_violation',
      detail: [policy.code, policy.message, ...policy.offending],
      nextState: 'WAITING_HUMAN',
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `${policy.code}: ${policy.message}`,
    }
  }

  const integrity = checkPolicyIntegrity(ctx)
  if (integrity) {
    await rejectTurn(ctx, {
      actor: 'claude_implementer',
      round,
      request,
      reason: 'policy_integrity_drift',
      detail: integrity,
      nextState: 'WAITING_HUMAN',
    })
    return {
      kind: 'halted',
      stop_reason: 'policy_violation',
      message: `control-plane files changed during the turn: ${integrity.join(', ')}`,
    }
  }

  ctx.run = {
    ...ctx.run,
    current_round: round,
    cumulative_cost_usd: ctx.run.cumulative_cost_usd + result.usage.cost_usd,
    target_branch: output.commit_evidence?.branch ?? ctx.run.target_branch,
    pr_number: output.commit_evidence?.pr_number ?? ctx.run.pr_number,
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
    cost_usd: result.usage.cost_usd,
    output_digest: digest(output),
    next_state: nextState,
  })

  return { kind: 'advanced' }
}

/** Returns the drifted paths, or null when intact / not checked. */
function checkPolicyIntegrity(ctx: RunnerContext): string[] | null {
  const read = ctx.input.readPolicySnapshot
  if (!read) return null
  const result = comparePolicySnapshots(ctx.input.policySnapshot, read())
  return result.intact ? null : [...result.drifted]
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runOrchestration(
  input: RunnerInput,
  deps: RunnerDeps
): Promise<RunnerResult> {
  const clock = deps.clock ?? systemClock
  const ledger = new IssueCommentLedger(deps.github, {
    issueNumber: input.run.issue_number,
    trustedAuthors: input.trustedAuthors,
    dryRun: input.dryRun,
  })

  const read = await ledger.read()
  const ctx: RunnerContext = {
    input,
    deps,
    clock,
    ledger,
    events: [...read.events],
    appended: [],
    run: foldRun(input.run, read.events, read.lastCommentId),
  }

  const preflight: PreflightReport = {
    kill_switch: { stopped: false, reason: null },
    authorization: { allowed: true },
    side_effect_class: { allowed: true },
    lease: null,
    budget: null,
    next_actor: null,
    next_idempotency_key: null,
    next_input_digest: null,
    policy_integrity: input.readPolicySnapshot ? 'checked' : 'not_checked',
    ledger_rejected: read.rejected,
  }

  const done = (reason: string): RunnerResult => ({
    run: ctx.run,
    appended: ctx.appended,
    plannedWrites: ledger.plannedWrites,
    dryRun: input.dryRun,
    preflight,
    stopped_because: reason,
  })

  if (isTerminal(ctx.run.state)) return done(`run is already terminal (${ctx.run.state})`)

  // 1. Kill switch — three independent sources, all fail closed.
  const labels = await deps.github.listIssueLabels(ctx.run.issue_number)
  preflight.kill_switch = evaluateKillSwitch({
    workflowEnabledInput: input.workflowEnabledInput,
    env: input.env,
    issueLabels: labels,
  })
  if (preflight.kill_switch.stopped) {
    log(deps, `kill switch: ${preflight.kill_switch.reason}`)
    if (!input.dryRun) {
      await transitionTo(ctx, 'CANCELLED', preflight.kill_switch.reason ?? 'kill switch')
      await finish(ctx, 'kill_switch')
    }
    return done(`kill switch: ${preflight.kill_switch.reason}`)
  }

  // 2. Authorization window and side-effect class.
  preflight.authorization = enforceAuthorizationWindow(input.authorization, clock.now())
  if (!preflight.authorization.allowed) {
    if (!input.dryRun) {
      await transitionTo(ctx, 'WAITING_HUMAN', preflight.authorization.message)
      await finish(ctx, 'authorization_expired')
    }
    return done(preflight.authorization.message)
  }

  preflight.side_effect_class = enforceSideEffectClass(
    input.authorization,
    input.permittedSideEffectClasses
  )
  if (!preflight.side_effect_class.allowed) {
    if (!input.dryRun) {
      await transitionTo(ctx, 'WAITING_HUMAN', preflight.side_effect_class.message)
      await finish(ctx, 'policy_violation')
    }
    return done(preflight.side_effect_class.message)
  }

  // 3. Lease — only one runner may hold a turn for this Issue.
  const lockKey = leaseKeyFor(ctx.run.repository, ctx.run.issue_number)
  const lease = evaluateLeaseAcquisition({
    events: ctx.events,
    lockKey,
    holder: input.holder,
    now: clock.now(),
    ttlMs: input.leaseTtlMs,
  })
  preflight.lease = lease
  if (!lease.acquired) {
    return done(`lease held by ${lease.held_by} until ${lease.expires_at}`)
  }

  // 4. WAITING_HUMAN never resumes on its own.
  if (ctx.run.state === 'WAITING_HUMAN') {
    const resume = resumeFromWaitingHuman({
      runId: ctx.run.run_id,
      events: ctx.events,
      allowedAuthorizers: input.allowedAuthorizers,
      now: clock.now(),
    })
    if (!resume.resumed) return done(`waiting for human: ${resume.reason}`)
    if (!input.dryRun) await transitionTo(ctx, resume.state, resume.reason)
    else ctx.run = { ...ctx.run, state: resume.state }
  }

  if (ctx.run.state === 'READY') {
    const first = initialTurnState(ctx.run.mode)
    if (!input.dryRun) await transitionTo(ctx, first, `starting in ${ctx.run.mode} mode`)
    else ctx.run = { ...ctx.run, state: first }
  }

  preflight.budget = checkBudget(ctx.run, input.limits, clock.now())
  preflight.next_actor = actorForState(ctx.run.state)
  if (preflight.next_actor && preflight.budget.ok) {
    const next = buildTurnRequest(ctx, preflight.next_actor, ctx.run.current_round + 1)
    preflight.next_idempotency_key = next.idempotency_key
    preflight.next_input_digest = next.input_digest
  }

  // 5. Dry-run stops here: preflight complete, nothing called, nothing written.
  if (input.dryRun) {
    return done('dry run: preflight complete, no provider called and no comment written')
  }

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'lease_acquired',
    lock_key: lockKey,
    holder: input.holder,
    expires_at: lease.expires_at,
    took_over_from: lease.took_over_from,
  })

  const reason = await executeLoop(ctx)

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'lease_released',
    lock_key: lockKey,
    holder: input.holder,
  })

  return done(reason)
}

async function executeLoop(ctx: RunnerContext): Promise<string> {
  const { input, deps, clock } = ctx

  while (!isTerminal(ctx.run.state)) {
    const budget = checkBudget(ctx.run, input.limits, clock.now())
    if (!budget.ok) {
      // Rounds, dollars and wall-clock are all budgets, so they share one state.
      await transitionTo(ctx, 'BUDGET_EXHAUSTED', budget.message)
      await finish(ctx, budget.stop_reason)
      return budget.message
    }

    const actor = actorForState(ctx.run.state)
    if (!actor) return `no actor owns state ${ctx.run.state}`

    const round = ctx.run.current_round + 1
    const request = buildTurnRequest(ctx, actor, round)
    if (hasTurnBeenProcessed(ctx.events, request.idempotency_key)) {
      log(deps, `turn ${request.idempotency_key} already processed; not re-running`)
      return `turn ${request.idempotency_key} already processed`
    }

    const outcome =
      actor === 'gpt_reviewer'
        ? await runReviewerTurn(ctx, round, request)
        : await runImplementerTurn(ctx, round, request)

    if (outcome.kind === 'halted') {
      await finish(ctx, outcome.stop_reason)
      return outcome.message
    }

    // Nothing was recorded and nothing was transitioned: back off and let the
    // runner that won the race own the run.
    if (outcome.kind === 'conflict') {
      log(deps, outcome.message)
      return outcome.message
    }

    if (outcome.kind === 'retry' && ctx.run.invalid_output_count >= input.limits.max_invalid_outputs) {
      await transitionTo(ctx, 'FAILED', 'provider returned schema-invalid output too many times')
      await finish(ctx, 'invalid_provider_output')
      return 'too many schema-invalid provider outputs'
    }
  }

  if (ctx.run.stop_reason === null) {
    await finish(ctx, terminalStopReason(ctx.run.state))
  }

  return `run reached ${ctx.run.state}`
}

function terminalStopReason(state: RunState): StopReason {
  if (state === 'APPROVED_FOR_HUMAN_MERGE') return 'reviewer_approved'
  if (state === 'FAILED') return 'reviewer_declared_failure'
  if (state === 'CANCELLED') return 'kill_switch'
  return 'human_input_required'
}
