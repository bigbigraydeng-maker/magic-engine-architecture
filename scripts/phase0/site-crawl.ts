/**
 * Phase 0.4 — Site crawl T0 for Magic Engine's own site (magicengine.com.au)
 *
 * Uses existing ME lib: JobRunner + executeJob. No new capability.
 * Client ID: f1d062ca-929e-4b4e-ba6e-84752b748552 (Magic Engine, active, au)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/phase0/site-crawl.ts
 *
 * Writes: site_audit_jobs (1 row) + client_site_pages (per URL crawled).
 * Reads: none paid.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { JobRunner } from '@/lib/site-audit/job-runner'
import { executeJob } from '@/lib/site-audit/job-executor'

const CLIENT_ID = 'f1d062ca-929e-4b4e-ba6e-84752b748552'
const DOMAIN = 'magicengine.com.au'

async function main() {
  const runner = new JobRunner(supabaseAdmin)
  const job = await runner.createJob(CLIENT_ID, { domain: DOMAIN, maxPages: 50, rateLimitMs: 1500 })
  console.log(`[phase0.4] created job ${job.id}`)
  await executeJob(supabaseAdmin, job.id)
  const done = await runner.getJob(job.id)
  console.log(`[phase0.4] status=${done?.status} discovered=${done?.total_urls_discovered} crawled=${done?.total_urls_crawled} classified=${done?.total_pages_classified}`)

  const { count: pageCount } = await supabaseAdmin
    .from('client_site_pages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', CLIENT_ID)
  console.log(`[phase0.4] client_site_pages rows now: ${pageCount}`)

  const { data: pageTypes } = await supabaseAdmin
    .from('client_site_pages')
    .select('page_type')
    .eq('client_id', CLIENT_ID)
  const typeHist: Record<string, number> = {}
  for (const p of (pageTypes ?? []) as Array<{ page_type: string | null }>) {
    const k = p.page_type ?? 'null'
    typeHist[k] = (typeHist[k] ?? 0) + 1
  }
  console.log(`[phase0.4] page_type histogram:`, typeHist)

  console.log(`[phase0.4] DONE. job_id=${job.id}`)
}

main().catch(e => { console.error(e); process.exit(1) })
