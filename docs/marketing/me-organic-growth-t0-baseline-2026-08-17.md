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
| C-9 | #1039 §6 "**1 Blocker** — `ai-growth-engine.html` contains 3 empty `<h3>` tags after the DAPE section and is 6.3 KB vs 18-23 KB siblings" | **Does not reproduce.** Phase 1B verification 2026-08-18 on `origin/main`: `grep '<h[1-6]></h[1-6]>' website/ai-growth-engine.html` returned **0 matches**. The page has 7 non-empty `<h3>` tags (4 in the DAPE section + 3 in industry cards), existing `Service` + `FAQPage` JSON-LD, a FAQ section, and a CTA. The 6.3 KB byte count is because the file is minified into a single line (legitimate build style), not because content is thin. | The #1039 "1 Blocker" no longer justifies a P1 fix. Either the Phase 0 finding was recorded inaccurately, or the defect was silently fixed between the #1039 discovery pass and Phase 1B execution (no `website/`-touching PR merged in between, so "silently fixed" is unlikely — inaccurate original finding is the more probable explanation). Verified in PR #1056 item 1 verdict = **skipped, defect not reproducible**. |

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

**`master_briefs` status**: **0 rows** for this client_id.

**Minimum brief needed to run Phase 0 measurements**: **zero rows required.**

- §0.4 site crawl reads only `clients.domain` — no brief needed.
- §0.5 DataForSEO probe reads only `clients.domain` + `clients.semrush_db` — no brief needed. Cluster hypotheses come from #1039 §15, are explicit in this PR (§0.5), and get validated by the probe itself.
- §0.6 GEO baseline reads a `geo_query_sets` row (frozen 18-query set in §0.6 below) — no brief needed; the query set is a first-class artifact.

Therefore this PR **does not insert a `master_briefs` row**. Populating it is a Phase 1 activity that must be co-decided with the product owner and grounded in (a) §0.5 probe results and (b) an explicit positioning review — never in author interpretation of marketing-site copy.

**What a truthful Phase 1 seed would look like** (documented here so the follow-up PR does not have to re-derive it):

| Field | Value | Source |
|---|---|---|
| `brand_name` | `Magic Engine` | `clients.name` |
| `website` | `https://magicengine.com.au` | live probe |
| `source_website_urls` | 5 canonical HTML URLs on the domain | live probe (HTTP 200) |
| `status` | `t0_baseline` | (varchar(20) limit) |
| `generated_by` | `phase0-2026-08-17` | (varchar(20) limit) |

All other fields (tone, VI, keyword_seeds, competitor_domains, content_pillars, target_audience, brand_voice, …) **remain NULL until Phase 1** co-decides them with product owner sign-off.

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

**Result** (crawl ran 2026-08-18, job `8a94879b-48d1-4171-990c-742492e94a29`):

| Metric | Value |
|---|---|
| URLs discovered (sitemap-seeded) | 34 |
| URLs crawled successfully | 34 |
| Pages classified into `client_site_pages` | 33 (1 classification failure) |
| `client_site_pages` rows for `f1d062ca…` | **33** (was 0) |
| `page_type` histogram | `service` × 25 · `other` × 5 · `about` × 2 · `blog` × 1 |
| Max pages cap (script arg) | 50 |
| Rate limit (ms between requests) | 1500 |
| Cost | US$0.00 (no paid provider) |

**Observations against #1039**:

- 34 URLs discovered aligns with #1039's "sitemap declares 34 URLs" claim ✓
- `page_type` bias to `service` × 25 reflects industry-pages-heavy site structure
- 1 classification failure = 1 URL was fetched but the classifier could not confidently type it — recorded as such in `client_site_pages.crawl_status`, not silently omitted
- Detailed per-URL findings (indexability, hreflang, JSON-LD) require a follow-up query on `client_site_pages` and are Phase 1 work; this row inventory is the T0 deliverable for §0.4

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

