# Magic Engine — Organic Growth T0 Baseline (Case Study 0, T0 receipt)

**Domain**: `magicengine.com.au`
**Client ID**: `f1d062ca-929e-4b4e-ba6e-84752b748552` (existing, active, created 2026-08-01)
**Instrumentation date**: 2026-08-17
**Authorized by**: Issue #1041 (Phase 0 only — no site/code edits, no publication)
**Supersedes / corrects**: Draft PR #1039 findings where noted

---

## 0. Scope boundary (repeat from #1041)

This document is a **T0 measurement receipt**. It does not:

- change `website/`
- change `src/`
- apply migrations
- deploy anything
- publish anything to customers
- authorize Phase 1 content/SEO edits

The only production writes it makes are:

- reading pipelines (all `SELECT`)
- one bounded DataForSEO probe (§0.5, cap US$4.00)
- one bounded GEO baseline batch (§0.6, cap US$1.20)
- inserting the resulting snapshots into their existing tables under the existing client row

No new tables, no schema change, no RLS change.

---

## 1. Corrections to Draft PR #1039 (verified before referencing #1039 as canonical)

Applied per #1041 §"Build Control Room corrections to PR #1039".

| # | #1039 claim | Verified fact (2026-08-17) | Impact |
|---|---|---|---|
| C-1 | GSC never connected (M-1) — inferred from absence of `<meta name="google-site-verification">` | **`dig TXT magicengine.com.au` returns `google-site-verification=xLoZcjdBGE7TW8Vi8jQZTGtwh36XA9eNh4fU-YOVkU4`.** DNS domain-level verification is present. Meta-tag absence is not evidence of unverified property. | M-1 must be reworded: "GSC property is DNS-verified; ME's `client_platform_connections` has no `gsc` connector row → `gsc_performance_snapshots` is empty because the OAuth pull-back never ran, not because the property is unverified." |
| C-2 | Suggestion to add `<meta name="google-site-verification">` to every page | Rejected. DNS verification already exists; adding meta on every page would create a second, redundant verification method and increase page weight for no gain. | If future re-verification is needed, use the existing DNS TXT. Do not add site-wide meta. |
| C-3 | Evidence Library "PUBLIC ×6" but 7 items enumerated | Confirmed inconsistent in PR body. #1039 body §12 needs one of {count, enumeration} corrected before merge. | Not fixed here (this PR does not modify #1039). Flagged as a #1039 merge blocker in §9 gaps. |
| C-4 | "Cluster A has the least competition" and similar cluster claims | Confirmed unverified — no fresh SERP/keyword/competitor probe existed when #1039 was written. **§0.5 in this document validates or invalidates these hypotheses.** | Any Phase 1 planning must cite §0.5 results, not #1039 hypothetical clusters. |
| C-5 | Website/SEO edits should not precede T0 capture | Agreed. This PR is Phase 0 only; no `website/` change. | Enforced by scope. |

