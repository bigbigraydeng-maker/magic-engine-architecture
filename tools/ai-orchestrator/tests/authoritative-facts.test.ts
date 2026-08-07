/**
 * The model does not get to describe its own turn into compliance.
 *
 * Every test here makes the implementer say one thing while git, GitHub and the
 * execution harness say another, and asserts the record wins. Each has a positive
 * control immediately after it, so "the run halted" is never mistaken for "the
 * runner is broken and halts on everything".
 */

import { describe, expect, it } from 'vitest'

import { GitControlPlaneIntegrityChecker, GitWorkspaceInspector, parsePorcelain } from '../src/adapters/workspace/git-inspector'
import type { CommandRunner } from '../src/adapters/workspace/git-inspector'
import { GitHubPullRequestInspector, selectInspector } from '../src/adapters/workspace/github-pr-inspector'
import { InMemoryGitHubClient } from '../src/adapters/github/memory-client'
import { StaticWorkspaceInspector } from '../src/adapters/workspace/inspector'
import { TELEMETRY_UNAVAILABLE } from '../src/adapters/provider-types'
import { runOrchestration } from '../src/runner'
import { IN_SCOPE_FILE, implementerOutput, makeHarness, reviewerOutput, workspaceSnapshot } from './helpers'

function rejection(result: Awaited<ReturnType<typeof runOrchestration>>) {
  return result.appended.find((event) => event.event === 'turn_rejected')
}

describe('a lie about files_changed is caught by the real diff', () => {
  it('halts when git reports a file the model did not mention', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      // The model reports only the in-scope doc...
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      // ...but git says it also rewrote a business module.
      workspace: workspaceSnapshot({
        changed_files: [IN_SCOPE_FILE, 'src/lib/execution/auto-run-policy.ts'],
      }),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(result.run.stop_reason).toBe('policy_violation')
    const rejected = rejection(result)
    expect(rejected).toMatchObject({ reason: 'policy_violation' })
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PATH_EXPLICITLY_DENIED')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain(
      'src/lib/execution/auto-run-policy.ts'
    )
  })

  it('halts when git reports a protected file the model did not mention', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      workspace: workspaceSnapshot({
        changed_files: [IN_SCOPE_FILE, 'tools/ai-orchestrator/src/policy/policy.ts'],
      }),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toMatchObject({ reason: 'policy_violation' })
    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PROTECTED_PATH_TOUCHED')
  })

  it('halts when the model claims a file git never saw change', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput({ files_changed: [IN_SCOPE_FILE] }) }],
      workspace: workspaceSnapshot({ changed_files: [] }),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(rejection(result)).toMatchObject({ reason: 'self_report_mismatch' })
  })

  it('lets an honest turn through — the positive control', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput() }],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: workspaceSnapshot(),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(rejection(result)).toBeUndefined()
    expect(h.implementer.callCount).toBe(1)
  })
})

describe('an under-reported tool is caught by execution telemetry', () => {
  it('halts when the harness saw a tool the model omitted', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          // The model's account is clean...
          output: implementerOutput({ tools_used: ['Read', 'Edit'] }),
          // ...but the execution log says otherwise.
          telemetry: {
            tools_used: ['Read', 'Edit', 'Bash(gh pr merge 861 --admin)'],
            source: 'claude-code-action:execution-log',
          },
        },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    const rejected = rejection(result)
    expect(rejected).toMatchObject({ reason: 'policy_violation' })
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('TOOL_NOT_ALLOWED')
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('Bash(gh pr merge 861 --admin)')
  })

  it('records where the tool list came from, so the claim can be audited', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput(), telemetry: { source: 'claude-code-action:execution-log' } },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
    })

    const result = await runOrchestration(h.input, h.deps)
    const completed = result.appended.find(
      (event) => event.event === 'turn_completed' && event.actor === 'claude_implementer'
    )
    expect(completed && 'authoritative' in completed && completed.authoritative?.sources).toEqual({
      workspace: 'git:diff+status',
      telemetry: 'claude-code-action:execution-log',
    })
  })
})

describe('telemetry that does not exist is not evidence of compliance', () => {
  it('fails the turn closed when the adapter cannot produce an execution record', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        { output: implementerOutput(), telemetry: { source: TELEMETRY_UNAVAILABLE } },
      ],
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(rejection(result)).toMatchObject({ reason: 'missing_telemetry' })
  })

  it('fails the turn closed when the source is blank', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [{ output: implementerOutput(), telemetry: { source: '' } }],
    })

    const result = await runOrchestration(h.input, h.deps)
    expect(rejection(result)).toMatchObject({ reason: 'missing_telemetry' })
  })
})

