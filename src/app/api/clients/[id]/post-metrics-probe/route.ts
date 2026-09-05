/**
 * Post metrics — permission probe (read-only, no writes anywhere).
 *
 * GET → answers one question with evidence: can this client's stored Page token
 * read reactions/comments/shares totals on one of their already-published
 * posts, using ONLY `pages_read_engagement`? No `read_insights`, no reauth,
 * no publish, no DB write.
 *
 * Backs the T+4 / T+72 measurement design
 * (docs/specs/2026-09-04-daily-plan-post-tplus-measurement.md): before the
 * consumer is built, we want field-by-field truth about what Meta returns for
 * this exact token — not a general "does the token look OK" check.
 *
 * ## 一个字段一个字段地看
 *
 * 单条 GET `/{post_id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares`
 * 可能返回：
 *
 *   - 三个都齐 → 设计直接落地（预期路径）
 *   - `reactions` / `comments` 少 `summary.total_count`（字段权限降级）→ 记 null
 *   - `shares` 缺席（Meta 对没有分享的帖子会省略这个字段）→ 记 0，不是 null
 *   - Graph 报 `error` (#200) 缺权限 / (#100) 帖子被删 / (#4) 限流 / 5xx / 网络挂 → 各归各类
 *
 * 探针把每种情况单独报出来，这样上游设计不用「两套预案」，可以按 Meta 的真实
 * 反馈把错误处理做成穷尽的。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getStoredPageToken } from '@/lib/meta/token-manager'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

export type FieldStatus =
  /** Meta 返回了 total_count / count，值就是数字。 */
  | { kind: 'ok'; value: number }
  /** Meta 返回了对象但没有 total_count/count（字段权限降级、或帖子里的可选字段确实缺席）。 */
  | { kind: 'field_absent'; raw: unknown }
  /** shares 对没有分享的帖子会直接省略这个字段。设计上算 0，探针也把这条独立报出来。 */
  | { kind: 'unshared_zero' }

export interface PostMetricsProbeResult {
  probe_run_at: string
  client_id: string
  page_id: string | null
  post_id: string
  page_token_resolved: boolean
  /** Graph 顶层错误 —— 有错误就没别的字段可看。 */
  graph_error: {
    code: number | null
    subcode: number | null
    type: string | null
    message: string
    /** 我们对这个错误的分类 —— 直接对齐消费者设计里的处理路径。 */
    classification:
      | 'permission_missing'   // #200 / #10  —— 永久，不重试
      | 'post_not_found'       // #100 / #803 —— 永久，不重试
      | 'rate_limited'         // #4 / #17 / #341 —— 退避重试
      | 'token_invalid'        // #190 —— 授权坏了，交给 auth 体检
      | 'server_error'         // 5xx —— 临时，重试
      | 'network_error'        // fetch 抛异常
      | 'other'                // 没归到上面任何一类
  } | null
  /** 三个字段的独立读数 —— 有 graph_error 时全部 null（没读到）。 */
  reactions: FieldStatus | null
  comments: FieldStatus | null
  shares: FieldStatus | null
  /**
   * 探针得出的结论 —— 上游设计据此决定。
   *   'all_ok'                 —— 三个字段都能读，无需其它改动
   *   'shares_missing_ok'      —— shares 因帖子未被分享而缺席，其余能读（正常情况）
   *   'permission_downgrade'   —— 某个字段返回对象但缺 total_count（少 pages_read_engagement 或权限被降级）
   *   'blocked'                —— 有 graph_error 且是永久失败（权限 / 帖子没了 / 令牌坏）
   *   'transient'              —— 5xx / 网络抖动 / 限流
   */
  verdict:
    | 'all_ok'
    | 'shares_missing_ok'
    | 'permission_downgrade'
    | 'blocked'
    | 'transient'
    | 'token_missing'
    | 'input_error'
  notes: string[]
}

/** 把 Graph 顶层 error 归到消费者设计要处理的具体一类。 */
export function classifyGraphError(err: {
  code?: unknown
  error_subcode?: unknown
  type?: unknown
  message?: unknown
}): PostMetricsProbeResult['graph_error'] {
  const code = typeof err.code === 'number' ? err.code : null
  const subcode = typeof err.error_subcode === 'number' ? err.error_subcode : null
  const type = typeof err.type === 'string' ? err.type : null
  const message = typeof err.message === 'string' ? err.message : String(err.message ?? 'unknown')

  let classification: PostMetricsProbeResult['graph_error'] extends infer T
    ? T extends { classification: infer C }
      ? C
      : never
    : never = 'other'

  if (code === 190) classification = 'token_invalid'
  else if (code === 200 || code === 10) classification = 'permission_missing'
  else if (code === 100 || code === 803) classification = 'post_not_found'
  else if (code === 4 || code === 17 || code === 341) classification = 'rate_limited'

  return { code, subcode, type, message, classification }
}

/**
 * 把 Meta 对一个 `.summary(true)` 字段的返回归成 FieldStatus。
 * 对 `shares` 走另一个分支（它没有 summary 包装，直接是 `{count: N}` 或省略）。
 */
