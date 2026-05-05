/**
 * CrawlButton Component
 *
 * Triggers a site audit crawl for a given client.
 * Manages the full request lifecycle: idle → loading → success/error.
 *
 * States:
 *  - idle (no active job):          "Start Audit"         — enabled
 *  - active job (pending/in_progress): "Audit in Progress" — disabled + spinner
 *  - terminal (completed/failed):   "Start New Audit"     — enabled
 *  - loading (API in-flight):       "Starting..."         — disabled
 *  - disabled=true (external):      always disabled
 *
 * 409 flow:
 *  API returns 409 → confirmation dialog → "Yes, replace it" → retry with override=true
 */

'use client'

import React, { useState } from 'react'

// ---------------------------------------------------------------------------
// Types (exported for consumers and tests)
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

const ACTIVE_STATUSES = new Set<JobStatus>(['pending', 'in_progress'])
const TERMINAL_STATUSES = new Set<JobStatus>(['completed', 'failed'])

const TOAST_DOMAIN_NOT_CONFIGURED = 'Domain not configured. Check client setup.'
const TOAST_FAILED_TO_START = 'Failed to start audit. Try again.'
const TOAST_NETWORK_ERROR = 'Network error. Check your connection.'
const DIALOG_MESSAGE = 'An audit is already running for this domain. Start a new one?'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SpinnerProps {
  testId: string
}

function Spinner({ testId }: SpinnerProps): React.ReactElement {
  return (
    <svg
      data-testid={testId}
      className="h-4 w-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

interface ConfirmDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ onConfirm, onCancel }: ConfirmDialogProps): React.ReactElement {
  return (
    <div data-testid="confirm-dialog" role="dialog" aria-modal="true">
      <p data-testid="confirm-dialog-message">{DIALOG_MESSAGE}</p>
      <button data-testid="confirm-dialog-yes" onClick={onConfirm}>
        Yes, replace it
      </button>
      <button data-testid="confirm-dialog-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

interface ToastProps {
  message: string
  onClose: () => void
}

function Toast({ message, onClose }: ToastProps): React.ReactElement {
  return (
    <div data-testid="crawl-toast" role="alert">
      <span data-testid="crawl-toast-message">{message}</span>
      <button
        data-testid="crawl-toast-close"
        onClick={onClose}
        aria-label="Close notification"
      >
        ×
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveButtonLabel(isJobActive: boolean, isLoading: boolean, isJobTerminal: boolean): string {
  if (isJobActive) return 'Audit in Progress'
  if (isLoading) return 'Starting...'
  if (isJobTerminal) return 'Start New Audit'
  return 'Start Audit'
}

function buildRequestBody(clientId: string, override: boolean): string {
  const body: { domain: string; override?: true } = { domain: clientId }
  if (override) body.override = true
  return JSON.stringify(body)
}

// ---------------------------------------------------------------------------
// Main component
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

  const isJobActive = currentJobStatus != null && ACTIVE_STATUSES.has(currentJobStatus)
  const isJobTerminal = currentJobStatus != null && TERMINAL_STATUSES.has(currentJobStatus)
  const buttonDisabled = disabled || isLoading || isJobActive
  const buttonLabel = resolveButtonLabel(isJobActive, isLoading, isJobTerminal)

  async function startAudit(override: boolean): Promise<void> {
    setIsLoading(true)
    setToast(null)

    try {
      const response = await fetch(`/api/clients/${clientId}/site-audit/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildRequestBody(clientId, override),
      })

      if (response.status === 201) {
        const json = await response.json() as { data: { id: string } }
        setIsLoading(false)
        onJobStarted(json.data.id)
        return
      }

      const json = await response.json() as { error?: string; existingJobId?: string }

      if (response.status === 409) {
        setIsLoading(false)
        setShowConfirmDialog(true)
        return
      }

      setIsLoading(false)
      setToast(response.status === 400 ? TOAST_DOMAIN_NOT_CONFIGURED : TOAST_FAILED_TO_START)
    } catch {
      setIsLoading(false)
      setToast(TOAST_NETWORK_ERROR)
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
        {isJobActive && <Spinner testId="crawl-button-spinner" />}
        {buttonLabel}
      </button>

      {showConfirmDialog && (
        <ConfirmDialog onConfirm={handleConfirmOverride} onCancel={handleCancelOverride} />
      )}

      {toast !== null && (
        <Toast message={toast} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
