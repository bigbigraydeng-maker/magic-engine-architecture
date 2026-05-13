/**
 * POST /api/clients/[id]/prescription/generate
 *
 * Generates a Claude Sonnet prescription from a completed diagnostic run.
 *
 * Body: {
 *   run_id: string            — must belong to this client
 *   intake: PrescriptionIntake
 * }
 *
 * Returns: { success, prescription_id, content }
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.16
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { generatePrescription } from '@/lib/diagnostic/prescription-generator'
import type { PrescriptionIntake } from '@/types/diagnostic'

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
    const body = (await req.json()) as { run_id?: string; intake?: PrescriptionIntake }

    if (!body.run_id) {
      return NextResponse.json({ success: false, error: 'run_id is required' }, { status: 400 })
    }
    if (!body.intake) {
      return NextResponse.json({ success: false, error: 'intake is required' }, { status: 400 })
    }

    // Validate intake required fields
    const { intake } = body
    if (!intake.business_goal || typeof intake.monthly_budget_aud !== 'number') {
      return NextResponse.json(
        { success: false, error: 'intake must include business_goal and monthly_budget_aud' },
        { status: 400 },
      )
    }

    // Verify run belongs to this client and is completed
    const { data: run, error: runError } = await supabaseAdmin
      .from('diagnostic_runs')
      .select('id, status')
      .eq('id', body.run_id)
      .eq('client_id', clientId)
      .single()

    if (runError || !run) {
      return NextResponse.json(
        { success: false, error: 'Diagnostic run not found' },
        { status: 404 },
      )
    }

    const { prescriptionId, content } = await generatePrescription(
      supabaseAdmin,
      body.run_id,
      clientId,
      intake,
    )

    return NextResponse.json({ success: true, prescription_id: prescriptionId, content })
  } catch (err: unknown) {
    console.error('[prescription/generate] Error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to generate prescription' },
      { status: 500 },
    )
  }
}
