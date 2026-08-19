import { Resend } from 'resend'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { MARKET_INTEL_SOURCES } from './sources'
import { fetchFeed, FeedFetchError } from './rss'
import { dedupeHash } from './dedupe'
import { matchCategory } from './categorize'
import { buildDigestEmailHtml, buildDigestEmailSubject } from './email-template'
import { nzDateString } from './nz-date'
import type { CandidateItem, MarketIntelCategory } from './types'

const MAX_PER_CATEGORY = 2

export interface PipelineResult {
  sent: boolean
  reason?: string
  itemsConsidered: number
  itemsSelected: number
  sourceFailures: string[]
}

// ---------------------------------------------------------------------------
// 1. 逐信源抓取，把命中分类的条目收进候选池。不落库、不追踪跨天健康度——
//    这是内部实验阶段的最小闭环，每次抓取失败只在当次 cron 日志里报告。
// ---------------------------------------------------------------------------
async function collectCandidates(): Promise<{ candidates: CandidateItem[]; sourceFailures: string[] }> {
  const candidates: CandidateItem[] = []
  const sourceFailures: string[] = []

  for (const source of MARKET_INTEL_SOURCES) {
    try {
      const items = await fetchFeed(source.feedUrl)
      for (const raw of items) {
        const category = matchCategory(raw, source.categories)
        if (!category) continue
        candidates.push({
          sourceName: source.name,
          title: raw.title,
          url: raw.url,
          publishedAt: raw.publishedAt,
          excerpt: raw.excerpt,
          matchedCategory: category,
          dedupeHash: dedupeHash(raw.title),
        })
      }
    } catch (err) {
      const reason = err instanceof FeedFetchError ? err.message : String(err)
      sourceFailures.push(`${source.name}：本次抓取失败（${reason}）`)
    }
  }

  return { candidates, sourceFailures }
}

// ---------------------------------------------------------------------------
// 2. 本次运行内去重（同一条新闻可能被多个信源同时收录）+ 按分类分桶挑选。
//    没有跨天历史可查——不落库，也就没有"过去 7 天发过"这回事。
// ---------------------------------------------------------------------------
function selectForDigest(candidates: CandidateItem[]): CandidateItem[] {
  const seen = new Set<string>()
  const deduped = candidates.filter((c) => {
    if (seen.has(c.dedupeHash)) return false
    seen.add(c.dedupeHash)
    return true
  })

  const byCategory = new Map<MarketIntelCategory, CandidateItem[]>()
  for (const c of deduped) {
    const list = byCategory.get(c.matchedCategory) ?? []
    list.push(c)
    byCategory.set(c.matchedCategory, list)
  }

  const selected: CandidateItem[] = []
  for (const list of byCategory.values()) {
    const newestFirst = [...list].sort(
      (a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0),
    )
    selected.push(...newestFirst.slice(0, MAX_PER_CATEGORY))
  }
  return selected
}

// ---------------------------------------------------------------------------
// 3. 发信：直接用信源原文标题/摘录/链接，不经过 AI 摘要或事实核对——
//    先跑通"每天有没有用"这个问题，摘要/核对留给证明确实是瓶颈之后再加。
// ---------------------------------------------------------------------------
async function sendDigestEmail(nzDateLabel: string, items: CandidateItem[]) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: meMailFrom('Magic Insight'),
    to: [ME_MAIL_TO_ADDRESS],
    subject: buildDigestEmailSubject(nzDateLabel),
    html: buildDigestEmailHtml(nzDateLabel, items),
  })
  if (error) throw new Error(`sendDigestEmail failed: ${String(error)}`)
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
export async function runMarketIntelDaily(now: Date = new Date()): Promise<PipelineResult> {
  const digestDate = nzDateString(now)

  const { candidates, sourceFailures } = await collectCandidates()
  const selected = selectForDigest(candidates)

  let sent = false
  if (selected.length > 0) {
    await sendDigestEmail(digestDate, selected)
    sent = true
  }

  return {
    sent,
    reason: sent ? undefined : 'no items matched any category today',
    itemsConsidered: candidates.length,
    itemsSelected: selected.length,
    sourceFailures,
  }
}
