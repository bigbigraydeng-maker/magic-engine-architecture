import { supabaseAdmin as db } from '@/lib/supabase'
import { allowedClient, settingsSchema, type Settings, type Signal } from './contracts'
import { loadCompetitors } from './targets'
import { loadCompetitionBrief } from './competition-sources'

export async function saveSettings(clientId: string, raw: unknown): Promise<void> {
  const settings = settingsSchema.parse(raw)
  if (settings.enabled && !allowedClient(clientId)) throw new Error('client_not_in_rollout')
  const r = await db.from('web_intelligence_settings').upsert({ client_id: clientId, ...settings, updated_at: new Date().toISOString() })
  if (r.error) throw new Error('settings_save_failed')
}
export async function readView(clientId: string, canEdit: boolean) {
  const [client, settings, competitors, signals, runs, budget] = await Promise.all([
    db.from('clients').select('id,name,domain').eq('id', clientId).single(),
    db.from('web_intelligence_settings').select('*').eq('client_id', clientId).maybeSingle(),
    loadCompetitors(clientId),
    db.from('market_signals').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    db.from('web_intelligence_runs').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    db.rpc('web_intelligence_budget', { p_client_id: clientId }),
  ])
  if (client.error || settings.error || signals.error || runs.error || budget.error) throw new Error('web_intelligence_read_failed')
  const ids = (signals.data as Signal[]).flatMap(s => [s.before_evidence_id, s.after_evidence_id])
  const evidence = ids.length ? await db.from('market_evidence').select('*').eq('client_id', clientId).in('id', ids) : { data: [], error: null }
  if (evidence.error) throw new Error('evidence_read_failed')
  const config: Settings | null = settings.data ? settingsSchema.strip().parse(settings.data) : null
  const brief = await loadCompetitionBrief(clientId, client.data, competitors)
  return { client: client.data, settings: config, competitors, signals: signals.data, evidence: evidence.data, runs: runs.data, budget: budget.data, brief, can_edit: canEdit, can_run: canEdit && allowedClient(clientId) && config?.enabled === true && config?.entitled === true }
}
