/**
 * 板桥 2026-08-11 PR6 复审: the 诸葛亮 FAB (internal FDE workbench, all-Chinese
 * UI) used to mount unconditionally for every visitor to /dashboard/clients/[id]
 * — including self_serve customers going through the plain-English onboarding
 * wizard. This locks in the fix: self_serve never sees it, everyone else does.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const headersMock = vi.fn<() => { get: (k: string) => string | null }>()
vi.mock('next/headers', () => ({
  headers: () => headersMock(),
}))

vi.mock('../_components/ZhugeGlobalFab', () => ({
  ZhugeGlobalFab: ({ clientId }: { clientId: string }) => <div data-testid="zhuge-fab">{clientId}</div>,
}))

import ClientLayout from '../layout'

function setTier(value: string | null) {
  headersMock.mockReturnValue({
    get: (k: string) => (k === 'x-user-tier' ? value : null),
  })
}

beforeEach(() => {
  headersMock.mockReset()
})

describe('ClientLayout — 诸葛亮 FAB gating', () => {
  it('hides the FAB for self_serve visitors', () => {
    setTier('self_serve')
    render(
      <ClientLayout params={{ id: 'client-1' }}>
        <p>page content</p>
      </ClientLayout>,
    )
    expect(screen.getByText('page content')).toBeTruthy()
    expect(screen.queryByTestId('zhuge-fab')).toBeNull()
  })

  it('shows the FAB for paid_client visitors', () => {
    setTier('paid_client')
    render(
      <ClientLayout params={{ id: 'client-1' }}>
        <p>page content</p>
      </ClientLayout>,
    )
    expect(screen.getByTestId('zhuge-fab')).toBeTruthy()
  })

  it('shows the FAB for admin visitors', () => {
    setTier('admin')
    render(
      <ClientLayout params={{ id: 'client-1' }}>
        <p>page content</p>
      </ClientLayout>,
    )
    expect(screen.getByTestId('zhuge-fab')).toBeTruthy()
  })

  it('shows the FAB when the tier header is missing (fails open, matches readUserTier default)', () => {
    setTier(null)
    render(
      <ClientLayout params={{ id: 'client-1' }}>
        <p>page content</p>
      </ClientLayout>,
    )
    expect(screen.getByTestId('zhuge-fab')).toBeTruthy()
  })
})
