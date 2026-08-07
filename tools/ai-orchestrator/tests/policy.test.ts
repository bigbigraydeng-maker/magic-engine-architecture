import { describe, expect, it } from 'vitest'

import { implementerTurnOutputSchema, workPackageAuthorizationSchema } from '../src/domain/schema'
import {
  ENABLE_ENV_VAR,
  KILL_SWITCH_LABEL,
  checkBudget,
  enforceAuthorizationWindow,
  enforceFileScope,
  enforceProtectedPaths,
  enforceSideEffectClass,
  enforceToolUse,
  evaluateImplementerTurn,
  evaluateKillSwitch,
} from '../src/policy/policy'
import { PROTECTED_PATHS, comparePolicySnapshots, snapshotPolicy } from '../src/policy/protected-paths'
import { matchesGlob, matchesWildcard } from '../src/policy/glob'
import { createScaffoldAuthorization, createScaffoldRun } from '../src/config/scaffold-config'
import { implementerOutput } from './helpers'

const NOW = new Date('2026-08-07T00:00:00.000Z')

const authorization = createScaffoldAuthorization({
  workPackageId: 'wp-860',
  now: NOW,
  authorizationSource: 'issue#860',
})

describe('kill switch (default off)', () => {
  it('stops when the label is present, even if everything else says go', () => {
    const result = evaluateKillSwitch({
      workflowEnabledInput: true,
      env: { [ENABLE_ENV_VAR]: 'true' },
      issueLabels: [KILL_SWITCH_LABEL],
    })
    expect(result).toEqual({ stopped: true, reason: expect.stringContaining(KILL_SWITCH_LABEL) })
  })

  it('stops when the workflow input is false', () => {
    const result = evaluateKillSwitch({
      workflowEnabledInput: false,
      env: { [ENABLE_ENV_VAR]: 'true' },
      issueLabels: [],
    })
    expect(result.stopped).toBe(true)
  })

  it.each(['', undefined, '1', 'yes', 'TRUE', 'True'])(
    'stops when %s is the env value (only the exact string "true" enables)',
    (value) => {
      const result = evaluateKillSwitch({
        workflowEnabledInput: true,
        env: { [ENABLE_ENV_VAR]: value },
        issueLabels: [],
      })
      expect(result.stopped).toBe(true)
    }
  )

  it('runs only when all three agree', () => {
    const result = evaluateKillSwitch({
      workflowEnabledInput: true,
      env: { [ENABLE_ENV_VAR]: 'true' },
      issueLabels: ['enhancement'],
    })
    expect(result).toEqual({ stopped: false, reason: null })
  })
})

describe('budget', () => {
  const limits = { max_rounds: 6, cost_cap_usd: 2, max_wall_clock_ms: 600_000, max_invalid_outputs: 2 }
  const run = createScaffoldRun({
    runId: 'r1',
    issueNumber: 860,
    mode: 'REVIEW',
    workPackageId: 'wp-860',
    now: NOW,
  })

  it('passes inside every limit', () => {
    expect(checkBudget(run, limits, NOW).ok).toBe(true)
  })

  it('stops at max rounds', () => {
    const result = checkBudget({ ...run, current_round: 6 }, limits, NOW)
    expect(result).toMatchObject({ ok: false, stop_reason: 'max_rounds_reached' })
  })

  it('uses the tighter of the run cap and the deployment cap', () => {
    const result = checkBudget({ ...run, current_round: 3 }, { ...limits, max_rounds: 3 }, NOW)
    expect(result).toMatchObject({ ok: false, stop_reason: 'max_rounds_reached' })
  })

  it('stops at the cost cap', () => {
    const result = checkBudget({ ...run, cumulative_cost_usd: 2 }, limits, NOW)
    expect(result).toMatchObject({ ok: false, stop_reason: 'cost_cap_reached' })
  })

  it('stops after the wall-clock deadline', () => {
    const past = new Date(Date.parse(run.deadline_at) + 1)
    expect(checkBudget(run, limits, past)).toMatchObject({
      ok: false,
      stop_reason: 'wall_clock_exceeded',
    })
  })
})

