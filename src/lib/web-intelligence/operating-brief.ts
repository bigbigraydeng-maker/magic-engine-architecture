import { matchTravelScope, type TravelScope, type TourRecord } from './profiles/travel'

export type OperatingFactType = 'fact' | 'inference' | 'recommendation' | 'unknown'
export type ProductMatchStatus = 'comparable' | 'out_of_scope' | 'insufficient_evidence'

export type OperatingEvidence = {
  id: string
  client_id: string
  source: string
  scope: 'client' | 'competitor' | 'industry'
  statement: string
  observed_at: string | null
  fact_type: OperatingFactType
  confidence: 'high' | 'medium' | 'low'
}

export type OperatingSignal = {
  statement: string
  source_url: string
  observed_at: string | null
  valid_until: string | null
}

export type ProductMatch = {
  status: ProductMatchStatus
  client_product: string | null
  competitor_product: string | null
  reason: string
}

export type TourCatalogItem = {
  domain: string
  source_url: string
  observed_at: string | null
  record: TourRecord
}

export type OperatingDecision = {
  question: string
  context: string[]
  external_signal: OperatingSignal[]
  impact: string
  recommendation: string
  authorization: 'review_required'
  evidence: OperatingEvidence[]
  unknowns: string[]
  check_and_tune: string
}

export type OperatingBrief = {
  as_of: string
  client_id: string
  client_name: string
  goal: { title: string; status: string; metric: string; target: number | null; period_start: string; period_end: string } | null
  product_scope: TravelScope
  tour_catalog: TourCatalogItem[]
  matches: ProductMatch[]
  decision: OperatingDecision
  data_gaps: string[]
}

export type OperatingBriefInput = {
  client: { id: string; name: string }
  goal: OperatingBrief['goal']
  product_scope: TravelScope
  client_products: Array<{ name: string; destination?: string; route?: string; duration_days?: number; price?: string; departure_window?: string; includes?: string; positioning?: string; audience?: string }>
  competitor_products: Array<{ domain: string; source_url: string; observed_at: string | null; records: TourRecord[] }>
  evidence: OperatingEvidence[]
  now?: Date
}

export type OperatingGoalCandidate = {
  title: string
  status: string
  primary_metric_label: string
  target_value: number | null
  period_start: string
  period_end: string
}

export function resolveCurrentOperatingGoal(goals: OperatingGoalCandidate[], now: Date): OperatingBrief['goal'] {
  const today = now.toISOString().slice(0, 10)
  const current = goals.find(goal => goal.status === 'active' && goal.period_start <= today && goal.period_end >= today)
  return current ? {
    title: current.title, status: current.status, metric: current.primary_metric_label,
    target: current.target_value, period_start: current.period_start, period_end: current.period_end,
  } : null
}

export function normalizeOperatingProducts(raw: unknown): OperatingBriefInput['client_products'] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const value = item as Record<string, unknown>
    const text = (key: string) => typeof value[key] === 'string' ? value[key].trim() : undefined
    const number = (key: string) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] : undefined
    return [{
      name: text('name') ?? '', destination: text('destination'), route: text('route'), duration_days: number('duration_days'),
      price: text('price'), departure_window: text('departure_window'), includes: text('includes'), positioning: text('positioning'), audience: text('audience'),
    }]
  })
}

function productLabel(product: TourRecord): string {
  return `${product.name} · ${product.durationDays} 天 · ${product.price}`
}

export function parseTourRecordLine(line: string): TourRecord | null {
  const values = new Map(line.split('|').map(part => {
    const [key, ...rest] = part.split(':')
    return [key.trim().toLowerCase(), rest.join(':').trim()]
  }))
  const name = values.get('tour')
  const duration = Number(values.get('duration')?.match(/\d+/)?.[0])
  if (!name || !Number.isFinite(duration)) return null
  return {
    name,
    durationDays: duration,
    price: values.get('price') ?? 'not stated',
    promotion: values.get('promotion') ?? 'not stated',
    reviews: values.get('reviews') ?? 'not stated',
    includes: values.get('includes') ?? 'not stated',
    route: values.get('route') ?? 'not stated',
    departureWindow: values.get('departure') ?? values.get('departure_window'),
    positioning: values.get('positioning'),
    audience: values.get('audience'),
    itinerary: values.get('itinerary')?.split(' || ').map(value => value.trim()).filter(Boolean),
  }
}

function competitorFacts(input: OperatingBriefInput, now: Date): OperatingSignal[] {
  return input.competitor_products.flatMap(item => item.records.slice(0, 3).map(record => ({
    statement: `${item.domain}：${productLabel(record)}`,
    source_url: item.source_url,
    observed_at: item.observed_at,
    valid_until: item.observed_at ? new Date(Date.parse(item.observed_at) + 8 * 86_400_000).toISOString() : null,
  }))).filter(item => item.observed_at !== null && Number.isFinite(Date.parse(item.observed_at)) && now.getTime() - Date.parse(item.observed_at) >= 0 && now.getTime() - Date.parse(item.observed_at) <= 8 * 86_400_000)
}

function completeClientProduct(product: OperatingBriefInput['client_products'][number]): boolean {
  return [product.destination, product.route, product.duration_days, product.price, product.departure_window, product.includes, product.positioning, product.audience]
    .every(value => typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value))
}

function completeCompetitorProduct(record: TourRecord): boolean {
  return [record.route, record.durationDays, record.price, record.departureWindow, record.includes, record.positioning, record.audience]
    .every(value => typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value))
}

