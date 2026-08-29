/**
 * Structural proof that the Issue #1249 locks exist as real enforcement files
 * on this exact branch, not as content pasted into a PR description.
 *
 * There is no `skipIf` and no conditional pass anywhere in this file: a missing
 * or unwired workflow makes `load()` throw, which fails the suite. That is the
 * point — a guard nobody can see is indistinguishable from no guard.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ADMISSION_CHECK_NAME, MERGE_AUTH_CHECK_NAME } from '../src/check-names.mjs'

const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const ROOT = join(process.cwd(), '.github/workflows')
const path = (name: string) => join(ROOT, name)

interface WorkflowStep {
  id?: string
  uses?: string
  name?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
}
interface WorkflowJob {
  name?: string
  if?: string
  needs?: string | string[]
  steps?: WorkflowStep[]
  permissions?: Record<string, string>
}
interface Workflow {
  on?: Record<string, unknown>
  /** `on:` is YAML 1.1's boolean true, which js-yaml faithfully reproduces. */
  true?: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  jobs?: Record<string, WorkflowJob>
}

function load(name: string) {
  const file = path(name)
  if (!existsSync(file)) {
    throw new Error(`required Build Control enforcement file is missing from this branch: ${file}`)
  }
  const source = readFileSync(file, 'utf8')
  const doc = YAML.load(source) as Workflow
  const jobs = doc.jobs ?? {}
  return {
    name,
    source,
    doc,
    triggers: (doc.on ?? doc.true ?? {}) as Record<string, unknown>,
    jobs,
    jobList: Object.values(jobs),
    steps: Object.values(jobs).flatMap((job) => job.steps ?? []),
    checkouts: Object.values(jobs)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith('actions/checkout')),
  }
}

const claude = load('claude.yml')
const admission = load('build-control-admission.yml')
const mergeAuth = load('build-control-merge-auth.yml')
const guard1140 = load('build-control-1140-guard.yml')
const outcomeGuard = load('build-control-outcome-guard.yml')
const ci = load('build-control-ci.yml')

/** The gates: they decide things, so they never run PR-supplied code. */
const gates = [admission, mergeAuth, guard1140, outcomeGuard]
const changed = [claude, ci, ...gates]

const cases = (list: typeof changed) => list.map((w) => [w.name, w] as const)

describe('the enforcement files exist on this branch', () => {
  it.each(changed.map((w) => [w.name] as const))('%s', (name) => {
    expect(existsSync(path(name))).toBe(true)
  })

  it.each(cases(changed))('%s parses as YAML with a real trigger', (_name, workflow) => {
    expect(workflow.doc).toBeTruthy()
    expect(Object.keys(workflow.triggers).length).toBeGreaterThan(0)
  })
})

// Supply chain: a mutable tag can be repointed at new code by whoever controls
// the action's repository, under whatever token this workflow holds.
const USES_RE = /^\s*(?:-\s*)?uses:\s*(\S+)/gm
const PINNED_RE = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[0-9a-f]{40}$/

