// Publer API Client
// 文档：https://publer.com/api/docs

const PUBLER_BASE = 'https://api.publer.com/v1'
const API_KEY = process.env.PUBLER_API_KEY!

export interface PublerPostResult {
  post_id: string
  status: string
  scheduled_at?: string
  platforms: string[]
}

export async function createPublerPost(params: {
  caption: string
  media_urls: string[]
  platforms: string[]
  schedule_at?: string
  hashtags?: string[]
}): Promise<PublerPostResult> {
  const { caption, media_urls, platforms, schedule_at, hashtags } = params

  const fullCaption = hashtags?.length
    ? `${caption}\n\n${hashtags.join(' ')}`
    : caption

  const res = await fetch(`${PUBLER_BASE}/posts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: fullCaption,
      media: media_urls.map(url => ({ url })),
      platforms,
      scheduled_at: schedule_at,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Publer create error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return {
    post_id: data.id || data.post_id,
    status: data.status,
    scheduled_at: data.scheduled_at,
    platforms: data.platforms || platforms,
  }
}
