import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { enqueueRenderJob } from '@/lib/factory/render-queue'
import { scheduleSocialPost, resolveBoundPublerAccount } from '@/lib/flywheel/social-post-publish'
import { LINKEDIN_PROGRESS_SOURCE, LINKEDIN_PROGRESS_PLATFORM } from '@/lib/linkedin-progress/constants'

export const dynamic = 'force-dynamic'

// PATCH /api/clients/[id]/content-factory/[postId]
// body: { action: 'confirm' | 'reject' }
// 选题段的确认/打回：confirm → approved(进备料段)，reject → rejected(留选题段)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } },
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    const status =
      body.action === 'confirm' ? 'approved'    // 选题：确认做 → 建做片任务
      : body.action === 'reject' ? 'rejected'    // 打回
      : body.action === 'schedule' ? 'scheduled' // 出片：满意 → 去发布
      : null
    if (!status) {
      return NextResponse.json({ error: "action 必须是 'confirm' / 'reject' / 'schedule'" }, { status: 400 })
    }

    let updateQuery = supabaseAdmin
      .from('content_posts')
      .update({ status })
      .eq('client_id', params.id)   // 双重限定，防越权改到别客户
      .eq('id', params.postId)

    // 原子认领：confirm 只能从 'draft' 转 'approved'。没有这个条件，两个并
    // 发的 confirm（双击、两个管理员同时点）会各自无条件把状态重写成
    // approved，都读到一行，然后（对 LinkedIn 帖子）都各自调一次
    // scheduleSocialPost —— 发出两条重复的公开帖子。加了这条件后，只有
    // 真正抢到那一行 UPDATE 的请求才会拿到数据，另一个拿到空结果。
    if (body.action === 'confirm') {
      updateQuery = updateQuery.eq('status', 'draft')
    }

    const { data, error } = await updateQuery.select('id, status, format, source').maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: '未找到该内容，或者已经被处理过了（状态已变，可能刚被别人确认）' },
        { status: 404 },
      )
    }

    // 讲课式不在这里排做片——要先在单讲工作台选制作方式/传录像，直接排必失败(魏征 m2)
    if (body.action === 'confirm' && data.format === '讲课式') {
      return NextResponse.json({ post: data, render: { jobId: null, created: false, reason: '讲课式内容请进该讲的工作台开始做片' } })
    }

    // LinkedIn 进度贴是纯文本、没有做片环节——"确认"在这里就等于"批准发布"。
    // 不能走下面通用的 enqueueRenderJob：那是视频流水线的入口，对一条没有
    // 视频的文本贴只会 best-effort 失败或空转，PM 点了"确认"以为发出去了，
    // 实际上这条贴会永远卡在 approved，从没真正调用过 scheduleSocialPost。
    if (body.action === 'confirm' && data.source === LINKEDIN_PROGRESS_SOURCE) {
      // 严格解析账号，不能让 scheduleSocialPost 自己那套更松的逻辑兜底到
      // "随便一个已连账号"——共享 Publer workspace 里有多个身份时会发错号。
      const boundAccount = await resolveBoundPublerAccount(params.id, LINKEDIN_PROGRESS_PLATFORM)
      if (!boundAccount) {
        return NextResponse.json(
          { error: 'LinkedIn 账号还没连到发布工具，先去连接器设置页完成一次性授权' },
          { status: 409 },
        )
      }
      const result = await scheduleSocialPost({ postId: params.postId, clientId: params.id, account: boundAccount })
      if (!result.ok) {
        return NextResponse.json({ error: `发布失败：${result.error}` }, { status: 500 })
      }
      return NextResponse.json({
        post: { ...data, status: 'scheduled' },
        publish: { publerJobId: result.publerJobId, scheduledAt: result.scheduledAt },
      })
    }

    // 确认 = 建做片任务(流水线入口)。best-effort：建任务失败不回滚确认，只回报。
    let render: { jobId: string | null; created: boolean; reason?: string; error?: string } | undefined
    if (body.action === 'confirm') {
      try {
        render = await enqueueRenderJob({ clientId: params.id, contentPostId: params.postId })
      } catch (e) {
        render = { jobId: null, created: false, error: e instanceof Error ? e.message : String(e) }
      }
    }

    return NextResponse.json({ post: data, render })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
