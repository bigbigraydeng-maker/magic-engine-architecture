import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The `wait-ci` branch used to log and post nothing at all. This workflow only
 * listens to pull_request_review.submitted, so re-running a check to green
 * produces no new event — the PR just stopped moving, and from its page "CI is
 * red" and "the automation is broken" were the same picture: silence.
 */

const createIssueComment = vi.fn().mockResolvedValue({})
const listIssueComments = vi.fn().mockResolvedValue([])
const listReviewComments = vi.fn().mockResolvedValue([])
const listCheckRunsForRef = vi.fn()

vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...a: unknown[]) => createIssueComment(...a),
  listIssueComments: (...a: unknown[]) => listIssueComments(...a),
  listReviewComments: (...a: unknown[]) => listReviewComments(...a),
  listCheckRunsForRef: (...a: unknown[]) => listCheckRunsForRef(...a),
  getPullRequest: vi.fn(),
}))

const SHA = 'c'.repeat(40)

function run(dir: string) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: { number: 931, head: { sha: SHA } },
      review: { id: 1, body: 'Codex Review: no findings worth flagging.' },
    }),
  )
  const outPath = join(dir, 'out.txt')
  writeFileSync(outPath, '')
  const original = { ...process.env }
  Object.assign(process.env, {
    GITHUB_TOKEN: 'tok',
    GITHUB_REPOSITORY: 'bigbigraydeng-maker/magic-engine',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outPath,
  })
  return import('../src/handle-review.mjs').finally(() => {
    process.env = original
  })
}

describe('handle-review: CI never went green', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-waitci-'))
    createIssueComment.mockClear()
    listIssueComments.mockReset().mockResolvedValue([])
    listCheckRunsForRef.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('says which check is not green instead of going silent', async () => {
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' },
    ])

    await run(dir)

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const body = String(createIssueComment.mock.calls[0][4])
    expect(body).toContain('BLOCKED ON CI')
    expect(body).toContain('ai-orchestrator-tests')
    expect(body).toContain('completed/failure')
    // And it must warn that re-running the check alone changes nothing, which
    // is the non-obvious part that left PRs stuck with no explanation.
    expect(body).toContain('will **not** move this PR on its own')
  })

  it('says so only once per commit', async () => {
    listCheckRunsForRef.mockResolvedValue([
      { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'failure' },
    ])
    listIssueComments.mockResolvedValue([
      { body: `<!-- ops-codex-loop:stage=ci-blocked pr=931 sha=${SHA} -->` },
    ])

    await run(dir)

    expect(createIssueComment).not.toHaveBeenCalled()
  })
})
