// 通用「传成片」入口 — 平铺看板里那些不走做片流水线的内容（边走边录口播等），
// 人自己录完/剪完，从这里把成片挂上去，卡片就从「备料」走到「出片」。
//
// 为什么单独开一条路由：`source_video_url` 原先只有单讲工作台（lecture/route.ts）能写，
// 非讲课式的内容录完在后台无处可传，流程断在备料和出片之间（PM 2026-08-17 撞到）。
//
// 讲课式**不走这里** —— 它的成片是系统做出来的，手动挂片会盖掉做片结果。
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { looksLikeVideoResponse, normalizeRecordingLink } from '@/lib/factory/recording-link'
import { safeProbeRemoteFile } from '@/lib/factory/safe-remote-fetch'

export const dynamic = 'force-dynamic'

const BUCKET = 'content-factory'
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/
/** 做片流水线还没结束的状态 —— 这些状态下不许手动挂片 */
const ACTIVE_JOB_STATUSES = ['queued', 'planning', 'rendering', 'assembling']

type Params = { params: { id: string; postId: string } }

/** 读一条内容，并挡掉讲课式。返回 null = 不存在或不属于该客户。 */
async function loadPost(clientId: string, postId: string) {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .select('id, title, format, status, source_video_url')
    .eq('client_id', clientId) // 双重限定，防越权读到别客户的内容
    .eq('id', postId)
    .maybeSingle<{
      id: string
      title: string | null
      format: string | null
      status: string
      source_video_url: string | null
    }>()
  if (error || !data) return null
  return data
}

/**
 * 这条内容是不是正在被流水线做片。
 *
 * 🔴 非讲课式内容在「确认选题」时也会 enqueueRenderJob，做片期间同样停在「备料」。
 *    此时手动挂片，卡片会先进「出片」，等做片跑完 `render-assemble.ts` 又会
 *    无条件覆盖 `source_video_url` —— 人传的片被静默换掉，一句提示都没有。
 *    所以有活跃任务时一律拒绝挂片。
 */
async function hasActiveRenderJob(postId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id')
    .eq('content_post_id', postId)
    .in('status', ACTIVE_JOB_STATUSES)
    .limit(1)
  return Boolean(data?.length)
}

/**
 * 挂片到这条内容上。
 *
 * 三重限定：client_id（防越权改别客户）+ id + **status='approved'**。
 * status 作为原子条件写进 update，而不是先读后判 —— 否则旧标签页里的「换一条」、
 * 或直接调 API，能清掉已经 scheduled / published 的片，毁掉待发素材和历史记录。
 * 返回 false = 没命中，状态已经变了。
 */
async function attachVideo(
  clientId: string,
  postId: string,
  url: string | null,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('content_posts')
    .update({ source_video_url: url })
    .eq('client_id', clientId)
    .eq('id', postId)
    .eq('status', 'approved')
    .select('id')
  if (error) throw error
  return Boolean(data?.length)
}

const staleResponse = () =>
  NextResponse.json(
    { error: '这条内容的状态已经变了（可能已排期或已发布）— 刷新页面再看一下' },
    { status: 409 },
  )

const busyResponse = () =>
  NextResponse.json(
    { error: '这条正在自动做片，等它做完；要用自己的片就先「打回重做」再挂' },
    { status: 409 },
  )