describe('authorization window', () => {
  it('accepts a live authorization', () => {
    expect(enforceAuthorizationWindow(authorization, NOW).allowed).toBe(true)
  })

  it('rejects an expired authorization', () => {
    const expired = new Date(Date.parse(authorization.expires_at) + 1)
    expect(enforceAuthorizationWindow(authorization, expired)).toMatchObject({
      allowed: false,
      code: 'AUTHORIZATION_EXPIRED',
    })
  })

  it('refuses to parse an authorization that forgets an always-prohibited operation', () => {
    const parsed = workPackageAuthorizationSchema.safeParse({
      ...authorization,
      prohibited_operations: ['merge'],
    })
    expect(parsed.success).toBe(false)
  })

  it('cannot be constructed with can_merge true', () => {
    const parsed = workPackageAuthorizationSchema.safeParse({
      ...authorization,
      scope: { ...authorization.scope, can_merge: true },
    })
    expect(parsed.success).toBe(false)
  })
})

describe('side-effect class', () => {
  it('permits repo_local in the scaffold deployment', () => {
    expect(enforceSideEffectClass(authorization, ['none', 'repo_local']).allowed).toBe(true)
  })

  it('rejects an outward work package', () => {
    expect(
      enforceSideEffectClass({ ...authorization, side_effect_class: 'outward' }, ['none', 'repo_local'])
    ).toMatchObject({ allowed: false, code: 'SIDE_EFFECT_CLASS_NOT_ALLOWED' })
  })
})

describe('path scope', () => {
  it('accepts files inside the allowed globs', () => {
    expect(
      enforceFileScope(authorization.scope, [
        'tools/ai-orchestrator/src/runner.ts',
        'docs/specs/2026-08-07-ai-orchestrator-v0.1.md',
      ]).allowed
    ).toBe(true)
  })

  it('rejects a file outside the allowed globs', () => {
    expect(
      enforceFileScope(authorization.scope, ['src/lib/execution/auto-run-policy.ts'])
    ).toMatchObject({ allowed: false, code: 'PATH_EXPLICITLY_DENIED' })
  })

  it('rejects an unlisted path even when it is not explicitly denied', () => {
    expect(enforceFileScope(authorization.scope, ['website/index.html'])).toMatchObject({
      allowed: false,
      code: 'PATH_OUT_OF_SCOPE',
    })
  })

  it('normalises ./ prefixes so they cannot be used to slip past a deny rule', () => {
    expect(enforceFileScope(authorization.scope, ['./src/lib/a.ts'])).toMatchObject({
      allowed: false,
    })
  })
})

describe('protected paths', () => {
  it.each([...PROTECTED_PATHS.map((p) => p.replace('/**', '/x.ts'))])(
    'refuses a turn touching %s',
    (path) => {
      expect(enforceProtectedPaths([path])).toMatchObject({
        allowed: false,
        code: 'PROTECTED_PATH_TOUCHED',
      })
    }
  )

  it('specifically refuses the active workflow file', () => {
    expect(
      enforceProtectedPaths(['.github/workflows/ai-orchestrator-manual.yml'])
    ).toMatchObject({ allowed: false, code: 'PROTECTED_PATH_TOUCHED' })
  })

  it('allows ordinary orchestrator source files', () => {
    expect(enforceProtectedPaths(['tools/ai-orchestrator/src/runner.ts']).allowed).toBe(true)
  })
})

