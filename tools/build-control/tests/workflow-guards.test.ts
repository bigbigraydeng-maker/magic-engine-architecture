/**
 * Structural proof for Issue #1249 fixtures #11 and #12, plus the ordinary
 * least-privilege / no-dangerous-operation invariants every other workflow
 * guard suite in this repo already checks (mirrors
 * tools/ops-review-loop/tests/workflow-guards.test.ts and
 * tools/ai-orchestrator/tests/workflow-supply-chain.test.ts).
 *
 * 🔴 The Claude GitHub App has no `workflows` permission, so the
 * `.github/workflows/*build-control*.yml` files and the `claude.yml` edit
 * this suite validates could not be pushed as part of this PR — GitHub
 * rejected the push outright. Their content is preserved verbatim in the PR
 * description for a human with workflow-write access to apply directly. This
 * suite checks for their presence first and skips itself with a clear reason
 * when they are absent, so `npm test` stays green in the interim rather than
 * crashing on a missing file — the moment those files land on this branch,
 * the very same assertions start running for real with no code change here.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const requireFromHere = createRequire(import.meta.url)
const YAML = requireFromHere('js-yaml') as { load(input: string): unknown }

const ROOT = join(process.cwd(), '.github/workflows')
const CLAUDE_PATH = join(ROOT, 'claude.yml')
const ADMISSION_PATH = join(ROOT, 'build-control-admission.yml')
const MERGE_AUTH_PATH = join(ROOT, 'build-control-merge-auth.yml')
const GUARD_1140_PATH = join(ROOT, 'build-control-1140-guard.yml')
const OUTCOME_GUARD_PATH = join(ROOT, 'build-control-outcome-guard.yml')
const CI_PATH = join(ROOT, 'build-control-ci.yml')

const REQUIRED_PATHS = [ADMISSION_PATH, MERGE_AUTH_PATH, GUARD_1140_PATH, OUTCOME_GUARD_PATH, CI_PATH]
const workflowsApplied = REQUIRED_PATHS.every((p) => existsSync(p)) && readFileSync(CLAUDE_PATH, 'utf8').includes('dispatch-preflight')

describe.skipIf(!workflowsApplied)('Build Control workflow structural checks', () => {

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
  if?: string
  needs?: string | string[]
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

/**
 * Safe by construction: a missing file (the not-yet-applied case above)
 * returns an empty stub instead of throwing, so collecting this test module
 * never crashes `npm test` for the rest of the repository. The
 * `describe.skipIf` above is what makes the individual assertions skip
 * (not silently pass) when that happens.
 */
function load(path: string) {
  const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const doc = (source ? YAML.load(source) : {}) as Workflow
  const jobs = doc.jobs ?? {}
  return {
    path,
    source,
    doc,
    triggers: (doc.on ?? doc.true ?? {}) as Record<string, unknown>,
    jobs,
    jobList: Object.values(jobs),
    steps: Object.values(jobs).flatMap((job) => job.steps ?? []),
  }
}

const claude = load(CLAUDE_PATH)
const admission = load(ADMISSION_PATH)
const mergeAuth = load(MERGE_AUTH_PATH)
const guard1140 = load(GUARD_1140_PATH)
const outcomeGuard = load(OUTCOME_GUARD_PATH)
const ci = load(CI_PATH)
const buildControlWorkflows = [admission, mergeAuth, guard1140, outcomeGuard]
const allWorkflows = [claude, ci, ...buildControlWorkflows]

describe('every Build Control workflow parses as YAML with a real trigger', () => {
  it.each(allWorkflows.map((w) => [w.path, w] as const))('%s', (_path, workflow) => {
    expect(workflow.doc).toBeTruthy()
    expect(Object.keys(workflow.triggers).length).toBeGreaterThan(0)
  })
})

// Fixture #11: pull_request_target paths never checkout/execute head code,
// and permissions stay least privilege.
describe('no Build Control workflow uses pull_request_target', () => {
  it.each(allWorkflows.map((w) => [w.path, w] as const))(
    '%s has no pull_request_target trigger',
    (_path, workflow) => {
      expect(Object.keys(workflow.triggers)).not.toContain('pull_request_target')
    }
  )
})

describe('every Build Control workflow checks itself out from main, never the PR/issue head', () => {
  it.each(buildControlWorkflows.map((w) => [w.path, w] as const))('%s', (_path, workflow) => {
    const checkout = workflow.steps.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout, `${workflow.path} has no checkout step`).toBeDefined()
    expect(checkout?.with?.ref).toBe('main')
  })

  it('the dispatch-preflight job in claude.yml also checks out main, not the triggering ref', () => {
    const job = claude.jobs['dispatch-preflight']
    const checkout = job?.steps?.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBe('main')
  })
})

const FORBIDDEN_WRITE_SCOPES = [
  'workflows',
  'actions',
  'administration',
  'deployments',
  'packages',
  'security-events',
]

describe('every new build-control-*.yml declares least-privilege workflow-level permissions', () => {
  it.each(buildControlWorkflows.map((w) => [w.path, w] as const))('%s never grants a forbidden write scope', (_path, workflow) => {
    expect(workflow.doc.permissions).toBeDefined()
    for (const scope of FORBIDDEN_WRITE_SCOPES) {
      expect(workflow.doc.permissions?.[scope]).not.toBe('write')
    }
  })

  it.each(buildControlWorkflows.map((w) => [w.path, w] as const))('%s never grants contents: write', (_path, workflow) => {
    expect(workflow.doc.permissions?.contents).not.toBe('write')
  })
})

