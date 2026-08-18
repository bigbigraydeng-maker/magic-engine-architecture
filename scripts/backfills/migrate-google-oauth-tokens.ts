/**
 * 一次性回填：把 google_oauth_tokens（老表，明文，一客户一行）的现有数据
 * 补进 platform_oauth_connections（新表，加密，一客户每平台一行）。
 *
 * 背景：docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.2 PR3a。
 * 老表不删、不停写——这脚本只是"expand"（先补齐新表），"contract"（老表
 * 停止读写）是完全独立的、要等双写观察几天确认新表数据没问题之后才做的
 * 另一个改动，不在这个脚本里。
 *
 * 两部分：
 *   1. GSC —— 纯搬数据，不调外部 API。老表这一行已经代表了 GSC 授权。
 *      google/callback 路由从这次改动之前就已经在 dual-write 了，所以真正
 *      需要这个脚本补的，只是"客户很早连的、从没重新走过一遍授权"的历史行。
 *   2. GA4 —— 不能纯搬数据：老表没有"连的是哪个 GA4 Property"这个信息，
 *      必须拿这个客户的 token 现场问一次 Google（跟 OAuth 回调里的自动选择
 *      逻辑完全一样：只有一个就直接选，有多个也选第一个，跟已经上线的行为
 *      保持一致，不是这个脚本单独发明一套规则）。
 *
 * dry-run 是**真正零写入、零外部调用**：GA4 这部分老代码曾经不加 --live
 * 也会经 getValidAccessToken() 触发一次 Google token 刷新、悄悄写回老表——
 * 复审揪出这条后已改掉，dry-run 现在对 GA4 只报「这一行是候选，具体连的
 * 是哪个 Property 要等 --live 才会真的去问 Google」，不再有任何副作用。
 *
 * 幂等：跑第二遍，已经迁移过的行会被跳过（先查新表是否已有该 provider 行，
 * 用 order+limit(1) 取最新一条，不假设只有一行）。
 * 单行出错不会掀翻整批——每个客户的处理都包在自己的 try/catch 里，失败了
 * 记一笔继续跑下一个。
 *
 * 用法：
 *   npx tsx scripts/backfills/migrate-google-oauth-tokens.ts            # dry-run，零写入零外呼
 *   npx tsx scripts/backfills/migrate-google-oauth-tokens.ts --live     # 真的写
 *   npx tsx scripts/backfills/migrate-google-oauth-tokens.ts --live --client-id=<uuid>  # 只跑一个客户
 */

import { readFileSync } from 'node:fs'

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const LIVE = process.argv.includes('--live')
const clientIdArg = process.argv.find(a => a.startsWith('--client-id='))
const ONLY_CLIENT_ID = clientIdArg ? clientIdArg.split('=')[1] : null

interface OldTokenRow {
  client_id: string
  access_token: string
  refresh_token: string | null
  token_expiry: string
  scopes: string[]
  google_email: string | null
}

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

/** 立刻视为过期，逼下一次真正读取时强制刷新一次——比信一个我们其实不知道
 *  准不准的到期时间安全（刷新是幂等、低成本操作，读到过期数据不是）。 */
function forceExpiredTimestamp(): string {
  return new Date(0).toISOString()
}

async function migrateGsc(
  row: OldTokenRow,
  deps: {
    supabaseAdmin: typeof import('../../src/lib/supabase').supabaseAdmin
    encryptToken: typeof import('../../src/lib/platform-oauth/vocabulary').encryptToken
  },
  counts: { migrated: number; skipped: number; failed: number },
): Promise<void> {
  const { supabaseAdmin, encryptToken } = deps
  const label = `client=${row.client_id}`

  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id')
    .eq('client_id', row.client_id)
    .eq('provider', 'google_gsc')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    console.error(`[gsc] ${label} — lookup failed, skip:`, lookupErr.message)
    counts.failed++
    return
  }
  if (existing) {
    console.log(`[gsc] ${label} — already has a platform_oauth_connections row, skip`)
    counts.skipped++
    return
  }
  if (!row.refresh_token) {
    console.warn(`[gsc] ${label} — no refresh_token in old row, cannot migrate, skip`)
    counts.failed++
    return
  }

  console.log(`[gsc] ${label} — will insert (account_id=${row.google_email ?? row.client_id})`)
  if (!LIVE) { counts.migrated++; return }

  const { error: insErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .upsert(
      {
        client_id:         row.client_id,
        provider:          'google_gsc',
        access_token_enc:  encryptToken(row.access_token),
        refresh_token_enc: encryptToken(row.refresh_token),
        token_expiry:      row.token_expiry,
        account_id:        row.google_email ?? row.client_id,
        display_name:      row.google_email ?? 'Google Search Console',
        scopes:            row.scopes,
        status:            'active',
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'client_id,provider,account_id' },
    )
  if (insErr) {
    console.error(`[gsc] ${label} — insert failed:`, insErr.message)
    counts.failed++
  } else {
    counts.migrated++
  }
}

