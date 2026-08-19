# Reference Loop Slice 1 — Persistence Gap Audit (v1)

**Umbrella**: Issue #1041 (`magicengine.com.au Organic Growth Reference Loop`).
**Scope**: audit only. **No migration proposed. No table created. No production schema change.**
**Companion PR**: Draft PR opening this audit.
**Prepared against**: `origin/main` at `2f1b097c055e34575391770ac8b796db370fb07c`.

## 0. Frame

Slice 1 lands a **domain-neutral, in-memory** adapter at `src/lib/reference-loop/` that stitches `GrowthFinding + GrowthPrescription + GrowthVerificationDefinition` through the existing WP06 `resolve → snapshot → draft → diff → validate` pipeline and returns a typed `ReferenceLoopPreparation`. Everything the adapter needs (snapshot, redlines, provider check, provenance) is passed in; nothing is fetched, nothing is written, no provider is called.

This audit answers **one question only**: given that adapter, what persistence would we need if a caller wanted to *keep* what it produces? Nothing here proposes we should.

## 1. Objects that come out of the adapter

Recap of `ReferenceLoopPreparation` (see `src/lib/reference-loop/types.ts`):

| Object | Type | In-scope for persistence? |
|---|---|---|
| `clientId` | `string` (uuid) | reference (foreign key), not a new object |
| `targetPageUrl` | `string` | already known upstream (site inventory / page ledger) |
| `findingRefs` | `readonly string[]` | reference to existing Finding rows |
| `evidenceRefs` | `readonly { source, observedAt }[]` | reference to existing Evidence rows (or measurement snapshots) |
| `requestedChange` (`intents`) | `readonly PageOptimizationIntent[]` | **new object — value-shaped, provider-neutral** |
| `request` (`PageOptimizationRequest`) | full WP06 request | **new object — the reviewable artifact** |
| `resolution` (`PageResolution`) | routing + canonicalIdentity | derivable from `providers` + URL; snapshot-worthy but not authoritative |
| `snapshot` (`PageSnapshot`) | before-state; may include `rawContent` (KB-scale) | **new object — has size** |
| `draft` (`PageDraftResult`) | proposed fields | subset of `intents`; can be re-derived |
| `diff` (`PageDiffResult`) | `field / before / after / changed` triples | derivable from snapshot + draft, but valuable for review UI |
| `validation` (`PageValidationResult`) | pass/fail + violations | derivable from request + diff + redlines + providerCheck **at that point in time** |
| `verification` (`GrowthVerificationDefinition`) | inline value object, no id (per WP01 contract) | **freeze-required** if we want Slice 3 to compare against it later |
| `provenance` | source labels + `collectedAt` + window | **freeze-required** for evidence trail |

## 2. Persistence disposition per object

### 2.1 Reusable via existing tables

| Object | Existing table | Reuse verdict | Notes |
|---|---|---|---|
| `clientId` | `public.clients` | ✅ FK only | already the tenant anchor |
| `evidenceRefs` (structural, not id) | `public.geo_evidence` (for GEO-domain evidence); other domains may have their own | ⚠️ **domain-specific**; the adapter is domain-neutral, but Growth's `Evidence` currently has **no cross-domain evidence table** (WP01 explicitly did not freeze one; that is measurement-layer WP02/WP03 territory) | Reusing `geo_evidence` for non-GEO evidence would be a category error |
| `snapshot` (GitHub `versionToken`) | `client_site_pages` already has per-page metadata; but **no rawContent column** and no historical snapshot table | ❌ existing table doesn't hold before-state HTML | see §2.3 |
| `verification` metric window `collectedAt` | `geo_batches` / `geo_observations` timestamps exist for GEO measurement runs | ⚠️ domain-specific; doesn't apply cross-domain | |

### 2.2 Must stay in-memory (for Slice 1)

For Slice 1 we do **not** want to persist any of the following, because the adapter is a review-preparation step, not a state machine, and persisting would create a second authorization surface outside WP07 Kernel:

- `PageOptimizationRequest` itself. When Kernel authorizes an apply, the request enters the `action_runs` write path via the existing `input jsonb` column (WP00 §5.4). There is no reason to persist a *pending* request; that would replicate WP07's job.
- `draft` and `diff` results. Both are deterministic from `snapshot + intents`. Storing them creates two sources of truth. A review UI that wants to display them can call `prepareReferenceLoopChange` on demand.
- `validation` results. Same reasoning — deterministic from `request + diff + redline + providerCheck`. And critically: `providerCheck.evaluated:false` means *we chose not to compute it yet*; storing that as a "validation result" would misrepresent the state.

### 2.3 Objects with no matching existing storage

Two things the adapter emits have **no home** in the current schema, if the product ever wants to keep them:

**(A) Before-state snapshot content** (the `PageSnapshot.rawContent` for GitHub or `rawFields` for WordPress).
- `client_site_pages` stores per-page metadata (URL, GEO block presence flags), not the page body.
- `site_audit_jobs` stores audit runs, not page content snapshots.
- No table has a `versionToken` column corresponding to WP06's snapshot version.