describe('claude.yml declares least-privilege permissions per job (its existing convention, unchanged)', () => {
  it.each(Object.entries(claude.jobs))('job %s never grants a forbidden write scope', (_name, job) => {
    expect(job.permissions).toBeDefined()
    for (const scope of FORBIDDEN_WRITE_SCOPES) {
      expect(job.permissions?.[scope]).not.toBe('write')
    }
  })

  it('neither job grants contents: write', () => {
    for (const job of Object.values(claude.jobs)) {
      expect(job.permissions?.contents).not.toBe('write')
    }
  })
})

describe('build-control-ci.yml is a plain, read-only test runner (safe to run PR-head code)', () => {
  it('declares contents: read only, no write scope of any kind', () => {
    expect(ci.doc.permissions).toEqual({ contents: 'read' })
  })

  it('has no paths:/paths-ignore: filter', () => {
    const pr = ci.triggers.pull_request as Record<string, unknown> | null | undefined
    if (pr) {
      expect(pr).not.toHaveProperty('paths')
      expect(pr).not.toHaveProperty('paths-ignore')
    }
  })

  it('is intentionally not pinned to main — it exists to test the PR-proposed code itself, using pull_request\'s fork-safe token model', () => {
    const checkout = ci.steps.find((s) => s.uses?.startsWith('actions/checkout'))
    expect(checkout?.with?.ref).toBeUndefined()
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
  it.each(allWorkflows.map((w) => [w.path, w] as const))('%s', (_path, workflow) => {
    const lower = workflow.source.toLowerCase()
    for (const term of DANGEROUS_SUBSTRINGS) {
      expect(lower, `${workflow.path} must not contain "${term}"`).not.toContain(term)
    }
  })
})

// Fixture #12: no new workflow path filter creates a permanently pending
// required check. None of these are added to the ruleset in this PR, but
// they are written filter-free so they are safe to add later.
describe('no Build Control pull_request-triggered workflow carries a path filter', () => {
  for (const workflow of [admission, mergeAuth]) {
    it(`${workflow.path} has no paths:/paths-ignore: under pull_request`, () => {
      const pr = workflow.triggers.pull_request as Record<string, unknown> | undefined
      expect(pr).toBeDefined()
      expect(pr).not.toHaveProperty('paths')
      expect(pr).not.toHaveProperty('paths-ignore')
    })
  }

  it('claude.yml carries no path filter on any trigger either', () => {
    for (const trigger of Object.values(claude.triggers)) {
      if (trigger && typeof trigger === 'object') {
        expect(trigger).not.toHaveProperty('paths')
        expect(trigger).not.toHaveProperty('paths-ignore')
      }
    }
  })
})

describe('claude.yml wires the dispatch preflight ahead of the model-calling job', () => {
  it('the claude job needs dispatch-preflight and gates on its blocked output', () => {
    const claudeJob = claude.jobs['claude']
    expect(claudeJob?.needs).toBe('dispatch-preflight')
    expect(claudeJob?.if).toContain("needs.dispatch-preflight.result == 'success'")
    expect(claudeJob?.if).toContain('blocked')
  })

  it('the dispatch-preflight job makes no call to the claude-code-action (zero model calls when blocked)', () => {
    const job = claude.jobs['dispatch-preflight']
    const usesAction = (job?.steps ?? []).some((s) => s.uses?.startsWith('anthropics/claude-code-action'))
    expect(usesAction).toBe(false)
  })

  it('claude.yml serialises dispatches per Issue/PR so a race cannot start two lanes', () => {
    expect(claude.doc.concurrency?.group).toBeDefined()
    expect(claude.doc.concurrency?.['cancel-in-progress']).toBe(false)
  })
})

describe('the merge-auth check never writes an explicit check run except on the comment path', () => {
  it('WRITE_EXPLICIT_CHECK is only true for issue_comment', () => {
    const step = mergeAuth.steps.find((s) => s.run?.includes('merge-auth-cli.mjs'))
    expect(String(step?.env?.WRITE_EXPLICIT_CHECK)).toContain("issue_comment")
  })

  it('grants checks: write only on the merge-auth workflow, nowhere else', () => {
    expect(mergeAuth.doc.permissions?.checks).toBe('write')
    for (const workflow of [claude, admission, guard1140, outcomeGuard]) {
      expect(workflow.doc.permissions?.checks).not.toBe('write')
    }
  })
})

describe('the #1140 guard never edits or deletes the source comment', () => {
  it('the CLI script it runs contains no comment-update or comment-delete call', () => {
    const source = readFileSync(
      join(process.cwd(), 'tools/build-control/src/issue-1140-guard-cli.mjs'),
      'utf8'
    )
    expect(source).not.toMatch(/PATCH.*comments/)
    expect(source).not.toContain('deleteComment')
    expect(source).not.toContain('updateComment')
  })
})

}) // end describe.skipIf('Build Control workflow structural checks')

// Always-on notice so a `vitest run --reporter=verbose` makes the skip reason
// visible without having to go read the skipIf condition above.
if (!workflowsApplied) {
  describe('Build Control workflow files', () => {
    it('are not yet on this branch — GitHub App lacks `workflows` permission; see PR description for the content to apply manually', () => {
      expect(workflowsApplied).toBe(false)
    })
  })
}
