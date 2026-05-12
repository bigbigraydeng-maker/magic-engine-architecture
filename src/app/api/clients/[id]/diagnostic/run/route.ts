/**
 * POST /api/clients/[id]/diagnostic/run
 *
 * Triggers an async diagnostic run for the given client.
 * Returns immediately with { run_id } (202 Accepted); collection
 * executes in the background via fire-and-forget.
 *
 * Body: { module: 'seo' }
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  isValidModule,
  createDiagnosticRun,
  executeDiagnosticRun,
} from '@/lib/diagnostic/runner'

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
    const body = (await req.json()) as { module?: string }

    if (!body.module || !isValidModule(body.module)) {
      return NextResponse.json(
        { success: false, error: 'Invalid module. Supported values: seo' },
        { status: 400 },
      )
    }

    const module = body.module

    // Quick synchronous DB insert — returns run_id immediately
    const runId = await createDiagnosticRun(supabaseAdmin, clientId, module)

    // Fire-and-forget: collectors run in the background
    void executeDiagnosticRun(supabaseAdmin, runId, clientId, module).catch((err: unknown) => {
      console.error('[diagnostic/run] Background execution failed:', err)
    })

    return NextResponse.json({ success: true, run_id: runId }, { status: 202 })
  } catch (err: unknown) {
    console.error('[diagnostic/run] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}
