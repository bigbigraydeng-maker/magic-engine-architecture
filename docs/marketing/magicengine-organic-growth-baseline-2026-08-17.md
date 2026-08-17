# Magic Engine — Organic Growth Baseline (magicengine.com.au)

> **Scope**: Discovery / Analysis only. Read-only pass over Magic Engine's own public site and Magic Engine's own production data.
> **Date**: 2026-08-17 (NZST) · **Author**: Claude Code (research window) · **Branch**: `research/magicengine-organic-growth-baseline`
> **Intended reader**: ChatGPT Build Control Room, which will decide the first intervention batch.
> **What this is not**: an implementation plan, a page rewrite, a website change, a migration, a new module, a new Agent, an authorization to spend, or a claim to have measured what has not been measured.
> **Cost this pass**: **US$0.00** of new provider spend (see §18).

---

## 1. Executive Summary

Magic Engine's own website (`magicengine.com.au`) has the **surface area of a mature product site** — 21 English pages + 16 Chinese mirror pages, dedicated industry pages (real-estate, travel, local-services), a well-crafted `llms.txt`, an AI-bot-friendly `robots.txt`, security headers, dedicated GEO-oriented pages (`ai-search`, `ai-search-faq`, `ai-search-snippets`, `geo`), Google Ads + Meta Pixel wired.

It has **almost none of the measurement infrastructure** we ship to paying customers.

Concretely:

| Layer | State | Evidence |
|---|---|---|
| Own `clients` row | ✅ exists, but empty shell | `id = f1d062ca-929e-4b4e-ba6e-84752b748552`, created 2026-08-01, `primary_keywords=[]`, `competitor_domains=[]`, `brief_completed_at=NULL`, `onboarding_completed_at=NULL`, `industry=NULL` |
| Master brief | ❌ missing | `master_briefs` where `website ILIKE '%magicengine%'` → 0 rows (the only "magic" brief is "Magic Lab Class" — a different product) |
| GSC connection | ❌ never connected | `gsc_performance_snapshots WHERE site_url ILIKE '%magicengine%'` → 0 rows · no `google-site-verification` meta on any page |
| GA4 connection | ❌ never connected | `ga4_traffic_snapshots` distinct clients = 2 (CTS + Oztop); Magic Engine absent · `google-tag.js` only has Google Ads AW-18192230281, no `G-XXX` GA4 tag |
| Site page inventory (crawl) | ❌ never crawled | `client_site_pages WHERE url ILIKE '%magicengine%'` → 0 rows |
| Diagnostic runs / findings | ❌ zero | `diagnostic_runs / diagnostic_findings` scoped to Magic Engine → 0 rows |
| AI Visibility snapshots | ❌ zero | `ai_visibility_snapshots` scoped to Magic Engine → 0 rows |
| GEO measurement baseline (WP08-shaped) | ❌ not established | `geo_query_sets` has 1 row (Roman v1); Magic Engine has none |
| Blog pipeline | ❌ zero authored under this client | `blog_posts WHERE client_id = f1d0…` → 0 rows |
| Keyword tracking | ⚠️ trivial — 5 seed keywords, AU only | `keyword_snapshots WHERE domain ILIKE '%magicengine%'` → 11 rows across 3 weekly snapshots for 5 keywords, all `location_code=2036` (AU); zero NZ (2554) |

The site is **being marketed** (Google Ads live, Meta Pixel firing) but is **not being measured**. Every claim any Magic Engine sales conversation makes about "we help you get found on Google and AI" is currently **evidence-poor when the subject is ourselves**.

**Highest-value first moves** (details in §10, ranked with Evidence → Why → Recommended action):

1. Connect Magic Engine's own GSC (installing verification tag + wiring the connector) — unlocks the only free source of truth for what Google already thinks the site is about.
2. Install GA4 on the marketing site — unlocks conversion telemetry for the `/discover` and `/contact` funnels the Google Ads spend already touches.
3. Fill Magic Engine's `master_brief` + `clients.primary_keywords` + `competitor_domains` — otherwise the seven cron jobs that would auto-serve this client silently no-op.
4. Fix four latent Technical SEO defects that cost nothing but currently do: `features.html` orphan (in navigation, not in sitemap); `ai-growth-engine.html` has 3 empty `<h3>` templates; four industry pages missing `hreflang`; three CTA pages have no JSON-LD.
5. Stand up Magic Engine's own GEO baseline v1 using the exact WP04A pipeline that produced Roman Baseline v1 — this is the Case Study 0 measurement engine (§13).

**Nothing below is a decision.** Nothing below is executed. The report ends at Draft PR.

---

## 2. Data Sources & Data Quality

| Source | Access | Fresh as of | Trust |
|---|---|---|---|
| Production Supabase (`glbdnayojixmexgofbsd`) | Read-only via Supabase MCP | Live | High — object-existence checks per WP00 §2 |
| `website/` static source in this repo | Read from disk (`origin/main` = e1da3930) | 2026-08-16 last mtime | High — Cloudflare Pages deploys directly from this |
| `robots.txt` / `sitemap.xml` / `llms.txt` on live site | Curl with real UA | 2026-08-17 | High — matches repo files |
| Homepage HTML via HTTP | Curl (WebFetch returned 403 for default UA; curl with browser UA returned 200, 42,781 bytes) | 2026-08-17 | High |
| Sub-agent inventory of `src/lib/{gsc,ga4,keywords,seo-*,site-audit,blog,dataforseo,geo*,page-optimization,growth}` | Read-only Explore agent | 2026-08-17 | High |
| GSC 28d / 90d data | **Not available** — connector never wired for this client | — | 🔴 **MEASUREMENT GAP #1** |
| GA4 organic sessions, key events, AI referral | **Not available** — GA4 property never installed on the marketing site | — | 🔴 **MEASUREMENT GAP #2** |
| DataForSEO fresh keyword volumes for candidate themes | **Not called this pass** (fail-closed on cost — see §18) | — | ⚠️ deferred to Recommended First Intervention Batch (§16) |
| ChatGPT / Perplexity / Gemini live queries against Magic Engine | **Not run** (would require a GEO baseline v1, which is a separately authorized run per WP00 §11.4) | — | Query set candidate proposed in §15 for later authorization |

**Definitions used consistently in this report** (WP00 §5 vocabulary):

- **Evidence** = a raw observation with a source, a method, a time, and a rejection reason if absent.
- **Finding** = an interpretation of Evidence.
- **Prescription** = a concrete recommendation.
- **ActionCandidate** = a scoped, authorizable unit of work.
- **VerificationDefinition** = how we will later prove the ActionCandidate did or did not move the outcome.

`direct_owned_page_citation` and related GEO metrics are reported as `not_computable` where the underlying baseline does not exist yet, in line with WP08's frozen policy (Issue #883). We do not report zero when we mean "not measured."

---

## 3. Current Traffic Baseline

- **Organic traffic (GA4)**: not measured. Marketing site (`magicengine.com.au`) has no GA4 property tag installed (`google-tag.js` contains only `AW-18192230281`, no `G-XXX` config). The GA4 property backing the app (`app.magicengine.com.au`) is separate and out of scope.
- **Paid traffic (Google Ads)**: instrumented via `AW-18192230281`. Volume, cost, and conversion actions not queried this pass (would need Google Ads account access; separate scope from Organic Growth Baseline).
- **Meta Pixel**: firing via `2228804581237989` — instrumented but no organic baseline consumes it.
- **Direct / referral / social**: not measured.
- **Public database evidence**: `ga4_traffic_snapshots` distinct client_ids = 2 (`c000…` CTS Tours NZ, `d5c98811…` Oztop). Magic Engine is not in that list. `website_lead_events` and `website_publish_jobs` were not queried in scope for magicengine domain filter — deferred.

**Conclusion**: There is no answer to "how many people visit magicengine.com.au organically per month" from the platform's own data. This is the single largest measurement gap on the platform side and blocks every subsequent conversion, funnel, or attribution question below.

---

## 4. Organic Search Baseline

### 4.1 GSC-side (Google's ground truth): NONE AVAILABLE

- `gsc_performance_snapshots WHERE site_url ILIKE '%magicengine%'` → **0 rows**
- No `<meta name="google-site-verification">` on any of the 21 English HTML files (grep = 0 hits).
- Consequence: we cannot answer any of the 15 GSC-derived questions the brief asked for (28d / previous 28d / 90d / previous 90d / total impressions / CTR / avg position / branded vs non-branded / top queries / top pages / high-impression low-CTR / position 4-10 / position 11-20 / position 21-50 / pages gaining / pages losing / mismatch / cannibalisation).
- This is **not** an estimation — it is an absence. No estimate is provided because none is honest to produce.

### 4.2 DataForSEO ranked-keyword weekly snapshot (partial substitute): 5 keywords, AU only

