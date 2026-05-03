import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'visual-assets'

export async function uploadFromUrl(params: {
  sourceUrl: string
  clientId: string
  postId: string
  assetType: 'image' | 'video' | 'avatar_video'
  variant: 1 | 2
}): Promise<{ storage_url: string; file_size_kb: number }> {
  const { sourceUrl, clientId, postId, assetType, variant } = params

  const response = await fetch(sourceUrl)
  if (!response.ok) throw new Error(`Failed to fetch asset from ${sourceUrl}`)

  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const fileSizeKb = Math.round(bytes.length / 1024)

  const ext = assetType === 'image' ? 'jpg' : 'mp4'
  const timestamp = Date.now()
  const path = `${clientId}/${postId}/${assetType}-v${variant}-${timestamp}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: assetType === 'image' ? 'image/jpeg' : 'video/mp4',
      upsert: true,
    })

  if (error) throw error

  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET)
    .getPublicUrl(path)

  return {
    storage_url: urlData.publicUrl,
    file_size_kb: fileSizeKb,
  }
}