describe('tool allowlist', () => {
  it('accepts tools on the list', () => {
    expect(enforceToolUse(authorization.scope, ['Read', 'Edit', 'Bash(npm test)']).allowed).toBe(true)
  })

  it('rejects a tool that is simply not listed', () => {
    expect(enforceToolUse(authorization.scope, ['Read', 'Task'])).toMatchObject({
      allowed: false,
      code: 'TOOL_NOT_ALLOWED',
      offending: ['Task'],
    })
  })

  it('rejects an explicitly disallowed tool even when a broader allow rule would match', () => {
    expect(enforceToolUse(authorization.scope, ['Bash(gh pr merge 861)'])).toMatchObject({
      allowed: false,
      code: 'TOOL_NOT_ALLOWED',
    })
  })

  it('rejects a force push', () => {
    expect(enforceToolUse(authorization.scope, ['Bash(git push --force origin main)'])).toMatchObject({
      allowed: false,
    })
  })
})

describe('evaluateImplementerTurn', () => {
  it('accepts a clean turn', () => {
    const output = implementerTurnOutputSchema.parse(implementerOutput())
    expect(evaluateImplementerTurn(authorization, output).allowed).toBe(true)
  })

  it('reports the protected-path violation ahead of the scope violation', () => {
    const output = implementerTurnOutputSchema.parse(
      implementerOutput({
        files_changed: ['.github/workflows/ai-orchestrator-manual.yml', 'src/lib/a.ts'],
      })
    )
    expect(evaluateImplementerTurn(authorization, output)).toMatchObject({
      code: 'PROTECTED_PATH_TOUCHED',
    })
  })

  it('rejects a commit when committing is not authorized', () => {
    const readOnly = { ...authorization, scope: { ...authorization.scope, can_commit: false, can_push: false } }
    const output = implementerTurnOutputSchema.parse(
      implementerOutput({ commit_evidence: { branch: 'x', commit_sha: 'abc123', pr_number: null } })
    )
    expect(evaluateImplementerTurn(readOnly, output)).toMatchObject({
      allowed: false,
      code: 'COMMIT_NOT_AUTHORIZED',
    })
  })

  it('rejects opening a PR when that is not authorized', () => {
    const noPr = { ...authorization, scope: { ...authorization.scope, can_open_draft_pr: false } }
    const output = implementerTurnOutputSchema.parse(
      implementerOutput({ commit_evidence: { branch: 'x', commit_sha: 'abc123', pr_number: 861 } })
    )
    expect(evaluateImplementerTurn(noPr, output)).toMatchObject({
      allowed: false,
      code: 'PR_NOT_AUTHORIZED',
    })
  })
})

describe('policy integrity snapshots', () => {
  it('detects a changed control-plane file', () => {
    const before = snapshotPolicy({ 'policy.ts': 'original' })
    const after = snapshotPolicy({ 'policy.ts': 'tampered' })
    expect(comparePolicySnapshots(before, after)).toEqual({ intact: false, drifted: ['policy.ts'] })
  })

  it('detects a deleted and an added file', () => {
    const before = snapshotPolicy({ 'a.ts': 'x', 'b.ts': 'y' })
    const after = snapshotPolicy({ 'a.ts': 'x', 'c.ts': 'z' })
    expect(comparePolicySnapshots(before, after)).toEqual({ intact: false, drifted: ['b.ts', 'c.ts'] })
  })

  it('reports intact when nothing moved', () => {
    const snapshot = snapshotPolicy({ 'a.ts': 'x' })
    expect(comparePolicySnapshots(snapshot, snapshot)).toEqual({ intact: true, drifted: [] })
  })
})

describe('glob semantics', () => {
  it('does not let a single star cross a directory boundary', () => {
    expect(matchesGlob('src/lib/a.ts', 'src/*')).toBe(false)
    expect(matchesGlob('src/a.ts', 'src/*')).toBe(true)
    expect(matchesGlob('src/lib/a.ts', 'src/**')).toBe(true)
  })

  it('lets a tool wildcard cross slashes, because tool names are not paths', () => {
    expect(matchesWildcard('Bash(git push origin feat/x)', 'Bash(git push origin*)')).toBe(true)
  })
})
