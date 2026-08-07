/**
 * The human gate, end to end, against the **actual scaffold config**.
 *
 * Two defects live here, both found in review, both of the same shape: an
 * approval that meant more than the person giving it intended.
 *
 * 1. `TRUSTED_LEDGER_AUTHORS` held only the bot, so the owner's own
 *    authorization was discarded at decode time and a parked run could never be
 *    released — the gate was shut in both directions.
 * 2. `resumeFromWaitingHuman` took the run's most recent authorization without
 *    checking *which block* it was for. One approval in round 2 therefore
 *    released a different, unreviewed block in round 5. Approving one risk gate
 *    is not approving every future one.
 *
 * So an authorization now names a `wait_id`, must be written after that wait
 * opened, and must grant the specific reason that blocked the run. These tests
 * import the real author lists, so a drift there fails the build.
 */

import { describe, expect, it } from 'vitest'

import { decodeComment, renderEventComment } from '../src/adapters/github/ledger'
import { ALLOWED_AUTHORIZERS, TRUSTED_LEDGER_AUTHORS } from '../src/config/scaffold-config'
import { currentOpenWait, resumeFromWaitingHuman } from '../src/domain/state-machine'
import type { LedgerEvent } from '../src/domain/schema'
import { runOrchestration } from '../src/runner'
import { FIXED_NOW, implementerOutput, makeHarness, reviewerOutput, workspaceState } from './helpers'

const OWNER = ALLOWED_AUTHORIZERS[0]
const BOT = TRUSTED_LEDGER_AUTHORS[0]
const RUN_ID = 'run-test-001'

const TRUST = {
  machineAuthors: [...TRUSTED_LEDGER_AUTHORS],
  humanAuthorizers: [...ALLOWED_AUTHORIZERS],
}

function authorization(
  overrides: Partial<Extract<LedgerEvent, { event: 'human_authorization' }>> = {}
): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'human_authorization',
    authorized_by: OWNER,
    wait_id: 'wait-1',
    grants: ['policy_violation'],
    resume_state: 'GPT_TURN',
    expires_at: new Date(FIXED_NOW.getTime() + 600_000).toISOString(),
    ...overrides,
  }
}

function waitEvent(id: string, blockingReason = 'policy_violation'): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'state_changed',
    from: 'CLAUDE_TURN',
    to: 'WAITING_HUMAN',
    reason: 'blocked',
    wait: { id, blocking_reason: blockingReason },
    consumed_wait_id: null,
  }
}

function resumeEvent(consumedWaitId: string): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'state_changed',
    from: 'WAITING_HUMAN',
    to: 'GPT_TURN',
    reason: 'resumed',
    wait: null,
    consumed_wait_id: consumedWaitId,
  }
}

function comment(author: string, event: LedgerEvent, id = 1) {
  return {
    id,
    author_login: author,
    body: renderEventComment(event),
    created_at: FIXED_NOW.toISOString(),
  }
}

const resume = (events: readonly LedgerEvent[], now = FIXED_NOW) =>
  resumeFromWaitingHuman({ runId: RUN_ID, events, allowedAuthorizers: [OWNER], now })

// ─────────────────────────────────────────────────────────────────────────────
// One authorization releases one block
// ─────────────────────────────────────────────────────────────────────────────

describe('an authorization is spent on the block it names', () => {
  it('1. the first authorization releases the first wait', () => {
    const decision = resume([waitEvent('wait-1'), authorization({ wait_id: 'wait-1' })])
    expect(decision).toMatchObject({ resumed: true, state: 'GPT_TURN', consumed_wait_id: 'wait-1' })
  })

  it('2. a second wait cannot reuse the first authorization', () => {
    // This is the defect: the round-2 approval is still unexpired, and under the
    // old rule it silently released the round-5 block too.
    const events = [
      waitEvent('wait-1'),
      authorization({ wait_id: 'wait-1' }),
      resumeEvent('wait-1'),
      waitEvent('wait-2'),
    ]
    const decision = resume(events)
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('wait-2')
  })

  it('3. an authorization naming a different wait is not an authorization for this one', () => {
    const decision = resume([waitEvent('wait-2'), authorization({ wait_id: 'wait-1' })])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('no authorization names wait "wait-2"')
  })

  it('4a. an authorization written before its wait does not count', () => {
    // Ordering matters: approving something that has not happened yet is not
    // approval, it is a blank cheque.
    const decision = resume([authorization({ wait_id: 'wait-1' }), waitEvent('wait-1')])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('predates the wait')
  })

  it('4b. an expired authorization does not count', () => {
    const decision = resume([
      waitEvent('wait-1'),
      authorization({ expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString() }),
    ])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('expired')
  })

  it('4c. an already-consumed authorization does not count', () => {
    const events = [waitEvent('wait-1'), authorization({ wait_id: 'wait-1' }), resumeEvent('wait-1')]
    expect(currentOpenWait(events, RUN_ID)).toBeNull()
    expect(resume(events).resumed).toBe(false)
  })

  it('5. a fresh authorization for the second wait resumes it', () => {
    const events = [
      waitEvent('wait-1'),
      authorization({ wait_id: 'wait-1' }),
      resumeEvent('wait-1'),
      waitEvent('wait-2'),
      authorization({ wait_id: 'wait-2' }),
    ]
    expect(resume(events)).toMatchObject({ resumed: true, consumed_wait_id: 'wait-2' })
  })
})

