/**
 * POST /api/clients/[id]/prescription/[pId]/refine
 *
 * 让华佗对已生成的处方做一次精修（异步）。
 *
 * 流程（与 /generate 一致的异步模式）：
 *   1. 校验：草稿状态 + 华佗生成 + 有 discovery + 有 weaknesses
 *   2. 立即把处方状态改为 'generating' + progress_note，返回 202
 *   3. 后台 fire-and-forget 执行 refineHuatuoPrescription
 *   4. 完成后写回 content/self_grade/meta；失败写 status='failed' + error_message
 *
 * 前端：202 返回后继续轮询 GET /prescription/[pId]。
 *
 * 已批准的处方返回 409。
 *
 * Body: {}
 * Returns: { success, status: 'generating' }   HTTP 202
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

export const maxDuration = 30

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

    // 1. 加载 + 校验
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
      return NextResponse.json({ success: false, error: '处方已批准，无法再次精修' }, { status: 409 })
    }
    if (presc.status === 'generating') {
      return NextResponse.json({ success: false, error: '处方正在生成中，请稍后再试' }, { status: 409 })
    }
    if (presc.agent_name !== 'huatuo') {
      return NextResponse.json({ success: false, error: '只有华佗生成的处方支持精修' }, { status: 422 })
    }
    if (!presc.discovery_id || !presc.intake || !presc.content) {
      return NextResponse.json(
        { success: false, error: '处方数据不完整（缺 discovery / intake / content）' },
        { status: 422 },
      )
    }

    const previousWeaknesses = presc.self_grade?.weaknesses ?? []
    if (previousWeaknesses.length === 0) {
      return NextResponse.json(
        { success: false, error: '上一轮无明确薄弱点，无需精修' },
        { status: 422 },
      )
    }

    // 2. 加载源 discovery
    const { data: disc, error: dErr } = await supabaseAdmin
      .from('client_discovery')
      .select('id, payload, confirmed_at')
      .eq('id', presc.discovery_id)
      .eq('client_id', clientId)
      .single<DiscoveryRow>()

    if (dErr || !disc) {
      return NextResponse.json({ success: false, error: '源发现报告不存在' }, { status: 404 })
    }

    // 3. 立即更新状态为 generating + progress
    await supabaseAdmin
      .from('prescriptions')
      .update({ status: 'generating', progress_note: '排队精修中…', error_message: null })
      .eq('id', pId)
      .eq('client_id', clientId)

    // 4. Fire-and-forget 后台执行
    void executeRefineAsync(
      pId, clientId, disc.payload, presc.intake, presc.content, previousWeaknesses,
    ).catch(err => console.error('[huatuo/refine-async] uncaught', err))

    return NextResponse.json(
      { success: true, prescription_id: pId, status: 'generating' },
      { status: 202 },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[prescription/refine] ERROR:', { message, err })
    return NextResponse.json(
      { success: false, error: message, stage: 'refine-dispatch' },
      { status: 500 },
    )
  }
}

// ─── Background async executor ────────────────────────────────────────────────

async function executeRefineAsync(
  prescriptionId: string,
  clientId: string,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  previousContent: PrescriptionContent,
  previousWeaknesses: string[],
): Promise<void> {
  try {
    const result = await refineHuatuoPrescription(
      supabaseAdmin, discovery, intake, previousContent, previousWeaknesses,
      {
        onProgress: async (note) => {
          await supabaseAdmin
            .from('prescriptions')
            .update({ progress_note: note })
            .eq('id', prescriptionId)
            .eq('client_id', clientId)
        },
      },
    )

    await supabaseAdmin
      .from('prescriptions')
      .update({
        status:          'draft',
        content:         result.content,
        self_grade:      result.self_grade,
        generation_meta: { ...result.meta, trend_summary: result.trend_summary },
        progress_note:   null,
        error_message:   null,
      })
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[huatuo/refine-async] failed', { prescriptionId, message })

    await supabaseAdmin
      .from('prescriptions')
      .update({
        status:        'failed',
        error_message: message,
        progress_note: null,
      })
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
  }
}
