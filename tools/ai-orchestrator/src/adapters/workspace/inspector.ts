/**
 * Authoritative facts about what a turn actually did to the repository.
 *
 * The model's own `files_changed` / `commit_evidence` are a *description*. This is
 * the *record*. Policy is enforced against what git and GitHub say, never against
 * what the implementer says about itself — an agent that under-reports a file it
 * touched must not thereby escape the scope check.
 */

export interface CommitFacts {
  sha: string
  branch: string
}

export interface PullRequestFacts {
  number: number
  head_sha: string
  head_ref: string
  merged: boolean
}

export interface WorkspaceSnapshot {
  /**
   * Every path that differs from the run's baseline — committed, staged and
   * unstaged alike. An agent that leaves a change uncommitted has still changed it.
   */
  changed_files: readonly string[]
  commit: CommitFacts | null
  pull_request: PullRequestFacts | null
  /** Provenance, e.g. `git:diff+status` or `github:pr-files`. Recorded in the ledger. */
  source: string
}

export interface WorkspaceInspector {
  readonly name: string
  inspect(): Promise<WorkspaceSnapshot>
}

/** Fixed snapshot, for tests and for the mock-only scaffold. */
export class StaticWorkspaceInspector implements WorkspaceInspector {
  readonly name = 'static'

  constructor(private readonly snapshot: WorkspaceSnapshot) {}

  async inspect(): Promise<WorkspaceSnapshot> {
    return this.snapshot
  }
}

export function emptySnapshot(source = 'static:empty'): WorkspaceSnapshot {
  return { changed_files: [], commit: null, pull_request: null, source }
}
