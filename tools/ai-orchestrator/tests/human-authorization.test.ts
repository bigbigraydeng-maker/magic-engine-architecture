/**
 * The human gate, end to end, against the **actual scaffold config**.
 *
 * v0.2 had a gate that was shut in both directions: `TRUSTED_LEDGER_AUTHORS`
 * contained only the bot, so the owner's own `human_authorization` marker was
 * discarded at decode time and a parked run could never be released. Nothing
 * tested it, because every test supplied its own author lists.
 *
 * So these tests import `TRUSTED_LEDGER_AUTHORS` and `ALLOWED_AUTHORIZERS`
 * directly. If the two lists ever drift apart again, this file fails.
 */

import { describe, expect, it } from 'vitest'

import { decodeComment, renderEventComment } from '../src/adapters/github/ledger'
import { ALLOWED_AUTHORIZERS, TRUSTED_LEDGER_AUTHORS } from '../src/config/scaffold-config'
import type { LedgerEvent } from '../src/domain/schema'
import { runOrchestration } from '../src/runner'
import { FIXED_NOW, makeHarness, reviewerOutput } from './helpers'

const OWNER = ALLOWED_AUTHORIZERS[0]
const BOT = TRUSTED_LEDGER_AUTHORS[0]

const TRUST = {
  machineAuthors: [...TRUSTED_LEDGER_AUTHORS],
  humanAuthorizers: [...ALLOWED_AUTHORIZERS],
}

function authorization(overrides: Partial<Extract<LedgerEvent, { event: 'human_authorization' }>> = {}): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: 'run-test-001',
    at: FIXED_NOW.toISOString(),
    event: 'human_authorization',
    authorized_by: OWNER,
    grants: ['resume'],
    resume_state: 'GPT_TURN',
    expires_at: new Date(FIXED_NOW.getTime() + 600_000).toISOString(),
    ...overrides,
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

describe('the owner can actually release a parked run', () => {
  it('accepts the owner\'s own authorization at decode time', () => {
    const decoded = decodeComment(comment(OWNER, authorization()), TRUST)
    expect(decoded).toEqual({ event: authorization() })
  })

  it('resumes a WAITING_HUMAN run with the real scaffold author lists', async () => {
    const h = makeHarness({
      runOverrides: { state: 'WAITING_HUMAN', current_round: 1 },
      reviewerScript: [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
    })

    const parked = await runOrchestration(h.input, h.deps)
    expect(parked.run.state).toBe('WAITING_HUMAN')
    expect(h.reviewer.callCount).toBe(0)
    expect(h.github.writeCount).toBe(0)

    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(authorization()),
      created_at: FIXED_NOW.toISOString(),
    })

    const resumed = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(1)
    expect(resumed.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })
})

describe('an authorization cannot be forged', () => {
  it('rejects a marker whose authorized_by is not the comment author', () => {
    // The owner's login pasted into a marker written by somebody else.
    const decoded = decodeComment(comment('drive-by-contributor', authorization()), TRUST)
    expect(decoded).toMatchObject({ rejected: { comment_id: 1 } })
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain('untrusted author')
  })

  it('rejects the bot minting an authorization on the owner\'s behalf', () => {
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
    expect(decoded && 'rejected' in decoded && decoded.rejected.reason).toContain(
      'GitHub says'
    )
  })

  it('rejects a human writing any other kind of event', () => {
    const machineEvent: LedgerEvent = {
      schema_version: 'v1',
      run_id: 'run-test-001',
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

  it('does not resume on a forged authorization, end to end', async () => {
    const h = makeHarness({ runOverrides: { state: 'WAITING_HUMAN', current_round: 1 } })

    // Both forgery shapes at once: an outsider claiming to be the owner, and the
    // bot minting the owner's approval.
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
    // Both were surfaced rather than silently dropped.
    expect(result.preflight.ledger_rejected).toHaveLength(2)
  })

  it('does not resume on an expired authorization from the real owner', async () => {
    const h = makeHarness({ runOverrides: { state: 'WAITING_HUMAN', current_round: 1 } })
    h.github.seedComment({
      author_login: OWNER,
      body: renderEventComment(
        authorization({ expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString() })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.stopped_because).toContain('expired')
    expect(h.reviewer.callCount).toBe(0)
  })
})

describe('the two author lists have to stay consistent with each other', () => {
  it('does not put a human authorizer on the machine list, or vice versa', () => {
    for (const human of ALLOWED_AUTHORIZERS) {
      expect(TRUSTED_LEDGER_AUTHORS).not.toContain(human)
    }
    for (const machine of TRUSTED_LEDGER_AUTHORS) {
      expect(ALLOWED_AUTHORIZERS).not.toContain(machine)
    }
  })

  it('leaves neither list empty, which would close the gate in one direction', () => {
    expect(TRUSTED_LEDGER_AUTHORS.length).toBeGreaterThan(0)
    expect(ALLOWED_AUTHORIZERS.length).toBeGreaterThan(0)
  })
})
