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
}
