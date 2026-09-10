export type BriefStatus = 'ready' | 'limited' | 'stale' | 'unconfigured' | 'no_observation' | 'failed' | 'not_connected'

export type BriefDimension = {
  key: 'product' | 'search' | 'reputation' | 'ai_visibility'
  label: string
  status: BriefStatus
  headline: string
  detail: string
  items?: string[]
  source: string
  observed_at: string | null
  coverage: string
}

export type CompetitionBrief = {
  as_of: string
  subject: 'Tour' | '产品'
  headline: string
  summary: string
  actions: string[]
  dimensions: BriefDimension[]
  gaps: { label: string; reason: string }[]
  warnings: string[]
}

export type MarketSnapshot = {
  domain: string; url: string; projection_content: string | null
  page_role: string | null; captured_at: string; projection_version: string | null
}
export type BaselineDomain = { domain: string; seo_score: number | null; last_collected_at: string | null; is_client: boolean }
export type ReputationSnapshot = {
  entity_type: 'client' | 'competitor'; entity_name: string; source: string
  rating: number | null; review_count: number | null; snapshot_date: string; measured_at: string
}
export type AiSnapshot = {
  week_of: string; avg_rank: number | null; mentions_count: number
  total_runs: number; models_covered: string[]
}

type SourceResult<T> = { data: T; failed: boolean }
type BriefInput = {
  clientName: string
  clientDomain: string | null
  competitorCount: number
  configuredPageCount: number
  snapshots: SourceResult<MarketSnapshot[]>
  baselines: SourceResult<BaselineDomain[]>
  reputation: SourceResult<ReputationSnapshot[]>
  ai: SourceResult<AiSnapshot | null>
  now?: Date
}

