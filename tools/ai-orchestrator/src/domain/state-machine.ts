/**
 * The orchestration state machine.
 *
 * Two properties matter more than anything else here:
 *   1. WAITING_HUMAN never resumes on its own. It only resumes when a valid,
 *      unexpired human authorization event names this run.
 *   2. Terminal states have no outgoing edges at all, so a stopped run cannot be
 *      restarted by re-running the workflow.
 */

import { IllegalTransitionError } from './errors'
import type { LedgerEvent, RunMode, RunState, Verdict } from './schema'

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  READY: ['GPT_TURN', 'CLAUDE_TURN', 'WAITING_HUMAN', 'CANCELLED', 'BUDGET_EXHAUSTED', 'FAILED'],
  GPT_TURN: [
    'CLAUDE_TURN',
    'GPT_TURN',
    'WAITING_HUMAN',
    'APPROVED_FOR_HUMAN_MERGE',
    'FAILED',
    'BUDGET_EXHAUSTED',
    'CANCELLED',
  ],
  CLAUDE_TURN: [
    'GPT_TURN',
    'CLAUDE_TURN',
    'WAITING_HUMAN',
    'FAILED',
    'BUDGET_EXHAUSTED',
    'CANCELLED',
  ],
  // Guarded: only reachable through `resumeFromWaitingHuman`.
  WAITING_HUMAN: ['GPT_TURN', 'CLAUDE_TURN', 'CANCELLED'],
  APPROVED_FOR_HUMAN_MERGE: [],
  FAILED: [],
  BUDGET_EXHAUSTED: [],
  CANCELLED: [],
}

const TERMINAL_STATES: readonly RunState[] = [
  'APPROVED_FOR_HUMAN_MERGE',
  'FAILED',
  'BUDGET_EXHAUSTED',
  'CANCELLED',
]

export function isTerminal(state: RunState): boolean {
  return TERMINAL_STATES.includes(state)
}

export function canTransition(from: RunState, to: RunState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to)
  }
}

export function allowedTransitionsFrom(state: RunState): readonly RunState[] {
  return TRANSITIONS[state]
}

/**
 * Which agent owns the next turn. Terminal and human-blocked states own none —
 * returning `null` is what stops the runner loop.
 */
export function actorForState(state: RunState): 'gpt_reviewer' | 'claude_implementer' | null {
  if (state === 'GPT_TURN') return 'gpt_reviewer'
  if (state === 'CLAUDE_TURN') return 'claude_implementer'
  return null
}

/** Where a fresh run begins, given its mode. */
export function initialTurnState(mode: RunMode): RunState {
  return mode === 'IMPLEMENT' ? 'CLAUDE_TURN' : 'GPT_TURN'
}

/**
 * Map a reviewer verdict onto the next state.
 *
 * `APPROVED_FOR_NEXT_STAGE` only ends the run in REVIEW mode; in DESIGN and
 * IMPLEMENT modes "approved" means "the next stage may start", which is another
 * implementer turn — never an automatic merge.
 */
export function nextStateForVerdict(mode: RunMode, verdict: Verdict): RunState {
  switch (verdict) {
    case 'CONTINUE_DESIGN':
    case 'REQUEST_CHANGES':
      return 'CLAUDE_TURN'
    case 'APPROVED_FOR_NEXT_STAGE':
      return mode === 'REVIEW' ? 'APPROVED_FOR_HUMAN_MERGE' : 'CLAUDE_TURN'
    case 'WAITING_HUMAN':
      return 'WAITING_HUMAN'
    // A policy violation is a security event, not a crash: park it where a human
    // has to look at it rather than burying it in FAILED.
    case 'STOP_POLICY_VIOLATION':
      return 'WAITING_HUMAN'
    case 'FAILED':
      return 'FAILED'
  }
}

export interface ResumeDecision {
  resumed: boolean
  state: RunState
  reason: string
}

/**
 * The only door out of WAITING_HUMAN.
 *
 * A run resumes only when the ledger contains a `human_authorization` event that
 * (a) names this run, (b) came from an allowlisted human, and (c) has not
 * expired. Absent all three, the run stays parked — re-running the workflow does
 * nothing, which is the point.
 */
export function resumeFromWaitingHuman(args: {
  runId: string
  events: readonly LedgerEvent[]
  allowedAuthorizers: readonly string[]
  now: Date
}): ResumeDecision {
  const { runId, events, allowedAuthorizers, now } = args

  const authorizations = events.filter(
    (event): event is Extract<LedgerEvent, { event: 'human_authorization' }> =>
      event.event === 'human_authorization' && event.run_id === runId
  )

  if (authorizations.length === 0) {
    return { resumed: false, state: 'WAITING_HUMAN', reason: 'no human authorization event found' }
  }

  const latest = authorizations[authorizations.length - 1]

  if (!allowedAuthorizers.includes(latest.authorized_by)) {
    return {
      resumed: false,
      state: 'WAITING_HUMAN',
      reason: `authorizer "${latest.authorized_by}" is not on the allowlist`,
    }
  }

  if (Date.parse(latest.expires_at) <= now.getTime()) {
    return { resumed: false, state: 'WAITING_HUMAN', reason: 'authorization has expired' }
  }

  assertTransition('WAITING_HUMAN', latest.resume_state)
  return {
    resumed: true,
    state: latest.resume_state,
    reason: `resumed by ${latest.authorized_by}`,
  }
}
