/**
 * CrawlButton Component
 *
 * Triggers a site audit crawl for a given client.
 * Manages the full request lifecycle: idle → loading → success/error.
 *
 * States handled:
 *  - idle (no active job): "Start Audit" — enabled
 *  - in progress (pending/in_progress): "Audit in Progress" — disabled + spinner
 *  - post-terminal (completed/failed): "Start New Audit" — enabled
 *  - loading (API call in-flight): "Starting..." — disabled
 *  - disabled=true (external): disabled regardless of status
 *
 * 409 flow:
 *  API returns 409 → confirmation dialog → user confirms → retry with override=true
 */

'use client'

import React, { useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface CrawlButtonProps {
  clientId: string
  currentJobStatus?: JobStatus | null
  onJobStarted: (jobId: string) => void
  disabled?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: JobStatus[] = ['pending', 'in_progress']
const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed']

// ---------------------------------------------------------------------------
// CrawlButton Component
// ---------------------------------------------------------------------------

export function CrawlButton({
  clientId,
  currentJobStatus,
  onJobStarted,
  disabled = false,
}: CrawlButtonProps): React.ReactElement {
  const [isLoading, setIsLoading] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [existingJobId, setExistingJobId] = useState<string | null>(null)

  const isJobActive = currentJobStatus != null && ACTIVE_STATUSES.includes(currentJobStatus)
  const isJobTerminal = currentJobStatus != null && TERMINAL_STATUSES.includes(currentJobStatus)

  const buttonDisabled = disabled || isLoading || isJobActive

  const buttonLabel = isJobActive
    ? 'Audit in Progress'
    : isLoading
      ? 'Starting...'
      : isJobTerminal
        ? 'Start New Audit'
        : 'Start Audit'

  function showToast(message: string): void {
    setToast(message)
  }

  async function startAudit(override = false): Promise<void> {
    setIsLoading(true)
    setToast(null)

    try {
      const response = await fetch(`/api/clients/${clientId}/site-audit/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override ? { domain: clientId, override: true } : { domain: clientId }),
      })

      if (response.status === 201) {
        const json = await response.json()
        const jobId: string = json.data.id
        setIsLoading(false)
        onJobStarted(jobId)
        return
      }

      const json = await response.json()

      if (response.status === 409) {
        setExistingJobId(json.existingJobId ?? null)
        setIsLoading(false)
        setShowConfirmDialog(true)
        return
      }

      if (response.status === 400) {
        showToast('Domain not configured. Check client setup.')
        setIsLoading(false)
        return
      }

      showToast('Failed to start audit. Try again.')
      setIsLoading(false)
    } catch {
      showToast('Network error. Check your connection.')
      setIsLoading(false)
    }
  }

  function handleClick(): void {
    void startAudit(false)
  }

  function handleConfirmOverride(): void {
    setShowConfirmDialog(false)
    void startAudit(true)
  }

  function handleCancelOverride(): void {
    setShowConfirmDialog(false)
    setExistingJobId(null)
  }

  return (
    <div data-testid="crawl-button-root">
      <button
        data-testid="crawl-button"
        onClick={handleClick}
        disabled={buttonDisabled}
        className={[
          'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
          buttonDisabled
            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
            : 'bg-blue-600 text-white hover:bg-blue-700',
        ].join(' ')}
      >
        {isJobActive && (
          <svg
            data-testid="crawl-button-spinner"
            className="h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {buttonLabel}
      </button>

      {/* 409 confirmation dialog */}
      {showConfirmDialog && (
        <div data-testid="confirm-dialog" role="dialog" aria-modal="true">
          <p data-testid="confirm-dialog-message">
            An audit is already running for this domain. Start a new one?
          </p>
          <button data-testid="confirm-dialog-yes" onClick={handleConfirmOverride}>
            Yes, replace it
          </button>
          <button data-testid="confirm-dialog-cancel" onClick={handleCancelOverride}>
            Cancel
          </button>
        </div>
      )}

      {/* Toast notification */}
      {toast !== null && (
        <div data-testid="crawl-toast" role="alert">
          <span data-testid="crawl-toast-message">{toast}</span>
          <button
            data-testid="crawl-toast-close"
            onClick={() => setToast(null)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
