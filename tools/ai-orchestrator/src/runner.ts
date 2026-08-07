/**
 * The orchestration runner.
 *
 * Order of operations is the safety property, so it is written out once here and
 * not rearranged for convenience:
 *
 *   ledger read + fold -> kill switch -> EXCLUSIVE OWNERSHIP -> timing invariant
 *   -> authorization window -> side-effect class -> lease (audit only)
 *   -> human-resume gate
 *   -> [per turn] idempotency -> foreign live claim -> price quote -> budget gate
 *      -> RESERVE (turn_started) -> capture workspace BEFORE
 *      -> provider call under AbortSignal -> conflict re-check -> cost reconcile
 *      -> telemetry -> capture workspace AFTER + diff -> policy -> integrity
 *      -> schema -> self-report comparison -> record -> transition
 *
 * Two properties are worth calling out because they were wrong in v0.1:
 *
 * - **Money is committed before the call, not after.** `turn_started` reserves
 *   the provider's own worst-case quote, and a turn may only start when that much
 *   budget is left.
 *   If the runner dies, the reservation stays committed — we cannot know whether
 *   the provider billed us, so we assume it did.
 * - **Policy is evaluated on authoritative facts.** `files_changed`, `tools_used`
 *   and commit/PR identity come from git, GitHub and the execution harness. What
 *   the model says about its own turn is compared to that record and reported,
 *   never trusted in its place.
 */

import { IssueCommentLedger, hasTurnBeenProcessed } from './adapters/github/ledger'
import { computeBudgetLedger, foreignLiveClaim, remainingBudget } from './domain/budget'
import type { BudgetLedger } from './domain/budget'
import { foldRun } from './domain/fold'
import { evaluateLeaseAcquisition, leaseKeyFor } from './domain/lease'
import { actorForState, initialTurnState, isTerminal, resumeFromWaitingHuman } from './domain/state-machine'
import type { RunState, StopReason } from './domain/schema'
import { verifyExclusiveRunContext } from './policy/exclusivity'
import {
  checkBudget,
  checkTimingInvariant,
  enforceAuthorizationWindow,
  enforceSideEffectClass,
  evaluateKillSwitch,
} from './policy/policy'
import { baseEvent, finish, log, nextWaitId, record, transitionTo } from './runner-context'
import { systemClock } from './runner-types'
import type { PreflightReport, RunnerContext, RunnerDeps, RunnerInput, RunnerResult } from './runner-types'
import {
  draftTurn,
  finalizeRequest,
  inFlightWindowMs,
  providerFor,
  runImplementerTurn,
  runReviewerTurn,
} from './turn-executor'
import type { WorkspaceState } from './adapters/workspace/inspector'

