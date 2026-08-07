/**
 * Money, and the two ways v0.1 could have leaked it.
 *
 * 1. A lease that expires mid-call lets a second runner start a second paid call.
 *    Re-checking the ledger afterwards deduplicates the *record*, not the *bill*.
 * 2. A cap compared only against settled spend can be crossed by the next call.
 *
 * The fixes are a reservation written before the call and a configuration
 * invariant that keeps a call strictly inside its lease. These tests exercise
 * both, including the case where duplicate spend cannot be prevented and must
 * instead be recorded.
 */

import { describe, expect, it } from 'vitest'

import { renderEventComment } from '../src/adapters/github/ledger'
import { computeBudgetLedger, foreignLiveClaim, remainingBudget } from '../src/domain/budget'
import type { LedgerEvent } from '../src/domain/schema'
import { SCAFFOLD_LEASE_TTL_MS, SCAFFOLD_LIMITS } from '../src/config/scaffold-config'
import { runOrchestration } from '../src/runner'
import { FIXED_NOW, implementerOutput, makeHarness, reviewerOutput } from './helpers'

const RUN_ID = 'run-test-001'

function startedEvent(overrides: Partial<Extract<LedgerEvent, { event: 'turn_started' }>> = {}): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: RUN_ID,
    at: FIXED_NOW.toISOString(),
    event: 'turn_started',
    actor: 'gpt_reviewer',
    round: 1,
    idempotency_key: 'key-1',
    input_digest: 'digest-1',
    holder: 'gha-run-first',
    reserved_cost_usd: 0.5,
    claim_expires_at: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
    ...overrides,
  }
}

describe('a turn reserves before it calls', () => {
  it('writes turn_started before the provider is invoked', async () => {
    const order: string[] = []
    const h = makeHarness({
      reviewerScript: [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }],
    })
    const github = {
      ...h.deps.github,
      name: 'ordering',
      listIssueComments: () => h.github.listIssueComments(),
      listIssueLabels: () => h.github.listIssueLabels(),
      listPullRequestFiles: (pr: number) => h.github.listPullRequestFiles(pr),
      getPullRequest: (pr: number) => h.github.getPullRequest(pr),
      createIssueComment: async (issue: number, body: string) => {
        if (body.includes('started round')) order.push('reserve')
        return h.github.createIssueComment(issue, body)
      },
    }
    const reviewer = {
      name: 'ordering-reviewer',
      review: async (request: Parameters<typeof h.reviewer.review>[0]) => {
        order.push('call')
        return h.reviewer.review(request)
      },
    }

    await runOrchestration(h.input, { ...h.deps, github, reviewer })

    expect(order).toEqual(['reserve', 'call'])
  })

  it('hands the provider its timeout, token ceiling and reservation', async () => {
    const h = makeHarness()
    await runOrchestration(h.input, h.deps)

    expect(h.reviewer.requests[0]).toMatchObject({
      timeout_ms: SCAFFOLD_LIMITS.provider_timeout_ms,
      max_output_tokens: SCAFFOLD_LIMITS.max_output_tokens,
      reserved_cost_usd: SCAFFOLD_LIMITS.max_turn_cost_usd,
    })
  })
})

