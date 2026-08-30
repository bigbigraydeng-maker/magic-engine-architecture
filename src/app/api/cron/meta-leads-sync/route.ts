/**
 * GET/POST /api/cron/meta-leads-sync
 *
 * 每小时把 Facebook 即时表单里的新人搬进 CRM。
 *
 * 在这之前这条路**只有人手一条**：导 CSV → 跑 `scripts/import-cts-fb-leads.ts`。
 * 2026-07-30 查 CTS 的实测后果：CRM 里最后一个新人停在 7/25，Meta 后台 7/26–7/30
 * 又进了 27 个人，销售的「今天该联系谁」里一个都没有。这个 cron 就是把那条断掉的
 * 管道接上。
 *
 * 开关：`clients.facebook_page_id` 有值的客户才同步（跟私信同步同一个开关）。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}   （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}          （人手补跑）
 *
 * ⚠️ 这个 cron 在 Render 上必须 link `me-shared-cron-secret` 环境变量组，否则每次
 *    401 静默失败 —— 上一个踩这个坑的 cron 哑了 51 天，`daily-cron-digest` 只报
 *    「失败」不报「没跑」。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncClientMetaLeads, type MetaLeadsSyncClient } from '@/lib/meta/leads-sync'
import { startCronRun } from '@/lib/cron/run-logger'

// 一个客户可能有多个表单，每个表单还要翻页；给足时间。
export const maxDuration = 600

/**
 * 把每个客户的失败原因压成一行,给 `cron_run_logs.error_message`。
 *
 * 日报邮件只截前 200 字符,所以**先说有多少家挂了,再说错在哪** —— 同一把令牌
 * 失效时 N 家的报错是同一句,按原文去重能让这 200 字符装下真正不同的病因,
 * 而不是同一句话重复四遍。
 *
 * 全好时返回 undefined,`finish()` 就仍把这次跑标成 completed。
 */
export function summariseFailures(results: readonly { clientName: string; error?: string }[]): string | undefined {
  const failures = results.filter((r) => r.error)
  if (failures.length === 0) return undefined

  const byReason = new Map<string, string[]>()
  for (const f of failures) {
    const reason = (f.error ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const names = byReason.get(reason) ?? []
    names.push(f.clientName)
    byReason.set(reason, names)
  }

  const parts = [...byReason].map(([reason, names]) => `${names.join('/')}: ${reason}`)
  return `${failures.length}/${results.length} 个客户取不到线索 — ${parts.join(' ‖ ')}`
}

async function run(): Promise<NextResponse> {
  const cronRun = await startCronRun('meta-leads-sync')

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, facebook_page_id, country, semrush_db')
    .not('facebook_page_id', 'is', null)

  if (error) {
    await cronRun.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = []
  for (const client of (clients ?? []) as MetaLeadsSyncClient[]) {
    // syncClientMetaLeads 自己吞异常，这层 try 给它之外的意外兜底：
    // 一个客户炸掉不能让其它客户今天都不同步。
    try {
      results.push(await syncClientMetaLeads(client))
    } catch (err) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        forms: 0,
        leadsFetched: 0,
        leadsIngested: 0,
        newContacts: 0,
        skippedNoIdentity: 0,
        failed: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const newContacts = results.reduce((n, r) => n + r.newContacts, 0)
  const leadsIngested = results.reduce((n, r) => n + r.leadsIngested, 0)
  const failed = results.filter((r) => r.error).length

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { newContacts, leadsIngested, results },
    // 有客户取不到数就必须把原话带进 error_message —— 日报邮件的「错误原因」列
    // 读的就是这个字段。2026-08-21~08-30 这里一直是 null,于是日报每天照发
    // 「meta-leads-sync 4 failed —」,一屏破折号没有一个字说明是什么事,
    // 9 天没人看得懂,4 个客户的线索管道全程断供(CTS 一家漏 45 条、NZ$736)。
    // 真正的报错当时就躺在 summary 里,只是没人把它搬到人看得见的地方。
    error: summariseFailures(results),
  })

  return NextResponse.json({
    ok: true,
    clients: results.length,
    newContacts,
    leadsIngested,
    results,
  })
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
