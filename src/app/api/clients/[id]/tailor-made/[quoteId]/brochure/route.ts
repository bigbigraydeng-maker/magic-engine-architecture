import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clearBrochure, getItinerary, saveBrochure } from '@/lib/tailor-made/store'
import { createBlankBrochure, type TailorMadeBrochure } from '@/lib/tailor-made/brochure-types'

/**
 * /api/clients/[id]/tailor-made/[quoteId]/brochure
 * GET    读画册；还没有就按行程单派生一份空白的（不落库，顾问保存时才写）
 * PUT    保存画册
 * DELETE 删画册（行程单保留）
 *
 * 画册挂在报价单上，不是独立文档 —— 客户名和报价编号始终跟行程单同源。
 */

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string; quoteId: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const record = await getItinerary(params.id, params.quoteId)
    if (!record) return NextResponse.json({ error: '行程单不存在' }, { status: 404 })

    // 没做过画册就现给一份空白的：城市和日期从行程单继承，顾问一打开就能写内容，
    // 不用先点一次「创建」再等一次往返。
    const brochure = record.brochure ?? createBlankBrochure(record.payload)
    return NextResponse.json({ brochure, exists: record.brochure !== null })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json()) as { brochure?: TailorMadeBrochure }
    if (!body.brochure) {
      return NextResponse.json({ error: '请求缺少 brochure' }, { status: 400 })
    }

    const record = await saveBrochure(params.id, params.quoteId, body.brochure)
    return NextResponse.json({ item: record })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    await clearBrochure(params.id, params.quoteId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
