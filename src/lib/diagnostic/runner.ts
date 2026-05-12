import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticDimension } from '@/types/diagnostic'
import type { CollectorResult, NewFinding } from './types'
import { SeoCollector } from './collectors/seo-collector'
import { computeOverallScore } from './guards'

// ---------------------------------------------------------------------------
// Module registry
// ---------------------------------------------------------------------------

const VALID_MODULES = ['seo'] as const
export type DiagnosticModule = (typeof VALID_MODULES)[number]

export function isValidModule(module: string): module is DiagnosticModule {
  return (VALID_MODULES as readonly string[]).includes(module)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Creates a pending run record and returns its id. Fast — no collection. */
export async function createDiagnosticRun(
  supabase: SupabaseClient,
  clientId: string,
  module: DiagnosticModule,
): Promise<string> {
  const { data, error } = await supabase
    .from('diagnostic_runs')
    .insert({
      client_id: clientId,
      triggered_by: 'user' as const,
      status: 'pending' as const,
      dimensions_requested: [module] as DiagnosticDimension[],
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create diagnostic run: ${error?.message ?? 'unknown'}`)
  }
  return (data as { id: string }).id
}

/** Runs collectors for an existing run record and persists results. */
export async function executeDiagnosticRun(
  supabase: SupabaseClient,
  runId: string,
  clientId: string,
  module: DiagnosticModule,
): Promise<void> {
  await supabase
    .from('diagnostic_runs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', runId)

  try {
    const [domain, keywords] = await fetchClientData(supabase, clientId)
    const result = await runCollectors(clientId, domain, keywords, module)
    await persistResult(supabase, runId, module, result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('diagnostic_runs')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
  }
}

/** Convenience wrapper: create + execute synchronously. Returns run_id. */
export async function runDiagnostic(
  supabase: SupabaseClient,
  clientId: string,
  module: DiagnosticModule,
): Promise<string> {
  const runId = await createDiagnosticRun(supabase, clientId, module)
  await executeDiagnosticRun(supabase, runId, clientId, module)
  return runId
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function fetchClientData(
  supabase: SupabaseClient,
  clientId: string,
): Promise<[string, string[]]> {
  const [clientRes, kwRes] = await Promise.all([
    supabase.from('clients').select('domain').eq('id', clientId).single(),
    supabase.from('keywords').select('keyword').eq('client_id', clientId).eq('status', 'approved'),
  ])

  const domain =
    (clientRes.data as { domain: string | null } | null)?.domain ?? ''
  const keywords =
    (kwRes.data as { keyword: string }[] | null)?.map(k => k.keyword) ?? []

  return [domain, keywords]
}

async function runCollectors(
  clientId: string,
  domain: string,
  keywords: string[],
  module: DiagnosticModule,
): Promise<CollectorResult> {
  const [settled] = await Promise.allSettled([
    new SeoCollector().collect(clientId, domain, keywords),
  ])

  if (settled.status === 'rejected') {
    const msg = settled.reason instanceof Error ? settled.reason.message : 'Collector failed'
    throw new Error(msg)
  }
  return settled.value
}

async function persistResult(
  supabase: SupabaseClient,
  runId: string,
  module: DiagnosticModule,
  result: CollectorResult,
): Promise<void> {
  const { score, findings } = result
  const dimensionScores = { [module]: score }
  const overallScore = computeOverallScore(dimensionScores)

  if (findings.length > 0) {
    const rows: (NewFinding & { run_id: string })[] = findings.map(f => ({ ...f, run_id: runId }))
    await supabase.from('diagnostic_findings').insert(rows)
  }

  await supabase
    .from('diagnostic_runs')
    .update({
      status: 'completed',
      overall_score: overallScore,
      dimension_scores: dimensionScores,
      findings_count: findings.length,
      critical_count: findings.filter(f => f.severity === 'critical').length,
      high_count: findings.filter(f => f.severity === 'high').length,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)
}