async function migrateGa4(
  row: OldTokenRow,
  deps: {
    supabaseAdmin: typeof import('../../src/lib/supabase').supabaseAdmin
    encryptToken: typeof import('../../src/lib/platform-oauth/vocabulary').encryptToken
    getValidAccessToken: typeof import('../../src/lib/google-oauth/client').getValidAccessToken
    listGa4Properties: typeof import('../../src/lib/ga4/admin').listGa4Properties
    setGa4Property: typeof import('../../src/lib/ga4/property').setGa4Property
  },
  counts: { migrated: number; skipped: number; failed: number; noProperties: number; ambiguous: number },
): Promise<void> {
  const { supabaseAdmin, encryptToken, getValidAccessToken, listGa4Properties, setGa4Property } = deps
  const label = `client=${row.client_id}`

  if (!row.scopes?.includes(GA4_SCOPE)) {
    console.log(`[ga4] ${label} — old grant never requested analytics.readonly, skip`)
    counts.skipped++
    return
  }
  if (!row.refresh_token) {
    console.warn(`[ga4] ${label} — no refresh_token in old row, cannot migrate, skip`)
    counts.failed++
    return
  }

  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id')
    .eq('client_id', row.client_id)
    .eq('provider', 'google_ga4')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    console.error(`[ga4] ${label} — lookup failed, skip:`, lookupErr.message)
    counts.failed++
    return
  }
  if (existing) {
    console.log(`[ga4] ${label} — already has a platform_oauth_connections row, skip`)
    counts.skipped++
    return
  }

  // Dry-run stops here — resolving which property applies needs a live
  // Google call (token refresh + Admin API), and a "preview" must never
  // touch a real API or write a token refresh back to the old table.
  if (!LIVE) {
    console.log(`[ga4] ${label} — candidate (has analytics.readonly scope, not yet migrated); ` +
      `run with --live to actually ask Google which property applies`)
    counts.migrated++
    return
  }

  const accessToken = await getValidAccessToken(row.client_id)
  if (!accessToken) {
    console.warn(`[ga4] ${label} — could not obtain a live access token (refresh failed), skip`)
    counts.failed++
    return
  }

  const result = await listGa4Properties(accessToken)
  if (!result.ok) {
    console.error(`[ga4] ${label} — Admin API call failed, skip (not the same as "no GA4 account")`)
    counts.failed++
    return
  }
  if (result.properties.length === 0) {
    console.log(`[ga4] ${label} — Google account genuinely has no GA4 property, skip`)
    counts.noProperties++
    return
  }
  // 2026-08-18 (#1052 PM Gate — backfill final review): must match the live
  // OAuth callback's narrowed rule exactly — auto-connect only when there is
  // exactly ONE candidate. "Take the first of several" was this script's own
  // pre-#1052 leftover (its header comment used to justify it by pointing at
  // the callback's OLD behavior, which no longer exists). With 2+ candidates
  // there's a real choice a human needs to make; guessing item[0] for
  // potentially dozens of historical clients in one batch run is exactly the
  // "Property discovered ≠ Property selected" violation this whole PR closed
  // everywhere else.
  if (result.properties.length > 1) {
    console.log(`[ga4] ${label} — ${result.properties.length} candidate properties, ambiguous — ` +
      `skip; connect via the settings page picker once someone picks one`)
    counts.ambiguous++
    return
  }

  const chosen = result.properties[0]
  console.log(`[ga4] ${label} — inserting property=${chosen.property} ("${chosen.displayName}")`)

  const { error: insErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .upsert(
      {
        client_id:         row.client_id,
        provider:          'google_ga4',
        access_token_enc:  encryptToken(accessToken),
        refresh_token_enc: encryptToken(row.refresh_token),
        // accessToken 可能是刚刷新出来的新值，row.token_expiry 是刷新前那个
        // 已过期的老值，两者配不上——不假装知道真实到期时间，直接标成已过期，
        // 逼下一次真正使用时再刷新一次（幂等、低成本，比用错的时间戳安全）。
        token_expiry:      forceExpiredTimestamp(),
        account_id:        chosen.property,
        display_name:      chosen.displayName,
        scopes:            row.scopes,
        status:            'active',
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'client_id,provider,account_id' },
    )
  if (insErr) {
    console.error(`[ga4] ${label} — insert failed:`, insErr.message)
    counts.failed++
    return
  }

  // 2026-08-18 (#1052 PM Gate — final narrow review): this used to upsert
  // client_connectors.anchor='ga4', status='connected' directly, mirroring
  // (per this function's own header comment) "跟已经上线的行为保持一致" —
  // the live OAuth callback's OLD auto-discovery logic. That logic has
  // since been rewritten to route through setGa4Property() (the only
  // function allowed to ever write status='connected', because it's the
  // only one that calls verifyGa4PropertyAccess() first) — this script
  // must match, or it reopens the exact bypass #1052 closed everywhere
  // else. --live already gates every real Google call this function makes
  // (see the dry-run return above), so calling setGa4Property() here is
  // no less "live" than the listGa4Properties() call two lines up.
  //
  // A batch job guessing wrong about which property applies is a different
  // situation from a live user's own OAuth session failing verification —
  // for a live session, status='error' is useful diagnostic feedback shown
  // right back to the person who just tried. For this script, unconditionally
  // leaving that same 'error' row behind would manufacture a brand-new
  // "GA4 connection has a problem" badge on a client's settings page as a
  // side effect of a data migration nobody there asked for or knows ran.
  // So: check whether a client_connectors.ga4 row existed *before* this
  // call — if not, and setGa4Property() just created a fresh 'error' one,
  // delete it again. The client's real connection state ends this script
  // exactly where it started (still nothing); a later live re-auth or
  // manual picker pick gets a clean, fresh verification, not a stale
  // artifact from an automated guess. If a row already existed before this
  // call (any status), setGa4Property()'s own clobber-guard already did the
  // right thing — leave that outcome untouched.
  const { data: priorConnector } = await supabaseAdmin
    .from('client_connectors')
    .select('id')
    .eq('client_id', row.client_id)
    .eq('anchor', 'ga4')
    .maybeSingle<{ id: string }>()

  const connectResult = await setGa4Property(row.client_id, chosen.property)
  if (!connectResult.ok) {
    console.error(`[ga4] ${label} — setGa4Property rejected the migrated property (${connectResult.reason}), skip`)
    counts.failed++
    return
  }
  if (connectResult.status === 'error') {
    if (!priorConnector) {
      const { error: cleanupErr } = await supabaseAdmin
        .from('client_connectors')
        .delete()
        .eq('client_id', row.client_id)
        .eq('anchor', 'ga4')
        .eq('status', 'error')
      if (cleanupErr) {
        console.warn(`[ga4] ${label} — failed to clean up the error connector this run created:`, cleanupErr.message)
      }
    }
    console.warn(
      `[ga4] ${label} — property=${chosen.property} failed live verification ` +
      `(${connectResult.reason}: ${connectResult.detail}) — not counted as migrated, no connector row left behind`,
    )
    counts.failed++
    return
  }
  counts.migrated++
}

