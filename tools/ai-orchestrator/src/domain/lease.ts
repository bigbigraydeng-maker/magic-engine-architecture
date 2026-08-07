/**
 * Run leases, derived purely from the ledger.
 *
 * GitHub Actions `concurrency` already serialises runs for the same Issue, but it
 * is a scheduling hint, not a lock: a cancelled runner, a manual dispatch from a
 * second branch, or a local invocation can all bypass it. The lease is the thing
 * that actually decides who may take a turn, and because it is a fold over ledger
 * events it can be tested without any IO.
 */

import type { LedgerEvent } from './schema'

export interface HeldLease {
  holder: string
  expires_at: string
  /** True when the lease is past its TTL and may be taken over. */
  stale: boolean
}

export function leaseKeyFor(repository: { owner: string; repo: string }, issueNumber: number): string {
  return `${repository.owner}/${repository.repo}#${issueNumber}`
}

/** The most recent unreleased lease for `lockKey`, or null when free. */
export function currentLease(
  events: readonly LedgerEvent[],
  lockKey: string,
  now: Date
): HeldLease | null {
  let held: HeldLease | null = null

  for (const event of events) {
    if (event.event === 'lease_acquired' && event.lock_key === lockKey) {
      held = {
        holder: event.holder,
        expires_at: event.expires_at,
        stale: Date.parse(event.expires_at) <= now.getTime(),
      }
    } else if (event.event === 'lease_released' && event.lock_key === lockKey) {
      held = null
    }
  }

  if (held) {
    held = { ...held, stale: Date.parse(held.expires_at) <= now.getTime() }
  }

  return held
}

export type LeaseAcquisition =
  | { acquired: true; took_over_from: string | null; expires_at: string }
  | { acquired: false; held_by: string; expires_at: string }

export function evaluateLeaseAcquisition(args: {
  events: readonly LedgerEvent[]
  lockKey: string
  holder: string
  now: Date
  ttlMs: number
}): LeaseAcquisition {
  const { events, lockKey, holder, now, ttlMs } = args
  const existing = currentLease(events, lockKey, now)
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()

  if (!existing) {
    return { acquired: true, took_over_from: null, expires_at: expiresAt }
  }

  // Re-entrant: the same holder re-running its own workflow extends its lease.
  if (existing.holder === holder) {
    return { acquired: true, took_over_from: null, expires_at: expiresAt }
  }

  if (existing.stale) {
    return { acquired: true, took_over_from: existing.holder, expires_at: expiresAt }
  }

  return { acquired: false, held_by: existing.holder, expires_at: existing.expires_at }
}
