import { supabaseAdmin as db } from '@/lib/supabase'
import type { CaptureRequest, Run, Signal, Evidence, Settings } from './contracts'

export async function readRun(id: string, clientId: string): Promise<Run> {
  const r = await db.from('web_intelligence_runs').select('*').eq('id', id).eq('client_id', clientId).single()
  if (r.error || !r.data) throw new Error('run_read_failed')
  return r.data as Run
}
export async function updateRun(id: string, clientId: string, patch: Record<string, unknown>): Promise<void> {
  const r = await db.from('web_intelligence_runs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('client_id', clientId).select('id').single()
  if (r.error || !r.data) throw new Error('run_write_failed')
}
export async function claim(id: string, clientId: string, field: 'capture_claimed' | 'interpretation_claimed'): Promise<boolean> {
  const r = await db.rpc('web_intelligence_claim', { p_id: id, p_client_id: clientId, p_stage: field === 'capture_claimed' ? 'capture' : 'interpretation' })
  if (r.error) throw new Error(r.error.message.includes('execution_disabled') ? 'execution_disabled' : 'claim_failed')
  return r.data === true
}
export async function reserve(req: CaptureRequest): Promise<Run> {
  const r = await db.rpc('web_intelligence_reserve', { p_id: req.request_id, p_client_id: req.client_id, p_domain: req.domain, p_url: req.url })
  if (r.error || !r.data) throw new Error(`budget_rejected: ${r.error?.message ?? 'unknown'}`)
  return r.data as Run
}
export async function settle(id: string, clientId: string): Promise<Run> {
  const r = await db.rpc('web_intelligence_settle', { p_id: id, p_client_id: clientId })
  if (r.error || !r.data) throw new Error('settlement_failed')
  return r.data as Run
}
export async function loadInterpretationInput(run: Run): Promise<{ signal: Signal | null; evidence: Evidence[]; context: string }> {
  const signal = await db.from('market_signals').select('*').eq('run_id', run.id).eq('client_id', run.client_id).maybeSingle()
  if (signal.error) throw new Error('signal_read_failed')
  if (!signal.data) return { signal: null, evidence: [], context: '' }
  const s = signal.data as Signal
  const [evidence, settings] = await Promise.all([
    db.from('market_evidence').select('*').eq('client_id', run.client_id).in('id', [s.before_evidence_id, s.after_evidence_id]),
    db.from('web_intelligence_settings').select('*').eq('client_id', run.client_id).single(),
  ])
  if (evidence.error || settings.error || evidence.data?.length !== 2) throw new Error('evidence_read_failed')
  return { signal: s, evidence: evidence.data as Evidence[], context: (settings.data as Settings).context }
}
export async function updateSignal(id: string, clientId: string, patch: Record<string, unknown>): Promise<void> {
  const result = await db.from('market_signals').update(patch).eq('id', id).eq('client_id', clientId).select('id').single()
  if (result.error || !result.data) throw new Error('signal_write_failed')
}