**Result** (probe ran 2026-08-18, final run id `861aa847-5a0a-4544-a9f9-717da714e1ad`; receipt at `scripts/phase0/receipts/dataforseo-probe-2026-08-18.json`):

**Cluster medians (validated per-location)**:

| Cluster | AU median vol | AU median KD | NZ median vol | NZ median KD | Verdict |
|---|---|---|---|---|---|
| brand_entity | 9,900 | 57 | 590 | 49 | **Confirmed collision risk** — high KD both markets; other "magic engine" entities dominate SERP. Disambiguation must be the top brand-page tactic. |
| category | 1,300 | **24** | 260 | **24** | **Sweet spot**: moderate volume, low competition both markets. Category-page investment should target these. |
| problem | 6,600 | 42 | 30 | 11 | **Split**: AU high volume + moderate competition (good); NZ near-empty (30 vol) — problem-page traffic will be AU-only until NZ demand grows. |
| recommendation | 1,900 | 39 | 260 | 33 | **Contested**: mid-vol mid-KD both markets. Need owned-page + third-party mentions to compete. |
| comparison | 1,900 | 31 | 320 | 33 | **Actionable**: high-volume comparison queries with KD ≤ 33 both markets — case-study 0 candidate territory. |

**SERP competitor intersections** (AU top 5):

| Domain | Intersections (of 15) | Avg position |
|---|---|---|
| `youtube.com` | 5 | 18.8 |
| `business.gov.au` | 4 | 22.3 |
| `linkedin.com` | 4 | 5.0 |
| `instagram.com` | 3 | 26.7 |
| `facebook.com` | 3 | 35.7 |
| `amazon.com.au` | 3 | 17.3 |
| `weareengine.com.au` | 2 | 20.5 |

**SERP competitor intersections** (NZ): **empty (0 domains returned)** — `magicengine.com.au` has no measurable NZ SERP presence to intersect against. This is a first-class negative finding.

**Rows persisted**: 191 rows in `keyword_snapshots` (AU × 97 + NZ × 94), `source='dataforseo_probe_2026-08-18'`.

**Which #1039 §15 hypotheses were tested**:

