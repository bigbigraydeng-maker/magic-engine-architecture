/**
 * Google Search Console (Search Analytics) client.
 *
 * Authentication: service account JWT — no extra npm package required.
 * The private key + client_email come from the GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
 * env var (JSON string of the downloaded service account key file).
 *
 * Usage:
 *   1. Create a Google Cloud service account and download its JSON key.
 *   2. In GSC: Settings → Users & Permissions → Add user → enter client_email,
 *      role "Restricted" (read-only). Repeat for every property you want to read.
 *   3. Set GOOGLE_SERVICE_ACCOUNT_CREDENTIALS=<contents of the JSON key file>
 *      in Render environment variables.
 *
 * Reference: ROADMAP.md P8.10.S0.23
 */

import { createSign } from 'crypto'
import type { GscSearchData, GscQueryRow } from '@/lib/zhangqian/types'

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const SEARCH_ANALYTICS_BASE =
  'https://searchconsole.googleapis.com/webmasters/v3/sites'

const DEFAULT_DATE_RANGE_DAYS = 28
const MAX_ROWS = 25
const FETCH_TIMEOUT_MS = 20_000

// ─── Service Account shape ────────────────────────────────────────────────────

interface ServiceAccount {
  private_key: string
  client_email: string
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the top search queries for a GSC property over the last 28 days.
 *
 * @param siteUrl  The GSC property URL, e.g. "https://example.com.au/" or
 *                 "sc-domain:example.com.au"
 * @returns        Structured search data, or null if credentials are missing /
 *                 the property is inaccessible.
 */
export async function fetchGscSearchPerformance(
  siteUrl: string,
): Promise<GscSearchData | null> {
  const creds = loadServiceAccount()
  if (!creds) return null

  const token = await getAccessToken(creds).catch(() => null)
  if (!token) return null

  const endDate = toIsoDate(new Date())
  const startDate = toIsoDate(daysAgo(DEFAULT_DATE_RANGE_DAYS))

  const body = JSON.stringify({
    startDate,
    endDate,
    dimensions: ['query'],
    rowLimit: MAX_ROWS,
    orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(
      `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      console.warn(`[gsc/client] Search Analytics returned ${res.status} for ${siteUrl}`)
      return null
    }

    const data = await res.json() as {
      rows?: Array<{
        keys: string[]
        impressions: number
        clicks: number
        ctr: number
        position: number
      }>
    }

    const rows: GscQueryRow[] = (data.rows ?? []).map(r => ({
      query:       r.keys[0] ?? '',
      impressions: r.impressions,
      clicks:      r.clicks,
      ctr:         r.ctr,
      position:    r.position,
    }))

    return {
      site_url: siteUrl,
      date_range_days: DEFAULT_DATE_RANGE_DAYS,
      rows,
      fetched_at: new Date().toISOString(),
    }
  } catch (err) {
    console.warn('[gsc/client] fetch failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Service Account JWT helpers ──────────────────────────────────────────────

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>
    if (!parsed.private_key || !parsed.client_email) return null
    return parsed as ServiceAccount
  } catch {
    return null
  }
}

/**
 * Exchange a service account key for a short-lived OAuth2 access token.
 * Signs a JWT locally using Node's built-in `crypto` — no npm package needed.
 */
async function getAccessToken(creds: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600

  const headerB64 = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payloadB64 = b64url(
    JSON.stringify({
      iss: creds.client_email,
      sub: creds.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp,
    }),
  )

  const toSign = `${headerB64}.${payloadB64}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  // Google service account keys use PKCS#8 PEM; Node's createSign accepts it directly.
  const sig = signer.sign(creds.private_key, 'base64url')
  const jwt = `${toSign}.${sig}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) throw new Error('No access_token in response')
  return json.access_token
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function b64url(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url')
}

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
