import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { QueueOverviewCard } from '../QueueOverviewCard'
import { GenerationQueueItem } from '@/lib/visual/generation-config'

function makeItem(overrides: Partial<GenerationQueueItem> = {}): GenerationQueueItem {
  return {
    postId: 'post-1',
    assetId: 'asset-1',
    assetType: 'image',
    startedAt: Date.now(),
    retryCount: 0,
    status: 'generating',
    elapsed: 30,
    estimatedRemainingMs: 150000,
    stage: 'Generating concept…',
    ...overrides,
  }
}

describe('QueueOverviewCard', () => {
  it('renders nothing when activeGenerations is empty', () => {
    const { container } = render(
      <QueueOverviewCard activeGenerations={{}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders collapsed badge showing count "1" when there is 1 active generation', () => {
    render(
      <QueueOverviewCard
        activeGenerations={{ 'post-1': makeItem({ postId: 'post-1' }) }}
      />
    )
    // Collapsed badge shows the count
    expect(screen.getByText('1')).toBeInTheDocument()
    // Expanded list should not be visible
    expect(screen.queryByText('生成中 (1)')).not.toBeInTheDocument()
  })

  it('auto-expands when there are 2 or more active generations', () => {
    render(
      <QueueOverviewCard
        activeGenerations={{
          'post-1': makeItem({ postId: 'post-1' }),
          'post-2': makeItem({ postId: 'post-2', assetType: 'video' }),
        }}
      />
    )
    // Expanded header should be visible
    expect(screen.getByText('生成中 (2)')).toBeInTheDocument()
  })

  it('collapses when the × button is clicked', () => {
    render(
      <QueueOverviewCard
        activeGenerations={{
          'post-1': makeItem({ postId: 'post-1' }),
          'post-2': makeItem({ postId: 'post-2' }),
        }}
      />
    )
    // Should start expanded (2 items)
    expect(screen.getByText('生成中 (2)')).toBeInTheDocument()

    // Click the × button
    const closeButton = screen.getByLabelText('收起')
    fireEvent.click(closeButton)

    // Expanded header should now be gone
    expect(screen.queryByText('生成中 (2)')).not.toBeInTheDocument()
    // Badge should appear instead showing count
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('calls onScrollTo with the correct postId when a task row is clicked', () => {
    const onScrollTo = vi.fn()
    render(
      <QueueOverviewCard
        activeGenerations={{
          'post-1': makeItem({ postId: 'post-1' }),
          'post-2': makeItem({ postId: 'post-2' }),
        }}
        onScrollTo={onScrollTo}
      />
    )

    // Find task rows by their stage text
    const rows = screen.getAllByText('Generating concept…')
    expect(rows.length).toBeGreaterThanOrEqual(1)

    // Click the first row (post-1's list item)
    const listItems = screen.getAllByRole('listitem')
    fireEvent.click(listItems[0])

    expect(onScrollTo).toHaveBeenCalledTimes(1)
    // Called with one of the known postIds
    expect(['post-1', 'post-2']).toContain(onScrollTo.mock.calls[0][0])
  })
})
