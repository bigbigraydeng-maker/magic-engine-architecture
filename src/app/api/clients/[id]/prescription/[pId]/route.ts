/**
 * GET  /api/clients/[id]/prescription/[pId]
 *   → Full prescription detail (intake + content + status)
 *
 * PATCH /api/clients/[id]/prescription/[pId]
 *   Body: { status: 'approved'|'rejected', approved_by?: string, rejection_note?: string }
 *   - 'approved' → save approval + synchronously generate execution_items
 *   - 'rejected'  → record rejection note
 *   - Already-approved prescription → 409 Conflict
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.16
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { generateExecutionItems } from '@/lib/diagnostic/execution-generator'
import type { Prescription, PrescriptionStatus } from '@/types/diagnostic'

// ---------------------------------------------------------------------------
// GET — fetch prescription
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, pId } = params

    const { data, error } = await supabaseAdmin
      .from('prescriptions')
      .select('*')
      .eq('id', pId)
      .eq('client_id', clientId)
      .single<Prescription>()

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Prescription not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, prescription: data })
  } catch (err: unknown) {
    console.error('[prescription GET] Error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH — approve or reject
// ---------------------------------------------------------------------------

type PatchBody = {
  status: 'approved' | 'rejected'
  approved_by?: string
  rejection_note?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, pId } = params
    const body = (await req.json()) as Partial<PatchBody>

    if (!body.status || !['approved', 'rejected'].includes(body.status)) {
      return NextResponse.json(
        { success: false, error: 'status must be "approved" or "rejected"' },
        { status: 400 },
      )
    }

    // Fetch current prescription
    const { data: current, error: fetchError } = await supabaseAdmin
      .from('prescriptions')
      .select('id, status, client_id')
      .eq('id', pId)
      .eq('client_id', clientId)
      .single<Pick<Prescription, 'id' | 'status' | 'client_id'>>()

    if (fetchError || !current) {
      return NextResponse.json({ success: false, error: 'Prescription not found' }, { status: 404 })
    }

    // Already-approved prescriptions cannot be modified (409 Conflict)
    if (current.status === 'approved') {
      return NextResponse.json(
        { success: false, error: 'Prescription is already approved and cannot be modified' },
        { status: 409 },
      )
    }

    // Build update payload
    const patch: Record<string, unknown> = { status: body.status }
    if (body.status === 'approved') {
      patch.approved_at = new Date().toISOString()
      if (body.approved_by) patch.approved_by = body.approved_by
    }
    if (body.status === 'rejected' && body.rejection_note) {
      patch.rejection_note = body.rejection_note
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('prescriptions')
      .update(patch)
      .eq('id', pId)
      .eq('client_id', clientId)
      .select('*')
      .single<Prescription>()

    if (updateError || !updated) {
      console.error('[prescription PATCH] Update error:', updateError)
      return NextResponse.json({ success: false, error: 'Failed to update prescription' }, { status: 500 })
    }

    // Approval → synchronously generate execution items before returning
    if (body.status === 'approved') {
      await generateExecutionItems(supabaseAdmin, pId, clientId)
    }

    return NextResponse.json({ success: true, prescription: updated })
  } catch (err: unknown) {
    console.error('[prescription PATCH] Error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
