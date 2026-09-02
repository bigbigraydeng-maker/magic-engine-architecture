import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { renderBrochureHtml } from '@/lib/tailor-made/brochure-render'
import type { TailorMadeBrochure } from '@/lib/tailor-made/brochure-types'

/**
 * POST /api/clients/[id]/tailor-made/brochure-preview
 * 传入画册数据，返回渲染好的画册 HTML（A4 版面）。
 *
 * 与行程单的 preview 同构：编辑器用它做实时预览，顾问也用同一份 HTML ⌘P 出 PDF，
 * 所以屏幕上看到什么，终端客户拿到的就是什么。
 *
 * 走 POST 而不是 GET，是因为未保存的草稿也要能预览。
 * 路由名不放在 [quoteId] 下，是为了让未落库的新画册也能预览。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json()) as {
      brochure?: TailorMadeBrochure
      preparedFor?: string
      quoteRef?: string
    }
    if (!body.brochure) {
      return NextResponse.json({ error: '请求缺少 brochure' }, { status: 400 })
    }

    const html = await renderBrochureHtml(body.brochure, {
      preparedFor: body.preparedFor ?? '',
      quoteRef: body.quoteRef ?? '',
    })

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '预览生成失败'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
