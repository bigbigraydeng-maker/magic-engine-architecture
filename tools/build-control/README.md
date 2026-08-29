# Build Control

Deterministic, dependency-free validators for the recovery machine-lock in
Issue #1249. Every module under `src/` except the `*-cli.mjs` entrypoints is
pure — no I/O, no network, no clock unless a timestamp is passed in — so it can
be unit-tested offline and imported by the very workflows that enforce it.

No new npm dependency. CLI entrypoints are plain ESM (`.mjs`, like
`tools/ops-review-loop/`) so a workflow runs them with `node <file>.mjs`
straight off `actions/setup-node`, before any `npm ci`.

## The four locks

| Lock | Workflow | Module |
|---|---|---|
| A new Issue dispatch cannot start a duplicate or over-cap lane, and no model call happens if the check cannot run | `claude.yml` (`dispatch-preflight` job) | `dispatch-preflight.mjs` |
| A PR must declare exactly one `Primary-Issue` and an `## Outcome-Contract`, and must not duplicate an open lane | `build-control-admission.yml` | `pr-admission.mjs` |
| A PR head SHA is unauthorised until an allow-listed owner authorises that exact SHA | `build-control-merge-auth.yml` | `merge-auth.mjs` |
| An `impact-loop` Issue cannot close on Execution alone | `build-control-outcome-guard.yml` | `outcome-receipt.mjs` |

Plus `build-control-1140-guard.yml` / `control-state.mjs`, which detect an
invalid or untrusted `ME_CONTROL_STATE_V1` snapshot on Issue #1140, and
`build-control-ci.yml`, which runs these tests.

## Contracts

| File | What it validates |
|---|---|
| `primary-issue.mjs` | Exactly **one occurrence** of `Primary-Issue: #<n>`. Repeating the same number is a duplicate declaration, not a restatement. `Related:` / bare `#999` never count. |
| `outcome-contract.mjs` | The `## Outcome-Contract` section (Proof / Verification-Window / Owner / Status). `UNKNOWN` is a valid value; an omitted field is not. |
| `control-state.mjs` | `ME_CONTROL_STATE_V1` in the **real consumer format** — a standalone `<!-- ME_CONTROL_STATE_V1 -->` line followed by a fenced JSON object. Exact `schema_version`, typed non-null fields, non-empty `summary`/`bottleneck`, required collections, parseable and fresh `updated_at`. An inline `<!-- … : {json} -->` payload is rejected: the consumer cannot read it. |
| `merge-auth.mjs` | `ME_MERGE_AUTH_V1` against the PR's exact full head SHA, from an allow-listed author whose login the payload itself declares. A push self-revokes. |
| `outcome-receipt.mjs` | `ME_OUTCOME_RECEIPT_V1`. Completion needs Execution **and** Measurement/Check **and** Outcome classification **and** Tune, each DONE with non-empty evidence. Activation must be present but may be `UNKNOWN`. |
| `cap-override.mjs` | `ME_CAP_OVERRIDE_V1`: allow-listed author, `granted_by` matching that author, bound to one Primary Issue, non-empty reason, bounded expiry (≤ 72h). Lifts the cap only. |
| `duplicate-lane.mjs` | Groups open PRs (Draft included) by declared `Primary-Issue`. |
| `pr-cap.mjs` | Recovery cap of 12. `openPrCount` excludes the lane being judged, so 12 permits the twelfth open PR and blocks the thirteenth. |
| `github.mjs` | Minimal `fetch`-based REST client. Pagination is complete-or-throw — a failed or partial page throws, never a shorter list. |

## Security model

- **The gates never execute PR-supplied code.** `build-control-admission.yml`
  and `build-control-merge-auth.yml` run on `pull_request_target`, which uses
  the default branch's workflow definition, and their one checkout is pinned to
  `main`. They read PR metadata over the API and nothing else.
- **Because of that, their job status attaches to the base branch**, so each
  writes an explicit check run — `Build Control Admission` and
  `Build Control Merge Authorisation` — against the PR's current full head SHA
  on every applicable event. Those names are deliberately not job names, so
  exactly one check carries each and it is always the head-attached one.
- **`build-control-ci.yml` is the only workflow that runs PR code**, on
  `pull_request`, with `contents: read`, no secrets and no write scope.
- **Allow-lists fail closed.** An empty allow-list exits non-zero; it never
  degrades into "trusted by anybody".
- **Every `uses:` is pinned to a 40-character SHA**, and a structural test
  rejects any mutable tag in these workflows.

### Known limits (not closed by this change)

- `chatgpt-codex-connector` holds raw Issue-write permission, so an invalid or
  untrusted `ME_CONTROL_STATE_V1` comment cannot be *prevented*. The guard
  detects it and labels the Issue; the existing Obsidian consumer remains the
  fail-closed boundary that refuses to *use* a bad payload. Nothing here edits
  or deletes the source comment, or touches Obsidian or its syncer.
- These workflows are **not** added to the `Protect main` ruleset. Making the
  two check names required contexts is a separate Product Owner action.
- The guards create only their own machine-output labels
  (`build-control:1140-state-invalid`, `build-control:impact-incomplete`).
  Applying `impact-loop` to a business Issue is a separate owner rollout
  action; an unlabelled Issue is a deterministic no-op.
- Until this branch reaches `main`, the gates' `ref: main` checkout will not
  contain these scripts. That is inherent to running trusted default-branch
  code, and is the correct failure direction.

## Reuse

This module deliberately does **not** extend `tools/ai-orchestrator/**` or
`tools/ops-review-loop/**` — both are already protected-path control planes for
a *different* machine. The pagination-complete-or-throw pattern and the
`<!-- NAMESPACE: {json} -->` marker convention are reused by imitation (same
shape, independently implemented) rather than by importing one control plane's
internals into another's.
