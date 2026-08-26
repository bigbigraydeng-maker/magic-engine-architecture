/**
 * Portal prescription — approved-only visibility.
 *
 * Draft prescriptions are internal FDE workflow state ("not yet approved
 * for customer execution"). Re-enabling the portal without narrowing the
 * query exposed drafts to customers — an unpublished-content boundary
 * break. These regressions pin the fix: the query filters `status =
 * 'approved'`, draft-only surfaces the honest not-ready state, and the
 * page cannot be tricked into fetching another client's row.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

// Capture every .eq(column, value) call on the prescriptions query so we
// can assert the exact filter shape (client_id + status='approved').
const eqCalls: { column: string; value: unknown }[] = []
const maybeSingleMock = vi.fn(async () => ({ data: null as unknown }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push({ column: col, value: val })
          return {
            eq: (col2: string, val2: unknown) => {
              eqCalls.push({ column: col2, value: val2 })
              return {
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => maybeSingleMock(),
                  }),
                }),
              }
            },
          }
        },
      }),
    }),
  },
}))

import PortalPrescriptionPage from '../page'

beforeEach(() => {
  eqCalls.length = 0
  maybeSingleMock.mockReset()
  maybeSingleMock.mockResolvedValue({ data: null })
})

describe('portal prescription page — approved-only visibility', () => {
  it('queries ONLY approved prescriptions — never asks the DB for draft', async () => {
    await PortalPrescriptionPage({ params: { clientId: 'client-b-uuid' } })
    // Exact filter shape: client_id + status='approved'. No status='draft'
    // and no `.in('status', ['approved','draft'])` fall-through.
    expect(eqCalls).toEqual([
      { column: 'client_id', value: 'client-b-uuid' },
      { column: 'status', value: 'approved' },
    ])
    expect(eqCalls.some(c => c.column === 'status' && c.value === 'draft')).toBe(false)
  })

  it('renders the honest not-ready state when there is no approved prescription (draft-only or empty)', async () => {
    // The DB filter above returns null when only drafts exist. The page
    // MUST render the not-ready empty state and MUST NOT surface any
    // draft content as a fallback.
    maybeSingleMock.mockResolvedValueOnce({ data: null })

    const node = await PortalPrescriptionPage({ params: { clientId: 'client-b-uuid' } })
    const html = renderToString(node as React.ReactElement)

    expect(html).toContain('Your plan is being prepared')
    // Draft summary content shape — must never appear on the customer view.
    expect(html).not.toContain('The prioritised growth playbook')
    expect(html).not.toContain('Execution phases')
  })

  it('renders approved prescription content when present', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: 'p-approved',
        status: 'approved',
        content: {
          summary: 'APPROVED-SUMMARY visible to the customer.',
          phases: [{
            phase_number: 1,
            name: 'Foundation',
            duration_weeks: 2,
            actions: [{
              id: 'a1',
              fix_type: 'quick_fix',
              dimension: 'seo',
              effort: 'low',
              title: 'Publish tour landing pages',
            }],
          }],
        },
        generated_at: '2026-08-01T00:00:00Z',
        approved_at: '2026-08-15T00:00:00Z',
      },
    })

    const node = await PortalPrescriptionPage({ params: { clientId: 'client-b-uuid' } })
    const html = renderToString(node as React.ReactElement)

    expect(html).toContain('The prioritised growth playbook')
    expect(html).toContain('APPROVED-SUMMARY visible to the customer')
    expect(html).toContain('Publish tour landing pages')
    expect(html).toContain('Approved')
  })

  it('draft + approved coexist in DB → only the approved record is surfaced (the DB filter is the guarantee)', async () => {
    // A real DB scoped by our .eq('status', 'approved') filter returns
    // only approved rows, even when a newer draft is present alongside.
    // We simulate that by returning only the approved row for the
    // filtered query — and we ADDITIONALLY assert the filter shape so a
    // future rewrite that reintroduces `.in([...])` is caught here.
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: 'p-approved',
        status: 'approved',
        content: { summary: 'APPROVED-SUMMARY', phases: [] },
        approved_at: '2026-08-15T00:00:00Z',
      },
    })

    const node = await PortalPrescriptionPage({ params: { clientId: 'client-b-uuid' } })
    const html = renderToString(node as React.ReactElement)

    expect(html).toContain('APPROVED-SUMMARY')
    // A draft summary shape — must not leak through even by coincidence.
    expect(html).not.toContain('DRAFT-SUMMARY')
    // Belt-and-braces: the actual filter used was status='approved'.
    expect(eqCalls.some(c => c.column === 'status' && c.value === 'approved')).toBe(true)
    expect(eqCalls.some(c => c.column === 'status' && c.value === 'draft')).toBe(false)
  })

  it('scopes the prescription query to the exact clientId in params — cannot be tricked into another clients row', async () => {
    // Wrong-client denial is enforced upstream by middleware + layout
    // (proven in middleware.test.ts and layout.test.tsx). At the page
    // level, the query filter must faithfully use params.clientId so an
    // authorized visitor for client-b can NEVER pull client-a's data
    // through this route, no matter what layout/middleware regressed.
    await PortalPrescriptionPage({ params: { clientId: 'client-b-uuid' } })

    const clientIdCall = eqCalls.find(c => c.column === 'client_id')
    expect(clientIdCall?.value).toBe('client-b-uuid')

    eqCalls.length = 0
    await PortalPrescriptionPage({ params: { clientId: 'other-client-uuid' } })
    const secondClientIdCall = eqCalls.find(c => c.column === 'client_id')
    expect(secondClientIdCall?.value).toBe('other-client-uuid')
  })
})
