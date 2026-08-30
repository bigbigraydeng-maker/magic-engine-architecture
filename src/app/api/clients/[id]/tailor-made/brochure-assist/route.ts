import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { assistBrochure } from '@/lib/tailor-made/brochure-assist'
import type { TailorMadeBrochure } from '@/lib/tailor-made/brochure-types'

/**
 * POST /api/clients/[id]/tailor-made/brochure-assist
 * 用一句话改画册：传当前画册 + 一句要求，返回改过的画册。
 *
 * 不落库 —— 返回的是草稿，顾问在预览里看过、认可了再点保存。
 * AI 改完直接写进数据库，等于让模型在一份要发给付费客户的文件上拥有写权限。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json()) as { brochure?: TailorMadeBrochure; instruction?: string }
    if (!body.brochure) return NextResponse.json({ error: '请求缺少 brochure' }, { status: 400 })
    if (!body.instruction?.trim()) return NextResponse.json({ error: '先说要改什么' }, { status: 400 })

    const result = await assistBrochure({ brochure: body.brochure, instruction: body.instruction })
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '改写失败'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
