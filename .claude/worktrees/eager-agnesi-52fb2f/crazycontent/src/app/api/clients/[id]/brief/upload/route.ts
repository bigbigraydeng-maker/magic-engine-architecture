import { NextRequest, NextResponse } from 'next/server'
import { uploadBriefFile } from '@/lib/brief/storage'

/**
 * POST /api/clients/[id]/brief/upload
 * multipart/form-data with field: file
 * Returns the storage_path for use in the generate request.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await uploadBriefFile({
      clientId: params.id,
      file: buffer,
      filename: file.name,
      contentType: file.type,
    })

    return NextResponse.json({ success: true, file: result })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    const status = message.includes('Unsupported') || message.includes('too large') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
