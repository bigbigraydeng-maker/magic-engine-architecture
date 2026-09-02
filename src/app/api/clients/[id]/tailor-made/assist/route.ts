import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { assistItinerary } from '@/lib/tailor-made/itinerary-assist'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/assist
 * 用一句话改行程单：传当前行程 + 一句要求，返回改过的行程。
 *
 * 不落库 —— 返回的是草稿，顾问在右边预览里看过、认可了再点保存。
 * AI 改完直接写进数据库，等于让模型在一份要发给付费客户的文件上拥有写权限。
 *
 * 路由名放在 [quoteId] 之外，未保存的草稿也能用。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json()) as { payload?: TailorMadeItinerary; instruction?: string }
    if (!body.payload) return NextResponse.json({ error: '请求缺少 payload' }, { status: 400 })
    if (!body.instruction?.trim()) return NextResponse.json({ error: '先说要改什么' }, { status: 400 })

    const result = await assistItinerary({ payload: body.payload, instruction: body.instruction })
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '改写失败'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
