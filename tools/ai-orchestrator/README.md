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

135 tests, all against mock providers. No network, no credentials, no spend.
The dry-run test prints a preflight report showing every guard it evaluated and
what it *would* do next.

No new dependencies: this reuses the repository's `zod` and `vitest`. There is no
`package.json` here on purpose — the root `tsconfig.json` (`include: ["**/*.ts"]`)
and root `vitest.config.ts` already cover this directory.

## Layout

```
src/domain/       schema (zod) · state machine · fold · lease · digest · errors
src/policy/       limits · kill switch · scope + tool enforcement · protected paths · untrusted input
src/prompts/      versioned reviewer and implementer system policies
src/adapters/     github (client · ledger · in-memory · REST skeleton) · openai · claude
src/config/       the concrete scaffold configuration
src/runner.ts     the orchestration loop
tests/            135 tests
```

## The three things worth knowing

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

## What stops a run

| Guard | Default | Lands on |
|---|---|---|
| kill switch (label · env var · workflow input) | off | `CANCELLED` |
| max rounds | 6 | `BUDGET_EXHAUSTED` |
| cost cap | $2.00 | `BUDGET_EXHAUSTED` |
| wall clock | 20 min | `BUDGET_EXHAUSTED` |
| schema-invalid provider output | 2 strikes | `FAILED` |
| out-of-scope path, denied path, unlisted tool | — | `WAITING_HUMAN` |
| control-plane file touched or drifted | — | `WAITING_HUMAN` |
| authorization expired | 6 h | `WAITING_HUMAN` |

Every one of these is checked *before* anything is spent or written.

## Self-protection

An agent running under this orchestrator cannot change the files that govern it.
Four layers, strongest first:

1. `GITHUB_TOKEN` has no `workflows:` permission, so GitHub itself rejects any push
   touching `.github/workflows/**`. This holds on the Free plan.
2. Only `workflow_dispatch`, which requires repository write access — the agent
   cannot wake itself up.
3. `PROTECTED_PATHS` rejects a turn that reports touching the control plane.
4. A sha256 snapshot of the control-plane files is re-read after each turn; drift
   halts the run. This catches the case layer 3 cannot: a change that was made but
   not reported.

Branch protection and enforced CODEOWNERS review would be layer 5. **They are not
available on this repository** (private repo, GitHub Free) — that is the one
blocking item for the Enable phase, and it is a decision for the PM.
