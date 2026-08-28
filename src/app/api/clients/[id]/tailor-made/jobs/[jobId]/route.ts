import { NextRequest, NextResponse } from 'next/server'
import { unstable_noStore as noStore } from 'next/cache'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getJob } from '@/lib/tailor-made/jobs'

/**
 * GET /api/clients/[id]/tailor-made/jobs/[jobId]
 *
 * 轮询端点，给 import/extract 两条建任务的入口共用——两者都写进同一张
 * tailor_made_jobs 表，返回形状也一样（{ payload, review, reply, ... }）。
 *
 * 只在 status='completed' 时带 result，failed 时带 error，其余时候前端
 * 就继续轮询。
 */

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; jobId: string } },
) {
  noStore()

  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 这是个被高频轮询的端点——一次瞬时 DB 抖动就足够被打到。不接住的话
  // Next.js 默认 500 页不保证是 JSON，前端 `await res.json()` 会再炸一次
  // "Unexpected token '<'"，跟这一整轮修复要挡的原始症状一模一样。
  try {
    const job = await getJob(params.id, params.jobId)
    if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

    return NextResponse.json(
      {
        job_id: job.id,
        status: job.status,
        result: job.status === 'completed' ? job.result : null,
        error: job.status === 'failed' ? job.error : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : '查询任务失败'
    console.error('[tailor-made/jobs] getJob failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
