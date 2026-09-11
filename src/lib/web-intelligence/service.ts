import { supabaseAdmin as db } from '@/lib/supabase'
import { allowedClient, settingsSchema, type Settings, type Signal } from './contracts'
import { loadCompetitors } from './targets'
import { loadCompetitionBrief } from './competition-sources'
import { latestFreshSnapshots, latestSnapshots } from './competition-brief'
import { buildOperatingBrief, normalizeOperatingProducts, parseTourRecordLine, resolveCurrentOperatingGoal, type OperatingBrief, type OperatingEvidence, type OperatingGoalCandidate } from './operating-brief'
import { extractTourLinks } from './profiles/travel'

export async function saveSettings(clientId: string, raw: unknown): Promise<void> {
  const settings = settingsSchema.parse(raw)
  if (settings.enabled && !allowedClient(clientId)) throw new Error('client_not_in_rollout')
  const r = await db.from('web_intelligence_settings').upsert({ client_id: clientId, ...settings, updated_at: new Date().toISOString() })
  if (r.error) throw new Error('settings_save_failed')
}
export async function readView(clientId: string, canEdit: boolean) {
  const [client, settings, competitors, signals, runs, budget, masterBrief, goals] = await Promise.all([
    db.from('clients').select('id,name,domain').eq('id', clientId).single(),
    db.from('web_intelligence_settings').select('*').eq('client_id', clientId).maybeSingle(),
    loadCompetitors(clientId),
    db.from('market_signals').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    db.from('web_intelligence_runs').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    db.rpc('web_intelligence_budget', { p_client_id: clientId }),
    db.from('master_briefs').select('products,primary_audience,buying_trigger,keyword_seeds,competitor_domains,status,is_active,version').eq('client_id', clientId).or('status.eq.active,is_active.eq.true').order('version', { ascending: false }).limit(1).maybeSingle(),
    db.from('goals').select('title,status,primary_metric_label,target_value,period_start,period_end,updated_at').eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
  ])
  if (client.error || settings.error || signals.error || runs.error || budget.error || masterBrief.error || goals.error) throw new Error('web_intelligence_read_failed')
  const ids = (signals.data as Signal[]).flatMap(s => [s.before_evidence_id, s.after_evidence_id])
  const evidence = ids.length ? await db.from('market_evidence').select('*').eq('client_id', clientId).in('id', ids) : { data: [], error: null }
  if (evidence.error) throw new Error('evidence_read_failed')
  const config: Settings | null = settings.data ? settingsSchema.strip().parse(settings.data) : null
  const brief = await loadCompetitionBrief(clientId, client.data, competitors)
  const urls = competitors.filter(item => item.status !== 'archive').flatMap(item => item.urls)
  const snapshots = urls.length ? await db.from('market_snapshots').select('run_id,domain,url,content,projection_content,captured_at').eq('client_id', clientId).in('url', urls).order('captured_at', { ascending: false }).limit(urls.length) : { data: [], error: null }
  if (snapshots.error) throw new Error('operating_snapshot_read_failed')
  const asOf = new Date()
  const snapshotRows = (snapshots.data ?? []) as Array<{ run_id: string; domain: string; url: string; content: string; projection_content: string | null; captured_at: string }>
  const currentSnapshots = latestFreshSnapshots(snapshotRows, asOf)
  const observations = latestSnapshots(snapshotRows).map(row => ({ run_id: row.run_id, domain: row.domain, url: row.url, observed_at: row.captured_at }))
  const competitorProducts = currentSnapshots.map(row => ({ domain: row.domain, source_url: row.url, observed_at: row.captured_at, records: (row.projection_content ?? '').split('\n').map(parseTourRecordLine).filter((value): value is NonNullable<ReturnType<typeof parseTourRecordLine>> => value !== null) }))
  const discoveredTours = currentSnapshots.flatMap(row => extractTourLinks(row.content ?? '', row.url).map(link => ({ ...link, domain: row.domain, listing_url: row.url, observed_at: row.captured_at })))
  const activeGoal = resolveCurrentOperatingGoal((goals.data ?? []) as OperatingGoalCandidate[], asOf)
  const operatingEvidence: OperatingEvidence[] = (evidence.data ?? []).map(item => ({ id: item.id, client_id: item.client_id, source: item.source_url, scope: 'competitor', statement: item.excerpt.split('\n').slice(0, 3).join(' '), observed_at: item.observed_at, fact_type: 'fact', confidence: 'high' }))
  const operating: OperatingBrief = buildOperatingBrief({
    client: { id: client.data.id, name: client.data.name },
    goal: activeGoal,
    product_scope: brief.product_scope,
    client_products: normalizeOperatingProducts(masterBrief.data?.products),
    competitor_products: competitorProducts,
    evidence: operatingEvidence, now: asOf,
  })
  return { client: client.data, settings: config, competitors, signals: signals.data, evidence: evidence.data, runs: runs.data, observations, discovered_tours: discoveredTours, budget: budget.data, brief, operating, can_edit: canEdit, can_run: canEdit && allowedClient(clientId) && config?.enabled === true && config?.entitled === true }
}
