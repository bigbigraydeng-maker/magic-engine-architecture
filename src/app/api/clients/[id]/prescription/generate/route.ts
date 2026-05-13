/**
 * POST /api/clients/[id]/prescription/generate
 *
 * **流式响应模式** (P8.10.S3 修复 Render 进程回收问题)
 *
 * 之前用 fire-and-forget 后台任务，但 Render serverless 在 HTTP 响应返回后
 * 会回收 Node 进程，导致 Promise 被杀。
 *
 * 解决方案：HTTP 连接保持开启直到任务完成。响应体是 SSE 流：
 *   - 每 8 秒发心跳 `: heartbeat\n\n` 防止任何代理超时
 *   - 进度更新：`data: {"type":"progress","note":"..."}\n\n`
 *   - 完成：`data: {"type":"done","prescription_id":"...","content":...,...}\n\n`
 *   - 失败：`data: {"type":"error","error":"..."}\n\n`
 *
 * 连接保持开启 → Render 不会杀进程 → 华佗能完整执行。
 *
 * Body: {
 *   discovery_id?: string   — Zhangqian discovery（华佗主路径）
 *   run_id?:       string   — diagnostic run（legacy）
 *   intake:        PrescriptionIntake
 * }
 *
 * Response: text/event-stream（SSE）
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S3
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { generatePrescription } from '@/lib/diagnostic/prescription-generator'
import { runHuatuo } from '@/lib/huatuo/agent'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

// 关键：禁用 Next.js 缓存
export const dynamic = 'force-dynamic'
export const revalidate = 0

// 流式响应不受 maxDuration 普通约束；Render 上保持连接活的请求可以跑很久。
export const maxDuration = 300

const HEARTBEAT_INTERVAL_MS = 8_000

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return new Response(JSON.stringify({ success: false, error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { id: clientId } = params

  // ── 同步校验 body 和源数据（这部分快，不需要流式）─────────────────────────
  let body: { run_id?: string; discovery_id?: string; intake?: PrescriptionIntake }
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'invalid JSON body')
  }
  if (!body.intake) return errorResponse(400, 'intake is required')
  const intake = body.intake
  if (!intake.business_goal || typeof intake.monthly_budget_aud !== 'number') {
    return errorResponse(400, 'intake must include business_goal and monthly_budget_aud')
  }

  // ── Path A: 华佗（discovery 源）─ 流式 ──────────────────────────────────
  if (body.discovery_id) {
    const { data: row, error: discErr } = await supabaseAdmin
      .from('client_discovery')
      .select('id, payload, confirmed_at')
      .eq('id', body.discovery_id)
      .eq('client_id', clientId)
      .single<{ id: string; payload: DiscoveryReport; confirmed_at: string | null }>()

    if (discErr || !row) return errorResponse(404, 'Discovery not found')
    if (!row.confirmed_at) {
      return errorResponse(422, 'Discovery must be confirmed before generating a prescription')
    }

    return new Response(makeHuatuoStream(clientId, row.id, row.payload, intake), {
      headers: streamHeaders(),
    })
  }

  // ── Path B: legacy diagnostic run（同步小路径，输出量小不需要流）────────
  if (body.run_id) {
    try {
      const { data: run, error: runError } = await supabaseAdmin
        .from('diagnostic_runs')
        .select('id, status')
        .eq('id', body.run_id)
        .eq('client_id', clientId)
        .single()
      if (runError || !run) return errorResponse(404, 'Diagnostic run not found')
      const { prescriptionId, content } = await generatePrescription(
        supabaseAdmin, body.run_id, clientId, intake,
      )
      return new Response(JSON.stringify({ success: true, prescription_id: prescriptionId, content }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return errorResponse(500, message)
    }
  }

  return errorResponse(400, 'Either run_id or discovery_id is required')
}

// ─── SSE Stream builder ───────────────────────────────────────────────────────

function streamHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',     // 禁用 nginx buffering，确保即时刷出
  }
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeHuatuoStream(
  clientId: string,
  discoveryId: string,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // 心跳 — 防止任何中间代理（nginx / cloudflare）因为 idle 杀连接
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch {/* */}
      }, HEARTBEAT_INTERVAL_MS)

      const sendEvent = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {/* connection closed */}
      }

      // 1. 先插入 generating 行（拿到 prescription_id 告诉前端）
      let prescriptionId: string | null = null
      try {
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from('prescriptions')
          .insert({
            client_id:     clientId,
            discovery_id:  discoveryId,
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
          sendEvent({ type: 'error', error: `创建处方草稿失败: ${insertErr?.message ?? 'unknown'}` })
          clearInterval(heartbeat)
          controller.close()
          return
        }
        prescriptionId = inserted.id
        sendEvent({ type: 'started', prescription_id: prescriptionId })
      } catch (err) {
        sendEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) })
        clearInterval(heartbeat)
        controller.close()
        return
      }

      // 2. 执行华佗（连接保持开启 → 进程不会被杀）
      try {
        const result = await runHuatuo(supabaseAdmin, discovery, intake, {
          onProgress: async (note) => {
            sendEvent({ type: 'progress', note })
            // 也写到 DB 一份，方便用户刷新页面后看到历史
            if (prescriptionId) {
              await supabaseAdmin
                .from('prescriptions')
                .update({ progress_note: note })
                .eq('id', prescriptionId)
                .eq('client_id', clientId)
            }
          },
        })

        // 3. 写回 DB
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
          .eq('id', prescriptionId!)
          .eq('client_id', clientId)

        // 4. 通过流发完整结果给前端（避免前端还要二次拉）
        sendEvent({
          type: 'done',
          prescription_id: prescriptionId,
          content: result.content,
          self_grade: result.self_grade,
          meta: result.meta,
          trend_summary: result.trend_summary,
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[huatuo/stream] failed', { prescriptionId, message })

        if (prescriptionId) {
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
        sendEvent({ type: 'error', error: message })
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })
}
