/**
 * Shared fixtures. Deliberately not named `*.test.ts` so vitest does not collect
 * it as a suite.
 *
 * The harness keeps the model's self-report and the authoritative record as two
 * separate knobs (`implementerScript` vs `workspace` / `telemetry`), because most
 * of what these tests need to prove is what happens when the two disagree.
 */

import { InMemoryGitHubClient } from '../src/adapters/github/memory-client'
import { MockImplementerProvider } from '../src/adapters/claude/mock-implementer'
import type { MockImplementerStep } from '../src/adapters/claude/mock-implementer'
import { MockReviewerProvider } from '../src/adapters/openai/mock-reviewer'
import type { MockReviewerStep } from '../src/adapters/openai/mock-reviewer'
import { StaticWorkspaceInspector } from '../src/adapters/workspace/inspector'
import type { WorkspaceSnapshot } from '../src/adapters/workspace/inspector'
import {
  ALLOWED_AUTHORIZERS,
  PERMITTED_SIDE_EFFECT_CLASSES,
  SCAFFOLD_LEASE_TTL_MS,
  SCAFFOLD_LIMITS,
  TRUSTED_LEDGER_AUTHORS,
  createScaffoldAuthorization,
  createScaffoldRun,
} from '../src/config/scaffold-config'
import type { OrchestrationRun, WorkPackageAuthorization } from '../src/domain/schema'
import { StaticIntegrityChecker } from '../src/policy/protected-paths'
import type { Clock, RunnerDeps, RunnerInput } from '../src/runner'

export const FIXED_NOW = new Date('2026-08-07T00:00:00.000Z')

export function fixedClock(now: Date = FIXED_NOW): Clock {
  return { now: () => now }
}

export const ENABLED_ENV = { ME2_ORCHESTRATOR_ENABLED: 'true' } as const

/** The in-scope file every default fixture pretends to have changed. */
export const IN_SCOPE_FILE = 'docs/specs/2026-08-07-ai-orchestrator-v0.1.md'

export function reviewerOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'REQUEST_CHANGES',
    summary: 'The budget check runs after the money is already gone.',
    findings: [
      {
        severity: 'blocker',
        evidence: 'tools/ai-orchestrator/src/policy/policy.ts:checkBudget',
        source_ref: 'policy.ts',
        reasoning: 'A cap compared only against settled spend can be crossed by the next call.',
      },
    ],
    acceptance_criteria: ['A turn may only start when a full reservation still fits'],
    allowed_next_scope: { allowed_paths: ['docs/specs/**'], notes: null },
    prohibited_next_actions: ['merge', 'deploy'],
    human_question: null,
    ...overrides,
  }
}

export function implementerOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conclusion: 'Reserved the turn cost before the call and reconciled it after.',
    repo_evidence: ['docs/specs/2026-08-07-ai-orchestrator-v0.1.md:§7'],
    files_changed: [IN_SCOPE_FILE],
    tests_run: [{ command: 'npx vitest run tools/ai-orchestrator', passed: 12, failed: 0, note: null }],
    baseline_comparison: 'baseline on this commit: 12 passed / 0 failed. No new failures.',
    remaining_risks: ['Lease TTL is a guess until we see real runner durations.'],
    requested_next_scope: [],
    policy_exceptions: [],
    tools_used: ['Read', 'Edit'],
    commit_evidence: null,
    ...overrides,
  }
}

/** The record git/GitHub would report for a well-behaved default turn. */
export function workspaceSnapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    changed_files: [IN_SCOPE_FILE],
    commit: null,
    pull_request: null,
    source: 'git:diff+status',
    ...overrides,
  }
}

export interface Harness {
  github: InMemoryGitHubClient
  reviewer: MockReviewerProvider
  implementer: MockImplementerProvider
  deps: RunnerDeps
  input: RunnerInput
  run: OrchestrationRun
  authorization: WorkPackageAuthorization
}

export function makeHarness(options?: {
  reviewerScript?: readonly MockReviewerStep[]
  implementerScript?: readonly MockImplementerStep[]
  now?: Date
  dryRun?: boolean
  runOverrides?: Partial<OrchestrationRun>
  inputOverrides?: Partial<RunnerInput>
  depsOverrides?: Partial<RunnerDeps>
  labels?: readonly string[]
  /** What git / the GitHub PR would authoritatively report. */
  workspace?: WorkspaceSnapshot
  /** Protected paths the integrity checker finds drifted. */
  drift?: readonly string[]
}): Harness {
  const now = options?.now ?? FIXED_NOW
  const github = new InMemoryGitHubClient({ labels: options?.labels })
  const reviewer = new MockReviewerProvider(
    options?.reviewerScript ?? [{ output: reviewerOutput({ verdict: 'APPROVED_FOR_NEXT_STAGE' }) }]
  )
  const implementer = new MockImplementerProvider(
    options?.implementerScript ?? [{ output: implementerOutput() }]
  )

  const authorization = createScaffoldAuthorization({
    workPackageId: 'wp-860-scaffold',
    now,
    authorizationSource: 'github-issue#860',
  })

  const run: OrchestrationRun = {
    ...createScaffoldRun({
      runId: 'run-test-001',
      issueNumber: 860,
      mode: 'REVIEW',
      workPackageId: authorization.work_package_id,
      now,
    }),
    ...options?.runOverrides,
  }

  const input: RunnerInput = {
    run,
    authorization,
    limits: SCAFFOLD_LIMITS,
    dryRun: options?.dryRun ?? false,
    workflowEnabledInput: true,
    env: { ...ENABLED_ENV },
    trustedAuthors: [...TRUSTED_LEDGER_AUTHORS],
    allowedAuthorizers: [...ALLOWED_AUTHORIZERS],
    holder: 'test-holder',
    leaseTtlMs: SCAFFOLD_LEASE_TTL_MS,
    permittedSideEffectClasses: [...PERMITTED_SIDE_EFFECT_CLASSES],
    taskBrief: 'Review the v0.1 orchestrator scaffold.',
    untrusted: [{ source: 'issue#860', text: 'Scaffold the orchestrator. Do not enable anything.' }],
    ...options?.inputOverrides,
  }

  const deps: RunnerDeps = {
    github,
    reviewer,
    implementer,
    workspace: new StaticWorkspaceInspector(options?.workspace ?? workspaceSnapshot()),
    integrity: new StaticIntegrityChecker(options?.drift ?? []),
    clock: fixedClock(now),
    ...options?.depsOverrides,
  }

  return { github, reviewer, implementer, deps, input, run, authorization }
}