The `keyword-snapshots-weekly` cron (Mon 02:00 UTC) already pulls 5 seed keywords for `magicengine.com.au` from DataForSEO. All entries are `location_code=2036` (Australia); there is no NZ tracking.

| Keyword | Position (2026-08-17) | Search volume (AU) | KD | CPC (USD) | Intent |
|---|---|---|---|---|---|
| tech engine australia | 43 | 50 | 6 | — | informational |
| geo discover | 44 | 50 | 17 | — | informational |
| magic agency | 48 | 70 | 12 | 0.56 | informational |
| truth engine | 74 | 320 | 0 | 23.31 | transactional |
| sme marketing | 99 | 70 | 0 | — | informational |

Weekly history (3 snapshots: 2026-08-03, 2026-08-10, 2026-08-17): **positions have not moved** for any of the 5. `sme marketing` and `magic agency` do not appear on all three snapshots (missing on the two earlier).

**Findings:**

- All 5 tracked keywords rank **outside page 5** (position 43-99). Nothing is close to converting impressions to clicks.
- The seed set does not reflect Magic Engine's stated positioning: "AI growth engine for Australian and New Zealand businesses." Nothing here contains "AI growth", "AI marketing", "GEO", "generative engine optimisation", "AI visibility", "AI training", "SME AI", or any of the industry combinations the site's landing pages are actually built around.
- **Provenance question flagged as Known Unknown (§17)**: `clients.primary_keywords` for Magic Engine is empty (`[]`). Where the cron is drawing these 5 keywords from is not obvious — likely a fallback or a historical seed. This should be traced and either confirmed as intentional or replaced when §16 batch is authorized.

### 4.3 Branded vs non-branded

- Cannot be split without GSC. Deferred.

### 4.4 Ranking pages / mismatch / cannibalisation

- Cannot be computed without GSC. `client_site_pages` for magicengine has 0 rows, so we cannot even attempt cross-referencing site pages with SERP intent. Deferred.

---

## 5. Keyword / SERP Opportunities

Because §4 has no live GSC signal and this pass spent **US$0** on new DataForSEO calls (§18), the sections below are **structured hypotheses** derived from:

- The 21 English site pages' titles, meta descriptions, and H1s (§9)
- `llms.txt`'s canonical positioning
- The 5 tracked keywords in §4.2
- Public knowledge of Magic Engine's AU/NZ target market and product surface

**Every "opportunity" below carries a `confidence` flag.** Every entry marked as needing DataForSEO validation goes into §16.

### 5.1 Existing-page opportunities

These pages exist and are keyword-shaped; they simply have no live SERP data attached to them.

| Existing page | Likely primary theme | Cluster |
|---|---|---|
| `/ai-growth-engine` | "AI growth engine" · "AI operating loop for business" | Product |
| `/ai-search` | "AI search visibility" · "generative engine optimisation" · "GEO" | GEO |
| `/ai-search-faq` | "how does ChatGPT decide what to cite" · "AI search FAQ" | GEO |
| `/ai-search-snippets` | quote-ready snippet library for LLMs | GEO |
| `/geo` | "GEO meaning" · "generative engine optimisation NZ / AU" | GEO |
| `/ai-marketing-smes` | "AI marketing for SMEs" · "AI marketing Australia / NZ" | Category |
| `/ai-training` | "AI training for business teams" · "AI workshop NZ / AU" | Category |
| `/ai-automation` | "AI automation for business teams" · "AI automation NZ / AU" | Category |
| `/real-estate` | "AI for real estate agents NZ / AU" · "lead intelligence" | Industry |
| `/travel` | "AI marketing for travel operators NZ / AU" | Industry |
| `/local-services` | "local visibility" · "AI for local service businesses" | Industry |
| `/ads` | "Google Ads audit NZ / AU" · "Meta Ads diagnosis" | Bottom-funnel |
| `/discover` | "free growth diagnosis" · CTA page | Conversion |

### 5.2 Money-page gaps (commercial intent, no dedicated page)

Candidate money pages where Magic Engine has commercial intent and no page today:

- **Pricing / packages** — no `/pricing` page exists (STATE.md memory refers to "ME 收费页已上线 Cloudflare Pages" but the sitemap contains no `/pricing` URL and there is no `pricing.html` in `website/`). Buyers looking for `magic engine pricing`, `AI growth engine cost NZ`, `AI marketing subscription Australia` land on nothing.
- **Case Studies index** — no `/case-studies` or `/customers` page. This is the single largest missing money page.
- **Compare pages** — no `magic engine vs <competitor>` pages. Compare queries are high-intent bottom-funnel; competitors' entity pages usually rank there.
- **For agencies** — Magic Engine's stated buyer includes "AU/NZ marketing agencies" (per `/contact/page.tsx`) but no dedicated `/for-agencies` money page exists.
- **NZ-specific service pages** — the industry pages exist as AU/NZ bilingual, but there are no separate `/nz/*` or `/auckland/*` city-scoped landing pages. This blocks any NZ-city-specific paid or organic capture.
- **Chinese money pages for industry verticals** — `cn/local-services`, `cn/real-estate`, `cn/travel`, `cn/ai-growth-engine`, `cn/features` do not exist. If the Chinese-speaking segment is a real audience, the industry stack is monolingual today.

### 5.3 Article opportunities (informational / commercial-investigation)

Deferred to §11 (Article / Insight Backlog).

### 5.4 Topic clusters

Three real clusters emerge from the page inventory:

- **Cluster A — GEO / AI visibility**: `/geo`, `/ai-search`, `/ai-search-faq`, `/ai-search-snippets`. This is the strongest cluster the site currently supports. It is also aligned with Magic Engine's product differentiator.
- **Cluster B — AI operating loop for SMEs**: `/ai-growth-engine`, `/ai-marketing-smes`, `/ai-training`, `/ai-automation`. Category-shaped, competitive, generalist.
- **Cluster C — Industry-vertical growth systems**: `/industry-solutions`, `/real-estate`, `/travel`, `/local-services`. Sharpest commercial intent.

Cluster A is where Magic Engine has the least competition and the most product substance. Cluster C is where the money is closest. Cluster B is the widest and hardest.

---

## 6. Technical SEO Findings

Grouped by severity. Every finding is derived from a specific file or a specific header/response.

### 6.1 Blocker

- **B-1 `ai-growth-engine.html` contains 3 empty `<h3>` tags** (§ file). The page has 4 valid stage headers ("Discover / Analyse / Prescribe / Execute") followed by 3 empty `<h3>` tags in a template block. This is both a rendering defect and a schema signal that the page is incomplete. **Evidence**: `grep -oE '<h3[^>]*>[^<]{0,120}' /website/ai-growth-engine.html` returns 3 empty matches after the DAPE 4. **Consequence**: llms.txt directs LLM crawlers here as the canonical explanation of "how the Magic Engine operating loop works"; they land on a visibly incomplete page.

### 6.2 High

- **H-1 GSC verification never installed** — no page carries `<meta name="google-site-verification" content="…">`. Without verification, no GSC data can ever be collected, and no diagnosis in `docs/sops/keyword-gap-attack-playbook.md` Step 1 can be run against ourselves. **Evidence**: `grep -l 'google-site-verification' website/*.html` → 0 files.
- **H-2 GA4 property tag never installed on marketing site** — `website/google-tag.js` only initializes `AW-18192230281` (Google Ads). No `G-XXX` property. Result: `/discover` submissions and `/contact` interactions leave the paid ads tag but never feed GA4 for organic attribution. **Evidence**: `grep -oE 'G-[A-Z0-9]{6,}' website/*.js` → no matches.
- **H-3 `features.html` is orphan-in-sitemap** — the file exists (`website/features.html`, 13,722 bytes), is linked from `index.html` navigation (`href="/features"`), but is **not** listed in `sitemap.xml`. It has no `hreflang`, no CN mirror. **Consequence**: Google may still find and index it via the internal link, but the site is telling Google two contradictory things.
- **H-4 Four English pages missing `hreflang`** — `ai-growth-engine.html`, `local-services.html`, `real-estate.html`, `travel.html` have zero `hreflang` entries. All four have `lastmod=2026-08-05` in `sitemap.xml`, suggesting they were built after the hreflang standard was adopted for other pages. These are all pages the CN mirror is supposed to reference; the mirror pages don't exist yet either (see 5.2). **Evidence**: `grep -c 'hreflang' website/*.html` = 0 for these four.
- **H-5 Three high-intent pages have no JSON-LD** — `discover.html` (the primary CTA — Free Growth Diagnosis), `about.html`, `features.html`. `discover.html` is the conversion page for Google Ads spend and organic entry; missing at minimum `WebPage` + `Service` (or `HowTo`) schema.

