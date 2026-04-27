// Supadata Client — 多平台视频转录
// 支持：YouTube / TikTok / Instagram / Facebook / X

const SUPADATA_BASE = 'https://api.supadata.ai/v1'
const API_KEY = process.env.SUPADATA_API_KEY!

export interface VideoTranscript {
  transcript: string
  segments?: TranscriptSegment[]
  metadata: VideoMetadata
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface VideoMetadata {
  title?: string
  description?: string
  duration?: number
  view_count?: number
  platform: string
  url: string
}

export async function getVideoTranscript(videoUrl: string): Promise<VideoTranscript> {
  const transcriptRes = await fetch(
    `${SUPADATA_BASE}/youtube/transcript?url=${encodeURIComponent(videoUrl)}`,
    {
      headers: { 'x-api-key': API_KEY },
      next: { revalidate: 0 },
    }
  )

  if (!transcriptRes.ok) {
    const err = await transcriptRes.text()
    throw new Error(`Supadata error ${transcriptRes.status}: ${err}`)
  }

  const data = await transcriptRes.json()
  const platform = detectPlatform(videoUrl)

  // Supadata returns transcript as array of segment objects or a plain string
  const rawTranscript = data.content ?? data.transcript ?? []
  const segments: TranscriptSegment[] = Array.isArray(rawTranscript)
    ? rawTranscript.map((c: { offset: number; duration: number; text: string }) => ({
        start: c.offset / 1000,
        end: (c.offset + c.duration) / 1000,
        text: c.text,
      }))
    : []
  const transcriptText = Array.isArray(rawTranscript)
    ? rawTranscript.map((c: { text: string }) => c.text).join(' ')
    : String(rawTranscript)

  return {
    transcript: transcriptText,
    segments,
    metadata: {
      title: data.title,
      description: data.description,
      duration: data.duration,
      view_count: data.view_count,
      platform,
      url: videoUrl,
    },
  }
}

function detectPlatform(url: string): string {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('tiktok.com')) return 'tiktok'
  if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook'
  if (url.includes('instagram.com')) return 'instagram'
  return 'unknown'
}
