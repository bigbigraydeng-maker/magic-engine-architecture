import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }
const PATH = join(process.cwd(), '.github/workflows/pr-merge-authorization.yml')
const source = readFileSync(PATH, 'utf8')
const workflow = YAML.load(source) as {
  on?: Record<string, unknown>
  true?: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: Record<string, unknown>
  jobs?: Record<string, {
    if?: string
    environment?: { name?: string }
    steps?: Array<{ uses?: string; run?: string }>
  }>
}

describe('preventive merge authorization workflow', () => {
  it('is bound to PR revisions and cancels stale approvals', () => {
    const triggers = workflow.on ?? workflow.true ?? {}
    expect(Object.keys(triggers)).toEqual(['pull_request'])
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(true)
    expect(source).toContain('github.event.pull_request.head.sha')
  })

  it('uses the protected environment only for non-draft PRs', () => {
    const job = workflow.jobs?.['merge-authorization']
    expect(job?.if).toContain('draft == false')
    expect(job?.environment?.name).toBe('merge-authorization')
  })

  it('is read-only and contains no merge, deploy, publish, or provider operation', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' })
    const lower = source.toLowerCase()
    for (const forbidden of ['gh pr merge', 'git push', 'deploy', '/publish', 'muapi', 'fal.ai']) {
      expect(lower).not.toContain(forbidden)
    }
    const steps = Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? [])
    expect(steps.every((step) => !step.uses)).toBe(true)
  })
})