### 6.3 Medium

- **M-1 No CN counterparts for industry pages** — `cn/local-services.html`, `cn/real-estate.html`, `cn/travel.html`, `cn/ai-growth-engine.html`, `cn/features.html` do not exist. If Chinese-speaking SMEs in AU/NZ are a real audience (llms.txt says they are), the industry pages currently give them nothing.
- **M-2 sitemap `lastmod` dates are stale** — 26 of 34 URLs have `lastmod=2026-06-02`. Live site files were re-saved on 2026-08-16 (per repo `ls -la`). Search engines will re-crawl more aggressively when `lastmod` accurately reflects change; the current pattern gives the opposite signal.
- **M-3 `styles.css` is 52 KB, unminified** — `_headers` sends `Cache-Control: public, max-age=86400` only for `assets/*.svg`; no cache directive documented for CSS/JS in the repo. Fine for a low-traffic site, worth revisiting when CWV becomes measurable.
- **M-4 Google Ads tag file has no consent-mode configuration** — `google-tag.js` uses classic `gtag('config', GOOGLE_ADS_ID)` without `consent_mode`. AU/NZ do not currently mandate this the way the EU does, but the pattern will fail an AU/NZ enterprise procurement checklist.

### 6.4 Low

- **L-1 `assets/og-card.svg` is a single OG image reused across all pages** (`property="og:image"` value on `index.html`, `discover.html` — same URL). Page-specific OG images help LinkedIn / X / Facebook shares of specific pages.
- **L-2 `_redirects` only contains two entries** (`/cn.html /cn/ 301`, `/cn/index.html /cn/ 301`). Any additional URLs discussed below (e.g., pricing) would need explicit redirects if their legacy paths change.

### 6.5 What is good (do not "fix")

- Cloudflare Content Signals block in `robots.txt` (`search=yes, ai-train=no, use=reference`) — clean, opinionated, on-brand.
- Explicit `Allow: /` for `OAI-SearchBot`, `ChatGPT-User`, `OAI-AdsBot`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Google-Extended` — this is exactly the pattern our own product recommends to customers.
- `_headers` ships all four standard security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`) and a permissive `X-Robots-Tag: index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1` — this is publishing-friendly and correct.
- Every one of the 21 English pages has **exactly one `<h1>`**, a unique `<title>`, a unique meta description, and a canonical URL. Baseline hygiene is intact.
- `llms.txt` exists, uses the AI-friendly linked-summary shape, and is entity-consistent with the homepage title. Very few AU/NZ SME sites have this today.
- Source HTML ≠ rendered HTML risk is **absent** — the site is static, so what a crawler sees is what a human sees.

---

## 7. GEO / AI Visibility Findings

### 7.1 Current state

