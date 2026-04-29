import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mov']
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES]
const MAX_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

// POST /api/visual/upload
// Accepts multipart/form-data: file, post_id, client_id
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const postId = formData.get('post_id') as string | null
    const clientId = formData.get('client_id') as string | null

    if (!file || !postId || !clientId) {
      return NextResponse.json(
        { success: false, error: 'file, post_id, and client_id are required' },
        { status: 400 }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: `Unsupported file type: ${file.type}. Use JPEG, PNG, WebP, GIF, MP4, or MOV.` },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 100MB.` },
        { status: 400 }
      )
    }

    const assetType: 'image' | 'video' = ALLOWED_VIDEO_TYPES.includes(file.type) ? 'video' : 'image'
    const ext = file.name.split('.').pop()?.toLowerCase() ?? (assetType === 'video' ? 'mp4' : 'jpg')
    const storagePath = `${clientId}/${postId}/upload_${Date.now()}.${ext}`

    const bytes = await file.arrayBuffer()
    const { error: storageError } = await supabaseAdmin.storage
      .from('assets')
      .upload(storagePath, bytes, { contentType: file.type, upsert: true })

    if (storageError) throw storageError

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('assets')
      .getPublicUrl(storagePath)

    const { data: asset, error: dbError } = await supabaseAdmin
      .from('visual_assets')
      .insert({
        post_id: postId,
        client_id: clientId,
        asset_type: assetType,
        provider: 'upload',
        generation_status: 'ready',
        storage_url: publicUrl,
        file_size_kb: Math.round(file.size / 1024),
        prompt_used: `Manual upload: ${file.name}`,
      })
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json({
      success: true,
      asset_id: asset.id,
      storage_url: publicUrl,
      asset_type: assetType,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[visual/upload]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