describe('a configuration that could leak duplicate spend never makes a call', () => {
  it('refuses to run when the lease could lapse mid-call', async () => {
    const h = makeHarness({
      inputOverrides: { leaseTtlMs: SCAFFOLD_LIMITS.provider_timeout_ms - 1 },
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('configuration_invalid')
    expect(result.stopped_because).toContain('duplicate paid call')
    expect(h.reviewer.callCount).toBe(0)
  })

  it('runs on the scaffold configuration — the positive control', async () => {
    const h = makeHarness({ inputOverrides: { leaseTtlMs: SCAFFOLD_LEASE_TTL_MS } })
    const result = await runOrchestration(h.input, h.deps)
    expect(result.preflight.timing_invariant.ok).toBe(true)
    expect(h.reviewer.callCount).toBe(1)
  })
})

describe('a live claim stops a second runner from buying the same answer', () => {
  it('refuses to call while another holder has the turn claimed', async () => {
    const h = makeHarness()
    // Learn the key the next turn will use so the rival can claim exactly it.
    const probe = makeHarness({ dryRun: true })
    const key = (await runOrchestration(probe.input, probe.deps)).preflight.next_idempotency_key

    h.github.seedComment({
      author_login: 'me2-orchestrator-bot',
      body: renderEventComment(startedEvent({ idempotency_key: key as string })),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(0)
    expect(result.stopped_because).toContain('claimed by gha-run-first')
  })

  it('proceeds once the rival claim has lapsed', async () => {
    const h = makeHarness()
    const probe = makeHarness({ dryRun: true })
    const key = (await runOrchestration(probe.input, probe.deps)).preflight.next_idempotency_key

    h.github.seedComment({
      author_login: 'me2-orchestrator-bot',
      body: renderEventComment(
        startedEvent({
          idempotency_key: key as string,
          claim_expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString(),
        })
      ),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    // It runs, but the lapsed reservation is still charged: we cannot know the
    // crashed runner was not billed.
    expect(h.reviewer.callCount).toBe(1)
    expect(result.preflight.budget_ledger?.orphaned_reserved_usd).toBeCloseTo(0.5)
  })

  it('does not block a runner from re-entering its own claim', () => {
    const ledger = computeBudgetLedger([startedEvent()], RUN_ID, FIXED_NOW)
    expect(foreignLiveClaim(ledger, 'key-1', 'gha-run-first')).toBeNull()
    expect(foreignLiveClaim(ledger, 'key-1', 'gha-run-second')).toMatchObject({
      holder: 'gha-run-first',
    })
  })
})

describe('lease takeover never produces unrecorded duplicate spend', () => {
  it('charges the orphaned reservation of the runner that vanished', () => {
    const ledger = computeBudgetLedger(
      [startedEvent({ claim_expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString() })],
      RUN_ID,
      FIXED_NOW
    )
    expect(ledger.orphaned_reserved_usd).toBeCloseTo(0.5)
    expect(ledger.outstanding_reserved_usd).toBe(0)
    expect(remainingBudget(2, ledger)).toBeCloseTo(1.5)
  })

  it('releases nothing when the crashed runner is simply gone', () => {
    // The tempting bug: treat an expired claim as "never happened" and hand the
    // budget back. That turns a crash loop into unbounded spend.
    const many = Array.from({ length: 4 }, (_unused, index) =>
      startedEvent({
        idempotency_key: `key-${index}`,
        claim_expires_at: new Date(FIXED_NOW.getTime() - 1).toISOString(),
      })
    )
    const ledger = computeBudgetLedger(many, RUN_ID, FIXED_NOW)
    expect(remainingBudget(2, ledger)).toBe(0)
  })

  it('records the spend when a race could not be prevented', async () => {
    // Established in runner.test.ts: the losing runner writes
    // duplicate_spend_recorded rather than discarding the cost with the result.
    const h = makeHarness()
    const probe = makeHarness({ dryRun: true })
    const preflight = (await runOrchestration(probe.input, probe.deps)).preflight

    const rival: LedgerEvent = {
      schema_version: 'v1',
      run_id: RUN_ID,
      at: FIXED_NOW.toISOString(),
      event: 'turn_completed',
      actor: 'gpt_reviewer',
      round: 1,
      idempotency_key: preflight.next_idempotency_key as string,
      input_digest: preflight.next_input_digest as string,
      verdict: 'REQUEST_CHANGES',
      reserved_cost_usd: 0.5,
      cost_usd: 0.05,
      output_digest: 'rival',
      authoritative: null,
      self_report_mismatches: [],
      next_state: 'CLAUDE_TURN',
    }

    let reads = 0
    const github = {
      name: 'racing',
      listIssueLabels: () => h.github.listIssueLabels(),
      createIssueComment: (issue: number, body: string) => h.github.createIssueComment(issue, body),
      listPullRequestFiles: (pr: number) => h.github.listPullRequestFiles(pr),
      getPullRequest: (pr: number) => h.github.getPullRequest(pr),
      listIssueComments: async () => {
        reads += 1
        if (reads === 2) {
          h.github.seedComment({
            author_login: 'me2-orchestrator-bot',
            body: renderEventComment(rival),
            created_at: FIXED_NOW.toISOString(),
          })
        }
        return h.github.listIssueComments()
      },
    }

    const result = await runOrchestration(h.input, { ...h.deps, github })

    const duplicate = result.appended.find((e) => e.event === 'duplicate_spend_recorded')
    expect(duplicate).toBeDefined()
    expect(duplicate && 'cost_usd' in duplicate && duplicate.cost_usd).toBeCloseTo(0.05)
  })
})

describe('the cost cap is a ceiling', () => {
  it('makes zero provider calls when the next turn would not fit', async () => {
    // $1.80 committed of a $2.00 cap. A turn reserves $0.50. Nothing has
    // overspent, and nothing may start.
    const h = makeHarness()
    const settled: LedgerEvent = {
      schema_version: 'v1',
      run_id: RUN_ID,
      at: FIXED_NOW.toISOString(),
      event: 'turn_completed',
      actor: 'gpt_reviewer',
      round: 1,
      idempotency_key: 'earlier-turn',
      input_digest: 'earlier',
      verdict: 'REQUEST_CHANGES',
      reserved_cost_usd: 0.5,
      cost_usd: 1.8,
      output_digest: 'x',
      authoritative: null,
      self_report_mismatches: [],
      next_state: 'GPT_TURN',
    }
    h.github.seedComment({
      author_login: 'me2-orchestrator-bot',
      body: renderEventComment(settled),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(0)
    expect(h.implementer.callCount).toBe(0)
    expect(result.run.state).toBe('BUDGET_EXHAUSTED')
    expect(result.run.stop_reason).toBe('cost_cap_reached')
    expect(result.run.cumulative_cost_usd).toBeLessThanOrEqual(2)
  })

  it('makes the call when the reservation does fit — the positive control', async () => {
    const h = makeHarness()
    const settled: LedgerEvent = {
      schema_version: 'v1',
      run_id: RUN_ID,
      at: FIXED_NOW.toISOString(),
      event: 'turn_completed',
      actor: 'gpt_reviewer',
      round: 1,
      idempotency_key: 'earlier-turn',
      input_digest: 'earlier',
      verdict: 'REQUEST_CHANGES',
      reserved_cost_usd: 0.5,
      cost_usd: 1.4,
      output_digest: 'x',
      authoritative: null,
      self_report_mismatches: [],
      next_state: 'GPT_TURN',
    }
    h.github.seedComment({
      author_login: 'me2-orchestrator-bot',
      body: renderEventComment(settled),
      created_at: FIXED_NOW.toISOString(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(h.reviewer.callCount).toBe(1)
    expect(result.run.state).toBe('APPROVED_FOR_HUMAN_MERGE')
  })

  it('never lets the committed total exceed the cap across a whole run', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'DESIGN', max_rounds: 50, cost_cap_usd: 1 },
      inputOverrides: {
        limits: { ...SCAFFOLD_LIMITS, max_rounds: 50, cost_cap_usd: 1, max_turn_cost_usd: 0.25 },
      },
      reviewerScript: [{ output: reviewerOutput({ verdict: 'REQUEST_CHANGES' }), usage: { cost_usd: 0.25 } }],
      implementerScript: [{ output: implementerOutput(), usage: { cost_usd: 0.25 } }],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.stop_reason).toBe('cost_cap_reached')
    expect(result.run.cumulative_cost_usd).toBeLessThanOrEqual(1)
  })
})

describe('a call that never comes back still costs money', () => {
  it('settles the full reservation on timeout and parks the run', async () => {
    const h = makeHarness({
      inputOverrides: { limits: { ...SCAFFOLD_LIMITS, provider_timeout_ms: 20 }, leaseTtlMs: 10 * 60_000 },
      reviewerScript: [{ output: reviewerOutput(), delayMs: 200 }],
    })

    const result = await runOrchestration(h.input, h.deps)

    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected).toMatchObject({ reason: 'provider_timeout' })
    expect(rejected && 'cost_usd' in rejected && rejected.cost_usd).toBeCloseTo(
      SCAFFOLD_LIMITS.max_turn_cost_usd
    )
    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.cumulative_cost_usd).toBeCloseTo(SCAFFOLD_LIMITS.max_turn_cost_usd)
  })

  it('settles the full reservation when the provider throws', async () => {
    const h = makeHarness({
      reviewerScript: [{ output: null, throws: 'connection reset' }],
    })

    const result = await runOrchestration(h.input, h.deps)

    const rejected = result.appended.find((e) => e.event === 'turn_rejected')
    expect(rejected).toMatchObject({ reason: 'provider_error' })
    expect(result.run.cumulative_cost_usd).toBeCloseTo(SCAFFOLD_LIMITS.max_turn_cost_usd)
    expect(result.run.state).toBe('WAITING_HUMAN')
  })
})
