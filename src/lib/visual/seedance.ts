// Seedance 2.0 Video Generation Client
// Via Atlas Cloud API — $0.022/秒，Fast mode (text-to-video)
// 异步生成，需轮询状态

const ATLAS_BASE = 'https://api.atlascloud.ai/api/v1'
const API_KEY = process.env.ATLAS_CLOUD_API_KEY!

export interface VideoJobResult {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  video_url?: string
  duration_seconds?: number
  cost_usd?: number
  error?: string
}

export async function submitVideoGeneration(params: {
  prompt: string
  duration?: number
  resolution?: '720p' | '1080p'
  aspect_ratio?: '9:16' | '16:9' | '1:1'
}): Promise<{ job_id: string }> {
  const {
    prompt,
    duration = 6,
    resolution = '720p',
    aspect_ratio = '9:16',
  } = params

  const res = await fetch(`${ATLAS_BASE}/model/generateVideo`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'bytedance/seedance-2.0-fast/text-to-video',
      prompt,
      duration,
      resolution,
      ratio: aspect_ratio,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Seedance submit error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return { job_id: data.data?.id ?? data.id }
}

export async function checkVideoStatus(jobId: string): Promise<VideoJobResult> {
  const res = await fetch(`${ATLAS_BASE}/model/prediction/${jobId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  })

  if (!res.ok) throw new Error(`Seedance status error: ${res.status}`)

  const data = await res.json()
  const d = data.data ?? data

  return {
    job_id: jobId,
    status: mapStatus(d?.status),
    video_url: d?.outputs?.[0],
    duration_seconds: d?.duration,
    cost_usd: d?.duration ? d.duration * 0.022 : undefined,
    error: d?.error || undefined,
  }
}

function mapStatus(raw?: string): VideoJobResult['status'] {
  const map: Record<string, VideoJobResult['status']> = {
    created: 'pending',
    queued: 'pending',
    processing: 'processing',
    running: 'processing',
    succeeded: 'completed',
    completed: 'completed',
    failed: 'failed',
    error: 'failed',
  }
  return map[raw || ''] || 'pending'
}