- **No Magic Engine GEO baseline exists.** `geo_query_sets` has 1 row (Roman v1). `geo_batches`, `geo_observations`, `geo_evidence` contain 3 batches / 25 observations / 12 evidence rows — all attributable to Roman Baseline v1 (Issue #883). Magic Engine's own baseline has not been captured, and no query set has been proposed or locked for it.
- The site's own **GEO product pages** (`/geo`, `/ai-search`, `/ai-search-faq`, `/ai-search-snippets`) exist and carry `FAQPage` + `Question` + `Answer` schema, which is the structural pattern our product recommends. This means the surface is prepared for GEO measurement even though the measurement itself has never been run.
- `industry_ai_visibility_snapshots` has 5,221 rows across other industries, but a targeted query for `industry_code IN ('technology','marketing','saas','ai','professional_services','business_services')` OR question text containing "AI marketing" / "AI growth" / "GEO" / "generative engine" returned **0 rows**. There is no reusable industry query bank for the segment Magic Engine competes in.
- The reusable pipeline that produced Roman Baseline v1 is **runnable for Magic Engine** with a single script invocation: `npx tsx scripts/geo-baseline-run.ts --live` after setting `GEO_CLIENT_ID=f1d062ca-929e-4b4e-ba6e-84752b748552` and the frozen query set version, engine family, model version, locale, market, sample count, budget cap, per-call cap. Roman's live baseline cost US$0.708 for 12 queries × 1 sample.

### 7.2 Definitions we must not blur

Per WP08's frozen decisions (Issue #883, Product Owner audit):

- **answer success** ≠ **brand mention** ≠ **qualified mention** ≠ **recommendation** ≠ **owned-domain citation** ≠ **third-party citation**.
- "12 / 12 observations succeeded" means the model answered; it does not mean Magic Engine was mentioned.
- `direct_owned_page_citation` should be reported as `not_computable` until a canonical page inventory exists for Magic Engine (analogous to Roman's #930 prerequisite).

### 7.3 Findings

- **F-1 Site is GEO-ready structurally, GEO-invisible measurably.** The pages are shaped for citation (schema, snippet-length answers, `llms.txt`), but no run has ever confirmed a citation.
- **F-2 There is no canonical Magic Engine page inventory yet.** The 21 English URLs + 16 CN URLs above are the *file* inventory. The `client_site_pages` inventory (which is what `direct_owned_page_citation` requires) has 0 rows. Same shape as Roman's WP05 prerequisite (#930).
- **F-3 Owned-domain policy is straightforward** — `magicengine.com.au` is the only owned domain. No aliases in use (unlike Roman's `romanhu.com` migration). Owned-domain citation classification would be a one-line rule.
- **F-4 Entity ambiguity risk exists in AI answers** — a naive query like "What is Magic Engine?" is likely to conflate with power tools, arcade cabinets, game engines, or other "magic engine" brands. See §8 for entity findings.

### 7.4 Deferred

- Actual AI answer sampling: **not run**. Proposed query set in §15; live baseline batch registered as an ActionCandidate in §16.

---

## 8. Entity Findings

Canonical Magic Engine entity, per `llms.txt` (the strongest signal we control):

> Magic Engine is an AI growth engine for Australian and New Zealand businesses. It connects discovery, analysis, recommended actions, execution and outcome tracking.

Consistency check across owned surfaces:

| Surface | Consistent? | Evidence |
|---|---|---|
| `llms.txt` | ✅ canonical | "AI growth engine for Australian and New Zealand businesses" |
| `index.html` `<title>` | ✅ | "Magic Engine — AI Growth Engine for AU/NZ Businesses" |
| `index.html` H1 | ⚠️ different framing | "Turn business signals into growth actions." (behaviour) — not a category label |
| `index.html` og:title | ✅ | "Magic Engine — AI Growth Engine for AU/NZ Businesses" |
| `about.html` `<title>` | ⚠️ | "About Magic Engine — AI Upgrade, GEO & Training for AU/NZ Business" — introduces two new category words ("AI Upgrade", "Training") and switches "Businesses" → "Business" |
| `about.html` H1 | ⚠️ bare | "About Magic Engine" — no positioning |
| `ai-growth-engine.html` H1 | ✅ | "One AI growth engine beneath every industry solution." |
| JSON-LD `Organization` name across pages | ✅ (verify assumed — repeated on every page with Org schema) | present on 20 of 21 English pages (missing only on `about.html`) |
| Homepage schema `Organization` | ✅ + `ContactPoint` | Extra `ContactPoint` schema present |
| Contact email in `src/app/contact/page.tsx` | ⚠️ **cross-domain** | `raydeng@magicengine.com.au` — note this is a Next.js app page under `src/app/contact/`, not the static marketing site's contact surface |

**Entity ambiguity risks** (relevant when we later run §15's GEO baseline):

- **"Magic Engine"** as a brand is contested. Naive AI queries risk conflating with hardware/game/arcade brands. We must build owned-domain classification into the parser (already done in `classifyOwnedDomain` per WP04A), and disambiguation phrases (e.g. "Magic Engine AU/NZ", "Magic Engine growth", "magicengine.com.au") should be used in the query set (§15).
- **Category label instability** — the About page introduces "AI Upgrade" and "Training" as if they are equal peers to "AI growth engine". If AI systems synthesize from both `llms.txt` and `about.html`, we give them contradictory category descriptors. Best case: they pick one; worst case: they synthesize a diluted paraphrase.
- **No LinkedIn / directory audit performed this pass** (would require live crawling of third-party surfaces, deferred to Recommended First Intervention Batch).

**Nothing was modified.** All findings are recorded here as `EntityFinding` items suitable for later Prescription drafting.

---

## 9. Existing Page Inventory

All 21 English public pages. Ranking queries / impressions / clicks / position columns are populated as `not_measured` because GSC has never captured this domain — this is faithful to the WP08 frozen policy that we do not report `0` when we mean "not measured".

| # | URL | Bytes | Primary theme | Type | SEO role | GEO role | Ranking queries | Impressions | Clicks | Position | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `/` (index.html) | 42,495 | AI growth engine for AU/NZ | Homepage | Brand / broad | Anchor Organization + ContactPoint | not_measured | not_measured | not_measured | not_measured | KEEP + fix hreflang bidirectional |
| 2 | `/about` | 12,494 | About / positioning | About | Trust | Weak (no JSON-LD) | not_measured | not_measured | not_measured | not_measured | OPTIMISE (add Organization schema; tighten category consistency; strengthen H1) |
| 3 | `/ai-growth-engine` | 6,289 | AI growth engine explainer | Product | Cluster hub for Cluster B | Anchor for "AI operating loop" queries | not_measured | not_measured | not_measured | not_measured | 🔴 EXPAND (fix empty H3s; grow from 6.3KB to 15-20KB; strongest content underweight-served) |
| 4 | `/discover` | 19,977 | Free growth diagnosis | Conversion / CTA | Top conversion page | Weak (no schema) | not_measured | not_measured | not_measured | not_measured | OPTIMISE (add Service / HowTo JSON-LD; hreflang) |
| 5 | `/industry-solutions` | 21,356 | Industry hub | Hub | Cluster C hub | ItemList schema present | not_measured | not_measured | not_measured | not_measured | KEEP |
| 6 | `/real-estate` | 12,252 | AI for real-estate agents | Money page | Cluster C | FAQ + Breadcrumb | not_measured | not_measured | not_measured | not_measured | KEEP + add hreflang + create `cn/real-estate` |
| 7 | `/travel` | 12,893 | AI for travel operators | Money page | Cluster C | FAQ + Breadcrumb | not_measured | not_measured | not_measured | not_measured | KEEP + add hreflang + create `cn/travel` |
| 8 | `/local-services` | 12,286 | AI for local service businesses | Money page | Cluster C | FAQ + Breadcrumb | not_measured | not_measured | not_measured | not_measured | KEEP + add hreflang + create `cn/local-services` |
| 9 | `/features` | 13,722 | Ad management & reporting features | Feature | Bottom-funnel enabler | Weak (no JSON-LD) | not_measured | not_measured | not_measured | not_measured | 🔴 OPTIMISE — add to sitemap OR redirect out of navigation (currently inconsistent) |
| 10 | `/geo` | 16,043 | GEO explainer | Product | Cluster A | Category anchor for GEO queries | not_measured | not_measured | not_measured | not_measured | KEEP + add BreadcrumbList |
| 11 | `/ai-search` | 23,124 | AI search visibility | Product | Cluster A | FAQ + Service | not_measured | not_measured | not_measured | not_measured | KEEP |
| 12 | `/ai-search-faq` | 21,558 | AI search FAQ hub | Support / FAQ | Cluster A supporter | Strong (FAQPage) | not_measured | not_measured | not_measured | not_measured | KEEP |
| 13 | `/ai-search-snippets` | 23,545 | Snippet bank for LLM answers | Support / evidence | Cluster A supporter | Strong (FAQPage + WebPage) | not_measured | not_measured | not_measured | not_measured | KEEP |
| 14 | `/ai-training` | 18,926 | AI training for teams | Category | Cluster B | Service + BusinessAudience | not_measured | not_measured | not_measured | not_measured | KEEP |
| 15 | `/ai-automation` | 20,145 | AI automation for teams | Category | Cluster B | Service + BusinessAudience | not_measured | not_measured | not_measured | not_measured | KEEP |
| 16 | `/ai-marketing-smes` | 18,550 | AI marketing for SMEs | Category | Cluster B | Service + BusinessAudience | not_measured | not_measured | not_measured | not_measured | KEEP |
| 17 | `/ads` | 19,011 | Google Ads / Meta Ads diagnosis | Bottom-funnel | Ads entry | Service + Organization | not_measured | not_measured | not_measured | not_measured | KEEP |
| 18 | `/training` | 15,897 | Team training (generic) | Category | Overlap with `/ai-training` | Service + BusinessAudience | not_measured | not_measured | not_measured | not_measured | ⚠️ MERGE candidate — significant overlap with `/ai-training`; verify intent difference before merging |
| 19 | `/cn/` (cn.html + cn/index.html) | 27,027 + mirror | Chinese landing | Localised home | Localisation | Chinese Org schema | not_measured | not_measured | not_measured | not_measured | KEEP + build missing CN pages |
| 20 | `/privacy` | 10,463 | Privacy Policy | Legal | Trust | Baseline | not_measured | not_measured | not_measured | not_measured | KEEP |
| 21 | `/terms` | 10,238 | Terms of Service | Legal | Trust | Baseline | not_measured | not_measured | not_measured | not_measured | KEEP |

**Internal linking pattern from homepage** (`href="/…"` count): 16 unique internal destinations. `/features` is linked in navigation but missing from sitemap (H-3 above).

**Chinese mirror** (16 pages): mirrors most English pages but is missing `local-services`, `real-estate`, `travel`, `ai-growth-engine`, `features`. Chinese-speaking AU/NZ audience is left without the industry-vertical stack today.

---

## 10. Top Opportunities

Ten highest-value items, each in the form **Evidence → Why → Recommended action**. None are executed; each is a proposed ActionCandidate for Build Control Room to authorize.

### T-1 · Connect Magic Engine's own GSC (unlocks every downstream diagnosis)
- **Evidence**: `gsc_performance_snapshots WHERE site_url ILIKE '%magicengine%'` → 0 rows · no `google-site-verification` meta on any page · `google-data-pullback-daily` cron will not pull data for a client that isn't connected.
- **Why**: The single most valuable free source of truth is Google itself. Without it, none of §4, §11, §13, §16 can be measured, and Magic Engine cannot demonstrate on its own site the diagnostic capability it sells.
- **Recommended action**: Install `<meta name="google-site-verification" content="…">` in every page `<head>` (or the DNS TXT alternative). Connect the property via existing `POST /api/clients/[id]/platform/gsc`. First snapshot lands within 24-48 hours of the next `google-data-pullback-daily` run.

### T-2 · Install GA4 property on the marketing site
- **Evidence**: `google-tag.js` contains only Google Ads `AW-18192230281`; grep for `G-[A-Z0-9]{6,}` returns 0 hits on any static file. `ga4_traffic_snapshots` distinct clients = 2 (CTS + Oztop); Magic Engine absent.
- **Why**: The site already runs paid ads that link into `/discover` and `/contact`. Without GA4, we cannot see how those funnels perform, cannot distinguish organic vs paid, cannot detect ChatGPT / Perplexity referral traffic when it appears.
- **Recommended action**: Create GA4 property, add `G-XXX` config into `website/google-tag.js` next to the existing Ads block, wire the property to Magic Engine's client via `POST /api/clients/[id]/platform/ga4`. Add key events for the `/discover` submit and the `/contact` submit at the same time.

### T-3 · Fill Magic Engine's `master_brief` + `primary_keywords` + `competitor_domains`
- **Evidence**: `master_briefs` where `website ILIKE '%magicengine%'` → 0 rows. `clients` where `id = f1d062ca…` shows `primary_keywords=[]`, `competitor_domains=[]`, `brief_completed_at=NULL`, `industry=NULL`.
- **Why**: Multiple crons (`seo-patrol-daily`, `keyword-snapshots-weekly`, `blog-weekly`, `content-factory-intake`) silently no-op for a client without a brief / keywords / focus flag. The 5 keywords already being tracked (§4.2) are not aligned with the site's actual positioning, because the brief that should feed them is empty.
- **Recommended action**: Complete Brand Brief wizard for Magic Engine using existing `master_briefs` schema. Populate `primary_keywords` (via `PATCH /api/clients/[id]/primary-keywords` — the resolver is the only sanctioned write path) with the 10 highest-confidence terms from §5 and §11. Populate `competitor_domains` with 5-10 explicit AU/NZ competitors after a bounded research pass (§16).

### T-4 · Fix `ai-growth-engine.html` (empty H3s + thin content)
- **Evidence**: `grep -oE '<h3[^>]*>[^<]{0,120}' website/ai-growth-engine.html` shows 4 valid + 3 empty `<h3>` tags. File is 6,289 bytes; sibling category pages average 18,000-23,000 bytes. This is the page `llms.txt` directs to as "how the Magic Engine operating loop works".
- **Why**: If ChatGPT / Perplexity / Claude follow `llms.txt`, they land on a visibly incomplete page and either paraphrase it into something bland or skip it. This page is Cluster B's hub and the strongest owned surface for "AI operating loop" queries.
- **Recommended action**: Fill the 3 empty H3 sections (they appear to be a template awaiting industry-example cards); grow the page from 6 KB to ~18 KB with concrete examples for each DAPE stage; add FAQ schema.

### T-5 · Resolve `/features` sitemap ↔ navigation contradiction
- **Evidence**: `website/features.html` exists (13,722 bytes), is linked from homepage navigation (`href="/features"`), but is absent from `sitemap.xml`. `curl` returns 200.
- **Why**: Google crawls both signals. When they contradict, the page's ranking potential is capped. It also implies the site's own sitemap generation is broken or manually maintained.
- **Recommended action**: Add `/features` to `sitemap.xml` (single line) or remove it from navigation and add a `/features` → `/discover` 301 in `_redirects`. Decision belongs to Build Control Room: is `/features` a real destination or a legacy stub?

### T-6 · Add `hreflang` to four industry pages
- **Evidence**: `grep -c 'hreflang' website/{ai-growth-engine,local-services,real-estate,travel}.html` = 0 each. Sibling English pages all carry 2-3 hreflang entries.
- **Why**: These are exactly the pages we sell to bilingual AU/NZ audiences. Missing hreflang wastes the Chinese mirror's SEO effort even where CN counterparts exist.
- **Recommended action**: Add `<link rel="alternate" hreflang="en" …>` and `<link rel="alternate" hreflang="zh-Hans" …>` (and `x-default`) to all four, matched to any CN mirror that gets created (§10 T-8).

### T-7 · Add JSON-LD to three high-intent pages
- **Evidence**: `discover.html`, `about.html`, `features.html` have no `@type` schema entries. `discover.html` is the primary CTA and receives Google Ads clicks.
- **Why**: Rich snippet eligibility, LLM parsing signal, and consistency with the site's own dense schema strategy elsewhere.
- **Recommended action**: `discover.html` → `Service` + `HowTo` (5 steps for the free diagnosis) + `WebPage`. `about.html` → `Organization` + `AboutPage`. `features.html` → `Product` or `SoftwareApplication` describing the ad-management surface.

### T-8 · Build missing Chinese industry pages
- **Evidence**: `cn/local-services`, `cn/real-estate`, `cn/travel`, `cn/ai-growth-engine`, `cn/features` — none exist. English versions have `lastmod=2026-08-05` in sitemap.
- **Why**: Chinese-speaking SMEs in AU/NZ are on the ICP; industry vertical stack is currently English-only for them.
- **Recommended action**: Translate + localise the five pages, add reciprocal hreflang, add to `sitemap.xml`. This is content work; sizes 12-20 KB per page.

### T-9 · Stand up Magic Engine's own GEO baseline v1 (Case Study 0 measurement engine)
- **Evidence**: `scripts/geo-baseline-run.ts` exists and is proven — Roman Baseline v1 cost US$0.708 for 12 queries × 1 sample. Magic Engine has no baseline yet; entity ambiguity risk (§8) is real.
- **Why**: This is the only structured, defensible way to answer "does ChatGPT / Perplexity / Gemini know Magic Engine, and if so, what do they say?" It is also the measurement half of Case Study 0 (§13).
- **Recommended action**: (a) Approve a locked query set for Magic Engine v1 (candidate in §15); (b) authorize a live run with budget cap US$1.50 (≈ 20 queries × 1 sample); (c) capture batch → observations → evidence via existing WP04A pipeline. No new code required; no migration; docs-only + one script invocation.

### T-10 · Refresh sitemap `lastmod` timestamps
- **Evidence**: 26 of 34 URLs in `sitemap.xml` have `lastmod=2026-06-02`, but source files were re-saved on 2026-08-16.
- **Why**: Search engines allocate crawl budget in part by trusting `lastmod`. Stale `lastmod` slows re-indexing after every edit.
- **Recommended action**: Regenerate sitemap from file mtimes as part of every Cloudflare Pages build; either add a Cloudflare Pages Function or a repo pre-commit hook. This is a five-line script fix, not a redesign.

---

## 11. Article / Insight Backlog

Up to 20 candidate content items. **Every "search volume" cell is `unverified` until §16 DataForSEO batch runs**; the numeric guesses below are qualitative bands, not measurements. Nothing here has been published, drafted, or authored.

Content type is strictly one of: `MONEY_PAGE`, `ARTICLE`, `INSIGHT`, `RESEARCH`, `CASE_STUDY`. `RESEARCH` is used only where the site owns original evidence (§12).

| # | Type | Proposed title | Query cluster | Intent | Market | SV band | KD band | Current visibility | Top competitors (indicative, un-audited) | Existing page overlap | Recommended angle | Evidence needed | Internal-link destination | Business relevance | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | MONEY_PAGE | AI marketing for New Zealand SMEs — how it actually works | `ai marketing NZ`, `AI for small business NZ` | commercial-investigation | NZ | med | med | none | AU/NZ marketing agencies with AI landing pages | `/ai-marketing-smes` overlaps but is AU/NZ | NZ-only page with NZ-specific product + case examples + NZ time-zone support | GA4 organic breakout AU vs NZ; NZ client case | `/discover`, `/geo` | High — closes the NZ money-page gap | Medium |
| 2 | MONEY_PAGE | Magic Engine pricing and packages | `magic engine pricing`, `AI growth engine cost` | transactional | AU + NZ | low-med | low | none | direct competitors' pricing pages | none — 0 pricing page today | Transparent starting price + package matrix + FAQs | Real internal pricing | `/contact`, `/discover` | Highest — the single largest missing money page | High |
| 3 | MONEY_PAGE | Case studies index | `magic engine case study`, `magic engine customers` | commercial-investigation | AU + NZ | low | low | none | Competitors' case study libraries | none | Start with 2-3 anonymised outcome-based cases (Roman GEO, CTS content velocity, one B2B) | Client-approved outcome numbers | `/discover`, industry pages | Very high — bottom-funnel trust anchor | High |
| 4 | MONEY_PAGE | Magic Engine for marketing agencies (AU/NZ) | `AI tools for marketing agencies`, `white label AI marketing NZ` | commercial-investigation | AU + NZ | med | med | none | Agency-oriented AI vendors | none | Explicit whitelabel + agency-service positioning; per-account brief; billing separation | 1-3 real agency clients | `/contact`, `/features` | High — stated buyer, no page | Medium |
| 5 | ARTICLE | How generative engine optimisation (GEO) actually differs from SEO | `SEO vs GEO`, `what is generative engine optimisation` | informational | AU + NZ | med-high | low-med | none | AI-search-blog general vendors | `/geo` provides definition; article can rank on comparison intent | Rigorous comparison table with owned counter-evidence | Roman baseline finding as first example | `/geo`, `/ai-search` | High — captures top-funnel curiosity for Cluster A | High |
| 6 | ARTICLE | Which AI bots should your NZ site allow in 2026 — and which to block | `AI bots robots.txt`, `block ChatGPT crawler` | informational | AU + NZ | med | low | none | Wired / TechCrunch style articles | none directly | Cloudflare Content Signals + our own `robots.txt` as worked example | Our own `robots.txt` as evidence | `/geo`, `/ai-search-faq` | Medium-high — GEO-adjacent, drives GEO qualified leads | High |
| 7 | ARTICLE | Do LLMs cite `.au` and `.nz` sites the same? What we found running 20 queries | Cluster A | informational | AU + NZ | low-med | very low | none | none | none | Owned research after §16 batch runs | GEO baseline output | `/geo`, `/discover` | High — cornerstone Cluster A evergreen | Medium (depends on §16 baseline) |
| 8 | ARTICLE | AI adoption for AU/NZ SMEs: what actually gets used vs what gets bought | Cluster B | informational | AU + NZ | med | med | none | McKinsey / Accenture think-piece pages | `/ai-marketing-smes`, `/ai-automation`, `/ai-training` | Real usage patterns from our client base (with permission) | Anonymised client tool-usage data | `/ai-training`, `/discover` | Medium-high | Medium |
| 9 | ARTICLE | Real estate GEO — what an Auckland buyer asks ChatGPT before they call an agent | Cluster A × Real estate | informational | NZ | low-med | very low | none | none | `/real-estate`, `/geo` | Direct extension of Roman Baseline v1 findings | Roman anonymised or Magic Engine's own | `/real-estate`, `/geo` | High — cross-sells GEO to real-estate clients | High |
| 10 | ARTICLE | Travel operator GEO — what LLMs cite about "China tours from New Zealand" | Cluster A × Travel | informational | NZ + AU | low-med | very low | none | few | `/travel`, `/geo` | Extension of prior travel-vertical research | CTS anonymised or open baseline | `/travel`, `/geo` | High — cross-sells GEO to travel clients | High |
| 11 | ARTICLE | Local services GEO — what LLMs say about "best plumber near me" in NZ vs AU | Cluster A × Local services | informational | AU + NZ | med | very low | none | few | `/local-services`, `/geo` | Cross-market comparison from live baseline | Live baseline against NZ + AU plumber cohort | `/local-services`, `/geo` | High — cross-sells GEO to local services | Medium |
| 12 | ARTICLE | The AU/NZ SME AI adoption gap: 20 tools shipped, 3 tools kept | Cluster B | informational | AU + NZ | low-med | low | none | none | `/ai-training`, `/ai-marketing-smes` | Original observational data | Aggregated (permission-based) client tool usage | `/discover`, `/ai-training` | Medium-high | Medium |
| 13 | INSIGHT | Weekly: what we saw in AU/NZ AI search this week | Weekly | informational | AU + NZ | n/a | n/a | none | none | Would be a `/insights` hub | Weekly digest anchored in own baseline | Weekly GEO deltas + one industry finding | `/geo`, `/discover` | Medium — content velocity signal + newsletter fuel | Low (needs weekly ops commitment) |
| 14 | INSIGHT | Monthly: What changed in Australia's AI search share of voice | Monthly | informational | AU | n/a | n/a | none | none | new `/insights/aus-ai-search` | Monthly rollup from `industry_ai_visibility_snapshots` (5,221 rows) | Existing industry AI visibility data | `/geo`, industry pages | High for AU market authority | Medium |
| 15 | INSIGHT | Monthly: What changed in New Zealand's AI search share of voice | Monthly | informational | NZ | n/a | n/a | none | none | new `/insights/nz-ai-search` | Same as #14 for NZ market | Same source | `/geo`, industry pages | High for NZ market authority | Medium |
| 16 | RESEARCH | Magic Engine AI Visibility Baseline 2026 — Q3 (AU + NZ) | Cornerstone | informational | AU + NZ | low | very low | none | none | none | Publish redacted results of Magic Engine's own GEO Baseline v1 | Requires T-9 to run first | `/geo`, `/ai-search`, `/discover` | Highest — original evidence anchor for the entire site | Medium (gated on T-9) |
| 17 | RESEARCH | GEO citation coverage across AU/NZ SME service verticals — first 5 industries | Cornerstone | informational | AU + NZ | low | very low | none | none | none | Requires industry-scoped baselines beyond Magic Engine | Requires an authorized industry-baseline batch | industry pages, `/geo` | High — positions Magic Engine as AU/NZ GEO authority | Low (larger authorization) |
| 18 | CASE_STUDY | Roman Hu → GEO Baseline v1 in production (redacted for privacy) | Cluster A | commercial-investigation | NZ | low | low | none | none | none | Requires Product Owner permission from Roman (per §12 public eligibility) | Existing WP08 batch data | `/real-estate`, `/geo` | Very high — real citable outcome | Medium |
| 19 | CASE_STUDY | Magic Engine on Magic Engine — full public loop | Cornerstone | commercial-investigation | AU + NZ | low | very low | none | none | none | See §13 Case Study 0 design | Requires §14 measurement gaps closed | `/discover`, `/geo`, homepage | Highest — proves the product on the vendor | High (gated on §14) |
| 20 | ARTICLE | "AI Growth Engine" — what we mean, and what other vendors mean when they say it | Category defence | informational | AU + NZ | low-med | very low | none | multiple vendors abuse the phrase | none | Explicit definition + comparison + our contract | Publish our own product principles page | `/ai-growth-engine`, `/discover` | Medium — category definitional article, defends entity | High |

**Rules honoured**:

- Every `RESEARCH` item (16, 17) requires original evidence (from GEO baseline batches).
- Every `CASE_STUDY` item (18, 19) requires either Magic Engine's own outcomes or Product-Owner-approved anonymised customer outcomes.
- No informational blog post is dressed up as `RESEARCH`.
- 20 items is the ceiling requested.

---

## 12. Research / Evidence Opportunities

We are not building a database this pass. This is a pointer inventory of what Magic Engine already owns (or can own) that could later become citable evidence.

Every item is tagged `PUBLIC` / `INTERNAL_ONLY` / `NEEDS_PERMISSION` per the brief.

| # | Item | Source | Methodology | Date / Period | Owner | Client scope | Public eligibility | Claims it could support |
|---|---|---|---|---|---|---|---|---|
| E-1 | Magic Engine's own `robots.txt` Cloudflare Content Signals + AI-bot allowlist | `website/robots.txt` (this repo) | Publish-time file | Live from 2026-06-02 (via lastmod) | Ray | Magic Engine self | PUBLIC | Best-practice pattern for AU/NZ SME `robots.txt` |
| E-2 | Magic Engine's own `llms.txt` | `website/llms.txt` | Hand-authored, published | Live | Ray | Magic Engine self | PUBLIC | `llms.txt` adoption exemplar for SMEs |
| E-3 | Roman Hu GEO Baseline v1 dataset (Issue #883) | `geo_batches` + `geo_observations` + `geo_evidence` (batch `688bd8ae-2db6-4300-b761-b850f30c32c5`) | WP04A pipeline; 12 queries × 1 sample; owned-domain classifier | Frozen 2026-08-12 | Ray + Product Owner | Roman | NEEDS_PERMISSION (Roman's approval) | GEO baseline methodology; "did the AI mention us?"; owned-domain citation coverage 2 / 12 = 16.7% |
| E-4 | Attribution correctness improvements from PR #862 (already shipped) | `flywheel_*` tables + PR body | Engineering PR | Merged pre-2026-08-10 | Engineering | Platform | PUBLIC (with rewrite) | "How Magic Engine avoids the common attribution mistake AU/NZ agencies make" |
| E-5 | Weekly ranked-keyword snapshots for magicengine.com.au (5 keywords, 3 weeks) | `keyword_snapshots` domain filter | DataForSEO weekly cron | 2026-08-03 → 2026-08-17 | Ray | Magic Engine self | PUBLIC | Baseline for the case study |
| E-6 | GA4 + GSC data for CTS Tours NZ, Oztop (existing GA4 snapshots) | `ga4_traffic_snapshots` | Daily pullback cron | 2026-05-01 → 2026-08-17 (64 CTS, 61 Oztop) | Ray | Both clients | NEEDS_PERMISSION | Anonymised industry benchmarks for AU/NZ travel, building supplies |
| E-7 | Roman `romanhu.com` migration outcome (referenced in memory) | Ray's own domain migration | Documented in project memory | 2026-08 | Ray | Roman client work | NEEDS_PERMISSION | GEO domain migration case |
| E-8 | Meta Ads audit findings (ROADMAP §2026-08-14 Meta direction audit, `docs/audits/2026-08-14-meta-ads-direction-audit.md`) | Repository doc | 16 rounds of read-only audit | 2026-08-14 | Engineering | Platform (audit) | INTERNAL_ONLY (currently) — could be redacted to a public "we found this before shipping" post | Trust / engineering rigour |
| E-9 | `industry_ai_visibility_snapshots` for OTHER industries (5,221 rows) | Supabase | Existing cron | Ongoing | Ray | Cross-industry | NEEDS_PERMISSION (per-industry) | AU/NZ AI visibility monthly digests (§11 items 14, 15) |
| E-10 | Cloudflare Pages `_headers` policy | `website/_headers` | File | Live | Ray | Magic Engine self | PUBLIC | Security-headers best-practice for SME static sites |
| E-11 | 21-page bilingual page inventory (this report) | Report §9 | Direct file inspection + curl | 2026-08-17 | Ray | Magic Engine self | PUBLIC | Site architecture case |
| E-12 | Zero-cost Discovery methodology (this report) | This report itself | Discovery-only pass, US$0 provider spend | 2026-08-17 | Ray | Magic Engine self | PUBLIC | "You do not need to spend to know" thesis; Discovery-first sales narrative |

**Explicitly not counted as evidence:**

- Test fixtures / seed data.
- Roadmap intent statements.
- Model-generated summaries without a source hop.

---

## 13. Case Study 0 — Magic Engine on Magic Engine (design only)

This is a design document for the case study. It is not the case study. The case study is written only after the intervention has been run and remeasured.

### 13.1 Story arc

Baseline (this report) → intervention (chosen by Build Control Room from §16) → remeasurement (via the same instruments as baseline) → outcome (measured, not asserted) → learning (what worked, what did not, what surprised us).

### 13.2 Suggested data fields (per baseline / remeasurement)

- **Organic search**:
  - GSC 28-day impressions, clicks, avg CTR, avg position (once T-1 is done and 28 days have elapsed)
  - Position-band distribution (pos 1-3 / 4-10 / 11-20 / 21-50 / 51-100)
  - Query count (branded / non-branded split)
  - Top 20 pages by impressions
  - Query-to-landing-page mismatch count
- **Rankings**:
  - Baseline set of tracked keywords (§4.2 + new §16-derived set), each with position, volume, KD, snapshot date, source (DataForSEO / SERP live)
- **GEO / AI visibility**:
  - Query set version (locked) — from §15 candidate
  - Total observations · succeeded · qualified mention · owned-domain citation · third-party citation
  - Metric rules version + parser version — must be identical baseline vs remeasurement
  - Cost per batch (should be < US$2 for a 20-query, 1-sample batch)
- **Conversion**:
  - GA4 key events: `discover_submit`, `contact_submit`, plus scroll and outbound-link where appropriate
  - Google Ads → GA4 attributed sessions vs organic sessions
  - Meta Pixel `Lead` event count on the same funnel
- **Authority**:
  - Third-party mentions (LinkedIn posts, partner announcements, directory listings) — count + top 5 with URLs
  - Backlinks (from `backlink_data` via DataForSEO backlinks endpoint)
- **Site health**:
  - Site audit findings count by severity (`site_audit_jobs` + `client_site_pages` after T-1 crawl completes)
  - `client_site_pages.index_verdict` counts

### 13.3 Public evidence requirements

The case study can be public only if:

- **We own the data.** All of the above are Magic Engine's own domain / property / brief / account. No customer data is required.
- **We compare like-for-like.** Baseline and remeasurement use the same tools, same time-window length, same query set, same parser version.
- **We do not confuse "not measured" with "zero".** Any field that was not measured is reported as `not_measured`, never as `0` or "no data".
- **We show what did not work.** The learning section reports negative results as first-class, not as footnotes.

### 13.4 What we do not do this pass

- No baseline is captured (that is the first intervention).
- No case study is written.
- No public claim is drafted.

---

## 14. Measurement Gaps

| # | Gap | Why it matters | Blocks |
|---|---|---|---|
| M-1 | Own GSC never connected | We cannot know what Google already thinks the site is about | §4, §11, T-1 downstream |
| M-2 | Own GA4 property not installed on marketing site | We cannot know what humans do on the site | §3, §11 conversion analysis |
| M-3 | Own site never crawled by `site_audit_jobs` (0 rows in `client_site_pages`) | Cannot compute canonical page inventory, cannot compute `direct_owned_page_citation` | §7, §11, §13 |
| M-4 | No live GEO baseline for Magic Engine | Cannot say what LLMs cite us for or against | §7, §11, §13, §16 |
| M-5 | 5 tracked keywords are AU-only and unaligned with positioning | Weekly snapshot data has low signal-to-noise | §4, §11 |
| M-6 | No sitemap coverage for `/features` and 5 missing CN pages | Split signal to search engines | §6 H-3, §11 |
| M-7 | Empty `master_briefs` for Magic Engine | Multiple crons silently no-op | T-3 downstream |
| M-8 | No third-party mention audit run | Cannot claim entity consistency across the open web | §8 |
| M-9 | No backlink profile pulled from DataForSEO backlinks endpoint | Cannot understand off-site authority | §13, §16 |
| M-10 | No CWV field data (needs GSC or a real CWV connector) | Cannot make cache / minification tradeoffs on evidence | §6 M-3 |

---

## 15. Proposed AI Visibility Query Set — Magic Engine v1 (Candidate — not authorized)

Following WP08 methodology (Roman Baseline v1 shape): 18 questions, each with `market`, `locale`, category. Not run this pass; Build Control Room must approve, PM must lock the query set version (proposed slug: `magicengine_geo_baseline_v1`), then a batch is authorized separately.

Categories used: `brand_entity`, `category`, `problem`, `recommendation`, `comparison`, per brief.

| # | Category | Market | Locale | Question |
|---|---|---|---|---|
| Q01 | brand_entity | AU | en-AU | What is Magic Engine (magicengine.com.au) and what does it do for Australian businesses? |
| Q02 | brand_entity | NZ | en-NZ | What is Magic Engine (magicengine.com.au) and what does it do for New Zealand businesses? |
| Q03 | brand_entity | NZ | en-NZ | Who runs Magic Engine and what is their background in AI and marketing? |
| Q04 | category | AU | en-AU | Which AI growth or AI marketing platforms serve small and medium businesses in Australia in 2026? |
| Q05 | category | NZ | en-NZ | Which AI growth or AI marketing platforms serve small and medium businesses in New Zealand in 2026? |
| Q06 | category | AU | en-AU | Who does generative engine optimisation (GEO) for Australian businesses? |
| Q07 | category | NZ | en-NZ | Who does generative engine optimisation (GEO) for New Zealand businesses? |
| Q08 | problem | NZ | en-NZ | How can a New Zealand real estate agent get mentioned by ChatGPT when Auckland buyers search there? |
| Q09 | problem | AU | en-AU | How can a small Australian travel operator get cited by AI assistants when travellers ask for tour recommendations? |
| Q10 | problem | AU + NZ | en | How should a small business audit whether their website is understood by AI systems like ChatGPT and Perplexity? |
| Q11 | recommendation | AU | en-AU | Recommend an AU-based partner that helps SMEs get visible on ChatGPT, Perplexity and Google AI Overviews. |
| Q12 | recommendation | NZ | en-NZ | Recommend a NZ-based partner that helps SMEs get visible on ChatGPT, Perplexity and Google AI Overviews. |
| Q13 | recommendation | AU + NZ | en | Recommend an AU/NZ platform that turns website analytics into recommended growth actions. |
| Q14 | comparison | AU | en-AU | Compare Magic Engine with other Australian AI marketing platforms — what are the trade-offs? |
| Q15 | comparison | NZ | en-NZ | Compare Magic Engine with other New Zealand AI marketing partners for small businesses. |
| Q16 | comparison | AU + NZ | en | Is generative engine optimisation (GEO) different from SEO? Which providers claim to do both in AU/NZ? |
| Q17 | brand_entity | AU + NZ | zh-Hans | 澳大利亚和新西兰的中小企业可以用哪些AI增长平台？Magic Engine 是其中之一吗？ |
| Q18 | brand_entity | AU + NZ | zh-Hans | 澳新地区做生成式搜索优化 (GEO / AI 可见度) 的服务商有哪些？ |

**Notes**:
- 18 items (within 10-20 range).
- English + Chinese coverage.
- AU and NZ both represented; a small number of AU+NZ items to test market bleed.
- Categories balanced across brand / category / problem / recommendation / comparison.
- Entity disambiguation encoded — every brand-entity question mentions `magicengine.com.au` explicitly to reduce collisions with unrelated "Magic Engine" brands.
- Query set version is `magicengine_geo_baseline_v1` (proposed) — must be locked in `geo_query_sets` before any baseline runs. Aligns with the immutability rule in WP03 storage contract.

---

## 16. Recommended First Intervention Batch (candidates only, US$-scoped)

Every item below is an `ActionCandidate` per WP00 §5.4. None is authorized. Nothing here is executed. Costs are estimated on the high side of DataForSEO / OpenAI reference pricing.

| # | ActionCandidate | Why-first | Est. new provider spend | Depends on | VerificationDefinition (measured how, when) |
|---|---|---|---|---|---|
| A-1 | Install GSC verification meta on all 21 English + 16 CN pages; connect via `POST /api/clients/[id]/platform/gsc` | Unblocks §4 permanently; free | US$0 | Ray + one-time Google account grant | 24-48 h after install: at least 1 row in `gsc_performance_snapshots` for `magicengine.com.au` |
| A-2 | Install GA4 property (create GA4 stream, add `G-XXX` `config` line in `website/google-tag.js`, mark 2 key events for `/discover` submit + `/contact` submit) | Unblocks §3 permanently; free after GA4 stream creation | US$0 | Ray + GA4 property | 24-48 h: at least 1 row in `ga4_traffic_snapshots` for Magic Engine client_id |
| A-3 | Complete `master_briefs` for Magic Engine via Brand Brief wizard; write `primary_keywords` via `PATCH /api/clients/[id]/primary-keywords`; write `competitor_domains` after A-5 | Enables 7+ crons that no-op today | US$0 | Ray | `master_briefs.is_active=true` and `clients.primary_keywords` non-empty |
| A-4 | Run `site_audit_jobs.executeJob` for `magicengine.com.au` (36 URLs; well under the 150-page cap) | Populates `client_site_pages`; enables T-9's page-level GEO citation classification | US$0 (Jina reads a small site) | A-3 | `client_site_pages` count for Magic Engine ≥ 34 with `crawl_status='ok'` |
| A-5 | Bounded DataForSEO probe — ranked_keywords (`magicengine.com.au`, AU + NZ), keyword_ideas for 8 seed clusters (§5.4), keyword_suggestions for 4 competitor domains | Replaces the misaligned 5-seed weekly snapshot with a real, positioning-aligned tracker | US$2.50-4.00 estimated (ranked_keywords ≈ US$0.10 total, ideas ≈ US$0.60 × 8 = US$4.80 at max; likely US$2 with tighter limits) | A-3 | New rows in `keyword_snapshots` covering NZ (2554) + expanded seed list |
| A-6 | Fix Technical SEO defects T-4, T-5, T-6, T-7, T-10 (empty H3s, sitemap orphan, hreflang on 4 pages, JSON-LD on 3 pages, sitemap `lastmod` regenerator) | All are single-file surgical edits; no risk | US$0 | none | Repo diff + repeat of §6 checks returns 0 findings on those items |
| A-7 | Lock query set `magicengine_geo_baseline_v1` (§15) in `geo_query_sets`; run `scripts/geo-baseline-run.ts --live` with budget cap `US$1.50` | Establishes the measurement half of Case Study 0 | US$0.80-1.20 estimated (18 queries × 1 sample × pricing similar to Roman baseline US$0.708) | A-4 | New row in `geo_batches` for Magic Engine with `outcome_ok=true` for ≥ 16 of 18 observations |
| A-8 | Redact-and-publish Roman Baseline v1 finding + methodology as `RESEARCH` article (item 16 in §11) | Turns already-existing evidence into a public GEO cornerstone | US$0 (writing) | Product Owner permission from Roman | Public URL `/insights/…` exists; `blog_posts` row with `pr_url` referencing the `website/` PR |

**Total estimated new provider cost across the batch: ≤ US$5.20.** Well under the US$6.00 hard cap the brief authorized for external research, but note: **this cap was for the Discovery pass (this report). The intervention batch requires Build Control Room to authorize the spend separately.**

---

## 17. Known Unknowns

- **Where the 5 weekly-tracked keywords come from.** `clients.primary_keywords` is empty, yet the `keyword-snapshots-weekly` cron produces rows for 5 specific terms. Likely a fallback path in the keyword resolver, an earlier hand-injection, or a `master_briefs.keyword_seeds` that we haven't inspected. Trace via `getClientKeywords(clientId, max=10)` execution path.
- **Whether `app.magicengine.com.au` (the Next.js app) has GA4 installed.** The marketing site does not; the app subdomain is out of scope for this pass but bears verification if any of A-2's decisions require it.
- **Whether `/pricing` was ever built and removed.** STATE.md memory refers to a Cloudflare Pages pricing page; the repo does not contain `pricing.html`. Either the memory is out of date, or the page lives on a different CF Pages project. Both are recoverable.
- **Whether `/features` is deliberate or a stub.** Its inconsistent sitemap/navigation state suggests either.
- **The 3 empty `<h3>` tags on `/ai-growth-engine` — intentional placeholders?** Cannot rule out a live template awaiting content generation.
- **How aggressive AU/NZ competitors are in this space.** Not audited this pass; A-5 will surface this via `getSerpCompetitors`.
- **Real Chinese-speaking audience size for AU/NZ SME buyers.** The Chinese mirror exists; the CN industry-page gaps show demand hasn't been sized. GA4 language-breakdown after A-2 will start answering this.
- **LinkedIn / directory presence of "Magic Engine"**. Not audited this pass; will need a bounded manual pass or a Similar Web / DataForSEO backlinks probe.
- **Cloudflare Pages build config.** Repo does not include `wrangler.toml` or CI workflow for `website/`; deploy is direct-git-integration but not documented in this repo's `docs/`.
- **Whether cron authorship of `keyword_snapshots` for magicengine is drawing from the Magic Engine client_id or an anonymous/domain-scoped path.** The rows exist without `primary_keywords` being populated — this is worth understanding before A-3 replaces the seed set.

---

## 18. Provider Cost

**New provider spend this pass: US$0.00.**

- **DataForSEO**: 0 calls. Existing `keyword-snapshots-weekly` cron rows were read from the DB, not paid for again.
- **OpenAI / Anthropic**: 0 calls (no summarisation, no LLM classification, no baseline).
- **Jina**: 0 calls.
- **SerpAPI**: 0 calls.
- **Supabase**: read-only queries via MCP (metered by row, not by call; effectively free at this volume).
- **WebFetch (Anthropic-hosted)**: attempted 4 URLs, 3 returned 403 to the default Anthropic UA; content retrieved instead via `curl` from the local terminal for `magicengine.com.au` /`robots.txt` / `sitemap.xml` / `llms.txt`. No paid provider hop.

The Discovery pass was designed to fail closed on cost: if a call could not be certain-cost, it was not made. The bounded probes proposed in §16 (A-5, A-7) are the only spend-carrying items and are estimated at ≤ US$5.20 combined — still under the US$6.00 cap the brief set for the whole pass, but their authorization is a separate Build Control Room decision.

---

## TOP 10 (ranked, most-worth-doing-first)

Each item: **Evidence → Why → Recommended action**. See §10 for the same items with more context.

1. **Connect Magic Engine's own GSC.** *Evidence*: `gsc_performance_snapshots` for magicengine = 0 rows; no verification meta on any page. *Why*: single largest free source of truth; unblocks §4, §11, §13. *Action*: install verification meta + connect via `POST /api/clients/[id]/platform/gsc`.
2. **Install GA4 on the marketing site.** *Evidence*: `google-tag.js` has only Ads AW-, no `G-`; `ga4_traffic_snapshots` has 2 clients (CTS + Oztop), Magic Engine absent. *Why*: no organic conversion telemetry today. *Action*: add `G-XXX` config; wire via `POST /api/clients/[id]/platform/ga4`.
3. **Fill Magic Engine's `master_brief` + `primary_keywords` + `competitor_domains`.** *Evidence*: brief absent; both arrays empty. *Why*: 7+ crons silently no-op; the misaligned 5 keywords are proof. *Action*: complete Brand Brief wizard + `PATCH /api/clients/[id]/primary-keywords`.
4. **Fix `/ai-growth-engine.html`.** *Evidence*: 3 empty `<h3>` tags after DAPE section; 6.3 KB vs 18-23 KB sibling pages; `llms.txt` promotes this URL as the operating-loop explainer. *Why*: LLM crawlers land on an incomplete page. *Action*: fill the 3 sections; expand to 18 KB; add FAQ schema.
5. **Resolve `/features` sitemap vs navigation contradiction.** *Evidence*: linked from homepage, absent from `sitemap.xml`. *Why*: contradictory crawl signal. *Action*: add to sitemap or 301 to `/discover`.
6. **Add hreflang to `/ai-growth-engine`, `/local-services`, `/real-estate`, `/travel`.** *Evidence*: `grep -c hreflang` = 0 on each. *Why*: bilingual audience effort wasted. *Action*: add `en` + `zh-Hans` + `x-default` alternates.
7. **Add JSON-LD to `/discover`, `/about`, `/features`.** *Evidence*: no `@type` in these three. *Why*: `/discover` receives Google Ads clicks; missing snippet eligibility and LLM parsing hints. *Action*: `Service`+`HowTo` on `/discover`; `Organization`+`AboutPage` on `/about`; `Product` on `/features`.
8. **Build the 5 missing CN industry pages.** *Evidence*: `cn/local-services`, `cn/real-estate`, `cn/travel`, `cn/ai-growth-engine`, `cn/features` do not exist. *Why*: Chinese-speaking AU/NZ SMEs get no industry stack today. *Action*: translate + localise + reciprocal hreflang + add to sitemap.
9. **Stand up Magic Engine's own GEO baseline v1 (Case Study 0 measurement engine).** *Evidence*: `geo_batches` for Magic Engine = 0; the `scripts/geo-baseline-run.ts` pipeline is proven (Roman v1, US$0.708). *Why*: only structured way to answer "does ChatGPT know us?"; required for §13. *Action*: approve query set (§15); authorize live run at ≤ US$1.50; capture batch.
10. **Refresh sitemap `lastmod` on every deploy.** *Evidence*: 26 of 34 URLs stuck at `2026-06-02` while files were re-saved 2026-08-16. *Why*: stale `lastmod` slows Google re-indexing. *Action*: add a build-time regenerator (CF Pages Function or pre-commit hook).

---

## Appendix — What was NOT done in this pass (safety boundary check)

- `website/` — 0 files changed. Verified via `git status`.
- `src/` — 0 files changed.
- No migration added, applied, or drafted.
- No production DB write. All queries were `SELECT`.
- No blog post drafted, generated, or published.
- No sitemap regeneration.
- No new API endpoint or route.
- No new Agent.
- No new Module.
- No deploy.
- No merge.
- No CMS write, no Google Ads change, no Meta Ads change.
- No paid provider call (US$0.00 new spend).
- No Roman / CTS / Oztop production data used as public case-study material.
- No page-optimization draft (WP06 capability not invoked).
- No `action_run` submitted (Kernel not invoked).

---

*End of report. Awaiting Build Control Room decision on Recommended First Intervention Batch (§16).*
