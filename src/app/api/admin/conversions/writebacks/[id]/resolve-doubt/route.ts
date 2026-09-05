/**
 * POST /api/admin/conversions/writebacks/[id]/resolve-doubt
 *   —— 人工裁决「不知道平台收没收」的那一档
 *
 * 出现「不确定」是因为发送时超时或网关出错：请求可能已经到了平台，也可能没到。
 * 广告平台的转化接口**没有去重**也**没有删除端点**，盲目重发就是永久多记一笔成交。
 * 所以程序停在这里，等人去平台后台看一眼再说。
 *
 * 这是**唯一**允许以「不确定」为起点改状态的入口。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { resolveDoubt } from '@/lib/conversions/writeback-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const actor = admin.user.email ?? null

  let body: { resolution?: 'confirmed' | 'resend'; note?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  if (body.resolution !== 'confirmed' && body.resolution !== 'resend') {
    return NextResponse.json(
      {
        error:
          "resolution 只能是 'confirmed'（你在平台后台看到了）或 'resend'（你确认平台没收到）",
      },
      { status: 400 },
    )
  }

  const result = await resolveDoubt(params.id, body.resolution, actor, supabaseAdmin)

  await supabaseAdmin.from('me_conversion_audit').insert({
    writeback_id: params.id,
    action: 'doubt_resolved',
    actor,
    detail: { resolution: body.resolution, note: body.note ?? null, applied: result.ok },
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}
