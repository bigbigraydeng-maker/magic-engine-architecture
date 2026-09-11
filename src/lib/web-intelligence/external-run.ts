import type { ExternalObservation } from './contracts'
import { recordExternalObservation } from './store'
import { collectApifyExternalObservations, type ApifyExternalCollection } from './apify-external'

export type ExternalRunReceipt = ApifyExternalCollection & {
  persisted: number
  duplicates: number
  writeFailures: number
}

/**
 * Execute one bounded Apify collection and persist its normalized rows.
 * Persistence is deliberately per observation so one duplicate cannot discard
 * the rest of a successful provider result.
 */
export async function collectAndRecordExternalObservations(input: {
  actorId: string
  actorInput: Record<string, unknown>
  sourceId: string
  clientId: string
  observedAt: string
  validUntil?: string | null
  timeoutMs?: number
  persist?: (observation: ExternalObservation) => Promise<string>
}): Promise<ExternalRunReceipt> {
  const collection = await collectApifyExternalObservations(input)
  const persist = input.persist ?? recordExternalObservation
  let persisted = 0
  let duplicates = 0
  let writeFailures = 0
  for (const observation of collection.observations) {
    try {
      await persist(observation)
      persisted += 1
    } catch (error) {
      if (error instanceof Error && error.message === 'external_observation_duplicate') duplicates += 1
      else writeFailures += 1
    }
  }
  return { ...collection, persisted, duplicates, writeFailures }
}
