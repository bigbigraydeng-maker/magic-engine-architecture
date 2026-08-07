import { describe, expect, it } from 'vitest'

import { currentLease, evaluateLeaseAcquisition, leaseKeyFor } from '../src/domain/lease'
import type { LedgerEvent } from '../src/domain/schema'

const NOW = new Date('2026-08-07T00:00:00.000Z')
const LOCK = leaseKeyFor({ owner: 'bigbigraydeng-maker', repo: 'magic-engine' }, 860)
const TTL = 10 * 60 * 1000

function acquired(holder: string, expiresAt: Date, runId = 'run-a'): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: runId,
    at: NOW.toISOString(),
    event: 'lease_acquired',
    lock_key: LOCK,
    holder,
    expires_at: expiresAt.toISOString(),
    took_over_from: null,
  }
}

function released(holder: string, runId = 'run-a'): LedgerEvent {
  return {
    schema_version: 'v1',
    run_id: runId,
    at: NOW.toISOString(),
    event: 'lease_released',
    lock_key: LOCK,
    holder,
  }
}

describe('concurrent runs', () => {
  it('gives the lease to the first runner and refuses the second', () => {
    const first = evaluateLeaseAcquisition({ events: [], lockKey: LOCK, holder: 'gha-1', now: NOW, ttlMs: TTL })
    expect(first).toMatchObject({ acquired: true, took_over_from: null })

    // The first runner's event is now in the shared ledger.
    const ledger: LedgerEvent[] = [acquired('gha-1', new Date(NOW.getTime() + TTL))]

    const second = evaluateLeaseAcquisition({
      events: ledger,
      lockKey: LOCK,
      holder: 'gha-2',
      now: new Date(NOW.getTime() + 1000),
      ttlMs: TTL,
    })
    expect(second).toMatchObject({ acquired: false, held_by: 'gha-1' })
  })

  it('lets a different Issue proceed in parallel', () => {
    const otherLock = leaseKeyFor({ owner: 'bigbigraydeng-maker', repo: 'magic-engine' }, 859)
    const result = evaluateLeaseAcquisition({
      events: [acquired('gha-1', new Date(NOW.getTime() + TTL))],
      lockKey: otherLock,
      holder: 'gha-2',
      now: NOW,
      ttlMs: TTL,
    })
    expect(result.acquired).toBe(true)
  })
})

describe('stale lock recovery', () => {
  it('lets a new runner take over an expired lease and records who it took it from', () => {
    const result = evaluateLeaseAcquisition({
      events: [acquired('gha-crashed', new Date(NOW.getTime() - 1))],
      lockKey: LOCK,
      holder: 'gha-2',
      now: NOW,
      ttlMs: TTL,
    })
    expect(result).toMatchObject({ acquired: true, took_over_from: 'gha-crashed' })
  })

  it('marks a lease stale exactly at its expiry, not after', () => {
    const expiry = new Date(NOW.getTime() + TTL)
    const events = [acquired('gha-1', expiry)]
    expect(currentLease(events, LOCK, new Date(expiry.getTime() - 1))?.stale).toBe(false)
    expect(currentLease(events, LOCK, expiry)?.stale).toBe(true)
  })
})

describe('release and re-entry', () => {
  it('frees the lock after release', () => {
    const events = [acquired('gha-1', new Date(NOW.getTime() + TTL)), released('gha-1')]
    expect(currentLease(events, LOCK, NOW)).toBeNull()
    expect(
      evaluateLeaseAcquisition({ events, lockKey: LOCK, holder: 'gha-2', now: NOW, ttlMs: TTL }).acquired
    ).toBe(true)
  })

  it('lets the same holder extend its own live lease', () => {
    const result = evaluateLeaseAcquisition({
      events: [acquired('gha-1', new Date(NOW.getTime() + TTL))],
      lockKey: LOCK,
      holder: 'gha-1',
      now: NOW,
      ttlMs: TTL,
    })
    expect(result).toMatchObject({ acquired: true, took_over_from: null })
  })
})
