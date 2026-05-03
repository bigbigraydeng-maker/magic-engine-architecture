/**
 * POST /api/visual-assets/[assetId]/upload-version
 *
 * Uploads a new version of an existing visual asset.
 * - Accepts multipart/form-data with `file` + optional `edit_notes`
 * - Stores the file in Supabase Storage under the same client folder
 * - Creates a visual_asset_versions record (version_num auto-incremented)
 * - Updates visual_assets: storage_url, current_version_num, is_final=true,
 *   external_edit_status='final'
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const editNotes = (formData.get('edit_notes') as string | null) ?? ''

    if (!file) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }

    // Load the existing asset to get client_id and current version number
    const { data: asset, error: assetErr } = await supabaseAdmin
      .from('visual_assets')
      .select('id, client_id, post_id, current_version_num, asset_type')
      .eq('id', params.assetId)
      .single()

    if (assetErr || !asset) {
      return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })
    }

    const nextVersion = (asset.current_version_num ?? 1) + 1
    const ext = file.name.split('.').pop() ?? (asset.asset_type === 'video' ? 'mp4' : 'jpg')
    const storagePath = `${asset.client_id}/${asset.post_id}/v${nextVersion}_external.${ext}`

    // Upload to Supabase Storage
    const bytes = await file.arrayBuffer()
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('visual-assets')
      .upload(storagePath, bytes, {
        contentType: file.type || 'application/octet-stream',
        upsert: true,
      })

    if (uploadErr) throw uploadErr

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('visual-assets')
      .getPublicUrl(storagePath)

    // Insert version record
    const { error: versionErr } = await supabaseAdmin
      .from('visual_asset_versions')
      .insert({
        asset_id: params.assetId,
        version_num: nextVersion,
        storage_url: publicUrl,
        uploaded_by: 'user',
        edit_type: 'external_edit',
        edit_notes: editNotes || null,
      })

    if (versionErr) throw versionErr

    // Update the asset: point to new version, mark as final
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('visual_assets')
      .update({
        storage_url: publicUrl,
        current_version_num: nextVersion,
        is_final: true,
        external_edit_status: 'final',
        generation_status: 'ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.assetId)
      .select()
      .single()

    if (updateErr) throw updateErr

    return NextResponse.json({
      success: true,
      version_num: nextVersion,
      storage_url: publicUrl,
      asset: updated,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual-assets/upload-version]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
