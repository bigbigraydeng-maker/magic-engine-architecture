/**
 * POST /api/clients/[id]/prescription/generate
 *
 * Generates a prescription from either:
 *   A) a completed diagnostic run  → body.run_id
 *   B) a confirmed Zhangqian discovery → body.discovery_id
 *
 * Body: {
 *   run_id?:       string   — diagnostic run (legacy source)
 *   discovery_id?: string   — Zhangqian discovery (primary source)
 *   intake:        PrescriptionIntake
 * }
 *
 * Returns: { success, prescription_id, content }
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.16 / P8.10.S2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  generatePrescription,
  generatePrescriptionFromDiscovery,
} from '@/lib/diagnostic/prescription-generator'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

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
    const body = (await req.json()) as {
      run_id?: string
      discovery_id?: string
      intake?: PrescriptionIntake
    }

    if (!body.intake) {
      return NextResponse.json({ success: false, error: 'intake is required' }, { status: 400 })
    }

    const { intake } = body
    if (!intake.business_goal || typeof intake.monthly_budget_aud !== 'number') {
      return NextResponse.json(
        { success: false, error: 'intake must include business_goal and monthly_budget_aud' },
        { status: 400 },
      )
    }

    // ── Path A: Zhangqian discovery source ──────────────────────────────────
    if (body.discovery_id) {
      const { data: row, error: discErr } = await supabaseAdmin
        .from('client_discovery')
        .select('id, payload, confirmed_at')
        .eq('id', body.discovery_id)
        .eq('client_id', clientId)
        .single<{ id: string; payload: DiscoveryReport; confirmed_at: string | null }>()

      if (discErr || !row) {
        return NextResponse.json(
          { success: false, error: 'Discovery not found' },
          { status: 404 },
        )
      }
      if (!row.confirmed_at) {
        return NextResponse.json(
          { success: false, error: 'Discovery must be confirmed before generating a prescription' },
          { status: 422 },
        )
      }

      const { prescriptionId, content } = await generatePrescriptionFromDiscovery(
        supabaseAdmin,
        row.id,
        clientId,
        intake,
        row.payload,
      )

      return NextResponse.json({ success: true, prescription_id: prescriptionId, content })
    }

    // ── Path B: Diagnostic run source (legacy) ───────────────────────────────
    if (body.run_id) {
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
    }

    return NextResponse.json(
      { success: false, error: 'Either run_id or discovery_id is required' },
      { status: 400 },
    )
  } catch (err: unknown) {
    console.error('[prescription/generate] Error:', err)
    return NextResponse.json(
      { success: false, error: 'Failed to generate prescription' },
      { status: 500 },
    )
  }
}
