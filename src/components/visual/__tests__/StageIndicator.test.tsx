import React from 'react'
import { render } from '@testing-library/react'
import { StageIndicator } from '../StageIndicator'

describe('StageIndicator', () => {
  it('should render 4 dots', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={0} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')
    expect(dots.length).toBe(4)
  })

  it('should highlight current stage with full opacity', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={0} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')
    const currentDot = dots[0]
    expect(currentDot).toHaveClass('opacity-100')
  })

  it('should show future stages with reduced opacity', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={0} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')
    const futureDots = [dots[1], dots[2], dots[3]]

    futureDots.forEach((dot) => {
      expect(dot).toHaveClass('opacity-40')
    })
  })

  it('should highlight stage 1 when currentStageIndex is 1', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={1} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')

    expect(dots[0]).toHaveClass('opacity-40')
    expect(dots[1]).toHaveClass('opacity-100')
    expect(dots[2]).toHaveClass('opacity-40')
    expect(dots[3]).toHaveClass('opacity-40')
  })

  it('should highlight stage 3 when currentStageIndex is 3', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={3} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')

    expect(dots[0]).toHaveClass('opacity-40')
    expect(dots[1]).toHaveClass('opacity-40')
    expect(dots[2]).toHaveClass('opacity-40')
    expect(dots[3]).toHaveClass('opacity-100')
  })

  it('should cycle back to stage 0 when currentStageIndex equals totalStages', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={4} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')

    // Should cycle back to stage 0
    expect(dots[0]).toHaveClass('opacity-100')
    expect(dots[1]).toHaveClass('opacity-40')
  })

  it('should apply correct color styling', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={0} totalStages={4} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')
    const currentDot = dots[0]

    // Should have bg-blue-500 or similar active state color
    expect(currentDot.className).toMatch(/bg-blue/)
  })

  it('should render with correct spacing between dots', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={0} totalStages={4} />
    )
    const dotsContainer = container.querySelector('[data-testid="stage-dots-container"]')

    // Should have flex gap classes for spacing
    expect(dotsContainer?.className).toMatch(/gap-/)
  })

  it('should handle single stage gracefully', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={0} totalStages={1} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')

    expect(dots.length).toBe(1)
    expect(dots[0]).toHaveClass('opacity-100')
  })

  it('should handle many stages (8 dots)', () => {
    const { container } = render(
      <StageIndicator currentStageIndex={4} totalStages={8} />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')

    expect(dots.length).toBe(8)
    expect(dots[4]).toHaveClass('opacity-100')
  })
})
