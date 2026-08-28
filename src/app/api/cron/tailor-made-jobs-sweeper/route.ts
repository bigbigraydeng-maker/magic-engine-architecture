/**
 * GET /api/cron/tailor-made-jobs-sweeper
 *
 * Mark stuck tailor_made_jobs rows as failed.
 *
 * Background:
 *   POST /tailor-made/import 和 /tailor-made/extract 建完任务行就立刻回
 *   202，真正跑 AI 的活儿走 `void runXxxJob(...)`（fire-and-forget，见
 *   src/lib/tailor-made/jobs.ts）。如果 Render 在任务跑到一半时重启进程
 *   （部署新版本 / 内存超限被杀），这一行会永远停在 queued/running——跟
 *   同类的 blog-stuck-generating sweeper 是同一个模式、同一个成因。
 *
 *   getJob() 和 createOrReuseJob() 已经各自带了惰性自愈（被轮询到或被
 *   同一份行程再次建任务时会自动纠正），这个 cron 只是兜底：如果一个
 *   卡住的任务从此没人再碰它（用户关掉标签页不再回来），也能被清理掉，
 *   而不是无限期挂着。
 *
 * Schedule: every 30 minutes via render.yaml.
 * Auth: Bearer CRON_SECRET（跟同类 cron 一致）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'

// 跟 src/lib/tailor-made/jobs.ts 的 STALE_MS 对齐
const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000
const STUCK_MESSAGE = '任务卡住了，很可能是服务重启导致没跑完。请重新提交一次'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('tailor-made-jobs-sweeper')

  const cutoffIso = new Date(Date.now() - STALE_JOB_TIMEOUT_MS).toISOString()

  const { data: stuck, error: selectErr } = await supabaseAdmin
    .from('tailor_made_jobs')
    .select('id, client_id, itinerary_id, kind, created_at')
    .in('status', ['queued', 'running'])
    .lt('created_at', cutoffIso)

  if (selectErr) {
    console.error('[tailor-made-jobs-sweeper] select failed', selectErr)
    await cronRun.finish({ failed: 1, error: selectErr.message })
    return NextResponse.json({ swept: 0, error: selectErr.message }, { status: 500 })
  }

  if (!stuck || stuck.length === 0) {
    await cronRun.finish({ processed: 0, completed: 0, failed: 0 })
    return NextResponse.json({ swept: 0, ids: [] })
  }

  const ids = stuck.map((r) => (r as { id: string }).id)

  const { error: updateErr } = await supabaseAdmin
    .from('tailor_made_jobs')
    .update({ status: 'failed', error: STUCK_MESSAGE, completed_at: new Date().toISOString() })
    .in('id', ids)

  if (updateErr) {
    console.error('[tailor-made-jobs-sweeper] update failed', updateErr)
    await cronRun.finish({ failed: 1, error: updateErr.message })
    return NextResponse.json({ swept: 0, error: updateErr.message }, { status: 500 })
  }

  console.log(`[tailor-made-jobs-sweeper] marked ${ids.length} stuck job(s) failed`, ids)
  await cronRun.finish({ processed: ids.length, completed: ids.length, failed: 0, summary: { swept: ids.length } })
  return NextResponse.json({
    swept: ids.length,
    ids,
    rows: stuck.map((r) => {
      const row = r as { id: string; client_id: string; itinerary_id: string; kind: string; created_at: string }
      return { ...row, age_ms: Date.now() - new Date(row.created_at).getTime() }
    }),
  })
}
