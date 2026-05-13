/**
 * ScoreGauge Component Tests
 * TDD: RED → GREEN → REFACTOR
 *
 * Scenarios:
 * 1. score=85 → green styling + "健康"
 * 2. score=55 → amber/orange styling + "待改善"
 * 3. score=25 → red styling + "危险"
 * 4. score=70 → exactly at green threshold → green
 * 5. score=40 → exactly at amber threshold → amber
 * 6. score=39 → below amber → red
 * 7. Renders numeric score
 * 8. Renders optional dimension label
 * 9. Shows skeleton when loading=true
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ScoreGauge } from '../ScoreGauge'

// ---------------------------------------------------------------------------
// Colour tier tests
// ---------------------------------------------------------------------------

describe('ScoreGauge — colour tiers', () => {
  it('score=85 renders green styling', () => {
    render(<ScoreGauge score={85} />)
    const gauge = screen.getByTestId('score-gauge')
    expect(gauge).toHaveAttribute('data-tier', 'green')
    expect(gauge.className).toMatch(/green/)
  })

  it('score=55 renders amber/orange styling', () => {
    render(<ScoreGauge score={55} />)
    const gauge = screen.getByTestId('score-gauge')
    expect(gauge).toHaveAttribute('data-tier', 'amber')
    expect(gauge.className).toMatch(/orange|amber|yellow/)
  })

  it('score=25 renders red styling', () => {
    render(<ScoreGauge score={25} />)
    const gauge = screen.getByTestId('score-gauge')
    expect(gauge).toHaveAttribute('data-tier', 'red')
    expect(gauge.className).toMatch(/red/)
  })

  it('score=70 (exactly at green threshold) renders green', () => {
    render(<ScoreGauge score={70} />)
    expect(screen.getByTestId('score-gauge')).toHaveAttribute('data-tier', 'green')
  })

  it('score=40 (exactly at amber threshold) renders amber', () => {
    render(<ScoreGauge score={40} />)
    expect(screen.getByTestId('score-gauge')).toHaveAttribute('data-tier', 'amber')
  })

  it('score=39 (just below amber threshold) renders red', () => {
    render(<ScoreGauge score={39} />)
    expect(screen.getByTestId('score-gauge')).toHaveAttribute('data-tier', 'red')
  })
})

// ---------------------------------------------------------------------------
// Status label tests
// ---------------------------------------------------------------------------

describe('ScoreGauge — status labels', () => {
  it('shows "健康" label for green score', () => {
    render(<ScoreGauge score={85} />)
    expect(screen.getByTestId('score-label')).toHaveTextContent('健康')
  })

  it('shows "待改善" label for amber score', () => {
    render(<ScoreGauge score={55} />)
    expect(screen.getByTestId('score-label')).toHaveTextContent('待改善')
  })

  it('shows "危险" label for red score', () => {
    render(<ScoreGauge score={25} />)
    expect(screen.getByTestId('score-label')).toHaveTextContent('危险')
  })
})

// ---------------------------------------------------------------------------
// Numeric score
// ---------------------------------------------------------------------------

describe('ScoreGauge — numeric score', () => {
  it('renders the numeric score value', () => {
    render(<ScoreGauge score={72} />)
    expect(screen.getByTestId('score-value')).toHaveTextContent('72')
  })

  it('renders score=0 correctly', () => {
    render(<ScoreGauge score={0} />)
    expect(screen.getByTestId('score-value')).toHaveTextContent('0')
  })

  it('renders score=100 correctly', () => {
    render(<ScoreGauge score={100} />)
    expect(screen.getByTestId('score-value')).toHaveTextContent('100')
  })
})

// ---------------------------------------------------------------------------
// Dimension label
// ---------------------------------------------------------------------------

describe('ScoreGauge — dimension label', () => {
  it('renders optional dimension label', () => {
    render(<ScoreGauge score={75} dimension="SEO" />)
    expect(screen.getByTestId('score-dimension')).toHaveTextContent('SEO')
  })

  it('does not render dimension element when not provided', () => {
    render(<ScoreGauge score={75} />)
    expect(screen.queryByTestId('score-dimension')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

describe('ScoreGauge — loading', () => {
  it('renders skeleton when loading=true', () => {
    render(<ScoreGauge score={0} loading />)
    expect(screen.getByTestId('score-gauge-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('score-gauge')).not.toBeInTheDocument()
  })

  it('renders gauge when loading=false (default)', () => {
    render(<ScoreGauge score={60} />)
    expect(screen.queryByTestId('score-gauge-skeleton')).not.toBeInTheDocument()
    expect(screen.getByTestId('score-gauge')).toBeInTheDocument()
  })
})
