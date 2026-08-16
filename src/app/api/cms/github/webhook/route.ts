/**
 * POST /api/cms/github/webhook
 *
 * GitHub webhook receiver for pull_request events.
 *
 * Why this exists:
 *   blog-publisher opens a PR for every CTS Tours blog post but stops there.
 *   PM had to manually merge the PR, then manually press "🔍 请求 Google 收录"
 *   in ME. That meant 5 blogs/week × 2 round-trips to GitHub + ME per blog =
 *   bottleneck for the CTS pipeline.
 *
 * This route closes the loop:
 *   1. Validate the HMAC signature (X-Hub-Signature-256).
 *   2. On pull_request.closed with merged=true, look up the blog_post
 *      by pr_number + verify pr_url matches (avoids cross-client collision).
 *   3. Flip status='published' and set published_at = NOW().
 *   4. Best-effort: request GSC indexing using the client's OAuth token.
 *
 * Configuration (per GitHub repo, one-time):
 *   - Settings → Webhooks → Add webhook
 *   - Payload URL: https://app.magicengine.com.au/api/cms/github/webhook
 *   - Content type: application/json
 *   - Secret: same value as GITHUB_WEBHOOK_SECRET env var
 *   - Events: "Pull requests" only
 *
 * Reference: ROADMAP.md P14.C.6
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getValidAccessToken } from '@/lib/google-oauth/client'
import { requestIndexing } from '@/lib/gsc/indexing-client'
import { pingSitemap, buildSitemapUrlFromDomain, type SitemapPingSummary } from '@/lib/gsc/sitemap-ping'
import { markMergedByPr } from '@/lib/cms/geo-deployments-store'
import { APPROVED_REPO } from '@/lib/product-map/types'
import { GithubRestProvider, NotProvisionedError, SupabaseSyncStore, runTargetedSync } from '@/lib/product-map-sync'

interface GithubPullRequestEvent {
  action: string
  pull_request: {
    number: number
    html_url: string
    merged: boolean
    merged_at: string | null
  }
  repository: {
    full_name: string
  }
}

interface BlogPostRow {
  id:         string
  client_id:  string
  slug:       string | null
  pr_url:     string | null
  pr_number:  number | null
  status:     string
}

interface ClientRow {
  domain: string | null
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) return false
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const provided = signatureHeader.slice('sha256='.length)
  if (expected.length !== provided.length) return false

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))
  } catch {
    return false
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // GitHub sends the body once. We need the raw text for HMAC verification.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'unreadable body' }, { status: 400 })
  }

  const sig = req.headers.get('x-hub-signature-256')
  if (!verifySignature(rawBody, sig)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const event = req.headers.get('x-github-event') ?? ''
  // Always return 200 for events we choose to ignore — GitHub disables webhooks
  // that return many non-2xx responses.
  if (event === 'ping') {
    return NextResponse.json({ pong: true })
  }

  // ── 仓门分流(ME2 Product Map,PR2)────────────────────────────────────
  // 本 endpoint 同时服务两类 webhook:客户站仓(blog/GEO 发布闭环,下面的既有
  // 逻辑)和 ME 自己的仓(product-map 同步)。按 repository.full_name 分流,
  // 两路互斥 —— 客户仓事件永远不会触发 product-map 同步,反之亦然。
  let parsed: { repository?: { full_name?: string } }
  try {
    parsed = JSON.parse(rawBody) as { repository?: { full_name?: string } }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  if (parsed.repository?.full_name === APPROVED_REPO) {
    return handleProductMapEvent(req, event, parsed as ProductMapEventBody)
  }

  if (event !== 'pull_request') {
    return NextResponse.json({ ignored: `event=${event}` })
  }

  const body = parsed as unknown as GithubPullRequestEvent

  if (body.action !== 'closed' || !body.pull_request?.merged) {
    return NextResponse.json({ ignored: 'not a merge' })
  }

  const prNumber  = body.pull_request.number
  const prUrl     = body.pull_request.html_url
  const publishedAt = body.pull_request.merged_at ?? new Date().toISOString()

  // ── B3: GEO deployment tracking ──────────────────────────────────────────
  // A GEO PR can cover multiple template files (multi-target injection).
  // markMergedByPr flips all matching pending_pr rows to merged in one call.
  // We run this before the blog lookup so a GEO-only PR still gets a clean 200.
  let geoMergedCount = 0
  try {
    geoMergedCount = await markMergedByPr(prNumber, prUrl)
  } catch (err) {
    // Best-effort — don't let a DB blip cause GitHub to disable the webhook.
    console.error('[github-webhook] geo_deployments merge update failed', err)
  }

  // ── Lookup the blog_post ─────────────────────────────────────────────────
  // pr_number is not globally unique, so we also match the full pr_url.
  const { data: posts, error: lookupErr } = await supabaseAdmin
    .from('blog_posts')
    .select('id, client_id, slug, pr_url, pr_number, status')
    .eq('pr_number', prNumber)

  if (lookupErr) {
    console.error('[github-webhook] blog_posts lookup failed', lookupErr)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }

  const match = (posts ?? []).find(
    p => (p as BlogPostRow).pr_url === prUrl,
  ) as BlogPostRow | undefined

  if (!match) {
    // PR merged but no ME-tracked blog_post — could be a GEO PR or non-ME PR.
    return NextResponse.json({ ignored: 'no matching blog_post', geo_deployments_merged: geoMergedCount })
  }

  // ── Update blog_post → published ─────────────────────────────────────────
  const { error: updateErr } = await supabaseAdmin
    .from('blog_posts')
    .update({ status: 'published', published_at: publishedAt })
    .eq('id', match.id)

  if (updateErr) {
    console.error('[github-webhook] blog_posts update failed', updateErr)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }

  // ── Best-effort downstream signals ─────────────────────────────────────
  // All failures are swallowed — GitHub disables receivers that don't 2xx promptly.
  //
  //   1. Sitemap ping (Google + Bing) — the practical lever to get the
  //      sitemap re-fetched and the new URL discovered. Works for any
  //      content type. See sitemap-ping.ts for protocol caveats.
  //   2. GSC Indexing API — kept around for JobPosting / BroadcastEvent
  //      content. Will report NOT_SUPPORTED_BY_API for blog URLs (Google
  //      drops the request silently at the backend); the UI surfaces the
  //      classification and recommends the manual GSC Inspect fallback.
  const [sitemapResult, gscResult] = await Promise.all([
    tryPingSitemap(match.client_id),
    tryRequestGscIndexing(match.client_id, match.slug),
  ])

  return NextResponse.json({
    success:                  true,
    blog_post_id:             match.id,
    pr_number:                prNumber,
    published_at:             publishedAt,
    geo_deployments_merged:   geoMergedCount,
    sitemap_ping:             sitemapResult,
    gsc_indexing:             gscResult,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ME2 Product Map 分支(只吃 APPROVED_REPO 的事件)
//
// 约束:
// - 除验签外永远 200(GitHub 会禁用高失败率 webhook);失败进 deliveries/sync_runs 台账;
// - 投递幂等 claim-first,GitHub Redeliver 复用同一 GUID:processed/skipped 才跳,
//   failed 允许重试(否则失败事件被永久吞掉);
// - targeted sync 硬预算(单号码),重活留给每日对账 cron;
// - 表未 apply(NotProvisionedError)→ 200 not_provisioned,cron 侧会把这事报红。
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCT_MAP_SYNC_EVENTS = new Set([
  'pull_request',
  'pull_request_review_thread',
  'issues',
  'push',
  'workflow_run',
])

interface ProductMapEventBody {
  action?: string
  pull_request?: { number: number }
  issue?: { number: number }
  workflow_run?: { pull_requests?: { number: number }[] }
}

async function handleProductMapEvent(
  req: NextRequest,
  event: string,
  body: ProductMapEventBody,
): Promise<NextResponse> {
  if (!PRODUCT_MAP_SYNC_EVENTS.has(event)) {
    return NextResponse.json({ ignored: `product-map: event=${event}` })
  }

  const store = new SupabaseSyncStore(supabaseAdmin)
  const deliveryId = req.headers.get('x-github-delivery') ?? `missing-${randomUUID()}`

  try {
    const claim = await store.claimDelivery(deliveryId, event, body.action ?? null)
    if (claim === 'duplicate') {
      return NextResponse.json({ status: 'skipped_duplicate', delivery: deliveryId })
    }

    // 事件 → 受影响号码。push / workflow_run 无直接号码(或号码列表可能为空):
    // 只登记投递,状态刷新交给每日对账 cron —— targeted 只做单号码硬预算内的活。
    // 🔴 number 必须运行时校验(狄仁杰 T1):TS 类型不是运行时护栏,payload 里的
    //    字符串会一路拼进 GitHub API 路径;不合法一律降级 deferred_to_cron。
    const validNumber = (n: unknown): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 2_147_483_647
    const target = validNumber(body.pull_request?.number)
      ? ({ kind: 'pr', number: body.pull_request!.number } as const)
      : event === 'issues' && validNumber(body.issue?.number)
        ? ({ kind: 'issue', number: body.issue!.number } as const)
        : validNumber(body.workflow_run?.pull_requests?.[0]?.number)
          ? ({ kind: 'pr', number: body.workflow_run!.pull_requests![0].number } as const)
          : null

    if (!target) {
      await store.markDelivery(deliveryId, 'processed')
      return NextResponse.json({ status: 'recorded', delivery: deliveryId, sync: 'deferred_to_cron' })
    }

    const token = process.env.GITHUB_TOKEN
    if (!token) {
      await store.markDelivery(deliveryId, 'failed', 'GITHUB_TOKEN 未配置')
      return NextResponse.json({ status: 'failed', reason: 'GITHUB_TOKEN 未配置' })
    }

    const result = await runTargetedSync(
      {
        provider: new GithubRestProvider({ token, timeoutMs: 3_000 }),
        store,
        newRunId: () => randomUUID(),
        now: () => new Date().toISOString(),
      },
      target,
    )
    if (result === null) {
      // 非登记册号码:不落 facts(孤儿行会钉死快照鲜度),未分类发现是 cron 的活
      await store.markDelivery(deliveryId, 'processed')
      return NextResponse.json({ status: 'recorded', delivery: deliveryId, sync: 'not_registry_linked' })
    }
    await store.markDelivery(
      deliveryId,
      result.status === 'error' ? 'failed' : 'processed',
      result.status === 'error' ? result.stats.failedItems.join('; ') || 'sync error' : undefined,
    )
    return NextResponse.json({ status: result.status, run_id: result.runId, delivery: deliveryId })
  } catch (err) {
    if (err instanceof NotProvisionedError) {
      return NextResponse.json({ status: 'not_provisioned', detail: err.message })
    }
    console.error('[github-webhook] product-map 分支失败', err)
    try {
      await store.markDelivery(deliveryId, 'failed', err instanceof Error ? err.message : 'unknown')
    } catch {
      // deliveries 表本身不可用 —— 已在上面 not_provisioned 分支covered;此处兜底静默仅限标记失败
    }
    return NextResponse.json({ status: 'failed' })
  }
}

async function tryPingSitemap(clientId: string): Promise<SitemapPingSummary | { attempted: false; reason: string }> {
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle<ClientRow>()
  const sitemapUrl = buildSitemapUrlFromDomain(clientRow?.domain)
  if (!sitemapUrl) return { attempted: false, reason: 'no client domain' }
  try {
    return await pingSitemap(sitemapUrl)
  } catch (err) {
    return {
      attempted: false,
      reason: err instanceof Error ? err.message : 'sitemap ping threw unexpectedly',
    }
  }
}

interface GscResult {
  attempted: boolean
  ok?:       boolean
  reason?:   string
  url?:      string
}

async function tryRequestGscIndexing(clientId: string, slug: string | null): Promise<GscResult> {
  if (!slug) return { attempted: false, reason: 'no slug' }

  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('domain')
    .eq('id', clientId)
    .maybeSingle<ClientRow>()

  const domain = clientRow?.domain?.trim()
  if (!domain) return { attempted: false, reason: 'no client domain' }

  const base = domain.startsWith('http') ? domain : `https://${domain}`
  const url  = `${base.replace(/\/$/, '')}/blog/${slug}`

  let token: string | null
  try {
    token = await getValidAccessToken(clientId)
  } catch {
    return { attempted: true, ok: false, reason: 'no oauth token', url }
  }
  if (!token) return { attempted: true, ok: false, reason: 'no oauth token', url }

  try {
    const result = await requestIndexing(url, token)
    return { attempted: true, ok: result.ok, reason: result.ok ? undefined : result.errorMsg, url }
  } catch (err) {
    return {
      attempted: true,
      ok:        false,
      reason:    err instanceof Error ? err.message : 'gsc call failed',
      url,
    }
  }
}
