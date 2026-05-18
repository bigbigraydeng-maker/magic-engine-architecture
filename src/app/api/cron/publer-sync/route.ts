/**
 * GET/POST /api/cron/publer-sync
 *
 * 定时全量同步 Publer 状态 — 替代 webhook（Publer 不在 UI 暴露 webhook）。
 *
 * 流程：
 *   1. 找出所有 status='scheduled' 且过去 24h 内调度的 content_posts
 *   2. 对每条尝试同步 Publer 状态（用 /api/publer/sync/[postId] 同样的逻辑）
 *   3. 如果 published → 更新 status → DB trigger 自动 mark execution_item completed
 *   4. 返回汇总
 *
 * Security: 必须带 CRON_SECRET（或 INTERNAL_API_KEY） — 防止滥用
 * Schedule: Render Cron Job 每 5-15 分钟 GET 一次
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getJobStatus, getPostStatus } from '@/lib/publer/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SyncResult {
  post_id: string
  before_status: string
  after_state: string | null
  published: boolean
  error?: string
}

async function syncOne(post: {
  id: string
  status: string
  publer_post_id: string | null
  publer_job_id: string | null
}): Promise<SyncResult> {
  const result: SyncResult = {
    post_id: post.id,
    before_status: post.status,
    after_state: null,
    published: false,
  }

  try {
    let publerPostId = post.publer_post_id
    let publerJobId = post.publer_job_id

    // 向后兼容：旧数据把 job_id 存到了 publer_post_id 列
    if (publerPostId && !publerJobId) {
      try {
        const js = await getJobStatus(publerPostId)
        if (js.publerPostIds.length > 0) {
          publerJobId = publerPostId
          publerPostId = js.publerPostIds[0]
          await supabaseAdmin
            .from('content_posts')
            .update({ publer_job_id: publerJobId, publer_post_id: publerPostId })
            .eq('id', post.id)
        }
      } catch { /* 不是 job_id，继续当 post_id 用 */ }
    } else if (publerJobId && !publerPostId) {
      const js = await getJobStatus(publerJobId)
      if (js.publerPostIds.length > 0) {
        publerPostId = js.publerPostIds[0]
        await supabaseAdmin
          .from('content_posts')
          .update({ publer_post_id: publerPostId })
          .eq('id', post.id)
      } else {
        result.after_state = js.status
        return result
      }
    }

    if (!publerPostId) {
      result.error = '没有可用的 publer_post_id'
      return result
    }

    const ps = await getPostStatus(publerPostId)
    result.after_state = ps.state

    if (ps.state === 'published' && post.status !== 'published') {
      await supabaseAdmin
        .from('content_posts')
        .update({
          status: 'published',
          published_at: ps.publishedAt ?? new Date().toISOString(),
        })
        .eq('id', post.id)
      result.published = true
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Unknown error'
  }

  return result
}

async function runSync(): Promise<NextResponse> {
  // 拉所有 scheduled 状态、过去 7 天内调度的（避免无限回溯）
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data: posts, error } = await supabaseAdmin
    .from('content_posts')
    .select('id, status, publer_post_id, publer_job_id')
    .eq('status', 'scheduled')
    .gte('scheduled_at', cutoff)
    .or('publer_post_id.not.is.null,publer_job_id.not.is.null')
    .limit(100)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const results = await Promise.all((posts ?? []).map(p => syncOne(p as Parameters<typeof syncOne>[0])))

  const published = results.filter(r => r.published).length
  const errored = results.filter(r => r.error).length

  return NextResponse.json({
    success: true,
    checked: results.length,
    published,
    errors: errored,
    details: results,
  })
}

function checkAuth(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  const apiKey = process.env.INTERNAL_API_KEY
  const auth = req.headers.get('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (cronSecret && bearer === cronSecret) return true
  if (apiKey && bearer === apiKey) return true
  // Render Cron Job 注入的 header（如果用 Render Cron）
  const renderSecret = req.headers.get('x-cron-secret')
  if (cronSecret && renderSecret === cronSecret) return true
  return false
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return runSync()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkAuth(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return runSync()
}