export function readSummaryField(raw: unknown): FieldStatus {
  if (raw && typeof raw === 'object') {
    const summary = (raw as { summary?: { total_count?: unknown } }).summary
    if (summary && typeof summary === 'object' && typeof summary.total_count === 'number') {
      return { kind: 'ok', value: summary.total_count }
    }
    return { kind: 'field_absent', raw }
  }
  return { kind: 'field_absent', raw }
}

/** shares 没有 summary 包装；缺席时代表"零次分享"，跟"读不到"要分开。 */
export function readSharesField(raw: unknown): FieldStatus {
  if (raw === undefined || raw === null) return { kind: 'unshared_zero' }
  if (raw && typeof raw === 'object' && typeof (raw as { count?: unknown }).count === 'number') {
    return { kind: 'ok', value: (raw as { count: number }).count }
  }
  return { kind: 'field_absent', raw }
}

/** 三个字段的读数 + 错误分类 → 决定给上游的 verdict。抽出来供直测。 */
export function verdictFor(input: {
  graph_error: PostMetricsProbeResult['graph_error']
  reactions: FieldStatus | null
  comments: FieldStatus | null
  shares: FieldStatus | null
}): PostMetricsProbeResult['verdict'] {
  if (input.graph_error) {
    const c = input.graph_error.classification
    if (c === 'server_error' || c === 'network_error' || c === 'rate_limited') return 'transient'
    return 'blocked'
  }
  const r = input.reactions
  const c = input.comments
  const s = input.shares
  const summaryOk = (f: FieldStatus | null) => f?.kind === 'ok'
  if (summaryOk(r) && summaryOk(c) && summaryOk(s)) return 'all_ok'
  if (summaryOk(r) && summaryOk(c) && s?.kind === 'unshared_zero') return 'shares_missing_ok'
  return 'permission_downgrade'
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const postId = req.nextUrl.searchParams.get('post_id')
  if (!postId || !/^\d+_\d+$/.test(postId)) {
    return NextResponse.json({
      error: 'post_id query param required (form: <page_id>_<post_id>)',
    } satisfies { error: string }, { status: 400 })
  }

  const now = new Date().toISOString()

  // 一律按客户档案里登记的主页 id 取存下来的 Page Token。
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  const pageId = (clientRow as { facebook_page_id?: string | null } | null)?.facebook_page_id ?? null

  const result: PostMetricsProbeResult = {
    probe_run_at: now,
    client_id: clientId,
    page_id: pageId,
    post_id: postId,
    page_token_resolved: false,
    graph_error: null,
    reactions: null,
    comments: null,
    shares: null,
    verdict: 'input_error',
    notes: [],
  }

  if (!pageId) {
    result.verdict = 'input_error'
    result.notes.push('客户档案里没登记 Facebook 主页 —— 无从取 Page Token。')
    return NextResponse.json(result)
  }

  const token = await getStoredPageToken(clientId, pageId)
  if (!token) {
    result.verdict = 'token_missing'
    result.notes.push(
      '客户档案里的主页 ID 找不到对应的存下来的 Page Token —— 需要在设置里点一次「连接 Meta」。',
    )
    return NextResponse.json(result)
  }
  result.page_token_resolved = true

  const url =
    `${GRAPH_BASE}/${encodeURIComponent(postId)}` +
    `?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares` +
    `&access_token=${encodeURIComponent(token)}`

  let body: Record<string, unknown> | null = null
  try {
    const res = await fetch(url)
    body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      result.graph_error = {
        code: null,
        subcode: null,
        type: null,
        message: `HTTP ${res.status} —— Graph 没返回可解析的 JSON`,
        classification: res.status >= 500 ? 'server_error' : 'other',
      }
    } else if (body.error && typeof body.error === 'object') {
      result.graph_error = classifyGraphError(body.error as Record<string, unknown>)
      if (result.graph_error && result.graph_error.classification === 'other' && res.status >= 500) {
        result.graph_error.classification = 'server_error'
      }
    }
  } catch (e) {
    result.graph_error = {
      code: null,
      subcode: null,
      type: null,
      message: e instanceof Error ? e.message : String(e),
      classification: 'network_error',
    }
  }

  if (!result.graph_error && body) {
    result.reactions = readSummaryField(body.reactions)
    result.comments = readSummaryField(body.comments)
    result.shares = readSharesField(body.shares)
  }

  result.verdict = verdictFor(result)

  // notes：把有用的解读放这里，给读结果的人一句话说明。
  if (result.verdict === 'all_ok') {
    result.notes.push('当前 Page Token 就能读到三个字段的总数 —— 上游设计可直接按无 `read_insights` 路径落地。')
  } else if (result.verdict === 'shares_missing_ok') {
    result.notes.push('三个字段读到位；shares 因该帖未被分享过而被 Meta 省略字段（这是常态，按 0 记）。')
  } else if (result.verdict === 'permission_downgrade') {
    result.notes.push(
      '某个字段返回了对象但缺 total_count —— 通常代表 Page Token 少了 `pages_read_engagement` 或它被降级。',
    )
  } else if (result.verdict === 'blocked') {
    result.notes.push(`Meta 拒了读请求，分类：${result.graph_error?.classification}；这一类在消费者里应当作永久失败处理，不重试。`)
  } else if (result.verdict === 'transient') {
    result.notes.push(`Meta 侧临时问题（${result.graph_error?.classification}）—— 消费者应退避重试。`)
  }

  return NextResponse.json(result)
}
