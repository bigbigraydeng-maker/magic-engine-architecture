# ME2 AI Orchestrator — v0.1 scaffold

Control plane that lets a GPT reviewer and a Claude implementer take turns around a
GitHub Issue, under hard limits, and stop for a human at every risk gate.

**It is inactive.** No schedule, no automatic trigger, no model call, no repository
write, no cost. Turning it on is a separate, separately-authorized change — see the
Enable checklist in [`docs/specs/2026-08-07-ai-orchestrator-v0.1.md`](../../docs/specs/2026-08-07-ai-orchestrator-v0.1.md) §9.

This is engineering tooling, not Magic Engine product runtime. It imports nothing
from `src/`, touches no database, and sees no customer data.

## Run it

```bash
npx vitest run tools/ai-orchestrator
```

269 tests, all against mock providers. No network, no credentials, no spend.
The dry-run test prints a preflight report showing every guard it evaluated and
what it *would* do next.

No new dependencies: this reuses the repository's `zod` and `vitest`. There is no
`package.json` here on purpose — the root `tsconfig.json` (`include: ["**/*.ts"]`)
and root `vitest.config.ts` already cover this directory.

## Layout

```
src/domain/       schema (zod) · state machine · fold · budget · lease · digest · errors
src/policy/       limits · kill switch · scope + tool enforcement · protected paths · untrusted input
src/prompts/      versioned reviewer and implementer system policies
src/adapters/     github · openai · claude · workspace (git · GitHub PR) · pricing
src/config/       the concrete scaffold configuration
src/runner.ts     preflight and the loop        src/turn-executor.ts  one turn, end to end
src/runner-types.ts  shared types               src/runner-context.ts ledger writes and transitions
tests/            269 tests
```

## The five things worth knowing

**The model does not describe its own turn into compliance.** `files_changed`
comes from `git diff` plus `git status` (an uncommitted change is still a change),
or from GitHub's PR file list. `tools_used` comes from the execution log.
Commit and PR identity come from the adapters. What the model reports is compared
against that record; a mismatch parks the run rather than passing.

**A turn is judged on its delta, not on the whole branch.** The inspector captures
a state before and after each call and diffs the pair by content fingerprint.
Round 1's files are not round 2's work, and "the repository has a HEAD" is not
evidence that this turn committed anything. The cumulative view is kept too, for
the question it actually answers: has the branch as a whole strayed out of scope.


**One round is one agent turn**, not a GPT+Claude pair. It keeps `max_rounds`
unambiguous and means IMPLEMENT mode (which starts with Claude) needs no special
case.

**Run state is a fold over the ledger**, never a second stored copy. A
re-dispatched workflow reads the same Issue comments, lands on the same state, and
does not repeat work. A turn event carries the state it moved the run to, so a
crash cannot land between "the turn happened" and "the run moved on".

**`WAITING_HUMAN` never resumes on its own.** It takes a `human_authorization`
event from an allowlisted login, naming this run, not yet expired. Re-running the
workflow does nothing. That is the point.

**Money is committed before the call, at a price the provider quotes.** The
adapter computes the worst case from its own price table — estimated input tokens,
the full output ceiling, cache and tool surcharges, a named `pricing_version` —
and the runner reserves exactly that. No quote, no call: a missing, stale or
oversized input is refused rather than guessed at. A reservation whose runner
vanished is never released, because we cannot know the provider did not bill us.

**A timeout is only a wall if the call really stops.** The runner aborts an
`AbortController` the adapter must honour. An adapter that cannot prove it
cancels declares so, and the lease is then sized to the provider's server-side
maximum instead of to our own timeout. Both real adapters currently declare
`supported: false` — killing our `await` does not kill a child process.

## What stops a run

| Guard | Default | Lands on |
|---|---|---|
| kill switch (label · env var · workflow input) | off | `CANCELLED` |
| max rounds | 6 | `BUDGET_EXHAUSTED` |
| cost cap (remaining must cover the quoted worst case) | $2.00 | `BUDGET_EXHAUSTED` |
| no usable price quote (missing / stale / input too large) | — | `WAITING_HUMAN`, zero calls |
| actual cost above the reservation | — | `WAITING_HUMAN` (the price model is wrong) |
| wall clock | 20 min | `BUDGET_EXHAUSTED` |
| provider call timeout | 8 min | aborted; `provider_timeout`, reservation settled in full |
| lease TTL shorter than the in-flight window + margin | — | refuses to start at all |
| schema-invalid provider output | 2 strikes | `FAILED` |
| out-of-scope path, denied path, unlisted tool (from the record) | — | `WAITING_HUMAN` |
| self-report does not match the record | — | `WAITING_HUMAN` |
| no usable execution telemetry | — | `WAITING_HUMAN` |
| control-plane file touched or drifted | — | `WAITING_HUMAN` |
| authorization expired | 6 h | `WAITING_HUMAN` |

Every one of these is checked *before* anything is spent or written.

## Self-protection

An agent running under this orchestrator cannot change the files that govern it.
The protected surface is `.github/**`, `CODEOWNERS` and **all** of
`tools/ai-orchestrator/**` — not a hand-picked subset, because `runner.ts`,
`schema.ts`, the ledger and the adapters can each defeat the guards just as
thoroughly as `policy.ts` can.

The intended consequence: **this tool cannot upgrade itself.**
`workPackageScopeSchema` refuses to parse an authorization whose allowed paths
overlap that surface, so a self-modifying work package cannot be built at all.

Five layers, strongest first:

1. `GITHUB_TOKEN` has no `workflows:` permission, so GitHub itself rejects any push
   touching `.github/workflows/**`. This holds on the Free plan.
2. Only `workflow_dispatch`, which requires repository write access — the agent
   cannot wake itself up.
3. `workPackageScopeSchema` rejects an authorization that grants the surface.
4. `PROTECTED_PATHS` rejects a turn whose **real** changed-file list touches it.
5. `GitControlPlaneIntegrityChecker` asks git whether the surface moved, after
   every turn. This catches the case layer 4 cannot: a change nobody declared.

Branch protection and enforced CODEOWNERS review would be layer 6. **They are not
available on this repository** (private repo, GitHub Free) — that is the one
blocking item for the Enable phase, and it is a decision for the PM.
