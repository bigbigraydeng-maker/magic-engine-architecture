/**
 * GET/POST /api/cron/product-map-sync — ME2 Product Map 每日全量对账。
 *
 * webhook 是主信号,这条 cron 是兜底:补漏掉的投递、扫未分类工作、
 * 清理 90 天前的 deliveries、统计 webhook error runs 进 summary。
 *
 * 🔴 表未 apply(本 PR 不执行 migration)时必须 finish({ error }) 让
 *    cron-health 面板变红 —— not_provisioned 返回 200 却记 completed
 *    会把「这条 cron 从上线起什么都没干」显示成健康(静默失败铁律)。
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import {
  GithubRestProvider,
  NotProvisionedError,
  SupabaseSyncStore,
  runFullSync,
} from '@/lib/product-map-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = request.headers.get('Authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET || !auth || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('product-map-sync')

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    await cronRun.finish({ error: 'GITHUB_TOKEN 未配置 —— 同步无法运行' })
    return NextResponse.json({ status: 'failed', reason: 'GITHUB_TOKEN 未配置' }, { status: 500 })
  }

  try {
    const result = await runFullSync(
      {
        provider: new GithubRestProvider({ token }),
        store: new SupabaseSyncStore(supabaseAdmin),
        newRunId: () => randomUUID(),
        now: () => new Date().toISOString(),
      },
      'cron',
    )
    await cronRun.finish({
      processed: result.stats.prsSynced + result.stats.issuesSynced,
      completed: result.status === 'ok' ? 1 : 0,
      failed: result.status === 'error' ? 1 : 0,
      summary: {
        run_id: result.runId,
        status: result.status,
        ...result.stats,
      },
      error: result.status === 'error' ? '同步以 error 结束,详见 product_map_sync_runs' : undefined,
    })
    return NextResponse.json({ status: result.status, run_id: result.runId, stats: result.stats })
  } catch (err) {
    if (err instanceof NotProvisionedError) {
      // 🙋 需要 PO 动手:apply supabase/migrations/20260815000001_product_map_sync_v1.sql,
      // 然后跑一次 /api/admin/product-map/refresh 做 canary。
      await cronRun.finish({ error: `not_provisioned:${err.message} —— 待 apply 同步表 migration` })
      return NextResponse.json({ status: 'not_provisioned', detail: err.message })
    }
    const message = err instanceof Error ? err.message : 'unknown'
    await cronRun.finish({ error: message })
    return NextResponse.json({ status: 'failed', reason: message }, { status: 500 })
  }
}

export const POST = GET
