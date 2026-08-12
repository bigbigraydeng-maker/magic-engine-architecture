import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createIssueComment = vi.fn().mockResolvedValue({})
const getPullRequest = vi.fn()
vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...args) => createIssueComment(...args),
  getPullRequest: (...args) => getPullRequest(...args),
}))

function withEnv(overrides, run) {
  const original = { ...process.env }
  Object.assign(process.env, overrides)
  return run().finally(() => {
    process.env = original
  })
}

describe('mark-fix-outcome', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts the fix-dispatched marker when the step succeeded AND the head actually moved', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 906, head: { sha: 'abc1234' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'newsha7777' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('Completed automated fix round 1')
    expect(body).toContain('<!-- ops-codex-loop:stage=fix-dispatched pr=906 sha=abc1234 round=1 -->')
  })

  it('posts a visible failure warning and no marker when the outcome is not success', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 906, head: { sha: 'def5678' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'def5678' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '2',
        OUTCOME: 'failure',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('did not finish successfully')
    expect(body).not.toContain('ops-codex-loop:stage=fix-dispatched')
  })
})

describe('mark-fix-outcome: a round that pushed nothing', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-nopush-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('refuses to claim a push when the step went green but the head never moved', async () => {
    // Observed three times on PR #931 (2026-08-12 04:19, 04:41, 04:51):
    // claude-code-action exited success having changed nothing — the findings
    // were in .github/workflows, which its own prompt forbids it to touch —
    // and the loop announced "pushed the change" each time. Every commit on
    // that branch was in fact hand-pushed.
    //
    // Worse, those three phantom rounds consumed the whole 3-round budget, so
    // the loop then declared NEEDS HUMAN REVIEW about work it never attempted.
    // Hence: no marker either.
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'd3e9c50c' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'd3e9c50c' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('pushed no commit')
    expect(body).toContain('not** counted against the 3-round limit')
    expect(body).not.toContain('ops-codex-loop:stage=fix-dispatched')
  })

  it('names the real new head when it did push', async () => {
    const eventPath = join(dir, 'event.json')
    writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 931, head: { sha: 'oldsha0000' } } }))
    getPullRequest.mockResolvedValue({ head: { sha: 'brandnew11' } })

    await withEnv(
      {
        GITHUB_TOKEN: 'tok',
        GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
        GITHUB_EVENT_PATH: eventPath,
        ROUND: '1',
        OUTCOME: 'success',
      },
      () => import('../src/mark-fix-outcome.mjs')
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('brandnew11')
    expect(body).toContain('stage=fix-dispatched')
  })
})
