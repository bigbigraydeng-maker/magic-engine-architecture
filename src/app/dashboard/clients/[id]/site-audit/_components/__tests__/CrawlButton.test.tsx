/**
 * CrawlButton Component Tests
 *
 * TDD: RED → GREEN → REFACTOR
 *
 * Coverage target: ≥ 80%
 *
 * Scenarios:
 *  1.  Renders "Start Audit" in default (no status) state
 *  2.  currentJobStatus="in_progress" → disabled + "Audit in Progress" + spinner
 *  3.  currentJobStatus="pending" → disabled + "Audit in Progress"
 *  4.  currentJobStatus="completed" → enabled + "Start New Audit"
 *  5.  currentJobStatus="failed" → enabled + "Start New Audit"
 *  6.  User clicks → calls POST /api/clients/[id]/site-audit/start with domain
 *  7.  201 response → calls onJobStarted(jobId) and returns to idle
 *  8.  During in-flight request → button shows "Starting..." and is disabled
 *  9.  409 response → shows confirmation dialog
 *  10. Confirm dialog "Yes, replace it" → retries with override=true
 *  11. 409 retry succeeds (201) → calls onJobStarted(newJobId)
 *  12. Confirm dialog "Cancel" → closes dialog, button returns to idle
 *  13. 400 response → shows domain toast error
 *  14. 500 response → shows generic toast error
 *  15. Network error (fetch throws) → shows network toast
 *  16. External disabled=true → button is disabled regardless of status
 *  17. Toast close button → hides toast, button re-enables
 *  18. Rapid multi-click guard — second click ignored while loading
 */

