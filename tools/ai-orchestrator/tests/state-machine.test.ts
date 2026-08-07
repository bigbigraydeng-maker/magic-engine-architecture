import { describe, expect, it } from 'vitest'

import { IllegalTransitionError } from '../src/domain/errors'
import type { LedgerEvent, RunState } from '../src/domain/schema'
import {
  actorForState,
  allowedTransitionsFrom,
  assertTransition,
  canTransition,
  initialTurnState,
  isTerminal,
  nextStateForVerdict,
  resumeFromWaitingHuman,
} from '../src/domain/state-machine'

const NOW = new Date('2026-08-07T00:00:00.000Z')

function authorizationEvent(overrides: Partial<Extract<LedgerEvent, { event: 'human_authorization' }>> = {}): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: 'run-1',
    at: NOW.toISOString(),
    event: 'human_authorization',
    authorized_by: 'bigbigraydeng-maker',
    grants: ['resume'],
    resume_state: 'CLAUDE_TURN',
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    ...overrides,
  }
}

describe('legal transitions', () => {
  it('allows the ordinary review cycle', () => {
    expect(canTransition('READY', 'GPT_TURN')).toBe(true)
    expect(canTransition('GPT_TURN', 'CLAUDE_TURN')).toBe(true)
    expect(canTransition('CLAUDE_TURN', 'GPT_TURN')).toBe(true)
    expect(canTransition('GPT_TURN', 'APPROVED_FOR_HUMAN_MERGE')).toBe(true)
  })

  it('rejects transitions that skip the reviewer', () => {
    expect(canTransition('READY', 'APPROVED_FOR_HUMAN_MERGE')).toBe(false)
    expect(canTransition('CLAUDE_TURN', 'APPROVED_FOR_HUMAN_MERGE')).toBe(false)
  })

  it('throws a typed error on an illegal transition', () => {
    expect(() => assertTransition('CLAUDE_TURN', 'APPROVED_FOR_HUMAN_MERGE')).toThrow(
      IllegalTransitionError
    )
  })
})

describe('terminal states', () => {
  const terminals: RunState[] = [
    'APPROVED_FOR_HUMAN_MERGE',
    'FAILED',
    'BUDGET_EXHAUSTED',
    'CANCELLED',
  ]

  it.each(terminals)('%s has no outgoing transitions', (state) => {
    expect(isTerminal(state)).toBe(true)
    expect(allowedTransitionsFrom(state)).toHaveLength(0)
    expect(actorForState(state)).toBeNull()
  })

  it('a terminal run cannot be restarted by any state', () => {
    for (const terminal of terminals) {
      for (const target of ['GPT_TURN', 'CLAUDE_TURN', 'READY'] as RunState[]) {
        expect(canTransition(terminal, target)).toBe(false)
      }
    }
  })
})

describe('actor routing', () => {
  it('maps turn states to their owning actor', () => {
    expect(actorForState('GPT_TURN')).toBe('gpt_reviewer')
    expect(actorForState('CLAUDE_TURN')).toBe('claude_implementer')
    expect(actorForState('WAITING_HUMAN')).toBeNull()
  })

  it('starts DESIGN and REVIEW with the reviewer, IMPLEMENT with the implementer', () => {
    expect(initialTurnState('DESIGN')).toBe('GPT_TURN')
    expect(initialTurnState('REVIEW')).toBe('GPT_TURN')
    expect(initialTurnState('IMPLEMENT')).toBe('CLAUDE_TURN')
  })
})

describe('verdict mapping', () => {
  it('only ends the run on approval in REVIEW mode', () => {
    expect(nextStateForVerdict('REVIEW', 'APPROVED_FOR_NEXT_STAGE')).toBe('APPROVED_FOR_HUMAN_MERGE')
    expect(nextStateForVerdict('DESIGN', 'APPROVED_FOR_NEXT_STAGE')).toBe('CLAUDE_TURN')
    expect(nextStateForVerdict('IMPLEMENT', 'APPROVED_FOR_NEXT_STAGE')).toBe('CLAUDE_TURN')
  })

  it('parks policy violations where a human has to look', () => {
    expect(nextStateForVerdict('REVIEW', 'STOP_POLICY_VIOLATION')).toBe('WAITING_HUMAN')
    expect(nextStateForVerdict('REVIEW', 'WAITING_HUMAN')).toBe('WAITING_HUMAN')
  })
})

describe('WAITING_HUMAN never resumes on its own', () => {
  it('stays parked with no authorization event', () => {
    const decision = resumeFromWaitingHuman({
      runId: 'run-1',
      events: [],
      allowedAuthorizers: ['bigbigraydeng-maker'],
      now: NOW,
    })
    expect(decision.resumed).toBe(false)
    expect(decision.state).toBe('WAITING_HUMAN')
    expect(decision.reason).toContain('no human authorization')
  })

  it('stays parked when a stream of unrelated events arrives', () => {
    const events: LedgerEvent[] = [
      { schema_version: 'v1', run_id: 'run-1', at: NOW.toISOString(), event: 'state_changed', from: 'CLAUDE_TURN', to: 'WAITING_HUMAN', reason: 'policy violation' },
      { schema_version: 'v1', run_id: 'run-1', at: NOW.toISOString(), event: 'lease_released', lock_key: 'o/r#1', holder: 'gha-1' },
    ]
    expect(resumeFromWaitingHuman({ runId: 'run-1', events, allowedAuthorizers: ['x'], now: NOW }).resumed).toBe(false)
  })

  it('rejects an authorization from a login that is not on the allowlist', () => {
    const decision = resumeFromWaitingHuman({
      runId: 'run-1',
      events: [authorizationEvent({ authorized_by: 'random-contributor' })],
      allowedAuthorizers: ['bigbigraydeng-maker'],
      now: NOW,
    })
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('not on the allowlist')
  })

  it('rejects an authorization that belongs to a different run', () => {
    const decision = resumeFromWaitingHuman({
      runId: 'run-1',
      events: [authorizationEvent({ run_id: 'run-2' })],
      allowedAuthorizers: ['bigbigraydeng-maker'],
      now: NOW,
    })
    expect(decision.resumed).toBe(false)
  })

  it('rejects an expired authorization', () => {
    const decision = resumeFromWaitingHuman({
      runId: 'run-1',
      events: [authorizationEvent({ expires_at: new Date(NOW.getTime() - 1).toISOString() })],
      allowedAuthorizers: ['bigbigraydeng-maker'],
      now: NOW,
    })
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('expired')
  })

  it('resumes only on a valid, unexpired, allowlisted authorization', () => {
    const decision = resumeFromWaitingHuman({
      runId: 'run-1',
      events: [authorizationEvent()],
      allowedAuthorizers: ['bigbigraydeng-maker'],
      now: NOW,
    })
    expect(decision).toEqual({
      resumed: true,
      state: 'CLAUDE_TURN',
      reason: 'resumed by bigbigraydeng-maker',
    })
  })
})
