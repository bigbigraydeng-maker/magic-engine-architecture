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

function jobExcerpt(item: RawExternalItem): string {
  const parts = [
    ['职位', text(item, ['title', 'name'])],
    ['公司', text(item, ['company', 'companyName'])],
    ['地点', text(item, ['location'])],
    ['薪资', text(item, ['salaryText', 'salary'])],
    ['简介', text(item, ['teaser', 'descriptionText', 'description'])],
  ]
  return parts.filter(([, value]) => value).map(([label, value]) => `${label}：${value}`).join('\n')
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
    const excerpt = text(item, ['excerpt', 'description', 'descriptionText', 'teaser', 'text', 'content', 'summary', 'snippet'])
      || (input.sourceId === 'seek-nz' ? jobExcerpt(item) : '')
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
        published_at: optionalText(item, ['publishedAt', 'published_at', 'publishedDate', 'pub_date', 'datePublished', 'date', 'postedAt', 'postedDate']),
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

/** Actor IDs and input shapes verified against their current Apify Store pages.
 * Keep these in one place so a provider replacement does not spread through WI.
 */
export const WI_APIFY_ACTORS = {
  rssFeed: 'ef12/rss-scraper',
  articleExtractor: 'automation-lab/news-article-extractor',
  seekNz: 'corvuslab/seek-scraper',
} as const

export function collectRssFeed(input: {
  sourceId: string; clientId: string; feedUrl: string; observedAt: string; maxResults?: number
}): Promise<ApifyExternalCollection> {
  return collectApifyExternalObservations({
    actorId: WI_APIFY_ACTORS.rssFeed,
    actorInput: { feed_url: input.feedUrl, max_results: Math.min(input.maxResults ?? 25, 200) },
    sourceId: input.sourceId, clientId: input.clientId, observedAt: input.observedAt,
  })
}

export function collectIndustryWebsite(input: {
  sourceId: string; clientId: string; siteUrl: string; observedAt: string; maxArticles?: number
}): Promise<ApifyExternalCollection> {
  return collectApifyExternalObservations({
    actorId: WI_APIFY_ACTORS.articleExtractor,
    actorInput: {
      startUrls: [input.siteUrl], maxArticles: Math.min(input.maxArticles ?? 20, 50),
      extractFullContent: true, includeImages: false,
    },
    sourceId: input.sourceId, clientId: input.clientId, observedAt: input.observedAt,
  })
}

export function collectSeekNzJobs(input: {
  clientId: string; query?: string; queries?: string[]; location?: string; observedAt: string; maxResults?: number
}): Promise<ApifyExternalCollection> {
  return collectApifyExternalObservations({
    actorId: WI_APIFY_ACTORS.seekNz,
    actorInput: {
      ...(input.query ? { query: input.query } : {}), ...(input.queries?.length ? { queries: input.queries } : {}),
      country: 'NZ', ...(input.location ? { location: input.location } : {}),
      dateRange: '7', sortMode: 'date', maxResults: Math.min(input.maxResults ?? 50, 100),
      includeDetails: true, incrementalMode: true, compact: false, excludeEmptyFields: true,
    },
    sourceId: 'seek-nz', clientId: input.clientId, observedAt: input.observedAt,
  })
}
