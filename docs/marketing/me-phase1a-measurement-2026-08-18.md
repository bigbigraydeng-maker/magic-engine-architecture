# Magic Engine — Phase 1A measurement wiring (for #1052)

**Client**: `f1d062ca-929e-4b4e-ba6e-84752b748552` (Magic Engine, active) — canonical, no duplicate created.
**Domain**: `magicengine.com.au`
**Parent**: #1041 (T0 Freeze Gate) · Companion frozen T0 receipts: #1043 (main) + #1051 (GEO 18/18)
**Authorized by**: Issue #1052 body + Build Control Room comment 2026-08-17T12:56:56Z

**What this PR does**: prepares GSC and GA4 for connection, ships a re-runnable verification script, gives PM an exact runbook.

**What this PR does NOT do**: no OAuth on PM's behalf (Google's UI-based consent — cannot be automated); no GA4 property creation (Google Analytics UI action); no deploy (Cloudflare Pages deploy is a human step); no SEO/copy/content edit; no merge; no migration.

---

## 1. Files changed

| File | Change | Reason |
|---|---|---|
| `website/google-tag.js` | Add GA4 opt-in scaffold alongside existing Google Ads pixel (25 → 60 lines). Placeholder `GA4_MEASUREMENT_ID = 'G-XXXXXXXXXX'` gated so the tag is a **silent no-op** until PM replaces it with a real ID. | Only site-code change required. Because `website/app.js:198 trackMarketingEvent` already calls `window.gtag('event', name, payload)`, every existing event (`discover_submit`, `contact_submit`, `discover_start`, `ads_landing_view`, `ads_primary_cta_click`, …) automatically flows to GA4 once configured — no per-event wiring needed. |
| `scripts/phase1a/verify-measurement.ts` | New — reads (a) `client_connectors`, (b) `platform_oauth_connections`, (c) `gsc_performance_snapshots`, (d) `ga4_traffic_snapshots`, (e) if preconditions are met, attempts one live GSC pullback via `lib/gsc/client.fetchGscSnapshot`. Prints a status table. | Re-runnable pre/post PM's OAuth completion — the SAME script tells you what's ready and what's still pending. Doubles as the receipt for "first successful snapshot" (§4). |
| `docs/marketing/me-phase1a-measurement-2026-08-18.md` | This document. | PR receipt + runbook + T0 evidence. |

**Deliberately unchanged**:
- `website/app.js` — event firing is already GA4-shaped (`gtag('event', name, payload)`). Adding parallel calls would duplicate events.
- `website/*.html` — no SEO/copy/content change.
- All `src/` — no server-side change; ME's existing GSC/GA4 pipelines (`/api/auth/google/connect`, `/api/auth/google/callback`, `/api/clients/[id]/gsc/sync`, `/api/clients/[id]/ga4/sync`, `/api/clients/[id]/connectors/[anchor]/connect`) are used as-is.

---

## 2. Runbook (steps PM performs — automation cannot reach these)

**These are Google's OAuth consent screen + Google Analytics/Search Console UI steps. Neither this repo nor any script can perform them on PM's behalf** (per safety rules: no OAuth completion on user's behalf; per Google's product design: consent screens require human interaction).

### 2.1 GSC — one-time OAuth grant + property selection

Precondition: `magicengine.com.au` is already DNS-verified in Google Search Console under `bigbigraydeng@gmail.com` (per Phase 0 §0.3 — DNS TXT contains `google-site-verification=xLoZcjdBGE7TW8Vi8jQZTGtwh36XA9eNh4fU-YOVkU4`).

1. In a signed-in browser, visit:
   `https://app.magicengine.com.au/dashboard/clients/f1d062ca-929e-4b4e-ba6e-84752b748552/settings?tab=connect`
2. Click the **Connect Google Search Console** button. This starts `POST /api/auth/google/connect` which redirects to Google's OAuth consent screen with `webmasters.readonly` + `analytics.readonly` scopes.
3. On Google's screen, choose the account that owns `sc-domain:magicengine.com.au` (i.e. `bigbigraydeng@gmail.com`). Approve.
4. Google redirects back to `/api/auth/google/callback`. The callback stores encrypted tokens in `platform_oauth_connections` (provider=`google_gsc`), inserts an OAuth row in `google_oauth_tokens`, and sets `client_connectors.status='partial'` (OAuth done, site_url still pending).
5. Back on the settings tab, the GSC Property Panel now offers a **site_url** dropdown pre-populated from the GSC API. Choose **`sc-domain:magicengine.com.au`**. This calls `POST /api/clients/[id]/connectors/gsc/connect` which sets `client_connectors.status='connected'` with `config.site_url='sc-domain:magicengine.com.au'`.
6. Trigger the first backfill: `POST /api/clients/f1d062ca-929e-4b4e-ba6e-84752b748552/gsc/sync` (either via the panel button or a bearer-authenticated curl). This writes the first `gsc_performance_snapshots` row.

