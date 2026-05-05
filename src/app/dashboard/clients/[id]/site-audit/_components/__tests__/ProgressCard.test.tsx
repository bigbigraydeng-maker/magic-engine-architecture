/**
 * ProgressCard Component Tests
 *
 * TDD: RED phase - all tests written before implementation
 * Tests cover all rendering states, calculations, and edge cases
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { ProgressCard } from '../ProgressCard'
import type { SiteAuditJob } from '../ProgressCard'

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const BASE_JOB: SiteAuditJob = {
  id: 'job-001',
  client_id: 'client-001',
  domain: 'example.com',
  status: 'pending',
  total_pages: 100,
  crawled_pages: 0,
  classified_pages: 0,
  geo_detected: 0,
  error_count: 0,
  error_message: undefined,
  created_at: '2026-05-05T00:00:00.000Z',
  updated_at: '2026-05-05T00:00:00.000Z',
}

const IN_PROGRESS_JOB: SiteAuditJob = {
  ...BASE_JOB,
  status: 'in_progress',
  total_pages: 100,
  crawled_pages: 40,
  classified_pages: 35,
  geo_detected: 5,
  error_count: 2,
  // started 80 seconds ago so rate = 40 / 80 = 0.5 pages/sec
  // remaining = (100 - 40) / 0.5 = 120 seconds = 2 min 0 sec
  updated_at: new Date(Date.now() - 80_000).toISOString(),
  created_at: new Date(Date.now() - 80_000).toISOString(),
}

const COMPLETED_JOB: SiteAuditJob = {
  ...BASE_JOB,
  status: 'completed',
  total_pages: 100,
  crawled_pages: 100,
  classified_pages: 98,
  geo_detected: 12,
  error_count: 0,
}

const FAILED_JOB: SiteAuditJob = {
  ...BASE_JOB,
  status: 'failed',
  total_pages: 100,
  crawled_pages: 23,
  classified_pages: 20,
  geo_detected: 2,
  error_count: 5,
  error_message: 'Connection timeout after 3 retries',
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('ProgressCard', () => {
  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state (isLoading=true)', () => {
    it('renders skeleton placeholder when isLoading is true', () => {
      render(<ProgressCard job={null} isLoading={true} error={null} />)

      const skeleton = screen.getByTestId('progress-card-skeleton')
      expect(skeleton).toBeInTheDocument()
    })

    it('does not render job content when loading', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={true} error={null} />)

      expect(screen.queryByTestId('progress-card-content')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  describe('error state (error != null)', () => {
    it('renders error message when error prop is provided', () => {
      render(<ProgressCard job={null} isLoading={false} error="Failed to fetch job status" />)

      expect(screen.getByTestId('progress-card-error')).toBeInTheDocument()
      expect(screen.getByText('Failed to fetch job status')).toBeInTheDocument()
    })

    it('does not render job content when error exists', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error="Some error" />)

      expect(screen.queryByTestId('progress-card-content')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Null job state
  // -------------------------------------------------------------------------

  describe('null job state (job=null, no loading, no error)', () => {
    it('renders "No job in progress" message when job is null', () => {
      render(<ProgressCard job={null} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-card-empty')).toBeInTheDocument()
      expect(screen.getByText('No job in progress')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Pending state
  // -------------------------------------------------------------------------

  describe('pending status', () => {
    it('renders job content area when job is provided', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-card-content')).toBeInTheDocument()
    })

    it('shows "Starting..." text in pending status', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-status-label')).toHaveTextContent('Starting...')
    })

    it('shows 0% progress in pending status', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error={null} />)

      const progressBar = screen.getByTestId('progress-bar-fill')
      // 0% width expressed as inline style
      expect(progressBar).toHaveStyle({ width: '0%' })
    })

    it('renders gray progress bar in pending status', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error={null} />)

      const progressBar = screen.getByTestId('progress-bar-fill')
      expect(progressBar.className).toMatch(/bg-gray/)
    })
  })

  // -------------------------------------------------------------------------
  // In-progress state
  // -------------------------------------------------------------------------

  describe('in_progress status', () => {
    it('renders blue progress bar in in_progress status', () => {
      render(<ProgressCard job={IN_PROGRESS_JOB} isLoading={false} error={null} />)

      const progressBar = screen.getByTestId('progress-bar-fill')
      expect(progressBar.className).toMatch(/bg-blue/)
    })

    it('calculates progress percentage correctly: crawled_pages / total_pages * 100', () => {
      render(<ProgressCard job={IN_PROGRESS_JOB} isLoading={false} error={null} />)

      // 40 / 100 * 100 = 40%
      const progressBar = screen.getByTestId('progress-bar-fill')
      expect(progressBar).toHaveStyle({ width: '40%' })
    })

    it('displays correct percentage text', () => {
      render(<ProgressCard job={IN_PROGRESS_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-percent-text')).toHaveTextContent('40%')
    })

    it('renders all 4 metrics with correct values', () => {
      render(<ProgressCard job={IN_PROGRESS_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('metric-crawled-pages')).toHaveTextContent('40')
      expect(screen.getByTestId('metric-classified-pages')).toHaveTextContent('35')
      expect(screen.getByTestId('metric-geo-detected')).toHaveTextContent('5')
      expect(screen.getByTestId('metric-error-count')).toHaveTextContent('2')
    })

    it('renders all 4 metric labels', () => {
      render(<ProgressCard job={IN_PROGRESS_JOB} isLoading={false} error={null} />)

      expect(screen.getByText('Crawled')).toBeInTheDocument()
      expect(screen.getByText('Classified')).toBeInTheDocument()
      expect(screen.getByText('GEO Detected')).toBeInTheDocument()
      expect(screen.getByText('Errors')).toBeInTheDocument()
    })

    it('displays ETA when rate > 0', () => {
      // IN_PROGRESS_JOB: crawled=40, elapsed=80s => rate=0.5 pages/sec
      // remaining = (100-40)/0.5 = 120s => "2 minutes 0 seconds remaining"
      render(<ProgressCard job={IN_PROGRESS_JOB} isLoading={false} error={null} />)

      const eta = screen.getByTestId('progress-eta')
      expect(eta).toBeInTheDocument()
      expect(eta.textContent).toMatch(/Estimated.*remaining/)
    })

    it('hides ETA section in pending status', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error={null} />)

      expect(screen.queryByTestId('progress-eta')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // ETA edge cases
  // -------------------------------------------------------------------------

  describe('ETA calculation edge cases', () => {
    it('shows "Calculating..." when crawled_pages is 0 (rate = 0)', () => {
      const jobWithZeroCrawled: SiteAuditJob = {
        ...IN_PROGRESS_JOB,
        crawled_pages: 0,
      }
      render(<ProgressCard job={jobWithZeroCrawled} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-eta')).toHaveTextContent('Calculating...')
    })

    it('shows "Calculating..." when total_pages is 0 (invalid job)', () => {
      const jobWithZeroTotal: SiteAuditJob = {
        ...IN_PROGRESS_JOB,
        total_pages: 0,
        crawled_pages: 0,
      }
      render(<ProgressCard job={jobWithZeroTotal} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-eta')).toHaveTextContent('Calculating...')
    })

    it('formats ETA with minutes and seconds correctly', () => {
      // Set up a job where elapsed time and crawl rate lead to a known ETA
      // We'll create a job with created_at 60 seconds ago, crawled 30 pages
      // rate = 30/60 = 0.5 pages/sec; remaining = (100-30)/0.5 = 140s = 2min 20sec
      const knownRateJob: SiteAuditJob = {
        ...BASE_JOB,
        status: 'in_progress',
        total_pages: 100,
        crawled_pages: 30,
        classified_pages: 28,
        geo_detected: 3,
        error_count: 0,
        created_at: new Date(Date.now() - 60_000).toISOString(),
        updated_at: new Date(Date.now() - 60_000).toISOString(),
      }
      render(<ProgressCard job={knownRateJob} isLoading={false} error={null} />)

      const eta = screen.getByTestId('progress-eta')
      // Expect format: "Estimated X minutes Y seconds remaining"
      expect(eta.textContent).toMatch(/Estimated \d+ minutes? \d+ seconds? remaining/)
    })

    it('uses singular "minute" and "second" when values equal 1', () => {
      // Craft a job that produces exactly "Estimated 1 minute 1 second remaining"
      // elapsed = 59 sec, crawled = 59 pages, total = 119 pages
      // rate = 59/59 = 1 page/sec; remaining = (119-59)/1 = 60 sec => wait, 60/60=1min 0sec
      // Let's use: elapsed=118s, crawled=59 pages
      // rate = 59/118 = 0.5 p/s; remaining = (120-59)/0.5 = 122s = 2m 2s — not 1m 1s
      // For 1m 1s = 61s: rate=1 p/s => elapsed=X, crawled=X, remaining=61
      // crawled=61, total=122, elapsed=61s => rate=1; remaining=61s => 1m 1s
      const singularJob: SiteAuditJob = {
        ...BASE_JOB,
        status: 'in_progress',
        total_pages: 122,
        crawled_pages: 61,
        classified_pages: 60,
        geo_detected: 5,
        error_count: 0,
        created_at: new Date(Date.now() - 61_000).toISOString(),
        updated_at: new Date(Date.now() - 61_000).toISOString(),
      }
      render(<ProgressCard job={singularJob} isLoading={false} error={null} />)

      const eta = screen.getByTestId('progress-eta')
      // Should say "1 minute" and "1 second" (singular)
      expect(eta.textContent).toMatch(/Estimated 1 minute 1 second remaining/)
    })
  })

  // -------------------------------------------------------------------------
  // Completed state
  // -------------------------------------------------------------------------

  describe('completed status', () => {
    it('shows green background styling for completed status', () => {
      render(<ProgressCard job={COMPLETED_JOB} isLoading={false} error={null} />)

      const card = screen.getByTestId('progress-card-content')
      expect(card.className).toMatch(/bg-green|green/)
    })

    it('shows "✓ Job Completed" text for completed status', () => {
      render(<ProgressCard job={COMPLETED_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-terminal-message')).toHaveTextContent('Job Completed')
    })

    it('hides progress bar for completed status', () => {
      render(<ProgressCard job={COMPLETED_JOB} isLoading={false} error={null} />)

      expect(screen.queryByTestId('progress-bar-fill')).not.toBeInTheDocument()
    })

    it('hides ETA for completed status', () => {
      render(<ProgressCard job={COMPLETED_JOB} isLoading={false} error={null} />)

      expect(screen.queryByTestId('progress-eta')).not.toBeInTheDocument()
    })

    it('still renders metrics for completed status', () => {
      render(<ProgressCard job={COMPLETED_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('metric-crawled-pages')).toHaveTextContent('100')
      expect(screen.getByTestId('metric-classified-pages')).toHaveTextContent('98')
      expect(screen.getByTestId('metric-geo-detected')).toHaveTextContent('12')
      expect(screen.getByTestId('metric-error-count')).toHaveTextContent('0')
    })
  })

  // -------------------------------------------------------------------------
  // Failed state
  // -------------------------------------------------------------------------

  describe('failed status', () => {
    it('shows red background styling for failed status', () => {
      render(<ProgressCard job={FAILED_JOB} isLoading={false} error={null} />)

      const card = screen.getByTestId('progress-card-content')
      expect(card.className).toMatch(/bg-red|red/)
    })

    it('shows "✗ Job Failed" text for failed status', () => {
      render(<ProgressCard job={FAILED_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-terminal-message')).toHaveTextContent('Job Failed')
    })

    it('displays error_message in failed status', () => {
      render(<ProgressCard job={FAILED_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-error-message')).toHaveTextContent(
        'Connection timeout after 3 retries'
      )
    })

    it('hides progress bar for failed status', () => {
      render(<ProgressCard job={FAILED_JOB} isLoading={false} error={null} />)

      expect(screen.queryByTestId('progress-bar-fill')).not.toBeInTheDocument()
    })

    it('hides ETA for failed status', () => {
      render(<ProgressCard job={FAILED_JOB} isLoading={false} error={null} />)

      expect(screen.queryByTestId('progress-eta')).not.toBeInTheDocument()
    })

    it('renders metrics for failed status', () => {
      render(<ProgressCard job={FAILED_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('metric-crawled-pages')).toHaveTextContent('23')
      expect(screen.getByTestId('metric-error-count')).toHaveTextContent('5')
    })
  })

  // -------------------------------------------------------------------------
  // Boundary values
  // -------------------------------------------------------------------------

  describe('boundary values', () => {
    it('clamps progress percentage to 0% when crawled_pages = 0', () => {
      const zeroJob: SiteAuditJob = {
        ...BASE_JOB,
        status: 'in_progress',
        crawled_pages: 0,
        total_pages: 100,
        created_at: new Date(Date.now() - 10_000).toISOString(),
        updated_at: new Date(Date.now() - 10_000).toISOString(),
      }
      render(<ProgressCard job={zeroJob} isLoading={false} error={null} />)

      const progressBar = screen.getByTestId('progress-bar-fill')
      expect(progressBar).toHaveStyle({ width: '0%' })
    })

    it('shows 100% progress when crawled_pages equals total_pages in in_progress', () => {
      const fullJob: SiteAuditJob = {
        ...BASE_JOB,
        status: 'in_progress',
        crawled_pages: 100,
        total_pages: 100,
        created_at: new Date(Date.now() - 200_000).toISOString(),
        updated_at: new Date(Date.now() - 200_000).toISOString(),
      }
      render(<ProgressCard job={fullJob} isLoading={false} error={null} />)

      const progressBar = screen.getByTestId('progress-bar-fill')
      expect(progressBar).toHaveStyle({ width: '100%' })
      expect(screen.getByTestId('progress-percent-text')).toHaveTextContent('100%')
    })

    it('renders all metrics as "0" when all counts are zero', () => {
      const zeroJob: SiteAuditJob = {
        ...BASE_JOB,
        status: 'in_progress',
        crawled_pages: 0,
        classified_pages: 0,
        geo_detected: 0,
        error_count: 0,
        created_at: new Date(Date.now() - 10_000).toISOString(),
        updated_at: new Date(Date.now() - 10_000).toISOString(),
      }
      render(<ProgressCard job={zeroJob} isLoading={false} error={null} />)

      expect(screen.getByTestId('metric-crawled-pages')).toHaveTextContent('0')
      expect(screen.getByTestId('metric-classified-pages')).toHaveTextContent('0')
      expect(screen.getByTestId('metric-geo-detected')).toHaveTextContent('0')
      expect(screen.getByTestId('metric-error-count')).toHaveTextContent('0')
    })

    it('does not display error message section when error_message is undefined in failed job', () => {
      const failedNoMessage: SiteAuditJob = {
        ...FAILED_JOB,
        error_message: undefined,
      }
      render(<ProgressCard job={failedNoMessage} isLoading={false} error={null} />)

      expect(screen.queryByTestId('progress-error-message')).not.toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Domain display
  // -------------------------------------------------------------------------

  describe('domain display', () => {
    it('renders the domain name in the card header', () => {
      render(<ProgressCard job={BASE_JOB} isLoading={false} error={null} />)

      expect(screen.getByTestId('progress-card-domain')).toHaveTextContent('example.com')
    })
  })
})
