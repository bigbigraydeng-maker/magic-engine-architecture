/**
 * TEMPORARY revalidation endpoint — DELETE before commit.
 * Pulls the raw_output of a failed Zhangqian job and runs it through the
 * current validator. Lets us iterate on validator fixes without re-running
 * the agent ($0.75+/run).
 *
 * GET /api/zhangqian-revalidate?job_id=<uuid>
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { parseJsonResponse } from '@/lib/anthropic/client'
import { validateDiscoveryReport } from '@/lib/zhangqian/validators'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const url = new URL(req.url)
  const jobId = url.searchParams.get('job_id')
  if (!jobId) return NextResponse.json({ success: false, error: 'job_id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('client_discovery_jobs')
    .select('id, status, raw_output, error_message')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ success: false, error: 'job not found' }, { status: 404 })
  if (!data.raw_output) return NextResponse.json({ success: false, error: 'no raw_output saved for this job' }, { status: 400 })

  // Try parse → validate
  let parsed: unknown
  try {
    parsed = parseJsonResponse<unknown>(data.raw_output)
  } catch (err) {
    return NextResponse.json({
      success: false,
      stage: 'parse',
      error: err instanceof Error ? err.message : String(err),
      preview: (data.raw_output as string).slice(0, 300),
    })
  }

  const v = validateDiscoveryReport(parsed)
  if (!v.ok) {
    return NextResponse.json({
      success: false,
      stage: 'validate',
      error: v.error,
      keys_present: Object.keys(parsed as object),
    })
  }

  // If ?persist=1, write the revalidated report into client_discovery
  // so we don't waste the original $0.72 spend.
  const persist = url.searchParams.get('persist') === '1'
  const r = v.value

  if (persist) {
    // Need client_id + domain from the job
    const { data: job } = await supabaseAdmin
      .from('client_discovery_jobs')
      .select('client_id, domain, cost_usd, tool_call_count')
      .eq('id', jobId)
      .single<{ client_id: string; domain: string; cost_usd: number; tool_call_count: number }>()

    if (!job) return NextResponse.json({ success: false, error: 'job lookup failed' }, { status: 500 })

    const report = {
      ...r,
      meta: {
        model: 'claude-sonnet-4-5-20250929',
        tool_calls: job.tool_call_count ?? 0,
        cost_usd: Number(job.cost_usd ?? 0),
        duration_ms: 0,
        truncated: false,
      },
    }

    const { error: upsertErr } = await supabaseAdmin
      .from('client_discovery')
      .upsert(
        {
          client_id: job.client_id,
          domain: job.domain,
          payload: report,
          cost_usd: report.meta.cost_usd,
          model: report.meta.model,
          tool_calls: report.meta.tool_calls,
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: 'client_id' },
      )

    if (upsertErr) {
      return NextResponse.json({ success: false, error: `upsert failed: ${upsertErr.message}` }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    persisted: persist,
    summary: {
      business_name: r.business.name,
      industry: r.business.industry,
      social_profiles: r.social_profiles.length,
      gbp_found: r.gbp !== null,
      review_platforms: r.review_platforms.length,
      seed_keywords: r.seed_keywords.length,
      competitors: r.competitors.length,
      ai_tracker_questions: r.ai_tracker_questions.length,
      notes_preview: r.notes.slice(0, 200),
    },
  })
}