### 2.2 GA4 — create property + web stream + get Measurement ID + deploy

1. In `https://analytics.google.com`, signed in as `bigbigraydeng@gmail.com`:
   - **Admin → Create Property** → name: `Magic Engine (magicengine.com.au)` → time zone `Pacific/Auckland` → currency `NZD`.
   - **Data Streams → Add stream → Web** → URL: `https://magicengine.com.au` → stream name: `Marketing site (magicengine.com.au)`.
   - Copy the **Measurement ID** (looks like `G-1234ABCDXY`).
2. In this PR's branch (`research/me-phase1a-gsc-ga4-wire`), edit `website/google-tag.js` line 17: replace `var GA4_MEASUREMENT_ID = 'G-XXXXXXXXXX';` with the real ID from step 1c. Commit + push.
3. Product Owner review + merge PR (**not automatic — separate authorization per #1052 boundary**).
4. Deploy `website/` to Cloudflare Pages (existing deploy pipeline).
5. Record the **exact deploy timestamp** — this is the **instrumentation start**. Any GA4 data before this timestamp is `not_measured`, never `0`.

### 2.3 GA4 — connect via ME UI (mirrors GSC flow)

Once the OAuth from §2.1 step 3 is done, the same token covers GA4 (`analytics.readonly` scope was requested). On the settings tab, choose the GA4 property in the connector panel — this inserts `client_connectors` (anchor='ga4', status='connected', config.property_id=`<numeric>`). The existing `POST /api/clients/[id]/ga4/sync` cron/endpoint then pulls into `ga4_traffic_snapshots`.

---

## 3. Verification script

`scripts/phase1a/verify-measurement.ts` is the single source of truth for "is this wired yet?".

Usage:
```
cd <this worktree>
npx tsx --env-file=.env.local scripts/phase1a/verify-measurement.ts
```

Output tells PM exactly what's ready and what isn't, then — if all preconditions are met — attempts one live GSC pullback so the pipeline is proven end-to-end.

Safe to run before OAuth (returns "❌ skip"), safe to run after OAuth (returns "✅ snapshot fetched"), safe to re-run daily.

---

## 4. T0 evidence — pre/post PM runbook execution

### 4.1 Pre-OAuth state (initial, 2026-08-18 early)

```
[1] client_connectors rows: 0
[2] platform_oauth_connections rows: 0
[3] gsc_performance_snapshots rows matching magicengine.com.au: 0
[4] ga4_traffic_snapshots rows: 0
Preconditions:
   GSC connector connected + site_url set: ❌
   Google OAuth token active:              ❌
[5] Skipping live pullback — preconditions not met.
```

### 4.2 Post-OAuth state (after PM completed §2.1 + §2.2, 2026-08-18)

```
[1] client_connectors rows: 2
     google-ads: status=connected site_url=(none) connected_at=2026-08-17T13:27:51Z
     gsc:        status=connected site_url=sc-domain:magicengine.com.au connected_at=2026-08-17T13:37:55Z
[2] platform_oauth_connections rows: 1
     google_gsc: status=active display=bigbigraydeng@gmail.com scopes=5
[3] gsc_performance_snapshots rows matching magicengine.com.au: 0
[4] ga4_traffic_snapshots rows: 0
Preconditions:
   GSC connector connected + site_url set: ✅
   Google OAuth token active:              ✅
[5] Pullback returned null — expected for a newly-connected property with no data yet.
     GSC typically needs 24-48h after verification before search-analytics rows exist.
```

**Instrumentation timestamps (captured automatically, not manually asserted)**:

| Signal | Timestamp | Source |
|---|---|---|
| GSC connector connected | **2026-08-17T13:37:55Z** | `client_connectors.connected_at` for `anchor='gsc'` |
| GSC OAuth token granted | ≈ 2026-08-17T13:28Z (token_expiry - 3600s) | derived from `platform_oauth_connections.token_expiry=2026-08-17T14:28:16Z` |
| GA4 property + Web stream created | 2026-08-18 (PM confirmed) | `analytics.google.com` UI action |
| GA4 tag deployed to `magicengine.com.au` | **not yet — deferred** | Cloudflare Pages deploy is a separate authorization |
| First GSC snapshot row | expected 24-48h after 2026-08-17T13:37Z (i.e. earliest 2026-08-19) | `gsc_performance_snapshots.created_at` |
| First GA4 event | expected within seconds of Cloudflare deploy | `ga4_traffic_snapshots.created_at` after cron pull |

**Any T+ remeasurement window must start no earlier than the corresponding row above.** Per PM run rule "not_measured ≠ 0", the period before each timestamp remains `not_measured`, never `0`.

### 4.3 Real identifiers (public, non-secret — safe to record)

| System | Identifier | Notes |
|---|---|---|
| Google Ads pixel | `AW-18192230281` | Pre-existing, unchanged |
| Google Tag container | `GT-PBNTPHCJ` | Informational — PM's GTM container "Magic Engine Agency". This PR loads `gtag.js` **directly** (not via GTM), so `GT-PBNTPHCJ` is not referenced in `website/google-tag.js`. Future migration to GTM would replace the direct loader with the GTM snippet. |
| GA4 Measurement ID | `G-4JL29VZ1L4` | Written to `website/google-tag.js:16` this PR (replaces `G-XXXXXXXXXX` placeholder). Public identifier — visible in page source once deployed. |
| GA4 Stream ID | `15451115029` | Recorded here for provenance; not written into any code path (Data API queries key on Property ID, not Stream ID). |
| GA4 Property ID | **pending PM's next step** | Needed when inserting the GA4 `client_connectors` row (`config.property_id`). PM captures this via ME's UI: after Google OAuth done, ME's GA4 property picker calls `/api/clients/[id]/ga4-properties` and PM selects — the Property ID is written into the connector config at that point. |
| OAuth grantor account | `bigbigraydeng@gmail.com` | Same account that owns the DNS-verified GSC property (`sc-domain:magicengine.com.au`). |
| OAuth scopes granted | `webmasters.readonly`, `analytics.readonly`, `indexing`, `userinfo.email`, `openid` | 5 scopes — covers both GSC pullback and GA4 pullback via the same token. |

---

## 5. Boundary compliance (per #1052)

- ✅ No SEO / copy / content optimisation performed
- ✅ No articles, insights, research, or case studies created
- ✅ No change to `magicengine_geo_baseline_v1` query set
- ✅ No duplicate Magic Engine client (canonical client `f1d062ca…` reused as-is)
- ✅ No merge, no deploy
- ✅ No migration applied
- ✅ No unrelated refactor
- ✅ No connector / OAuth row inserted from this PR (deferred to PM's §2 completion; inserting a stub row would either fail the enum check or leave the pipeline in a half-wired state)

---

## 6. Known gaps (this PR closes some, flags others)

| Gap | Status | Owner |
|---|---|---|
| GSC OAuth connector | ✅ **Done** — PM completed OAuth grant 2026-08-17T13:37Z; connector `status='connected'` with `site_url=sc-domain:magicengine.com.au` | Done |
| GA4 property + Web stream | ✅ **Done** — Measurement ID `G-4JL29VZ1L4`, Stream ID `15451115029` | Done |
| GA4 Measurement ID in code | ✅ **Done** — `website/google-tag.js:16` now `G-4JL29VZ1L4` (replaces placeholder) | Done |
| GA4 `client_connectors` row (property_id in config) | ⚠️ Pending — PM picks property via ME's UI (`/dashboard/clients/[id]/settings?tab=connect` → GA4 property panel) after this PR merges. That flow captures Property ID and inserts `client_connectors` row for `anchor='ga4'`. | PM |
| `website/` deploy to Cloudflare Pages | ⚠️ **Not deployed** — separately authorised per #1052 boundary | PM |
| First GSC snapshot row | ⚠️ Pending — GSC needs 24-48h after verification to populate search-analytics; verify script attempted pullback and got null (expected). Re-run the verify script after 2026-08-19 to catch the first non-null pullback. | Automated once GSC has data |
| First GA4 event | ⚠️ Pending — visible in GA4 Realtime once `website/` deploys with the new `google-tag.js` | Automated after deploy |

---

## 7. Explicit non-actions

- No copy or SEO change on any `website/*.html`.
- No re-crawl of magicengine.com.au (Phase 0 §0.4's crawl remains authoritative).
- No re-run of `magicengine_geo_baseline_v1` (Phase 0.6b's completed batch remains authoritative).
- No pre-instrumentation "backfill" of `ga4_traffic_snapshots` — that data does not exist; it is `not_measured`, not `0`.
- No cross-client OAuth token copy (would be a security anti-pattern; each client gets its own token via its own OAuth flow).
