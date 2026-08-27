import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const createIssueComment = vi.fn().mockResolvedValue({})
const getPullRequest = vi.fn()
const listCheckRunsForRef = vi.fn()
const listIssueComments = vi.fn()
const listPullRequestFiles = vi.fn()
const listReviewComments = vi.fn()
vi.mock('../src/github.mjs', () => ({
  createIssueComment: (...args) => createIssueComment(...args),
  getPullRequest: (...args) => getPullRequest(...args),
  listCheckRunsForRef: (...args) => listCheckRunsForRef(...args),
  listIssueComments: (...args) => listIssueComments(...args),
  listPullRequestFiles: (...args) => listPullRequestFiles(...args),
  listReviewComments: (...args) => listReviewComments(...args),
}))

function withEnv(overrides, run) {
  const original = { ...process.env }
  Object.assign(process.env, overrides)
  return run().finally(() => {
    process.env = original
  })
}

const OWNER_REPO = 'bigbigraydeng-maker/magic-engine'
const BASE = 'b'.repeat(40)
const SHA = 'c'.repeat(40)
const GREEN_CI = { name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' }

function gateMarker({ head, risk }) {
  return `<!-- me-dev-gate:${JSON.stringify({ v: 1, base: BASE, head, risk })} -->`
}

function eventFile(dir, { body = 'clean review', findings = [] } = {}) {
  const eventPath = join(dir, 'event.json')
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: { number: 7, head: { sha: SHA }, base: { sha: BASE }, body: 'PR body' },
      review: { id: 99, body },
    }),
  )
  return eventPath
}

// setOutput() (src/output.mjs) appends to $GITHUB_OUTPUT unconditionally —
// every plan.action branch in handle-review.mjs calls it. A real GITHUB_OUTPUT
// path is required or appendFileSync(undefined, ...) throws before any
// assertion runs. Same pattern as wait-ci-visible.test.ts's outPath.
function outputFile(dir) {
  const outPath = join(dir, 'out.txt')
  writeFileSync(outPath, '')
  return outPath
}

describe('handle-review: round budget follows risk', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-hr-round-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    listCheckRunsForRef.mockReset()
    listIssueComments.mockReset()
    listPullRequestFiles.mockReset()
    listReviewComments.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('caps an A-level PR at 2 rounds, not the old flat 3', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    // Two prior fix-dispatched rounds already on record for this PR (any sha) —
    // the third actionable review should hit the A-level cap of 2.
    const priorRounds = [1, 2]
      .map((round) => `<!-- ops-codex-loop:stage=fix-dispatched pr=7 sha=old${round} round=${round} -->`)
      .join('\n')
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: `${gateMarker({ head: SHA, risk: 'A' })}\n${priorRounds}` },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('NEEDS HUMAN REVIEW')
    expect(body).toContain('risk level A')
  })

  it('caps a C-level (or unrated) PR at 1 round', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    const priorRound = `<!-- ops-codex-loop:stage=fix-dispatched pr=7 sha=old1 round=1 -->`
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: `${gateMarker({ head: SHA, risk: 'C' })}\n${priorRound}` },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('NEEDS HUMAN REVIEW')
  })

  it('gives an unrated PR the smallest budget, not the largest', async () => {
    const eventPath = eventFile(dir, { body: 'P1 fix this' })
    const priorRound = `<!-- ops-codex-loop:stage=fix-dispatched pr=7 sha=old1 round=1 -->`
    // No trusted gate marker at all this time.
    listIssueComments.mockResolvedValue([{ user: { login: 'github-actions[bot]' }, body: priorRound }])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    getPullRequest.mockResolvedValue({ head: { sha: SHA } })

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('NEEDS HUMAN REVIEW')
    expect(body).toContain('risk level unknown')
  })
})

describe('handle-review: the ready case runs the real quality gate', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ops-loop-hr-ready-'))
    createIssueComment.mockClear()
    getPullRequest.mockReset()
    listCheckRunsForRef.mockReset()
    listIssueComments.mockReset()
    listPullRequestFiles.mockReset()
    listReviewComments.mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('posts BLOCKED, not an unconditional READY, when the PR carries no evidence', async () => {
    const eventPath = eventFile(dir, { body: 'Clean review — nothing to flag.' })
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: SHA, risk: 'C' }) },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI])
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    expect(createIssueComment).toHaveBeenCalledTimes(1)
    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('BLOCKED')
    expect(body).not.toContain('READY FOR PRODUCT OWNER')
    // The ops-codex-loop dedup marker must still be present, or a later
    // duplicate review event would re-evaluate and re-post this forever.
    expect(body).toContain('ops-codex-loop:stage=ready')
  })

  it('posts READY when required CI is green and no actionable findings exist, with real evidence present', async () => {
    const richBody = [
      'Closes #1210',
      '验收条件：全部通过',
      '明确不做：不动 kernel',
      '## Reuse Statement',
      '失败处理：fail-closed',
      '观测：失败会被谁发现',
      'npm run build 通过',
      'npx vitest run tools/ops-review-loop 全绿',
    ].join('\n\n')
    const eventPath = join(dir, 'event.json')
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: { number: 7, head: { sha: SHA }, base: { sha: BASE }, body: richBody },
        review: { id: 99, body: 'Clean review — nothing to flag.' },
      }),
    )
    listIssueComments.mockResolvedValue([
      { user: { login: 'github-actions[bot]' }, body: gateMarker({ head: SHA, risk: 'C' }) },
    ])
    listReviewComments.mockResolvedValue([])
    listCheckRunsForRef.mockResolvedValue([GREEN_CI, { name: 'ops-fix-scope-guard', status: 'completed', conclusion: 'success' }])
    listPullRequestFiles.mockResolvedValue([
      { filename: 'docs/x.md', status: 'modified' },
      { filename: 'scripts/example.test.ts', status: 'added' },
    ])

    await withEnv(
      { GITHUB_TOKEN: 'tok', GITHUB_REPOSITORY: OWNER_REPO, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputFile(dir) },
      () => import('../src/handle-review.mjs'),
    )

    const [, , , , body] = createIssueComment.mock.calls[0]
    expect(body).toContain('READY FOR PRODUCT OWNER')
  })
})
