/**
 * Portal layout gating — added to prove the fix for the primary invite
 * path: a portal-only invitee whose middleware has scoped them to
 * exactly this clientId must actually render the portal workspace, not
 * be unconditionally 308ed into /dashboard and then bounced to
 * /unauthorized by dashboard middleware. Every other visitor keeps the
 * pre-existing dashboard-unification redirect.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'

// ── Mocks (must be declared before importing the layout) ────────────────────

const headersMock = vi.fn(() => ({ get: (_k: string) => null as string | null }))
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}))

// Both redirect and permanentRedirect in next/navigation throw a sentinel
// error. Mimic that so we can inspect which one was called with which URL
// without triggering Next's internal machinery.
class RedirectCall extends Error {
  constructor(public kind: 'redirect' | 'permanentRedirect', public url: string) {
    super(`${kind}:${url}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new RedirectCall('redirect', url) },
  permanentRedirect: (url: string) => { throw new RedirectCall('permanentRedirect', url) },
}))

const clientRowMock = vi.fn(async () => ({ data: null as { id: string; name: string } | null }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => clientRowMock(),
        }),
      }),
    }),
  },
}))

vi.mock('../_components/PortalNav', () => ({
  default: ({ clientName }: { clientId: string; clientName: string }) =>
    <div data-testid="portal-nav">{clientName}</div>,
}))

import PortalLayout from '../layout'

function setHeaders(map: Record<string, string | null>) {
  headersMock.mockReturnValue({
    get: (k: string) => (k in map ? map[k] : null),
  })
}

async function tryRender(clientId: string): Promise<
  | { kind: 'rendered'; html: string }
  | { kind: 'redirect' | 'permanentRedirect'; url: string }
> {
  try {
    const node = await PortalLayout({
      params: { clientId },
      children: <p data-testid="portal-child">page content</p>,
    })
    return { kind: 'rendered', html: renderToString(node as React.ReactElement) }
  } catch (err) {
    if (err instanceof RedirectCall) {
      return { kind: err.kind, url: err.url }
    }
    throw err
  }
}

describe('portal/[clientId] layout — invite-destination render gate', () => {
  beforeEach(() => {
    headersMock.mockReset()
    clientRowMock.mockReset()
    clientRowMock.mockResolvedValue({ data: { id: 'client-b-uuid', name: 'CTS Tours NZ' } })
  })

  it('renders the portal workspace for a portal-only visitor on their EXACT client — never dashboard, never /unauthorized', async () => {
    // The end-to-end assertion the receipt was missing: middleware would
    // have set these two headers for a portal-tier invitee, and the
    // layout must convert that into real rendered content.
    setHeaders({
      'x-user-tier': 'portal_only',
      'x-allowed-client-id': 'client-b-uuid',
    })

    const result = await tryRender('client-b-uuid')

    expect(result.kind).toBe('rendered')
    if (result.kind !== 'rendered') return
    expect(result.html).toContain('page content')
    expect(result.html).toContain('CTS Tours NZ')
  })

  it('keeps the pre-existing dashboard 308 for both-tier visitors', async () => {
    setHeaders({
      'x-user-tier': 'paid_client',
      'x-allowed-client-id': 'client-b-uuid',
    })

    const result = await tryRender('client-b-uuid')

    expect(result).toEqual({ kind: 'permanentRedirect', url: '/dashboard/clients/client-b-uuid' })
  })

  it('keeps the pre-existing dashboard 308 for dashboard/fde/client visitors (paid_client tier)', async () => {
    // paid_client covers dashboard, fde, client, both — see access-types.ts.
    setHeaders({
      'x-user-tier': 'paid_client',
      'x-allowed-client-id': 'client-b-uuid',
    })

    const result = await tryRender('client-b-uuid')

    expect(result).toEqual({ kind: 'permanentRedirect', url: '/dashboard/clients/client-b-uuid' })
  })

  it('keeps the pre-existing dashboard 308 for a direct hit with no middleware headers', async () => {
    // If the request somehow bypassed middleware, no portal_only tier was
    // asserted, so we must NOT open the portal. Fall back to the same
    // dashboard redirect a normal visitor would get.
    setHeaders({})

    const result = await tryRender('client-b-uuid')

    expect(result).toEqual({ kind: 'permanentRedirect', url: '/dashboard/clients/client-b-uuid' })
  })

  it('does NOT render the portal for a portal_only tier whose allowedClientId is a DIFFERENT client (wrong-client denial)', async () => {
    // Middleware guarantees allowedClientId matches the target on the
    // portal_only path, but if a race / misroute produced a mismatch, we
    // must not silently render the wrong client's workspace. Falling to
    // the dashboard 308 is safe — dashboard middleware then rejects a
    // portal-only user for the mismatched clientId, ending at
    // /unauthorized rather than a wrong-customer render.
    setHeaders({
      'x-user-tier': 'portal_only',
      'x-allowed-client-id': 'client-a-uuid',
    })

    const result = await tryRender('client-b-uuid')

    expect(result.kind).toBe('permanentRedirect')
    if (result.kind !== 'permanentRedirect') return
    expect(result.url).toBe('/dashboard/clients/client-b-uuid')
  })

  it('fails closed to /unauthorized when tier IS portal_only but no allowedClientId header is set at all', async () => {
    // Edge belt-and-braces: portal_only with a missing scoping header.
    // The exact-match check `allowedClientId === params.clientId` is
    // false, so we fall to the dashboard-redirect branch instead of
    // rendering.
    setHeaders({ 'x-user-tier': 'portal_only' })

    const result = await tryRender('client-b-uuid')

    expect(result.kind).toBe('permanentRedirect')
    if (result.kind !== 'permanentRedirect') return
    expect(result.url).toBe('/dashboard/clients/client-b-uuid')
  })

  it('renders portal_only for the exact client even when the client name query returns a valid row', async () => {
    // Sanity: the client lookup still runs on the portal_only branch and
    // its name flows into the nav.
    clientRowMock.mockResolvedValueOnce({ data: { id: 'client-b-uuid', name: 'Custom Co' } })
    setHeaders({
      'x-user-tier': 'portal_only',
      'x-allowed-client-id': 'client-b-uuid',
    })

    const result = await tryRender('client-b-uuid')

    expect(result.kind).toBe('rendered')
    if (result.kind !== 'rendered') return
    expect(result.html).toContain('Custom Co')
  })

  it('bounces portal_only exact-client to /unauthorized when the client row is not found (deleted mid-flight)', async () => {
    // Prior behaviour preserved: unknown client → /unauthorized. This
    // proves the render gate does not open a portal for a phantom client.
    clientRowMock.mockResolvedValueOnce({ data: null })
    setHeaders({
      'x-user-tier': 'portal_only',
      'x-allowed-client-id': 'client-b-uuid',
    })

    const result = await tryRender('client-b-uuid')

    expect(result).toEqual({ kind: 'redirect', url: '/unauthorized' })
  })
})
