import React from 'react'
import { render } from '@testing-library/react'
import { CountdownText } from '../CountdownText'

describe('CountdownText', () => {
  it('should render seconds only', () => {
    const { container } = render(<CountdownText remainingMs={45000} />)
    const text = container.textContent
    expect(text).toBe('45s')
  })

  it('should render minutes and seconds', () => {
    const { container } = render(<CountdownText remainingMs={125000} />)
    const text = container.textContent
    expect(text).toMatch(/^[0-9]+m [0-9]+s$/)
  })

  it('should handle 1 minute exactly', () => {
    const { container } = render(<CountdownText remainingMs={60000} />)
    const text = container.textContent
    expect(text).toBe('1m 0s')
  })

  it('should handle very small values', () => {
    const { container } = render(<CountdownText remainingMs={1000} />)
    const text = container.textContent
    expect(text).toBe('1s')
  })

  it('should handle zero milliseconds', () => {
    const { container } = render(<CountdownText remainingMs={0} />)
    const text = container.textContent
    expect(text).toBe('0s')
  })

  it('should apply amber color class', () => {
    const { container } = render(<CountdownText remainingMs={45000} />)
    const textElement = container.querySelector('[data-testid="countdown-text"]')
    expect(textElement?.className).toMatch(/text-amber/)
  })

  it('should have data-testid attribute', () => {
    const { container } = render(<CountdownText remainingMs={45000} />)
    const textElement = container.querySelector('[data-testid="countdown-text"]')
    expect(textElement).toBeInTheDocument()
  })

  it('should handle large durations (hours)', () => {
    const { container } = render(<CountdownText remainingMs={7200000} />)
    const text = container.textContent
    expect(text).toMatch(/^\d+m \d+s$/)
  })

  it('should update when props change', () => {
    const { rerender, container } = render(
      <CountdownText remainingMs={60000} />
    )
    expect(container.textContent).toBe('1m 0s')

    rerender(<CountdownText remainingMs={30000} />)
    expect(container.textContent).toBe('30s')
  })
})
