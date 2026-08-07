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

201 tests, all against mock providers. No network, no credentials, no spend.
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
src/adapters/     github (client · ledger · in-memory · REST) · openai · claude · workspace (git · GitHub PR)
src/config/       the concrete scaffold configuration
src/runner.ts     preflight and the loop        src/turn-executor.ts  one turn, end to end
src/runner-types.ts  shared types               src/runner-context.ts ledger writes and transitions
tests/            201 tests
```

## The four things worth knowing

**The model does not describe its own turn into compliance.** `files_changed`
comes from `git diff` plus `git status` (an uncommitted change is still a change),
or from GitHub's PR file list. `tools_used` comes from the execution log.
Commit and PR identity come from the adapters. What the model reports is compared
against that record; a mismatch parks the run rather than passing.


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

**Money is committed before the call, not after.** A turn reserves
`max_turn_cost_usd` in the ledger, and may only start when that much budget is
still free — so the cap cannot be crossed by the next call. A reservation whose
runner vanished is never released: we cannot know the provider did not bill us.

## What stops a run

| Guard | Default | Lands on |
|---|---|---|
| kill switch (label · env var · workflow input) | off | `CANCELLED` |
| max rounds | 6 | `BUDGET_EXHAUSTED` |
| cost cap (remaining must cover a full reservation) | $2.00 / $0.50 per turn | `BUDGET_EXHAUSTED` |
| wall clock | 20 min | `BUDGET_EXHAUSTED` |
| provider call timeout | 8 min | `provider_timeout`, reservation settled in full |
| lease TTL shorter than timeout + margin | — | refuses to start at all |
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
