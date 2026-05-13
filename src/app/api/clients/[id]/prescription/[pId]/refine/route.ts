/**
 * POST /api/clients/[id]/prescription/[pId]/refine
 *
 * 让华佗对已生成的处方做一次"精修"——基于上一轮自评的薄弱点针对性修改。
 *
 * 仅对**草稿状态（status='draft'）+ 华佗生成（agent_name='huatuo'）+ 来自张骞发现**
 * 的处方有效。已批准的处方不能再修。
 *
 * Body: {} （不需要参数；上下文从已存的 intake + discovery + self_grade.weaknesses 还原）
 * Returns: { success, content, self_grade, meta, trend_summary } — 与生成路径同形
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { refineHuatuoPrescription } from '@/lib/huatuo/agent'
import type { PrescriptionIntake, PrescriptionContent } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { SelfGrade } from '@/lib/huatuo/types'

export const maxDuration = 120

interface PrescriptionRow {
  id: string
  client_id: string
  discovery_id: string | null
  status: string
  agent_name: string | null
  intake: PrescriptionIntake | null
  content: PrescriptionContent | null
  self_grade: SelfGrade | null
}

interface DiscoveryRow {
  id: string
  payload: DiscoveryReport
  confirmed_at: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, pId } = params

    // 1. 加载处方 + 校验状态
    const { data: presc, error: pErr } = await supabaseAdmin
      .from('prescriptions')
      .select('id, client_id, discovery_id, status, agent_name, intake, content, self_grade')
      .eq('id', pId)
      .eq('client_id', clientId)
      .single<PrescriptionRow>()

    if (pErr || !presc) {
      return NextResponse.json({ success: false, error: '处方不存在' }, { status: 404 })
    }
    if (presc.status === 'approved') {
      return NextResponse.json(
        { success: false, error: '处方已批准，无法再次精修' },
        { status: 409 },
      )
    }
    if (presc.agent_name !== 'huatuo') {
      return NextResponse.json(
        { success: false, error: '只有华佗生成的处方支持精修' },
        { status: 422 },
      )
    }
    if (!presc.discovery_id || !presc.intake || !presc.content) {
      return NextResponse.json(
        { success: false, error: '处方数据不完整（缺 discovery / intake / content）' },
        { status: 422 },
      )
    }

    // 2. 加载源 discovery（华佗需要全量 discovery 才能重新 lookup）
    const { data: disc, error: dErr } = await supabaseAdmin
      .from('client_discovery')
      .select('id, payload, confirmed_at')
      .eq('id', presc.discovery_id)
      .eq('client_id', clientId)
      .single<DiscoveryRow>()

    if (dErr || !disc) {
      return NextResponse.json({ success: false, error: '源发现报告不存在' }, { status: 404 })
    }

    // 3. 取上一轮自评的薄弱点作为精修反馈
    const previousWeaknesses = presc.self_grade?.weaknesses ?? []
    if (previousWeaknesses.length === 0) {
      return NextResponse.json(
        { success: false, error: '上一轮无明确薄弱点，无需精修' },
        { status: 422 },
      )
    }

    // 4. 调华佗精修
    const result = await refineHuatuoPrescription(
      supabaseAdmin,
      disc.payload,
      presc.intake,
      presc.content,
      previousWeaknesses,
    )

    // 5. 更新处方记录（覆盖 content + self_grade + 累加 meta）
    const { error: updErr } = await supabaseAdmin
      .from('prescriptions')
      .update({
        content:         result.content,
        self_grade:      result.self_grade,
        generation_meta: { ...result.meta, trend_summary: result.trend_summary },
      })
      .eq('id', pId)
      .eq('client_id', clientId)

    if (updErr) {
      console.error('[prescription/refine] update failed', updErr)
      return NextResponse.json(
        { success: false, error: '精修结果保存失败' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      content: result.content,
      self_grade: result.self_grade,
      meta: result.meta,
      trend_summary: result.trend_summary,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[prescription/refine] ERROR:', { message, stack, err })
    return NextResponse.json(
      { success: false, error: message, stage: 'refine' },
      { status: 500 },
    )
  }
}
