import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BriefGateBanner } from '../BriefGateBanner'

const mocks = vi.hoisted(() => ({
  useParams: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useParams: mocks.useParams,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

function mockFetch(body: unknown, ok = true) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok,
    json: async () => body,
  } as Response)
}

describe('BriefGateBanner', () => {
  beforeEach(() => {
    mocks.useParams.mockReturnValue({ id: 'client-123' })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches brief status for the current client', async () => {
    mockFetch({ complete: true, gated: false })

    render(
      <BriefGateBanner featureLabel="Blog generation">
        <button>Generate</button>
      </BriefGateBanner>,
    )

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/clients/client-123/brief-status',
        { cache: 'no-store' },
      )
    })
    expect(screen.queryByTestId('brief-gate-banner')).not.toBeInTheDocument()
  })

  it('shows the locked banner and dimmed content when the brief is incomplete', async () => {
    mockFetch({
      complete: false,
      gated: true,
      briefUrl: '/dashboard/clients/client-123/brief',
    })

    render(
      <BriefGateBanner featureLabel="Blog generation">
        <button>Generate</button>
      </BriefGateBanner>,
    )

    expect(await screen.findByTestId('brief-gate-banner')).toBeInTheDocument()
    expect(screen.getByText('Complete your brief to unlock Blog generation')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Complete brief/i })).toHaveAttribute(
      'href',
      '/dashboard/clients/client-123/brief',
    )
    expect(screen.getByTestId('brief-gate-content')).toHaveAttribute('aria-hidden', 'true')
  })

  it('uses the explicit client id when provided', async () => {
    mockFetch({ complete: true, gated: false })

    render(
      <BriefGateBanner clientId="client-explicit" featureLabel="Social generation">
        <button>Generate</button>
      </BriefGateBanner>,
    )

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/clients/client-explicit/brief-status',
        { cache: 'no-store' },
      )
    })
  })

  it('fails open when the status endpoint is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))

    render(
      <BriefGateBanner featureLabel="Execution kanban">
        <button>Execute</button>
      </BriefGateBanner>,
    )

    await waitFor(() => {
      expect(fetch).toHaveBeenCalled()
    })
    expect(screen.getByText('Execute')).toBeInTheDocument()
    expect(screen.queryByTestId('brief-gate-banner')).not.toBeInTheDocument()
  })
})
