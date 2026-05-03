/**
 * GET /api/visual-assets/[assetId]/versions
 *
 * Returns the full version history for a visual asset,
 * ordered newest-first. Used by the version history modal
 * in Launch Hub.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const { data: versions, error } = await supabaseAdmin
      .from('visual_asset_versions')
      .select('id, version_num, storage_url, uploaded_by, edit_type, edit_notes, created_at')
      .eq('asset_id', params.assetId)
      .order('version_num', { ascending: false })

    if (error) throw error

    return NextResponse.json({ success: true, versions: versions ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual-assets/versions]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