async function main() {
  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const { encryptToken } = await import('../../src/lib/platform-oauth/vocabulary')
  const { getValidAccessToken } = await import('../../src/lib/google-oauth/client')
  const { listGa4Properties } = await import('../../src/lib/ga4/admin')
  const { setGa4Property } = await import('../../src/lib/ga4/property')

  console.log(`[migrate-google-oauth-tokens] mode=${LIVE ? 'LIVE (will write)' : 'DRY-RUN (zero writes, zero external calls)'}`)

  let query = supabaseAdmin
    .from('google_oauth_tokens')
    .select('client_id, access_token, refresh_token, token_expiry, scopes, google_email')

  if (ONLY_CLIENT_ID) query = query.eq('client_id', ONLY_CLIENT_ID)

  const { data: rows, error } = await query
  if (error) {
    console.error('[migrate-google-oauth-tokens] failed to read google_oauth_tokens:', error.message)
    process.exit(1)
  }

  const oldRows = (rows ?? []) as OldTokenRow[]
  console.log(`[migrate-google-oauth-tokens] ${oldRows.length} row(s) in google_oauth_tokens to consider`)

  const gscCounts = { migrated: 0, skipped: 0, failed: 0 }
  const ga4Counts = { migrated: 0, skipped: 0, failed: 0, noProperties: 0, ambiguous: 0 }

  for (const row of oldRows) {
    try {
      await migrateGsc(row, { supabaseAdmin, encryptToken }, gscCounts)
    } catch (err) {
      console.error(`[gsc] client=${row.client_id} — unexpected error, skip and continue:`, err)
      gscCounts.failed++
    }

    try {
      await migrateGa4(row, { supabaseAdmin, encryptToken, getValidAccessToken, listGa4Properties, setGa4Property }, ga4Counts)
    } catch (err) {
      console.error(`[ga4] client=${row.client_id} — unexpected error, skip and continue:`, err)
      ga4Counts.failed++
    }
  }

  console.log('')
  console.log('[migrate-google-oauth-tokens] summary')
  console.log(`  GSC: migrated=${gscCounts.migrated} skipped=${gscCounts.skipped} failed=${gscCounts.failed}`)
  console.log(`  GA4: migrated=${ga4Counts.migrated} skipped=${ga4Counts.skipped} no_properties=${ga4Counts.noProperties} ambiguous=${ga4Counts.ambiguous} failed=${ga4Counts.failed}`)
  if (!LIVE) console.log('  (dry-run — nothing was written, no external calls made; re-run with --live to apply)')
}

main().catch((err) => {
  console.error('[migrate-google-oauth-tokens] fatal:', err)
  process.exit(1)
})