**(B) Frozen verification definition per applied change** (the `GrowthVerificationDefinition` at the time of preparation).
- `action_runs.input jsonb` carries whatever payload the apply was authorized with, but that's a runtime authorization record, not a review artefact. If the same request is prepared and applied later, the `verification` embedded at that time may differ from what was reviewed today. Nothing today lets Slice 3 answer "what was the verification definition at the time this was authorized?".
- `GrowthVerificationDefinition` is intentionally an **inline value object with no id** (WP01 contract, Build Control Room 2026-08-10 decision — do not invent a `verification_id`). So the storage question for (B) is really: does anything currently freeze the exact JSON of the verification alongside the applied request?

## 3. Semantic-mismatch table (what NOT to reuse and why)

**These tables must NOT be repurposed for Reference Loop persistence.** Any migration proposal that tries to shoehorn our objects into them should be rejected.

| Table | Why it's tempting | Why it's wrong |
|---|---|---|
| `public.execution_items` | It has `client_id`, `finding_id`, `dimension`, `title`, `description`, `fix_type`, `status` — surface looks close to a Finding/Prescription bundle | This is the **old diagnostic execution board**. Its `finding_id` points at `diagnostic_findings`, not `GrowthFinding` (structurally different concept). Its `fix_type` is a closed enum owned by the diagnostic engine. Its RLS is `auth.uid() IN client_team` — that violates the current service-role RLS convention (`FOR ALL TO service_role USING (true)`, per `feedback-rls-policy-must-specify-to-service-role`). Growth contract explicitly forbids re-using the diagnostic `Prescription`/finding shape (`src/lib/growth/types.ts` header). |
| `public.action_runs` | It has `client_id`, `action_key`, `input jsonb` — natural home for a `PageOptimizationRequest` payload | Only when Kernel authorizes an apply. This is the *authorized apply record*, not the *review preparation record*. Writing a preparation here without authorization would create a second authorization surface outside WP07. Slice 1 is explicitly upstream of authorization. |
| `public.content_work_orders` | It has `client_id`, `goal_id`, `master_brief_id`, `brief jsonb`, `output jsonb`, `status`, publish attempt tracking | This is the **video / content factory work-order queue** (P21.J.M1). It is coupled to `goals`, `master_briefs`, `winner_structures`, `content_demand_signals` — none of which are Growth Module concepts. Its lifecycle (`queued → claimed → attempts → publish_attempt_count`) is a background-worker state machine, not a review artefact. Repurposing = category error. |
| `public.geo_evidence` / `public.geo_observations` / `public.geo_batches` | Growth's `Evidence` and GEO's evidence look similar in shape | These are **measurement-layer, GEO-domain-specific** rows keyed by `observation_id`. Growth's `Evidence` is domain-neutral. Any generalization is measurement's job (WP02/WP03), not Reference Loop's. |
| `public.diagnostic_findings` | Same reason as `execution_items`; and Growth's Finding is a strict superset that carries `evidence` inline while diagnostic findings don't | Would drag Growth into the diagnostic engine's identity model. WP01 explicitly kept these separate to prevent that. |

## 4. Field-level conflicts

Where field names look the same across surfaces but the semantics differ (each row is a **do-not-conflate**):

| Name / concept | Reference Loop / Growth meaning | Existing table meaning | Conflict class |
|---|---|---|---|
| `finding_id` | absent — Growth's `Finding` has no id (structural equality) | `execution_items.finding_id` → `diagnostic_findings(id)` | id-vs-structural |
| `verification` | inline `GrowthVerificationDefinition` value object, no id | none today | naming would collide with any future `verification_id` |
| `input` (in `action_runs`) | authorized apply payload | our `PageOptimizationRequest` (pre-auth) | pre-auth vs post-auth |
| `provenance.collectedAt` | when the *review preparation* was assembled | `geo_batches.finished_at`, etc. — when a *measurement run* completed | preparation-time vs measurement-time |
| `basedOnVersion` | snapshot `versionToken` (GitHub blob SHA, WP modified stamp) | none in `client_site_pages` | new concept |
| `PageOptimizationField` = `meta_title` | v1-frozen 3-field vocabulary (WP06) | Yoast `_yoast_wpseo_title` (WP wire format) | logical vs provider-wire |

## 5. Minimum persistence gap (only if / when the product needs it)

**Restated up front: this section is not a proposal to build. It is the answer to the question "if we did decide to keep preparations, what is the *smallest* new persistence footprint?"**

Two new concepts, if and only if the product later commits to a persisted Reference Loop:

### 5.1 `reference_loop_preparations` (hypothetical, not proposed)

