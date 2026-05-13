/**
 * POST /api/clients/[id]/prescription/generate
 *
 * **异步模式**（P8.10.S3 修复 Render 100s 请求超时）：
 *   1. 校验输入 + discovery
 *   2. 立即插入一行 status='generating' 的处方草稿，返回 prescription_id
 *   3. 后台 fire-and-forget 执行华佗 agent
 *   4. 完成后 UPDATE 处方记录（status='draft' + content + self_grade）
 *   5. 失败时 UPDATE status='failed' + error_message
 *
 * 前端：拿到 prescription_id 后轮询 GET /prescription/[pId]，直到
 * status !== 'generating'。
 *
 * Body: {
 *   run_id?:       string   — diagnostic run（legacy）
 *   discovery_id?: string   — Zhangqian discovery（华佗主路径）
 *   intake:        PrescriptionIntake
 * }
 *
 * Returns: { success, prescription_id, status: 'generating' }   HTTP 202
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { generatePrescription } from '@/lib/diagnostic/prescription-generator'
import { runHuatuo } from '@/lib/huatuo/agent'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

// 入站请求本身只需要几秒（DB insert + dispatch background）
export const maxDuration = 30

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params
    const body = (await req.json()) as {
      run_id?: string
      discovery_id?: string
      intake?: PrescriptionIntake
    }

    if (!body.intake) {
      return NextResponse.json({ success: false, error: 'intake is required' }, { status: 400 })
    }
    const { intake } = body
    if (!intake.business_goal || typeof intake.monthly_budget_aud !== 'number') {
      return NextResponse.json(
        { success: false, error: 'intake must include business_goal and monthly_budget_aud' },
        { status: 400 },
      )
    }

    // ── Path A: 华佗（Zhangqian discovery 源，异步）────────────────────────
    if (body.discovery_id) {
      const { data: row, error: discErr } = await supabaseAdmin
        .from('client_discovery')
        .select('id, payload, confirmed_at')
        .eq('id', body.discovery_id)
        .eq('client_id', clientId)
        .single<{ id: string; payload: DiscoveryReport; confirmed_at: string | null }>()

      if (discErr || !row) {
        return NextResponse.json({ success: false, error: 'Discovery not found' }, { status: 404 })
      }
      if (!row.confirmed_at) {
        return NextResponse.json(
          { success: false, error: 'Discovery must be confirmed before generating a prescription' },
          { status: 422 },
        )
      }

      // 立即插入 generating 行
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('prescriptions')
        .insert({
          client_id:     clientId,
          discovery_id:  row.id,
          run_id:        null,
          status:        'generating',
          intake,
          content:       null,
          agent_name:    'huatuo',
          progress_note: '排队中…',
          generated_at:  new Date().toISOString(),
        })
        .select('id')
        .single<{ id: string }>()

      if (insertErr || !inserted) {
        console.error('[prescription/generate] insert generating row failed', insertErr)
        return NextResponse.json(
          { success: false, error: 'Failed to create prescription draft' },
          { status: 500 },
        )
      }

      // Fire-and-forget 后台执行
      void executeHuatuoAsync(inserted.id, clientId, row.payload, intake).catch(err => {
        console.error('[huatuo/async] uncaught', err)
      })

      return NextResponse.json(
        { success: true, prescription_id: inserted.id, status: 'generating' },
        { status: 202 },
      )
    }

    // ── Path B: legacy diagnostic run（同步保留）────────────────────────────
    if (body.run_id) {
      const { data: run, error: runError } = await supabaseAdmin
        .from('diagnostic_runs')
        .select('id, status')
        .eq('id', body.run_id)
        .eq('client_id', clientId)
        .single()
      if (runError || !run) {
        return NextResponse.json({ success: false, error: 'Diagnostic run not found' }, { status: 404 })
      }
      const { prescriptionId, content } = await generatePrescription(
        supabaseAdmin, body.run_id, clientId, intake,
      )
      return NextResponse.json({ success: true, prescription_id: prescriptionId, content })
    }

    return NextResponse.json(
      { success: false, error: 'Either run_id or discovery_id is required' },
      { status: 400 },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[prescription/generate] ERROR:', { message, stack, err })
    return NextResponse.json(
      { success: false, error: message, stage: 'generate-dispatch' },
      { status: 500 },
    )
  }
}

// ─── Background async executor ────────────────────────────────────────────────

async function executeHuatuoAsync(
  prescriptionId: string,
  clientId: string,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
): Promise<void> {
  try {
    const result = await runHuatuo(supabaseAdmin, discovery, intake, {
      onProgress: async (note) => {
        await supabaseAdmin
          .from('prescriptions')
          .update({ progress_note: note })
          .eq('id', prescriptionId)
          .eq('client_id', clientId)
      },
    })

    // 成功 → 写回 draft 状态 + 完整内容
    await supabaseAdmin
      .from('prescriptions')
      .update({
        status:          'draft',
        content:         result.content,
        self_grade:      result.self_grade,
        agent_version:   result.meta.agent_version,
        benchmarks_used: result.benchmarks_used,
        generation_meta: { ...result.meta, trend_summary: result.trend_summary },
        progress_note:   null,
        error_message:   null,
      })
      .eq('id', prescriptionId)
      .eq('client_id', clientId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[huatuo/async] failed', { prescriptionId, message, err })

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
