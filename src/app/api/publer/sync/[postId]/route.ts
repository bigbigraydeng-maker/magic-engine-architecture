/**
 * POST /api/publer/sync/[postId]
 *
 * 手动从 Publer 拉一个 content_post 的当前状态。
 * 用于替代 webhook（Publer 不在 UI 暴露 webhook）：
 *   - schedule 后，content_posts.publer_post_id 存的是 job_id
 *   - 我们用 getJobStatus 解析出真正的 Publer post_id（首次同步时落库）
 *   - 然后用 getPostStatus 拿当前 state（scheduled / published / failed）
 *   - 如果 published → 更新 content_posts.status='published'
 *     → DB trigger 自动 mark 关联 execution_item completed
 *
 * 返回：{ success: true, state: '...', published: bool, post_updated: bool }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getJobStatus, getPostStatus } from '@/lib/publer/client'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { postId: string } },
): Promise<NextResponse> {
  const { postId } = params
  try {
    const { data: post, error } = await supabaseAdmin
      .from('content_posts')
      .select('id, status, publer_post_id, publer_job_id')
      .eq('id', postId)
      .single<{
        id: string
        status: string
        publer_post_id: string | null
        publer_job_id: string | null
      }>()

    if (error || !post) {
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    if (!post.publer_post_id && !post.publer_job_id) {
      return NextResponse.json(
        { success: false, error: '这篇内容还没调度到 Publer（没有 job_id / post_id）' },
        { status: 400 },
      )
    }

    // 第一步：如果还没解析出 Publer post_id（只存了 job_id），先用 getJobStatus 解析
    let publerPostId: string | null = post.publer_post_id
    let publerJobId: string | null = post.publer_job_id

    // 兼容旧数据：之前的 create-post 把 job_id 错误地存到 publer_post_id 列
    // 检测办法：试着用 getJobStatus 解析，如果成功就把 publer_post_id 当作 job_id
    if (publerPostId && !publerJobId) {
      try {
        const jobStatus = await getJobStatus(publerPostId)
        if (jobStatus.publerPostIds.length > 0) {
          // 之前存的其实是 job_id — 修正
          publerJobId = publerPostId
          publerPostId = jobStatus.publerPostIds[0]
          await supabaseAdmin
            .from('content_posts')
            .update({ publer_job_id: publerJobId, publer_post_id: publerPostId })
            .eq('id', postId)
        }
      } catch {
        // job_status 失败说明确实是 post_id，直接走 post 查询
      }
    } else if (publerJobId && !publerPostId) {
      const jobStatus = await getJobStatus(publerJobId)
      if (jobStatus.publerPostIds.length > 0) {
        publerPostId = jobStatus.publerPostIds[0]
        await supabaseAdmin
          .from('content_posts')
          .update({ publer_post_id: publerPostId })
          .eq('id', postId)
      } else {
        // job 还在 working 状态
        return NextResponse.json({
          success: true,
          state: jobStatus.status,
          published: false,
          post_updated: false,
          message: `Publer 还在处理调度 job（status=${jobStatus.status}），稍后再同步。`,
        })
      }
    }

    if (!publerPostId) {
      return NextResponse.json(
        { success: false, error: 'Publer 未返回 post_id，请稍后重试' },
        { status: 502 },
      )
    }

    // 第二步：查询 Publer post 当前状态
    const postStatus = await getPostStatus(publerPostId)
    const isPublished = postStatus.state === 'published'

    let post_updated = false
    if (isPublished && post.status !== 'published') {
      // 更新 content_posts.status='published'
      // DB trigger (20260518000003) 会自动把关联 execution_item mark completed
      const { error: updateErr } = await supabaseAdmin
        .from('content_posts')
        .update({
          status: 'published',
          published_at: postStatus.publishedAt ?? new Date().toISOString(),
        })
        .eq('id', postId)

      if (updateErr) {
        return NextResponse.json(
          { success: false, error: `更新失败：${updateErr.message}` },
          { status: 500 },
        )
      }
      post_updated = true
    }

    return NextResponse.json({
      success: true,
      state: postStatus.state,
      published: isPublished,
      published_at: postStatus.publishedAt,
      post_updated,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[publer/sync] ', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