const DAY = 86_400_000
const latestDate = (values: (string | null)[]) => values.filter((v): v is string => Boolean(v)).sort().at(-1) ?? null
const dateRange = (values: (string | null)[]) => {
  const dates = values.filter((v): v is string => Boolean(v)).sort()
  if (!dates.length) return '尚无观测日期'
  const first = dates[0].slice(0, 10); const last = dates.at(-1)!.slice(0, 10)
  return first === last ? first : `${first} 至 ${last}`
}
const isStale = (value: string | null, days: number, now: Date) => !value || now.getTime() - Date.parse(value) > days * DAY
const businessFacts = (text: string) => text.split('\n').filter(line => /Tour:/i.test(line)).slice(0, 4).map(line => {
  const fields = new Map(line.split('|').map(part => {
    const [key, ...value] = part.trim().split(':')
    return [key.trim().toLowerCase(), value.join(':').trim()]
  }))
  const values = [fields.get('tour'), fields.get('duration'), fields.get('price')]
  const promotion = fields.get('promotion')
  if (promotion && !/^none|not stated$/i.test(promotion)) values.push(promotion)
  return values.filter(Boolean).join(' · ')
}).filter(Boolean)
const canonical = (value: string | null) => (value ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

export function buildCompetitionBrief(input: BriefInput): CompetitionBrief {
  const now = input.now ?? new Date()
  const warnings: string[] = []
  const latestByUrl = new Map<string, MarketSnapshot>()
  for (const row of input.snapshots.data) if (!latestByUrl.has(row.url)) latestByUrl.set(row.url, row)
  const current = [...latestByUrl.values()]
  const snapshotAt = latestDate(current.map(row => row.captured_at))
  const productIncomplete = current.length < input.configuredPageCount
  const productHasStale = current.some(row => isStale(row.captured_at, 8, now))
  const productStatus: BriefStatus = input.snapshots.failed ? 'failed' : !input.configuredPageCount ? 'unconfigured' : !current.length ? 'no_observation' : productIncomplete || productHasStale ? 'stale' : 'limited'
  if (!['ready', 'limited'].includes(productStatus)) warnings.push(productStatus === 'failed' ? '竞品业务页面读取失败。' : productStatus === 'stale' ? '竞品业务页面存在缺失或超过 8 天的记录。' : '竞品业务页面尚未形成可用快照。')
  const fresh = current.filter(row => !isStale(row.captured_at, 8, now))
  const facts = fresh.flatMap(row => businessFacts(row.projection_content ?? '').map(fact => `${row.domain} · ${fact}`)).slice(0, 4)
  const product: BriefDimension = {
    key: 'product', label: '竞品产品与价格', status: productStatus,
    headline: current.length ? `已读取 ${current.length}/${input.configuredPageCount} 个已配置业务页面` : '尚无可用的产品盘面',
    detail: facts.length ? `以下为最近抓到的 ${Math.min(facts.length, 4)} 个代表产品；尚未接入 ${input.clientName} 自身产品数据，暂不能直接判断胜负。` : '当前只能说明页面覆盖，尚未提取到足够的 Tour、价格或促销事实。',
    items: facts,
    source: '竞品官网已配置页面', observed_at: snapshotAt,
    coverage: `当前 ${fresh.length}/${input.configuredPageCount} 个页面在 8 天有效期内；仅代表已配置页面，不代表竞品全站。`,
  }

  const baselineAt = latestDate(input.baselines.data.map(row => row.last_collected_at))
  const ownDomain = canonical(input.clientDomain)
  const own = input.baselines.data.find(row => canonical(row.domain) === ownDomain)
  const rivals = input.baselines.data.filter(row => canonical(row.domain) !== ownDomain)
  const searchHasStale = input.baselines.data.some(row => isStale(row.last_collected_at, 40, now))
  const hasComparableSearch = own?.seo_score != null && rivals.some(row => row.seo_score != null)
  const searchStatus: BriefStatus = input.baselines.failed ? 'failed' : !input.baselines.data.length ? 'no_observation' : searchHasStale ? 'stale' : hasComparableSearch ? 'ready' : 'limited'
  const scoreLabel = (row: BaselineDomain) => `${row.domain} ${row.seo_score ?? '—'}${row.last_collected_at ? `（${row.last_collected_at.slice(0, 10)}）` : ''}`
  const rivalText = rivals.slice(0, 3).map(scoreLabel).join('；')
  const search: BriefDimension = {
    key: 'search', label: '网站搜索基础', status: searchStatus,
    headline: own ? `${input.clientName} ${own.seo_score ?? '—'}${own.last_collected_at ? `（${own.last_collected_at.slice(0, 10)}）` : ''}${rivalText ? `；${rivalText}` : ''}` : '尚无客户自身可比较记录',
    detail: '该分数衡量网站 SEO 采集基础，不等于 Google 排名、流量或市场份额。',
    source: 'Industry Baseline · SEO 采集评分', observed_at: baselineAt,
    coverage: `同一行业基线内 ${input.baselines.data.length} 个已识别网站；观测范围 ${dateRange(input.baselines.data.map(row => row.last_collected_at))}。`,
  }

  const repAt = latestDate(input.reputation.data.map(row => row.measured_at))
  const latestRep = new Map<string, ReputationSnapshot>()
  for (const row of input.reputation.data) {
    const key = `${row.entity_type}:${row.entity_name}:${row.source}`
    if (!latestRep.has(key)) latestRep.set(key, row)
  }
  const repRows = [...latestRep.values()]
  const repHasStale = repRows.some(row => isStale(row.measured_at, 10, now))
  const validRep = repRows.filter(row => row.rating != null || row.review_count != null)
  const comparableRepSource = [...new Set(validRep.map(row => row.source))].some(source => {
    const clients = validRep.filter(row => row.source === source && row.entity_type === 'client')
    const competitors = validRep.filter(row => row.source === source && row.entity_type === 'competitor')
    return (clients.some(row => row.rating != null) && competitors.some(row => row.rating != null)) ||
      (clients.some(row => row.review_count != null) && competitors.some(row => row.review_count != null))
  })
  const repStatus: BriefStatus = input.reputation.failed ? 'failed' : !repRows.length ? 'unconfigured' : repHasStale ? 'stale' : comparableRepSource ? 'ready' : 'limited'
  const reputation: BriefDimension = {
    key: 'reputation', label: '客户评价', status: repStatus,
    headline: repRows.length ? repRows.slice(0, 3).map(row => `${row.entity_type === 'client' ? '客户' : '竞品'} · ${row.source} · ${row.entity_name} ${row.rating ?? '—'}分 / ${row.review_count ?? '—'}条（${row.snapshot_date}）`).join('；') : '尚未形成可比较的客户与竞品评价',
    detail: '只展示已明确绑定的平台身份，避免把同名商家或不同平台误作同一对象。',
    source: repRows.length ? [...new Set(repRows.map(row => row.source))].join('、') : 'Google / Tripadvisor / Trustpilot', observed_at: repAt,
    coverage: repRows.length ? `${repRows.length} 个“对象 × 平台”最新快照；观测范围 ${dateRange(repRows.map(row => row.measured_at))}。` : '未配置身份或尚无采集记录。',
  }

  const aiAt = input.ai.data?.week_of ?? null
  const hasAiRuns = Boolean(input.ai.data && input.ai.data.total_runs > 0)
  const aiStatus: BriefStatus = input.ai.failed ? 'failed' : !hasAiRuns ? 'no_observation' : isStale(aiAt, 14, now) ? 'stale' : 'limited'
  const mentionRate = input.ai.data?.total_runs ? Math.round(input.ai.data.mentions_count / input.ai.data.total_runs * 100) : null
  const ai: BriefDimension = {
    key: 'ai_visibility', label: 'AI 推荐表现', status: aiStatus,
    headline: hasAiRuns ? `${input.clientName} 被提及 ${mentionRate}%${input.ai.data?.avg_rank == null ? '' : ` · 平均第 ${input.ai.data.avg_rank} 名`}` : `尚无 ${input.clientName} 的有效 AI 推荐快照`,
    detail: '当前只展示客户自身表现；没有明确竞品品牌记录时，不推断竞品 AI 排名。',
    source: input.ai.data?.models_covered?.join('、') || 'AI Visibility', observed_at: aiAt,
    coverage: input.ai.data ? `${input.ai.data.total_runs} 次有效问答。` : '尚无观测记录。',
  }

  const dimensions = [product, search, reputation, ai]
  const readyCount = dimensions.filter(item => item.status === 'ready').length
  const limitedCount = dimensions.filter(item => item.status === 'limited').length
  const travelProfile = current.some(row => row.projection_version?.startsWith('me-travel')) || facts.length > 0
  const subject = travelProfile ? 'Tour' : '产品'
  const hasBusinessFacts = facts.length > 0
  const headline = hasBusinessFacts
    ? `竞品${subject}盘面已可查看；仍需与 ${input.clientName} 同类${subject}对位后再决定是否回应。`
    : `现有数据还不足以回答当前应该争什么${subject}、用什么价格。`
  const actions = [
    hasBusinessFacts ? `把 ${input.clientName} 同类${subject}的日期、总价、行程天数和包含项目纳入同一张对比表。` : `补齐竞品核心${subject}列表与详情页，让 ME 先看见真实产品盘面。`,
    repStatus === 'ready' ? '按评价量、评分与近期新增评价判断信任差距。' : `补齐核心竞品的评价平台身份，再与 ${input.clientName} 比较信任差距。`,
    '只对已验证的价格、促销、档期或口碑变化形成经营建议。',
  ]
  return {
    as_of: now.toISOString(), subject, headline,
    summary: `当前 ${readyCount}/4 个维度可直接竞争对比，${limitedCount} 个只有单方或有限数据；监控 ${input.competitorCount} 家竞品、${input.configuredPageCount} 个业务页面。`,
    actions, dimensions, warnings,
    gaps: [
      { label: '竞品广告', reason: '尚未形成可比较的历史快照' },
      { label: '招聘与人员', reason: '尚未接入' },
      { label: '合作、新闻与公益', reason: '尚未接入' },
      { label: '技术栈', reason: '尚未接入' },
    ],
  }
}