| Hypothesis (from #1039 §15) | Verdict |
|---|---|
| "Brand disambiguation is a real cluster to defend" | ✅ Confirmed (KD 57/49) |
| "Category cluster is meaningfully sized" | ✅ Confirmed (AU 1300 vol / KD 24) |
| "Problem cluster has AU + NZ demand" | ⚠️ Confirmed for AU only; NZ demand is thin (30 vol) |
| "Recommendation cluster is actionable" | ⚠️ Contested (KD 39/33) |
| "Comparison cluster is our leverage point" | ✅ Confirmed (mid-vol, KD ≤ 33) |
| "Cluster A has the least competition" | ❌ Rejected as framed — the *category* cluster has lowest KD, not any "Cluster A"; naming was ambiguous |

**Cost**: US$0.87 for this final successful run. See §10 cost ledger for cumulative including two earlier failed-persistence runs.

**Explicit non-findings**: no probe hit an AU Overview presence for magicengine (SERP data pulled but AI Overview column empty for all rows), no Roman-style local-pack signal (site is not a local business).

---

## 7. §0.6 — GEO baseline v1 `magicengine_geo_baseline_v1`

**Budget cap**: US$1.20 (per #1039 §16 estimate US$0.80-1.20).
**Authorization**: PM `go spend` 2026-08-17. PM 2026-08-18 clarification: *copy Roman methodology, NOT Roman queries*.

### 7.1 Manifest (frozen — required by PM before live run)

| # | Field | Value | Source |
|---|---|---|---|
| 1 | `geo_query_set` version | `magicengine_geo_baseline_v1` | new (this PR) |
| 1a | `geo_query_sets.id` | `a6a1b189-3cb9-4c84-aa55-4604e72342df` | inserted by `scripts/phase0/geo-baseline-seed.ts` |
| 2 | Exact 18 queries | see §7.2 | this PR |
| 3 | Why each query belongs | see §7.2 rationale column | this PR |
| 4 | Provider | `openai` | copied from Roman v1 |
| 5 | Model / version | `gpt-5-search-api-2025-10-14` | copied from Roman v1 batch `688bd8ae…` |
| 6 | Parser version | `geo-baseline/parser/v1` | copied from Roman v1 |
| 6a | Metric rules version | `geo-baseline/rules/v1` | copied from Roman v1 |
| 7 | Expected cost | 18 × ~$0.05 avg (Roman actual) = ~US$0.90; worst case 18 × $0.066 = US$1.188 | derived from Roman v1 actual $0.6153/12 |
| 8 | Budget ceiling | US$1.20 (batch) · US$0.066 (per-observation) · US$6.00 (total Phase 0) | PM 2026-08-17 |

**What was copied from Roman verbatim**: query_set schema · provenance fields · parser version · provider config · cost recording · observation classification rules · owned-domain policy structure.

**What is new for ME**: entity (Magic Engine, `magicengine.com.au`) · 18 queries · owned-domains policy (single verified domain via DNS TXT, per §0.3).

### 7.2 Query set — 18 queries with inclusion rationale

**Cohort**: `locale=en-AU market=au sample=1` (single cohort per invocation; CN + separate NZ cohorts deferred to Phase 1). All 18 queries carry their own `locale/market` in `geo_queries` for future multi-cohort runs.

**brand_entity ×3**:

| Key | Query | Why it belongs |
|---|---|---|
| `brand_1` | *"what is Magic Engine the AI growth platform for small business"* | Direct entity query with disambiguating tail; measures whether AI can distinguish us from arcade brand |
| `brand_2` | *"is Magic Engine legit for AI marketing in Australia"* | Legitimacy check — measures whether owned reviews / press appear vs. absence |
| `brand_3` | *"Magic Engine AI marketing New Zealand reviews"* | Cross-market brand presence — validates whether NZ audiences see us at all |

**category ×4**:

| Key | Query | Why it belongs |
|---|---|---|
| `cat_1` | *"best AI marketing platform for small business Australia 2026"* | Peak commercial category query; measures whether we surface unaided |
| `cat_2` | *"AI growth engine for SMB in Australia"* | Uses our positioning phrase; tests whether the phrase is neutral or already ours |
| `cat_3` | *"AI marketing agency New Zealand"* | NZ category recall — parallel to `cat_1` to detect market split |
| `cat_4` | *"AI-powered SEO platform for small business Australasia"* | Adjacent-category framing (SEO not marketing); measures cross-vertical recall |

**problem ×4**:

| Key | Query | Why it belongs |
|---|---|---|
| `prob_1` | *"how do I get my business cited in ChatGPT answers"* | Core GEO problem in ME language; measures whether we own the "solve" narrative |
| `prob_2` | *"how to appear in Google AI Overviews for a local business in Australia"* | Adjacent problem (AI Overview vs. answer engines); measures breadth of authority |
| `prob_3` | *"how to be recommended by Perplexity for New Zealand small business"* | NZ + Perplexity — checks whether recommendation-engine authority extends by market and by engine |
| `prob_4` | *"how to measure AI search visibility for my business"* | Measurement/tooling framing — our own product territory (matches the GEO Baseline we're running) |

**recommendation ×4**:

| Key | Query | Why it belongs |
|---|---|---|
| `rec_1` | *"who should I hire for AI SEO in Australia"* | AU services recall; measures whether we appear vs. traditional agencies |
| `rec_2` | *"who is the best AI marketing consultant in Auckland"* | NZ + city-specific + person-form ("consultant" not "agency") — tests owned-page vs. review-site dominance |
| `rec_3` | *"best AI-first marketing platform for Australian SMBs"* | Platform recommendation not services; separates SaaS narrative from service narrative |
| `rec_4` | *"recommend an AI marketing tool that works for New Zealand small business"* | NZ SMB tool recommendation; conversational phrasing to test recommendation vs. list-recall behavior |

**comparison ×3**:

| Key | Query | Why it belongs |
|---|---|---|
| `cmp_1` | *"Magic Engine vs traditional SEO agency for small business"* | Direct branded comparison; measures whether we get to state our own case or a competitor states it for us |
| `cmp_2` | *"AI marketing platform vs hiring a freelance marketer in Australia"* | Category comparison against non-obvious substitute (freelancer, not agency); tests substitute recall |
| `cmp_3` | *"automated marketing platform vs agency retainer for NZ small business"* | NZ + business-model comparison; measures whether the "automation replaces retainer" narrative is owned by us or a competitor |

### 7.3 Explicit run rules preserved from Roman v1 (per PM 2026-08-17)

- **citation ≠ recommendation** — a mention with a link is logged as `cited`, not `recommended`
- **mention ≠ success** — any mention is a raw signal; aggregation without classification is prohibited
- **`not_measured` ≠ `0`** — an un-run query is `not_attempted`, not `0` mentions
- Owned-page attribution: **not computable this round** — reason: "客户页面台账为空，且本轮是否做页面级归属尚未裁定 (Roman R4 / WP00 U2)"

### 7.4 Live result — batch `af1de17d-89b3-4274-a762-de2ba4b6f1e8`

Live run 2026-08-18. **Terminated by cost-trust guardrail after 2 attempts.** Per GEO contract §7.2, **this is not a complete baseline**.

| Field | Value |
|---|---|
| Batch id | `af1de17d-89b3-4274-a762-de2ba4b6f1e8` |
| Status | `partial` (script exit code 2) |
| Coverage | Planned 18 / Attempted 2 / Succeeded 1 / Failed 1 |
| Cost | **unknown** (`source_ambiguous`) — see stop reason |
| Stop reason | `provider_cost_untrusted` — provider reported $0.0888375 on obs #2, above declared ceiling $0.066; runtime stopped further calls (fail-closed) |
| Observed error codes | `provider_cost_untrusted` |

**Per-query outcome (1 of 18)**:

| Query key | Cluster | outcome_ok | Notes |
|---|---|---|---|
| `brand_1` | brand_entity | ✅ true | Response ~2000 chars, includes owned-domain citations to `magicengine.com.au?utm_source=openai` — classified as **`cited`** per rule "citation ≠ recommendation" |
| `brand_2` | brand_entity | ❌ false | `provider_cost_untrusted` — provider reported cost $0.0888 > ceiling $0.066; obs written as failed, no evidence usable |
| `brand_3` … `cmp_3` | (16 remaining) | — | **`not_attempted`** (batch stopped after brand_2) |

**Rules applied to the one successful observation** (`brand_1`):
- The response called Magic Engine "an AI-powered growth platform for SMBs in Australia and New Zealand" and cited `magicengine.com.au` several times via `?utm_source=openai` tracking.
- Per rule "citation ≠ recommendation" → **classified `cited`** (owned-URL surfaced). NOT counted as a recommendation because the response describes/explains rather than prescribes.
- Per rule "mention ≠ success" → the batch outcome is still `partial`, not "success", regardless of `brand_1` succeeding.

### 7.5 What Phase 0 delivers vs. defers for §0.6

| Delivered | Deferred to Phase 1 |
|---|---|
| Query set `magicengine_geo_baseline_v1` version-locked and 18 queries persisted in `geo_queries` — reusable for any re-run | Complete 18/18 baseline — requires PM to raise per-observation ceiling above ~$0.09 (Roman precedent: PO raised ceiling mid-run) |
| Cohort schema + methodology copy from Roman v1 proven end-to-end (preflight → plan → provider → parser → store) | CN and NZ-cohort runs |
| First-ever ME AI-visibility signal: `brand_1` yields a substantive response with owned citations, so the runtime is functional | Page-level owned-page attribution (per Roman R4 / WP00 U2 — still un-adjudicated) |
| Fail-closed guardrail exercised and honored (didn't blow past declared cap) | — |

---

## 8. §0.7 — Case Study 0 T0 receipt (final table)

**Fill rule**: unavailable metrics are written as `not_measured (reason)`, never as `0`. All measurable metrics record the exact measurement window and instrumentation date.

| Layer | Metric | T0 value | Measurement window | Notes |
|---|---|---|---|---|
| Organic search (GSC) | Impressions / clicks / avg position / CTR | `not_measured (no OAuth connector; GSC property is DNS-verified but never linked)` | — | Deferred to Phase 1 |
| Rankings (DataForSEO, pre-probe) | 5 passively-tracked AU keywords | `truth engine` pos 74 · `tech engine australia` pos 43 · `geo discover` pos 44 · `magic agency` pos 48 · `sme marketing` pos 99 | 3 weekly snapshots 2026-08-03..2026-08-17 | See §2. All page-5+. NZ: `not_measured (no nz-scoped client row)`. |
| Rankings (DataForSEO, T0 probe) | Cluster-aware AU + NZ keyword universe | 191 rows landed (AU 97 + NZ 94). Cluster medians in §6. | one-shot 2026-08-18 | See §6 for cluster verdicts. |
| GEO / AI visibility | Brand mentions / owned citations / recommendations under frozen rules | 1 successful obs (`brand_1`): **1 cited** (owned URL surfaced), **0 recommended**, **0 described**. 17 queries `not_attempted`. 1 query `provider_cost_untrusted` (fail). Cost `unknown (source_ambiguous)`. | Batch `af1de17d-89b3-4274-a762-de2ba4b6f1e8` started 2026-08-18 | Per PM rule: `not_attempted ≠ 0`. This is not a complete baseline (§7.4). |
| Site behaviour (GA4) | Sessions / engaged sessions / conversions | `not_measured (no GA4 property; google-tag.js has only Google Ads AW-18192230281)` | — | Deferred to Phase 1 |
| Conversion (Meta Pixel) | Lead events | `not_measured (pixel event pull not scoped in Phase 0)` | — | Not in Phase 0 scope |
| Conversion (Google Ads) | Ads-attributed conversions | `not_measured (AW-18192230281 conversion export not scoped in Phase 0)` | — | Not in Phase 0 scope |
| Authority | Backlink profile / third-party mentions | `not_measured (no probe run — separately authorizable)` | — | Deferred |
| Site health | `client_site_pages` inventory | 33 pages inventoried (was 0). Type histogram: `service` × 25 · `other` × 5 · `about` × 2 · `blog` × 1 | Job `8a94879b-48d1-4171-990c-742492e94a29` completed 2026-08-18 | Per-page findings (canonical / hreflang / JSON-LD / index_verdict) are downstream queries on the same rows |

**Instrumentation date**: 2026-08-17 (PR opened) / 2026-08-18 (probes ran). Any T+ remeasurement must window-align from **2026-08-18** forward — that is the first date on which GEO / DataForSEO probe / site inventory rows exist for magicengine.

**Explicit non-metrics (per PM run rules)**:
- No aggregate score of "AI visibility" is produced from 1/18 observations. `partial` batches do not aggregate.
- No claim that `brand_1`'s citation = a recommendation.
- No claim that "0 recommended" out of 1 observation means we're not recommended — it means we haven't measured recommended-ness on 17 queries yet.

---

## 9. Known gaps and Phase 0.7 dependencies

Gaps still present after Phase 0 completes (each one is a candidate Phase 1 or later WP, **not** a Phase 0 blocker):

| Gap | Owner | Action authorized by | Next WP |
|---|---|---|---|
| Full 18/18 GEO baseline (not just 1/18) | needs per-observation ceiling raised above ~$0.09 (Roman precedent: PO raised to $0.08 mid-run; ME's brand_2 hit $0.0888) → will also raise batch budget above the current $1.20 | Requires PM to authorize higher ceiling + budget (still within US$6 Phase 0 total) | Phase 0.6-follow-up PR that re-runs against the *same* `magicengine_geo_baseline_v1` query_set (no re-seed) with new manifest values |
| GSC OAuth not connected → no `gsc_performance_snapshots` | side-effectful account-linking; needs PM `go` | Phase 1 | Separate PR that inserts `client_platform_connections` row + runs a backfill sync |
| GA4 property not installed → no `ga4_traffic_snapshots` | needs `website/` edit (add `G-XXX` to `google-tag.js`) | Phase 1 | Separate PR that adds GA4 tag under narrow diff |
| Backlink profile never pulled | needs third-party paid API (Ahrefs / DataForSEO backlinks) | separately authorize | Not scheduled |
| Third-party mention audit never run | needs bounded probe | separately authorize | Not scheduled |
| Cluster hypotheses in #1039 | may become invalid depending on §0.5 result | §0.5 in this PR | Phase 1 planning must cite §0.5 outcome, not #1039 §15 |
| #1039 evidence library count (PUBLIC×6 vs 7 items) | needs #1039 body edit | Not this PR | #1039 author must reconcile before merge |
| 5 current tracked keywords are AU-only, poor positioning fit | cron currently reads passively | Phase 1 | Replace passive-only tracking with a curated tracked list once §0.5 identifies keepers |
| `master_briefs` mostly NULL (only 8 fields populated in this PR) | intentional minimalism | Phase 1 | Product owner + author co-fill tone / VI / pillars grounded in real evidence, not intuition |

---

## 10. Cost ledger (final)

| Line | Provider | Endpoint | Calls | Unit (est.) | Line cost | Notes |
|---|---|---|---|---|---|---|
| §0.5 run 1 (upsert failed) | DataForSEO | Labs / keyword_ideas | 10 | $0.075 | $0.750 | Persistence bug, data ephemeral; charge still incurred |
| §0.5 run 1 competitors | DataForSEO | Labs / competitors_domain | 2 | $0.060 | $0.120 | |
| §0.5 run 2 (accidental re-run) | DataForSEO | keyword_ideas + competitors | 10 + 2 | mixed | $0.870 | My mistake — ran probe again while checking DB (see PR body for accountability) |
| §0.5 run 3 (final, persisted) | DataForSEO | keyword_ideas + competitors | 10 + 2 | mixed | $0.870 | onConflict bug fixed; 191 rows persisted |
| §0.6 GEO baseline batch | OpenAI (via geo-baseline transport) | responses (search-api model) | 2 | ~$0.05 avg (Roman precedent) | ~$0.100 | Cost recorded `unknown (source_ambiguous)` in DB; ~$0.10 is an upper-bound estimate from token-count math |
| **Cumulative estimated total** | | | | | **~US$2.71** | |
| **Cap (PM authorized total)** | | | | | US$6.00 | Total spend headroom remaining: ~US$3.29 |

**Accountability note on §0.5 waste**: two of the three DataForSEO runs (US$1.62) did not produce persisted data due to (a) an `onConflict` column mismatch bug in the first run and (b) my own accidental re-invocation of the script during verification. Only the third run's 191 rows are in `keyword_snapshots`. All spend stayed within the PM-authorized US$6.00 total cap. This is documented rather than concealed because the "cost ledger receipt" principle requires honest cost accounting, not favorable-outcome-only accounting.

**Cost per useful data unit** (for future reference):
- Site crawl (§0.4): US$0.00 / 33 pages → US$0.00/page
- DataForSEO T0 probe (§0.5, useful part): US$0.87 / 191 keyword rows → ~US$0.005/keyword row
- GEO baseline (§0.6): ~US$0.10 / 1 usable observation → ~US$0.10/observation (17× worse than a complete baseline would be; hence the partial-batch penalty)

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
- Only DB writes: `client_site_pages` inserts from §0.4 + `keyword_snapshots`/`serp_ai_overview_snapshots`/`competitor_keyword_snapshots` inserts from §0.5 + `geo_batches`/`geo_queries`/`geo_observations`/`geo_evidence` inserts from §0.6. **No `master_briefs` write** — populating that is a Phase 1 activity requiring product-owner sign-off.

---

## 13. T0 Freeze Gate (attached 2026-08-18 per PM ruling)

This section is the appendix PM asked for. It supersedes any earlier Gate framing produced in-session; if a prior sentence in this document conflicts with §13, §13 wins. It is a **PR-approval checklist and dependency sequence**, not a re-analysis of §0 evidence.

### 13.1 Framing corrections landed in this Gate

Four earlier framings the PM explicitly overturned. Recorded so future readers don't re-inherit them:

- **Not one Gate over all four PRs.** #1043 and #1051 are T0 **evidence receipts** with no website effect; they must be merged before any Phase 1 production intervention. They are not gated behind measurement wiring.
- **#1055 pre-deploy Gate cannot require "GA4 connector = connected".** The current production connector-update endpoint has a bug — it is what #1055 is fixing. Gating deploy on the broken endpoint working is circular.
- **`platform_oauth_connections.created_at` is not the GSC data start.** It is the OAuth grant receipt only. Data-start requires the first non-null pull and the first snapshot `collected_at` — recorded separately (§13.6).
- **Reference Loop is not on this Gate.** Removed from the dependency graph. Handled by a separate future Issue / Draft PR.

### 13.2 Gate A — #1043 T0 main receipt · review + merge only, no deploy

| # | Condition | State |
|---|---|---|
| A1 | Phase 0 §0.1–§0.7 doc complete | ✅ |
| A2 | 8 corrections to #1039 + C-9 landed | ✅ |
| A3 | 191 `keyword_snapshots` + 33 `client_site_pages` evidence rows verifiable in prod | ✅ |
| A4 | Every unavailable metric written as `not_measured (reason)`, never `0` | ✅ |
| A5 | No `website/` / `src/` / migration / deploy effect | ✅ |
| A6 | Double review pass | ⚠️ pending PM |

### 13.3 Gate B — #1051 GEO baseline 18/18 · review + merge only, no deploy

| # | Condition | State |
|---|---|---|
| B1 | batch `a2f09f81-ab65-4a25-b323-567fd70f8dff` status=`completed`, 18/18 succeeded | ✅ |
| B2 | 4 `cited` / 0 `recommended` / 14 `not_present` classification reproducible from `geo_evidence` rows | ✅ |
| B3 | No aggregate score summing across classification categories | ✅ |
| B4 | Same "no side effect" clause as A5 | ✅ |
| B5 | Double review pass | ⚠️ pending PM |

### 13.4 Gate C — #1055 measurement wiring · merge + deploy prerequisite (measurement window owns this Gate)

| # | Condition | Owner |
|---|---|---|
| C1 | Double review pass | Measurement window |
| C2 | Targeted tests pass (GA4 connector repair path + rollback) | Measurement window |
| C3 | GA4 Property ID `550203806` confirmed | Measurement window |
| C4 | Standard PATCH path implemented, replacing the buggy production endpoint | Measurement window |
| C5 | No production data written pre-deploy (do not poke the connector before the fix ships) | Measurement window |
| C6 | Rollback / error semantics explicit | Measurement window |

**Explicitly not required for C:** GA4 connector already `connected` state. That is Gate D's outcome, not C's precondition.

### 13.5 Gate D — production GA4 property selection (`550203806`) · after #1055 deploy

| # | Condition | Owner |
|---|---|---|
| D1 | Write `property_id=550203806` into `client_connectors.config` via the fixed standard PATCH path | Measurement window (via UI or PATCH after deploy) |
| D2 | Connector validation pass (fixed endpoint returns success) | Measurement window |
| D3 | Record connector `connected_at` timestamp | Automatic (DB) |

### 13.6 Gate F — Instrumentation timestamp discipline (replaces the earlier "one timestamp per signal" shortcut)

**GSC — 4 required timestamps, never collapsed:**

| Signal | Source | State |
|---|---|---|
| GSC OAuth grant (receipt only, NOT data start) | `platform_oauth_connections.created_at` | Recorded — do not use as data start |
| GSC connector `connected_at` | `client_connectors.connected_at` for `anchor='gsc'` | Recorded — do not use as data start |
| GSC first successful pull time | Moment `fetchGscSnapshot` first returns non-null | Pending (GSC API 24–48h lag) |
| GSC first snapshot `collected_at` | First row's `collected_at` in `gsc_performance_snapshots` for magicengine | Pending first successful pull |

**GA4 — 4 required timestamps, never collapsed:**

| Signal | Source | State |
|---|---|---|
| GA4 tag production deploy time | Cloudflare Pages deploy record | Pending #1055 deploy |
| GA4 connector / property validation time | Gate D completion | Pending Gate D |
| GA4 first successful sync time | First non-empty response from `/api/clients/[id]/ga4/sync` | Pending tag deploy |
| GA4 first valid snapshot `collected_at` | First row in `ga4_traffic_snapshots` with real events | Pending real traffic |

**Red line — "request succeeded but no data yet" ≠ "traffic data exists".** The former proves connection; the latter requires real events. These two timestamps stay separated and never substitute for each other. Any T+ remeasurement window must start no earlier than the corresponding "first valid snapshot" row above, per the "`not_measured` ≠ `0`" run rule.

### 13.7 Gate E — #1056 Phase 1B technical SEO · merge + deploy prerequisite

| # | Condition | State |
|---|---|---|
| E1 | #1055 already merged and deployed | Pending C + D |
| E2 | GA4 connector validation pass (Gate D complete) | Pending D |
| E3 | Instrumentation timestamps recorded (Gate F, all 4+4) | Pending D + first real events |
| E4 | 5 SEO decisions table + C-9 cross-linked between #1043 and #1056 | ✅ |
| E5 | Double review pass | ⚠️ pending PM |

### 13.8 Dependency sequence (must run in this order)

```
A.  #1043 review → merge                     evidence only, no deploy
B.  #1051 review → merge                     evidence only, no deploy
        (A and B may proceed in parallel; both are pure evidence)
        │
        ↓
C.  #1055 review → merge + deploy            includes GA4 connector fix + rollback
        │
        ↓
D.  Production selects GA4 property 550203806, validates connector,
    records timestamps (via the fixed standard PATCH path)
        │
        ↓
E.  #1056 review → merge + deploy            Phase 1B surgical technical SEO
        │
        ↓
F.  T+7 / T+14 / T+28 remeasurement          Case Study 0 comparison points
```

**Out of scope for this Gate**: Reference Loop. Handled separately by a future Issue / Draft PR — not a #1055 release blocker, not a Freeze Gate condition.

### 13.9 What this Gate does not do

- Does not by itself merge or deploy anything.
- Does not make any of A / B / C / D / E happen — only orders and conditions them.
- Does not require §0 evidence to be re-run; it treats §0.1–§0.7 as frozen inputs.
- Does not decide whether Phase 1 succeeds — that is Case Study 0's T+ comparison, not this Gate's.
- Does not authorize the measurement window to skip C1–C6 for expediency. Each condition is independently gating.
- All third-party spend within PM-authorized US$6.00 cap; receipts recorded in §10