describe('grants must cover the reason the run is actually blocked on', () => {
  it('refuses an approval that does not name the blocking reason', () => {
    const decision = resume([
      waitEvent('wait-1', 'self_report_mismatch'),
      authorization({ wait_id: 'wait-1', grants: ['cost_overrun'] }),
    ])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('blocked on "self_report_mismatch"')
  })

  it('accepts an approval that names it', () => {
    expect(
      resume([
        waitEvent('wait-1', 'self_report_mismatch'),
        authorization({ wait_id: 'wait-1', grants: ['self_report_mismatch'] }),
      ]).resumed
    ).toBe(true)
  })

  it('refuses an authorizer who is not on the allowlist', () => {
    const decision = resume([
      waitEvent('wait-1'),
      authorization({ authorized_by: 'drive-by-contributor' }),
    ])
    expect(decision.resumed).toBe(false)
    expect(decision.reason).toContain('not on the allowlist')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Decode-time trust
// ─────────────────────────────────────────────────────────────────────────────

describe('the owner can actually reach the ledger', () => {
  it("accepts the owner's own authorization at decode time", () => {
    expect(decodeComment(comment(OWNER, authorization()), TRUST)).toEqual({
      event: authorization(),
    })
  })

  it('rejects a marker whose authorized_by is not the comment author', () => {
    const decoded = decodeComment(comment('drive-by-contributor', authorization()), TRUST)
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain('untrusted author')
  })

  it("rejects the bot minting an authorization on the owner's behalf", () => {
    const decoded = decodeComment(comment(BOT, authorization()), TRUST)
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain(
      'may not mint a human authorization'
    )
  })

  it('rejects the owner claiming to be somebody else', () => {
    const decoded = decodeComment(
      comment(OWNER, authorization({ authorized_by: 'someone-with-more-rights' })),
      TRUST
    )
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain('GitHub says')
  })

  it('rejects a human writing any other kind of event', () => {
    const machineEvent: LedgerEvent = {
      schema_version: 'v1',
      run_id: RUN_ID,
      at: FIXED_NOW.toISOString(),
      event: 'run_finished',
      final_state: 'APPROVED_FOR_HUMAN_MERGE',
      stop_reason: 'reviewer_approved',
    }
    const decoded = decodeComment(comment(OWNER, machineEvent), TRUST)
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain(
      'may only write human_authorization'
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// End to end, through the runner, with the real config
// ─────────────────────────────────────────────────────────────────────────────

describe('end to end with the real scaffold author lists', () => {
  it('parks, then resumes on the owner comment, then parks again on the next block', async () => {
    // Round 1: the implementer breaches scope, so the run parks on a named wait.
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput({ files_changed: ['src/lib/forbidden.ts'] }) },
        { output: implementerOutput({ files_changed: ['src/lib/forbidden-again.ts'] }) },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }) }],
      workspace: [
        workspaceState({ file_fingerprints: {} }),
        workspaceState({ file_fingerprints: { 'src/lib/forbidden.ts': 'v1' } }),
      ],
    })

    const parked = await runOrchestration(h.input, h.deps)
    expect(parked.run.state).toBe('WAITING_HUMAN')

    const firstWait = parked.appended.find(
      (event) => event.event === 'turn_rejected' && event.wait !== null
    )
    expect(firstWait && 'wait' in firstWait && firstWait.wait?.id).toBeTruthy()
    const waitId = firstWait && 'wait' in firstWait ? (firstWait.wait?.id as string) : ''
    const blockingReason = firstWait && 'wait' in firstWait ? (firstWait.wait?.blocking_reason as string) : ''

    // Re-dispatching without an approval changes nothing.
    const stillParked = await runOrchestration(h.input, h.deps)
    expect(stillParked.run.state).toBe('WAITING_HUMAN')

    // The owner approves *this* wait, naming the reason.
    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({ wait_id: waitId, grants: [blockingReason], resume_state: 'GPT_TURN' })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const resumed = await runOrchestration(h.input, h.deps)
    expect(resumed.appended.some((event) => event.event === 'state_changed' && event.consumed_wait_id === waitId)).toBe(true)
  })

  it('does not resume on a forged authorization, end to end', async () => {
    const h = makeHarness({ runOverrides: { state: 'WAITING_HUMAN', current_round: 1 } })

    h.github.seedComment({
      author_login: 'drive-by-contributor',
      body: renderEventComment(authorization()),
      created_at: FIXED_NOW.toISOString(),
    })
    h.github.seedComment({
      author_login: BOT,
      body: renderEventComment(authorization()),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(h.reviewer.callCount).toBe(0)
    expect(result.preflight.ledger_rejected).toHaveLength(2)
  })
})

describe('the two author lists have to stay consistent with each other', () => {
  it('does not put a human authorizer on the machine list, or vice versa', () => {
    for (const human of ALLOWED_AUTHORIZERS) expect(TRUSTED_LEDGER_AUTHORS).not.toContain(human)
    for (const machine of TRUSTED_LEDGER_AUTHORS) expect(ALLOWED_AUTHORIZERS).not.toContain(machine)
  })

  it('leaves neither list empty, which would close the gate in one direction', () => {
    expect(TRUSTED_LEDGER_AUTHORS.length).toBeGreaterThan(0)
    expect(ALLOWED_AUTHORIZERS.length).toBeGreaterThan(0)
  })
})
