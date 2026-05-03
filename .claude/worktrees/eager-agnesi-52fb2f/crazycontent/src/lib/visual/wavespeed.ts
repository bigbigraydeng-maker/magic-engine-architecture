// Atlas Cloud Image Generation Client (Flux-dev)
// Reuses ATLAS_CLOUD_API_KEY — same key as Seedance video

const ATLAS_BASE = 'https://api.atlascloud.ai/api/v1'
const API_KEY = process.env.ATLAS_CLOUD_API_KEY!

export interface ImageJobResult {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  image_url?: string
  cost_usd?: number
  error?: string
}

export async function submitImageGeneration(params: {
  prompt: string
  width?: number
  height?: number
}): Promise<{ job_id: string }> {
  const { prompt, width = 1024, height = 1024 } = params

  const res = await fetch(`${ATLAS_BASE}/model/generateImage`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'black-forest-labs/flux-dev',
      prompt,
      width,
      height,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Atlas image submit error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return { job_id: data.data?.id }
}

export async function checkImageStatus(jobId: string): Promise<ImageJobResult> {
  const res = await fetch(`${ATLAS_BASE}/model/prediction/${jobId}`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` },
  })

  if (!res.ok) throw new Error(`Atlas image status error: ${res.status}`)

  const data = await res.json()
  const d = data.data

  return {
    job_id: jobId,
    status: mapStatus(d?.status),
    image_url: d?.outputs?.[0],
    cost_usd: 0.02,
    error: d?.error || undefined,
  }
}

function mapStatus(raw?: string): ImageJobResult['status'] {
  const map: Record<string, ImageJobResult['status']> = {
    created: 'pending',
    processing: 'processing',
    succeeded: 'completed',
    completed: 'completed',
    failed: 'failed',
  }
  return map[raw || ''] || 'pending'
}
