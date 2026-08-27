import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseGateMarkers } from '../src/gate-marker.mjs'

const listPullRequestFiles = vi.fn()
vi.mock('../src/github.mjs', () => ({
  listPullRequestFiles: (...args) => listPullRequestFiles(...args),
}))

const { buildVerdictComment } = await import('../src/verdict.mjs')

const BASE = 'b'.repeat(40)
const SHA = 'c'.repeat(40)

describe('buildVerdictComment', () => {
  afterEach(() => {
    listPullRequestFiles.mockReset()
  })

  it('blocks with a low score when the PR carries no evidence, rather than defaulting to READY', async () => {
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])

    const { decision, comment } = await buildVerdictComment({
      token: 'tok',
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      prBody: '',
      base: BASE,
      sha: SHA,
      risk: 'C',
      shaMatches: true,
      checkRuns: [{ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' }],
      requiredCiPassed: true,
      openBlockerCount: 0,
    })

    expect(decision.decision).toBe('BLOCKED')
    expect(comment).toContain('BLOCKED')
    const [marker] = parseGateMarkers([comment])
    expect(marker).toMatchObject({ base: BASE, head: SHA, risk: 'C', decision: 'BLOCKED' })
  })

  it('blocks (not READY) when the sha does not match the trusted rating', async () => {
    listPullRequestFiles.mockResolvedValue([])

    const { decision } = await buildVerdictComment({
      token: 'tok',
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      prBody: '',
      base: BASE,
      sha: SHA,
      risk: null,
      shaMatches: false,
      checkRuns: [],
      requiredCiPassed: true,
      openBlockerCount: 0,
    })

    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('对不上'))).toBe(true)
  })

  it('falls back to the diff-computed risk for display when no trusted risk was passed', async () => {
    listPullRequestFiles.mockResolvedValue([{ filename: '.github/workflows/x.yml', status: 'modified' }])

    const { comment } = await buildVerdictComment({
      token: 'tok',
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      prBody: '',
      base: BASE,
      sha: SHA,
      risk: null,
      shaMatches: false,
      checkRuns: [],
      requiredCiPassed: true,
      openBlockerCount: 0,
    })

    // The file is A-level control-plane, so even with no trusted rating the
    // report should not silently say something else.
    expect(comment).toContain('风险级别 A')
  })

  it('propagates open Codex findings as a hard-gate blocker', async () => {
    listPullRequestFiles.mockResolvedValue([{ filename: 'docs/x.md', status: 'modified' }])

    const { decision } = await buildVerdictComment({
      token: 'tok',
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      prBody: '',
      base: BASE,
      sha: SHA,
      risk: 'B',
      shaMatches: true,
      checkRuns: [{ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' }],
      requiredCiPassed: true,
      openBlockerCount: 1,
    })

    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('1 条 Codex'))).toBe(true)
  })

  it('treats a failed file fetch as unreadable evidence, not a pass', async () => {
    listPullRequestFiles.mockRejectedValue(new Error('boom'))

    const { decision } = await buildVerdictComment({
      token: 'tok',
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      prBody: '',
      base: BASE,
      sha: SHA,
      risk: 'C',
      shaMatches: true,
      checkRuns: [{ name: 'ai-orchestrator-tests', status: 'completed', conclusion: 'success' }],
      requiredCiPassed: true,
      openBlockerCount: 0,
    })

    expect(decision.decision).toBe('BLOCKED')
    expect(decision.blockers.some((b) => b.includes('读不到'))).toBe(true)
  })
})
