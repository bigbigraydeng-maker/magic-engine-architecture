import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { extractItinerary, applyPatch, type ChatTurn } from '@/lib/tailor-made/extract'
import { createOrReuseJob, markRunning, markCompleted, markFailed } from '@/lib/tailor-made/jobs'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/extract
 * 自然语言 → 行程数据。返回合并后的完整行程 + 待确认清单。
 *
 * 不扣 MTC：CTS 是 FDE 轨付费客户，MTC 主要面向 self-serve 消费；
 * 且单次成本极低（一次 Sonnet 调用）。试点期间不想让「余额不足」
 * 变成顾问出单路上的失败点。要开计费的话，照 blog/route.ts 的
 * precheckCharge / commitCharge 包一层即可。
 *
 * ⚠️ 只建任务、立刻回 202，真正跑 AI 放进 fire-and-forget 的后台函数——
 * 原因同 import/route.ts：ME 后台正式域名走 Cloudflare 代理，长行程一次性
 * 粘贴（20 天以上）生成耗时会撞上 CF 约 100 秒的代理等待上限。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { message?: string; current?: TailorMadeItinerary; history?: ChatTurn[]; itineraryId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '请先输入内容' }, { status: 400 })
  if (!body.current) return NextResponse.json({ error: '缺少当前行程数据' }, { status: 400 })
  if (!body.itineraryId) return NextResponse.json({ error: '缺少行程 ID' }, { status: 400 })

  // 一次粘贴 20 天行程约 8–10k 字符；给足余量但挡住误传整本文档
  if (message.length > 60_000) {
    return NextResponse.json({ error: '内容过长，请分次粘贴（上限约 6 万字符）' }, { status: 400 })
  }

  const current = body.current
  const history = Array.isArray(body.history) ? body.history : []

  // 建任务本身也可能失败——不能让异常甩给 Next.js 默认错误页，那正是这次
  // 要修的原始故障（HTML 错误页把 "Unexpected token '<'" 甩给浏览器）。
  let jobId: string, reused: boolean
  try {
    ;({ jobId, reused } = await createOrReuseJob({
      clientId: params.id,
      itineraryId: body.itineraryId,
      kind: 'extract_text',
      input: { messageLength: message.length },
    }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : '建任务失败'
    console.error('[tailor-made/extract] createOrReuseJob failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!reused) {
    void runExtractJob({ jobId, message, current, history }).catch((err) => {
      console.error('[tailor-made/extract] background job crashed', err)
    })
  }

  return NextResponse.json({ job_id: jobId }, { status: 202 })
}

async function runExtractJob(params: {
  jobId: string
  message: string
  current: TailorMadeItinerary
  history: ChatTurn[]
}): Promise<void> {
  const { jobId, message, current, history } = params
  await markRunning(jobId)

  try {
    const result = await extractItinerary({ message, current, history })
    await markCompleted(jobId, {
      payload: applyPatch(current, result.patch),
      review: result.review,
      reply: result.reply,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/extract]', msg)
    await markFailed(jobId, `AI 解析失败：${msg}`)
  }
}
