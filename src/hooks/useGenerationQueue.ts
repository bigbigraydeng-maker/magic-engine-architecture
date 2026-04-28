/**
 * useGenerationQueue Hook
 * Manages generation queue with concurrency control, timeout protection,
 * and intelligent auto-retry for image/video/avatar generation.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  GENERATION_CONFIG,
  GenerationQueueItem,
  GenerationQueueState,
  GenerationQueueCallbacks,
  canAutoRetry,
  getRetryDelay,
  getCurrentStage,
} from '@/lib/visual/generation-config'

export function useGenerationQueue(callbacks?: GenerationQueueCallbacks) {
  const [queueState, setQueueState] = useState<GenerationQueueState>({
    queue: [],
    activeGenerations: {},
  })

  // Refs to track intervals and timeouts
  const pollingRefs = useRef<Record<string, NodeJS.Timeout>>({})
  const elapsedRefs = useRef<Record<string, NodeJS.Timeout>>({})
  const timeoutRefs = useRef<Record<string, NodeJS.Timeout>>({})
  const retryTimeoutRefs = useRef<Record<string, NodeJS.Timeout>>({})

  // Restore queue from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('generation_queue_state')
    if (saved) {
      try {
        const restored = JSON.parse(saved) as GenerationQueueState
        const now = Date.now()

        // Filter out stale queue items (older than 60 minutes)
        const validQueue = restored.queue.filter(item => {
          const age = now - item.startedAt
          return age < GENERATION_CONFIG.POLLING_TIMEOUT_MS
        })

        // Also clean up stale active generations
        const validActiveGenerations: Record<string, GenerationQueueItem> = {}
        Object.entries(restored.activeGenerations).forEach(([postId, item]) => {
          const age = now - item.startedAt
          if (age < GENERATION_CONFIG.POLLING_TIMEOUT_MS) {
            validActiveGenerations[postId] = item
          }
        })

        // Only restore if we have valid items
        if (validQueue.length > 0 || Object.keys(validActiveGenerations).length > 0) {
          setQueueState({
            queue: validQueue,
            activeGenerations: validActiveGenerations,
          })
          console.log(`[Queue] Restored ${validQueue.length} queue items, ${Object.keys(validActiveGenerations).length} active generations`)
        } else {
          // Clear stale data
          localStorage.removeItem('generation_queue_state')
          console.log('[Queue] Cleared stale queue data')
        }
      } catch (e) {
        console.warn('Failed to restore queue state:', e)
        localStorage.removeItem('generation_queue_state')
      }
    }
  }, [])

  // Persist queue to localStorage on change
  useEffect(() => {
    localStorage.setItem('generation_queue_state', JSON.stringify(queueState))
  }, [queueState])

  /**
   * Submit a new generation request to the queue
   */
  const submitGeneration = useCallback(
    async (
      postId: string,
      apiPath: string,
      body: Record<string, unknown>
    ): Promise<GenerationQueueItem> => {
      try {
        const res = await fetch(apiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        const data = await res.json()
        if (!data.success) {
          throw new Error(data.error || 'Failed to submit generation')
        }

        const assetType = (body.asset_type as string) || 'image'
        const item: GenerationQueueItem = {
          postId,
          assetId: data.asset_id,
          assetType: assetType as
            | 'image'
            | 'video'
            | 'avatar_video',
          startedAt: Date.now(),
          retryCount: 0,
          status: 'queued',
          elapsed: 0,
          stage: 'Initialising…',
        }

        setQueueState((prev) => ({
          ...prev,
          queue: [...prev.queue, item],
        }))

        callbacks?.onQueueChange?.(queueState)
        return item
      } catch (e) {
        throw new Error(
          e instanceof Error ? e.message : 'Failed to submit generation'
        )
      }
    },
    [queueState, callbacks]
  )

  /**
   * Get queue position for a post (1-indexed, or undefined if not in queue)
   */
  const getQueuePosition = useCallback(
    (postId: string): number | undefined => {
      const index = queueState.queue.findIndex((item) => item.postId === postId)
      return index >= 0 ? index + 1 : undefined
    },
    [queueState.queue]
  )

  /**
   * Poll status from API and update state accordingly
   */
  const pollStatus = useCallback(
    async (item: GenerationQueueItem) => {
      const elapsedMs = Date.now() - item.startedAt
      const elapsed = Math.floor(elapsedMs / 1000)

      // Check timeout
      if (elapsedMs > GENERATION_CONFIG.POLLING_TIMEOUT_MS) {
        handleGenerationTimeout(item)
        return
      }

      try {
        const res = await fetch(`/api/visual/status/${item.assetId}`)
        if (!res.ok) {
          console.error(`Status check failed: ${res.status}`)
          return
        }

        const data = await res.json()

        if (data.asset?.generation_status === 'ready') {
          // Generation succeeded
          handleGenerationComplete(item, data.asset)
        } else if (data.asset?.generation_status === 'failed') {
          // Generation failed
          handleGenerationFailed(item, data.asset?.error_message)
        } else {
          // Still processing - update elapsed time and stage
          const stage = getCurrentStage(elapsed)
          setQueueState((prev) => {
            const activeItem = prev.activeGenerations[item.postId]
            if (!activeItem) return prev

            const updated: GenerationQueueItem = {
              ...activeItem,
              elapsed,
              stage,
            }

            return {
              ...prev,
              activeGenerations: {
                ...prev.activeGenerations,
                [item.postId]: updated,
              },
            }
          })

          callbacks?.onStatusChange?.(item.postId, {
            ...item,
            elapsed,
            stage,
          })
        }
      } catch (e) {
        console.error(`Poll error for ${item.assetId}:`, e)
      }
    },
    [callbacks]
  )

  /**
   * Handle successful generation completion
   */
  const handleGenerationComplete = useCallback(
    (item: GenerationQueueItem, asset: Record<string, unknown>) => {
      setQueueState((prev) => {
        const newActive = { ...prev.activeGenerations }
        delete newActive[item.postId]
        return { ...prev, activeGenerations: newActive }
      })

      const completed: GenerationQueueItem = {
        ...item,
        status: 'ready',
        costUsd: (asset.cost_usd as number | undefined) || 0.02,
      }

      callbacks?.onStatusChange?.(item.postId, completed)
    },
    [callbacks]
  )

  /**
   * Handle generation failure - may trigger auto-retry
   */
  const handleGenerationFailed = useCallback(
    (item: GenerationQueueItem, errorMessage?: string) => {
      if (canAutoRetry(item.retryCount)) {
        // Schedule auto-retry with exponential backoff
        const delay = getRetryDelay(item.retryCount)
        const retryItem: GenerationQueueItem = {
          ...item,
          retryCount: item.retryCount + 1,
          status: 'queued',
          elapsed: 0,
          stage: 'Initialising…',
          errorMessage,
        }

        // Remove from active, add back to queue
        setQueueState((prev) => {
          const newActive = { ...prev.activeGenerations }
          delete newActive[item.postId]
          return {
            ...prev,
            queue: [...prev.queue, retryItem],
            activeGenerations: newActive,
          }
        })

        callbacks?.onAutoRetry?.(item.postId, item.retryCount + 1, delay)

        // Schedule the queue processing after delay
        const timeoutId = setTimeout(() => {
          processQueue()
        }, delay)

        retryTimeoutRefs.current[item.postId] = timeoutId
      } else {
        // Max retries exceeded - mark as failed
        setQueueState((prev) => {
          const newActive = { ...prev.activeGenerations }
          delete newActive[item.postId]
          return { ...prev, activeGenerations: newActive }
        })

        const failed: GenerationQueueItem = {
          ...item,
          status: 'failed',
          errorMessage:
            errorMessage ||
            `Failed after ${item.retryCount} retries. Please check your prompt and try again.`,
        }

        callbacks?.onStatusChange?.(item.postId, failed)
      }
    },
    [callbacks]
  )

  /**
   * Handle generation timeout
   */
  const handleGenerationTimeout = useCallback(
    (item: GenerationQueueItem) => {
      setQueueState((prev) => {
        const newActive = { ...prev.activeGenerations }
        delete newActive[item.postId]
        return { ...prev, activeGenerations: newActive }
      })

      const elapsedMs = Date.now() - item.startedAt
      callbacks?.onTimeout?.(item.postId, elapsedMs)

      const timedOut: GenerationQueueItem = {
        ...item,
        status: 'timeout',
        errorMessage:
          'Generation exceeded 60-minute timeout. The provider may still be processing your request in the background.',
        elapsed: Math.floor(elapsedMs / 1000),
      }

      callbacks?.onStatusChange?.(item.postId, timedOut)
    },
    [callbacks]
  )

  /**
   * Process the queue: start next item if space available
   */
  const processQueue = useCallback(() => {
    setQueueState((prev) => {
      const activeCount = Object.keys(prev.activeGenerations).length

      // Stop if queue is full or no pending items
      if (
        activeCount >= GENERATION_CONFIG.MAX_CONCURRENT_GENERATIONS ||
        prev.queue.length === 0
      ) {
        return prev
      }

      // Move first queued item to active
      const next = prev.queue[0]
      const updatedNext: GenerationQueueItem = {
        ...next,
        status: 'generating',
        stage: 'Initialising…',
      }

      return {
        queue: prev.queue.slice(1),
        activeGenerations: {
          ...prev.activeGenerations,
          [next.postId]: updatedNext,
        },
      }
    })
  }, [])

  /**
   * Cleanup all timers for a post
   */
  const cleanup = useCallback((postId: string) => {
    clearInterval(pollingRefs.current[postId])
    clearInterval(elapsedRefs.current[postId])
    clearTimeout(timeoutRefs.current[postId])
    clearTimeout(retryTimeoutRefs.current[postId])

    delete pollingRefs.current[postId]
    delete elapsedRefs.current[postId]
    delete timeoutRefs.current[postId]
    delete retryTimeoutRefs.current[postId]
  }, [])

  /**
   * Start polling for active generation items
   */
  useEffect(() => {
    const items = Object.values(queueState.activeGenerations)

    items.forEach((item) => {
      // Start polling if not already polling this item
      if (!pollingRefs.current[item.postId]) {
        pollingRefs.current[item.postId] = setInterval(
          () => pollStatus(item),
          GENERATION_CONFIG.POLLING_INTERVAL_MS
        )

        // Set timeout alarm
        const timeoutId = setTimeout(
          () => {
            handleGenerationTimeout(item)
          },
          GENERATION_CONFIG.POLLING_TIMEOUT_MS
        )
        timeoutRefs.current[item.postId] = timeoutId
      }
    })

    // Cleanup polling for items no longer active
    return () => {
      Object.entries(pollingRefs.current).forEach(([postId, ref]) => {
        if (!queueState.activeGenerations[postId]) {
          clearInterval(ref)
          delete pollingRefs.current[postId]
        }
      })
    }
  }, [queueState.activeGenerations, pollStatus, handleGenerationTimeout])

  /**
   * Process queue when space opens up or new items added to queue
   */
  useEffect(() => {
    const activeCount = Object.keys(queueState.activeGenerations).length
    if (activeCount < GENERATION_CONFIG.MAX_CONCURRENT_GENERATIONS) {
      processQueue()
    }
  }, [queueState.queue, queueState.activeGenerations, processQueue])

  return {
    queueState,
    submitGeneration,
    pollStatus,
    processQueue,
    getQueuePosition,
    cleanup,
  }
}
