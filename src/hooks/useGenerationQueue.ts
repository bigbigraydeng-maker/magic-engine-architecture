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
  const timeoutRefs = useRef<Record<string, NodeJS.Timeout>>({})
  const retryTimeoutRefs = useRef<Record<string, NodeJS.Timeout>>({})

  // Keep live ref to queueState so interval callbacks always read current data
  const queueStateRef = useRef(queueState)
  useEffect(() => {
    queueStateRef.current = queueState
  }, [queueState])

  // Keep live ref to callbacks — prevents recreating all useCallbacks when the
  // caller passes a new object identity on every render (e.g. inline `{onStatusChange}`)
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  // Restore queue from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('generation_queue_state')
    if (saved) {
      try {
        const data = JSON.parse(saved) as { version?: number; state?: GenerationQueueState } & GenerationQueueState

        // Version check: clear if schema changed
        const QUEUE_VERSION = 1
        if (data.version && data.version !== QUEUE_VERSION) {
          localStorage.removeItem('generation_queue_state')
          return
        }

        // Use versioned state format if available, otherwise treat as old format
        const restored = (data.version === QUEUE_VERSION) ? data.state : (data as GenerationQueueState)

        if (!restored || !restored.queue) {
          localStorage.removeItem('generation_queue_state')
          return
        }

        const now = Date.now()

        const validQueue = restored.queue.filter(item => {
          const age = now - item.startedAt
          return age < GENERATION_CONFIG.POLLING_TIMEOUT_MS
        })

        const validActiveGenerations: Record<string, GenerationQueueItem> = {}
        Object.entries(restored.activeGenerations || {}).forEach(([postId, item]) => {
          const age = now - item.startedAt
          if (age < GENERATION_CONFIG.POLLING_TIMEOUT_MS) {
            validActiveGenerations[postId] = item
          }
        })

        if (validQueue.length > 0 || Object.keys(validActiveGenerations).length > 0) {
          setQueueState({
            queue: validQueue,
            activeGenerations: validActiveGenerations,
          })
        } else {
          localStorage.removeItem('generation_queue_state')
        }
      } catch {
        localStorage.removeItem('generation_queue_state')
      }
    }
  }, [])

  // Persist queue to localStorage on change
  useEffect(() => {
    const QUEUE_VERSION = 1
    localStorage.setItem('generation_queue_state', JSON.stringify({
      version: QUEUE_VERSION,
      state: queueState,
    }))
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

        const rawType = body.asset_type
        const assetType: 'image' | 'video' | 'avatar_video' =
          rawType === 'video' || rawType === 'avatar_video' ? rawType : 'image'
        const item: GenerationQueueItem = {
          postId,
          assetId: data.asset_id,
          assetType,
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

        // Notify UI immediately so "Queued X" appears without waiting for a poll cycle
        callbacksRef.current?.onStatusChange?.(postId, item)
        return item
      } catch (e) {
        throw new Error(
          e instanceof Error ? e.message : 'Failed to submit generation'
        )
      }
    },
    []  // stable — reads callbacksRef.current at call time
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
   * Poll status from API and update state accordingly.
   * HIGH FIX #1: reads live item from queueStateRef instead of stale closure.
   */
  const pollStatus = useCallback(
    async (postId: string) => {
      // Read live item so retryCount and assetId are always current
      const item = queueStateRef.current.activeGenerations[postId]
      if (!item) return

      const elapsedMs = Date.now() - item.startedAt
      const elapsed = Math.floor(elapsedMs / 1000)

      if (elapsedMs > GENERATION_CONFIG.POLLING_TIMEOUT_MS) {
        handleGenerationTimeout(item)
        return
      }

      try {
        const res = await fetch(`/api/visual/status/${item.assetId}`)
        if (!res.ok) return

        const data = await res.json()

        if (data.asset?.generation_status === 'ready') {
          handleGenerationComplete(item, data.asset)
        } else if (data.asset?.generation_status === 'failed') {
          handleGenerationFailed(item, data.asset?.error_message)
        } else {
          const stage = getCurrentStage(elapsed)
          setQueueState((prev) => {
            const activeItem = prev.activeGenerations[postId]
            if (!activeItem) return prev
            return {
              ...prev,
              activeGenerations: {
                ...prev.activeGenerations,
                [postId]: { ...activeItem, elapsed, stage },
              },
            }
          })
          callbacksRef.current?.onStatusChange?.(postId, { ...item, elapsed, stage })
        }
      } catch {
        // Transient network error — will retry on next interval tick
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleGenerationComplete/Failed/Timeout are stable ([] deps), no re-creation needed
    []
  )

  /**
   * Handle successful generation completion
   */
  const handleGenerationComplete = useCallback(
    (item: GenerationQueueItem, asset: Record<string, unknown>) => {
      cleanup(item.postId)
      setQueueState((prev) => {
        const newActive = { ...prev.activeGenerations }
        delete newActive[item.postId]
        return { ...prev, activeGenerations: newActive }
      })
      callbacksRef.current?.onStatusChange?.(item.postId, {
        ...item,
        status: 'ready',
        costUsd: (asset.cost_usd as number | undefined) || 0.02,
      })
    },
    [] // stable — reads callbacksRef.current at call time
  )

  /**
   * Handle generation failure — may trigger auto-retry
   */
  const handleGenerationFailed = useCallback(
    (item: GenerationQueueItem, errorMessage?: string) => {
      cleanup(item.postId)

      if (canAutoRetry(item.retryCount)) {
        const delay = getRetryDelay(item.retryCount)
        const retryItem: GenerationQueueItem = {
          ...item,
          retryCount: item.retryCount + 1,
          status: 'queued',
          elapsed: 0,
          stage: 'Initialising…',
          errorMessage,
        }

        setQueueState((prev) => {
          const newActive = { ...prev.activeGenerations }
          delete newActive[item.postId]
          return { ...prev, queue: [...prev.queue, retryItem], activeGenerations: newActive }
        })

        callbacksRef.current?.onAutoRetry?.(item.postId, item.retryCount + 1, delay)
        // processQueue is driven by the queue-change effect; no manual timer needed
      } else {
        setQueueState((prev) => {
          const newActive = { ...prev.activeGenerations }
          delete newActive[item.postId]
          return { ...prev, activeGenerations: newActive }
        })
        callbacksRef.current?.onStatusChange?.(item.postId, {
          ...item,
          status: 'failed',
          errorMessage: errorMessage || `Failed after ${item.retryCount} retries.`,
        })
      }
    },
    [] // stable — reads callbacksRef.current at call time
  )

  /**
   * Handle generation timeout
   */
  const handleGenerationTimeout = useCallback(
    (item: GenerationQueueItem) => {
      cleanup(item.postId)
      setQueueState((prev) => {
        const newActive = { ...prev.activeGenerations }
        delete newActive[item.postId]
        return { ...prev, activeGenerations: newActive }
      })
      const elapsedMs = Date.now() - item.startedAt
      callbacksRef.current?.onTimeout?.(item.postId, elapsedMs)
      callbacksRef.current?.onStatusChange?.(item.postId, {
        ...item,
        status: 'timeout',
        errorMessage: 'Generation timed out. The provider may still be processing in the background.',
        elapsed: Math.floor(elapsedMs / 1000),
      })
    },
    [] // stable — reads callbacksRef.current at call time
  )

  /**
   * Process the queue: promote next item if a slot is available
   */
  const processQueue = useCallback(() => {
    let promotedItem: GenerationQueueItem | null = null

    setQueueState((prev) => {
      const activeCount = Object.keys(prev.activeGenerations).length
      if (
        activeCount >= GENERATION_CONFIG.MAX_CONCURRENT_GENERATIONS ||
        prev.queue.length === 0
      ) {
        return prev
      }
      const next = prev.queue[0]
      const updatedNext: GenerationQueueItem = { ...next, status: 'generating', stage: 'Initialising…' }
      promotedItem = updatedNext
      return {
        queue: prev.queue.slice(1),
        activeGenerations: { ...prev.activeGenerations, [next.postId]: updatedNext },
      }
    })

    if (promotedItem) {
      const item = promotedItem as GenerationQueueItem
      callbacksRef.current?.onStatusChange?.(item.postId, item)
    }
  }, []) // stable — reads callbacksRef.current at call time

  /**
   * Stop timers for a post
   */
  const cleanup = useCallback((postId: string) => {
    clearInterval(pollingRefs.current[postId])
    clearTimeout(timeoutRefs.current[postId])
    clearTimeout(retryTimeoutRefs.current[postId])
    delete pollingRefs.current[postId]
    delete timeoutRefs.current[postId]
    delete retryTimeoutRefs.current[postId]
  }, [])

  /**
   * HIGH FIX #3: Fully cancel a generating/queued item — evicts from state,
   * stops timers, and frees the concurrency slot.
   */
  const cancelGeneration = useCallback((postId: string) => {
    cleanup(postId)
    setQueueState((prev) => {
      const newActive = { ...prev.activeGenerations }
      delete newActive[postId]
      const newQueue = prev.queue.filter(item => item.postId !== postId)
      return { queue: newQueue, activeGenerations: newActive }
    })
  }, [cleanup])

  /**
   * Start polling for active generation items
   * HIGH FIX #1: interval callback uses postId to look up live item via ref
   */
  useEffect(() => {
    const items = Object.values(queueState.activeGenerations)

    items.forEach((item) => {
      if (!pollingRefs.current[item.postId]) {
        pollingRefs.current[item.postId] = setInterval(
          () => pollStatus(item.postId),  // pass postId, not stale item object
          GENERATION_CONFIG.POLLING_INTERVAL_MS
        )
        timeoutRefs.current[item.postId] = setTimeout(
          () => {
            // Read the live item from ref so timeout fires with current state
            const liveItem = queueStateRef.current.activeGenerations[item.postId]
            if (liveItem) handleGenerationTimeout(liveItem)
          },
          GENERATION_CONFIG.POLLING_TIMEOUT_MS
        )
      }
    })

    // Capture ref snapshot so cleanup reads the same object even after re-renders
    const pollingRefsSnapshot = pollingRefs.current
    return () => {
      const activeIds = Object.keys(queueState.activeGenerations)
      Object.keys(pollingRefsSnapshot).forEach((postId) => {
        if (!activeIds.includes(postId)) {
          clearInterval(pollingRefsSnapshot[postId])
          delete pollingRefsSnapshot[postId]
        }
      })
    }
  }, [queueState.activeGenerations, pollStatus, handleGenerationTimeout]) // pollStatus and handleGenerationTimeout are now stable (empty deps)

  /**
   * Process queue whenever it changes or a slot opens
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
    cancelGeneration,
    getQueuePosition,
    cleanup,
  }
}
