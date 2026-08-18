/**
 * GET /api/cron/goal-current-value-refresh
 *
 * A2.1-γ daily cron — refresh all active Goals' current_value column
 * by calling autoFetchMetricValue(goal.primary_metric_key).
 *
 * Schedule: 03:00 UTC daily (Render cron) — after the 02:30 UTC
 * industry-ai-visibility-daily cron, so ai_visibility_score reads
 * today's snapshots (not yesterday's).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Returns: { processed, succeeded, failed, errors: [...] }
 *
 * Spec: docs/superpowers/specs/2026-06-04-a21-stepc-design-v3.md
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { autoFetchMetricValue } from '@/lib/strategy/auto-fetch'
import { startCronRun } from '@/lib/cron/run-logger'

export const maxDuration = 300 // 5 min — generous; cron typically completes <60s

interface GoalRow {
  id: string
  client_id: string
  primary_metric_key: string
  current_value: number | null
}

interface CronResult {
  processed: number
  succeeded: number
  failed: number
  // Metrics whose auto source was intentionally removed (e.g. ai_visibility_score
  // after the ai-tracker decommission, 组 R). NOT failures — counted separately so
  // they don't inflate `failed` / trip cron-health alarms.
  severed: number
  errors: Array<{ goal_id: string; reason: string }>
  duration_ms: number
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now()

  // ── Auth ────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('goal-current-value-refresh')

  // ── Load active goals ───────────────────────────────────────────────────
  const goalsRes = await supabaseAdmin
    .from('goals')
    .select('id, client_id, primary_metric_key, current_value')
    .eq('status', 'active')

  const allGoals = (goalsRes as { data: GoalRow[] | null }).data ?? []

  // 真客户闸门：周期性监测只对 active 客户跑（DataForSEO 计划 阶段 0）。
  // autoFetchMetricValue 有 DataForSEO live 直调路径，调研档案的 goal 不刷。
  let goals: GoalRow[] = []
  if (allGoals.length > 0) {
    const clientIds = Array.from(new Set(allGoals.map((g) => g.client_id)))
    const { data: activeClients, error: activeErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .in('id', clientIds)
      .eq('client_status', 'active')

    if (activeErr) {
      await cronRun.finish({ failed: 1, error: activeErr.message })
      return NextResponse.json(
        { error: `Failed to filter active clients: ${activeErr.message}` },
        { status: 500 },
      )
    }

    const activeIds = new Set(((activeClients ?? []) as Array<{ id: string }>).map((c) => c.id))
    goals = allGoals.filter((g) => activeIds.has(g.client_id))
  }

  if (goals.length === 0) {
    const result: CronResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      severed: 0,
      errors: [],
      duration_ms: Date.now() - startedAt,
    }
    console.log('[goal-current-value-refresh]', result)
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json(result)
  }

  // ── Process each goal independently (per-goal try/catch) ────────────────
  let succeeded = 0
  let failed = 0
  let severed = 0
  const errors: Array<{ goal_id: string; reason: string }> = []

  for (const goal of goals) {
    try {
      const result = await autoFetchMetricValue(
        supabaseAdmin as any,
        goal.client_id,
        goal.primary_metric_key,
      )

      if (!result.ok) {
        if (result.severed) {
          // Auto source intentionally removed (组 R). Not a failure. Clear any
          // stale current_value (the old industry-average masquerade) so the Goal
          // shows an honest empty rather than a frozen wrong number. Idempotent:
          // only writes when a stale value is actually present.
          severed++
          if (goal.current_value !== null) {
            await supabaseAdmin
              .from('goals')
              .update({
                current_value: null,
                current_value_fetched_at: new Date().toISOString(),
                current_value_source: 'auto.cron.severed',
              })
              .eq('id', goal.id)
          }
          continue
        }
        failed++
        errors.push({ goal_id: goal.id, reason: result.reason })
        continue
      }

      // UPDATE current_value (last-write-wins; race guard via fetched_at order)
      const nowIso = new Date().toISOString()
      const updRes = await supabaseAdmin
        .from('goals')
        .update({
          current_value: result.value,
          current_value_fetched_at: nowIso,
          current_value_source: 'auto.cron',
        })
        .eq('id', goal.id)

      const updErr = (updRes as { error: { message: string } | null }).error
      if (updErr) {
        failed++
        errors.push({ goal_id: goal.id, reason: `DB UPDATE failed: ${updErr.message}` })
      } else {
        succeeded++
      }
    } catch (err) {
      failed++
      errors.push({
        goal_id: goal.id,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const result: CronResult = {
    processed: goals.length,
    succeeded,
    failed,
    severed,
    errors,
    duration_ms: Date.now() - startedAt,
  }
  console.log('[goal-current-value-refresh]', JSON.stringify(result))
  await cronRun.finish({ processed: goals.length, completed: succeeded, failed })
  return NextResponse.json(result)
}