const comparableText = (value: string | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const samePriceBasis = (left: string, right: string) => comparableText(left).replace(/\d+/g, '') === comparableText(right).replace(/\d+/g, '')
const sameTourShape = (client: OperatingBriefInput['client_products'][number], competitor: TourRecord) =>
  comparableText(client.route) === comparableText(competitor.route) &&
  client.duration_days === competitor.durationDays &&
  samePriceBasis(client.price!, competitor.price) &&
  comparableText(client.departure_window) === comparableText(competitor.departureWindow) &&
  comparableText(client.includes) === comparableText(competitor.includes) &&
  comparableText(client.positioning) === comparableText(competitor.positioning) &&
  comparableText(client.audience) === comparableText(competitor.audience)

function matchesFor(input: OperatingBriefInput): ProductMatch[] {
  const competitorRecords = input.competitor_products.flatMap(item => item.records.map(record => ({ item, record })))
  if (!input.client_products.length) {
    return competitorRecords.slice(0, 4).map(({ item, record }) => {
      const scopeMatch = matchTravelScope(`${record.name} ${record.route}`, '', input.product_scope)
      return {
      status: scopeMatch.status === 'outside' ? 'out_of_scope' : 'insufficient_evidence',
      client_product: null,
      competitor_product: `${item.domain}：${productLabel(record)}`,
      reason: scopeMatch.status === 'outside' ? '该 Tour 明确属于客户当前产品范围之外，保留为外围市场情报，不进入当前经营建议。' : '客户当前没有已验证的产品记录，无法判断路线、天数、价格口径、包含项目或目标客群是否可比。',
      }
    })
  }
  return input.client_products.map(product => {
    const sameScope = competitorRecords.find(({ record }) => matchTravelScope(`${record.name} ${record.route}`, '', input.product_scope).status === 'matched')
    if (!sameScope || !completeClientProduct(product) || !completeCompetitorProduct(sameScope.record) || !sameTourShape(product, sameScope.record)) return {
      status: 'insufficient_evidence' as const,
      client_product: product.name,
      competitor_product: sameScope ? `${sameScope.item.domain}：${productLabel(sameScope.record)}` : null,
      reason: !completeClientProduct(product) ? '客户产品缺少目的地、路线、天数、价格口径、出发窗口、包含项目、定位或目标客群。' : !sameScope ? '没有找到同时满足客户产品范围和可比较路线的竞品记录。' : !completeCompetitorProduct(sameScope.record) ? '竞品记录缺少路线、天数、价格、出发窗口、包含项目、定位或目标客群。' : '路线、天数、价格口径、出发窗口、包含项目、定位或目标客群未完成逐项对位。',
    }
    return {
      status: 'comparable' as const,
      client_product: product.name,
      competitor_product: `${sameScope.item.domain}：${productLabel(sameScope.record)}`,
      reason: '已找到同一目的地范围的候选对位；仍需补齐出发窗口、价格口径和包含项目后才能形成价格判断。',
    }
  })
}

export function buildOperatingBrief(input: OperatingBriefInput): OperatingBrief {
  const now = input.now ?? new Date()
  const matches = matchesFor(input)
  const competitorSignal = competitorFacts(input, now)
  const allInsufficient = matches.length === 0 || matches.every(match => match.status === 'insufficient_evidence')
  const evidence = input.evidence.filter(item => item.scope === 'client' || item.scope === 'competitor')
  const unknowns = [
    ...(input.client_products.length ? [] : ['CTS 产品目录、路线、天数、价格、包含项目、出发日期和余位尚未进入已验证数据源。']),
    ...(input.goal ? [] : ['没有当前有效经营目标，不能把历史目标当作当前目标。']),
    ...(competitorSignal.length ? [] : ['没有未过期的竞品快照，不能把历史记录当作当前情报。']),
    '没有 CTS 与竞品同类产品的询盘、成交或转化对照，不能估计经营影响或建议调价。',
  ]
  const recommendation = allInsufficient
    ? '暂不调价、改促销或改变产品。先补齐 CTS 主力 Tour 的已验证产品事实，再对 Wendy Wu 的同类路线做逐项对位。'
    : '将已匹配的 Tour 交由负责人复核日期、价格口径、包含项目和销售周期；在复核前不执行任何外部动作。'
  const context = input.goal
    ? [`当前目标：${input.goal.title}（${input.goal.status}）`, `目标指标：${input.goal.metric}${input.goal.target == null ? '' : `，目标 ${input.goal.target}`}`, `目标周期：${input.goal.period_start} 至 ${input.goal.period_end}`]
    : ['当前没有可确认的有效经营目标。']
  if (input.product_scope.labels.length) context.push(`客户产品范围：${input.product_scope.labels.join('、')}（来源：${input.product_scope.source}）`)
  return {
    as_of: now.toISOString(), client_id: input.client.id, client_name: input.client.name,
    goal: input.goal, product_scope: input.product_scope,
    tour_catalog: input.competitor_products.flatMap(item => item.records.map(record => ({
      domain: item.domain, source_url: item.source_url, observed_at: item.observed_at, record,
    }))),
    matches,
    decision: {
      question: '当前是否需要跟进主要竞品的中国团价格或促销？',
      context, external_signal: competitorSignal,
      impact: allInsufficient ? '目前只能确认竞品正在销售并促销，不能确认 CTS 的同类产品受到价格或需求压力。' : '候选对位存在，但尚未完成客户侧结果和价格口径验证。',
      recommendation, authorization: 'review_required', evidence,
      unknowns, check_and_tune: '补齐 CTS 产品事实后，建立同类 Tour baseline；下一次采集比较价格、档期、余位和促销，再用询盘/成交数据检查建议是否改变结果。',
    },
    data_gaps: unknowns,
  }
}
