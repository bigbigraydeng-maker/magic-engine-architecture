/**
 * POST /api/admin/prospecting/discovery-upgrade
 *
 * P35.14 pilot only. Runs the FULL 张骞 Discovery scan (~$0.57/prospect,
 * ~18 tool calls) for an explicit, admin-supplied list of prospect ids and
 * stores the result on `discovery_report` / `discovery_report_status`.
 *
 * Deliberately NOT wired into `prospecting-sweep` (src/lib/prospecting/pipeline.ts
 * is untouched by this route) — the cron only ever runs the cheap short-mode
 * analyze via `analyzeBatch`. This route is the ONLY code path that can
 * trigger a full scan, and it only runs for ids explicitly passed in, never
 * a "next N qualified" auto-pull. That is the code-level spend gate the
 * P35.14 design review asked for (子牙/魏征): "small pilot batch" is a
 * structural fact, not a comment someone has to remember to honour.
 *
 * Reference: docs/specs/2026-08-24-report-page-discovery-upgrade-design.md §5
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { runZhangqian } from '@/lib/zhangqian/agent'

// One request stays well inside the pilot's 30-prospect ceiling; admins call
// this multiple times for a larger batch rather than one call fanning out
// unboundedly. Each scan can take well over a minute (18 tool calls), so a
// generous per-request cap would risk the route itself timing out.
const MAX_IDS_PER_REQUEST = 10

// Cross-request daily ceiling — the design review (魏征) flagged that a
// per-request cap alone relies on a human remembering not to call this route
// too many times in a day. This mirrors the same 24h-count-back pattern
// prospecting-sweep uses for its own AI-spend cap (DAILY_ANALYZE_CAP), sized
// to match the PM-approved pilot batch (18 闽商 + 12 follow-up qualified —
// see design doc §5) rather than an arbitrary number.
const DAILY_DISCOVERY_CAP = 30

// Statuses a claim may start from. 'truncated' is included deliberately —
// without it, a truncated run could never be retried and would be stuck
// forever (a real bug found in the P35.14 implementation review: the first
// version's allowlist omitted it).
const CLAIMABLE_STATUSES = ['not_run', 'failed', 'truncated'] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ProspectRow {
  id:     string
  domain: string | null
  discovery_report_status: string | null
}

/**
 * How many prospects have had a discovery scan attempted (any terminal
 * status) in the last 24h. PostgREST's `in.()` filter never matches NULL
 * (SQL `NULL IN (...)` is NULL, not TRUE — the same trap the claim query
 * below works around with `.or()`), so "attempted" is read as
 * "status is not null", not by listing statuses.
 */
async function discoveryAttemptsLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id', { count: 'exact', head: true })
    .not('discovery_report_status', 'is', null)
    .gte('updated_at', since)
  return count ?? 0
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI 分析引擎未配置(缺少环境变量)' }, { status: 400 })
  }

  const body = await req.json().catch(() => null) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
  if (ids.length === 0) {
    return NextResponse.json({ error: '需要传入 ids 数组(prospect UUID 列表)' }, { status: 400 })
  }
  if (ids.some(id => !UUID_RE.test(id))) {
    return NextResponse.json({ error: 'ids 里有不是合法 UUID 的值' }, { status: 400 })
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      { error: `一次最多 ${MAX_IDS_PER_REQUEST} 条,分多次调用(小范围试点是这个接口存在的唯一理由)` },
      { status: 400 },
    )
  }

  const attemptsToday = await discoveryAttemptsLast24h()
  if (attemptsToday >= DAILY_DISCOVERY_CAP) {
    return NextResponse.json(
      { error: `过去 24 小时已跑 ${attemptsToday} 家,达到试点每日上限 ${DAILY_DISCOVERY_CAP} 家,明天再跑或找 PM 调整上限` },
      { status: 429 },
    )
  }
  // Trim the batch rather than reject it outright — a request that pushes
  // past the remaining headroom still does the part that fits.
  const allowed = ids.slice(0, Math.max(0, DAILY_DISCOVERY_CAP - attemptsToday))

  const { data: rows, error } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id, domain, discovery_report_status')
    .in('id', allowed)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ id: string; status: string; cost_usd?: number; error?: string }> = []
  for (const id of ids) {
    if (!allowed.includes(id)) results.push({ id, status: 'skipped', error: 'daily cap reached mid-request' })
  }

  for (const prospect of (rows ?? []) as ProspectRow[]) {
    if (!prospect.domain) {
      results.push({ id: prospect.id, status: 'skipped', error: 'no domain on this prospect' })
      continue
    }
    if (prospect.discovery_report_status === 'completed' || prospect.discovery_report_status === 'running') {
      results.push({ id: prospect.id, status: 'skipped', error: `already ${prospect.discovery_report_status}` })
      continue
    }

    // Optimistic claim before the paid call, mirroring the analyze route's
    // pattern — two concurrent admin clicks must not double-spend on the
    // same prospect. Uses `.or()` with an explicit `is.null` branch because
    // PostgREST's `in.()` never matches NULL (SQL `IN` semantics) — an
    // earlier version used `.in(col, [null, ...])`, which silently failed
    // to claim any prospect that had never been attempted before (i.e.
    // every prospect on its first call), found in the implementation review.
    const orFilter = ['discovery_report_status.is.null', ...CLAIMABLE_STATUSES.map(s => `discovery_report_status.eq.${s}`)].join(',')
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('outbound_prospects')
      .update({ discovery_report_status: 'running', updated_at: new Date().toISOString() })
      .eq('id', prospect.id)
      .or(orFilter)
      .select('id')
    // Two DIFFERENT reasons the claim can come back empty, and conflating
    // them was itself a real bug found running the P35.14 pilot: a genuine
    // race (claimed.length === 0, no error) is harmless and expected, but
    // claimError means the update call itself failed (network/DB hiccup) —
    // reporting that as "claimed by a concurrent run" hides a real retry-able
    // failure behind a message that looks like nothing went wrong.
    if (claimError) {
      results.push({ id: prospect.id, status: 'failed', error: `claim query failed: ${claimError.message}` })
      continue
    }
    if (!claimed || claimed.length === 0) {
      results.push({ id: prospect.id, status: 'skipped', error: 'claimed by a concurrent run' })
      continue
    }

    try {
      const { report, validation_error } = await runZhangqian(prospect.domain)
      const status = validation_error ? 'failed' : report.meta.truncated ? 'truncated' : 'completed'
      await supabaseAdmin
        .from('outbound_prospects')
        .update({
          discovery_report: report,
          discovery_report_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', prospect.id)
      results.push({ id: prospect.id, status, cost_usd: report.meta.cost_usd })
    } catch (err) {
      await supabaseAdmin
        .from('outbound_prospects')
        .update({ discovery_report_status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', prospect.id)
      results.push({ id: prospect.id, status: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({ results, daily_cap: DAILY_DISCOVERY_CAP, attempts_before_this_call: attemptsToday })
}