describe('every action reference is pinned to a reviewed 40-character SHA', () => {
  it.each(cases(changed))('%s', (_name, workflow) => {
    const refs = Array.from(workflow.source.matchAll(USES_RE), (m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(ref, `${workflow.name} uses a mutable action ref: ${ref}`).toMatch(PINNED_RE)
    }
  })

  it('claude.yml pins claude-code-action to the reviewed v1 commit, comment preserved', () => {
    expect(claude.source).toContain(
      'anthropics/claude-code-action@a874e9ecd7bb36efdad65429c6b35815f5a08f10 # v1'
    )
  })
})

// Trusted-workflow boundary. The gates read PR metadata over the API and run
// only default-branch code; nothing PR-supplied is ever executed under a
// write-capable token.
describe('the metadata gates use the trusted default-branch boundary', () => {
  it.each(cases([admission, mergeAuth]))('%s is triggered by pull_request_target, not pull_request', (_n, workflow) => {
    expect(Object.keys(workflow.triggers)).toContain('pull_request_target')
    expect(Object.keys(workflow.triggers)).not.toContain('pull_request')
  })

  it.each(cases(gates))('%s checks out main and persists no credentials', (_name, workflow) => {
    expect(workflow.checkouts.length).toBeGreaterThan(0)
    for (const checkout of workflow.checkouts) {
      expect(checkout.with?.ref).toBe('main')
      expect(checkout.with?.['persist-credentials']).toBe(false)
    }
  })

  it.each(cases(changed))('%s never checks out a PR head or merge ref', (_name, workflow) => {
    for (const checkout of workflow.checkouts) {
      expect(String(checkout.with?.ref ?? '')).not.toMatch(/head|pull|merge/i)
    }
    expect(workflow.source).not.toContain('github.head_ref')
  })

  it.each(cases(gates))('%s runs only scripts from the checked-out repository', (_name, workflow) => {
    const runs = workflow.steps.map((step) => step.run).filter(Boolean) as string[]
    for (const run of runs) {
      expect(run.trim()).toMatch(/^node tools\/build-control\/src\/[a-z0-9-]+\.mjs$/)
    }
  })
})

// A pull_request_target job's own status attaches to the base branch, so a
// ruleset requiring it would never judge the code being merged. The stable
// check has to be written explicitly against the head SHA instead.
describe('the stable check runs are written explicitly against the PR head SHA', () => {
  it.each([
    ['build-control-admission.yml', admission, ADMISSION_CHECK_NAME, 'pr-admission-cli.mjs'],
    ['build-control-merge-auth.yml', mergeAuth, MERGE_AUTH_CHECK_NAME, 'merge-auth-cli.mjs'],
  ] as const)('%s writes "%s"', (_name, workflow, checkName, cli) => {
    expect(workflow.doc.permissions?.checks).toBe('write')
    expect(workflow.steps.some((step) => step.run?.includes(cli))).toBe(true)

    const source = readFileSync(join(process.cwd(), `tools/build-control/src/${cli}`), 'utf8')
    expect(source).toContain('createCheckRun')
    expect(source).toContain('check-names.mjs')

    // Exactly one check may carry the stable name, and it must be the
    // head-attached one — so no job is allowed to display it.
    const jobNames = workflow.jobList.map((job) => job.name)
    expect(jobNames).not.toContain(checkName)
  })

  it('the admission check is written unconditionally, including on the failure path', () => {
    const source = readFileSync(join(process.cwd(), 'tools/build-control/src/pr-admission-cli.mjs'), 'utf8')
    expect(source).not.toContain('WRITE_EXPLICIT_CHECK')
    expect(source.match(/report\(/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('grants checks: write only where a check run is written', () => {
    for (const workflow of [claude, ci, guard1140, outcomeGuard]) {
      expect(workflow.doc.permissions?.checks).not.toBe('write')
    }
  })
})

describe('build-control-ci.yml is the only workflow that executes PR code', () => {
  it('uses pull_request with read-only permissions and no secrets', () => {
    expect(Object.keys(ci.triggers)).toEqual(['pull_request'])
    expect(ci.doc.permissions).toEqual({ contents: 'read' })
    expect(ci.source).not.toContain('secrets.')
  })

  it('checks out the PR itself rather than main — that is its whole job', () => {
    expect(ci.checkouts).toHaveLength(1)
    expect(ci.checkouts[0].with?.ref).toBeUndefined()
  })
})

const FORBIDDEN_WRITE_SCOPES = ['workflows', 'actions', 'administration', 'deployments', 'packages', 'security-events']

describe('least-privilege permissions', () => {
  it.each(cases([ci, ...gates]))('%s declares workflow-level permissions with no forbidden write', (_n, workflow) => {
    expect(workflow.doc.permissions).toBeDefined()
    expect(workflow.doc.permissions?.contents).not.toBe('write')
    for (const scope of FORBIDDEN_WRITE_SCOPES) {
      expect(workflow.doc.permissions?.[scope]).not.toBe('write')
    }
  })

  it.each(Object.entries(claude.jobs))('claude.yml job %s declares per-job permissions with no forbidden write', (_n, job) => {
    expect(job.permissions).toBeDefined()
    expect(job.permissions?.contents).not.toBe('write')
    for (const scope of FORBIDDEN_WRITE_SCOPES) {
      expect(job.permissions?.[scope]).not.toBe('write')
    }
  })
})

const DANGEROUS_SUBSTRINGS = [
  'gh pr merge',
  'git push --force',
  'push -f ',
  'pr merge',
  'apply_migration',
  'supabase db push',
  'supabase migration',
  '--auto-merge',
  'auto-merge',
  'ready-for-review',
  'ready_for_review',
]

describe('no Build Control workflow contains a merge, deploy, or migration operation', () => {
  it.each(cases(changed))('%s', (_name, workflow) => {
    const lower = workflow.source.toLowerCase()
    for (const term of DANGEROUS_SUBSTRINGS) {
      expect(lower, `${workflow.name} must not contain "${term}"`).not.toContain(term)
    }
  })
})

// A required check with a path filter never reports on a PR the filter
// excludes, and sits Pending forever.
describe('no changed workflow carries a path filter on any trigger', () => {
  it.each(cases(changed))('%s', (_name, workflow) => {
    for (const trigger of Object.values(workflow.triggers)) {
      if (trigger && typeof trigger === 'object') {
        expect(trigger).not.toHaveProperty('paths')
        expect(trigger).not.toHaveProperty('paths-ignore')
      }
    }
  })
})

describe('claude.yml serialises new implementation lanes and gates the model call', () => {
  it('routes every new-implementation dispatch into one global concurrency group', () => {
    const group = String(claude.doc.concurrency?.group ?? '')
    expect(group).toContain("&& 'build-control-new-implementation-lane'")
    expect(claude.doc.concurrency?.['cancel-in-progress']).toBe(false)
  })

  it('keys PR review/remediation lanes separately so they are never queued behind an implementation', () => {
    expect(String(claude.doc.concurrency?.group ?? '')).toContain('build-control-review-lane-')
  })

  it('runs the preflight before the model-calling job and blocks on its output', () => {
    const claudeJob = claude.jobs['claude']
    expect(claudeJob?.needs).toBe('dispatch-preflight')
    expect(claudeJob?.if).toContain("needs.dispatch-preflight.result == 'success'")
    expect(claudeJob?.if).toContain('blocked')
  })

  it('makes zero model calls from the preflight itself', () => {
    const steps = claude.jobs['dispatch-preflight']?.steps ?? []
    expect(steps.some((step) => step.uses?.startsWith('anthropics/claude-code-action'))).toBe(false)
    expect(steps.some((step) => step.run?.includes('dispatch-preflight-cli.mjs'))).toBe(true)
  })

  it('treats only Issue-targeted events as new implementation dispatches', () => {
    const step = claude.jobs['dispatch-preflight']?.steps?.find((s) => s.run?.includes('dispatch-preflight-cli.mjs'))
    expect(String(step?.env?.IS_NEW_IMPLEMENTATION_DISPATCH)).toContain('github.event.issue.pull_request == null')
  })
})

describe('the #1140 guard never edits or deletes the source comment', () => {
  it('its CLI has no comment-update or comment-delete call', () => {
    const source = readFileSync(join(process.cwd(), 'tools/build-control/src/issue-1140-guard-cli.mjs'), 'utf8')
    expect(source).not.toMatch(/PATCH.*comments/)
    expect(source).not.toContain('deleteComment')
    expect(source).not.toContain('updateComment')
    expect(source).not.toContain('createIssueComment')
  })
})

describe('label rollout is honest: only machine-output labels are created', () => {
  it.each([
    ['issue-1140-guard-cli.mjs', 'build-control:1140-state-invalid'],
    ['business-loop-guard-cli.mjs', 'build-control:impact-incomplete'],
  ] as const)('%s ensures %s before using it', (cli, label) => {
    const source = readFileSync(join(process.cwd(), `tools/build-control/src/${cli}`), 'utf8')
    expect(source).toContain('ensureLabelExists')
    expect(source.indexOf('ensureLabelExists')).toBeLessThan(source.indexOf('addIssueLabel'))
    expect(readFileSync(join(process.cwd(), `tools/build-control/src/${cli.replace('-cli', '')}`), 'utf8')).toContain(
      label
    )
  })

  it('never creates or applies the impact-loop label — that is an owner rollout action', () => {
    const source = readFileSync(join(process.cwd(), 'tools/build-control/src/business-loop-guard-cli.mjs'), 'utf8')
    expect(source).not.toContain('IMPACT_LOOP_LABEL')
  })

  it.each(['issue-1140-guard-cli.mjs', 'business-loop-guard-cli.mjs'])(
    '%s clears its stale label once the state is valid again',
    (cli) => {
      const source = readFileSync(join(process.cwd(), `tools/build-control/src/${cli}`), 'utf8')
      expect(source).toContain('removeIssueLabel')
      expect(source.indexOf('removeIssueLabel')).toBeLessThan(source.indexOf('addIssueLabel'))
    }
  )
})