/**
 * POST — 签一个直传地址回去。
 * body: { fileName }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json().catch(() => ({}))) as { fileName?: string }
    const post = await loadPost(params.id, params.postId)
    if (!post) return NextResponse.json({ error: '未找到该内容' }, { status: 404 })
    if (post.format === '讲课式') {
      return NextResponse.json(
        { error: '这条是讲课式内容 — 成片由系统做，请进该讲的工作台' },
        { status: 400 },
      )
    }

    if (post.status !== 'approved') return staleResponse()
    if (await hasActiveRenderJob(params.postId)) return busyResponse()

    const ext = (body.fileName ?? '').toLowerCase().match(VIDEO_EXT)?.[1]
    if (!ext) return NextResponse.json({ error: '只支持 mp4 / mov / m4v / webm 视频文件' }, { status: 400 })

    const path = `${params.id}/final/${params.postId}/final-${Date.now()}.${ext}`
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: true })
    if (error || !data) throw error ?? new Error('签名失败')

    return NextResponse.json({ path: data.path, signedUrl: data.signedUrl, token: data.token })
  } catch {
    return NextResponse.json(
      { error: '出错了，刷新页面再试一次；反复出错请直接联系我们' },
      { status: 500 },
    )
  }
}

/**
 * PATCH — action: 'uploaded' | 'link' | 'clear'
 *   uploaded: { path }  直传完成后回调，把公开地址挂上去
 *   link:     { link }  粘一个外链（Dropbox 等），当场探活再挂
 *   clear:    传错了撤掉
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      path?: string
      link?: string
    }
    const post = await loadPost(params.id, params.postId)
    if (!post) return NextResponse.json({ error: '未找到该内容' }, { status: 404 })
    if (post.format === '讲课式') {
      return NextResponse.json(
        { error: '这条是讲课式内容 — 成片由系统做，请进该讲的工作台' },
        { status: 400 },
      )
    }

    // 做片流水线在跑的时候不许碰片（clear 也不行 —— 那只会制造更混乱的中间态）
    if (await hasActiveRenderJob(params.postId)) return busyResponse()

    switch (body.action) {
      case 'uploaded': {
        // 路径必须严格是本条内容目录下、由上面 POST 签出的文件名格式。
        // 不能用 startsWith：`..` 会穿透，而 getPublicUrl 是纯拼串，
        // 下载时 URL 归一化后能指到别的客户目录（lecture 路由踩过，魏征 M1）。
        const pathRe = new RegExp(
          `^${params.id}/final/${params.postId}/final-\\d+\\.(mp4|mov|m4v|webm)$`,
        )
        if (!body.path || !pathRe.test(body.path)) {
          return NextResponse.json(
            { error: '上传没成功，请重新点「传成片」再传一次' },
            { status: 400 },
          )
        }
        const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(body.path)
        if (!(await attachVideo(params.id, params.postId, pub.publicUrl))) return staleResponse()
        return NextResponse.json({ ok: true, videoUrl: pub.publicUrl })
      }

      case 'link': {
        const norm = normalizeRecordingLink(body.link ?? '')
        if (!norm.ok || !norm.url) {
          return NextResponse.json({ error: norm.error ?? '这个链接用不了' }, { status: 400 })
        }
        // 探活走逐跳校验的安全版：不许自动跟随跳转，每跳都重新查协议和解析出的 IP。
        // 直接 redirect:'follow' 只校验首个 URL，等于给人一个让服务器代访内网的口子。
        const probe = await safeProbeRemoteFile(norm.url)
        if (!probe.ok) {
          return NextResponse.json({ error: probe.error ?? '这个链接用不了' }, { status: 400 })
        }
        if (!looksLikeVideoResponse(probe.contentType ?? null, probe.finalUrl ?? norm.url)) {
          return NextResponse.json(
            { error: '这个链接指向的不是视频文件 — 对着那条视频本身「复制链接」再粘一次' },
            { status: 400 },
          )
        }
        // 存规范化后的原始链接（不存 finalUrl —— 跳转目标常带一次性签名，会过期）
        if (!(await attachVideo(params.id, params.postId, norm.url))) return staleResponse()
        return NextResponse.json({ ok: true, videoUrl: norm.url })
      }

      case 'clear': {
        if (!(await attachVideo(params.id, params.postId, null))) return staleResponse()
        return NextResponse.json({ ok: true, videoUrl: null })
      }

      default:
        return NextResponse.json(
          { error: "action 必须是 'uploaded' / 'link' / 'clear'" },
          { status: 400 },
        )
    }
  } catch {
    return NextResponse.json(
      { error: '出错了，刷新页面再试一次；反复出错请直接联系我们' },
      { status: 500 },
    )
  }
}
