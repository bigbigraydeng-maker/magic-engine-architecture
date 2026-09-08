import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushFactoryWorkerItems, type ManualItem } from '../manual-items'

const now = new Date('2026-09-08T10:00:00Z')
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()
type Order = { client_id: string; created_at: string; heartbeat_at: string | null; status: string; reject_reason: string | null }
const queued = (client_id: string): Order => ({ client_id, status: 'queued', created_at: ago(40), heartbeat_at: null, reject_reason: 'temporary error' })
const heartbeat = (client_id: string, hours: number): Order => ({ ...queued(client_id), status: 'completed', heartbeat_at: ago(hours) })

// Apply filters, ordering and limits in query order against actual rows.
function database(rows: Order[]) {
  return { from: () => {
    let data = [...rows]
    const query = {
      select: () => query,
      eq: (key: keyof Order, value: unknown) => { data = data.filter(r => r[key] === value); return query },
      in: (key: keyof Order, values: unknown[]) => { data = data.filter(r => values.includes(r[key])); return query },
      not: (key: keyof Order, _op: string, value: unknown) => { data = data.filter(r => r[key] !== value); return query },
      order: (key: keyof Order, opts: { ascending: boolean }) => {
        data.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (opts.ascending ? 1 : -1)); return query
      },
      limit: (limit: number) => { data = data.slice(0, limit); return query },
      then: (resolve: (result: unknown) => unknown) => resolve({ data, error: null }),
    }
    return query
  } } as unknown as SupabaseClient
}

const names = new Map([['client-a', { name: 'Client A' }], ['client-b', { name: 'Client B' }]])

describe('factory worker evidence through todo generation', () => {
  it.each([499, 500, 501])('keeps client B online behind %i more recent client A heartbeats', async count => {
    const items: ManualItem[] = []
    await pushFactoryWorkerItems(database([
      queued('client-a'), queued('client-b'),
      ...Array.from({ length: count }, () => heartbeat('client-a', 0.1)), heartbeat('client-b', 0.2),
    ]), items, now, names)
    expect(items).toHaveLength(2)
    const clientB = items.find(item => item.what.includes('Client B'))!
    expect(clientB.what).toContain('工人在线')
    expect(clientB.how).not.toContain('--loop')
  })

  it.each([null, 30])('does not use client A heartbeats when B has missing/stale evidence (%s)', async hours => {
    const items: ManualItem[] = []
    await pushFactoryWorkerItems(database([
      queued('client-a'), queued('client-b'), heartbeat('client-a', 0.1),
      ...(hours === null ? [] : [heartbeat('client-b', hours)]),
    ]), items, now, names)
    const clientB = items.find(item => item.what.includes('Client B'))!
    expect(clientB.how).toContain('--loop')
    expect(clientB.what).toContain('temporary error')
    expect(clientB.what).not.toContain('工人在线')
  })
})
