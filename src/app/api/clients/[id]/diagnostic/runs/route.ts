/**
 * GET /api/clients/[id]/diagnostic/runs
 *
 * Returns up to 20 most recent diagnostic runs for the client,
 * ordered by created_at descending. Does not include findings.
 * Returns an empty array (not 404) when no runs exist.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.5
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'

const MAX_RUNS = 20

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params

    const { data: runs, error } = await supabaseAdmin
      .from('diagnostic_runs')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(MAX_RUNS)

    if (error) {
      console.error('[diagnostic/runs] Supabase error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch diagnostic runs' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, runs: runs ?? [] })
  } catch (err: unknown) {
    console.error('[diagnostic/runs] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred' },
      { status: 500 },
    )
  }
}
