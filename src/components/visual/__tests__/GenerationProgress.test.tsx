import React from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { GenerationProgress } from '../GenerationProgress'

describe('GenerationProgress', () => {
  it('should render stage indicator, countdown text, and progress ring', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={90000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const stageIndicator = container.querySelector('[data-testid="stage-dots-container"]')
    const countdownText = container.querySelector('[data-testid="countdown-text"]')
    const progressRing = container.querySelector('[data-testid="progress-ring"]')
    expect(stageIndicator).toBeInTheDocument()
    expect(countdownText).toBeInTheDocument()
    expect(progressRing).toBeInTheDocument()
  })

  it('should display correct progress percentage in ring', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={1}
        totalStages={4}
        elapsedMs={90000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const progressRing = container.querySelector('[data-testid="progress-ring"]')
    expect(progressRing).toBeInTheDocument()
    const circles = progressRing?.querySelectorAll('circle')
    expect(circles?.length).toBeGreaterThan(0)
  })

  it('should disable cancel button when below 1.5x threshold', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={200000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const cancelButton = container.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement
    expect(cancelButton?.disabled).toBe(true)
  })

  it('should enable cancel button when at or above 1.5x threshold', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={270000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const cancelButton = container.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement
    expect(cancelButton?.disabled).toBe(false)
  })

  it('should call onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={300000}
        expectedMs={180000}
        onCancel={onCancel}
      />
    )
    const cancelButton = container.querySelector('[data-testid="cancel-button"]')
    if (cancelButton) {
      await user.click(cancelButton)
      expect(onCancel).toHaveBeenCalledTimes(1)
    }
  })

  it('should pass correct props to StageIndicator', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={2}
        totalStages={4}
        elapsedMs={90000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const dots = container.querySelectorAll('[data-testid="stage-dot"]')
    expect(dots.length).toBe(4)
    expect(dots[2]).toHaveClass('opacity-100')
  })

  it('should pass correct remaining time to CountdownText', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={45000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const countdownText = container.querySelector('[data-testid="countdown-text"]')
    expect(countdownText?.textContent).toMatch(/[0-9]+[ms]/)
  })

  it('should update when elapsed time changes', () => {
    const { rerender, container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={30000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const initialText = container.querySelector('[data-testid="countdown-text"]')?.textContent
    rerender(
      <GenerationProgress
        currentStageIndex={1}
        totalStages={4}
        elapsedMs={90000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const updatedText = container.querySelector('[data-testid="countdown-text"]')?.textContent
    expect(updatedText).not.toBe(initialText)
  })

  it('should display progress ring with correct styling', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={90000}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const progressRing = container.querySelector('[data-testid="progress-ring"]')
    expect(progressRing).toBeInTheDocument()
    const progressCircle = progressRing?.querySelectorAll('circle')[1]
    expect(progressCircle?.getAttribute('stroke')).toBe('rgb(59, 130, 246)')
  })

  it('should handle zero elapsed time', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={0}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const countdownText = container.querySelector('[data-testid="countdown-text"]')
    expect(countdownText?.textContent).toBe('3m 0s')
  })

  // P9.0.10 — progress ring data-value assertions
  it('progress ring data-value is 0 when elapsed=0', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={0}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const circle = container.querySelector('[data-value]')
    expect(Number(circle?.getAttribute('data-value'))).toBe(0)
  })

  it('progress ring data-value is 50 when elapsed=expectedMs/2', () => {
    const expectedMs = 180000
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={expectedMs / 2}
        expectedMs={expectedMs}
        onCancel={() => {}}
      />
    )
    const circle = container.querySelector('[data-value]')
    expect(Number(circle?.getAttribute('data-value'))).toBe(50)
  })

  it('progress ring data-value caps at 95 when elapsed=expectedMs', () => {
    const expectedMs = 180000
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={expectedMs}
        expectedMs={expectedMs}
        onCancel={() => {}}
      />
    )
    const circle = container.querySelector('[data-value]')
    const val = Number(circle?.getAttribute('data-value'))
    expect(val).toBeLessThanOrEqual(95)
    expect(val).toBeGreaterThan(90)
  })

  it('cancel button disabled when elapsed < 1.5x expected (P9.0.10)', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={Math.floor(180000 * 1.4)}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const btn = container.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('cancel button enabled when elapsed >= 1.5x expected (P9.0.10)', () => {
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={180000 * 1.5}
        expectedMs={180000}
        onCancel={() => {}}
      />
    )
    const btn = container.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
  })

  it('onCancel is called when enabled cancel button clicked (P9.0.10)', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <GenerationProgress
        currentStageIndex={0}
        totalStages={4}
        elapsedMs={180000 * 2}
        expectedMs={180000}
        onCancel={onCancel}
      />
    )
    const btn = container.querySelector('[data-testid="cancel-button"]')!
    await user.click(btn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders without crash when progressPercent=0 (P9.0.10)', () => {
    expect(() =>
      render(
        <GenerationProgress
          currentStageIndex={0}
          totalStages={4}
          elapsedMs={0}
          expectedMs={180000}
          onCancel={() => {}}
        />
      )
    ).not.toThrow()
  })
})
