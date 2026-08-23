/**
 * GET /api/auth/facebook/callback?code=…&state=…
 *
 * Meta sends the user back here after consent. We turn the one-time code into a
 * long-lived user token, read every Page that token holds a role on, and store
 * the Page token for the Page this client is bound to.
 *
 * We store the **Page** token, not the user token: the hourly Messenger sync
 * needs a Page token, and deriving one at read time is what used to fail
 * silently (`no_page_token`) when the identity behind the env-var token held no
 * role on the Page.
 *
 * Every exit redirects back to the client's settings page with a short,
 * plain-language `meta` query param — a JSON error body here would be a dead end
 * for whoever clicked the button.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyState, exchangeCode, exchangeForLongLivedToken, listPagesWithTokens, listGrantedScopes, META_PUBLISH_SCOPE } from '@/lib/meta-oauth/client'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

/** Long-lived user tokens last ~60 days; Page tokens derived from them do not
 *  expire while the grant stands. We record 60 days so an expiry sweep has
 *  something honest to look at rather than a fabricated "never". */
const TOKEN_LIFETIME_DAYS = 60

type Outcome =
  | 'connected'
  | 'publish_ready'
  | 'publish_not_granted'
  | 'verify_failed'
  | 'no_pages'
  | 'page_not_granted'
  | 'no_page_bound'
  | 'denied'
  | 'bad_state'
  | 'exchange_failed'

function back(clientId: string | null, outcome: Outcome): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
  // The outcome message and the Reauthorize action live in FacebookPagePanel,
  // which only renders inside the client-page settings drawer's "platform" tab
  // (`?settings=platform` opens that drawer) — NOT on the /settings route, which
  // does not mount the panel. Landing there would hide every publish_* /
  // verify_failed result and the retry button. clientId comes from the
  // HMAC-verified state, never a raw query param, so this is not an open redirect.
  const query = new URLSearchParams({ settings: 'platform', meta: outcome })
  const path = clientId
    ? `/dashboard/clients/${clientId}?${query.toString()}`
    : `/dashboard?meta=${outcome}`
  return NextResponse.redirect(`${appUrl}${path}`)
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams

  // User pressed Cancel on Meta's consent screen.
  if (params.get('error')) return back(null, 'denied')

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return back(null, 'bad_state')

  const verified = verifyState(state)
  if (!verified) return back(null, 'bad_state')
  const { clientId, intent } = verified

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'}/api/auth/facebook/callback`

  const shortToken = await exchangeCode(code, redirectUri)
  if (!shortToken) return back(clientId, 'exchange_failed')

  const longToken = await exchangeForLongLivedToken(shortToken)
  if (!longToken) return back(clientId, 'exchange_failed')

  const pages = await listPagesWithTokens(longToken)
  if (pages.length === 0) return back(clientId, 'no_pages')

  // Which Page is this client actually bound to? Without a binding we have no
  // basis to pick one, and guessing would attach the wrong inbox.
  const { data } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()

  const boundPageId = (data as { facebook_page_id?: string | null } | null)?.facebook_page_id
  if (!boundPageId) return back(clientId, 'no_page_bound')

  // The consent may be genuine yet not cover the Page we need — the account
  // that authorised holds no role on it. Saying so beats storing a token that
  // will never work.
  const match = pages.find((p) => p.pageId === boundPageId)
  if (!match) return back(clientId, 'page_not_granted')

  const expiry = new Date(Date.now() + TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000)

  // Store what Meta ACTUALLY granted, never what we requested. The user can
  // approve a subset on the consent screen; recording the requested constant
  // would mark a token publish-ready that cannot publish.
  //
  // `null` means the permissions read itself failed — NOT "zero granted". We
  // must not fabricate facts on that path: writing the requested scopes would
  // record a grant the user may never have given, and stamping last_synced_at
  // would claim a verification that never happened. So we fail closed — leave
  // the existing connection's known scope facts untouched by not upserting at
  // all — and report a non-secret not-ready outcome for the operator to retry.
  const granted = await listGrantedScopes(longToken)
  if (granted === null) return back(clientId, 'verify_failed')

  await upsertConnection({
    clientId,
    provider: PLATFORM_PROVIDERS.META,
    accessToken: match.pageToken,
    refreshToken: '', // Meta issues no refresh token; re-consent is the renewal path.
    tokenExpiry: expiry,
    accountId: match.pageId,
    displayName: match.pageName,
    scopes: granted,
    lastSyncedAt: new Date(),
  })

  // The publishing reauthorisation fails closed: only report ready when the
  // provider authoritatively confirmed pages_manage_posts. A declined grant
  // (authoritative list without it) stays visibly not-ready and cannot be
  // mistaken for success. Inbox connects (no intent) keep their existing outcome.
  if (intent === 'publishing') {
    return back(clientId, granted.includes(META_PUBLISH_SCOPE) ? 'publish_ready' : 'publish_not_granted')
  }

  return back(clientId, 'connected')
}