export { systemClock } from './runner-types'
export type {
  Clock,
  PreflightReport,
  RunnerDeps,
  RunnerInput,
  RunnerResult,
} from './runner-types'

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
    trust: {
      machineAuthors: input.trustedAuthors,
      humanAuthorizers: input.allowedAuthorizers,
    },
    dryRun: input.dryRun,
  })

  const read = await ledger.read()
  const budget = computeBudgetLedger(read.events, input.run.run_id, clock.now())
  const ctx: RunnerContext = {
    input,
    deps,
    clock,
    ledger,
    events: [...read.events],
    appended: [],
    run: foldRun(input.run, read.events, read.lastCommentId, budget),
    budget,
  }

  const preflight: PreflightReport = {
    kill_switch: { stopped: false, reason: null },
    exclusivity: { ok: false, reason: 'not evaluated' },
    timing_invariant: { ok: true, message: 'not evaluated' },
    authorization: { allowed: true },
    side_effect_class: { allowed: true },
    lease: null,
    budget: null,
    budget_ledger: ctx.budget,
    next_actor: null,
    next_idempotency_key: null,
    next_input_digest: null,
    next_reserved_cost_usd: null,
    cost_estimate: null,
    cancellation: {
      gpt_reviewer: deps.reviewer.cancellation,
      claude_implementer: deps.implementer.cancellation,
    },
    workspace_source: deps.workspace.name,
    integrity_source: deps.integrity.name,
    ledger_rejected: read.rejected,
    ledger_pages_read: read.pages_read,
    ledger_comment_count: read.comment_count,
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

  // 2. Exclusive ownership. The Issue-comment lease is an audit record, not a
  //    lock — two runners reading an idle ledger both conclude they hold it, and
  //    both pay for a call. The real exclusion is GitHub Actions `concurrency`,
  //    enforced before either process starts, so the runner demands proof that it
  //    applies to this Issue and refuses to spend anything without it.
  //
  //    Dry-run is exempt: it calls no provider and writes nothing, so there is
  //    nothing for two of them to race over.
  preflight.exclusivity = verifyExclusiveRunContext({
    env: input.env,
    issueNumber: ctx.run.issue_number,
  })
  if (!input.dryRun && !preflight.exclusivity.ok) {
    const message = `no verified exclusive ownership: ${preflight.exclusivity.reason}`
    await transitionTo(ctx, 'WAITING_HUMAN', message, {
      wait: { id: nextWaitId(ctx), blocking_reason: 'no_exclusive_ownership' },
    })
    await finish(ctx, 'no_exclusive_ownership')
    return done(message)
  }

  // 3. Timing and budget invariants. A configuration that could leak duplicate
  //    spend never gets to make its first call.
  // Use the longer of the two providers' in-flight windows: whichever adapter
  // cannot prove it cancels sets the bar for the whole run.
  const worstInFlightMs = Math.max(
    inFlightWindowMs(ctx, 'gpt_reviewer'),
    inFlightWindowMs(ctx, 'claude_implementer')
  )
  preflight.timing_invariant = checkTimingInvariant(input.limits, input.leaseTtlMs, worstInFlightMs)
  if (!preflight.timing_invariant.ok) {
    if (!input.dryRun) {
      await transitionTo(ctx, 'WAITING_HUMAN', preflight.timing_invariant.message, {
        wait: { id: nextWaitId(ctx), blocking_reason: 'configuration_invalid' },
      })
      await finish(ctx, 'configuration_invalid')
    }
    return done(preflight.timing_invariant.message)
  }

  // 4. Authorization window and side-effect class.
  preflight.authorization = enforceAuthorizationWindow(input.authorization, clock.now())
  if (!preflight.authorization.allowed) {
    if (!input.dryRun) {
      await transitionTo(ctx, 'WAITING_HUMAN', preflight.authorization.message, {
        wait: { id: nextWaitId(ctx), blocking_reason: 'authorization_expired' },
      })
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
      await transitionTo(ctx, 'WAITING_HUMAN', preflight.side_effect_class.message, {
        wait: { id: nextWaitId(ctx), blocking_reason: 'policy_violation' },
      })
      await finish(ctx, 'policy_violation')
    }
    return done(preflight.side_effect_class.message)
  }

  // 5. Lease — the audit trail of who held the run, and stale detection. NOT the
  //    exclusion mechanism; see step 2.
  const lockKey = leaseKeyFor(ctx.run.repository, ctx.run.issue_number)
  // Fencing token: unique per acquisition, so a release written by a holder whose
  // lease already lapsed cannot free the lease that replaced it.
  const priorAcquisitions = ctx.events.filter(
    (event) => event.event === 'lease_acquired' && event.lock_key === lockKey
  ).length
  const leaseId = `lease-${lockKey}-${priorAcquisitions + 1}`
  const lease = evaluateLeaseAcquisition({
    events: ctx.events,
    lockKey,
    holder: input.holder,
    now: clock.now(),
    ttlMs: input.leaseTtlMs,
    leaseId,
  })
  preflight.lease = lease
  if (!lease.acquired) {
    return done(`lease held by ${lease.held_by} until ${lease.expires_at}`)
  }

  // 6. WAITING_HUMAN never resumes on its own.
  if (ctx.run.state === 'WAITING_HUMAN') {
    const resume = resumeFromWaitingHuman({
      runId: ctx.run.run_id,
      events: ctx.events,
      allowedAuthorizers: input.allowedAuthorizers,
      now: clock.now(),
    })
    if (!resume.resumed) return done(`waiting for human: ${resume.reason}`)
    if (!input.dryRun) {
      // Recording the consumed wait id is what makes an authorization one-shot:
      // the wait closes, and the next block opens a new id nobody has approved.
      await transitionTo(ctx, resume.state, resume.reason, {
        consumedWaitId: resume.consumed_wait_id ?? undefined,
      })
    } else ctx.run = { ...ctx.run, state: resume.state }
  }

  if (ctx.run.state === 'READY') {
    const first = initialTurnState(ctx.run.mode)
    if (!input.dryRun) await transitionTo(ctx, first, `starting in ${ctx.run.mode} mode`)
    else ctx.run = { ...ctx.run, state: first }
  }

  preflight.next_actor = actorForState(ctx.run.state)
  if (preflight.next_actor) {
    const draft = draftTurn(ctx, preflight.next_actor, ctx.run.current_round + 1)
    preflight.next_idempotency_key = draft.idempotency_key
    preflight.next_input_digest = draft.input_digest

    const quote = providerFor(ctx, preflight.next_actor).maxCostFor({
      system: draft.system,
      user: draft.user,
      max_output_tokens: draft.max_output_tokens,
      now: clock.now(),
    })
    preflight.cost_estimate = quote.ok
      ? quote.estimate
      : { refused: quote.reason, message: quote.message }
    preflight.next_reserved_cost_usd = quote.ok ? quote.estimate.max_cost_usd : null
    preflight.budget = checkBudget(
      ctx.run,
      input.limits,
      ctx.budget,
      clock.now(),
      quote.ok ? quote.estimate.max_cost_usd : input.limits.max_turn_cost_usd
    )
  } else {
    preflight.budget = checkBudget(ctx.run, input.limits, ctx.budget, clock.now())
  }

  // 7. Dry-run stops here: preflight complete, nothing called, nothing written.
  if (input.dryRun) {
    return done('dry run: preflight complete, no provider called and no comment written')
  }

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'lease_acquired',
    lock_key: lockKey,
    holder: input.holder,
    lease_id: lease.lease_id,
    expires_at: lease.expires_at,
    took_over_from: lease.took_over_from,
  })

  const reason = await executeLoop(ctx)

  await record(ctx, {
    ...baseEvent(ctx),
    event: 'lease_released',
    lock_key: lockKey,
    holder: input.holder,
    lease_id: lease.lease_id,
  })

  return done(reason)
}

