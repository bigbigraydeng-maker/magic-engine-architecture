import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { publishGroupTour } from '@/lib/group-tours/publisher'

/**
 * POST /api/clients/[id]/group-tours/[tourId]/publish
 *
 * 提交发布申请——不是"发布上线"。成功只代表开出了一个 Draft PR，团页要等
 * 人工在 GitHub 上 review + merge 才会真的出现在客户官网上（板桥意见1）。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: { id: string; tourId: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const result = await publishGroupTour({ clientId: params.id, tourId: params.tourId })

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'ALREADY_PUBLISHING' ? 409 : 422
    return NextResponse.json({ error: result.reason, code: result.code }, { status })
  }

  return NextResponse.json({
    prUrl: result.prUrl,
    prNumber: result.prNumber,
    mode: result.mode,
    message: '已提交发布申请：系统开出了一个 GitHub Pull Request，等技术同事在 GitHub 上确认合并后，团页才会真的出现在官网。',
  })
}
