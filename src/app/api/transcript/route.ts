import { NextRequest, NextResponse } from 'next/server'
import { getVideoTranscript } from '@/lib/supadata/client'

export async function POST(req: NextRequest) {
  try {
    const { video_url } = await req.json()

    if (!video_url) {
      return NextResponse.json(
        { success: false, error: 'video_url required', code: 'INVALID_INPUT' },
        { status: 400 }
      )
    }

    const result = await getVideoTranscript(video_url)

    return NextResponse.json({
      success: true,
      transcript: result.transcript,
      segments: result.segments,
      metadata: result.metadata,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[transcript]', err)
    return NextResponse.json(
      { success: false, error: message, code: 'SUPADATA_ERROR' },
      { status: 500 }
    )
  }
}
