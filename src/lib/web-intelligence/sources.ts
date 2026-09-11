import { createHash } from 'node:crypto'
import { externalSourceTierSchema, externalSourceTypeSchema, type ExternalObservation, type ExternalSourceTier, type ExternalSourceType } from './contracts'

export type ExternalSourceDefinition = {
  id: string; name: string; type: ExternalSourceType; tier: ExternalSourceTier; market: string
  requires_authorization?: boolean
}

/** Initial source registry. Domains and selectors remain provider configuration, not runtime assumptions. */
export const externalSourceRegistry: readonly ExternalSourceDefinition[] = [
  { id: 'seek-nz', name: 'SEEK', type: 'jobs', tier: 'B', market: 'NZ' },
  { id: 'indeed-nz', name: 'Indeed', type: 'jobs', tier: 'B', market: 'NZ' },
  { id: 'travel-today', name: 'Travel Today', type: 'industry_media', tier: 'B', market: 'NZ/AU' },
  // Controlled source only: authorised export or Meta-approved integration.
  { id: 'facebook-group-authorized', name: 'Facebook Group（授权）', type: 'facebook_group', tier: 'C', market: 'customer-authorized', requires_authorization: true },
]

export function sourceDefinition(id: string): ExternalSourceDefinition | null {
  return externalSourceRegistry.find(source => source.id === id) ?? null
}

export function canonicalExternalUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key)
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString()
}

export function observationContentHash(title: string, excerpt: string): string {
  return createHash('sha256').update(`${title.trim()}\n${excerpt.trim()}`).digest('hex')
}

export function normalisePublishedAt(value: string | null | undefined): string | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

export function buildExternalObservation(input: {
  client_id: string; source_id: string; source_url: string; title?: string; excerpt: string
  competitor_domain?: string | null; published_at?: string | null; observed_at: string; valid_until?: string | null
  authorization_confirmed?: boolean
}): ExternalObservation {
  const source = sourceDefinition(input.source_id)
  if (!source) throw new Error('unknown_external_source')
  if (source.requires_authorization && input.authorization_confirmed !== true) throw new Error('source_authorization_required')
  const canonical_url = canonicalExternalUrl(input.source_url)
  const title = input.title?.trim() ?? ''
  const excerpt = input.excerpt.trim()
  return {
    client_id: input.client_id, source_type: externalSourceTypeSchema.parse(source.type), source_tier: externalSourceTierSchema.parse(source.tier),
    source_name: source.name, source_url: input.source_url, canonical_url, title, excerpt,
    competitor_domain: input.competitor_domain ?? null, published_at: normalisePublishedAt(input.published_at),
    observed_at: new Date(input.observed_at).toISOString(), valid_until: normalisePublishedAt(input.valid_until),
    content_hash: observationContentHash(title, excerpt), status: 'observed',
  }
}
