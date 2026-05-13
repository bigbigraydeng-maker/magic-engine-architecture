/**
 * POST /api/clients/[id]/zhangqian/discover
 *
 * Dispatch 张骞 Zhangqian Discovery Agent for a client. Returns 202 immediately
 * with a job_id; the agent runs in the background and writes results to
 * `client_discovery` when done. Poll `/zhangqian/status?job_id=...` for progress.
 *
 * Body: {} (domain comes from the clients table)
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.8
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { runZhangqian } from '@/lib/zhangqian/agent'
import {
  createDiscoveryJob,
  updateJobProgress,
  completeJob,
  failJob,
} from '@/lib/zhangqian/persistor'

// Render — agent itself runs in fire-and-forget; this handler returns in <1s
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params

    // Resolve domain from clients table
    const { data: client, error: clientErr } = await supabaseAdmin
      .from('clients')
      .select('id, domain')
      .eq('id', clientId)
      .single<{ id: string; domain: string }>()

    if (clientErr || !client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }
    if (!client.domain) {
      return NextResponse.json(
        { success: false, error: 'Client has no domain configured' },
        { status: 400 },
      )
    }

    // Create job synchronously so we can return its id immediately
    const jobId = await createDiscoveryJob(supabaseAdmin, clientId, client.domain)

    // Fire-and-forget background execution
    void executeDiscoveryJob(jobId, clientId, client.domain).catch((err: unknown) => {
      console.error('[zhangqian/discover] background failure', err)
    })

    return NextResponse.json(
      { success: true, job_id: jobId, domain: client.domain },
      { status: 202 },
    )
  } catch (err: unknown) {
    console.error('[zhangqian/discover] error', err)
    return NextResponse.json(
      { success: false, error: 'Failed to dispatch Zhangqian' },
      { status: 500 },
    )
  }
}

// ─── Background executor ─────────────────────────────────────────────────────

async function executeDiscoveryJob(
  jobId: string,
  clientId: string,
  domain: string,
): Promise<void> {
  await updateJobProgress(supabaseAdmin, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    progress_note: 'Zhangqian dispatched…',
  })

  try {
    const { report, validation_error, raw_output } = await runZhangqian(domain, {
      onProgress: async (note) => {
        await updateJobProgress(supabaseAdmin, jobId, { progress_note: note })
      },
    })

    if (validation_error) {
      await failJob(
        supabaseAdmin,
        jobId,
        `Validation failed: ${validation_error}. Partial cost: $${report.meta.cost_usd}.`,
        raw_output,
      )
      return
    }

    await completeJob(supabaseAdmin, jobId, clientId, report)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    await failJob(supabaseAdmin, jobId, `Agent error: ${message}`)
  }
}