Would carry, per row:
- `id uuid pk`
- `client_id uuid → clients(id)`
- `target_page_url text`
- `finding_refs text[]` (per `PageOptimizationRequest.lineage.findingRefs`)
- `request jsonb` (the full serialised `PageOptimizationRequest`)
- `snapshot_summary jsonb` (provider, versionToken, fetchedAt — **not** the raw HTML, see §5.2)
- `verification jsonb` (frozen `GrowthVerificationDefinition` at preparation time)
- `provenance jsonb`
- `validation_at_prep jsonb` (the `PageValidationResult` observed at preparation time — labelled as such, never as "current validation")
- `prepared_at timestamptz`

This is **one** new object with **one** authorization surface (RLS `FOR ALL TO service_role USING (true)`, per repo convention). It does not replace `action_runs`; when Kernel authorizes an apply, `action_runs.input` still gets the request, and a foreign-key column `prepared_from_preparation_id` on `action_runs` (or an inverse pointer on this new table) would make the review→apply chain queryable without breaking Kernel's identity model.

### 5.2 Snapshot content storage — decision needed before this becomes real

`snapshot.rawContent` for GitHub can be tens of KB. Three options for how the persisted preparation would refer to it (all three deferred until the product asks for it):

- **(a)** Store nothing more than `versionToken` + `provider` and rely on the source-of-truth CMS to fetch the before-state on demand (accepts that if the CMS mutates, the before is gone).
- **(b)** Snapshot-store the raw body content in Supabase Storage keyed by `(client_id, page_url, versionToken)` — durable, but adds storage cost and lifecycle.
- **(c)** Snapshot-store as a `text` column on the preparation row — simple, but the table grows unboundedly with review activity.

**Recommendation for now**: **do not choose**. This is a PM decision that depends on how long we need historical review-time page state to survive after the CMS moves on. Slice 1 works fine with in-memory snapshots.

### 5.3 What we should NOT build even if a preparation table lands

- No new "finding id" table. Growth's Finding is intentionally identity-free (structural).
- No new `verification_id`. WP01 Build Control Room already ruled this out.
- No RLS by `client_team` — the repo convention is service-role RLS with tenant enforcement in application code (see `feedback-rls-policy-must-specify-to-service-role`).
- No shortcut into `execution_items` / `content_work_orders`. Those tables are semantically not our object.

## 6. Recommendation

**No migration yet.**

Slice 1 delivers a pure in-memory adapter that composes existing WP06 capabilities and reads Growth contracts. Its output is fully derivable from its inputs, and its inputs are already covered by upstream sources (Growth Module for finding/prescription/verification; caller-supplied snapshot + redline + providerCheck for the WP06 legs; caller-supplied provenance).

Persistence should only be added when a product-level decision commits to:
1. Human review workflows that must survive the CMS mutating out from under them, **and**
2. A Slice 3 verification-trigger loop that needs a stable "what was reviewed" record to compare later measurements against.

Neither commitment is on the table for Slice 1. Slice 3 is explicitly deferred by PM directive on this window.

## 7. Open PM decisions (only relevant if / when persistence is later authorized)

None required for Slice 1 to land.

If persistence is later authorized:

1. **Snapshot storage strategy** — §5.2 (a/b/c). Recommend: pick (a) unless a concrete review requirement forces (b) or (c).
2. **`action_runs` linkage direction** — new FK on `action_runs.prepared_from_preparation_id`, or inverse pointer? Recommend: the new FK on `action_runs`, since Kernel already owns that write path.
3. **Retention window** for preparations that never became `action_runs` (i.e., review-only artefacts). Recommend: 90 days default, aligned with existing measurement retention.
4. **Whether preparations from failed stages should persist** — `input`/`resolve`/`draft`/`diff` failures. Recommend: no, they are debugging output; keep only successful preparations if we persist at all.

## 8. Reuse statement

- **Reused**: `src/lib/growth` (types + validators, no execution), `src/lib/page-optimization` (WP06 five-segment pipeline in full), `@/lib/cms/page-upgrade-plan` type surface via `ResolvePageInput['providers']` (no direct CMS import).
- **Platform-shared**: the new `src/lib/reference-loop/` adapter is domain-neutral — usable by GEO Module, any future SEO Module, or ad-hoc callers, without changes. No client-specific fact enters the shared runtime.
- **Industry-specific**: none.
- **Client-specific**: none — no client id, no page inventory, no `magicengine.com.au` string is hard-coded anywhere in the adapter or tests.
- **Memory**: no learning promoted to industry/global memory. This is a pure contract adapter.

## 9. Explicit non-actions

- ❌ No migration written.
- ❌ No table created or altered.
- ❌ No RLS policy changed.
- ❌ No production data read or written.
- ❌ No Slice 3 verification-trigger work.
- ❌ No modification of `website/**`, #1061 Entity Layer, Terms/Privacy, GA4/GSC connectors, or #1055/#1056 receipts.
- ❌ No new Agent introduced.
- ❌ No new Page Optimization implementation created; WP06 is called through, not reimplemented.
