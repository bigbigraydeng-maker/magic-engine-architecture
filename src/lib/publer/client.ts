// Publer REST API v1 client
// Auth: Bearer-API key + Publer-Workspace-Id header (not standard Bearer)

const PUBLER_BASE = 'https://app.publer.com/api/v1'

function publerHeaders() {
  return {
    'Authorization': `Bearer-API ${process.env.PUBLER_API_KEY}`,
    'Publer-Workspace-Id': process.env.PUBLER_WORKSPACE_ID!,
    'Content-Type': 'application/json',
  }
}

export interface PublerAccount {
  id: string
  provider: string
  name: string
  picture?: string
  type?: string
}

export async function getAccounts(): Promise<PublerAccount[]> {
  const res = await fetch(`${PUBLER_BASE}/accounts`, { headers: publerHeaders() })
  if (!res.ok) throw new Error(`Publer getAccounts error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.accounts ?? data ?? []
}

async function pollJobStatus(jobId: string, maxAttempts = 18): Promise<Record<string, unknown>> {
  let lastStatus = 'unknown'
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const res = await fetch(`${PUBLER_BASE}/job_status/${jobId}`, { headers: publerHeaders() })
    if (!res.ok) continue
    const data = await res.json()
    lastStatus = data.status ?? 'no_status'
    console.log(`[publer] job ${jobId} attempt ${i + 1}: status=${lastStatus}`, JSON.stringify(data).slice(0, 200))
    if (data.status === 'completed' || data.status === 'success' || data.status === 'done') return data
    if (data.status === 'failed' || data.status === 'error') throw new Error(`Publer job failed: ${JSON.stringify(data)}`)
    // 如果 data 中已有媒体 ID 则视为完成
    if (data.data?.id || data.id) return data
  }
  throw new Error(`Publer job timed out (last status: ${lastStatus})`)
}

export async function uploadMediaFromUrl(url: string, name: string): Promise<string> {
  const res = await fetch(`${PUBLER_BASE}/media/from-url`, {
    method: 'POST',
    headers: publerHeaders(),
    body: JSON.stringify({ media: [{ url, name }], type: 'single' }),
  })
  if (!res.ok) throw new Error(`Publer media upload error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const result = await pollJobStatus(data.job_id)
  const mediaId = (result.data as { id?: string })?.id
  if (!mediaId) throw new Error('No media ID in Publer job result')
  return mediaId
}

export async function schedulePost(params: {
  accountId: string
  provider: string
  assetType: string
  mediaId: string
  caption: string
  scheduledAt: string
}): Promise<{ job_id: string }> {
  const { accountId, provider, assetType, mediaId, caption, scheduledAt } = params
  const networkType = assetType === 'video' && provider === 'instagram' ? 'reel' : 'feed'
  const mediaType = assetType === 'video' ? 'video' : 'image'

  const res = await fetch(`${PUBLER_BASE}/posts/schedule`, {
    method: 'POST',
    headers: publerHeaders(),
    body: JSON.stringify({
      bulk: {
        state: 'scheduled',
        posts: [{
          networks: {
            [provider]: {
              type: networkType,
              text: caption,
              media: [{ id: mediaId, type: mediaType }],
            },
          },
          accounts: [{ id: accountId, scheduled_at: scheduledAt }],
        }],
      },
    }),
  })
  if (!res.ok) throw new Error(`Publer schedulePost error ${res.status}: ${await res.text()}`)
  return res.json()
}
