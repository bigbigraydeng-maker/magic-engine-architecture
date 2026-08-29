# Build Control

Deterministic, dependency-free validators for the recovery machine-lock
described in Issue #1249. Every module here is pure (no I/O, no network, no
clock unless a timestamp is passed in) so it can be unit-tested offline and
imported by the same GitHub Actions workflows that enforce it.

No new npm dependency was added. CLI entrypoints are plain ESM (`.mjs`, like
`tools/ops-review-loop/`) so a workflow can run them with `node <file>.mjs`
straight off `actions/setup-node`, with no build step.

## Modules

| File | What it validates |
|---|---|
| `src/primary-issue.mjs` | Exactly one `Primary-Issue: #<n>` field in a PR body; rejects ambiguous refs like `Related: #999`. |
| `src/outcome-contract.mjs` | The `## Outcome-Contract` section (Proof / Verification-Window / Owner / Status). `UNKNOWN` is a valid value; a missing field is not. |
| `src/control-state.mjs` | Strict `ME_CONTROL_STATE_V1` payload shape + `updated_at` freshness against the comment timestamp. Completeness is *computed* from field presence, never trusted from a self-declared flag. |
| `src/merge-auth.mjs` | `ME_MERGE_AUTH_V1` marker: build, parse, and exact-match against the PR's current full head SHA from an author allowlist. |
| `src/outcome-receipt.mjs` | `ME_OUTCOME_RECEIPT_V1` marker: Execution / Activation / Measurement / Outcome / Tune stages. `isImpactComplete` requires Measurement + Outcome + Tune to all read `DONE` — Execution alone never satisfies IMPACT completion. |
| `src/duplicate-lane.mjs` | Groups open PRs (Draft included) by declared `Primary-Issue`; flags any group with more than one PR. |
| `src/pr-cap.mjs` | Recovery cap (12 open PRs) for *new* implementation PRs only; a remediation comment on an existing PR is never gated by the cap. |
| `src/github.mjs` | Minimal `fetch`-based GitHub REST client. Pagination is complete-or-throw — a failed or partial page is a thrown error, never a shorter list (mirrors `tools/ai-orchestrator/src/adapters/github/rest-client.ts` and `tools/ops-review-loop/src/github.mjs`). |

CLI entrypoints (`src/*-cli.mjs`) wire the above into the workflows under
`.github/workflows/build-control-*.yml` and the narrow preflight added to
`.github/workflows/claude.yml`. They are the only files here that perform I/O.

## Reuse

This module deliberately does **not** extend `tools/ai-orchestrator/**` or
`tools/ops-review-loop/**` — both are already on protected-path denylists as
control planes for a *different* machine (the AI orchestrator scaffold and the
Codex review loop, respectively), and CLAUDE.md's platformization gate treats
"no refactor of `tools/ai-orchestrator/**` unless reuse audit proves a narrow
existing seam" as a hard constraint. The pagination-complete-or-throw pattern
and the `<!-- NAMESPACE: {json} -->` marker convention are reused *by
imitation* (same shape, independently implemented), because lifting the code
itself would mean importing one control plane's internals into another's.
