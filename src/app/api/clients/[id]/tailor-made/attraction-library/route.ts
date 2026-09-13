import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

/**
 * GET /api/clients/[id]/tailor-made/attraction-library
 *
 * 英文景点文案素材库。顾问写画册时最费时的是英文介绍，不是排版 ——
 * 库里存文案，图片留空由顾问配自家的图。
 *
 * 库是行业级素材（做中国线的旅行社都能用），不是某一家的私有内容，
 * 所以放模板目录而不是客户配置里。
 */

export const dynamic = 'force-dynamic'

const LIBRARY_PATH = path.join(
  process.cwd(),
  'templates',
  'tailor-made-brochure',
  'attraction-library.json'
)

let cached: unknown = null

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    if (cached === null) cached = JSON.parse(await readFile(LIBRARY_PATH, 'utf8'))
    return NextResponse.json(cached)
  } catch {
    // 素材库读不到不该让画册编辑器打不开 —— 顾问还能自己写。
    return NextResponse.json({ cities: [] })
  }
}
