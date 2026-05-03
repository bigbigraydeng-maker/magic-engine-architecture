// Campaign file upload — PDF / Word / TXT → Supabase Storage
// mirrors /api/clients/[id]/brief/upload pattern

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const MAX_SIZE = 30 * 1024 * 1024 // 30 MB
const CAMPAIGN_BUCKET = 'campaign-uploads'

async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(CAMPAIGN_BUCKET, {
    public: false,
    fileSizeLimit: MAX_SIZE,
  })
  if (error && !error.message.toLowerCase().includes('already exists')) {
    throw error
  }
}
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, error: 'File exceeds 30 MB limit' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { success: false, error: 'Only PDF, Word, and TXT files are allowed' },
        { status: 400 }
      )
    }

    const ext = file.name.split('.').pop() ?? 'bin'
    const storagePath = `${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    await ensureBucket()

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(CAMPAIGN_BUCKET)
      .upload(storagePath, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      })

    if (uploadErr) throw uploadErr

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(CAMPAIGN_BUCKET)
      .getPublicUrl(storagePath)

    return NextResponse.json({
      success: true,
      storage_path: storagePath,
      url: publicUrl,
      filename: file.name,
      size: file.size,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[campaign/upload]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