async function executeLoop(ctx: RunnerContext): Promise<string> {
  const { input, deps, clock } = ctx

  while (!isTerminal(ctx.run.state)) {
    const actor = actorForState(ctx.run.state)
    if (!actor) return `no actor owns state ${ctx.run.state}`

    const round = ctx.run.current_round + 1
    const draft = draftTurn(ctx, actor, round)

    if (hasTurnBeenProcessed(ctx.events, draft.idempotency_key)) {
      log(deps, `turn ${draft.idempotency_key} already processed; not re-running`)
      return `turn ${draft.idempotency_key} already processed`
    }

    // Someone else has this turn claimed and their call may be in flight. Starting
    // ours would buy the same answer twice.
    const rival = foreignLiveClaim(ctx.budget, draft.idempotency_key, input.holder)
    if (rival) {
      log(deps, `turn ${draft.idempotency_key} is claimed by ${rival.holder}`)
      return `turn ${draft.idempotency_key} is claimed by ${rival.holder} until ${rival.claim_expires_at}`
    }

    // Ask the adapter that knows the prices what the worst case is. No quote, no
    // call — there is no safe default price to fall back on.
    const quote = providerFor(ctx, actor).maxCostFor({
      system: draft.system,
      user: draft.user,
      max_output_tokens: draft.max_output_tokens,
      now: clock.now(),
    })
    if (!quote.ok) {
      const message = `cannot price this turn (${quote.reason}): ${quote.message}`
      await transitionTo(ctx, 'WAITING_HUMAN', message, {
        wait: { id: nextWaitId(ctx), blocking_reason: 'cost_estimate_unavailable' },
      })
      await finish(ctx, 'cost_estimate_unavailable')
      return message
    }

    const budget = checkBudget(
      ctx.run,
      input.limits,
      ctx.budget,
      clock.now(),
      quote.estimate.max_cost_usd
    )
    if (!budget.ok) {
      // Rounds, dollars and wall-clock are all budgets, so they share one state.
      await transitionTo(ctx, 'BUDGET_EXHAUSTED', budget.message)
      await finish(ctx, budget.stop_reason)
      return budget.message
    }

    const controller = new AbortController()
    const request = finalizeRequest(ctx, draft, round, quote.estimate, controller.signal)

    // Reserve before calling. From here the money is committed whatever happens.
    // The claim covers the in-flight window, which is the provider's server-side
    // maximum when the adapter cannot prove it cancels.
    await record(ctx, {
      ...baseEvent(ctx),
      event: 'turn_started',
      actor,
      round,
      idempotency_key: request.idempotency_key,
      input_digest: request.input_digest,
      holder: input.holder,
      reserved_cost_usd: request.reserved_cost_usd,
      pricing_version: quote.estimate.pricing_version,
      claim_expires_at: new Date(
        clock.now().getTime() + inFlightWindowMs(ctx, actor)
      ).toISOString(),
    })

    let outcome
    if (actor === 'gpt_reviewer') {
      outcome = await runReviewerTurn(ctx, round, request)
    } else {
      // The pre-call half of the snapshot pair. Captured after the reservation so
      // a crash between the two still leaves the money accounted for.
      const before: WorkspaceState = await deps.workspace.capture()
      outcome = await runImplementerTurn(ctx, round, request, before)
    }

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

/** Exposed for the dry-run report. */
export function remainingBudgetFor(capUsd: number, ledger: BudgetLedger): number {
  return remainingBudget(capUsd, ledger)
}
