# Magic Engine — GEO baseline v1 completion (Phase 0.6b)

**Scope**: retry §0.6 from PR #1043 with a raised per-observation ceiling so all 18 queries can execute. **This PR does not repeat or supersede PR #1043's §0.1–§0.5, §0.7.** It is a targeted completion of one row of the T0 receipt table.

**Companion PR**: [#1043](https://github.com/bigbigraydeng-maker/magic-engine/pull/1043) (Phase 0 main T0 baseline) — Draft, stays Draft. This PR is also Draft. PM runs the T0 Freeze Gate over both before Phase 1.

**Authorized by**: Issue #1041 (Phase 0 only) + PM 2026-08-18 explicit go for 0.6b with raised limits (still within total US$6 Phase 0 cap).

---

## 0. What changes vs. PR #1043 §0.6

| Field | 0.6a (PR #1043) | 0.6b (this PR) | Reason |
|---|---|---|---|
| `query_set_version` | `magicengine_geo_baseline_v1` | *same* (auto-locked by 0.6a's batch — no re-seed) | Preserves the frozen 18-query set exactly. Same `geo_query_sets.id = a6a1b189-3cb9-4c84-aa55-4604e72342df`. |
| Provider / model / parser / rules / cohort | unchanged | unchanged | Methodology copy from Roman v1 is preserved |
| `GEO_PER_CALL_CEILING_USD` | `0.066` | **`0.10`** | 0.6a's `brand_2` hit provider-reported $0.0888 > $0.066 ceiling → fail-closed stop. Roman's PO raised to $0.08 mid-run; $0.088 would also fail there. $0.10 gives ~12% headroom above 0.6a's observed spike. |
| `GEO_BUDGET_USD` | `1.20` | **`1.80`** | 18 × $0.10 ceiling = $1.80 worst case; equals budget exactly (preflight allows `worst_case <= budget`). |
| `GEO_TRIGGERED_BY` | `…magicengine_geo_baseline_v1 (copy Roman methodology, new entity+queries)` | `phase0.6b-2026-08-18 #1041 magicengine_geo_baseline_v1 retry (raised ceiling 0.066→0.10, budget 1.20→1.80 per PM 2026-08-18)` | Provenance-in-database |
| PM run rules (citation ≠ recommendation, mention ≠ success, not_measured ≠ 0) | applied | *same* | Zero change |

**No re-seed**: `geo_query_sets` row + 18 `geo_queries` rows persist from 0.6a. The same `query_set_version` string resolves to the same locked query scope. This is exactly what "0.6b re-runs against the same query_set" means.

---

## 1. Cost accounting against Phase 0 total cap

| Line | Batch | Cost |
|---|---|---|
| PR #1043 §0.4 site crawl | — | US$0.00 |
| PR #1043 §0.5 DataForSEO (3 runs, 2 wasted) | — | ~US$2.61 |
| PR #1043 §0.6a partial GEO batch `af1de17d…` | 1 obs succeeded + 1 failed | ~US$0.10 (upper bound; recorded `unknown/source_ambiguous` in DB) |
| **Cumulative before 0.6b** | | **~US$2.71** |
| **This PR §0.6b (worst case)** | new batch id — assigned at run | ≤ US$1.80 |
| **Cumulative worst case** | | **≤ US$4.51** |
| **PM total cap (Phase 0)** | | US$6.00 |
| **Headroom preserved for unforeseen** | | ≥ US$1.49 |

---

## 2. §0.6b live result

Filled after the retry batch runs.

### 2.1 Batch metadata

| Field | Value |
|---|---|
| Batch id | `a2f09f81-ab65-4a25-b323-567fd70f8dff` |
| Query set version | `magicengine_geo_baseline_v1` (id `a6a1b189-3cb9-4c84-aa55-4604e72342df`, locked 2026-08-17T12:23:40Z by 0.6a's first batch attempt) |
| Cohort | `engine=openai model=gpt-5-search-api-2025-10-14 locale=en-AU market=au sample=1` |
| Parser / rules | `geo-baseline/parser/v1` / `geo-baseline/rules/v1` |
| Status | `completed` |
| Coverage | Planned 18 / Attempted 18 / Succeeded 18 / Failed 0 |
| Actual cost | **US$1.0747** (well under the $1.80 budget cap) |
| Per-observation cost range | ~$0.048 to ~$0.089 (avg $0.060) — brand_2 hit $0.089, which is why 0.6a's ceiling of $0.066 was insufficient |
| Stop reason | `plan_completed` — every planned observation attempted and succeeded |

### 2.2 Per-query outcomes (all 18)

Classification method: ME mentioned in response text? AND owned URL `magicengine.com.au` present? AND prescriptive-language pattern found near "Magic Engine"? Three independent DB checks against raw response, not human interpretation.

| Query key | Cluster | outcome_ok | Text mentions ME | Owned URL surfaced | Prescriptive language | **Classification** |
|---|---|---|---|---|---|---|
| `brand_1` | brand_entity | ✅ | ✅ | ✅ | ❌ | **cited** |
| `brand_2` | brand_entity | ✅ | ✅ | ✅ | ❌ | **cited** |
| `brand_3` | brand_entity | ✅ | ✅ | ✅ | ❌ | **cited** |
| `cat_1` | category | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `cat_2` | category | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `cat_3` | category | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `cat_4` | category | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `prob_1` | problem | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `prob_2` | problem | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `prob_3` | problem | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `prob_4` | problem | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `rec_1` | recommendation | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `rec_2` | recommendation | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `rec_3` | recommendation | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `rec_4` | recommendation | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `cmp_1` | comparison | ✅ | ✅ | ✅ | ❌ | **cited** |
| `cmp_2` | comparison | ✅ | ❌ | ❌ | ❌ | **not_present** |
| `cmp_3` | comparison | ✅ | ❌ | ❌ | ❌ | **not_present** |

**Method note on classification hierarchy** (Roman v1 conflict resolution): when an owned URL surfaces alongside ME mention, primary classification is `cited` — this takes precedence over `compared` even for a comparison query, because the surfacing of the owned URL is a stronger AI-visibility signal than merely being named as one side of a comparison. `recommended` would require prescriptive language ("we recommend Magic Engine", "our pick: Magic Engine", "go with Magic Engine") within 80 characters of a ME mention — no such pattern found in any of the 18 responses.

**Classification legend** (Roman v1 rules preserved):
- `cited` = response mentions Magic Engine AND surfaces an owned URL (`magicengine.com.au` in any citation slot)
- `recommended` = response *prescribes* Magic Engine as an answer to the user's ask (not just describes)
- `described` = response mentions Magic Engine without owned URL and without prescription
- `compared` = response mentions Magic Engine only as a comparison anchor (`X vs Magic Engine`) without prescribing either side
- `not_present` = no mention at all — this is a **real observation**, not `not_measured`
- `not_attempted` = query never reached the provider (batch stopped early)

### 2.3 Aggregate counts (per PM rule: never sum across categories)

| Metric | Count | Basis |
|---|---|---|
| Queries with owned-URL citation (`cited`) | **4** | brand_1, brand_2, brand_3, cmp_1 |
| Queries with prescription (`recommended`) | **0** | no response contains prescriptive language within 80 chars of "Magic Engine" |
| Queries with description-only (`described`) | **0** | every text-mention query also surfaced an owned URL → classified `cited`, not `described` |
| Queries as comparison anchor (`compared`) | **0** | cmp_1 (only comparison query with ME mention) surfaced owned URL → classified `cited` per hierarchy |
| Queries with no mention (`not_present`) | **14** | all 4 category, all 4 problem, all 4 recommendation, 2 of 3 comparison |
| Queries `not_attempted` | **0** | ✅ full plan attempted |
| **Total** | 18 | |

**T0 truth from these counts** (no aggregation, no scoring — just the pattern):

1. **Brand queries triggered ME every time (3/3)** — DNS-verified property + owned URL structure is discoverable when someone knows to ask by name.
2. **Direct-branded comparison triggered ME (1/1 branded comparison; `cmp_1`)** — `Magic Engine vs traditional SEO agency` surfaces the owned URL. `cmp_2` and `cmp_3` (branded name not in query) did **not** surface ME.
3. **Zero unaided authority** — 0 of 4 category queries, 0 of 4 problem queries, 0 of 4 recommendation queries surface ME. When users ask "who / what / how" without saying "Magic Engine", we do not appear.
4. **Zero recommendation** — even the 4 queries where ME appears, the AI never *prescribes* ME. It describes, cites, or compares — never says "use Magic Engine".
5. This is a **cited-only** baseline. Case Study 0 T+ comparison target: shift some fraction of the 14 `not_present` category/problem/recommendation queries into `cited` or (harder) `recommended` state.

**Explicitly NOT reported**: any single "AI visibility score" that sums or blends the above. Per PM rules and Roman v1 rules, these five classes are reported separately, always. The `4 cited / 0 recommended / 14 not_present` triad is the T0 reading; adding them to "22% visibility" would violate rule set.

---

## 3. What 0.6b delivers into the T0 Freeze

Once this PR + PR #1043 are both Draft-complete, the T0 Freeze Gate has:

- Site inventory (33 pages) — from #1043 §0.4
- Passive keyword tracking (5 rows) — from #1043 §2
- T0 keyword universe (191 rows) — from #1043 §0.5
- **Complete GEO baseline** (18 observations under classified rules) — from this PR
- All `not_measured` layers explicitly named — from #1043 §0.7 table

The frozen result — regardless of whether the numbers look flattering — is what T+ remeasurements compare against.

---

## 4. Safety boundary reaffirmed

- No `website/` change (0 files touched)
- No `src/` change (0 files touched)
- No new table, no schema change, no RLS change
- No new migration
- No deploy, no merge, no publication
- Only DB writes: one new `geo_batches` row + up to 18 new `geo_observations` rows + up to 18 new `geo_evidence` rows — all under the *existing* client_id and query_set_id, no schema surface change
- Total spend contained within PM-authorized US$6.00 Phase 0 cap (see §1)
