/**
 * PATCH /api/visual-assets/[assetId]/edit-status
 *
 * Updates the external_edit_status of a visual asset.
 * Body: { status: 'needs_external_edit' | 'in_external_edit' | 'final' | null }
 *
 * Used by Launch Hub when team marks an asset for external editing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const VALID_STATUSES = ['needs_external_edit', 'in_external_edit', 'final'] as const
type EditStatus = typeof VALID_STATUSES[number] | null

export async function PATCH(
  req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const body = await req.json()
    const status: EditStatus = body.status ?? null

    if (status !== null && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      return NextResponse.json(
        { success: false, error: `Invalid status: ${status}` },
        { status: 400 }
      )
    }

    const updatePayload: Record<string, unknown> = {
      external_edit_status: status,
      updated_at: new Date().toISOString(),
    }

    // When marking as final, also set is_final=true
    if (status === 'final') {
      updatePayload.is_final = true
    }

    // When clearing the edit flag, reset is_final based on whether there is a storage_url
    if (status === null) {
      updatePayload.is_final = false
    }

    const { data: updated, error } = await supabaseAdmin
      .from('visual_assets')
      .update(updatePayload)
      .eq('id', params.assetId)
      .select('id, external_edit_status, is_final')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, asset: updated })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual-assets/edit-status]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
