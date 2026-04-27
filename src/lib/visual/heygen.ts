// HeyGen Avatar Video Client
// 数字人讲解视频生成

const HEYGEN_BASE = 'https://api.heygen.com/v2'
const API_KEY = process.env.HEYGEN_API_KEY!

export interface AvatarJobResult {
  video_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  duration_seconds?: number
  error?: string
}

export async function listAvatars(): Promise<{ id: string; name: string; preview_url: string }[]> {
  const res = await fetch(`${HEYGEN_BASE}/avatars`, {
    headers: { 'X-Api-Key': API_KEY },
  })
  const data = await res.json()
  return data.data?.avatars || []
}

export async function submitAvatarVideo(params: {
  script: string
  avatar_id?: string
  voice_id?: string
  background?: string
  resolution?: '360p' | '720p' | '1080p'
}): Promise<{ video_id: string }> {
  const {
    script,
    avatar_id = process.env.HEYGEN_DEFAULT_AVATAR_ID || '',
    voice_id = process.env.HEYGEN_DEFAULT_VOICE_ID || '',
    background = '#f0f0f0',
    resolution = '720p',
  } = params

  const res = await fetch(`${HEYGEN_BASE}/video/generate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id,
          avatar_style: 'normal',
        },
        voice: {
          type: 'text',
          input_text: script,
          voice_id,
          speed: 1.0,
        },
        background: {
          type: background.startsWith('#') ? 'color' : 'image',
          value: background,
        },
      }],
      dimension: resolution === '1080p'
        ? { width: 1920, height: 1080 }
        : { width: 1280, height: 720 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`HeyGen submit error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return { video_id: data.data?.video_id }
}

export async function checkAvatarStatus(videoId: string): Promise<AvatarJobResult> {
  const res = await fetch(`${HEYGEN_BASE}/video_status.get?video_id=${videoId}`, {
    headers: { 'X-Api-Key': API_KEY },
  })

  if (!res.ok) throw new Error(`HeyGen status error: ${res.status}`)

  const data = await res.json()
  const video = data.data

  return {
    video_id: videoId,
    status: mapHeyGenStatus(video?.status),
    video_url: video?.video_url,
    duration_seconds: video?.duration,
    error: video?.error,
  }
}

function mapHeyGenStatus(raw?: string): AvatarJobResult['status'] {
  const map: Record<string, AvatarJobResult['status']> = {
    pending: 'pending',
    processing: 'processing',
    completed: 'completed',
    failed: 'failed',
  }
  return map[raw || ''] || 'pending'
}
