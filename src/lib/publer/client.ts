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

// 下载文件并以 multipart 上传给 Publer，直接拿到 media ID
export async function uploadMediaFromUrl(url: string, name: string): Promise<{ id: string; type: string }> {
  const imgRes = await fetch(url)
  if (!imgRes.ok) throw new Error(`Failed to fetch media from storage: ${imgRes.status}`)
  const blob = await imgRes.blob()
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg'

  const form = new FormData()
  form.append('file', blob, name)

  // FormData 上传时不加 Content-Type（让浏览器/Node 自动设 boundary）
  const { Authorization, 'Publer-Workspace-Id': workspaceId } = publerHeaders()
  const res = await fetch(`${PUBLER_BASE}/media`, {
    method: 'POST',
    headers: { Authorization, 'Publer-Workspace-Id': workspaceId },
    body: form,
  })
  if (!res.ok) throw new Error(`Publer media upload error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  if (!data.id) throw new Error(`Publer upload returned no ID: ${JSON.stringify(data)}`)

  const isVideo = contentType.startsWith('video/')
  return { id: data.id, type: isVideo ? 'video' : 'photo' }
}

/**
 * 查询一个 schedule job 的处理状态。
 * Publer 的 /posts/schedule 是异步的：返回 job_id 后，Publer 在后台真正调度/发布。
 * 这个端点告诉我们 job 当前的状态以及（如果已完成）发布到 Publer 的 post IDs。
 *
 * Publer API: GET /api/v1/job_status/:job_id
 * 返回示例：{ status: 'working' | 'completed' | 'failed', payload?: { post_ids?: string[] }, ... }
 */
export async function getJobStatus(jobId: string): Promise<{
  status: string
  publerPostIds: string[]
  raw: Record<string, unknown>
}> {
  const res = await fetch(`${PUBLER_BASE}/job_status/${encodeURIComponent(jobId)}`, {
    headers: publerHeaders(),
  })
  if (!res.ok) throw new Error(`Publer getJobStatus error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as Record<string, unknown>
  // payload 形态在 Publer 版本间略有差异，尽可能宽容地解析 post_ids
  const payload = (data.payload ?? {}) as Record<string, unknown>
  const ids = Array.isArray(payload.post_ids) ? payload.post_ids
    : Array.isArray(payload.posts) ? payload.posts
    : []
  return {
    status: typeof data.status === 'string' ? data.status : 'unknown',
    publerPostIds: ids.filter((x): x is string => typeof x === 'string'),
    raw: data,
  }
}

/**
 * 查询一个已经被调度/发布的 Publer post 的当前状态。
 *
 * Publer API: GET /api/v1/posts/:post_id
 * 返回示例：{ id, state: 'scheduled' | 'published' | 'failed', published_at?: ISO, ... }
 */
export async function getPostStatus(publerPostId: string): Promise<{
  state: string
  publishedAt: string | null
  raw: Record<string, unknown>
}> {
  const res = await fetch(`${PUBLER_BASE}/posts/${encodeURIComponent(publerPostId)}`, {
    headers: publerHeaders(),
  })
  if (!res.ok) throw new Error(`Publer getPostStatus error ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as Record<string, unknown>
  const post = (data.post ?? data) as Record<string, unknown>
  return {
    state: typeof post.state === 'string' ? post.state : 'unknown',
    publishedAt: typeof post.published_at === 'string' ? post.published_at : null,
    raw: post,
  }
}

export async function schedulePost(params: {
  accountId: string
  provider: string
  assetType: string
  media: { id: string; type: string }
  caption: string
  scheduledAt: string
}): Promise<{ job_id: string }> {
  const { accountId, provider, assetType, media, caption, scheduledAt } = params
  // Facebook: photo→"photo", video→"video", Instagram: video→"reel"
  const networkType = assetType === 'video'
    ? (provider === 'instagram' ? 'reel' : 'video')
    : 'photo'

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
              media: [{ id: media.id, type: media.type }],
            },
          },
          accounts: [{ id: accountId, scheduled_at: scheduledAt }],
        }],
      },
    }),
  })
  if (!res.ok) throw new Error(`Publer schedulePost error ${res.status}: ${await res.text()}`)

  // Return immediately — the 200 response from Publer confirms the post was accepted.
  // The previous 5 s sleep + job-status check was blocking the API response for too long
  // and causing Render request timeouts on the UI side.
  return await res.json()
}
