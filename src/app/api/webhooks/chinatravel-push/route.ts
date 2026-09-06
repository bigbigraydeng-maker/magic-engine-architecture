/**
 * POST /api/webhooks/chinatravel-push
 *
 * GitHub webhook receiver for pushes on customer site repos that ME
 * manages the cache-refresh pipeline for. Deliberately generic despite
 * the route name — any repo registered in @/lib/site-refresh/paths
 * (INVENTORY_BY_REPO) can point its webhook here and the pipeline
 * fans out automatically. (The route name reflects its first customer,
 * chinatravel / ctstours.co.nz; new customer sites can either share
 * this URL or register a sibling under /api/webhooks/<name>-push.)
 *
 * Configuration (per customer repo, one-time, in GitHub):
 *   - Settings → Webhooks → Add webhook
 *   - Payload URL:  https://app.magicengine.com.au/api/webhooks/chinatravel-push
 *   - Content type: application/json
 *   - Secret:       $GITHUB_WEBHOOK_SECRET (reused, no new secret)
 *   - Events:       "Just the push event"
 *
 * Per-customer runtime config (Cloudflare zone id, revalidate secret,
 * origin URL) lives in the Supabase `client_site_platforms` table.
 * NO per-customer environment variables in the ME app.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { inngest } from '@/lib/inngest/client'
import { planSiteRefresh, getInventoryForRepo } from '@/lib/site-refresh/paths'
import { CTS_SITE_DATA_UPDATED_EVENT } from '@/lib/inngest/functions/cts-site-cache-refresh'

const APPROVED_BRANCH = 'refs/heads/main'

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

interface GithubPushCommit {
  added?: unknown
  modified?: unknown
  removed?: unknown
}
interface GithubPushEvent {
  after?: unknown
  ref?: unknown
  repository?: { full_name?: unknown }
  commits?: GithubPushCommit[]
  head_commit?: GithubPushCommit
}

function collectChangedFiles(payload: GithubPushEvent): string[] {
  const files = new Set<string>()
  const push = (arr: unknown) => {
    if (!Array.isArray(arr)) return
    for (const f of arr) if (typeof f === 'string') files.add(f)
  }
  if (payload.head_commit) {
    push(payload.head_commit.added)
    push(payload.head_commit.modified)
    push(payload.head_commit.removed)
  }
  if (Array.isArray(payload.commits)) {
    for (const c of payload.commits) {
      push(c.added)
      push(c.modified)
      push(c.removed)
    }
  }
  return Array.from(files)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const eventName = req.headers.get('x-github-event') ?? ''
  if (eventName === 'ping') return NextResponse.json({ pong: true })
  if (eventName !== 'push') {
    return NextResponse.json({ ignored: `event:${eventName}` })
  }

  let parsed: GithubPushEvent
  try {
    parsed = JSON.parse(rawBody) as GithubPushEvent
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const repoName =
    typeof parsed.repository?.full_name === 'string' ? parsed.repository.full_name : ''

  // Approved-repo gate is now data-driven: any repo we have a URL
  // inventory registered for is welcome. Repos we don't know about get
  // acknowledged with a clear reason so misconfiguration is visible in
  // GitHub's webhook delivery history rather than silent.
  if (!getInventoryForRepo(repoName)) {
    return NextResponse.json({ ignored: `no_inventory_for_repo:${repoName || 'unknown'}` })
  }

  const ref = typeof parsed.ref === 'string' ? parsed.ref : ''
  if (ref !== APPROVED_BRANCH) {
    return NextResponse.json({ ignored: `ref:${ref || 'unknown'}` })
  }

  const commitSha = typeof parsed.after === 'string' ? parsed.after : ''
  const changedFiles = collectChangedFiles(parsed)
  const plan = planSiteRefresh(changedFiles)

  if (!plan.hasSiteChange) {
    return NextResponse.json({
      accepted: true,
      dispatched: false,
      reason: 'no_site_change',
      commit_sha: commitSha,
      github_repo: repoName,
      changed_file_count: changedFiles.length,
    })
  }

  await inngest.send({
    name: CTS_SITE_DATA_UPDATED_EVENT,
    data: {
      commit_sha: commitSha,
      ref,
      github_repo: repoName,
      changed_files: changedFiles,
      triggered_at_ms: Date.now(),
    },
  })

  return NextResponse.json({
    accepted: true,
    dispatched: true,
    event: CTS_SITE_DATA_UPDATED_EVENT,
    commit_sha: commitSha,
    github_repo: repoName,
    tour_data_changed: plan.tourDataChanged,
    blog_data_changed: plan.blogDataChanged,
    plan_reasons: plan.reasons,
  })
}
