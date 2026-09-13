/**
 * GET/POST /api/cron/ad-entity-snapshot
 *
 * 每 3 小时把所有在管客户的 Meta 广告设置（账户/系列/广告组/广告/受众）抓一遍，
 * **只在设置变化时记一行，另每天一次**（ads IMPACT 设计 §2.1 / §14 M1）。
 *
 * 为什么每 3 小时而不是每天一次：一天中途改预算/受众（例 CTS 2026-09-13 12:11 UTC
 * 顶层 ThruPlay 组 $60→$10），按天一次会把「那天用的是哪套设置」记错。
 * 仍有盲区：3 小时内改了又改回，看不到——Check 段用两次快照的时间间隔标可比性。
 *
 * 🔴 只读 Meta。共用账户只写账户级（§14 M9）。
 * 🔴 尊重广告策略引擎的客户开关（ad_strategy_configs.enabled=false 的客户跳过）。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}   （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}          （人手补跑）
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { getActiveClientsWithMetaAccounts, getClientAdAccountIds } from '@/lib/meta/client-ad-accounts'
import { loadAdStrategyConfigWithSource } from '@/lib/ads-strategy/config'
import { captureClientSnapshots, type ClientSnapshotResult } from '@/lib/ads-strategy/portfolio/snapshot-sync'

export const maxDuration = 600

async function run(): Promise<NextResponse> {
  const cronRun = await startCronRun('ad-entity-snapshot')

  let clients
  try {
    clients = await getActiveClientsWithMetaAccounts(supabaseAdmin)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const results: Array<ClientSnapshotResult | { client_id: string; skipped: 'engine_disabled' }> = []
  for (const client of clients) {
    const { config, source } = await loadAdStrategyConfigWithSource(client.id)
    if (source === 'row' && !config.enabled) {
      results.push({ client_id: client.id, skipped: 'engine_disabled' })
      continue
    }
    const accountIds = await getClientAdAccountIds(client.id)
    results.push(await captureClientSnapshots(client.id, accountIds))
  }

  const captured = results.filter((r): r is ClientSnapshotResult => 'accounts' in r)
  const failed = captured.filter(r => !r.success).length
  const rowsWritten = captured.reduce((n, r) => n + r.accounts.reduce((m, a) => m + a.rows_written, 0), 0)
  const errors = captured.flatMap(r => [
    ...(r.error ? [{ client_id: r.client_id, error: r.error }] : []),
    ...r.accounts.flatMap(a => a.skipped_levels.map(s => ({
      client_id: r.client_id,
      error: `[${a.ad_account_id}] ${s.level}: ${s.error}`,
    }))),
  ])

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    error: failed > 0 && errors[0] ? `${errors[0].error}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}` : undefined,
    summary: { rows_written: rowsWritten, results },
  })
  return NextResponse.json({ ok: true, clients: results.length, rows_written: rowsWritten, failed, results })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}
