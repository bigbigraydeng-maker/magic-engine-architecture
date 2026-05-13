/**
 * POST /api/clients/[id]/prescription/generate
 *
 * 处方生成入口。优先用「华佗 Agent」（基于张骞 discovery）；
 * 兼容旧 diagnostic_run 路径作为 fallback。
 *
 * Body: {
 *   discovery_id?: string   — Zhangqian discovery（华佗主路径）
 *   run_id?:       string   — diagnostic run（legacy，调旧 generator）
 *   intake:        PrescriptionIntake
 * }
 *
 * Returns: { success, prescription_id, content, self_grade?, meta? }
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

export const maxDuration = 120 // 华佗 多步可能跑 60-90s

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

    // ── Path A: 华佗（Zhangqian discovery 源）───────────────────────────────
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

      const result = await runHuatuo(supabaseAdmin, row.payload, intake)

      // Save prescription with 华佗 metadata
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('prescriptions')
        .insert({
          client_id:         clientId,
          discovery_id:      row.id,
          run_id:            null,
          status:            'draft',
          intake,
          content:           result.content,
          agent_name:        'huatuo',
          agent_version:     result.meta.agent_version,
          self_grade:        result.self_grade,
          benchmarks_used:   result.benchmarks_used,
          generation_meta:   { ...result.meta, trend_summary: result.trend_summary },
          generated_at:      new Date().toISOString(),
        })
        .select('id')
        .single<{ id: string }>()

      if (insertErr || !inserted) {
        console.error('[prescription/generate] huatuo save failed', insertErr)
        return NextResponse.json(
          { success: false, error: 'Failed to save prescription' },
          { status: 500 },
        )
      }

      return NextResponse.json({
        success: true,
        prescription_id: inserted.id,
        content: result.content,
        self_grade: result.self_grade,
        meta: result.meta,
        trend_summary: result.trend_summary,
      })
    }

    // ── Path B: legacy diagnostic run 源 ────────────────────────────────────
    if (body.run_id) {
      const { data: run, error: runError } = await supabaseAdmin
        .from('diagnostic_runs')
        .select('id, status')
        .eq('id', body.run_id)
        .eq('client_id', clientId)
        .single()
      if (runError || !run) {
        return NextResponse.json(
          { success: false, error: 'Diagnostic run not found' },
          { status: 404 },
        )
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
    // 详细日志：消息 + stack + cause（如有）
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[prescription/generate] ERROR:', { message, stack, err })
    return NextResponse.json(
      { success: false, error: message, stage: 'generate' },
      { status: 500 },
    )
  }
}
