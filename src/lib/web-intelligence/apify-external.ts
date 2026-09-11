import { runActorAndGetResults } from '@/lib/apify/client'
import { buildExternalObservation, sourceDefinition } from './sources'
import type { ExternalObservation } from './contracts'

type RawExternalItem = Record<string, unknown>

export type ApifyExternalCollection = {
  observations: ExternalObservation[]
  rejected: number
  runId: string | null
  error?: string
}

function text(item: RawExternalItem, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function optionalText(item: RawExternalItem, keys: string[]): string | null {
  return text(item, keys) || null
}

function validUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Adapt an Apify dataset into the shared WI observation contract.
 *
 * Actor schemas vary, so this adapter accepts common article/job fields but
 * fails closed for rows without a verifiable URL and useful text. It does not
 * infer facts or identify authors; interpretation happens after persistence.
 */
export async function collectApifyExternalObservations(input: {
  actorId: string
  actorInput: Record<string, unknown>
  sourceId: string
  clientId: string
  observedAt: string
  validUntil?: string | null
  timeoutMs?: number
}): Promise<ApifyExternalCollection> {
  if (!sourceDefinition(input.sourceId)) throw new Error('unknown_external_source')
  const result = await runActorAndGetResults<RawExternalItem>(input.actorId, input.actorInput, input.timeoutMs)
  if (!result.success) return { observations: [], rejected: 0, runId: result.runId, error: result.error }

  const observations: ExternalObservation[] = []
  let rejected = 0
  for (const item of result.data) {
    const sourceUrl = text(item, ['url', 'sourceUrl', 'source_url', 'link', 'articleUrl', 'jobUrl'])
    const title = text(item, ['title', 'name', 'headline'])
    const excerpt = text(item, ['excerpt', 'description', 'text', 'content', 'summary', 'snippet'])
    if (!validUrl(sourceUrl) || !excerpt) {
      rejected += 1
      continue
    }
    try {
      observations.push(buildExternalObservation({
        client_id: input.clientId,
        source_id: input.sourceId,
        source_url: sourceUrl,
        title,
        excerpt,
        competitor_domain: optionalText(item, ['competitorDomain', 'competitor_domain', 'domain']),
        published_at: optionalText(item, ['publishedAt', 'published_at', 'datePublished', 'date', 'postedAt']),
        observed_at: input.observedAt,
        valid_until: input.validUntil,
        authorization_confirmed: input.sourceId === 'facebook-group-authorized' ? item.authorizationConfirmed === true : undefined,
      }))
    } catch {
      rejected += 1
    }
  }
  return { observations, rejected, runId: result.runId }
}