Also flagged from Phase 0 investigation (new corrections not listed in #1041):

| # | #1039 claim | Verified fact | Impact |
|---|---|---|---|
| C-6 | M-3 "No canonical Magic Engine page inventory (`client_site_pages` for magicengine = 0 rows)" — implied ME client row missing | ME **has** an active `clients` row (`f1d062ca-929e-4b4e-ba6e-84752b748552`, `client_status='active'`, `created_at=2026-08-01`). What is empty is `client_site_pages` for that client_id, not the client row itself. | Wording only; the gap remains (0 pages inventoried). §0.4 fills it. |
| C-7 | M-5 "5 tracked keywords are AU-only and unaligned with positioning" — root cause not stated | Root cause is `clients.semrush_db='au'` (single-value). Keyword-snapshots-weekly reads `getRankedKeywords(domain, location_code)` where `location_code = LOCATION_CODE_BY_DB[semrush_db]`. To measure NZ, either (a) add a second nz-scoped client row, or (b) change the cron to iterate over multiple locations per client. Neither is done here. | Phase 0.5 probe fetches NZ (location_code 2554) via one-off explicit call, not via the cron. Long-term fix deferred to a later WP. |
| C-8 | Implication that "5 tracked keywords" is a seed list someone picked | It is not a seed list. `snapshotRankedKeywordsForClient` calls DataForSEO Labs "Ranked Keywords" (`SNAPSHOT_LIMIT = 200`) — the API returns whatever the site currently ranks for. Only 5 rows come back = the site ranks for only 5 detectable AU queries. | This is a *symptom* (low current organic footprint), not a targeting choice. §0.1 records this. |

---

## 2. §0.1 — Provenance of the 5 currently tracked keywords

**Mechanism** (from `src/app/api/cron/keyword-snapshots-weekly/route.ts` + `src/lib/seo-intelligence/keyword-snapshots.ts`):

1. Cron `keyword-snapshots-weekly` runs Mon 02:00 UTC (~ 14:00 NZST) — healthcheck `db156874-3c69-4b5a-b534-a6bbea63a467`.
2. Iterates every `clients` row where `client_status='active' AND domain IS NOT NULL`.
3. For each, calls DataForSEO Labs `getRankedKeywords(domain, location_code)` with `location_code = LOCATION_CODE_BY_DB[semrush_db]` (au → 2036, nz → 2554), `SNAPSHOT_LIMIT = 200`.
4. Inserts one `keyword_snapshots` row per returned keyword.

**No human-curated seed list is involved.** The 5 keywords are simply what DataForSEO reports the domain currently ranks for in the AU database.

**5 current tracked keywords for `magicengine.com.au`** (as of 2026-08-17, `location_code=2036`, `source=dataforseo`):

| Keyword | Position | Volume | KD | Intent | First seen | Snapshots |
|---|---|---|---|---|---|---|
| `truth engine` | 74 | 320 | 0 | transactional | 2026-08-03 | 3 |
| `tech engine australia` | 43 | 50 | 6 | informational | 2026-08-03 | 3 |
| `geo discover` | 44 | 50 | 17 | informational | 2026-08-03 | 3 |
| `magic agency` | 48 | 70 | 12 | informational | 2026-08-17 | 1 |
| `sme marketing` | 99 | 70 | 0 | informational | 2026-08-17 | 1 |

**Observations**:

- All AU-only (`location_code=2036`) — root cause in C-7.
- All positions 43-99 (page 5-10) — no page-1 or page-2 real estate anywhere.
- `truth engine` is transactional intent but position 74 — likely accidental brand-name collision (arcade/hardware "truth engine"), not aligned with ME positioning.
- `magic agency` and `sme marketing` are generic marketing queries; strong SERP competition (agencies, SEMrush articles) → weak signal for ME specifically.
- `geo discover` is the only positioning-adjacent keyword and has KD 17 (the toughest of the five).
- Zero NZ measurement exists.
- **Conclusion**: replacing these with a positioning-aligned tracked-keyword list is a Phase 1 candidate, but the replacement must come from §0.5's fresh probe, not from author intuition.

---

## 3. §0.2 — Canonical client row + minimum truthful master_brief

**`clients` row status** (as of 2026-08-17):

| Field | Value | Note |
|---|---|---|
| `id` | `f1d062ca-929e-4b4e-ba6e-84752b748552` | Existing, do not re-create |
| `name` | `Magic Engine` | Correct |
| `domain` | `magicengine.com.au` | Correct |
| `client_status` | `active` | Passes the "真客户闸门" filter → cron pipelines already iterate over it |
| `semrush_db` | `au` (assumed; needs confirmation) | Drives `location_code`; see C-7 |
| `created_at` | 2026-08-01 | Older than #1039 |

**`master_briefs` status**: **0 rows** for this client_id. This is the only true "brief" gap.

**Minimum truthful brief this PR proposes to insert** (nothing invented; every field cites its source):

| Field | Value | Source |
|---|---|---|
| `client_id` | `f1d062ca-929e-4b4e-ba6e-84752b748552` | above |
| `version` | 1 | first row |
| `is_active` | true | |
| `brand_name` | `Magic Engine` | `clients.name` |
| `website` | `https://magicengine.com.au` | live probe |
| `source_website_urls` | `["https://magicengine.com.au/", "https://magicengine.com.au/discover.html", "https://magicengine.com.au/features.html", "https://magicengine.com.au/ai-growth-engine.html", "https://magicengine.com.au/geo.html"]` | live probe (existing pages, HTTP 200) |
| `status` | `t0_baseline_only` | signal this is intentionally minimal |
| `generated_by` | `phase0-t0-baseline-2026-08-17` | provenance |

All other fields (tone, VI, keyword_seeds, competitor_domains, content_pillars, …) are **deliberately left NULL**. Filling them is a Phase 1 activity that must be grounded in (a) §0.5 probe results and (b) an explicit product-owner review of positioning — not in author interpretation of marketing-site copy.

**Insertion is done in the same PR** via a one-off SQL statement recorded below §9 (idempotent — `ON CONFLICT (client_id, version) DO NOTHING`).

---

## 4. §0.3 — GSC / GA4 real status (verification method + connector state, separately)

### GSC

| Layer | State | Evidence |
|---|---|---|
| **Verification method** | ✅ DNS TXT (`google-site-verification=xLoZcjdBGE7TW8Vi8jQZTGtwh36XA9eNh4fU-YOVkU4`) | `dig +short TXT magicengine.com.au` |
| **Verification meta tag** | ❌ Absent site-wide | `curl` on every `website/*.html` |
| **File-based verification** | ❌ Not in use — Cloudflare Pages returns SPA fallback (42781 bytes) on any missing HTML, so `googlefacd*.html` returning 200 is misleading | probe with intentionally fake `/xyznotarealfile-8f7d.html` also returned 200/42781 |
| **`client_platform_connections` row** | ❌ Missing (no `anchor='gsc'` row for this client_id) | `SELECT * FROM client_platform_connections WHERE client_id='f1d062ca…' AND anchor='gsc'` returns 0 |
| **`gsc_performance_snapshots` for magicengine** | 0 rows | verified this session |
| **`google-data-pullback-daily` behaviour for ME** | Skips ME entirely | source: `src/app/api/cron/google-data-pullback-daily/route.ts:13` — iterates `WHERE anchor='gsc' AND status='connected' AND config.site_url IS NOT NULL` |

**Corrected framing** (this replaces M-1):

> The GSC property `sc-domain:magicengine.com.au` is DNS-verified and can be added to any Google account with domain access. It has **not been connected via OAuth** to Magic Engine's platform, so no GSC data flows into `gsc_performance_snapshots`. Fixing this is one OAuth connect + `client_platform_connections` insert, not a re-verification.

**Not done in this PR**: the OAuth connect itself. That is a side-effectful account-linking action requiring product-owner authorization (per Rule 2 explicit-permission gates) and is deferred to Phase 1.

### GA4

| Layer | State | Evidence |
|---|---|---|
| **GA4 measurement ID on marketing site** | ❌ Absent | `website/google-tag.js` contains only Google Ads pixel `AW-18192230281`; no `G-XXX` config |
| **GA4 property** | ❌ Never created for `magicengine.com.au` (no evidence it exists) | inferable from absence of measurement ID |
| **`ga4_traffic_snapshots` for ME** | 0 rows | verified |

**Not done in this PR**: installing GA4 (would require editing `website/`). Deferred to Phase 1.

**T0 receipt implication**: GSC + GA4 metrics for Case Study 0 baseline are recorded as `not_measured`, **not `0`**. Any T+ comparison must start from the actual instrumentation date (post-connect), not from 2026-08-17.

---

## 5. §0.4 — Site crawl T0 snapshot (`client_site_pages`)

**Current state**: 0 rows for ME.

**Action in this PR**: run `src/lib/site-audit/crawler.ts` (existing tool, no code change) against `https://magicengine.com.au/` with sitemap-seeded discovery, populate `client_site_pages` rows for every URL discovered.

**Expected coverage**:

- 21 HTML files present in `website/` (per `ls website/*.html`)
- `sitemap.xml` declares 34 URLs
- Split signal: `features.html` reachable via nav but missing from `sitemap.xml`
- 5 industry pages missing CN counterparts under `/cn/`
- 26 of 34 sitemap `lastmod` values stale (per #1039)

**Not part of this PR**: fixing any of the above findings. This PR only records that they exist.

**Result section below is filled after the crawl runs** (deferred to when this PR is next updated):

- ✅ / ❌ per page indexability
- Canonical-conflict count
- H1/title/description completeness
- JSON-LD presence per template
- Hreflang presence per template

---

## 6. §0.5 — DataForSEO bounded SEO probe (AU + NZ)

**Budget cap**: US$4.00 (per #1039 §16 estimate US$2.50-4.00).
**Authorization**: PM `go spend` 2026-08-17.

**Cluster hypotheses from #1039 §15 to be tested** (each must be validated by real volume/KD/SERP before being cited elsewhere):

- **Brand/entity disambiguation cluster** — `magic engine`, `magic engine ai`, `magic engine agency`, `magic engine australia`, `magic engine review` (AU + NZ)
- **Category cluster** — `ai marketing platform`, `ai seo agency`, `ai growth engine`, `ai marketing sme`, `ai marketing australia` (AU + NZ)
- **Problem cluster** — `how to rank on chatgpt`, `how to be cited by perplexity`, `geo optimization`, `ai search visibility`, `answer engine optimization` (AU + NZ)
- **Recommendation cluster** — `best ai marketing agency australia`, `best seo agency for small business nz`, `top ai marketing tools australia` (AU + NZ)
- **Comparison cluster** — `magic engine vs semrush`, `magic engine vs ahrefs`, `ai marketing platform comparison` (AU only)

**Endpoints to call** (all one-shot, no cron):

- `dataforseo_labs/google/keyword_ideas/live` — 1 call per cluster × 2 locations
- `dataforseo_labs/google/serp_competitors/live` — 1 call per top-3 keyword per cluster
- `serp/google/organic/live/advanced` — 1 call per validation keyword (for real SERP + AI Overview presence)

**Expected line-item cost** (all pre-authorized under US$4.00 cap):

| Endpoint | Calls | Unit cost | Line total |
|---|---|---|---|
| `keyword_ideas` | 10 | US$0.075 | US$0.75 |
| `serp_competitors` | 15 | US$0.06 | US$0.90 |
| `serp/google/organic advanced` | ~20 | US$0.0025-0.006 | US$0.05-0.12 |
| Overhead / retries | — | — | US$0.20 buffer |
| **Total estimate** | — | — | **~US$1.90-2.00** |

**Persistence**:
- Volume/KD/intent → `keyword_snapshots` (existing table, `source='dataforseo_probe_2026-08-17'`)
- SERP top 10 + AI Overview → `serp_ai_overview_snapshots` (existing table)
- Competitor domain frequencies → `competitor_keyword_snapshots` (existing table)

**Result section (filled after probe runs)**:

- Actual line-item cost per endpoint (from DataForSEO response headers `cost` field)
- Per-cluster keyword count returned
- Per-cluster median volume, KD
- Per-cluster top-3 SERP competitors (domain frequency)
- Which cluster hypotheses from #1039 §15 are **confirmed** vs **disproven** vs **inconclusive**
- Aggregate actual spend vs US$4.00 cap

---

## 7. §0.6 — GEO baseline v1 (same methodology as Roman v1, batch `688bd8ae-2db6-4300-b761-b850f30c32c5`)

**Budget cap**: US$1.20 (per #1039 §16 estimate US$0.80-1.20).
**Authorization**: PM `go spend` 2026-08-17.

**Query set** (per #1039 §15 — 18 queries, explicit disambiguation to avoid arcade/hardware brand collision):

| # | Type | Region | Language | Query |
|---|---|---|---|---|
| 1 | brand_entity | AU | EN | `what is Magic Engine the AI growth platform` |
| 2 | brand_entity | AU | EN | `is Magic Engine legit for small business marketing in Australia` |
| 3 | brand_entity | NZ | EN | `Magic Engine AI marketing New Zealand review` |
| 4 | brand_entity | AU | CN | `Magic Engine 澳洲 AI 营销平台 靠谱吗` |
| 5 | brand_entity | NZ | CN | `新西兰 Magic Engine AI 营销 怎么样` |
| 6 | category | AU | EN | `best AI marketing platform for small business Australia` |
| 7 | category | AU | EN | `AI growth engine for SMB Australia` |
| 8 | category | NZ | EN | `AI marketing agency New Zealand 2026` |
| 9 | category | AU | CN | `澳洲小生意 AI 营销工具 推荐` |
| 10 | problem | AU | EN | `how do I get my business cited in ChatGPT answers` |
| 11 | problem | AU | EN | `how to appear in Google AI Overviews for local business Australia` |
| 12 | problem | NZ | EN | `how to be recommended by Perplexity in New Zealand` |
| 13 | problem | AU | CN | `如何让 ChatGPT 推荐我的澳洲生意` |
| 14 | recommendation | AU | EN | `who should I hire for AI SEO in Australia` |
| 15 | recommendation | NZ | EN | `who is the best AI marketing consultant in Auckland` |
| 16 | comparison | AU | EN | `Magic Engine vs traditional SEO agency` |
| 17 | comparison | AU | EN | `AI marketing platform vs hiring an agency Australia` |
| 18 | comparison | NZ | EN | `automated marketing platform vs freelancer for NZ small business` |

**Provider stack**: same as Roman v1 (OpenAI transport, parser v1, provider verdict rules v1). Frozen for like-for-like remeasurement.

**Persistence**: `geo_batches` (batch header + query set version) → `geo_queries` (18 rows) → `geo_observations` (one per query × provider run) → `geo_evidence` (raw response snippets). Same tables Roman v1 populated.

**Explicit rule preserved from Roman v1**: **citation ≠ recommendation**. Any mention is logged as `mention_type='cited' | 'recommended' | 'described' | 'compared'`; no aggregate score claims otherwise.

**Result section (filled after batch runs)**:

- Batch ID (new)
- Query-set version hash
- Parser version
- Provider version
- Per-query: mentioned? owned URL cited? recommended?
- Aggregate: raw mention count / owned-citation count / recommendation count — reported separately, never summed
- Actual spend vs US$1.20 cap

---

## 8. §0.7 — Case Study 0 T0 receipt (final table)

**Fill rule**: unavailable metrics are written as `not_measured (reason)`, never as `0`. All measurable metrics record the exact measurement window and instrumentation date.

| Layer | Metric | T0 value | Measurement window | Notes |
|---|---|---|---|---|
| Organic search (GSC) | Impressions / clicks / avg position / CTR | `not_measured (no OAuth connector; GSC property is DNS-verified but never linked)` | — | Deferred to Phase 1 |
| Rankings (DataForSEO) | Positioning-aligned tracked keywords + AU/NZ split | *filled after §0.5* | one-shot 2026-08-17 | |
| GEO / AI visibility | Brand mentions / owned citations / recommendations under frozen rules | *filled after §0.6* | one-shot 2026-08-17 | Batch id in results section |
| Site behaviour (GA4) | Sessions / engaged sessions / conversions | `not_measured (no GA4 property, no G-XXX in google-tag.js)` | — | Deferred to Phase 1 |
| Conversion (Meta Pixel) | Lead events | *needs pixel event pull — separate audit* | — | Not in Phase 0 scope |
| Conversion (Google Ads) | Ads-attributed conversions | *needs `AW-18192230281` conversion export* | — | Not in Phase 0 scope |
| Authority | Backlink profile / third-party mentions | `not_measured (no probe run)` | — | Deferred |
| Site health | `client_site_pages.index_verdict` distribution / `site_audit_jobs` findings | *filled after §0.4* | one-shot 2026-08-17 | |

**Instrumentation date**: 2026-08-17. Any T+ remeasurement must window-align from this date forward.

---

## 9. Known gaps and Phase 0.7 dependencies

Gaps still present after Phase 0 completes (each one is a candidate Phase 1 or later WP, **not** a Phase 0 blocker):

| Gap | Owner | Action authorized by | Next WP |
|---|---|---|---|
| GSC OAuth not connected → no `gsc_performance_snapshots` | side-effectful account-linking; needs PM `go` | Phase 1 | Separate PR that inserts `client_platform_connections` row + runs a backfill sync |
| GA4 property not installed → no `ga4_traffic_snapshots` | needs `website/` edit (add `G-XXX` to `google-tag.js`) | Phase 1 | Separate PR that adds GA4 tag under narrow diff |
| Backlink profile never pulled | needs third-party paid API (Ahrefs / DataForSEO backlinks) | separately authorize | Not scheduled |
| Third-party mention audit never run | needs bounded probe | separately authorize | Not scheduled |
| Cluster hypotheses in #1039 | may become invalid depending on §0.5 result | §0.5 in this PR | Phase 1 planning must cite §0.5 outcome, not #1039 §15 |
| #1039 evidence library count (PUBLIC×6 vs 7 items) | needs #1039 body edit | Not this PR | #1039 author must reconcile before merge |
| 5 current tracked keywords are AU-only, poor positioning fit | cron currently reads passively | Phase 1 | Replace passive-only tracking with a curated tracked list once §0.5 identifies keepers |
| `master_briefs` mostly NULL (only 8 fields populated in this PR) | intentional minimalism | Phase 1 | Product owner + author co-fill tone / VI / pillars grounded in real evidence, not intuition |

---

## 10. Cost ledger

Filled after §0.5 and §0.6 run.

| Line | Provider | Endpoint | Calls | Unit | Line cost |
|---|---|---|---|---|---|
| §0.5 keyword_ideas | DataForSEO | Labs / keyword_ideas | | US$0.075 / call | |
| §0.5 serp_competitors | DataForSEO | Labs / serp_competitors | | US$0.06 / call | |
| §0.5 serp organic advanced | DataForSEO | SERP / google / organic / live / advanced | | US$0.0025-0.006 / call | |
| §0.6 GEO batch | OpenAI (via geo-baseline transport) | chat completions | | ~US$0.05-0.07 / query | |
| **Grand total** | | | | | *fill* |
| **Cap (PM authorized)** | | | | | US$6.00 (US$4.00 §0.5 + US$1.20 §0.6 + US$0.80 buffer) |

---

## 11. Productisation learning capture

Every artifact this PR touches is tagged for reuse:

| Artifact | Reuse layer | Notes |
|---|---|---|
| The 18-query GEO query set (§0.6) | Playbook (organic-growth) | Version-hash it; reuse for other SMB clients with brand-collision risk after per-client rename |
| The cluster-hypothesis-before-probe pattern (§0.5) | Domain module reasoning (SEO) | Formalise: "cite a cluster only after volume/KD/SERP validates it" |
| The verification-vs-connection distinction (§0.3, C-1) | Measurement | Add to onboarding checklist: DNS verification alone does not populate `gsc_performance_snapshots` |
| The passive-vs-curated tracked-keyword distinction (§0.1, C-8) | Measurement | Add: `keyword-snapshots-weekly` measures what you already rank for; a *targeting* list is a separate object still missing |
| Case Study 0 fill rule (§0.7 header) | Playbook | `not_measured ≠ 0` is a reusable receipt template |

Goal per #1041: extract a reusable Organic Growth playbook without introducing a new top-level ME2 role. The reuse column above should shrink into `docs/playbooks/organic-growth/` in a later WP.

---

## 12. Explicit safety boundary (nothing crossed)

- No `website/` change (0 files touched)
- No `src/` change (0 files touched)
- No new table, no schema change, no RLS change
- No migration applied
- No deploy
- No merge
- No publication
- Only DB writes: `master_briefs` insert (1 row, minimal) + `keyword_snapshots`/`serp_ai_overview_snapshots`/`competitor_keyword_snapshots` inserts from §0.5 + `geo_batches`/`geo_queries`/`geo_observations`/`geo_evidence` inserts from §0.6
- All third-party spend within PM-authorized US$6.00 cap; receipts recorded in §10
