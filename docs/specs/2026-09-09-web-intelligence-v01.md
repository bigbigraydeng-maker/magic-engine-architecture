# ME Web Intelligence v0.1 — implementation and rollout receipt

Remote fetched at 2026-09-08T15:36:18Z; exact main SHA `1ded986725f1ccd02352bcb346a6e32bc92bf4c7`.
Contract: [#1497](https://github.com/bigbigraydeng-maker/magic-engine/issues/1497), PM GO BUILD comment 5587778033. Risk A. This document supersedes the pre-build audit. Status: implemented locally, pending Draft PR review and a separately governed deployment / CTS live canary.

## Scope and reuse

Existing competitor resolver + `clients.competitor_domains` + the client's Industry Baseline cohort remain the identity sources. `competitor_monitoring_metadata` only annotates existing identities; it cannot create a second competitor list. Legacy resolver callers keep their behavior; this flow opts into fail-closed reads. Tiers core/secondary/benchmark/watch combine with active/emerging/archive status and additive source history/tags.

Shared runtime: Apify website adapter, snapshots/evidence/signals, bounded interpretation, client-scoped budget ledger and Inngest workflows. Existing Industry Baselines gets a Web intelligence tab. Industry meaning comes from the existing baseline cohort and configured context; client IDs, URLs, entitlement, FX and schedules are configuration. No CTS name, ID, private facts or travel rules enter shared runtime. Reuses existing Apify, Anthropic, paid-client/admin authorization and Inngest infrastructure. No alternate provider, custom worker or action execution is added.

Website pipeline: reserve → durably claim paid capture → Apify run receipt → validate dataset → immutable snapshot/full evidence → content diff → bounded LLM interpretation with owned evidence citations → threat/opportunity/ignore + recommended action → actual cost settlement. First snapshot is baseline; unchanged snapshots skip LLM. Outputs are recommendations only. Six service-only tables and five restricted RPCs are additive; no client/baseline seed or production write is included.

## Controls and limitations

All clients are disabled by default. Environment allowlist, enabled flag and entitlement must all pass. $499/month is a reserved entitlement field, not Stripe billing; billing currency is explicitly selected. Target NZ$30/month pauses non-core work; NZ$50/month rejects new reservations under a per-client database lock. Auckland month boundaries, fresh explicit USD/NZD rate, unknown costs and prior-month unsettled work are checked. Unknown paid requests retain their reservation and block further spending; paid calls are not retried blindly. Actual overages are recorded without truncation and block subsequent runs. Provider budget caps plus worst-case LLM reservation bound dispatched work; this cannot retroactively undo an upstream provider billing anomaly.

Apify version is pinned by configuration. One approved same-domain HTTPS URL per run, one dataset item, bounded content/page/time/charge. Removed/archived competitors cannot run. Evidence text is untrusted data; model has no tools and strict classification/citation schema. A completed paid claim with missing receipt needs operator reconciliation, not replay. If infrastructure retries are exhausted before a status receipt can be persisted, Inngest failure history plus the held run must be inspected; no automatic refund/restart is provided in v0.1.

## Validation evidence

- 247 related Vitest tests across 16 files passed (runtime, adapter, routes, UI and existing integration boundaries).
- 18 isolated real PostgreSQL 17 checks passed using `scripts/test-web-intelligence-db.mjs`: additive migration, separate-connection concurrency, budget stop, replay, unknown-cost and cross-month holds, revocation, snapshot transitions, evidence integrity, non-finite money, cross-client FKs and RLS/RPC denial. Local test DB only.
- Four targeted mutants were killed: rollout allowlist, citation ownership, paid-call claim and SQL hard stop. Source restored after each mutant.
- Focused lint and production build passed. Build used dummy database settings, not production access.
- Full typecheck reports seven errors also reproduced on pristine exact main: four messenger send test `usedAiDraft` omissions and three ops-review test environment typing errors. No new type errors.
- Two independent implementation reviews and an additional security review completed; blocking findings resolved, focused regression tests passed.
- Desktop/mobile UI was rendered from the actual component with explicitly synthetic data; no mobile horizontal overflow or browser errors. These images are not CTS acceptance.

## CTS evidence and remaining gate

Production was queried read-only. CTS `ctstours.co.nz` has 17 existing competitor domains. Its `outbound_tour_operator_nz` baseline cohort adds `rdtravel.co.nz`; the known union is 18 domains, before any additional brief evidence. No duplicate identity table was seeded. Apify and model credentials were absent from this execution environment; no live capture, real historical change or real LLM recommendation is claimed. Production migration was not applied, no settings were enabled and no production data was changed.

After separate migration/deployment authorization: apply the migration; supply existing provider credentials; set `WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS` to the approved CTS ID only; pin a verified actor build; configure fresh FX, entitlement currency and approved URLs in the existing UI; enable CTS; synchronize the two Inngest functions. Run one existing competitor URL for a baseline, then repeat to verify unchanged behavior. Observe an actual later change to verify evidence-backed interpretation (never fabricate a change and call it live evidence). Record run/dataset IDs, timestamps, before/after evidence, classification, recommendation and actual provider/model cost; verify a second client remains blocked. Disable settings and empty the allowlist to stop new paid work; reconcile already claimed runs before releasing reservations.

## Planning estimate (not measured CTS costs)

Illustrative 579 single-page captures/month, 10–50% changed, 2,500 input + 500 output tokens per changed page, USD/NZD 1.70 as an assumption. Published browser crawler estimate US$0.50–5 / 1,000 pages implies US$0.29–2.90 capture usage; Sonnet US$3/15 per million input/output tokens implies US$0.87–4.35 interpretation; configured overhead NZ$0.02/capture adds NZ$11.58. Combined illustrative NZ$13.55–23.91/month. Separate-run overhead, account plans, polling/dataset requests, storage and actual token volume can raise this; real CTS receipts must calibrate the NZ$30 target. Current default reservation at this illustrative FX is NZ$0.615/run, released only against known actual costs.

Sources checked: [Apify crawler](https://apify.com/apify/website-content-crawler), [Apify pricing](https://apify.com/pricing), [Actor run caps](https://docs.apify.com/api/v2/actors-runs-post), [model pricing](https://platform.claude.com/docs/en/about-claude/pricing).

## Next extensions

Hiring: job opening/closing and role mix. People: published leadership changes. Partnership/CSR: official announcements with named parties/date. Reviews: platform IDs, score/count and new-review evidence. Technology: observed stack or tracking changes. Each extends signal kind/extraction over the same snapshots, evidence, budget and recommendation boundary; evaluate Apify first and introduce another provider only with a documented capability gap. None is implemented in v0.1.
