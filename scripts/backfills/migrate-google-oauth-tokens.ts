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
 * 默认 dry-run，只打印"会做什么"，不写库。加 --live 才真的写。
 * 幂等：跑第二遍，已经迁移过的行会被跳过（先查新表是否已有该 provider 行）。
 *
 * 用法：
 *   npx tsx scripts/backfills/migrate-google-oauth-tokens.ts            # dry-run
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

async function main() {
  const { supabaseAdmin } = await import('../../src/lib/supabase')
  const { encryptToken } = await import('../../src/lib/platform-oauth/vocabulary')
  const { getValidAccessToken } = await import('../../src/lib/google-oauth/client')
  const { listGa4Properties } = await import('../../src/lib/ga4/admin')

  console.log(`[migrate-google-oauth-tokens] mode=${LIVE ? 'LIVE (will write)' : 'DRY-RUN (no writes)'}`)

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

  let gscMigrated = 0, gscSkipped = 0, gscFailed = 0
  let ga4Migrated = 0, ga4Skipped = 0, ga4Failed = 0, ga4NoProperties = 0

  for (const row of oldRows) {
    const label = `client=${row.client_id}`

    // ── GSC: pure data copy, no external call ──────────────────────────────
    const { data: existingGsc } = await supabaseAdmin
      .from('platform_oauth_connections')
      .select('id')
      .eq('client_id', row.client_id)
      .eq('provider', 'google_gsc')
      .maybeSingle()

    if (existingGsc) {
      console.log(`[gsc] ${label} — already has a platform_oauth_connections row, skip`)
      gscSkipped++
    } else if (!row.refresh_token) {
      console.warn(`[gsc] ${label} — no refresh_token in old row, cannot migrate, skip`)
      gscFailed++
    } else {
      console.log(`[gsc] ${label} — will insert (account_id=${row.google_email ?? row.client_id})`)
      if (LIVE) {
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
          gscFailed++
        } else {
          gscMigrated++
        }
      } else {
        gscMigrated++   // counted as "would migrate" in dry-run
      }
    }

    // ── GA4: needs a live Google API call to resolve the property ──────────
    if (!row.scopes?.includes(GA4_SCOPE)) {
      console.log(`[ga4] ${label} — old grant never requested analytics.readonly, skip`)
      ga4Skipped++
      continue
    }

    const { data: existingGa4 } = await supabaseAdmin
      .from('platform_oauth_connections')
      .select('id')
      .eq('client_id', row.client_id)
      .eq('provider', 'google_ga4')
      .maybeSingle()

    if (existingGa4) {
      console.log(`[ga4] ${label} — already has a platform_oauth_connections row, skip`)
      ga4Skipped++
      continue
    }

    // getValidAccessToken reads+refreshes through the OLD table — safe to
    // call even in dry-run, it's a read/refresh, not a write to the table
    // we're migrating away from.
    const accessToken = await getValidAccessToken(row.client_id)
    if (!accessToken) {
      console.warn(`[ga4] ${label} — could not obtain a live access token (refresh failed), skip`)
      ga4Failed++
      continue
    }

    const result = await listGa4Properties(accessToken)
    if (!result.ok) {
      console.error(`[ga4] ${label} — Admin API call failed, skip (not the same as "no GA4 account")`)
      ga4Failed++
      continue
    }
    if (result.properties.length === 0) {
      console.log(`[ga4] ${label} — Google account genuinely has no GA4 property, skip`)
      ga4NoProperties++
      continue
    }

    const chosen = result.properties[0]   // same "take first" MVP as the live OAuth callback
    console.log(`[ga4] ${label} — will insert property=${chosen.property} ("${chosen.displayName}")`)

    if (LIVE) {
      const { error: insErr } = await supabaseAdmin
        .from('platform_oauth_connections')
        .upsert(
          {
            client_id:         row.client_id,
            provider:          'google_ga4',
            access_token_enc:  encryptToken(accessToken),
            refresh_token_enc: encryptToken(row.refresh_token!),
            token_expiry:      row.token_expiry,
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
        ga4Failed++
        continue
      }

      const now = new Date().toISOString()
      await supabaseAdmin
        .from('client_connectors')
        .upsert(
          {
            client_id:    row.client_id,
            anchor:       'ga4',
            status:       'connected',
            config:       { property_id: chosen.property },
            connected_at: now,
            updated_at:   now,
          },
          { onConflict: 'client_id,anchor' },
        )
      ga4Migrated++
    } else {
      ga4Migrated++   // counted as "would migrate" in dry-run
    }
  }

  console.log('')
  console.log('[migrate-google-oauth-tokens] summary')
  console.log(`  GSC: migrated=${gscMigrated} skipped=${gscSkipped} failed=${gscFailed}`)
  console.log(`  GA4: migrated=${ga4Migrated} skipped=${ga4Skipped} no_properties=${ga4NoProperties} failed=${ga4Failed}`)
  if (!LIVE) console.log('  (dry-run — nothing was written; re-run with --live to apply)')
}

main().catch((err) => {
  console.error('[migrate-google-oauth-tokens] fatal:', err)
  process.exit(1)
})