import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CrawlButton } from '../CrawlButton'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const DEFAULT_PROPS = {
  clientId: 'client-abc',
  currentJobStatus: undefined,
  onJobStarted: vi.fn(),
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrawlButton', () => {
  // =========================================================================
  // Test 1 — Default / null status: renders "Start Audit" enabled
  // =========================================================================
  describe('default state (no currentJobStatus)', () => {
    it('renders "Start Audit" button that is enabled', () => {
      render(<CrawlButton {...DEFAULT_PROPS} />)

      const btn = screen.getByTestId('crawl-button')
      expect(btn).toHaveTextContent('Start Audit')
      expect(btn).not.toBeDisabled()
    })

    it('does not show spinner in idle state', () => {
      render(<CrawlButton {...DEFAULT_PROPS} />)

      expect(screen.queryByTestId('crawl-button-spinner')).not.toBeInTheDocument()
    })

    it('does not show confirmation dialog initially', () => {
      render(<CrawlButton {...DEFAULT_PROPS} />)

      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })

    it('does not show toast initially', () => {
      render(<CrawlButton {...DEFAULT_PROPS} />)

      expect(screen.queryByTestId('crawl-toast')).not.toBeInTheDocument()
    })
  })

  // =========================================================================
  // Test 2 & 3 — Active statuses: disabled + "Audit in Progress" + spinner
  // =========================================================================
  describe('active job statuses (pending / in_progress)', () => {
    it.each(['pending', 'in_progress'] as const)(
      'renders disabled "Audit in Progress" for status=%s',
      (status) => {
        render(<CrawlButton {...DEFAULT_PROPS} currentJobStatus={status} />)

        const btn = screen.getByTestId('crawl-button')
        expect(btn).toHaveTextContent('Audit in Progress')
        expect(btn).toBeDisabled()
      }
    )

    it.each(['pending', 'in_progress'] as const)(
      'shows spinner for active status=%s',
      (status) => {
        render(<CrawlButton {...DEFAULT_PROPS} currentJobStatus={status} />)

        expect(screen.getByTestId('crawl-button-spinner')).toBeInTheDocument()
      }
    )
  })

  // =========================================================================
  // Test 4 & 5 — Terminal statuses: enabled + "Start New Audit"
  // =========================================================================
  describe('terminal job statuses (completed / failed)', () => {
    it.each(['completed', 'failed'] as const)(
      'renders enabled "Start New Audit" for status=%s',
      (status) => {
        render(<CrawlButton {...DEFAULT_PROPS} currentJobStatus={status} />)

        const btn = screen.getByTestId('crawl-button')
        expect(btn).toHaveTextContent('Start New Audit')
        expect(btn).not.toBeDisabled()
      }
    )

    it.each(['completed', 'failed'] as const)(
      'does not show spinner for terminal status=%s',
      (status) => {
        render(<CrawlButton {...DEFAULT_PROPS} currentJobStatus={status} />)

        expect(screen.queryByTestId('crawl-button-spinner')).not.toBeInTheDocument()
      }
    )
  })

  // =========================================================================
  // Test 6 — Click calls correct API endpoint
  // =========================================================================
  describe('API call on button click', () => {
    it('calls POST /api/clients/[clientId]/site-audit/crawl with JSON body', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(201, { jobId: 'job-001', status: 'pending', estimatedDurationSec: 200 })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      expect(global.fetch).toHaveBeenCalledOnce()
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/clients/client-abc/site-audit/crawl',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
  })

  // =========================================================================
  // Test 7 — 201 response → onJobStarted called, idle restored
  // =========================================================================
  describe('201 success response', () => {
    it('calls onJobStarted with the returned job id', async () => {
      const user = userEvent.setup()
      const onJobStarted = vi.fn()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(201, { jobId: 'job-xyz', status: 'pending', estimatedDurationSec: 200 })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={onJobStarted} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => expect(onJobStarted).toHaveBeenCalledWith('job-xyz'))
    })

    it('button returns to "Start Audit" label after 201 (no active job)', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(201, { jobId: 'job-xyz', status: 'pending', estimatedDurationSec: 200 })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => {
        const btn = screen.getByTestId('crawl-button')
        expect(btn).not.toBeDisabled()
      })
    })
  })

  // =========================================================================
  // Test 8 — Loading state: "Starting..." + disabled
  // =========================================================================
  describe('loading state during API call', () => {
    it('shows "Starting..." and disables button while fetch is in-flight', async () => {
      const user = userEvent.setup()
      // Never resolves while we're checking the UI
      let resolveRequest!: (value: Response) => void
      const pendingPromise = new Promise<Response>((res) => {
        resolveRequest = res
      })
      ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(pendingPromise)

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      // Don't await — we want to inspect the loading state
      const clickPromise = user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => {
        const btn = screen.getByTestId('crawl-button')
        expect(btn).toHaveTextContent('Starting...')
        expect(btn).toBeDisabled()
      })

      // Clean up: resolve the promise so no pending state leaks
      resolveRequest(makeResponse(201, { jobId: 'j1', status: 'pending', estimatedDurationSec: 200 }))
      await clickPromise
    })
  })

  // =========================================================================
  // Test 9 — 409 → confirmation dialog appears
  // =========================================================================
  describe('409 existing job', () => {
    it('shows confirmation dialog on 409 response', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
      })
      expect(screen.getByTestId('confirm-dialog-message')).toHaveTextContent(
        'An audit is already running for this domain. Start a new one?'
      )
    })

    it('button is not in "Starting..." state when dialog is open', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => screen.getByTestId('confirm-dialog'))

      const btn = screen.getByTestId('crawl-button')
      expect(btn).not.toHaveTextContent('Starting...')
    })
  })

  // =========================================================================
  // Test 10 — Dialog "Yes, replace it" → retry with override=true
  // =========================================================================
  describe('confirmation dialog — yes override', () => {
    it('retries the API call with force=true when user clicks "Yes, replace it"', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' }))
        .mockResolvedValueOnce(makeResponse(201, { jobId: 'job-new', status: 'pending', estimatedDurationSec: 200 }))

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))
      await waitFor(() => screen.getByTestId('confirm-dialog'))

      await user.click(screen.getByTestId('confirm-dialog-yes'))

      expect(global.fetch).toHaveBeenCalledTimes(2)
      const secondCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
      const body = JSON.parse(secondCall[1].body as string)
      expect(body).toMatchObject({ force: true })
    })

    it('hides the confirmation dialog after clicking Yes', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' }))
        .mockResolvedValueOnce(makeResponse(201, { jobId: 'job-new', status: 'pending', estimatedDurationSec: 200 }))

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))
      await waitFor(() => screen.getByTestId('confirm-dialog'))

      await user.click(screen.getByTestId('confirm-dialog-yes'))

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
    })
  })

  // =========================================================================
  // Test 11 — 409 retry succeeds → onJobStarted(newJobId)
  // =========================================================================
  describe('override retry 201 success', () => {
    it('calls onJobStarted with new job id after successful override retry', async () => {
      const user = userEvent.setup()
      const onJobStarted = vi.fn()
      ;(global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' }))
        .mockResolvedValueOnce(makeResponse(201, { jobId: 'job-new-123', status: 'pending', estimatedDurationSec: 200 }))

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={onJobStarted} />)
      await user.click(screen.getByTestId('crawl-button'))
      await waitFor(() => screen.getByTestId('confirm-dialog'))

      await user.click(screen.getByTestId('confirm-dialog-yes'))

      await waitFor(() => expect(onJobStarted).toHaveBeenCalledWith('job-new-123'))
    })
  })

  // =========================================================================
  // Test 12 — Dialog "Cancel" → closes, no retry, idle
  // =========================================================================
  describe('confirmation dialog — cancel', () => {
    it('closes dialog and makes no additional fetch when Cancel clicked', async () => {
      const user = userEvent.setup()
      const onJobStarted = vi.fn()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={onJobStarted} />)
      await user.click(screen.getByTestId('crawl-button'))
      await waitFor(() => screen.getByTestId('confirm-dialog'))

      await user.click(screen.getByTestId('confirm-dialog-cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
      })
      expect(global.fetch).toHaveBeenCalledOnce() // only the first 409 call
      expect(onJobStarted).not.toHaveBeenCalled()
    })

    it('button is re-enabled after Cancel', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(409, { error: 'Job already in progress', existingJobId: 'job-existing' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))
      await waitFor(() => screen.getByTestId('confirm-dialog'))

      await user.click(screen.getByTestId('confirm-dialog-cancel'))

      await waitFor(() => {
        expect(screen.getByTestId('crawl-button')).not.toBeDisabled()
      })
    })
  })

  // =========================================================================
  // Test 13 — 400 response → domain toast
  // =========================================================================
  describe('400 error response', () => {
    it('shows "Domain not configured" toast on 400', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(400, { error: 'domain missing' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => {
        expect(screen.getByTestId('crawl-toast-message')).toHaveTextContent(
          'Domain not configured. Check client setup.'
        )
      })
    })
  })

  // =========================================================================
  // Test 14 — 500 response → generic toast
  // =========================================================================
  describe('500 error response', () => {
    it('shows generic failure toast on 5xx response', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(500, { error: 'Internal server error' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => {
        expect(screen.getByTestId('crawl-toast-message')).toHaveTextContent(
          'Failed to start audit. Try again.'
        )
      })
    })
  })

  // =========================================================================
  // Test 15 — Network error (fetch throws)
  // =========================================================================
  describe('network error', () => {
    it('shows network error toast when fetch throws', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Failed to fetch'))

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => {
        expect(screen.getByTestId('crawl-toast-message')).toHaveTextContent(
          'Network error. Check your connection.'
        )
      })
    })
  })

  // =========================================================================
  // Test 16 — External disabled=true
  // =========================================================================
  describe('external disabled prop', () => {
    it('disables button when disabled=true regardless of job status', () => {
      render(<CrawlButton {...DEFAULT_PROPS} disabled={true} />)

      expect(screen.getByTestId('crawl-button')).toBeDisabled()
    })

    it('disables button when disabled=true even with completed status', () => {
      render(<CrawlButton {...DEFAULT_PROPS} currentJobStatus="completed" disabled={true} />)

      expect(screen.getByTestId('crawl-button')).toBeDisabled()
    })
  })

  // =========================================================================
  // Test 17 — Toast close restores button
  // =========================================================================
  describe('toast dismiss', () => {
    it('closes toast when close button is clicked', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(400, { error: 'bad request' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))

      await waitFor(() => screen.getByTestId('crawl-toast'))

      await user.click(screen.getByTestId('crawl-toast-close'))

      await waitFor(() => {
        expect(screen.queryByTestId('crawl-toast')).not.toBeInTheDocument()
      })
    })

    it('button is enabled and not loading after toast is dismissed', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        makeResponse(500, { error: 'server error' })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      await user.click(screen.getByTestId('crawl-button'))
      await waitFor(() => screen.getByTestId('crawl-toast'))

      await user.click(screen.getByTestId('crawl-toast-close'))

      await waitFor(() => {
        expect(screen.getByTestId('crawl-button')).not.toBeDisabled()
      })
    })
  })

  // =========================================================================
  // Test 18 — Rapid multi-click guard
  // =========================================================================
  describe('multi-click prevention', () => {
    it('disables button immediately after first click preventing duplicate requests', async () => {
      const user = userEvent.setup()
      let resolveFirst!: (v: Response) => void
      const firstPromise = new Promise<Response>((res) => { resolveFirst = res })
      ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(firstPromise)

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)

      const btn = screen.getByTestId('crawl-button')
      // Click without await to test in-flight state
      void user.click(btn)

      await waitFor(() => {
        expect(screen.getByTestId('crawl-button')).toBeDisabled()
      })

      // Cleanup
      resolveFirst(makeResponse(201, { jobId: 'j', status: 'pending', estimatedDurationSec: 200 }))
    })

    it('only makes one fetch call even if button clicked rapidly', async () => {
      const user = userEvent.setup()
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeResponse(201, { jobId: 'j1', status: 'pending', estimatedDurationSec: 200 })
      )

      render(<CrawlButton {...DEFAULT_PROPS} onJobStarted={vi.fn()} />)
      const btn = screen.getByTestId('crawl-button')

      // Rapid clicks — first enables, second should be blocked by disabled state
      await user.click(btn)
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    })
  })

  // =========================================================================
  // Edge case — null currentJobStatus treated as no active job
  // =========================================================================
  describe('null currentJobStatus', () => {
    it('treats null same as undefined — renders "Start Audit" enabled', () => {
      render(<CrawlButton {...DEFAULT_PROPS} currentJobStatus={null} />)

      const btn = screen.getByTestId('crawl-button')
      expect(btn).toHaveTextContent('Start Audit')
      expect(btn).not.toBeDisabled()
    })
  })
})
