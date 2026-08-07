/**
 * Shared fixtures. Deliberately not named `*.test.ts` so vitest does not collect
 * it as a suite.
 */

import { InMemoryGitHubClient } from '../src/adapters/github/memory-client'
import { MockImplementerProvider } from '../src/adapters/claude/mock-implementer'
import type { MockImplementerStep } from '../src/adapters/claude/mock-implementer'
import { MockReviewerProvider } from '../src/adapters/openai/mock-reviewer'
import type { MockReviewerStep } from '../src/adapters/openai/mock-reviewer'
import {
  ALLOWED_AUTHORIZERS,
  PERMITTED_SIDE_EFFECT_CLASSES,
  SCAFFOLD_LIMITS,
  TRUSTED_LEDGER_AUTHORS,
  createScaffoldAuthorization,
  createScaffoldRun,
} from '../src/config/scaffold-config'
import type { OrchestrationRun, WorkPackageAuthorization } from '../src/domain/schema'
import type { Clock, RunnerDeps, RunnerInput } from '../src/runner'

export const FIXED_NOW = new Date('2026-08-07T00:00:00.000Z')

export function fixedClock(now: Date = FIXED_NOW): Clock {
  return { now: () => now }
}

export const ENABLED_ENV = { ME2_ORCHESTRATOR_ENABLED: 'true' } as const

export function reviewerOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verdict: 'REQUEST_CHANGES',
    summary: 'The state machine lacks a guard on WAITING_HUMAN.',
    findings: [
      {
        severity: 'major',
        evidence: 'tools/ai-orchestrator/src/domain/state-machine.ts:70',
        source_ref: 'state-machine.ts',
        reasoning: 'Resuming without an authorization event would defeat the human gate.',
      },
    ],
    acceptance_criteria: ['WAITING_HUMAN only resumes on a valid authorization event'],
    allowed_next_scope: { allowed_paths: ['tools/ai-orchestrator/**'], notes: null },
    prohibited_next_actions: ['merge', 'deploy'],
    human_question: null,
    ...overrides,
  }
}

export function implementerOutput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conclusion: 'Threaded the input digest through the runner and added a test for it.',
    repo_evidence: ['tools/ai-orchestrator/src/runner.ts:250'],
    files_changed: ['tools/ai-orchestrator/src/runner.ts'],
    tests_run: [{ command: 'npx vitest run tools/ai-orchestrator', passed: 12, failed: 0, note: null }],
    baseline_comparison: 'baseline on this commit: 12 passed / 0 failed. No new failures.',
    remaining_risks: ['Lease TTL is a guess until we see real runner durations.'],
    requested_next_scope: [],
    policy_exceptions: [],
    tools_used: ['Read', 'Edit', 'Bash(npm test)'],
    commit_evidence: null,
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
  labels?: readonly string[]
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
    leaseTtlMs: 10 * 60 * 1000,
    permittedSideEffectClasses: [...PERMITTED_SIDE_EFFECT_CLASSES],
    policySnapshot: { 'tools/ai-orchestrator/src/policy/policy.ts': 'hash-a' },
    taskBrief: 'Review the v0.1 orchestrator scaffold.',
    untrusted: [{ source: 'issue#860', text: 'Scaffold the orchestrator. Do not enable anything.' }],
    ...options?.inputOverrides,
  }

  return {
    github,
    reviewer,
    implementer,
    deps: { github, reviewer, implementer, clock: fixedClock(now) },
    input,
    run,
    authorization,
  }
}