describe('commit and pull request identity come from the adapters', () => {
  it('halts when the model invents a commit the record does not have', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'claude/x', commit_sha: 'deadbeef', pr_number: 861 },
          }),
        },
      ],
      workspace: workspaceSnapshot({ commit: null, pull_request: null }),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.state).toBe('WAITING_HUMAN')
    expect(rejection(result)).toMatchObject({ reason: 'self_report_mismatch' })
  })

  it('takes the branch and PR number from the record, not the model', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'real-branch', commit_sha: 'abc123', pr_number: 861 },
          }),
        },
      ],
      reviewerScript: [{ output: reviewerOutput({ verdict: 'WAITING_HUMAN', human_question: 'ok?' }) }],
      workspace: workspaceSnapshot({
        commit: { sha: 'abc123', branch: 'real-branch' },
        pull_request: { number: 861, head_sha: 'abc123', head_ref: 'real-branch', merged: false },
      }),
    })

    const result = await runOrchestration(h.input, h.deps)

    expect(result.run.target_branch).toBe('real-branch')
    expect(result.run.pr_number).toBe(861)
    expect(rejection(result)).toBeUndefined()
  })

  it('halts when the record says the pull request is merged', async () => {
    const h = makeHarness({
      runOverrides: { mode: 'IMPLEMENT' },
      implementerScript: [
        {
          output: implementerOutput({
            commit_evidence: { branch: 'b', commit_sha: 'abc123', pr_number: 861 },
          }),
        },
      ],
      workspace: workspaceSnapshot({
        commit: { sha: 'abc123', branch: 'b' },
        pull_request: { number: 861, head_sha: 'abc123', head_ref: 'b', merged: true },
      }),
    })

    const result = await runOrchestration(h.input, h.deps)

    const rejected = rejection(result)
    expect(rejected && 'detail' in rejected && rejected.detail).toContain('PR_ALREADY_MERGED')
  })
})

describe('git inspector', () => {
  function runnerFor(outputs: Record<string, string>): CommandRunner {
    return async (command, args) => outputs[`${command} ${args.join(' ')}`] ?? ''
  }

  it('merges committed and uncommitted changes', async () => {
    const inspector = new GitWorkspaceInspector({
      baseRef: 'origin/main',
      run: runnerFor({
        'git diff --name-only origin/main...HEAD': 'docs/specs/a.md\n',
        'git status --porcelain': ' M src/lib/b.ts\n?? src/lib/c.ts\n',
        'git rev-parse HEAD': 'abc1234\n',
        'git rev-parse --abbrev-ref HEAD': 'claude/x\n',
      }),
    })

    const snapshot = await inspector.inspect()

    // An agent that leaves a change uncommitted has still changed it.
    expect(snapshot.changed_files).toEqual(['docs/specs/a.md', 'src/lib/b.ts', 'src/lib/c.ts'])
    expect(snapshot.commit).toEqual({ sha: 'abc1234', branch: 'claude/x' })
    expect(snapshot.source).toBe('git:diff+status')
  })

  it('counts both sides of a rename', () => {
    expect(parsePorcelain('R  old/path.ts -> new/path.ts')).toEqual(['old/path.ts', 'new/path.ts'])
  })

  it('unquotes paths git escaped', () => {
    expect(parsePorcelain('?? "src/with space.ts"')).toEqual(['src/with space.ts'])
  })

  it('asks git about the protected surface for drift', async () => {
    const checker = new GitControlPlaneIntegrityChecker({
      baseRef: 'origin/main',
      run: runnerFor({
        'git diff --name-only origin/main...HEAD -- .github CODEOWNERS tools/ai-orchestrator':
          'tools/ai-orchestrator/src/runner.ts\n',
        'git status --porcelain -- .github CODEOWNERS tools/ai-orchestrator': '',
      }),
    })

    expect(await checker.drift()).toEqual(['tools/ai-orchestrator/src/runner.ts'])
  })

  it('reports intact when the protected surface did not move', async () => {
    const checker = new GitControlPlaneIntegrityChecker({ baseRef: 'origin/main', run: runnerFor({}) })
    expect(await checker.drift()).toEqual([])
  })
})

describe('GitHub PR inspector', () => {
  it('reads the file list and head from GitHub', async () => {
    const github = new InMemoryGitHubClient()
    github.seedPullRequest(
      { number: 861, head_sha: 'abc', head_ref: 'claude/x', merged: false },
      ['docs/specs/b.md', 'docs/specs/a.md']
    )

    const snapshot = await new GitHubPullRequestInspector(github, 861).inspect()

    expect(snapshot.changed_files).toEqual(['docs/specs/a.md', 'docs/specs/b.md'])
    expect(snapshot.pull_request).toMatchObject({ number: 861, merged: false })
    expect(snapshot.source).toBe('github:pr-files')
  })

  it('prefers GitHub once a PR exists and the local view before then', () => {
    const github = new InMemoryGitHubClient()
    const local = new StaticWorkspaceInspector(workspaceSnapshot())
    expect(selectInspector({ prNumber: null, github, local }).name).toBe('static')
    expect(selectInspector({ prNumber: 861, github, local }).name).toBe('github-pr')
  })
})
