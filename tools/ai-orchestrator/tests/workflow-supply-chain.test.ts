/**
 * The workflow's own supply-chain and permission rules, as assertions.
 *
 * Writing "pin your actions" in a checklist does not stop anyone from adding
 * `uses: some/action@v1` in six months. Reading the file and failing the build
 * does. Same for the trigger list and the permission block: these were prose
 * promises in the spec, and prose does not survive a hurried edit.
 *
 * The file is parsed with the same YAML library GitHub uses, not grepped, so a
 * restructured-but-equivalent workflow is judged on what it means.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `js-yaml` is present transitively (via eslint) rather than as a direct
 * dependency, and this suite deliberately does not add one. It is loaded through
 * `createRequire` with an explicit type instead of a bare import so there is no
 * implicit `any`, and if it ever disappears these tests fail loudly rather than
 * quietly skipping the supply-chain checks. The `uses:` assertions below also run
 * against the raw text, so the most important property survives even that.
 */
const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const WORKFLOW_PATH = join(process.cwd(), '.github/workflows/ai-orchestrator-manual.yml')

interface WorkflowStep {
  uses?: string
  name?: string
  run?: string
  if?: string
}

interface WorkflowJob {
  steps?: WorkflowStep[]
  permissions?: Record<string, string>
}

interface Workflow {
  on?: Record<string, unknown>
  true?: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, WorkflowJob>
}

const workflow = YAML.load(readFileSync(WORKFLOW_PATH, 'utf8')) as Workflow
// `on:` is YAML 1.1's boolean true, which js-yaml faithfully reproduces.
const triggers = (workflow.on ?? workflow.true ?? {}) as Record<string, unknown>

const FULL_SHA = /^[0-9a-f]{40}$/

function allSteps(): WorkflowStep[] {
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? [])
}

describe('triggers', () => {
  it('is manual only', () => {
    expect(Object.keys(triggers)).toEqual(['workflow_dispatch'])
  })

  it.each(['schedule', 'issue_comment', 'push', 'pull_request', 'repository_dispatch'])(
    'has no %s trigger',
    (name) => {
      expect(triggers).not.toHaveProperty(name)
    }
  )

  it('defaults its master switch to off', () => {
    const dispatch = triggers.workflow_dispatch as {
      inputs?: Record<string, { default?: unknown }>
    }
    expect(dispatch.inputs?.enabled?.default).toBe(false)
  })
})

describe('permissions', () => {
  it('grants only contents: read at the top level', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it.each(['workflows', 'actions', 'administration', 'deployments', 'packages', 'security-events'])(
    'never grants %s',
    (scope) => {
      const blocks = [workflow.permissions, ...Object.values(workflow.jobs ?? {}).map((j) => j.permissions)]
      for (const block of blocks) {
        if (!block) continue
        expect(block[scope]).not.toBe('write')
      }
    }
  )
})

describe('third-party actions are pinned to reviewed commits', () => {
  const uses = allSteps()
    .map((step) => step.uses)
    .filter((value): value is string => typeof value === 'string')

  // Text-level cross-check, independent of the YAML parser: every `uses:` line in
  // the file, however the document is structured, must carry a 40-hex pin.
  it('has no unpinned uses: line anywhere in the raw file', () => {
    const lines = readFileSync(WORKFLOW_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- uses:') || line.startsWith('uses:'))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line, `${line} must be pinned to a commit SHA`).toMatch(/@[0-9a-f]{40}\b/)
    }
  })

  it('uses at least one action, so this suite is not vacuous', () => {
    expect(uses.length).toBeGreaterThan(0)
  })

  it.each(uses)('%s is pinned to a full commit SHA', (reference) => {
    const [, version] = reference.split('@')
    expect(version, `${reference} must be pinned to a 40-character commit SHA`).toMatch(FULL_SHA)
  })

  it('pins no action to a moveable tag or branch', () => {
    const moveable = uses.filter((reference) => !FULL_SHA.test(reference.split('@')[1] ?? ''))
    expect(moveable).toEqual([])
  })

  it('leaves a human-readable version comment beside each pin', () => {
    const source = readFileSync(WORKFLOW_PATH, 'utf8')
    for (const reference of uses) {
      const line = source.split('\n').find((candidate) => candidate.includes(reference))
      expect(line, `${reference} should carry a "# vX.Y.Z" comment`).toMatch(/#\s*v\d/)
    }
  })
})

describe('concurrency', () => {
  it('serialises per Issue and never cancels a run mid-turn', () => {
    expect(workflow.concurrency?.group).toContain('inputs.issue_number')
    expect(workflow.concurrency?.['cancel-in-progress']).toBe(false)
  })
})

describe('the scaffold refuses to be switched on', () => {
  it('fails the job when enabled is true', () => {
    const guard = allSteps().find((step) => step.if === '${{ inputs.enabled }}')
    expect(guard).toBeDefined()
    expect(guard?.run).toContain('exit 1')
  })

  it('fails the job when model credentials are present', () => {
    const guard = allSteps().find((step) => step.name?.includes('no model credentials'))
    expect(guard?.run).toContain('exit 1')
  })

  it('asserts the working tree is unchanged at the end', () => {
    const guard = allSteps().find((step) => step.name?.includes('changed nothing'))
    expect(guard?.run).toContain('git status --porcelain')
    expect(guard?.run).toContain('exit 1')
  })
})
